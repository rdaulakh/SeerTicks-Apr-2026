/**
 * TraderBrain — Phase 83
 *
 * The single decision-maker. Replaces the parliament of 10 competing exit
 * rules + ProfitLockGuard arbitration with one deterministic pipeline that
 * reads the Sensorium (in-memory sensor snapshot) and outputs ONE action
 * per tick per position.
 *
 * Pipeline (in order — first to fire wins):
 *
 *   1. HARD-STOP-FIRST
 *      Price has crossed position.stopLoss → exit_full immediately.
 *      Ratchet has been moving stopLoss up; hitting it = realised profit lock.
 *
 *   2. PROFIT-RATCHET
 *      Compute peak_pnl. If a higher rung activates, tighten the stop UP.
 *      Next tick's step 1 will hard-stop if price retraces to the new level.
 *
 *   3. CONSENSUS-FLIP
 *      drift = (entry_consensus_strength) − (current_consensus_for_entry_side)
 *      If consensus has flipped against the position with meaningful conviction
 *      AND the position is in profit → exit_full (urgency: now).
 *
 *   4. MOMENTUM-CRASH
 *      If 5s momentum has flipped against position direction AND position is in
 *      profit → exit_full (urgency: now). Catches the "move is dying" moment
 *      before the trailing stop retraces.
 *
 *   5. PROFIT-TARGET
 *      If gross PnL has hit adaptive target AND momentum decelerating →
 *      take_partial(50%). Adaptive target = max(static, peak - regime_atr × 1.5).
 *
 *   6. STALE-NO-PROGRESS
 *      Held > 30 min, peak_pnl < +0.30%, consensus hasn't strengthened →
 *      exit_full. Free the capital slot.
 *
 *   7. HOLD (default)
 *      Trace the tick so we can see what the brain saw.
 *
 * Mode: dryRun=true on launch. Brain decides + records, but does NOT execute.
 * Compares its decision side-by-side with the live IEM action via DecisionTrace
 * so we can validate before cutover.
 */

import { getSensorium, type PositionSensation, type StanceSensation } from './Sensorium';
import { getDecisionTrace } from './DecisionTrace';
import { getBrainExecutor } from './BrainExecutor';
import { applyRatchet, type RatchetPosition } from '../services/ProfitRatchet';
import { engineLogger as logger } from '../utils/logger';

export type BrainAction =
  | { kind: 'hold'; pipelineStep: string; reason: string }
  | { kind: 'tighten_stop'; pipelineStep: string; reason: string; newStopLoss: number }
  | { kind: 'take_partial'; pipelineStep: string; reason: string; exitQuantityPercent: number; urgency: 'now' | 'soon' }
  | { kind: 'exit_full'; pipelineStep: string; reason: string; urgency: 'now' | 'soon' }
  // Phase 84 — entry brain
  | { kind: 'enter_long'; pipelineStep: string; reason: string; symbol: string; size: number; stopLoss: number; takeProfit: number; opportunityScore: number; brainConfidence: number }
  | { kind: 'enter_short'; pipelineStep: string; reason: string; symbol: string; size: number; stopLoss: number; takeProfit: number; opportunityScore: number; brainConfidence: number }
  | { kind: 'abstain'; pipelineStep: string; reason: string; symbol: string };

export interface BrainConfig {
  dryRun: boolean;
  consensusFlipThreshold: number;     // drift magnitude to fire flip exit (default 0.30)
  momentumCrashBpsPerS: number;        // momentum flip rate to trigger (default 0.5)
  staleHoldMinutes: number;             // (default 30)
  stalePeakPnlPct: number;              // (default 0.30)
  adaptiveTargetAtrMult: number;        // (default 1.5)
  // Phase 84 — entry brain
  minOpportunityScore: number;         // 0..1; gate for SHOULD_ENTER (default 0.55)
  minConfluenceCount: number;          // sensors that must agree to enter (default 3)
  /** Default size per entry as fraction of wallet equity (default 0.10 = 10%). */
  entrySizeEquityFraction: number;
  /** Kelly fraction applied on top (default 0.25 = quarter-Kelly). */
  kellyFraction: number;
  /** Default stop / TP distances if Sensorium ATR is unavailable. */
  defaultStopLossPercent: number;       // -1.2 (negative is loss side)
  defaultTakeProfitPercent: number;     // 1.0
  /** Symbols the brain may consider for entry. */
  candidateSymbols: string[];
  /** Phase 93.16 — milliseconds between consecutive entries on the same symbol.
   *  Default 30 min (1_800_000 ms). Tunable via systemConfig brain.entryCooldownMs. */
  entryCooldownMs?: number;
  /** Phase 93.17 — minimum hold minutes before brain-initiated discretionary
   *  exits fire. Hard-stop still fires immediately (it's the safety floor).
   *  Default 5 min. Tunable via systemConfig brain.minHoldMinutes. */
  minHoldMinutes?: number;
  /** Phase 93.24 — consensus-flip debounce in seconds. Require the opposite
   *  direction to PERSIST for this long before firing consensus_flip exit.
   *  Default 90s. Tunable via systemConfig brain.consensusFlipPersistSec.
   *  Audit on 2026-05-15: brain-opened paper trades exit at consensus_flip
   *  within 5-13 min with $0.06-$0.67 magnitude — the flip fires on
   *  transient opposite-direction conviction that may flip back seconds
   *  later. Debouncing protects against flicker. */
  consensusFlipPersistSec?: number;
}

const DEFAULT_CONFIG: BrainConfig = {
  dryRun: true,
  consensusFlipThreshold: 0.30,
  momentumCrashBpsPerS: 0.5,
  // Phase 93.2 — cut from 30 → 25. Trade-history analysis on 2026-05-13 showed
  // 30-60min hold bucket had win rate 41.2% with avg P&L -$0.51; 5-15min bucket
  // had 66.7% win rate with avg +$1.51. Tighter time exit pushes us toward the
  // profitable bucket and frees slots faster.
  staleHoldMinutes: 25,
  stalePeakPnlPct: 0.30,
  adaptiveTargetAtrMult: 1.5,
  // Phase 86 — calibrated against 33-agent fan-in. Score is count-derived
  // (ratio × presence), so 0.50 ≈ "3+ agents on one side with no real
  // opposition." minConfluenceCount: 2 means at least 2 agents have to
  // actively agree — neutrals are excluded from confluence, so this is
  // robust to high-neutrality conditions.
  minOpportunityScore: 0.50,
  minConfluenceCount: 2,
  entrySizeEquityFraction: 0.10,
  kellyFraction: 0.25,
  defaultStopLossPercent: 1.2,
  defaultTakeProfitPercent: 1.0,
  candidateSymbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
  // Phase 93.24 — 90s debounce on consensus_flip.
  consensusFlipPersistSec: 90,
};

class TraderBrain {
  private config: BrainConfig = DEFAULT_CONFIG;
  private isRunning = false;
  private tickInterval: NodeJS.Timeout | null = null;
  // Phase 93.4 — 10Hz tick (was 1Hz / 1000ms). User feedback 2026-05-13:
  // "2 seconds is huge in live trading; as a machine you should react in
  // milliseconds, not human-reflex time." Tick reduced 1000ms → 100ms.
  //
  // Per-tick work is light (~1-3ms across 3 positions on current hardware),
  // so 100ms cadence stays under 3% CPU. DB write rate is protected by
  // DecisionTrace.record() throttling (hold decisions only emit every
  // HOLD_TRACE_GAP_MS unless the reason text changes).
  //
  // For sub-100ms hard-stop reactivity, a follow-up will add price-event
  // subscriptions so price ticks that cross a stop level fire an immediate
  // exit without waiting for the next 100ms tick.
  private readonly TICK_MS = 100;
  private tickCount = 0;
  private startedAtMs = 0;
  // Phase 93.4 — per-position last-trace memo. Throttles repeated decisions.
  // Keyed on (kind, pipelineStep) — NOT on free-form reason text, because
  // 'hold' reasons include volatile fields (pnl%, hold-minutes) that change
  // every tick and would bypass the throttle. A different kind or step ALWAYS
  // writes; same kind+step writes at most once per HOLD_TRACE_GAP_MS.
  private lastTrace = new Map<string | number, { kindStep: string; atMs: number }>();
  private readonly HOLD_TRACE_GAP_MS = 2000;
  // Phase 87 — wall-clock timestamp of the last tick() entry; used for the
  // operator console's "last tick X ms ago" heartbeat indicator.
  private lastTickAtMs: number | null = null;
  /**
   * 60-second safety warm-up after start(). During this window the brain
   * runs ticks + records to brainDecisions but does NOT execute, even if
   * dryRun=false. Gives sensors time to populate (technical+flow poll
   * every 5s; we want 12+ readings before acting on them).
   */
  private readonly WARMUP_MS = 60_000;
  /**
   * Per-tick lock to prevent the same position being acted on twice while
   * an exit is in flight. Cleared after the executor returns.
   */
  private inFlightExits = new Set<string | number>();
  /** Phase 93.24 — when consensus first appears to have flipped on a
   *  position, record the timestamp. The consensus_flip exit only fires
   *  if the flip persists for `consensusFlipPersistSec` seconds. Cleared
   *  any tick where the flip condition is NOT met (so transient flips
   *  reset the timer rather than accumulating). */
  private flipDetectStartMs = new Map<string | number, number>();
  /**
   * The live IEM's last action per position, fed in via setLiveIEMAction().
   * Used in dryRun mode for side-by-side comparison.
   */
  private liveIEMActions = new Map<string | number, string>();

  configure(cfg: Partial<BrainConfig>): void {
    this.config = { ...this.config, ...cfg };
    logger.info('[TraderBrain] configured', { config: this.config });
  }

  start(): void {
    if (this.isRunning) return;
    // Phase 86 — hydrate config from systemConfig BEFORE the loop fires so
    // operator-applied tuning (via setBrainConfig tRPC mutation) survives
    // server restarts. Boot-time hydration is fire-and-forget; if it fails
    // we fall back to the in-memory defaults.
    this.hydrateConfigFromDb()
      .then((overrides) => {
        if (Object.keys(overrides).length > 0) {
          logger.info(`[TraderBrain] 🧠💾 hydrated ${Object.keys(overrides).length} configs from systemConfig: ${Object.keys(overrides).join(', ')}`);
        }
      })
      .catch((err: Error) => logger.warn('[TraderBrain] config hydrate failed (using defaults)', { error: err?.message }));

    this.isRunning = true;
    this.startedAtMs = Date.now();
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);

    // Phase 93.4 — FAST PATH: subscribe to price ticks for sub-100ms hard-stop
    // response. The regular tick (100ms) does the full pipeline (entries, exits,
    // consensus, etc.); this listener does ONLY the hard-stop check (cheap)
    // and fires an immediate exit if breached. Worst-case stop response goes
    // from O(tick) = 100ms to O(price-event) ≈ 0ms.
    const sensorium = getSensorium();
    sensorium.on('market_update', (s: { symbol: string; midPrice?: number; lastPrice?: number }) => {
      if (!this.isRunning) return;
      if (this.config.dryRun) return;
      if ((Date.now() - this.startedAtMs) < this.WARMUP_MS) return;
      this.fastCheckHardStops(s.symbol, s.midPrice ?? s.lastPrice ?? 0).catch(err =>
        logger.warn('[TraderBrain] fastCheck error', { symbol: s.symbol, error: (err as Error)?.message })
      );
    });

    if (this.config.dryRun) {
      logger.info('[TraderBrain] 🧠 STARTED (DRY-RUN — observing only)', { tickMs: this.TICK_MS });
    } else {
      logger.warn(`[TraderBrain] 🧠⚠️  STARTED LIVE — brain has execution authority. ${this.WARMUP_MS / 1000}s warm-up before first action. Fast hard-stop reactor armed (sub-ms response on price events).`);
    }
  }

  /**
   * Phase 93.4 — Fast hard-stop reactor.
   *
   * Runs on EVERY price tick (not just the 10Hz brain tick). Iterates open
   * positions for the symbol and checks ONLY the hard stop level — the rest
   * of the pipeline (consensus, ratchet, time-stop) is deferred to the regular
   * tick where it belongs. If a stop is breached, fires immediate exit.
   *
   * Cheap (~tens of microseconds) so safe to run every tick. Idempotent via
   * the inFlightExits set — a stop crossing won't fire 100 exits while the
   * exchange call is in flight.
   */
  private async fastCheckHardStops(symbol: string, currentPrice: number): Promise<void> {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
    const sensorium = getSensorium();
    for (const positionId of sensorium.getActivePositionIds()) {
      const pos = sensorium.getPosition(positionId)?.sensation;
      if (!pos || pos.symbol !== symbol) continue;
      if (this.inFlightExits.has(positionId)) continue;
      // Hard stop: long breached when price ≤ stop, short breached when price ≥ stop.
      const stop = pos.currentStopLoss;
      if (stop === null || !Number.isFinite(stop) || stop <= 0) continue;
      const breached = pos.side === 'long' ? currentPrice <= stop : currentPrice >= stop;
      if (!breached) continue;
      // Fire immediate exit. Skip the trace+decision plumbing of the regular
      // tick — log directly and route through the executor.
      // Phase 93.10 — set entry cooldown on the symbol BEFORE the exit fires
      // so the brain can't re-enter in the opposite direction in the next
      // tick (the LONG+SHORT-same-symbol bug surfaced via this path too).
      this.inFlightExits.add(positionId);
      this.entryCooldown.set(symbol, Date.now() + this.ENTRY_COOLDOWN_MS);
      logger.warn(`[TraderBrain] ⚡🧠⛔ FAST HARD-STOP ${symbol} ${pos.side} id=${positionId}: price ${currentPrice} ${pos.side === 'long' ? '≤' : '≥'} stop ${stop} — immediate exit`);
      try {
        const { getBrainExecutor } = await import('./BrainExecutor');
        const r = await getBrainExecutor().exitFull(positionId, currentPrice, `fast_hard_stop:${pos.side}@${stop}`);
        if (!r.ok) {
          logger.error(`[TraderBrain] fast hard-stop exit failed for ${positionId}: ${r.error ?? 'unknown'}`);
        }
      } finally {
        this.inFlightExits.delete(positionId);
      }
    }
  }

  /**
   * Phase 86 — read systemConfig 'brain.*' keys and apply them to the
   * in-memory config. Any of these keys override the hardcoded defaults:
   *   brain.minOpportunityScore       (number)
   *   brain.minConfluenceCount        (number)
   *   brain.entrySizeEquityFraction   (number)
   *   brain.kellyFraction             (number)
   *   brain.defaultStopLossPercent    (number)
   *   brain.defaultTakeProfitPercent  (number)
   *   brain.consensusFlipThreshold    (number)
   *   brain.momentumCrashBpsPerS      (number)
   *   brain.staleHoldMinutes          (number)
   *   brain.stalePeakPnlPct           (number)
   *   brain.adaptiveTargetAtrMult     (number)
   */
  private async hydrateConfigFromDb(): Promise<Record<string, number>> {
    const overrides: Record<string, number> = {};
    try {
      const { getDb } = await import('../db');
      const { systemConfig } = await import('../../drizzle/schema');
      const { like } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return overrides;
      const rows = await db.select().from(systemConfig).where(like(systemConfig.configKey, 'brain.%'));
      const tunableKeys = new Set([
        'minOpportunityScore', 'minConfluenceCount', 'entrySizeEquityFraction',
        'kellyFraction', 'defaultStopLossPercent', 'defaultTakeProfitPercent',
        'consensusFlipThreshold', 'momentumCrashBpsPerS', 'staleHoldMinutes',
        'stalePeakPnlPct', 'adaptiveTargetAtrMult',
        'entryCooldownMs', // Phase 93.16 — added so 5s default is tunable from DB.
        'minHoldMinutes',  // Phase 93.17 — min hold time before discretionary exits.
        'consensusFlipPersistSec', // Phase 93.24 — debounce window for consensus_flip exit.
      ]);
      for (const r of rows) {
        const shortKey = r.configKey.replace(/^brain\./, '');
        if (!tunableKeys.has(shortKey)) continue; // skip non-tunable keys (candidateSymbols, liveEntriesEnabled)
        const raw = r.configValue as unknown;
        const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof val === 'number' && Number.isFinite(val)) {
          overrides[shortKey] = val;
        }
      }
      if (Object.keys(overrides).length > 0) {
        this.config = { ...this.config, ...overrides } as BrainConfig;
      }
    } catch { /* swallow — defaults remain */ }
    return overrides;
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.isRunning = false;
    logger.info('[TraderBrain] stopped');
  }

  /** Called by UserTradingSession or IEM to report what the live system just did. */
  setLiveIEMAction(positionId: string | number, action: string): void {
    this.liveIEMActions.set(positionId, action);
  }

  /** Called by UserTradingSession when a position closes — clean up state. */
  forgetPosition(positionId: string | number): void {
    this.liveIEMActions.delete(positionId);
    this.lastTrace.delete(positionId);  // Phase 93.4 — release trace memo too
  }

  // ─── Hot loop ───────────────────────────────────────────────────────
  private tick(): void {
    const start = process.hrtime.bigint();
    this.tickCount++;
    this.lastTickAtMs = Date.now();
    const sensorium = getSensorium();
    const health = sensorium.health();

    // Phase 86 — EMERGENCY STOP check. EngineHeartbeat carries the platform
    // halt state (daily PnL circuit, missing-pulse halt, operator-triggered
    // emergency stop). If halted, brain BLOCKS NEW ENTRIES and switches
    // exits to defensive mode (accelerate losers, hold winners — let the
    // platform's emergency exit handler do the actual closing).
    let emergencyHalted = false;
    let haltReason: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngineHeartbeat } = require('../services/EngineHeartbeat') as typeof import('../services/EngineHeartbeat');
      const hb = getEngineHeartbeat();
      if (hb.isHalted?.()) {
        emergencyHalted = true;
        haltReason = (hb as any).status?.()?.haltReason ?? 'engine_halt';
      }
    } catch { /* heartbeat not initialized — proceed (safer default for boot) */ }

    if (emergencyHalted && this.tickCount % 30 === 0) {
      // Don't spam — log every 30 ticks while halt is active.
      logger.warn(`[TraderBrain] 🧠⛔ EMERGENCY HALT detected (${haltReason}); skipping all new entries; exits continue in defensive mode`);
    }

    if (health.positions === 0 && emergencyHalted) return;
    if (health.positions === 0) return;     // nothing to decide on

    // Iterate every position. We access the underlying Map by symbol lookup —
    // Sensorium exposes positions via getPosition(id), but we also need the
    // full set. For now, since positions are rare (1-10), we expose
    // snapshotForPosition + a helper "active position IDs" via direct map access.
    // (Quick path: scan via the trace cache; for v1 the iteration cost is fine.)
    const inWarmup = !this.config.dryRun && (Date.now() - this.startedAtMs < this.WARMUP_MS);

    // Phase 84 — PORTFOLIO_GUARD: compute once per tick, applies to all positions
    // AND to entry decisions. If tripped, the entry side is BLOCKED and exits on
    // losers may accelerate (handled inside decide()).
    // Phase 86 — emergency halt is an even stronger block on entries.
    const portfolioGuard = this.evaluatePortfolioGuard(sensorium);
    const entriesAllowed = portfolioGuard.allowNewEntries && !emergencyHalted;

    // ─── Entry brain: evaluate symbols WITHOUT an open position ──────────
    // Phase 85 — candidate list is DB-driven (systemConfig 'brain.candidateSymbols')
    // with the configured list as fallback. SensorWiring keeps the cache warm.
    // Phase 86 — entries blocked under emergency halt OR portfolio-guard trip.
    if (entriesAllowed) {
      // Lazy import to avoid circular module init.
      const cachedSyms = (require('./SensorWiring') as typeof import('./SensorWiring')).getCachedCandidateSymbols();
      const symbolList = cachedSyms.length > 0 ? cachedSyms : this.config.candidateSymbols;
      const candidates = sensorium.getSymbolsWithoutPosition(symbolList);
      for (const symbol of candidates) {
        try {
          const entryDecision = this.decideEntry(symbol);
          if (!entryDecision) continue;
          const elapsedUs = Number((process.hrtime.bigint() - start) / 1000n);
          // Phase 93.4 — same throttle as exit path. Abstain decisions repeat
          // identically every tick (e.g. "score 0.25 < 0.5") and would flood
          // the DB at 10Hz. Always write entries; throttle repeated abstains.
          const entryKey = `entry:${symbol}`;
          const entryKindStep = `${entryDecision.kind}|${entryDecision.pipelineStep}`;
          const lastEntry = this.lastTrace.get(entryKey);
          const entryKindStepChanged = !lastEntry || lastEntry.kindStep !== entryKindStep;
          const entryGapElapsed = !lastEntry || (Date.now() - lastEntry.atMs) >= this.HOLD_TRACE_GAP_MS;
          const shouldTraceEntry = entryDecision.kind !== 'abstain' || entryKindStepChanged || entryGapElapsed;
          if (shouldTraceEntry) {
            getDecisionTrace().record({
              positionId: entryKey,
              symbol,
              side: entryDecision.kind === 'enter_long' ? 'long' : entryDecision.kind === 'enter_short' ? 'short' : 'long',
              kind: entryDecision.kind,
              pipelineStep: entryDecision.pipelineStep,
              reason: entryDecision.reason,
              sensoriumSnapshot: this.entrySnapshot(symbol),
              isDryRun: this.config.dryRun || inWarmup,
              latencyUs: elapsedUs,
            });
            this.lastTrace.set(entryKey, { kindStep: entryKindStep, atMs: Date.now() });
          }
          if ((entryDecision.kind === 'enter_long' || entryDecision.kind === 'enter_short')
              && !this.config.dryRun && !inWarmup) {
            const inFlightKey = `entry:${symbol}`;
            if (this.inFlightExits.has(inFlightKey)) continue;
            this.inFlightExits.add(inFlightKey);
            this.executeEntry(entryDecision)
              .catch(err => logger.warn('[TraderBrain] entry execute failed', { symbol, error: err?.message }))
              .finally(() => this.inFlightExits.delete(inFlightKey));
          }
        } catch (err) {
          logger.warn('[TraderBrain] entry-decision error', { symbol, error: (err as Error)?.message });
        }
      }
    }

    // Phase 93.24 — GC the flip-debounce map for positions that have closed
    // so a re-opened position with the same id starts fresh. Sensorium prunes
    // closed positions, so any id in our map that isn't in sensorium's active
    // list is dead.
    if (this.flipDetectStartMs.size > 0) {
      const activeSet = new Set(this.activePositionIds(sensorium).map(String));
      for (const id of this.flipDetectStartMs.keys()) {
        if (!activeSet.has(String(id))) this.flipDetectStartMs.delete(id);
      }
    }

    for (const positionId of this.activePositionIds(sensorium)) {
      try {
        const decision = this.decide(positionId);
        if (!decision) continue;
        const elapsedUs = Number((process.hrtime.bigint() - start) / 1000n);
        const pos = sensorium.getPosition(positionId);
        if (!pos) continue;

        // Phase 93.4 — throttle decision-trace writes. Keyed on (kind,
        // pipelineStep) so volatile P&L numbers in reason text don't defeat
        // the throttle.
        //
        // Phase 93.23 (2026-05-15) — UNIFORM throttle. The old rule
        //   `decision.kind !== 'hold' || kindStepChanged || gapElapsed`
        // short-circuited to ALWAYS trace non-hold decisions. Result: a
        // position past its stop received a `hard_stop` decision on every
        // 10Hz tick because `inFlightExits` prevents the executor from
        // double-firing but doesn't prevent the trace. Audit on 2026-05-15
        // counted 2,702 hard_stop traces in 30 min across ~3 positions
        // (~900 per position). Now non-hold decisions follow the same
        // (kind,step changed OR gap elapsed) rule as holds.
        const kindStep = `${decision.kind}|${decision.pipelineStep}`;
        const last = this.lastTrace.get(positionId);
        const kindStepChanged = !last || last.kindStep !== kindStep;
        const gapElapsed = !last || (Date.now() - last.atMs) >= this.HOLD_TRACE_GAP_MS;
        const shouldTrace = kindStepChanged || gapElapsed;
        if (shouldTrace) {
          getDecisionTrace().record({
            positionId,
            symbol: pos.sensation.symbol,
            side: pos.sensation.side,
            kind: decision.kind,
            pipelineStep: decision.pipelineStep,
            reason: decision.reason,
            urgency: 'urgency' in decision ? decision.urgency : undefined,
            sensoriumSnapshot: sensorium.snapshotForPosition(positionId),
            newStopLoss: decision.kind === 'tighten_stop' ? decision.newStopLoss : null,
            exitQuantityPercent: decision.kind === 'take_partial' ? decision.exitQuantityPercent : null,
            isDryRun: this.config.dryRun || inWarmup,
            liveIEMAction: this.liveIEMActions.get(positionId),
            latencyUs: elapsedUs,
          });
          this.lastTrace.set(positionId, { kindStep, atMs: Date.now() });
        }

        // Phase 83.2 — EXECUTE if live + past warm-up + non-hold + not in-flight.
        if (!this.config.dryRun && !inWarmup && decision.kind !== 'hold') {
          if (this.inFlightExits.has(positionId)) {
            continue; // already acting on this position
          }
          this.inFlightExits.add(positionId);
          this.executeDecision(positionId, pos.sensation, decision)
            .catch(err => logger.warn('[TraderBrain] execute failed', { positionId, error: err?.message }))
            .finally(() => this.inFlightExits.delete(positionId));
        }
      } catch (err) {
        logger.warn('[TraderBrain] tick error', { positionId, error: (err as Error)?.message });
      }
    }
  }

  /**
   * Phase 84 — PORTFOLIO_GUARD pre-step. Reads portfolio sensation;
   * returns whether the brain may consider new entries this tick AND
   * whether existing-position decisions should be biased toward exit.
   */
  private evaluatePortfolioGuard(sensorium: ReturnType<typeof getSensorium>): {
    allowNewEntries: boolean;
    accelerateExits: boolean;
    reason: string;
  } {
    const port = sensorium.getPortfolio();
    if (!port) {
      // No portfolio reading yet — allow entries conservatively, no acceleration
      return { allowNewEntries: true, accelerateExits: false, reason: 'no_portfolio_data' };
    }
    const p = port.sensation;
    if (p.dailyLossCircuitTripped) {
      return { allowNewEntries: false, accelerateExits: true, reason: `daily_loss_circuit_tripped (pnl ${p.dailyPnlPercent.toFixed(2)}%)` };
    }
    if (p.dailyPnlPercent <= -p.limits.maxDailyLossPercent) {
      return { allowNewEntries: false, accelerateExits: true, reason: `daily_loss_limit (${p.dailyPnlPercent.toFixed(2)}% <= -${p.limits.maxDailyLossPercent}%)` };
    }
    if (p.portfolioVarPercent >= p.limits.maxPortfolioVarPercent) {
      return { allowNewEntries: false, accelerateExits: false, reason: `var_ceiling (${p.portfolioVarPercent.toFixed(2)}% >= ${p.limits.maxPortfolioVarPercent}%)` };
    }
    if (p.openPositionCount >= p.limits.maxOpenPositions) {
      return { allowNewEntries: false, accelerateExits: false, reason: `max_positions (${p.openPositionCount}/${p.limits.maxOpenPositions})` };
    }
    return { allowNewEntries: true, accelerateExits: false, reason: 'ok' };
  }

  /**
   * Phase 84 — SHOULD_ENTER pipeline step. Runs once per tick per candidate
   * symbol that has no open position. Reads opportunity + stance + market
   * sensations. Outputs enter_long / enter_short / abstain.
   */
  decideEntry(symbol: string): BrainAction | null {
    const sensorium = getSensorium();
    const opp = sensorium.getOpportunity(symbol)?.sensation;
    const market = sensorium.getMarket(symbol)?.sensation;
    const stance = sensorium.getStance(symbol)?.sensation;
    const port = sensorium.getPortfolio()?.sensation;
    const votes = sensorium.getAgentVotes(symbol)?.sensation;
    const sentiment = sensorium.getSentiment()?.sensation;

    if (!opp || !market) {
      // Insufficient inputs — never enter blind.
      return { kind: 'abstain', pipelineStep: 'should_enter:no_data', reason: 'opportunity or market sensation missing', symbol };
    }

    // Phase 85 — Gate 0: hard veto from any agent (DeterministicFallback
    // or MacroAnalyst macro-event veto). Vetoes are absolute — no consensus
    // strength overrides them.
    if (votes?.anyVetoActive) {
      return { kind: 'abstain', pipelineStep: 'should_enter:veto_active',
        reason: `veto active: ${votes.vetoReasons.slice(0, 2).join(' | ')}`, symbol };
    }
    if (sentiment?.macroVetoActive) {
      return { kind: 'abstain', pipelineStep: 'should_enter:macro_veto',
        reason: `macro veto: ${sentiment.macroVetoReason ?? 'event-window-open'}`, symbol };
    }

    // Phase 89 — Operator pause check. Bulk-action endpoint can set a
    // 'brain.pauseEntriesUntilMs' kill switch in systemConfig. Brain reads
    // the cached value (refreshed by SensorWiring tick) and abstains while
    // active. This is the "stop new entries for 30 min" operator escape.
    const pauseUntilMs = (require('./SensorWiring') as typeof import('./SensorWiring')).getCachedOperatorPauseUntilMs();
    if (pauseUntilMs && Date.now() < pauseUntilMs) {
      const remainingSec = Math.ceil((pauseUntilMs - Date.now()) / 1000);
      return { kind: 'abstain', pipelineStep: 'should_enter:operator_pause',
        reason: `operator paused new entries; resumes in ${remainingSec}s`, symbol };
    }

    // Phase 87 — Alpha library bias. ADD a positive bump when this symbol
    // has active winning patterns; SUBTRACT a small penalty when it has
    // decayed patterns. Effective score gates against this bumped value.
    const alpha = sensorium.getAlpha(symbol)?.sensation;
    let alphaBonus = 0;
    if (alpha && alpha.activePatternCount > 0) {
      // Up to +0.12 bonus for strong proven setups
      // (1.0 win rate × 100 sample size = 0.12; scales sublinearly)
      const sampleConfidence = Math.min(1, alpha.totalTradeSampleSize / 100);
      alphaBonus = alpha.weightedWinRate * sampleConfidence * 0.12;
    }
    if (alpha && alpha.decayedPatternCount > 0) {
      // Up to -0.06 penalty for symbols with multiple decayed setups
      alphaBonus -= Math.min(0.06, alpha.decayedPatternCount * 0.02);
    }
    const effectiveScore = opp.score + alphaBonus;

    // Gate 1: opportunity score (effective = base + alpha bias)
    if (effectiveScore < this.config.minOpportunityScore) {
      return { kind: 'abstain', pipelineStep: 'should_enter:score_low',
        reason: `score ${opp.score.toFixed(2)}${alphaBonus !== 0 ? `${alphaBonus >= 0 ? '+' : ''}${alphaBonus.toFixed(2)}α` : ''} = ${effectiveScore.toFixed(2)} < ${this.config.minOpportunityScore}`, symbol };
    }

    // Gate 2: confluence
    if (opp.confluenceCount < this.config.minConfluenceCount) {
      return { kind: 'abstain', pipelineStep: 'should_enter:thin_confluence',
        reason: `${opp.confluenceCount}/${opp.totalSensors} sensors agree (need ≥${this.config.minConfluenceCount})`, symbol };
    }

    // Gate 3: critical data not stale
    if (opp.criticalDataStale) {
      return { kind: 'abstain', pipelineStep: 'should_enter:stale_data',
        reason: 'a critical sensor is stale', symbol };
    }

    // Gate 4: direction must be definite
    if (opp.direction === 'abstain') {
      return { kind: 'abstain', pipelineStep: 'should_enter:no_direction',
        reason: 'opportunity has no decisive direction', symbol };
    }

    // Gate 5: stance must confirm or be quiet (not actively opposing)
    if (stance && stance.currentConsensus > 0.6 &&
        ((opp.direction === 'long' && stance.currentDirection === 'bearish') ||
         (opp.direction === 'short' && stance.currentDirection === 'bullish'))) {
      return { kind: 'abstain', pipelineStep: 'should_enter:stance_opposes',
        reason: `consensus ${(stance.currentConsensus * 100).toFixed(0)}% ${stance.currentDirection} opposes opportunity ${opp.direction}`, symbol };
    }

    // Phase 93.20 — Gate 6: ANTI-TREND-SHORT BLOCK.
    //
    // 60-trade attribution audit (2026-05-14):
    //   long  side: 48.8% WR, +$1.29 net  (43 trades)
    //   short side: 26.2% WR, -$24.36 net (65 trades)  ← THE BLEED
    //   ETH-USD shorts specifically: 23.5% WR, -$29.04 net (17 trades)
    //
    // The platform is structurally short-biased into an up-trending market
    // and losing on shorts ~3 to 1. Block shorts when the SYMBOL'S OWN
    // technical sensor confirms an uptrend (TechnicalAnalyst's ema trend up
    // AND vwapDevPct > 0.5% above VWAP). This uses TechnicalAnalyst which
    // the attribution audit confirmed has the strongest positive edge
    // (+$12.52 signed P&L, 58% WR when agreed, 96% directional).
    const techEntry = getSensorium().getTechnical(symbol);
    const tech = techEntry?.sensation ?? null;
    // Phase 93.25 — Relaxed anti-trend gate (2-of-3, data-driven 2026-05-15).
    //
    // Forensic audit found short_into_uptrend fired only 33×/24h vs 1,218
    // approved short-entries — most losing shorts (SOL: 45 trades, 76% loss
    // rate) slipped past because the AND-of-3 was too strict. SOL's vwapDev
    // rarely clears the ±0.5% band even when emaTrend=up + superTrend=bullish.
    //
    // New rule: emaTrend confirms the trend, AND either vwapDev (now ±0.25%)
    // OR superTrend confirms it. Catches the slow-grind regimes where price
    // hugs VWAP but EMAs + SuperTrend agree.
    const ANTI_TREND_VWAP_DEV_PCT = 0.25;
    if (opp.direction === 'short' && tech) {
      const vwapConfirms = tech.vwapDevPct > ANTI_TREND_VWAP_DEV_PCT;
      const superTrendConfirms = tech.superTrend === 'bullish';
      const inUptrend = tech.emaTrend === 'up' && (vwapConfirms || superTrendConfirms);
      if (inUptrend) {
        return {
          kind: 'abstain',
          pipelineStep: 'should_enter:short_into_uptrend',
          reason: `short into uptrend (emaTrend=up, vwapDev=${tech.vwapDevPct.toFixed(2)}%, superTrend=${tech.superTrend}) — historically 26% WR / -$24 net`,
          symbol,
        };
      }
    }
    // Symmetric guard for longs into confirmed downtrend (rare in this
    // market but the principle must apply both ways).
    if (opp.direction === 'long' && tech) {
      const vwapConfirms = tech.vwapDevPct < -ANTI_TREND_VWAP_DEV_PCT;
      const superTrendConfirms = tech.superTrend === 'bearish';
      const inDowntrend = tech.emaTrend === 'down' && (vwapConfirms || superTrendConfirms);
      if (inDowntrend) {
        return {
          kind: 'abstain',
          pipelineStep: 'should_enter:long_into_downtrend',
          reason: `long into downtrend (emaTrend=down, vwapDev=${tech.vwapDevPct.toFixed(2)}%, superTrend=${tech.superTrend})`,
          symbol,
        };
      }
    }

    // Phase 93.20 — Gate 7: TechnicalAnalyst direction MUST match opportunity.
    //
    // TechnicalAnalyst is the only high-volume agent with positive edge
    // (+$12.52 signed P&L, 58% WR when agreed, in 96% of decisions). If the
    // brain wants to go long but TechnicalAnalyst says bearish (or vice
    // versa), abstain. This single check, applied retroactively to the
    // 60-trade audit, would have eliminated 32 of 42 losing trades.
    if (tech) {
      const techDir = tech.superTrend === 'bullish' ? 'long'
        : tech.superTrend === 'bearish' ? 'short'
          : tech.emaTrend === 'up' ? 'long'
            : tech.emaTrend === 'down' ? 'short'
              : null;
      if (techDir && techDir !== opp.direction) {
        return {
          kind: 'abstain',
          pipelineStep: 'should_enter:technical_opposes',
          reason: `TechnicalAnalyst direction ${techDir} opposes opportunity ${opp.direction} (rsi=${tech.rsi.toFixed(0)}, ema=${tech.emaTrend}, vwapDev=${tech.vwapDevPct.toFixed(2)}%)`,
          symbol,
        };
      }
    }

    // Phase 93.22 — Gate 8: EXTENSION-EXHAUSTION block.
    // Phase 93.23 (2026-05-15) — tightened after audit caught trade #212
    // entering ETH long at bbPctB=1.11 (above upper band) with only 1 of 3
    // old extension flags hot. Changed to: ANY ONE strong-extension flag
    // OR TWO mild-extension flags. New flag set is also more sensitive to
    // VWAP deviation (the most actionable extension measure in a sustained
    // trend, where Bollinger bands lag and RSI saturates below 70).
    //
    // Long blocked when ANY of:
    //   • bbPctB > 1.05               — above upper Bollinger (was strong)
    //   • rsi > 72                    — approaching overbought (was 75)
    //   • vwapDevPct > 0.8            — >0.8% above VWAP (was 1.0)
    //   • two of {bbPctB>1.0, rsi>68, vwapDevPct>0.5} — mild combination
    //
    // Symmetric for short.
    if (tech) {
      if (opp.direction === 'long') {
        const strongOB =
          tech.bbPctB > 1.05 ||
          tech.rsi > 72 ||
          tech.vwapDevPct > 0.8;
        const mildOB =
          [tech.bbPctB > 1.0, tech.rsi > 68, tech.vwapDevPct > 0.5]
            .filter(Boolean).length >= 2;
        if (strongOB || mildOB) {
          return {
            kind: 'abstain',
            pipelineStep: 'should_enter:long_extension_exhaustion',
            reason: `long at extension exhaustion (rsi=${tech.rsi.toFixed(0)}, bbPctB=${tech.bbPctB.toFixed(2)}, vwapDev=${tech.vwapDevPct.toFixed(2)}%) — strong=${strongOB} mild=${mildOB}`,
            symbol,
          };
        }
      } else if (opp.direction === 'short') {
        const strongOS =
          tech.bbPctB < -0.05 ||
          tech.rsi < 28 ||
          tech.vwapDevPct < -0.8;
        const mildOS =
          [tech.bbPctB < 0.0, tech.rsi < 32, tech.vwapDevPct < -0.5]
            .filter(Boolean).length >= 2;
        if (strongOS || mildOS) {
          return {
            kind: 'abstain',
            pipelineStep: 'should_enter:short_extension_exhaustion',
            reason: `short at extension exhaustion (rsi=${tech.rsi.toFixed(0)}, bbPctB=${tech.bbPctB.toFixed(2)}, vwapDev=${tech.vwapDevPct.toFixed(2)}%) — strong=${strongOS} mild=${mildOS}`,
            symbol,
          };
        }
      }
    }

    // Sizing — Phase 93.3 (confidence-weighted, evolved from 93.2)
    //
    // Combines THREE independent confidence signals into a unified "brain
    // confidence" via geometric mean (so weakness in any one channel
    // pulls size down — no single signal can dominate):
    //
    //   1. effectiveScore  — opportunity sensor strength + alpha library bias
    //   2. stanceStrength  — fraction of agents agreeing with the direction
    //   3. confluenceRatio — fraction of supporting sensors active
    //
    // Pyramid scaling — at high confidence we bet MORE, at low confidence
    // we bet LESS (user-requested in audit 2026-05-13):
    //   confidence 0.50 → 0.375× base = ~3.75% equity ($375 on $10K)
    //   confidence 0.70 → 0.735× base = ~7.35% equity ($735 on $10K)
    //   confidence 0.85 → 1.084× base = ~10.84% equity ($1,084 on $10K)
    //   confidence 1.00 →  1.5× base  =      15% equity ($1,500 on $10K)
    //
    // Stays within risk budget: with 1.2% stop, max-confidence 15% position
    // has VaR = 0.18%, well under the 2%-per-trade cap in TradingConfig.
    //
    // Minimum-notional gate ($50) kills dust entries (historical $16 BTC
    // positions had no chance of overcoming fees + slippage).
    const equity = port?.equity ?? 10_000; // conservative fallback
    const MIN_NOTIONAL_USD = 50;

    const confluenceRatio = opp.totalSensors > 0 ? opp.confluenceCount / opp.totalSensors : 0.3;
    const stanceStrength = stance?.currentConsensus ?? 0.6;
    const brainConfidence = Math.cbrt(
      Math.max(0.1, effectiveScore) *
      Math.max(0.1, stanceStrength) *
      Math.max(0.3, confluenceRatio)
    );
    // Phase 93.18 — REMOVED 0.375 floor. The audit (2026-05-14) found every
    // live entry collapsed to multiplier ≈ 0.375 because the geometric mean
    // rarely exceeds 0.5 and pow(0.5, 2)*1.5 = 0.375. Result: sizing was
    // structurally flat — every trade ~3.75% equity regardless of conviction.
    //
    // New behaviour: the multiplier scales freely from 0 → 1.5. Low-conviction
    // entries can produce sub-min-notional sizes; the MIN_NOTIONAL_USD gate
    // below ($50) drops them, which is the correct outcome (don't bet small
    // size on weak conviction — abstain instead).
    const confidenceMultiplier = Math.min(1.5, Math.pow(brainConfidence, 2) * 1.5);
    const sizeUsd = equity * this.config.entrySizeEquityFraction * confidenceMultiplier;
    const qty = sizeUsd / market.midPrice;

    // Stop / take-profit from market regime ATR or defaults
    const stopPct = this.config.defaultStopLossPercent / 100;
    const tpPct = this.config.defaultTakeProfitPercent / 100;
    const isLong = opp.direction === 'long';
    const stopLoss = market.midPrice * (1 - (isLong ? 1 : -1) * stopPct);
    const takeProfit = market.midPrice * (1 + (isLong ? 1 : -1) * tpPct);

    if (!Number.isFinite(qty) || qty <= 0) {
      return { kind: 'abstain', pipelineStep: 'should_enter:bad_size',
        reason: `computed qty ${qty} invalid (equity ${equity}, mid ${market.midPrice})`, symbol };
    }
    if (sizeUsd < MIN_NOTIONAL_USD) {
      return { kind: 'abstain', pipelineStep: 'should_enter:below_min_notional',
        reason: `size $${sizeUsd.toFixed(2)} below $${MIN_NOTIONAL_USD} minimum (equity ${equity}, score ${opp.score.toFixed(2)})`, symbol };
    }

    return {
      kind: isLong ? 'enter_long' : 'enter_short',
      pipelineStep: 'should_enter:approved',
      reason: `score ${opp.score.toFixed(2)} ${opp.direction}; conf ${(brainConfidence * 100).toFixed(0)}% (opp ${effectiveScore.toFixed(2)}, stance ${(stanceStrength * 100).toFixed(0)}%, confl ${opp.confluenceCount}/${opp.totalSensors}); size $${sizeUsd.toFixed(0)} (${(confidenceMultiplier * 100).toFixed(0)}% of base) (${qty.toFixed(6)} ${symbol})`,
      symbol,
      size: qty,
      stopLoss,
      takeProfit,
      opportunityScore: opp.score,
      // Phase 93.18 — carry through so BrainExecutor can persist as
      // originalConsensus/peakConfidence on the position row (was hardcoded
      // 0.65 default; never updated; confidence-decay exit was running on
      // bogus data).
      brainConfidence,
    };
  }

  /** Snapshot for entry-decision trace (no position id; key on symbol). */
  private entrySnapshot(symbol: string): Record<string, unknown> {
    return getSensorium().snapshotForEntry(symbol);
  }

  /**
   * Phase 86 — per-symbol entry cooldown. After we open a position, the
   * Sensorium's position map doesn't refresh until the next 1s pull. Without
   * this cooldown, the brain re-fires entries on the same symbol every tick
   * until the position sensor catches up, opening N positions in 2-3 seconds.
   */
  private entryCooldown = new Map<string, number>(); // symbol → expiresAt ms
  // Phase 93.16 (loop iter 8, 2026-05-13) — extended 5s → 30 min.
  //
  // Cooldown was originally 5s — designed to prevent same-tick double-fires
  // during the 100ms brain tick. Adequate for THAT purpose but allowed the
  // brain to re-enter on the same symbol every ~5s, producing high-frequency
  // low-edge trades (hold-bucket <5min: 35% WR; <30min: 67 of last 133 trades).
  //
  // Audit on 2026-05-13 over 7 hours of config tuning showed knob-tightening
  // alone can't lift the brain out of the 40-43% WR band. The bottleneck is
  // selection density, not gate threshold: when allowed to re-enter every 5s,
  // the brain picks low-conviction setups because they're statistically the
  // most frequent. A 30-min cooldown forces the brain to wait for its
  // best-of-window setup. Expected effect: trade count drops ~10× (from
  // ~100/24h to ~10-20/24h), per-trade quality rises into the 5-15min
  // hold-bucket regime (72.7% WR historically).
  //
  // Tunable via systemConfig 'brain.entryCooldownMs' (added in this iter).
  private readonly DEFAULT_ENTRY_COOLDOWN_MS = 30 * 60 * 1000;
  private get ENTRY_COOLDOWN_MS(): number {
    return this.config.entryCooldownMs ?? this.DEFAULT_ENTRY_COOLDOWN_MS;
  }

  /** Phase 84 — execute an entry decision via BrainExecutor.
   *  Phase 86 — route to the primary user's wallet via portfolio sensor +
   *  enforce per-symbol cooldown to prevent same-symbol over-firing.
   *  Phase 93.10 — final Sensorium check + same-symbol DB exposure check
   *  to prevent simultaneous LONG+SHORT on the same symbol regardless of
   *  which code path (brain entry, legacy enhanced_automated, hydration)
   *  created the prior position. */
  private async executeEntry(decision: BrainAction): Promise<void> {
    if (decision.kind !== 'enter_long' && decision.kind !== 'enter_short') return;

    const cooldownUntil = this.entryCooldown.get(decision.symbol) ?? 0;
    if (Date.now() < cooldownUntil) {
      // Still cooling down on this symbol — skip silently.
      return;
    }

    // Phase 93.10 — DEFENSE LAYER 1: re-check Sensorium synchronously, just
    // before we call into the executor. decideEntry() ran earlier in the
    // tick loop and the Sensorium state might have flipped (another tick
    // path opened, a hydrate pulled in an exchange position, etc.). If we
    // now see ANY position on this symbol — abstain.
    const sensorium = getSensorium();
    if (sensorium.hasOpenPositionOnSymbol(decision.symbol)) {
      logger.warn(`[TraderBrain] 🧠⛔ entry blocked at execute-time: open position already on ${decision.symbol} (Sensorium guard)`);
      // Set a brief cooldown so we don't spam the log every 100ms tick.
      this.entryCooldown.set(decision.symbol, Date.now() + this.ENTRY_COOLDOWN_MS);
      return;
    }

    // Set the cooldown FIRST (before the async DB call) so concurrent ticks
    // can't race past us. We'll relax it only on failure so we can retry.
    this.entryCooldown.set(decision.symbol, Date.now() + this.ENTRY_COOLDOWN_MS);

    const { getBrainExecutor } = await import('./BrainExecutor');
    const executor = getBrainExecutor();
    const port = getSensorium().getPortfolio()?.sensation;
    const userId = port?.primaryUserId ?? 1;
    const r = await executor.openPosition({
      symbol: decision.symbol,
      side: decision.kind === 'enter_long' ? 'long' : 'short',
      quantity: decision.size,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      reason: decision.reason,
      userId,
      // Phase 93.18 — propagate so the position row carries real consensus,
      // not the legacy 0.65 default.
      entryConsensus: decision.brainConfidence,
    });
    if (!r.ok) {
      // Phase 93.10 — if the executor rejected because an open position
      // already exists, KEEP the cooldown active. Releasing it would cause
      // the next 100ms tick to retry and flood the DB with the same probe.
      if (r.error === 'same_symbol_exposure') {
        // Extend cooldown rather than retry — the position needs to close first.
        this.entryCooldown.set(decision.symbol, Date.now() + this.ENTRY_COOLDOWN_MS);
      } else {
        // Other failures — release so the next tick can retry.
        this.entryCooldown.delete(decision.symbol);
      }
    }
    logger.info(`[TraderBrain] 🧠→ ${decision.kind.toUpperCase()} ${decision.symbol} user=${userId} qty=${decision.size.toFixed(6)} sl=$${decision.stopLoss.toFixed(4)} tp=$${decision.takeProfit.toFixed(4)}: ${r.ok ? 'ok' : 'failed'} reason="${decision.pipelineStep}" ${r.ok ? '' : `(err=${r.error ?? 'unknown'})`}`);
  }

  /**
   * Phase 83.2 — execute a non-hold decision via BrainExecutor.
   * Fire-and-forget from the hot loop; failures recorded to trace.
   *
   * Phase 93.10 — when we EXIT a position, set an entry cooldown on that
   * symbol so the brain doesn't immediately re-enter in the opposite
   * direction before the Sensorium poll (1s cadence) has even noticed the
   * exit. Without this, the SHORT-just-closed-by-consensus-flip pattern
   * fires a LONG on the same symbol within the next 100ms tick → the very
   * "LONG+SHORT simultaneously" bug. Cooldown clears naturally on the next
   * SensorWiring poll seeing 0 open positions on this symbol.
   */
  private async executeDecision(
    positionId: string | number,
    pos: PositionSensation,
    decision: BrainAction,
  ): Promise<void> {
    const executor = getBrainExecutor();
    const symbol = pos.symbol;
    if (decision.kind === 'exit_full') {
      // Set the post-exit entry cooldown FIRST so concurrent ticks can't
      // race past us into a re-entry.
      this.entryCooldown.set(symbol, Date.now() + this.ENTRY_COOLDOWN_MS);
      const r = await executor.exitFull(positionId, pos.currentPrice, decision.reason);
      logger.info(`[TraderBrain] 🧠→ EXIT_FULL ${symbol} id=${positionId}: ${r.ok ? 'ok' : 'failed'} affected=${r.affectedRows} reason="${decision.pipelineStep}"`);
    } else if (decision.kind === 'tighten_stop') {
      const r = await executor.updateStop(positionId, decision.newStopLoss, decision.reason);
      logger.info(`[TraderBrain] 🧠→ TIGHTEN_STOP ${symbol} id=${positionId} → $${decision.newStopLoss.toFixed(4)}: ${r.ok ? 'ok' : 'failed'}`);
    } else if (decision.kind === 'take_partial') {
      // Partial is implemented as full close in v1 — same re-entry-risk applies.
      this.entryCooldown.set(symbol, Date.now() + this.ENTRY_COOLDOWN_MS);
      const r = await executor.exitPartial(positionId, decision.exitQuantityPercent, pos.currentPrice, decision.reason);
      logger.info(`[TraderBrain] 🧠→ TAKE_PARTIAL ${symbol} id=${positionId} (${decision.exitQuantityPercent}%): ${r.ok ? 'ok' : 'failed'}`);
    }
  }

  /**
   * The 7-step pipeline. Returns the FIRST decision that fires, else hold.
   * Pure function over Sensorium — no side effects, no DB.
   */
  decide(positionId: string | number): BrainAction | null {
    const sensorium = getSensorium();
    const posEntry = sensorium.getPosition(positionId);
    if (!posEntry) return null;
    const pos = posEntry.sensation;
    const stance = sensorium.getStance(pos.symbol)?.sensation ?? null;
    const marketEntry = sensorium.getMarket(pos.symbol);
    const market = marketEntry?.sensation ?? null;
    const flow = sensorium.getFlow(pos.symbol)?.sensation ?? null;

    // ─── Phase 87 — DATA-GAP guard ───────────────────────────────────────
    // If market data is stale (>30s) we still need to honor a hard-stop
    // trigger using the last-known price (that's the SAFER call — late stops
    // can wipe accounts), but we should NOT fire discretionary exits
    // (consensus_flip, momentum_crash, stale_no_progress) on stale data
    // because the brain doesn't actually know what the market is doing.
    // We mark it and the gate is enforced inside the discretionary branches.
    const marketStaleMs = marketEntry?.stalenessMs ?? 999_999;
    const isMarketStale = marketStaleMs > 30_000;

    // ─── Step 1: HARD-STOP-FIRST ────────────────────────────────────────
    if (pos.currentStopLoss !== null) {
      const stopHit = pos.side === 'long'
        ? pos.currentPrice <= pos.currentStopLoss
        : pos.currentPrice >= pos.currentStopLoss;
      if (stopHit) {
        return {
          kind: 'exit_full',
          pipelineStep: 'hard_stop',
          reason: `Price ${pos.currentPrice.toFixed(4)} hit stop ${pos.currentStopLoss.toFixed(4)} (${pos.side})`,
          urgency: 'now',
        };
      }
    }

    // ─── Phase 93.17 (loop iter 13) — MIN-HOLD-TIME guard ─────────────
    //
    // Empirical observation across 12 iterations:
    //   Hold-bucket < 5 min:  35% WR (rapid-fire losers)
    //   Hold-bucket 5-15min:  73% WR (sweet spot — best in the system)
    //
    // The brain enters → some signal flickers → brain exits in <5 min.
    // This kills trades before they can resolve. Hard-stop still fires
    // (it's BEFORE this gate). Profit-ratchet, consensus-flip, momentum-
    // crash, profit-target, stale-no-progress, and direction-flip ALL
    // wait until the position has at least 5 minutes of life.
    //
    // Tunable via systemConfig 'brain.minHoldMinutes' (default 5).
    const minHold = (this.config as any).minHoldMinutes ?? 5;
    if (pos.holdMinutes < minHold) {
      return {
        kind: 'hold',
        pipelineStep: 'hold:min_hold_time',
        reason: `Held ${pos.holdMinutes.toFixed(1)}min < ${minHold}min minimum — protect from rushed exits`,
      };
    }

    // ─── Step 2: PROFIT-RATCHET ─────────────────────────────────────────
    if (pos.unrealizedPnlPercent > 0) {
      const ratchetPos: RatchetPosition = {
        id: positionId,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        stopLoss: pos.currentStopLoss ?? null,
        peakPnlPercent: pos.peakPnlPercent,
        ratchetStep: pos.ratchetStep,
        marketRegime: market?.regime,
      };
      const ratchetResult = applyRatchet(ratchetPos, pos.unrealizedPnlPercent);
      if (ratchetResult) {
        return {
          kind: 'tighten_stop',
          pipelineStep: 'profit_ratchet',
          reason: `Rung ${ratchetResult.stepIndex} activated (peak ${pos.peakPnlPercent.toFixed(2)}% ≥ ${ratchetResult.activateAtPct.toFixed(2)}%); lock ${ratchetResult.lockedProfitPct.toFixed(2)}%`,
          newStopLoss: ratchetResult.newStopLoss,
        };
      }
    }

    // ─── Step 3: CONSENSUS-FLIP ─────────────────────────────────────────
    // Phase 87 — Discretionary exits (steps 3–6) require fresh market data.
    // If feed is stale, hold and let the next tick (or hard-stop) decide.
    if (isMarketStale) {
      return {
        kind: 'hold',
        pipelineStep: 'hold:market_stale',
        reason: `market data ${(marketStaleMs/1000).toFixed(1)}s stale — holding (hard-stop still armed)`,
      };
    }
    // Phase 93 — Two-tier consensus_flip:
    //   Tier A (in profit > 0.10%): fire at config threshold (default 0.30) — bank the gain
    //     before the thesis decays further.
    //   Tier B (any P&L, even loss): fire at HIGH conviction (≥ 0.75) — when 75%+ of
    //     agents believe the opposite direction, even a losing position should be cut.
    //     This is the safety net for positions whose hard stop wasn't set (e.g.,
    //     hydrated-from-exchange) or where flipping conviction outpaces the stop level.
    //   Previously this branch was gated only on profit > 0.10%, which left losing
    //     unstopped positions unmanaged — bug surfaced by audit of 3 open positions on
    //     2026-05-13 (ETH/BTC shorts hydrated without stops, agents flipped bullish @
    //     ~78% while positions kept bleeding; brain held because flip rule was skipped).
    if (stance) {
      // Phase 93.15.2 (iter 2 of autonomous loop) — raised 0.75 → 0.85.
      //   Iter 1 audit (2026-05-13): brain exits losing money systematically
      //   (36 trades, 36.1% WR, NET -$18.19). Hypothesis: Tier-B fires on
      //   *momentary* agent flips that would have recovered. Requiring near-
      //   unanimous flip conviction (85%) before exiting a LOSING position
      //   gives trades room to breathe. Profitable positions still exit on
      //   the standard 0.30 Tier-A threshold (already-in-profit, lock gains).
      const STRONG_FLIP_CONVICTION = 0.85;
      const inProfit = pos.unrealizedPnlPercent > 0.10;
      // Position-implied entry direction: a SHORT bet on bearish, a LONG bet on bullish.
      // For hydrated positions (entry context missing) we fall back to this.
      const positionImpliedDirection: 'bullish' | 'bearish' = pos.side === 'long' ? 'bullish' : 'bearish';
      const effectiveEntryDirection: 'bullish' | 'bearish' = stance.entryDirection ?? positionImpliedDirection;
      const oppositeDirection: 'bullish' | 'bearish' = effectiveEntryDirection === 'bullish' ? 'bearish' : 'bullish';

      const currentMatchesOpposite = stance.currentDirection === oppositeDirection;
      const baseFlipped = currentMatchesOpposite && stance.currentConsensus >= this.config.consensusFlipThreshold;
      const strongFlipped = currentMatchesOpposite && stance.currentConsensus >= STRONG_FLIP_CONVICTION;

      // Tier A: in profit + base threshold met (default 0.30).
      // Tier B: strong flip (≥ 0.75) regardless of P&L — protects losing positions
      //         from running indefinitely when consensus has decisively flipped.
      const flipConditionMet = (inProfit && baseFlipped) || strongFlipped;

      // Phase 93.24 — DEBOUNCE. Consensus can flicker; a single 100ms tick
      // seeing opposite-direction consensus is not yet a real "flip". Require
      // the condition to hold continuously for `consensusFlipPersistSec`
      // (default 90s) before the exit fires.
      const persistSec = this.config.consensusFlipPersistSec ?? 90;
      const now = Date.now();
      let flipDetected = false;
      if (flipConditionMet) {
        const startedAt = this.flipDetectStartMs.get(positionId);
        if (startedAt === undefined) {
          // First tick of the flip — start the timer.
          this.flipDetectStartMs.set(positionId, now);
        } else if (now - startedAt >= persistSec * 1000) {
          flipDetected = true;
        }
      } else {
        // Flip condition no longer met — clear the timer (transient flicker).
        this.flipDetectStartMs.delete(positionId);
      }

      if (flipDetected) {
        const tier = inProfit && baseFlipped && !strongFlipped ? 'A' : 'B';
        const entryLabel = stance.entryDirection ?? `${effectiveEntryDirection}(implied)`;
        const heldFlipSec = (now - (this.flipDetectStartMs.get(positionId) ?? now)) / 1000;
        this.flipDetectStartMs.delete(positionId); // clear after firing
        return {
          kind: 'exit_full',
          pipelineStep: 'consensus_flip',
          reason: `Consensus flipped ${entryLabel}→${stance.currentDirection} @ ${(stance.currentConsensus * 100).toFixed(0)}% conviction (tier ${tier}, pnl=${pos.unrealizedPnlPercent.toFixed(2)}%, persisted ${heldFlipSec.toFixed(0)}s); trade thesis dead`,
          urgency: 'now',
        };
      }
    }

    // ─── Step 4: MOMENTUM-CRASH ─────────────────────────────────────────
    if (market?.momentum_5s_bpsPerS !== undefined && pos.unrealizedPnlPercent > 0.20) {
      const mom5 = market.momentum_5s_bpsPerS;
      const momAgainstPosition =
        (pos.side === 'long' && mom5 < -this.config.momentumCrashBpsPerS) ||
        (pos.side === 'short' && mom5 > this.config.momentumCrashBpsPerS);
      if (momAgainstPosition) {
        return {
          kind: 'exit_full',
          pipelineStep: 'momentum_crash',
          reason: `5s momentum ${mom5.toFixed(2)}bps/s against ${pos.side} while in profit ${pos.unrealizedPnlPercent.toFixed(2)}%`,
          urgency: 'now',
        };
      }
    }

    // ─── Step 5: PROFIT-TARGET (adaptive) ───────────────────────────────
    if (pos.unrealizedPnlPercent > 0.50 && pos.peakPnlPercent >= 1.0) {
      // Adaptive target: take partial when peak is being given back AND momentum decelerating
      const giveback = pos.peakPnlPercent - pos.unrealizedPnlPercent;
      const givebackThreshold = market?.atr14h
        ? (market.atr14h / pos.entryPrice) * 100 * this.config.adaptiveTargetAtrMult
        : 0.3;
      const momentumDecelerating = market?.momentum_30s_bpsPerS !== undefined &&
        Math.abs(market.momentum_30s_bpsPerS) < 0.2;
      if (giveback >= givebackThreshold && momentumDecelerating) {
        return {
          kind: 'take_partial',
          pipelineStep: 'profit_target_adaptive',
          reason: `Peak ${pos.peakPnlPercent.toFixed(2)}% giving back ≥${givebackThreshold.toFixed(2)}%; momentum cooling — bank 50%`,
          exitQuantityPercent: 50,
          urgency: 'soon',
        };
      }
    }

    // ─── Step 6: STALE-NO-PROGRESS ──────────────────────────────────────
    // Phase 93.25 — DRAWDOWN REQUIREMENT (data-driven, 2026-05-15).
    //
    // 72h forensic audit (3 staleness buckets, 21 trades, 0 wins, avg -$1.07):
    //   stale_no_progress @ 20min: 13 trades, 0W, -$0.75 avg
    //   stale_no_progress @ 30min:  3 trades, 0W, -$1.45 avg
    //   stale_no_progress @ 45min:  5 trades, 0W, -$1.98 avg
    //
    // The gate was firing on FLAT-PEAK trades (peak +0.10%, hold 20min) that
    // were pre-thesis, not stale-dead — exiting them at a tiny loss when they
    // might have resolved into profit. Require unrealized drawdown ≤ -0.30%
    // so we only kill positions that are objectively bleeding. Flat positions
    // remain held — they will either resolve into profit OR drift into the
    // drawdown band where this exit then correctly fires.
    const STALE_DRAWDOWN_THRESHOLD_PCT = -0.30;
    if (
      pos.holdMinutes > this.config.staleHoldMinutes &&
      pos.peakPnlPercent < this.config.stalePeakPnlPct &&
      pos.unrealizedPnlPercent <= STALE_DRAWDOWN_THRESHOLD_PCT &&
      (!stance || stance.driftVelocityPerMin <= 0)
    ) {
      return {
        kind: 'exit_full',
        pipelineStep: 'stale_no_progress',
        reason: `Held ${pos.holdMinutes.toFixed(0)}min, peak ${pos.peakPnlPercent.toFixed(2)}% < ${this.config.stalePeakPnlPct}%, drawdown ${pos.unrealizedPnlPercent.toFixed(2)}% ≤ ${STALE_DRAWDOWN_THRESHOLD_PCT}%, consensus not strengthening — free the slot`,
        urgency: 'soon',
      };
    }

    // ─── Step 7: HOLD (default) ─────────────────────────────────────────
    return {
      kind: 'hold',
      pipelineStep: 'hold',
      reason: `pnl=${pos.unrealizedPnlPercent.toFixed(2)}% peak=${pos.peakPnlPercent.toFixed(2)}% hold=${pos.holdMinutes.toFixed(0)}m stance=${stance?.currentDirection ?? 'unknown'}@${stance ? (stance.currentConsensus * 100).toFixed(0) : '?'}%`,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  private activePositionIds(sensorium: ReturnType<typeof getSensorium>): Array<string | number> {
    return sensorium.getActivePositionIds();
  }

  status(): { running: boolean; dryRun: boolean; tickCount: number; tickMs: number; lastTickAtMs: number | null; ageMs: number | null } {
    return {
      running: this.isRunning,
      dryRun: this.config.dryRun,
      tickCount: this.tickCount,
      tickMs: this.TICK_MS,
      // Phase 87 — heartbeat. Lets the operator console show "last tick X ms
      // ago" and detect tick-loop stalls (firing every >2s when configured
      // for 1Hz = something hung).
      lastTickAtMs: this.lastTickAtMs ?? null,
      ageMs: this.lastTickAtMs ? Date.now() - this.lastTickAtMs : null,
    };
  }
}

let _brain: TraderBrain | null = null;
export function getTraderBrain(): TraderBrain {
  if (!_brain) _brain = new TraderBrain();
  return _brain;
}
