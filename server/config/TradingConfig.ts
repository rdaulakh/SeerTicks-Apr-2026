/**
 * Phase 17: Unified Trading Configuration — Single Source of Truth
 *
 * Consolidates ALL trading parameters from:
 * - EnhancedTradeExecutor (Phase 15A circuit breakers)
 * - Week9RiskManager (Kelly criterion, correlation)
 * - PriorityExitManager (exit parameters)
 * - AutomatedSignalProcessor (consensus thresholds)
 *
 * EVERY trading parameter lives here. No more scattered constants.
 * Resolves conflicts:
 * - MAX_CONSECUTIVE_LOSSES: was 5 (executor) vs 3 (risk manager) → 4 (compromise)
 * - MAX_DAILY_LOSS: was 5% (executor) vs 10% (risk manager) → 5% (executor wins, it runs first)
 * - MAX_POSITIONS: was 10 (executor) vs 3 (risk manager) → 5 (safe middle ground)
 */

export interface TradingConfiguration {
  // ── Circuit Breakers (Phase 15A) ──
  circuitBreakers: {
    maxDailyTrades: number;
    maxConsecutiveLosses: number;
    consecutiveLossPauseMs: number;
    maxDailyLossPercent: number;       // % of account equity
    maxDrawdownPercent: number;        // % from peak equity
    maxSymbolConcentration: number;    // % of account per symbol
  };

  // ── Position Sizing (Week 9 + Phase 15C) ──
  positionSizing: {
    kellyFraction: number;             // Fractional Kelly multiplier (0.25 = quarter Kelly)
    minWinRateForKelly: number;        // Below this, Kelly returns 0
    defaultWinRate: number;            // Used when insufficient data
    defaultPayoffRatio: number;        // avg win / avg loss default
    maxPositionSizePercent: number;    // Hard cap per trade (% of available balance)
    maxTotalExposurePercent: number;   // Max portfolio exposure
    maxConcurrentPositions: number;    // Max open positions at once
    maxPositionsPerSymbol: number;     // Max positions per asset
  };

  // ── VaR Risk Limits (Phase 17 NEW) ──
  varLimits: {
    enabled: boolean;
    maxPortfolioVaR95Percent: number;    // Max portfolio VaR(95%) as % of equity
    maxIncrementalVaR95Percent: number;  // Max VaR added by single new position
    maxPortfolioCVaR95Percent: number;   // Max CVaR(95%) as % of equity
    minHistoricalDataPoints: number;     // Min return observations for VaR calc
    varConfidenceLevel: number;          // 0.95 or 0.99
    varTimeHorizonDays: number;          // Usually 1 day
  };

  // ── Correlation Limits (Phase 17 Enhanced) ──
  correlation: {
    maxCorrelatedExposurePercent: number;  // Max exposure to correlated group
    correlationThreshold: number;           // Correlation coefficient to consider "correlated"
    highCorrelationSizeReduction: number;   // 0.7 = reduce to 70% if corr > threshold
    veryHighCorrelationSizeReduction: number; // 0.5 = reduce to 50% if corr > 0.85
    blockIfCorrelationAbove: number;        // Block trade entirely above this
  };

  // ── Consensus Thresholds ──
  consensus: {
    minConsensusStrength: number;       // 0.65 = 65% weighted agreement
    minConfidence: number;              // 0.60 = 60% minimum agent confidence
    minExecutionScore: number;          // 45/100 tactical timing
    minAgentAgreement: number;          // Min agents agreeing on direction
    minDirectionRatio: number;          // >0.55 = 55% directional dominance
    minCombinedScore: number;           // (conf×0.6 + exec×0.4) minimum
  };

  // ── Exit Parameters (Phase 15C + 17 Regime-Aware) ──
  exits: {
    // Base parameters (used in normal volatility)
    hardStopLossPercent: number;
    maxLoserTimeMinutes: number;
    maxWinnerTimeMinutes: number;
    minHoldTimeForDecayMinutes: number;
    profitTargets: [number, number, number];   // [0.5%, 1.5%, 3.0%]
    targetExitPercents: [number, number, number]; // [33%, 33%, 34%]
    momentumCrashDropPercent: number;
    momentumCrashWindowMs: number;
    trailingActivationPercent: number;
    trailingDistancePercent: number;
    atrStopMultiplier: number;
    atrTrailingMultiplier: number;
    positionMaxDrawdownPercent: number;  // Per-position max unrealized loss before force-close

    // Regime multipliers (Phase 17 NEW)
    regimeAdjustments: {
      lowVol: ExitRegimeMultipliers;     // ATR < 1.5% daily
      normalVol: ExitRegimeMultipliers;  // ATR 1.5-4% daily
      highVol: ExitRegimeMultipliers;    // ATR > 4% daily
    };
  };

  // ── Execution ──
  execution: {
    maxExecutionTimeMs: number;           // Reject if execution takes longer
    dynamicLevelsCacheTtlMs: number;      // Cache OHLCV data for this long
    positionIdCacheTtlMs: number;         // Cache DB position IDs
    cooldownBetweenTradesMs: number;      // Min time between trades
  };

  // ── Profit Lock Guard (Prime Directive: only pick and exit profit in trades) ──
  // Blocks any non-catastrophic close at net-negative PnL. A trade is held until
  // net-positive (gross - fees - slippage >= minNetProfitPercentToClose) or until
  // a catastrophic stop/emergency pattern fires.
  profitLock: {
    enabled: boolean;                      // Master switch — disable only for testing
    minNetProfitPercentToClose: number;    // Net profit floor for non-stop exits (% of entry)
    estimatedRoundTripFeePercent: number;  // Total entry+exit fee estimate (% of entry)
    estimatedSlippagePercent: number;      // Total slippage estimate (% of entry)
    allowCatastrophicStop: boolean;        // Hard stop can still fire when true
    catastrophicStopPercent: number;       // Absolute last-resort gross-pnl floor (negative %)
  };

  // ── Entry-Gate Hardening (audit restoration) ──
  // Fail-closed defaults — loss-prevention guards that must block trades when
  // underlying signals/data cannot be verified.
  validation: {
    // When agent-consensus validation fails, should EntryValidationService
    // trust upstream consensus and pass through (true), or veto (false)?
    // Default: false (fail closed).  Set true ONLY for backward-compat.
    failOpenOnConsensusMismatch: boolean;
  };
  macro: {
    // When macro data source is unreachable and risk-on/risk-off cannot be
    // computed, should MacroAnalyst activate a veto (true) or allow trades (false)?
    // Default: true (fail closed — no macro confirmation = no trade).
    failClosed: boolean;
  };
  risk: {
    // When the VaR gate throws an unexpected error, should the executor
    // reject the trade (true) or continue permissively (false)?
    // Default: true (fail closed — unknown risk = no trade).
    failClosedOnVaRError: boolean;
  };
  entry: {
    // Minimum number of historical candles (primary timeframe) required in
    // CandleStorage before a signal can be approved.  Prevents trading on
    // a cold-start / data-gap symbol where indicators are meaningless.
    minHistoricalCandlesRequired: number;
    // Maximum allowed staleness (ms) of the latest streamed price.
    // If older, the entry is rejected as `price_feed_stale`.
    priceFeedMaxStalenessMs: number;
  };
}

export interface ExitRegimeMultipliers {
  stopLossMultiplier: number;           // 1.0 = use base, 0.5 = half as wide
  maxHoldTimeMultiplier: number;        // 1.0 = use base, 0.5 = half as long
  trailingDistanceMultiplier: number;   // 1.0 = use base, 1.5 = wider trail
  atrStopMultiplier: number;            // Override ATR stop multiplier
}

/**
 * Production configuration — optimized for BTC/ETH crypto trading
 */
export const PRODUCTION_CONFIG: TradingConfiguration = {
  circuitBreakers: {
    maxDailyTrades: 50,
    maxConsecutiveLosses: 4,              // Compromise: was 5 (executor) vs 3 (risk mgr)
    consecutiveLossPauseMs: 10 * 60 * 1000, // 10 minutes
    maxDailyLossPercent: 0.05,            // 5% — executor limit (strictest wins)
    maxDrawdownPercent: 0.15,             // 15% from peak
    maxSymbolConcentration: 0.25,         // 25% per symbol (tightened from 30%)
  },

  positionSizing: {
    kellyFraction: 0.25,                  // Quarter Kelly — conservative
    minWinRateForKelly: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxPositionSizePercent: 0.10,         // 10% max per trade (Phase 15C)
    maxTotalExposurePercent: 0.60,        // 60% max total (tightened from 80%)
    maxConcurrentPositions: 5,            // Compromise: was 10 vs 3
    maxPositionsPerSymbol: 1,
  },

  varLimits: {
    enabled: true,
    maxPortfolioVaR95Percent: 0.08,       // Max 8% portfolio VaR(95%)
    maxIncrementalVaR95Percent: 0.02,     // Max 2% additional VaR per new trade
    maxPortfolioCVaR95Percent: 0.12,      // Max 12% portfolio CVaR(95%)
    minHistoricalDataPoints: 30,          // Need 30+ returns for VaR calc
    varConfidenceLevel: 0.95,
    varTimeHorizonDays: 1,
  },

  correlation: {
    maxCorrelatedExposurePercent: 0.30,   // 30% max to correlated group
    correlationThreshold: 0.70,           // 0.70+ = correlated
    highCorrelationSizeReduction: 0.70,   // Reduce to 70% size if corr 0.70-0.85
    veryHighCorrelationSizeReduction: 0.50, // Reduce to 50% if corr > 0.85
    blockIfCorrelationAbove: 0.95,        // Block trade if corr > 0.95
  },

  consensus: {
    // Entry-gate audit restoration (post Phase 40 v2): the 0.10–0.12 rescaling
    // left the entry pipeline functionally disarmed — any 2-agent split with
    // a weak dissenter was satisfying consensus, driving the high-loss-rate
    // regression found in the audit.
    // Restored thresholds are set halfway between the original pre-Phase-40
    // values (0.50 / 0.45 / 0.40) and the overly-permissive Phase-40 values
    // (0.12 / 0.10 / 0.10), matching current weighted agent-output scale
    // while rejecting low-conviction splits.
    minConsensusStrength: 0.30,            // restored from 0.12 (halfway to 0.50)
    minConfidence: 0.25,                   // restored from 0.10 (halfway to 0.45)
    minExecutionScore: 40,                 // 40/100 tactical timing — unchanged
    minAgentAgreement: 3,                  // Min 3 agents agreeing on direction — unchanged
    minDirectionRatio: 0.60,               // >60% directional dominance — unchanged
    minCombinedScore: 0.25,                // restored from 0.10 (halfway to 0.40)
  },

  exits: {
    hardStopLossPercent: -1.2,             // Phase 45 FIX: widened from -0.8% — crypto volatility needs wider stops to avoid noise exits
    maxLoserTimeMinutes: 25,               // Phase 45 FIX: increased from 12 min — give trades more time to recover, regime adjustment will scale
    maxWinnerTimeMinutes: 120,
    minHoldTimeForDecayMinutes: 20, // Phase 45: increased from 10 to match PriorityExitManager
    profitTargets: [0.5, 1.5, 3.0],
    targetExitPercents: [33, 33, 34],
    momentumCrashDropPercent: 0.5,
    momentumCrashWindowMs: 120000,
    trailingActivationPercent: 0.5,        // Phase 45 FIX: lowered from 0.8% — activate trailing earlier to lock in profits
    trailingDistancePercent: 0.3,           // Phase 45 FIX: tightened from 0.4% — keep more of the profit
    atrStopMultiplier: 1.5,
    atrTrailingMultiplier: 1.2,
    positionMaxDrawdownPercent: 0.03,    // Phase 45 FIX: widened from 2% to 3% — 2% was too tight for crypto volatility

    regimeAdjustments: {
      lowVol: {                           // Calm market: wider stops, longer holds
        stopLossMultiplier: 1.5,          // -1.8% stop (wider) [base -1.2% * 1.5]
        maxHoldTimeMultiplier: 1.3,       // 32.5 min loser hold [base 25 * 1.3]
        trailingDistanceMultiplier: 1.2,  // Wider trail
        atrStopMultiplier: 1.8,           // Wider ATR stop
      },
      normalVol: {                        // Default: use base parameters
        stopLossMultiplier: 1.0,
        maxHoldTimeMultiplier: 1.0,
        trailingDistanceMultiplier: 1.0,
        atrStopMultiplier: 1.5,
      },
      highVol: {                          // Volatile: tight stops, shorter holds
        stopLossMultiplier: 0.7,          // -0.84% stop (tighter) [base -1.2% * 0.7]
        maxHoldTimeMultiplier: 0.8,       // 20 min loser hold [base 25 * 0.8]
        trailingDistanceMultiplier: 0.8,  // Tighter trail
        atrStopMultiplier: 1.2,           // Tighter ATR stop
      },
    },
  },

  execution: {
    maxExecutionTimeMs: 500,              // Reject after 500ms
    dynamicLevelsCacheTtlMs: 30_000,      // Cache candle data 30s
    positionIdCacheTtlMs: 60_000,         // Cache position IDs 60s
    cooldownBetweenTradesMs: 5_000,       // 5s min between trades
  },

  profitLock: {
    enabled: true,                         // PRIME DIRECTIVE: only exit at net profit
    minNetProfitPercentToClose: 0.15,      // Need ≥0.15% net after fees+slippage for a non-stop exit
    estimatedRoundTripFeePercent: 0.20,    // Coinbase Advanced taker ≈0.10% × 2 legs
    estimatedSlippagePercent: 0.05,        // Conservative slippage allowance
    allowCatastrophicStop: true,           // Hard stops still fire — blow-up protection
    catastrophicStopPercent: -2.5,         // Gross PnL ≤ -2.5% is always allowed to exit
  },

  // Entry-gate hardening — all default to fail-closed (safe).
  validation: {
    failOpenOnConsensusMismatch: false,    // Veto on agent-consensus failure (was: trust upstream)
  },
  macro: {
    failClosed: true,                      // Block trades when macro data unavailable
  },
  risk: {
    failClosedOnVaRError: true,            // Block trades when VaR gate throws
  },
  entry: {
    minHistoricalCandlesRequired: 50,      // Need ≥50 historical 1h candles before entry
    priceFeedMaxStalenessMs: 5_000,        // Reject entries with price >5s stale
  },
};

// Singleton — lazily initialized, can be overridden for testing
let _config: TradingConfiguration = PRODUCTION_CONFIG;

export function getTradingConfig(): TradingConfiguration {
  return _config;
}

export function setTradingConfig(config: TradingConfiguration): void {
  _config = config;
  console.log('[TradingConfig] Configuration updated');
}

/**
 * Determine current volatility regime from ATR data
 * Returns multipliers to apply to exit parameters
 */
export function getVolatilityRegime(
  currentATRPercent: number | undefined
): 'lowVol' | 'normalVol' | 'highVol' {
  if (!currentATRPercent || currentATRPercent <= 0) return 'normalVol';
  if (currentATRPercent < 1.5) return 'lowVol';
  if (currentATRPercent > 4.0) return 'highVol';
  return 'normalVol';
}

/**
 * Get regime-adjusted exit parameters
 */
export function getRegimeAdjustedExits(atrPercent: number | undefined): {
  hardStopLossPercent: number;
  maxLoserTimeMinutes: number;
  trailingDistancePercent: number;
  atrStopMultiplier: number;
} {
  const config = getTradingConfig();
  const regime = getVolatilityRegime(atrPercent);
  const multipliers = config.exits.regimeAdjustments[regime];

  return {
    hardStopLossPercent: config.exits.hardStopLossPercent * multipliers.stopLossMultiplier,
    maxLoserTimeMinutes: config.exits.maxLoserTimeMinutes * multipliers.maxHoldTimeMultiplier,
    trailingDistancePercent: config.exits.trailingDistancePercent * multipliers.trailingDistanceMultiplier,
    atrStopMultiplier: multipliers.atrStopMultiplier,
  };
}

/**
 * Validate configuration for internal consistency
 * Call at startup to catch misconfiguration early
 */
export function validateConfig(config: TradingConfiguration): string[] {
  const errors: string[] = [];

  // Position sizing
  if (config.positionSizing.maxPositionSizePercent > config.circuitBreakers.maxSymbolConcentration) {
    errors.push(`maxPositionSize (${config.positionSizing.maxPositionSizePercent}) > maxSymbolConcentration (${config.circuitBreakers.maxSymbolConcentration})`);
  }

  if (config.positionSizing.maxTotalExposurePercent < config.positionSizing.maxPositionSizePercent * config.positionSizing.maxConcurrentPositions) {
    errors.push(`maxTotalExposure too low for maxConcurrentPositions × maxPositionSize`);
  }

  // VaR
  if (config.varLimits.maxIncrementalVaR95Percent >= config.varLimits.maxPortfolioVaR95Percent) {
    errors.push(`incrementalVaR (${config.varLimits.maxIncrementalVaR95Percent}) >= portfolioVaR (${config.varLimits.maxPortfolioVaR95Percent})`);
  }

  // Exits
  if (config.exits.hardStopLossPercent > 0) {
    errors.push(`hardStopLossPercent should be negative (current: ${config.exits.hardStopLossPercent})`);
  }

  if (errors.length > 0) {
    console.error('[TradingConfig] CONFIGURATION ERRORS:');
    errors.forEach(e => console.error(`  ❌ ${e}`));
  } else {
    console.log('[TradingConfig] ✅ Configuration validated — no conflicts');
  }

  return errors;
}
