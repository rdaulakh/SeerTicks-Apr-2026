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
import { applyRatchet, type RatchetPosition } from '../services/ProfitRatchet';
import { engineLogger as logger } from '../utils/logger';

export type BrainAction =
  | { kind: 'hold'; pipelineStep: string; reason: string }
  | { kind: 'tighten_stop'; pipelineStep: string; reason: string; newStopLoss: number }
  | { kind: 'take_partial'; pipelineStep: string; reason: string; exitQuantityPercent: number; urgency: 'now' | 'soon' }
  | { kind: 'exit_full'; pipelineStep: string; reason: string; urgency: 'now' | 'soon' };

export interface BrainConfig {
  dryRun: boolean;
  consensusFlipThreshold: number;     // drift magnitude to fire flip exit (default 0.30)
  momentumCrashBpsPerS: number;        // momentum flip rate to trigger (default 0.5)
  staleHoldMinutes: number;             // (default 30)
  stalePeakPnlPct: number;              // (default 0.30)
  adaptiveTargetAtrMult: number;        // (default 1.5)
}

const DEFAULT_CONFIG: BrainConfig = {
  dryRun: true,
  consensusFlipThreshold: 0.30,
  momentumCrashBpsPerS: 0.5,
  staleHoldMinutes: 30,
  stalePeakPnlPct: 0.30,
  adaptiveTargetAtrMult: 1.5,
};

class TraderBrain {
  private config: BrainConfig = DEFAULT_CONFIG;
  private isRunning = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 1000;       // 1Hz brain tick — adjustable
  private tickCount = 0;
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
    this.isRunning = true;
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
    logger.info('[TraderBrain] 🧠 STARTED', { dryRun: this.config.dryRun, tickMs: this.TICK_MS });
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
  }

  // ─── Hot loop ───────────────────────────────────────────────────────
  private tick(): void {
    const start = process.hrtime.bigint();
    this.tickCount++;
    const sensorium = getSensorium();
    const health = sensorium.health();
    if (health.positions === 0) return;     // nothing to decide on

    // Iterate every position. We access the underlying Map by symbol lookup —
    // Sensorium exposes positions via getPosition(id), but we also need the
    // full set. For now, since positions are rare (1-10), we expose
    // snapshotForPosition + a helper "active position IDs" via direct map access.
    // (Quick path: scan via the trace cache; for v1 the iteration cost is fine.)
    for (const positionId of this.activePositionIds(sensorium)) {
      try {
        const decision = this.decide(positionId);
        if (!decision) continue;
        const elapsedUs = Number((process.hrtime.bigint() - start) / 1000n);
        const pos = sensorium.getPosition(positionId);
        if (!pos) continue;
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
          isDryRun: this.config.dryRun,
          liveIEMAction: this.liveIEMActions.get(positionId),
          latencyUs: elapsedUs,
        });
      } catch (err) {
        logger.warn('[TraderBrain] tick error', { positionId, error: (err as Error)?.message });
      }
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
    const market = sensorium.getMarket(pos.symbol)?.sensation ?? null;
    const flow = sensorium.getFlow(pos.symbol)?.sensation ?? null;

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
    if (stance && stance.entryDirection !== null && pos.unrealizedPnlPercent > 0.10) {
      // Drift > threshold against the entry direction = thesis dead
      const flipDetected =
        (stance.entryDirection === 'bullish' && stance.currentDirection === 'bearish' && stance.currentConsensus >= this.config.consensusFlipThreshold) ||
        (stance.entryDirection === 'bearish' && stance.currentDirection === 'bullish' && stance.currentConsensus >= this.config.consensusFlipThreshold);
      if (flipDetected) {
        return {
          kind: 'exit_full',
          pipelineStep: 'consensus_flip',
          reason: `Consensus flipped ${stance.entryDirection}→${stance.currentDirection} @ ${(stance.currentConsensus * 100).toFixed(0)}% conviction; trade thesis dead`,
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
    if (
      pos.holdMinutes > this.config.staleHoldMinutes &&
      pos.peakPnlPercent < this.config.stalePeakPnlPct &&
      (!stance || stance.driftVelocityPerMin <= 0)
    ) {
      return {
        kind: 'exit_full',
        pipelineStep: 'stale_no_progress',
        reason: `Held ${pos.holdMinutes.toFixed(0)}min, peak ${pos.peakPnlPercent.toFixed(2)}% < ${this.config.stalePeakPnlPct}%, consensus not strengthening — free the slot`,
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
    // Sensorium doesn't expose the position map directly; use a back-channel.
    // For v1, we expose `_internalPositions` via a debug accessor.
    const ids: Array<string | number> = [];
    // Sensorium stores positions internally; we iterate via the snapshot health.
    // Quick path: we'll add an enumerator method.
    const enumerated = (sensorium as any)['positions'] as Map<string | number, unknown> | undefined;
    if (enumerated) {
      for (const id of enumerated.keys()) ids.push(id);
    }
    return ids;
  }

  status(): { running: boolean; dryRun: boolean; tickCount: number; tickMs: number } {
    return { running: this.isRunning, dryRun: this.config.dryRun, tickCount: this.tickCount, tickMs: this.TICK_MS };
  }
}

let _brain: TraderBrain | null = null;
export function getTraderBrain(): TraderBrain {
  if (!_brain) _brain = new TraderBrain();
  return _brain;
}
