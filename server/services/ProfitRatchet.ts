/**
 * ProfitRatchet — Phase 82.2
 *
 * The thing a real trader does: as the trade goes their way, they MOVE
 * THE STOP UP. Never down. Each new peak ratchets the stop tighter.
 * Once the stop is at breakeven, the trade can no longer be a loser.
 * Once it's at +X%, the trade is guaranteed to bank at least X%.
 *
 * This service replaces the single-shot breakeven activation
 * (activate at +0.8%, move stop to entry+0.5%, then nothing) with a
 * proper ladder:
 *
 *   gross PnL ≥ +0.30%  →  stop moves to entry (zero-loss zone reached)
 *   gross PnL ≥ +0.60%  →  stop moves to entry + 0.20% (lock 0.20%)
 *   gross PnL ≥ +1.00%  →  stop moves to entry + 0.50% (lock 0.50%)
 *   gross PnL ≥ +1.50%  →  stop moves to entry + 1.00% (lock 1.00%)
 *   gross PnL ≥ +2.00%  →  stop moves to entry + 1.40% (lock 1.40%)
 *
 * The hard-stop-loss check (already in IEM) then fires at the new
 * level. Hard-stop exits are in CATASTROPHIC_REASON_PATTERNS, so they
 * BYPASS ProfitLockGuard — no fight, no blocking. The trade exits at
 * the protected level.
 *
 * Per-regime tuning: in low_vol markets the steps are tighter (the
 * trade moves less, so we lock profit earlier); in high_vol they're
 * wider (give the trade room before tightening).
 */

import { engineLogger as logger } from '../utils/logger';

export interface RatchetPosition {
  id: string | number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  /** Current stop-loss price (the ratchet only ever moves this UP for longs / DOWN for shorts). */
  stopLoss?: number | null;
  /** Highest gross PnL% seen so far during the position's life. */
  peakPnlPercent?: number;
  /** Which ladder rung is currently locked in. -1 = none yet. */
  ratchetStep?: number;
  marketRegime?: string;
}

export interface RatchetStep {
  /** Activate this rung when gross PnL% crosses this threshold (positive). */
  activateAtPct: number;
  /** Move stop to entry + this many % (signed: 0 = breakeven, +ve = profit-lock). */
  lockProfitPct: number;
}

export interface RatchetConfig {
  enabled: boolean;
  /** Base ladder; per-regime multipliers tune step widths. */
  ladder: RatchetStep[];
  regimeMultipliers: {
    lowVol: number;
    normalVol: number;
    highVol: number;
  };
}

const DEFAULT_RATCHET: RatchetConfig = {
  enabled: true,
  ladder: [
    { activateAtPct: 0.30, lockProfitPct: 0.00 },   // Zero-loss zone reached
    { activateAtPct: 0.60, lockProfitPct: 0.20 },
    { activateAtPct: 1.00, lockProfitPct: 0.50 },
    { activateAtPct: 1.50, lockProfitPct: 1.00 },
    { activateAtPct: 2.00, lockProfitPct: 1.40 },
    { activateAtPct: 3.00, lockProfitPct: 2.20 },
  ],
  regimeMultipliers: {
    lowVol: 0.75,     // Tighter in calm markets — lock profit sooner.
    normalVol: 1.0,
    highVol: 1.35,    // Looser when volatility is high — don't get stopped on noise.
  },
};

let _config: RatchetConfig = DEFAULT_RATCHET;

export function setRatchetConfig(cfg: Partial<RatchetConfig>): void {
  _config = { ..._config, ...cfg };
}

export function getRatchetConfig(): RatchetConfig {
  return _config;
}

function regimeMult(regime?: string): number {
  switch (regime) {
    case 'lowVol':
    case 'low_vol':
      return _config.regimeMultipliers.lowVol;
    case 'highVol':
    case 'high_vol':
      return _config.regimeMultipliers.highVol;
    default:
      return _config.regimeMultipliers.normalVol;
  }
}

/**
 * Compute the new stop-loss price given the position and its current peak PnL.
 * Returns null if no ratchet step has activated yet, or the current step is
 * already at or above the candidate.
 */
export function computeRatchetStop(
  position: RatchetPosition,
  currentGrossPnlPercent: number,
): { newStopLoss: number; stepIndex: number; lockedProfitPct: number; activateAtPct: number } | null {
  if (!_config.enabled) return null;
  // Use the higher of (current pnl, recorded peak) so the ratchet doesn't
  // regress if peakPnlPercent hasn't yet been updated for this tick.
  const peak = Math.max(currentGrossPnlPercent, position.peakPnlPercent ?? -Infinity);
  if (!Number.isFinite(peak) || peak <= 0) return null;

  const mult = regimeMult(position.marketRegime);
  const currentStep = position.ratchetStep ?? -1;

  // Walk the ladder bottom-up, find the highest rung the peak qualifies for.
  let qualifyingStep = currentStep;
  for (let i = 0; i < _config.ladder.length; i++) {
    const threshold = _config.ladder[i].activateAtPct * mult;
    if (peak >= threshold) qualifyingStep = i;
  }

  if (qualifyingStep <= currentStep) return null;

  const rung = _config.ladder[qualifyingStep];
  const lockProfit = rung.lockProfitPct * mult;
  const newStopLoss =
    position.side === 'long'
      ? position.entryPrice * (1 + lockProfit / 100)
      : position.entryPrice * (1 - lockProfit / 100);

  // Defensive: only ratchet INWARD relative to the existing stop.
  if (position.stopLoss !== null && position.stopLoss !== undefined) {
    const isRatchetInward =
      position.side === 'long'
        ? newStopLoss > position.stopLoss
        : newStopLoss < position.stopLoss;
    if (!isRatchetInward) return null;
  }

  return {
    newStopLoss,
    stepIndex: qualifyingStep,
    lockedProfitPct: lockProfit,
    activateAtPct: rung.activateAtPct * mult,
  };
}

/**
 * Apply the ratchet — mutates position.stopLoss + position.ratchetStep
 * in place when a higher rung activates. Returns the applied step
 * descriptor (or null when nothing changed). Pure-ish: the only side
 * effects are on the position object, so callers can decide whether
 * to persist (DB write) + emit an event.
 */
export function applyRatchet(
  position: RatchetPosition,
  currentGrossPnlPercent: number,
): { newStopLoss: number; stepIndex: number; lockedProfitPct: number; activateAtPct: number } | null {
  const result = computeRatchetStop(position, currentGrossPnlPercent);
  if (!result) return null;

  const prevStopLoss = position.stopLoss;
  position.stopLoss = result.newStopLoss;
  position.ratchetStep = result.stepIndex;

  logger.info(
    `[ProfitRatchet] 🪜 STEP ${result.stepIndex} ACTIVATED: ${position.id} ${position.symbol} ${position.side} ` +
      `peak=+${currentGrossPnlPercent.toFixed(2)}% (threshold +${result.activateAtPct.toFixed(2)}%) ` +
      `→ stop $${prevStopLoss?.toFixed(4) ?? 'none'} → $${result.newStopLoss.toFixed(4)} ` +
      `(lock ${result.lockedProfitPct >= 0 ? '+' : ''}${result.lockedProfitPct.toFixed(2)}%)`,
  );

  return result;
}
