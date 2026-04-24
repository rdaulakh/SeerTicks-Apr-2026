/**
 * Phase 16 — Consensus-threshold backtest harness.
 *
 * Answers the question that's been blocking the last 3 days of trades:
 *   "If we lowered minConfidence from 0.65, how many more signals would
 *    be approved, and do those extra signals look like real setups?"
 *
 * Uses the `consensusHistory` table (recorded by `recordConsensus` from
 * `utils/ConsensusRecorder.ts`) which already captures the per-agent
 * confidence for every consensus computation — so we can replay any
 * threshold without re-running the agents.
 *
 * The existing gate in `AutomatedSignalProcessor.ts:343-348` is:
 *   consensusEligibleSignals = actionableSignals.filter(
 *     s => s.confidence >= minConfidence
 *   );
 *   if (consensusEligibleSignals.length < 2) REJECT
 *
 * For each candidate threshold T in {0.50, 0.55, 0.60, 0.65, 0.70}:
 *   - Count actionable agents with confidence ≥ T per consensus row
 *   - Approved = rows where that count ≥ 2
 *   - Report: approval rate, delta vs baseline, per-agent filter pass rate
 *
 * Usage:
 *   npm run backtest:consensus                         # default: last 7 days
 *   npm run backtest:consensus -- --days=30            # longer window
 *   npm run backtest:consensus -- --thresholds=0.55,0.60,0.65
 *
 * This is a DECISION-SUPPORT tool, not an auto-tuner. It shows what
 * would change; the operator decides whether the extra trades look like
 * winners or noise.
 */

import { getDb } from '../db';
import { consensusHistory } from '../../drizzle/schema';
import { gte } from 'drizzle-orm';

interface AgentVote {
  agentName: string;
  signal: string; // 'bullish' | 'bearish' | 'neutral'
  confidence: number;
  weight?: number;
}

interface ParsedRow {
  timestamp: Date;
  symbol: string;
  timeframe: string;
  finalSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  agentVotes: AgentVote[];
  /** Actionable = non-neutral signals (same filter `AutomatedSignalProcessor` applies). */
  actionable: AgentVote[];
}

interface ThresholdResult {
  threshold: number;
  totalRows: number;
  approvedRows: number;
  rejectedRows: number;
  approvalRate: number;
  medianEligibleCount: number;
  byAgent: Map<string, { totalSeen: number; passedFilter: number }>;
}

function parseRow(row: typeof consensusHistory.$inferSelect): ParsedRow | null {
  let votes: AgentVote[] = [];
  try {
    if (typeof row.agentVotes === 'string' && row.agentVotes.length > 0) {
      votes = JSON.parse(row.agentVotes);
      if (!Array.isArray(votes)) votes = [];
    }
  } catch {
    return null; // Bad JSON — skip row rather than exploding the sweep.
  }
  const actionable = votes.filter((v) => {
    const s = (v.signal ?? '').toLowerCase();
    return s === 'bullish' || s === 'bearish';
  });
  return {
    timestamp: row.timestamp,
    symbol: row.symbol,
    timeframe: row.timeframe,
    finalSignal: row.finalSignal,
    agentVotes: votes,
    actionable,
  };
}

function evaluateThreshold(
  rows: ParsedRow[],
  threshold: number,
): ThresholdResult {
  const byAgent = new Map<string, { totalSeen: number; passedFilter: number }>();
  let approvedRows = 0;
  const eligibleCounts: number[] = [];

  for (const row of rows) {
    // Only actionable agents go into the filter, matching
    // AutomatedSignalProcessor behavior (neutrals are dropped before the
    // confidence threshold is applied).
    let eligibleInRow = 0;
    for (const vote of row.actionable) {
      const agentName = vote.agentName || 'unknown';
      const bucket = byAgent.get(agentName) ?? {
        totalSeen: 0,
        passedFilter: 0,
      };
      bucket.totalSeen++;
      if (vote.confidence >= threshold) {
        bucket.passedFilter++;
        eligibleInRow++;
      }
      byAgent.set(agentName, bucket);
    }
    eligibleCounts.push(eligibleInRow);
    if (eligibleInRow >= 2) approvedRows++;
  }

  eligibleCounts.sort((a, b) => a - b);
  const medianEligibleCount =
    eligibleCounts.length > 0
      ? eligibleCounts[Math.floor(eligibleCounts.length / 2)]
      : 0;

  const rejectedRows = rows.length - approvedRows;
  return {
    threshold,
    totalRows: rows.length,
    approvedRows,
    rejectedRows,
    approvalRate: rows.length > 0 ? approvedRows / rows.length : 0,
    medianEligibleCount,
    byAgent,
  };
}

function parseArgs(argv: readonly string[]): {
  days: number;
  thresholds: number[];
} {
  const args = argv.slice(2);
  let days = 7;
  let thresholds = [0.5, 0.55, 0.6, 0.65, 0.7];
  for (const a of args) {
    const m = /^--days=(\d+)$/.exec(a);
    if (m) days = parseInt(m[1], 10);
    const t = /^--thresholds=([\d.,]+)$/.exec(a);
    if (t) {
      const parsed = t[1]
        .split(',')
        .map((v) => parseFloat(v.trim()))
        .filter((v) => !Number.isNaN(v) && v > 0 && v < 1);
      if (parsed.length > 0) thresholds = parsed;
    }
  }
  return { days, thresholds };
}

async function main(argv: readonly string[] = process.argv): Promise<void> {
  const { days, thresholds } = parseArgs(argv);
  console.log(
    `[consensus-backtest] Sweeping last ${days} days across thresholds: ${thresholds.join(', ')}`,
  );

  const db = await getDb();
  if (!db) {
    console.error('[consensus-backtest] Database unavailable — cannot sweep.');
    process.exit(1);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const raw = await db
    .select()
    .from(consensusHistory)
    .where(gte(consensusHistory.timestamp, since));

  const rows = raw.map(parseRow).filter((r): r is ParsedRow => r !== null);
  console.log(
    `[consensus-backtest] Pulled ${raw.length} rows, ${rows.length} parseable. Evaluating...`,
  );

  if (rows.length === 0) {
    console.log(
      `[consensus-backtest] No parseable rows in window. The engine may not ` +
        `have run consensus computations in the last ${days} days, or agentVotes ` +
        `JSON is empty. Nothing to sweep.`,
    );
    process.exit(0);
  }

  const results = thresholds.map((t) => evaluateThreshold(rows, t));

  // ─── Summary table ──────────────────────────────────────────────────
  console.log('\n== THRESHOLD SWEEP ==');
  console.log(
    'threshold |  approved |  rejected | approval% | median elig/row',
  );
  console.log('----------+-----------+-----------+-----------+-----------------');
  for (const r of results) {
    console.log(
      `   ${r.threshold.toFixed(2)}   | ` +
        `${String(r.approvedRows).padStart(9)} | ` +
        `${String(r.rejectedRows).padStart(9)} | ` +
        `${(r.approvalRate * 100).toFixed(2).padStart(8)}% | ` +
        `${r.medianEligibleCount}`,
    );
  }

  // ─── Per-agent filter pass rate at each threshold ───────────────────
  console.log('\n== AGENT FILTER PASS RATE ==');
  console.log(
    '(how often each agent hits the confidence bar — ' +
      'low pass rate = that agent is the bottleneck)',
  );
  const allAgents = new Set<string>();
  for (const r of results) {
    for (const name of r.byAgent.keys()) allAgents.add(name);
  }
  const sortedAgents = Array.from(allAgents).sort();
  const header = ['agent'.padEnd(28), ...thresholds.map((t) => `@${t.toFixed(2)}`)];
  console.log(header.join(' | '));
  console.log('-'.repeat(header.join(' | ').length));
  for (const agent of sortedAgents) {
    const row: string[] = [agent.padEnd(28)];
    for (const r of results) {
      const b = r.byAgent.get(agent);
      if (!b || b.totalSeen === 0) {
        row.push('  n/a');
      } else {
        row.push(`${((b.passedFilter / b.totalSeen) * 100).toFixed(1)}%`.padStart(6));
      }
    }
    console.log(row.join(' | '));
  }

  // ─── Current-prod baseline identification ───────────────────────────
  const currentThreshold = thresholds.find((t) => Math.abs(t - 0.65) < 1e-9);
  if (currentThreshold !== undefined) {
    const current = results.find((r) => r.threshold === currentThreshold)!;
    console.log(
      `\n== CURRENT PROD (threshold ${currentThreshold.toFixed(2)}) ==`,
    );
    console.log(
      `  approval rate: ${(current.approvalRate * 100).toFixed(2)}% ` +
        `(${current.approvedRows}/${current.totalRows})`,
    );
  }

  // ─── Suggestion ─────────────────────────────────────────────────────
  const sorted = [...results].sort((a, b) => b.approvalRate - a.approvalRate);
  console.log(
    `\n== TOP APPROVAL RATE ==\n  ` +
      sorted
        .slice(0, 3)
        .map(
          (r) =>
            `threshold=${r.threshold.toFixed(2)} → ${(r.approvalRate * 100).toFixed(2)}% (${r.approvedRows}/${r.totalRows} approved)`,
        )
        .join('\n  '),
  );
  console.log(
    '\nNOTE: higher approval rate ≠ better. This tool answers "would more ' +
      'trades happen?" not "would those trades win?". Pair with the agent ' +
      'pass-rate table above to identify bottleneck agents, and use real ' +
      'paper-trade outcomes to validate before changing the live threshold.',
  );
}

// Allow both `tsx` script execution and programmatic import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[consensus-backtest] fatal:', err);
    process.exit(1);
  });
}

export { main, parseRow, evaluateThreshold, parseArgs };
