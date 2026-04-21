/**
 * ProfitLockGuard — Net-Positive Exit Gate (PRIME DIRECTIVE)
 *
 * "Only pick and exit profit in trades."
 *
 * Every exit path in the engine calls `shouldAllowClose` before it can close a
 * position. The guard blocks the close unless:
 *   1. Net PnL (gross − fees − slippage) ≥ minNetProfitPercentToClose, OR
 *   2. The exit reason matches a catastrophic / emergency / kill-switch pattern, OR
 *   3. Gross PnL is already ≤ catastrophicStopPercent (hard blow-up protection).
 *
 * This addresses the core bug where trades that ran to +0.9% were legitimately
 * closing at −1.2% because breakeven buffers were fee-blind and no component
 * enforced a net-positive floor on non-stop exits.
 */
import { getTradingConfig } from '../config/TradingConfig';

/** Minimal position shape used by the guard — kept intentionally small so every
 * exit manager can satisfy it without coupling to heavier Position types. */
export interface ProfitLockPosition {
  side: 'long' | 'short';
  entryPrice: number;
}

export interface ProfitLockDecision {
  allow: boolean;
  reason: string;
  netPnlPercent: number;
  grossPnlPercent: number;
}

/** Exit-reason substrings that always bypass the guard (true blow-up protection). */
const CATASTROPHIC_REASON_PATTERNS: readonly string[] = [
  'emergency_',
  'catastrophic_',
  'hard_stop_',
  'circuit_breaker_',
  'manual_override_',
  'regime_kill_',
  'liquidation_',
];

export function isCatastrophicReason(exitReason: string | undefined | null): boolean {
  if (!exitReason) return false;
  const normalized = String(exitReason).toLowerCase();
  return CATASTROPHIC_REASON_PATTERNS.some(p => normalized.includes(p));
}

/** Compute gross PnL % for a long/short position at a given mark price. */
export function computeGrossPnlPercent(position: ProfitLockPosition, currentPrice: number): number {
  if (!position.entryPrice || position.entryPrice <= 0) return 0;
  if (position.side === 'long') {
    return ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  }
  return ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
}

/**
 * Gate a candidate close. Call this from every exit manager BEFORE returning a
 * decision that would close (fully or partially) the position.
 *
 * Returns `allow: true` when the close is permitted. When `allow: false`, the
 * caller must convert its decision to "hold" and keep monitoring.
 */
export function shouldAllowClose(
  position: ProfitLockPosition,
  currentPrice: number,
  exitReason: string
): ProfitLockDecision {
  const config = getTradingConfig().profitLock;
  const grossPnlPercent = computeGrossPnlPercent(position, currentPrice);
  const totalCostPercent =
    (config?.estimatedRoundTripFeePercent ?? 0) + (config?.estimatedSlippagePercent ?? 0);
  const netPnlPercent = grossPnlPercent - totalCostPercent;

  // Guard disabled → always permit (preserves legacy behavior for tests/dev).
  if (!config || config.enabled === false) {
    return {
      allow: true,
      reason: 'profit_lock_disabled',
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 1. Catastrophic exit reasons (emergency, hard-stop, circuit-breaker, ...)
  if (config.allowCatastrophicStop && isCatastrophicReason(exitReason)) {
    return {
      allow: true,
      reason: `catastrophic_reason:${exitReason}`,
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 2. Gross PnL already past the catastrophic floor → blow-up protection.
  if (config.allowCatastrophicStop && grossPnlPercent <= config.catastrophicStopPercent) {
    return {
      allow: true,
      reason: `catastrophic_grossPnl:${grossPnlPercent.toFixed(3)}%<=${config.catastrophicStopPercent}%`,
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 3. Net-positive floor — the whole point of this guard.
  if (netPnlPercent >= config.minNetProfitPercentToClose) {
    return {
      allow: true,
      reason: `net_profit_ok:${netPnlPercent.toFixed(3)}%>=${config.minNetProfitPercentToClose}%`,
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 4. Blocked — keep holding until net-positive or catastrophic.
  const blockReason =
    `profit_lock_block: gross=${grossPnlPercent.toFixed(3)}% net=${netPnlPercent.toFixed(3)}% ` +
    `floor=${config.minNetProfitPercentToClose}% (fees+slip=${totalCostPercent.toFixed(3)}%) ` +
    `exitReason="${exitReason}"`;

  console.log(
    `[ProfitLockGuard] BLOCKED exit reason="${exitReason}" ` +
    `grossPnl=${grossPnlPercent.toFixed(3)}% netPnl=${netPnlPercent.toFixed(3)}% ` +
    `— holding until net-positive or catastrophic`
  );

  return {
    allow: false,
    reason: blockReason,
    netPnlPercent,
    grossPnlPercent,
  };
}

export default {
  shouldAllowClose,
  computeGrossPnlPercent,
  isCatastrophicReason,
};
