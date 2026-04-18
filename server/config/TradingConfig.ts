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
    // Phase 40 FIX v2: Further tightened — 35% confidence was still letting low-conviction agents
    // (OnChainFlowAnalyst@39.6%) influence trade decisions, causing false consensus in 3B/3Be splits.
    // Root cause: weak agents were tipping the balance in evenly-split markets.
    // FIX: thresholds rescaled to match agent output range (0.05-0.20)
    minConsensusStrength: 0.12,            // rescaled from 0.50
    minConfidence: 0.10,                   // rescaled from 0.45
    minExecutionScore: 40,                 // 40/100 tactical timing — up from 30
    minAgentAgreement: 3,                  // Min 3 agents agreeing on direction — up from 2
    minDirectionRatio: 0.60,               // >60% directional dominance — up from 55%
    minCombinedScore: 0.10,                // rescaled from 0.40
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
