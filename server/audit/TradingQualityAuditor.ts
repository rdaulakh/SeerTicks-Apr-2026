/**
 * TradingQualityAuditor — Phase 59
 *
 * Offline auditor that grades the platform's recent trading quality and
 * surfaces actionable findings for a human (or Claude) to resolve. Runs
 * out-of-band of the live engine (separate process, read-only DB queries)
 * so it adds zero latency to the signal pipeline.
 *
 * Checks (each returns Finding[]):
 *   1. Missed entries — SKIPPED/VETOED decisions whose subsequent 15-min
 *      price action would have hit the implied take-profit. Highest-cost
 *      misses ranked first.
 *   2. Suboptimal exits — closed trades where price continued ≥0.5% in
 *      the trade's direction within 15 min after exit. Categorized by
 *      exitReason so we know which rule fires too early.
 *   3. Stuck positions — open positions held >2h with peak unrealized
 *      PnL never above the configured peakProfitNotReachedPct.
 *      Regression test for Phase 54.1 absoluteMaxHoldHours backstop.
 *   4. Engine vs exchange drift — recent reconciliationLogs rows where
 *      orphaned!=0 or unknown!=0. Indicates DB↔exchange divergence.
 *   5. Agent dead weight — agents whose Brier score is high (poor
 *      calibration) AND who are consistently on the losing side of
 *      closed trades.
 *
 * The per-check methods are pure-ish: they take a window and return
 * findings. Composing them in `runFullAudit` makes the whole audit a
 * single tx-style read so reports are internally consistent.
 *
 * Output is markdown rendered by `renderAuditMarkdown` for human
 * readability + a "for Claude" section that names files and proposes
 * fixes.
 */

import { sql, desc, asc, eq, and, gte, lte, inArray, isNotNull, isNull } from 'drizzle-orm';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  proposedFix?: string;
  files?: string[];
  data?: unknown;
}

export interface AuditSummary {
  windowHours: number;
  generatedAt: string;       // ISO
  windowStart: string;       // ISO
  windowEnd: string;         // ISO
  decisionsTotal: number;
  decisionsExecuted: number;
  decisionsSkipped: number;
  decisionsVetoed: number;
  tradesClosed: number;
  tradesProfitable: number;
  openPositions: number;
  highCostMisses: number;
  suboptimalExits: number;
  stuckPositions: number;
  engineDriftEvents: number;
  agentDeadWeight: number;
}

export interface AuditReport {
  summary: AuditSummary;
  findings: Finding[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export class TradingQualityAuditor {
  constructor(
    private readonly db: any,
    private readonly schema: any,
    private readonly windowHours: number = 24,
  ) {}

  async runFullAudit(): Promise<AuditReport> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - this.windowHours * 3600_000);

    const findings: Finding[] = [];

    // Run checks in parallel where there are no shared mutations. Each query
    // is read-only against a different slice; collisions are not possible.
    const [missed, exits, stuck, drift, deadweight, summary] = await Promise.all([
      this.checkMissedEntries(windowStart, windowEnd),
      this.checkSuboptimalExits(windowStart, windowEnd),
      this.checkStuckPositions(),
      this.checkEngineDrift(windowStart, windowEnd),
      this.checkAgentDeadWeight(windowStart, windowEnd),
      this.computeBaseSummary(windowStart, windowEnd),
    ]);

    // Phase 59 — additional check: "EXECUTED" decisions that didn't actually
    // open a position. Found in first audit run: 7590 decisions logged as
    // EXECUTED in 24h but only ~9 actual trades on exchange. The mismatch
    // means tradeDecisionLogs.decision is being written before the executor
    // gate, so most rejections look like "executions" in this table.
    const executedNoPos = await this.checkExecutedWithoutPosition(windowStart, windowEnd);

    findings.push(...missed, ...exits, ...stuck, ...drift, ...deadweight, ...executedNoPos);

    findings.sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );

    // Count only actionable findings (skip info-level) for the summary so the
    // header reflects real issues rather than noise.
    const actionable = (xs: Finding[]) => xs.filter((f) => f.severity !== 'info').length;

    return {
      summary: {
        ...summary,
        windowHours: this.windowHours,
        generatedAt: new Date().toISOString(),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        highCostMisses: actionable(missed),
        suboptimalExits: actionable(exits),
        stuckPositions: actionable(stuck),
        engineDriftEvents: actionable(drift),
        agentDeadWeight: actionable(deadweight),
      },
      findings,
    };
  }

  /**
   * Check 6 (added in first audit run) — decisions labeled EXECUTED that
   * didn't actually result in a position. tradeDecisionLogs.positionId is
   * populated by EnhancedTradeExecutor only when a trade really opens, so
   * EXECUTED + positionId IS NULL = silent rejection downstream of consensus.
   */
  private async checkExecutedWithoutPosition(start: Date, end: Date): Promise<Finding[]> {
    const { tradeDecisionLogs } = this.schema;
    const rows = await this.db
      .select({
        decision: tradeDecisionLogs.decision,
        positionId: tradeDecisionLogs.positionId,
        decisionReason: tradeDecisionLogs.decisionReason,
      })
      .from(tradeDecisionLogs)
      .where(
        and(
          eq(tradeDecisionLogs.decision, 'EXECUTED'),
          gte(tradeDecisionLogs.timestamp, start),
          lte(tradeDecisionLogs.timestamp, end),
        ),
      );
    const total = rows.length;
    const orphans = rows.filter((r: any) => r.positionId == null);
    if (total === 0) return [];
    const ratio = orphans.length / total;
    if (ratio < 0.10) return [{
      severity: 'info',
      category: 'decision-labeling',
      title: `EXECUTED decisions ${(ratio * 100).toFixed(1)}% orphaned (acceptable)`,
      detail: `${orphans.length}/${total} EXECUTED decisions have null positionId.`,
    }];
    // Aggregate orphan reasons
    const byReason = new Map<string, number>();
    for (const r of orphans) {
      const k = (r.decisionReason ?? '(none)').slice(0, 80);
      byReason.set(k, (byReason.get(k) ?? 0) + 1);
    }
    const top = Array.from(byReason.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return [{
      severity: ratio > 0.95 ? 'critical' : ratio > 0.50 ? 'high' : 'medium',
      category: 'decision-labeling',
      title: `${(ratio * 100).toFixed(1)}% of "EXECUTED" decisions never opened a position`,
      detail:
        `${orphans.length}/${total} tradeDecisionLogs rows have decision='EXECUTED' but positionId is null. ` +
        `Either the decision is being written too eagerly (before the executor's gates), or the executor is failing silently. ` +
        `Top decisionReason values among orphans:\n` +
        top.map(([r, n]) => `  • ${r}: ${n}`).join('\n'),
      proposedFix:
        `Trace where tradeDecisionLogs.insert is called. If it runs before EnhancedTradeExecutor.executeTrade returns success, ` +
        `move it to the success path OR add a separate enum value (e.g. "APPROVED_NOT_EXECUTED") so the audit trail is honest. ` +
        `Until then, this table can't be used to measure actual execution rate.`,
      files: [
        'server/services/TradeDecisionLogger.ts',
        'server/services/EnhancedTradeExecutor.ts',
      ],
    }];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 1 — Missed entries
  // ──────────────────────────────────────────────────────────────────────
  private async checkMissedEntries(start: Date, end: Date): Promise<Finding[]> {
    const { tradeDecisionLogs, ticks } = this.schema;

    // SKIPPED or VETOED decisions in window
    const skipped = await this.db
      .select()
      .from(tradeDecisionLogs)
      .where(
        and(
          inArray(tradeDecisionLogs.decision, ['SKIPPED', 'VETOED']),
          gte(tradeDecisionLogs.timestamp, start),
          lte(tradeDecisionLogs.timestamp, end),
        ),
      )
      .orderBy(desc(tradeDecisionLogs.timestamp))
      .limit(500);

    if (skipped.length === 0) {
      return [{
        severity: 'info',
        category: 'entry-quality',
        title: 'No skipped/vetoed signals in window',
        detail: `Zero SKIPPED/VETOED decisions in the last ${this.windowHours}h. Either the strategy approved everything (unusual — investigate) or there were no signal opportunities.`,
      }];
    }

    const findings: Finding[] = [];
    let highCostCount = 0;
    const reasonBuckets = new Map<string, { count: number; totalMissed: number }>();

    for (const dec of skipped) {
      const decisionPrice = parseFloat(dec.price ?? '0');
      if (decisionPrice <= 0) continue;
      const sigType: string = dec.signalType;
      // Look at next 15 min of ticks for the symbol.
      const decTimeMs = new Date(dec.timestamp).getTime();
      const lookForwardMs = 15 * 60 * 1000;

      const futureTicks = await this.db
        .select({ price: ticks.price, ts: ticks.timestampMs })
        .from(ticks)
        .where(
          and(
            eq(ticks.symbol, dec.symbol),
            gte(ticks.timestampMs, decTimeMs),
            lte(ticks.timestampMs, decTimeMs + lookForwardMs),
          ),
        )
        .orderBy(asc(ticks.timestampMs))
        .limit(1000);

      if (futureTicks.length < 5) continue; // insufficient data

      const futurePrices = futureTicks.map((t: any) => parseFloat(t.price));
      const peak = sigType === 'BUY' ? Math.max(...futurePrices) : Math.min(...futurePrices);
      const movePercent = sigType === 'BUY'
        ? ((peak - decisionPrice) / decisionPrice) * 100
        : ((decisionPrice - peak) / decisionPrice) * 100;

      const reasonKey = (dec.decisionReason ?? '(no reason)').slice(0, 80);
      const bucket = reasonBuckets.get(reasonKey) ?? { count: 0, totalMissed: 0 };
      bucket.count += 1;
      if (movePercent > 0) bucket.totalMissed += movePercent;
      reasonBuckets.set(reasonKey, bucket);

      // ≥0.5% move in our direction = high-cost miss
      if (movePercent >= 0.5) {
        highCostCount += 1;
        if (highCostCount <= 8) {
          // Don't flood the report — list top 8 specific misses
          findings.push({
            severity: movePercent >= 1.0 ? 'high' : 'medium',
            category: 'missed-entry',
            title: `Missed ${dec.symbol} ${sigType} — would have moved +${movePercent.toFixed(2)}% in 15min`,
            detail:
              `Decision at ${new Date(dec.timestamp).toISOString()} on ${dec.symbol}. ` +
              `Confidence=${dec.totalConfidence}/${dec.threshold}, decision=${dec.decision}, ` +
              `signalType=${sigType}, decisionPrice=$${decisionPrice}. ` +
              `Reason: ${dec.decisionReason ?? '(none)'}. ` +
              `Subsequent 15-min ${sigType === 'BUY' ? 'high' : 'low'}: $${peak.toFixed(2)} (+${movePercent.toFixed(2)}% favorable).`,
            data: {
              signalId: dec.signalId,
              symbol: dec.symbol,
              decision: dec.decision,
              decisionReason: dec.decisionReason,
              decisionPrice,
              peak,
              movePercent,
            },
          });
        }
      }
    }

    // Aggregate finding: most-frequent rejection reasons sorted by total missed move
    const sortedReasons = Array.from(reasonBuckets.entries())
      .sort((a, b) => b[1].totalMissed - a[1].totalMissed)
      .slice(0, 6);
    if (sortedReasons.length > 0 && highCostCount > 0) {
      findings.push({
        severity: highCostCount > 10 ? 'critical' : highCostCount > 5 ? 'high' : 'medium',
        category: 'missed-entry-aggregate',
        title: `${highCostCount} high-cost misses across ${sortedReasons.length} rejection reasons`,
        detail:
          `Top rejection reasons by total missed move (15-min lookforward, signals that moved ≥0.5% favorable):\n` +
          sortedReasons
            .map(([r, b]) => `  • ${r}: ${b.count} skips, sum of favorable moves = ${b.totalMissed.toFixed(2)}%`)
            .join('\n'),
        proposedFix:
          `Audit the top reason. If it's "R:R below 1.5", consider regime-aware R:R floor. ` +
          `If "duplicate-blocked", consider scaling into existing positions. If "consensus-too-low", check ` +
          `whether the threshold is calibrated for current volatility.`,
        files: [
          'server/services/EnhancedTradeExecutor.ts',
          'server/config/TradingConfig.ts',
        ],
      });
    }

    return findings;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 2 — Suboptimal exits
  // ──────────────────────────────────────────────────────────────────────
  private async checkSuboptimalExits(start: Date, end: Date): Promise<Finding[]> {
    const { paperTrades, paperPositions, ticks } = this.schema;

    // Pull closed positions in window. paperTrades has the buy/sell rows but
    // we need the position-level exit info; closed positions in paperPositions
    // are richer (entryPrice, exitPrice, exitTime, exitReason, side, qty).
    const closed = await this.db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.status, 'closed'),
          gte(paperPositions.exitTime, start),
          lte(paperPositions.exitTime, end),
        ),
      )
      .orderBy(desc(paperPositions.exitTime))
      .limit(500);

    if (closed.length === 0) {
      return [{
        severity: 'info',
        category: 'exit-quality',
        title: 'No closed trades in window',
        detail: `Zero closed positions in the last ${this.windowHours}h.`,
      }];
    }

    const findings: Finding[] = [];
    const reasonBuckets = new Map<
      string,
      { count: number; suboptimalCount: number; totalLeftOnTable: number }
    >();
    let suboptimalDetailedCount = 0;

    for (const t of closed) {
      const exitPrice = parseFloat(t.exitPrice ?? '0');
      const side = t.side as 'long' | 'short';
      if (exitPrice <= 0 || !t.exitTime) continue;

      const exitMs = new Date(t.exitTime).getTime();
      const lookForwardMs = 15 * 60 * 1000;

      const futureTicks = await this.db
        .select({ price: ticks.price, ts: ticks.timestampMs })
        .from(ticks)
        .where(
          and(
            eq(ticks.symbol, t.symbol),
            gte(ticks.timestampMs, exitMs),
            lte(ticks.timestampMs, exitMs + lookForwardMs),
          ),
        )
        .orderBy(asc(ticks.timestampMs))
        .limit(1000);

      if (futureTicks.length < 5) continue;

      const futurePrices = futureTicks.map((x: any) => parseFloat(x.price));
      const extreme = side === 'long' ? Math.max(...futurePrices) : Math.min(...futurePrices);
      // "leftOnTable" = how much further the trade would have gone after exit,
      // signed positive if we exited too early.
      const leftOnTablePercent = side === 'long'
        ? ((extreme - exitPrice) / exitPrice) * 100
        : ((exitPrice - extreme) / exitPrice) * 100;

      const reasonKey = (t.exitReason ?? '(no reason)').slice(0, 60);
      const bucket = reasonBuckets.get(reasonKey) ?? { count: 0, suboptimalCount: 0, totalLeftOnTable: 0 };
      bucket.count += 1;
      if (leftOnTablePercent >= 0.5) {
        bucket.suboptimalCount += 1;
        bucket.totalLeftOnTable += leftOnTablePercent;
      }
      reasonBuckets.set(reasonKey, bucket);

      if (leftOnTablePercent >= 0.5 && suboptimalDetailedCount < 8) {
        suboptimalDetailedCount += 1;
        const positionPnlPct = parseFloat(t.realizedPnl ?? '0') /
          (parseFloat(t.entryPrice ?? '1') * parseFloat(t.quantity ?? '1')) * 100;
        findings.push({
          severity: leftOnTablePercent >= 1.5 ? 'high' : 'medium',
          category: 'suboptimal-exit',
          title: `${t.symbol} ${side} closed too early — left +${leftOnTablePercent.toFixed(2)}% on the table`,
          detail:
            `Position ${t.id} exited at $${exitPrice} on ${new Date(t.exitTime).toISOString()} ` +
            `with realized PnL ${positionPnlPct.toFixed(3)}%. ` +
            `Exit reason: ${t.exitReason}. ` +
            `Within 15 min after exit, ${side === 'long' ? 'high' : 'low'} reached $${extreme.toFixed(2)} ` +
            `(+${leftOnTablePercent.toFixed(2)}% favorable beyond exit).`,
          data: { positionId: t.id, exitReason: t.exitReason, leftOnTablePercent, exitPrice, extreme },
        });
      }
    }

    // Aggregate finding: which exit rule leaks the most upside?
    const ranked = Array.from(reasonBuckets.entries())
      .filter(([, b]) => b.suboptimalCount > 0)
      .sort((a, b) => b[1].totalLeftOnTable - a[1].totalLeftOnTable);
    if (ranked.length > 0) {
      const [worstRule, worstStats] = ranked[0];
      const ratio = worstStats.suboptimalCount / Math.max(worstStats.count, 1);
      const sev: Severity = ratio >= 0.6 && worstStats.suboptimalCount >= 5 ? 'high'
        : ratio >= 0.4 ? 'medium' : 'low';
      findings.push({
        severity: sev,
        category: 'suboptimal-exit-aggregate',
        title: `Exit rule "${worstRule}" exits early ${(ratio * 100).toFixed(0)}% of the time`,
        detail:
          `By total upside left on table over ${this.windowHours}h:\n` +
          ranked
            .slice(0, 6)
            .map(([r, b]) => `  • ${r}: ${b.suboptimalCount}/${b.count} suboptimal, sum +${b.totalLeftOnTable.toFixed(2)}%`)
            .join('\n'),
        proposedFix:
          `If a single rule dominates (e.g. "max_winner_time" or "trailing_stop_hit"), consider widening its ` +
          `parameter for the affected regime, or add an upside-confirmation gate (don't exit unless price ` +
          `also reverses ≥0.2% from peak).`,
        files: [
          'server/services/PriorityExitManager.ts',
          'server/services/IntelligentExitManager.ts',
          'server/config/TradingConfig.ts',
        ],
      });
    }

    return findings;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 3 — Stuck positions
  // ──────────────────────────────────────────────────────────────────────
  private async checkStuckPositions(): Promise<Finding[]> {
    const { paperPositions } = this.schema;

    const open = await this.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.status, 'open'))
      .orderBy(asc(paperPositions.entryTime))
      .limit(200);

    const findings: Finding[] = [];
    const now = Date.now();
    for (const p of open) {
      const ageMin = (now - new Date(p.entryTime).getTime()) / 60_000;
      if (ageMin < 120) continue; // <2h is normal
      const upnlPct = parseFloat(p.unrealizedPnLPercent ?? '0');
      const sev: Severity =
        ageMin >= 480 && Math.abs(upnlPct) < 0.20 ? 'high' :    // >8h flat → backstop should fire
        ageMin >= 240 && Math.abs(upnlPct) < 0.20 ? 'medium' :
        ageMin >= 120 && Math.abs(upnlPct) < 0.20 ? 'low' :
        'info';
      findings.push({
        severity: sev,
        category: 'stuck-position',
        title: `${p.symbol} ${p.side} open ${(ageMin / 60).toFixed(1)}h, uPnL ${upnlPct.toFixed(3)}%`,
        detail:
          `Position ${p.id} entered at ${new Date(p.entryTime).toISOString()}, ` +
          `entry $${p.entryPrice}, current $${p.currentPrice}, qty ${p.quantity}. ` +
          (sev === 'high'
            ? `Phase 54.1 backstop (absoluteMaxHoldHours=8) should have fired at the 8h mark — verify ProfitLockGuard.shouldAllowClose is being called by the active exit path for this position.`
            : `No action needed unless this hits 8h with flat PnL.`),
        proposedFix: sev === 'high'
          ? `Trace the exit path: PriorityExitManager → IntelligentExitManager → ProfitLockGuard. ` +
            `Verify holdMinutes is correctly populated (Phase 54.1) and absoluteMaxHoldHours=8 is in effect.`
          : undefined,
        files: sev === 'high' ? [
          'server/services/ProfitLockGuard.ts',
          'server/services/PriorityExitManager.ts',
          'server/services/IntelligentExitManager.ts',
        ] : undefined,
        data: { positionId: p.id, ageMin, upnlPct },
      });
    }
    if (findings.length === 0) {
      findings.push({
        severity: 'info',
        category: 'stuck-position',
        title: 'No stuck positions',
        detail: 'All open positions younger than 2h or have meaningful PnL.',
      });
    }
    return findings;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 4 — Engine vs exchange drift
  //
  // The reconciliationLogs table tracks scheduled reconciliation runs but
  // doesn't expose the matched/orphaned/unknown breakdown that RealTradingEngine
  // emits to pm2 logs. Use discrepanciesFound / manualReviewRequired as proxies.
  // ──────────────────────────────────────────────────────────────────────
  private async checkEngineDrift(start: Date, end: Date): Promise<Finding[]> {
    const { reconciliationLogs } = this.schema;

    const recent = await this.db
      .select()
      .from(reconciliationLogs)
      .where(
        and(
          gte(reconciliationLogs.createdAt, start),
          lte(reconciliationLogs.createdAt, end),
        ),
      )
      .orderBy(desc(reconciliationLogs.createdAt))
      .limit(200);

    if (recent.length === 0) {
      return [{
        severity: 'info',
        category: 'engine-drift',
        title: 'No reconciliation events in window',
        detail:
          'reconciliationLogs is empty in window. RealTradingEngine.reconcilePositions runs every 60s and emits to pm2 logs; ' +
          'this table appears to track a different (scheduled MetaAPI-style) reconciliation pipeline. ' +
          'For now, drift detection should be added by parsing pm2 logs or a follow-up DB write from reconcilePositions.',
      }];
    }

    const drifty = recent.filter(
      (r: any) => (r.discrepanciesFound ?? 0) > 0 || (r.manualReviewRequired ?? 0) > 0,
    );

    if (drifty.length === 0) {
      return [{
        severity: 'info',
        category: 'engine-drift',
        title: `Reconciliation clean — ${recent.length} cycles, 0 drift`,
        detail: `All ${recent.length} reconciliation cycles in window had discrepanciesFound=0.`,
      }];
    }

    return [{
      severity: drifty.length > 10 ? 'high' : 'medium',
      category: 'engine-drift',
      title: `${drifty.length} reconciliation cycles flagged discrepancies between DB and exchange`,
      detail:
        `Out of ${recent.length} reconcile cycles, ${drifty.length} reported discrepancies!=0 or manual review needed. ` +
        `Latest: ` +
        drifty
          .slice(0, 5)
          .map((r: any) =>
            `${new Date(r.createdAt).toISOString()} status=${r.status} ` +
            `checked=${r.totalPositionsChecked} discrepancies=${r.discrepanciesFound} ` +
            `autoResolved=${r.autoResolved} manualReview=${r.manualReviewRequired}`,
          )
          .join('; '),
      proposedFix:
        `Inspect positionDiscrepancies table for the latest reconcile run to see specific symbol/qty deltas.`,
      files: [
        'server/execution/RealTradingEngine.ts',
        'server/exchanges/BinanceFuturesAdapter.ts',
      ],
    }];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 5 — Agent dead weight
  //
  // The agentAccuracy table has accuracy + totalTrades + correctTrades but
  // not Brier score. Use accuracy < 0.40 (worse than random) over ≥20 trades
  // as the dead-weight signal. Aggregate across symbols per-agent so one
  // bad symbol doesn't drag the whole agent.
  // ──────────────────────────────────────────────────────────────────────
  private async checkAgentDeadWeight(_start: Date, _end: Date): Promise<Finding[]> {
    const { agentAccuracy } = this.schema;
    const rows = await this.db
      .select()
      .from(agentAccuracy)
      .orderBy(desc(agentAccuracy.totalTrades))
      .limit(500);
    if (rows.length === 0) {
      return [{
        severity: 'info',
        category: 'agent-deadweight',
        title: 'No agent accuracy data',
        detail: 'agentAccuracy table empty — recordTradeOutcome may not be wired or no trades have closed yet.',
      }];
    }
    // Aggregate by agentName across symbols
    const byAgent = new Map<string, { totalTrades: number; correctTrades: number }>();
    for (const r of rows) {
      const name = r.agentName as string;
      const cur = byAgent.get(name) ?? { totalTrades: 0, correctTrades: 0 };
      cur.totalTrades += r.totalTrades ?? 0;
      cur.correctTrades += r.correctTrades ?? 0;
      byAgent.set(name, cur);
    }
    const ranked = Array.from(byAgent.entries())
      .filter(([, s]) => s.totalTrades >= 20)
      .map(([name, s]) => ({
        name,
        totalTrades: s.totalTrades,
        correctTrades: s.correctTrades,
        accuracy: s.correctTrades / s.totalTrades,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);

    if (ranked.length === 0) {
      return [{
        severity: 'info',
        category: 'agent-deadweight',
        title: 'Insufficient agent data',
        detail: `${rows.length} accuracy rows but no agent has ≥20 trades aggregated yet.`,
      }];
    }

    const degraded = ranked.filter((a) => a.accuracy < 0.40);
    if (degraded.length === 0) {
      return [{
        severity: 'info',
        category: 'agent-deadweight',
        title: 'No degraded agents detected',
        detail: `Of ${ranked.length} agents tracked, none have accuracy <40% over ≥20 trades. Worst: ${ranked[0].name} at ${(ranked[0].accuracy * 100).toFixed(1)}%.`,
      }];
    }
    return [{
      severity: degraded.length > 3 ? 'high' : 'medium',
      category: 'agent-deadweight',
      title: `${degraded.length} agents with sub-random accuracy (<40% over ≥20 trades)`,
      detail:
        degraded
          .slice(0, 8)
          .map((a) => `  • ${a.name}: ${(a.accuracy * 100).toFixed(1)}% (${a.correctTrades}/${a.totalTrades})`)
          .join('\n'),
      proposedFix:
        `Sub-random accuracy means signals systematically lose. Options:\n` +
        `  1. Down-weight in AgentWeightManager (auto-calibration should converge — verify recordTradeOutcome is firing)\n` +
        `  2. Disable in TradingConfig if persistently bad across symbols\n` +
        `  3. Check the agent's data freshness — stale inputs produce inverted signals`,
      files: [
        'server/services/AgentWeightManager.ts',
        'server/agents/AgentBase.ts',
      ],
    }];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Summary metrics for the report header
  // ──────────────────────────────────────────────────────────────────────
  private async computeBaseSummary(start: Date, end: Date): Promise<Omit<AuditSummary, 'windowHours' | 'generatedAt' | 'windowStart' | 'windowEnd' | 'highCostMisses' | 'suboptimalExits' | 'stuckPositions' | 'engineDriftEvents' | 'agentDeadWeight'>> {
    const { tradeDecisionLogs, paperPositions } = this.schema;

    const decisions = await this.db
      .select({ decision: tradeDecisionLogs.decision })
      .from(tradeDecisionLogs)
      .where(
        and(
          gte(tradeDecisionLogs.timestamp, start),
          lte(tradeDecisionLogs.timestamp, end),
        ),
      );
    const closed = await this.db
      .select({ pnl: paperPositions.realizedPnl })
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.status, 'closed'),
          gte(paperPositions.exitTime, start),
          lte(paperPositions.exitTime, end),
        ),
      );
    const open = await this.db
      .select({ id: paperPositions.id })
      .from(paperPositions)
      .where(eq(paperPositions.status, 'open'));

    const decisionsExecuted = decisions.filter((d: any) => d.decision === 'EXECUTED').length;
    const decisionsSkipped = decisions.filter((d: any) => d.decision === 'SKIPPED').length;
    const decisionsVetoed = decisions.filter((d: any) => d.decision === 'VETOED').length;
    const tradesProfitable = closed.filter((t: any) => parseFloat(t.pnl ?? '0') > 0).length;
    return {
      decisionsTotal: decisions.length,
      decisionsExecuted,
      decisionsSkipped,
      decisionsVetoed,
      tradesClosed: closed.length,
      tradesProfitable,
      openPositions: open.length,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Markdown renderer
// ──────────────────────────────────────────────────────────────────────
export function renderAuditMarkdown(report: AuditReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# SEER Trading-Quality Audit — ${s.generatedAt}`);
  lines.push('');
  lines.push(`Window: **${s.windowHours}h** (${s.windowStart} → ${s.windowEnd})`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Decisions logged | ${s.decisionsTotal} (executed ${s.decisionsExecuted}, skipped ${s.decisionsSkipped}, vetoed ${s.decisionsVetoed}) |`);
  lines.push(`| Trades closed | ${s.tradesClosed} (${s.tradesProfitable} profitable) |`);
  lines.push(`| Open positions | ${s.openPositions} |`);
  lines.push(`| **High-cost missed entries** | **${s.highCostMisses}** |`);
  lines.push(`| **Suboptimal exits** | **${s.suboptimalExits}** |`);
  lines.push(`| **Stuck positions** | **${s.stuckPositions}** |`);
  lines.push(`| Engine-vs-exchange drift events | ${s.engineDriftEvents} |`);
  lines.push(`| Agent dead-weight findings | ${s.agentDeadWeight} |`);
  lines.push('');

  const bySeverity: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const f of report.findings) bySeverity[f.severity].push(f);

  for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as Severity[]) {
    if (bySeverity[sev].length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${bySeverity[sev].length})`);
    lines.push('');
    for (const [i, f] of bySeverity[sev].entries()) {
      lines.push(`### ${i + 1}. ${f.title}`);
      lines.push(`*Category: \`${f.category}\`*`);
      lines.push('');
      lines.push(f.detail);
      if (f.proposedFix) {
        lines.push('');
        lines.push(`**Proposed fix:** ${f.proposedFix}`);
      }
      if (f.files?.length) {
        lines.push('');
        lines.push(`**Files to inspect:** ${f.files.map((p) => `\`${p}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  // For-Claude footer
  const actionable = report.findings.filter((f) => ['critical', 'high'].includes(f.severity));
  if (actionable.length > 0) {
    lines.push('---');
    lines.push('## For Claude (next session)');
    lines.push('');
    lines.push(
      `${actionable.length} critical/high findings above. Suggested order of investigation:`,
    );
    for (const [i, f] of actionable.entries()) {
      lines.push(`${i + 1}. **${f.title}** — ${f.proposedFix ?? 'no proposed fix yet'}`);
      if (f.files?.length) lines.push(`   files: ${f.files.map((p) => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}
