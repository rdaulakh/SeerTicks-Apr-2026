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
    estimatedRoundTripFeePercent: number;  // Total entry+exit fee estimate (% of entry) — fallback when exchange unknown
    estimatedSlippagePercent: number;      // Total slippage estimate (% of entry) — fallback when exchange unknown
    allowCatastrophicStop: boolean;        // Hard stop can still fire when true
    catastrophicStopPercent: number;       // Absolute last-resort gross-pnl floor (negative %)
    // Phase 10 — per-exchange fee/slippage overrides.
    //
    // Flat `estimatedRoundTripFeePercent` undercharges Coinbase. CoinbaseAdapter
    // hardcodes taker=0.6% and maker=0.4% (1.2% round-trip at taker), while
    // PaperTradingEngine simulates Coinbase at 0.5% per leg (1.0% round-trip).
    // Binance VIP0 is ~0.05% taker (0.10% round-trip). The guard must use the
    // right drag for the exchange the position is actually on, or it approves
    // closes that are net-negative in real-world execution.
    //
    // Lookup key is `position.exchange?.toLowerCase()`. When missing or not
    // found, the guard falls back to the flat `estimatedRoundTripFeePercent`
    // + `estimatedSlippagePercent` above.
    exchangeFeeOverrides?: Record<
      string,
      { roundTripFeePercent: number; slippagePercent: number }
    >;
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
    // Phase 21 — minimum |trendPct| over the contra-trend lookback that counts
    // as a real opposing move. Below this magnitude the move is treated as
    // noise (within bid-ask spread / single-tick wobble) and DOES NOT block
    // the trade. Pre-Phase-21 this was hardcoded to 0.05% in
    // AutomatedSignalProcessor.ts which on SOL ($170) translates to $0.085 —
    // smaller than the typical 1-tick spread. The result was hyper-noise
    // sensitivity: the system rejected genuinely correct signals on micro-
    // wiggles (e.g. SOL bullish consensus blocked because price was 0.069%
    // down over 2 min — that's 12 cents on a $170 asset).
    contraTrendNoiseTolerancePct: number;
    // Phase 21 — lookback window in ms for the contra-trend price-trend check.
    // Longer windows filter out micro-noise but are slower to detect real
    // reversals. 2-minute default keeps tactical-timing utility while pairing
    // with a meaningful-move tolerance.
    contraTrendLookbackMs: number;
    // Phase 22 — Risk:Reward pre-validation gate tunables. The gate uses ATR
    // for risk distance and the technical S/R structure for reward distance,
    // and rejects trades whose reward/risk ratio falls below a regime-aware
    // minimum. Pre-Phase-22 these were hardcoded constants in
    // AutomatedSignalProcessor with a particularly nasty bug: the reward
    // distance used `resistance[0]` (the NEAREST level above price) blindly,
    // so when price was testing a recent high — which IS a meaningful S/R
    // level but only a microstructure obstacle, not a destination — the
    // gate computed e.g. R:R = 0.42 on SOL@$169.50 (resistance[0]=$170.15,
    // 65 cents away, vs 2×ATR risk of $1.54). That blocked valid breakout
    // trades on every symbol once price approached recent local highs/lows.
    //
    // Phase 22 fix: walk the S/R array nearest→furthest and pick the first
    // level that produces R:R ≥ minRR (i.e. project to the next meaningful
    // level past microstructure). Falls back to ATR-default reward when no
    // S/R clears the bar — letting the gate reject only when truly no
    // structural target gives adequate upside.
    rr: {
      // Risk distance multiplier on ATR. 2.0 ≈ 2-σ stop assuming ATR ≈ 1σ
      // intraday. Lowering this widens R:R artificially; raising it tightens
      // the gate and also makes stops too wide for fast scalps.
      riskAtrMultiplier: number;
      // Default reward distance multiplier on ATR when S/R is unavailable
      // or no structural level clears minRR. 3.0 yields R:R = 1.5 against
      // a 2.0 risk multiplier — comfortably above the 1.2 trending floor.
      defaultRewardAtrMultiplier: number;
      // Minimum R:R when superTrend agrees with consensus AND atrRatio is
      // low (trending + calm). The trend itself carries profit so a smaller
      // R:R is acceptable.
      minRrTrending: number;
      // Minimum R:R when atrRatio > volatile threshold. Higher volatility
      // means wider noise so reward must be larger to compensate.
      minRrVolatile: number;
      // Minimum R:R when superTrend disagrees with consensus (counter-
      // trend / ranging). Without trend tailwind, statistical edge requires
      // a much bigger reward asymmetry.
      minRrCounterTrend: number;
      // Default minimum R:R when none of the regime conditions match.
      minRrDefault: number;
      // atrRatio threshold (current ATR / avg ATR). At or below this AND
      // superTrend agrees → trending+calm regime.
      atrRatioTrendingMax: number;
      // atrRatio threshold above which the regime is considered "volatile"
      // regardless of superTrend agreement.
      atrRatioVolatileMin: number;
    };
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
    // Phase 5 "Winner Protection" — tightened entry gate.
    //
    // Prior state (halfway-restore after Phase 40 v2):
    //   minConsensusStrength: 0.30, minConfidence: 0.25, minCombinedScore: 0.25
    // That left the gate functionally permissive — a single 25%-confidence
    // agent could still contribute to a 30%-strength consensus, and the
    // high-loss-rate regression persisted in post-deploy telemetry
    // (`Initialized signal processor minConfidencePct=25 consensusThresholdPct=30`
    // from every UserTradingSession init).
    //
    // Phase 5 target values mirror the StrategyOrchestrator intent
    // (0.65 / 0.60) and close the "mediocre-signal still passes" gap:
    //   - minConfidence 0.25 → 0.65: individual agents must be ≥65%
    //     confident before their signal enters consensus.
    //   - minConsensusStrength 0.30 → 0.60: aggregate weighted agreement
    //     must clear 60% (institutional-grade).
    //   - minCombinedScore 0.25 → 0.55: composite floor tracks confidence.
    //
    // This is the *actual* prod bar — UserTradingSession constructs
    // AutomatedSignalProcessor from this block directly. The directive is
    // profit protection, not trade maximization. Zero trades is preferable
    // to any losing trade.
    minConsensusStrength: 0.60,            // Phase 5: was 0.30 — raise aggregate bar
    minConfidence: 0.65,                   // Phase 5: was 0.25 — raise individual-agent bar
    minExecutionScore: 40,                 // unchanged — tactical timing floor
    // Phase 19: lowered from 3 → 2 to align with the upstream `≥2 eligible`
    // gate in AutomatedSignalProcessor.processSignals. Prior 3-vs-2-vs-4
    // mismatch (this config = 3, EntryConfirmationFilter default = 4,
    // upstream filter = 2) silently killed every trade post-Phase-18:
    // 104 SIGNAL_APPROVED at consensus → 0 TRADE_EXECUTED, all rejected
    // by EntryConfirmationFilter with "Insufficient agent agreement: 2/4
    // required". `consensus.minConsensusStrength` (0.65) and
    // `consensus.minConfidence` (0.65) carry the QUALITY guarantee;
    // requiring N agents on top of that is double-counting. The upstream
    // gate is the canonical agreement floor.
    minAgentAgreement: 2,
    minDirectionRatio: 0.60,               // unchanged — >60% directional dominance
    minCombinedScore: 0.55,                // Phase 5: was 0.25 — composite floor tracks confidence
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
    // Phase 10 — this fallback is Binance-VIP0-equivalent (~0.05% taker × 2 legs
    // = 0.10% round-trip + 0.10% cushion for tier changes). Per-exchange values
    // live in `exchangeFeeOverrides` below. If a position arrives without an
    // exchange label, the guard uses this default. The previous comment here
    // incorrectly labeled it as Coinbase — Coinbase's real round-trip is 1.2%
    // (taker) / 1.0% (paper-mode sim), which the override map now handles.
    estimatedRoundTripFeePercent: 0.20,    // Binance-like fallback (0.10% real + 0.10% cushion)
    estimatedSlippagePercent: 0.05,        // Conservative slippage allowance for liquid majors
    allowCatastrophicStop: true,           // Hard stops still fire — blow-up protection
    exchangeFeeOverrides: {
      // Binance USDM futures — taker fallback 0.10% round-trip + 0.10% cushion.
      // Real-world VIP0 is ~0.05% taker; BinanceAdapter queries live fees with
      // a 0.001 fallback, so 0.20% drag is a safe ceiling.
      binance: { roundTripFeePercent: 0.20, slippagePercent: 0.05 },
      // Coinbase Advanced Trade — taker is 0.6% (CoinbaseAdapter.getTradingFees
      // hardcodes 0.004 maker / 0.006 taker). Round-trip at taker = 1.2%.
      // PaperTradingEngine.COMMISSION_RATES simulates Coinbase at 0.5% per leg
      // (1.0% round-trip), so we use 1.2% + 0.10% slip = 1.30% total drag as
      // the safe upper bound. Trades that can't clear +1.45% gross on Coinbase
      // are held rather than closed at real net-loss. This is the prime
      // directive doing its job — Coinbase's fee structure genuinely means
      // low-edge scalps are unprofitable; the guard surfaces that truth
      // instead of booking fake profits that are actually losses net of fees.
      coinbase: { roundTripFeePercent: 1.20, slippagePercent: 0.10 },
    },
    // Phase 7 — tightened to match exits.hardStopLossPercent (-1.2%).
    //   Prior value (-2.5%) created a broken hand-off: the ProfitLockGuard
    //   blocked the -1.2% hard-SL hit because gross PnL > catastrophic floor,
    //   and the IntelligentExitManager fallback bypass (line ~553) required
    //   gross ≤ -2.5% before firing — so positions bled from the real stop
    //   level to the catastrophic floor before any exit actually closed.
    //   Aligning the catastrophic floor to the hard-stop level means the
    //   bypass fires at the configured SL, and losses are capped at -1.2%
    //   gross (-1.45% net) instead of -2.5% gross (-2.75% net).
    catastrophicStopPercent: -1.2,         // Gross PnL ≤ -1.2% is always allowed to exit
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
    // Phase 21 — was 0.05% (Phase 40 tightening), too noise-sensitive.
    // 0.05% on SOL@$170 = $0.085 (bid-ask spread). Real falling knives clear
    // 0.15%+ in 2 min easily; noise below that is no-signal. This 0.15% bar
    // is what Phase 40 had ORIGINALLY before lowering it; the lowering hurt
    // more than it helped now that Phase 17/18 give us confident agents.
    contraTrendNoiseTolerancePct: 0.15,
    contraTrendLookbackMs: 120_000,        // 2 min — same as before
    // Phase 22 — R:R gate tunables, see interface comment for rationale.
    // Defaults match the prior hardcoded values so behavior is unchanged
    // for the regime-detection knobs; the substantive change is the S/R
    // walk in AutomatedSignalProcessor (helper `selectRewardDistance`).
    rr: {
      riskAtrMultiplier: 2.0,
      defaultRewardAtrMultiplier: 3.0,
      minRrTrending: 1.2,
      minRrVolatile: 1.5,
      minRrCounterTrend: 2.0,
      minRrDefault: 1.5,
      atrRatioTrendingMax: 1.2,
      atrRatioVolatileMin: 1.5,
    },
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
