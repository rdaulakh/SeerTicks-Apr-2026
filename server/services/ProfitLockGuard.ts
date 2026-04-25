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
 * exit manager can satisfy it without coupling to heavier Position types.
 *
 * Phase 10 — `exchange` is optional. When provided and a matching override
 * exists in `config.profitLock.exchangeFeeOverrides`, the guard uses the
 * exchange-specific fee+slippage drag instead of the flat default. Missing
 * / unknown exchange falls back to `estimatedRoundTripFeePercent +
 * estimatedSlippagePercent` (Binance-like defaults in PRODUCTION_CONFIG).
 */
export interface ProfitLockPosition {
  side: 'long' | 'short';
  entryPrice: number;
  exchange?: string;
  // Phase 24 — optional thesis-invalidation context. When present AND
  // `profitLock.thesisInvalidationExit.enabled` is true, the guard adds a
  // fourth allow path: close trades whose entry thesis has clearly been
  // invalidated by agent consensus, even at small loss. Callers that don't
  // populate these fields skip the check (back-compat — guard behaves as
  // before when context is missing).
  entryDirection?: 'bullish' | 'bearish' | 'neutral';
  currentDirection?: 'bullish' | 'bearish' | 'neutral';
  currentConsensusStrength?: number;     // 0..1, weighted consensus of current agents
  peakUnrealizedPnlPercent?: number;     // peak PnL% reached during the hold (running max)
  holdMinutes?: number;                  // time since entry, in minutes
}

export interface ProfitLockDecision {
  allow: boolean;
  reason: string;
  netPnlPercent: number;
  grossPnlPercent: number;
}

/**
 * Exit-reason substrings that always bypass the guard (true blow-up protection).
 *
 * Phase 8 — pattern coverage expanded to match what the engine actually emits.
 *
 * Pre-Phase 8 the list was underscore-prefixed identifiers only (`emergency_`,
 * `hard_stop_`, etc.) — a format no exit manager actually produced. The real
 * strings are either human-readable ("Emergency exit: Position down -1.45%")
 * or underscore-SCREAM ("DEAD_MANS_SWITCH: No price data", "DAILY_LOSS_LIMIT:
 * $X.XX > $Y.YY"). So `isCatastrophicReason` always returned false and the
 * bypass path was structurally unreachable — emergencies were only allowed
 * through the `catastrophicStopPercent` gross-PnL branch, which only fires
 * after the position has already bled to the floor.
 *
 * Adding lowercase forms of the real emitted strings closes that gap: a
 * dead-man's-switch or daily-loss trip now bypasses the guard *regardless*
 * of current gross PnL (the whole point of a kill-switch).
 *
 * DELIBERATELY OMITTED: "stop-loss hit". That reason is emitted by both the
 * hard-SL path AND the breakeven-stop path (which fires at gross +0.5%, a
 * profitable close). Adding it here would route breakeven winners through
 * the catastrophic branch instead of net_profit_ok — breaking Phase 7.
 */
const CATASTROPHIC_REASON_PATTERNS: readonly string[] = [
  // Underscore-prefixed internal signals (legacy; kept for back-compat)
  'emergency_',
  'catastrophic_',
  'hard_stop_',
  'circuit_breaker_',
  'manual_override_',
  'regime_kill_',
  'liquidation_',
  // Phase 8 — strings the engine actually emits (normalized to lowercase
  // in `isCatastrophicReason` before the `.includes` check):
  'emergency exit',     // IntelligentExitManager.evaluateExitConditionsRaw emergency floor
  'dead_mans_switch',   // PositionGuardian dead-man's-switch (price feed silent)
  'daily_loss_limit',   // PositionGuardian daily-loss circuit breaker
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
/**
 * Phase 10 — resolve the fee+slippage drag for a position.
 *
 * Looks up `config.profitLock.exchangeFeeOverrides[position.exchange?.toLowerCase()]`
 * first, then falls back to the flat `estimatedRoundTripFeePercent +
 * estimatedSlippagePercent`. Returns the components so the caller can
 * surface them in the decision reason for auditability.
 */
export function resolveDragPercent(
  position: ProfitLockPosition,
): {
  roundTripFeePercent: number;
  slippagePercent: number;
  totalCostPercent: number;
  source: string; // e.g. "exchange:coinbase" | "default"
} {
  const config = getTradingConfig().profitLock;
  const key = position.exchange?.toLowerCase();
  const override = key ? config?.exchangeFeeOverrides?.[key] : undefined;
  if (override) {
    return {
      roundTripFeePercent: override.roundTripFeePercent,
      slippagePercent: override.slippagePercent,
      totalCostPercent:
        override.roundTripFeePercent + override.slippagePercent,
      source: `exchange:${key}`,
    };
  }
  const fee = config?.estimatedRoundTripFeePercent ?? 0;
  const slip = config?.estimatedSlippagePercent ?? 0;
  return {
    roundTripFeePercent: fee,
    slippagePercent: slip,
    totalCostPercent: fee + slip,
    source: key ? `default(unknown:${key})` : 'default',
  };
}

/**
 * Phase 24 — pure helper: does the position's entry thesis still hold?
 *
 * Returns `{ invalidated: true, reason }` only when EVERY condition is met:
 *   1. enabled
 *   2. holdMinutes ≥ minHoldMinutes (give the trade time to develop)
 *   3. peakUnrealizedPnlPercent < peakProfitNotReachedPct (the trade NEVER
 *      had real upside — this is not a giveback from profit)
 *   4. currentDirection is the OPPOSITE of entryDirection (long↔bearish,
 *      short↔bullish) — agents have flipped on us
 *   5. currentConsensusStrength ≥ requiredOpposingStrength (flip is convicted)
 *   6. netPnlPercent is in the actionable loss window:
 *      maxLossToTriggerPct < netPnlPercent ≤ minLossToTriggerPct
 *
 * Pure — no I/O, no globals. Exported for direct testing.
 */
export interface ThesisInvalidationConfig {
  enabled: boolean;
  minHoldMinutes: number;
  peakProfitNotReachedPct: number;
  requiredOpposingStrength: number;
  minLossToTriggerPct: number;
  maxLossToTriggerPct: number;
}

export function evaluateThesisInvalidation(
  position: ProfitLockPosition,
  netPnlPercent: number,
  cfg: ThesisInvalidationConfig | undefined,
): { invalidated: boolean; reason: string } {
  if (!cfg || !cfg.enabled) return { invalidated: false, reason: 'disabled' };

  const hold = position.holdMinutes;
  if (hold === undefined || hold < cfg.minHoldMinutes) {
    return { invalidated: false, reason: `hold_too_short:${hold ?? '?'}<${cfg.minHoldMinutes}m` };
  }

  const peak = position.peakUnrealizedPnlPercent;
  if (peak === undefined || peak >= cfg.peakProfitNotReachedPct) {
    return { invalidated: false, reason: `peak_reached:${peak?.toFixed?.(3) ?? '?'}%>=${cfg.peakProfitNotReachedPct}%` };
  }

  const entry = position.entryDirection;
  const current = position.currentDirection;
  const flipped =
    (entry === 'bullish' && current === 'bearish') ||
    (entry === 'bearish' && current === 'bullish');
  if (!flipped) {
    return { invalidated: false, reason: `not_flipped:entry=${entry ?? '?'},current=${current ?? '?'}` };
  }

  const strength = position.currentConsensusStrength;
  if (strength === undefined || strength < cfg.requiredOpposingStrength) {
    return { invalidated: false, reason: `weak_flip:${strength?.toFixed?.(3) ?? '?'}<${cfg.requiredOpposingStrength}` };
  }

  // Loss window: pnl must be in (max, min] — meaningful loss but not catastrophic.
  // Both bounds are negative; e.g. min=-0.20, max=-1.00 means trigger when
  // -1.00 < pnl ≤ -0.20.
  if (netPnlPercent > cfg.minLossToTriggerPct) {
    return { invalidated: false, reason: `loss_too_small:${netPnlPercent.toFixed(3)}%>${cfg.minLossToTriggerPct}%` };
  }
  if (netPnlPercent <= cfg.maxLossToTriggerPct) {
    return { invalidated: false, reason: `loss_catastrophic:${netPnlPercent.toFixed(3)}%<=${cfg.maxLossToTriggerPct}% (catastrophic_owns_it)` };
  }

  return {
    invalidated: true,
    reason:
      `hold=${hold.toFixed(0)}m peak=${peak.toFixed(3)}% ` +
      `flip=${entry}→${current} str=${strength.toFixed(3)} ` +
      `netPnl=${netPnlPercent.toFixed(3)}%`,
  };
}

export function shouldAllowClose(
  position: ProfitLockPosition,
  currentPrice: number,
  exitReason: string
): ProfitLockDecision {
  const config = getTradingConfig().profitLock;
  const grossPnlPercent = computeGrossPnlPercent(position, currentPrice);
  const drag = resolveDragPercent(position);
  const totalCostPercent = drag.totalCostPercent;
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
      reason: `net_profit_ok:${netPnlPercent.toFixed(3)}%>=${config.minNetProfitPercentToClose}% (drag=${totalCostPercent.toFixed(3)}% ${drag.source})`,
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 4. Phase 24 — Thesis-invalidated escape hatch. The agents that opened
  //    this trade have flipped against it with conviction, the trade has
  //    had its time, peak PnL never reached profit territory, and current
  //    loss is real-but-not-catastrophic. Allow the close to free the slot
  //    rather than ride to the catastrophic floor.
  const thesisCheck = evaluateThesisInvalidation(
    position,
    netPnlPercent,
    config.thesisInvalidationExit,
  );
  if (thesisCheck.invalidated) {
    return {
      allow: true,
      reason: `thesis_invalidated:${thesisCheck.reason}`,
      netPnlPercent,
      grossPnlPercent,
    };
  }

  // 5. Blocked — keep holding until net-positive or catastrophic.
  const blockReason =
    `profit_lock_block: gross=${grossPnlPercent.toFixed(3)}% net=${netPnlPercent.toFixed(3)}% ` +
    `floor=${config.minNetProfitPercentToClose}% (fees+slip=${totalCostPercent.toFixed(3)}% ${drag.source}) ` +
    `exitReason="${exitReason}"`;

  console.log(
    `[ProfitLockGuard] BLOCKED exit reason="${exitReason}" ` +
    `grossPnl=${grossPnlPercent.toFixed(3)}% netPnl=${netPnlPercent.toFixed(3)}% ` +
    `drag=${totalCostPercent.toFixed(3)}% (${drag.source}) ` +
    `— holding until net-positive or catastrophic`
  );

  return {
    allow: false,
    reason: blockReason,
    netPnlPercent,
    grossPnlPercent,
  };
}

/**
 * Phase 11 — Pre-trade viability gate.
 *
 * Prime-directive corollary: "don't open a trade whose first profit target
 * cannot exit profitably." Phases 6–10 hardened EXIT. That's necessary but
 * not sufficient: if we open a position whose configured TP, when reached,
 * would net < 0.15% after exchange-aware fee drag, the guard blocks the
 * close → position loiters → eventually hits catastrophic SL (real loss)
 * or time exit (blocked, bleeds further). The rational move is to refuse
 * the entry in the first place.
 *
 * Given an entry price, a planned take-profit price, and the exchange,
 * this function computes whether the implied gross TP% clears
 * `drag + minNetProfitPercentToClose`. Returns a structured decision
 * the caller uses to `return early` on the entry path.
 *
 * Pure logic — no I/O. Deterministic given config + inputs. Safe to call
 * synchronously from the entry hook.
 */
export interface EntryViabilityDecision {
  viable: boolean;
  /** Gross TP %: (tp - entry) / entry × 100, sign-adjusted for side. */
  grossProfitPercent: number;
  /** Net TP % after drag. */
  netProfitPercent: number;
  /** Minimum gross % the entry needs to clear for this exchange. */
  requiredGrossPercent: number;
  /** Echoes the resolved drag (0.25% default / 0.25% binance / 1.30% coinbase). */
  totalCostPercent: number;
  /** Human-readable decision for logging + rejection surfacing. */
  reason: string;
}

export function canEnterProfitably(
  position: ProfitLockPosition,
  entryPrice: number,
  takeProfitPrice: number,
): EntryViabilityDecision {
  const config = getTradingConfig().profitLock;
  const floor = config?.minNetProfitPercentToClose ?? 0.15;
  const drag = resolveDragPercent(position);
  const totalCostPercent = drag.totalCostPercent;
  const requiredGrossPercent = floor + totalCostPercent;

  // Sign-adjust gross TP% the same way we do live PnL% so longs/shorts work.
  let grossProfitPercent: number;
  if (!entryPrice || entryPrice <= 0 || !takeProfitPrice || takeProfitPrice <= 0) {
    return {
      viable: false,
      grossProfitPercent: 0,
      netProfitPercent: 0,
      requiredGrossPercent,
      totalCostPercent,
      reason: 'entry_viability_invalid_prices',
    };
  }
  if (position.side === 'long') {
    grossProfitPercent = ((takeProfitPrice - entryPrice) / entryPrice) * 100;
  } else {
    grossProfitPercent = ((entryPrice - takeProfitPrice) / entryPrice) * 100;
  }
  const netProfitPercent = grossProfitPercent - totalCostPercent;

  // A TP that sits on the wrong side of entry (e.g. TP < entry for long) is
  // structurally broken — reject as non-viable rather than allowing a
  // "profit target" that's actually at a loss.
  if (grossProfitPercent <= 0) {
    return {
      viable: false,
      grossProfitPercent,
      netProfitPercent,
      requiredGrossPercent,
      totalCostPercent,
      reason:
        `entry_viability_wrong_side: takeProfit=${takeProfitPrice} vs entry=${entryPrice} side=${position.side}`,
    };
  }

  const viable = netProfitPercent >= floor;
  return {
    viable,
    grossProfitPercent,
    netProfitPercent,
    requiredGrossPercent,
    totalCostPercent,
    reason: viable
      ? `entry_viable:netTP=${netProfitPercent.toFixed(3)}%>=${floor}% (grossTP=${grossProfitPercent.toFixed(3)}%, drag=${totalCostPercent.toFixed(3)}% ${drag.source})`
      : `entry_not_viable:netTP=${netProfitPercent.toFixed(3)}%<${floor}% requires grossTP≥${requiredGrossPercent.toFixed(3)}% (drag=${totalCostPercent.toFixed(3)}% ${drag.source})`,
  };
}

/**
 * Phase 12 — Drag-drift telemetry.
 *
 * The guard's net-PnL decision is only as safe as its fee + slippage
 * estimate. If real-world drag drifts above the estimate — because a
 * user's exchange tier changed, slippage widened in thin markets, or
 * the hardcoded adapter fallback is stale — the guard will approve
 * closes that are NET-NEGATIVE in reality. Directive violation, silent.
 *
 * Phases 6–11 are static defenses. Phase 12 adds the feedback loop: on
 * every filled order, compare `actualFeePercent + actualSlippagePercent`
 * against `resolveDragPercent` and log when drift exceeds tolerance.
 * Structured, cheap, safe to call from hot paths. No behavioral change.
 *
 * Thresholds:
 *   - WARN when actual > estimate × 1.5  (50% overrun)
 *   - WARN when |actual − estimate| > 0.10% (absolute drift)
 *   - INFO otherwise (can be sampled for calibration)
 *
 * Once we see sustained WARNs for a given exchange, Phase 10's
 * `exchangeFeeOverrides` can be updated with the observed reality.
 */
export interface ActualDragReport {
  actualRoundTripFeePercent: number;
  actualSlippagePercent: number;
  actualTotalPercent: number;
  estimatedTotalPercent: number;
  driftAbsolutePercent: number; // actual - estimate (can be negative)
  driftRatio: number;           // actual / estimate (>1 means overrun)
  exceedsTolerance: boolean;
  source: string;               // from resolveDragPercent
}

export function reportActualTradeDrag(
  position: ProfitLockPosition,
  actualFeePercent: number,
  actualSlippagePercent: number,
  context: { orderId?: string; symbol?: string; side?: string } = {},
): ActualDragReport {
  const drag = resolveDragPercent(position);
  const actualTotalPercent =
    (actualFeePercent || 0) + (actualSlippagePercent || 0);
  const driftAbsolutePercent = actualTotalPercent - drag.totalCostPercent;
  const driftRatio =
    drag.totalCostPercent > 0
      ? actualTotalPercent / drag.totalCostPercent
      : Infinity;
  const exceedsTolerance =
    Math.abs(driftAbsolutePercent) > 0.10 || // 0.10% absolute
    driftRatio > 1.5; // 50% overrun

  const report: ActualDragReport = {
    actualRoundTripFeePercent: actualFeePercent || 0,
    actualSlippagePercent: actualSlippagePercent || 0,
    actualTotalPercent,
    estimatedTotalPercent: drag.totalCostPercent,
    driftAbsolutePercent,
    driftRatio,
    exceedsTolerance,
    source: drag.source,
  };

  if (exceedsTolerance) {
    console.warn(
      `[ProfitLockGuard] 📉 DRAG DRIFT symbol=${context.symbol ?? '?'} ` +
        `side=${context.side ?? position.side} ` +
        `order=${context.orderId ?? '?'} ` +
        `actual=${actualTotalPercent.toFixed(4)}% ` +
        `(fee=${(actualFeePercent || 0).toFixed(4)}% slip=${(actualSlippagePercent || 0).toFixed(4)}%) ` +
        `estimated=${drag.totalCostPercent.toFixed(4)}% ` +
        `(${drag.source}) ` +
        `drift=${driftAbsolutePercent >= 0 ? '+' : ''}${driftAbsolutePercent.toFixed(4)}% ` +
        `ratio=${driftRatio.toFixed(2)}× — ` +
        `consider updating profitLock.exchangeFeeOverrides.${position.exchange ?? 'default'}`,
    );
  }

  return report;
}

export default {
  shouldAllowClose,
  computeGrossPnlPercent,
  isCatastrophicReason,
  resolveDragPercent,
  canEnterProfitably,
  reportActualTradeDrag,
};
