/**
 * RegimeCalibration — Centralized, Data-Driven Regime Threshold Configuration
 * 
 * Phase 31: Single source of truth for ALL regime-based adjustments across the pipeline.
 * 
 * This module replaces scattered hardcoded regime multipliers with:
 * 1. A centralized configuration object
 * 2. An adaptive calibration system that adjusts based on trade outcomes
 * 3. Per-regime performance tracking for continuous improvement
 * 
 * Architecture:
 * - MarketRegimeAI → uses getAgentWeightMultipliers() for per-agent guidance
 * - SignalAggregator → uses getFamilyWeightAdjustments() for family-level weights
 * - AutomatedSignalProcessor → uses getConsensusThresholdMultiplier() for entry gates
 * - EnhancedTradeExecutor → uses getPositionSizeMultiplier() for regime-based sizing
 * - ScenarioEngine → uses getRegimeProfile() for outcome projections
 */

// ============================================================
// TYPES
// ============================================================

export type MarketRegime = 'trending_up' | 'trending_down' | 'range_bound' | 'high_volatility' | 'breakout' | 'mean_reverting';

export interface AgentWeightConfig {
  TechnicalAnalyst: number;
  OrderFlowAnalyst: number;
  SentimentAnalyst: number;
  FundingRateAnalyst: number;
  LiquidationHeatmap: number;
  WhaleTracker: number;
  MacroAnalyst: number;
  MLPredictionAgent: number;
  PatternMatcher: number;
  VolumeProfileAnalyzer: number;
  ForexCorrelationAgent: number;
  OnChainAnalyst: number;
  OnChainFlowAnalyst: number;
  NewsSentinel: number;
  [key: string]: number;
}

export interface FamilyWeightConfig {
  technical: number;
  order_flow: number;
  on_chain: number;
  sentiment: number;
  macro: number;
  predictive: number;
  whale: number;
  funding: number;
  [key: string]: number;
}

export interface RegimeConfig {
  // Agent-level weight multipliers (used by MarketRegimeAI)
  agentWeights: AgentWeightConfig;
  // Family-level weight adjustments (used by SignalAggregator)
  familyWeights: FamilyWeightConfig;
  // Consensus threshold multiplier (used by AutomatedSignalProcessor)
  // < 1.0 = lower threshold (easier to enter), > 1.0 = higher threshold (harder to enter)
  consensusThresholdMultiplier: number;
  // Position size multiplier (used by EnhancedTradeExecutor)
  // < 1.0 = smaller positions, > 1.0 = larger positions
  positionSizeMultiplier: number;
  // Minimum confidence required from any agent to count its signal
  minAgentConfidence: number;
  // Maximum allowed dissent ratio before rejecting signal
  maxDissent: number;
  // Counter-trend penalty (applied when signal direction opposes regime)
  counterTrendPenalty: number;
  // Trade cooldown in milliseconds — minimum time between approved signals for same symbol
  tradeCooldownMs: number;
  // ATR multiplier for stop-loss distance (higher = wider stops)
  // Institutional standard: widen in volatile regimes, tighten in trending
  stopLossAtrMultiplier: number;
  // Risk:Reward ratio for take-profit (TP = stopDistance * this ratio)
  takeProfitRrRatio: number;
  // Agents to skip entirely in this regime (saves compute, reduces noise)
  skipAgents: string[];
}

// ============================================================
// CALIBRATED REGIME CONFIGURATIONS
// ============================================================

/**
 * Data-driven regime configurations.
 * 
 * Calibration rationale for each regime:
 * 
 * TRENDING_UP:
 * - Trend-following agents (Technical, OrderFlow, ML) get boosted because trends persist
 * - Sentiment dampened to avoid chasing euphoria
 * - Lower consensus threshold because trend trades have higher base win rate
 * - Larger position sizes because trends offer better risk/reward
 * 
 * TRENDING_DOWN:
 * - Similar to trending_up but with higher caution (crypto drops are faster/sharper)
 * - Funding and Liquidation boosted because leverage flushes drive down moves
 * - Slightly higher consensus threshold than trending_up (shorting crypto is riskier)
 * - Moderate position sizes (sharp reversals can occur)
 * 
 * RANGE_BOUND:
 * - Mean-reversion agents (VolumeProfile, Technical at boundaries) boosted
 * - Trend-following agents dampened (no trend to follow)
 * - Higher consensus threshold (range trades need precision)
 * - Smaller positions (limited profit potential per trade)
 * 
 * HIGH_VOLATILITY:
 * - Order flow and liquidation data are most reliable in chaos
 * - Pattern recognition and sentiment are noise in high vol
 * - Much higher consensus threshold (only trade with overwhelming agreement)
 * - Significantly smaller positions (protect capital in chaos)
 * 
 * BREAKOUT:
 * - Technical and OrderFlow critical for confirming genuine breakouts
 * - Volume confirmation essential (VolumeProfile boosted)
 * - Lower threshold to catch breakouts early (but higher than trending)
 * - Moderate-large positions (breakouts offer best risk/reward but fakeout risk)
 * 
 * MEAN_REVERTING:
 * - Sentiment at extremes is the primary signal (contrarian)
 * - Funding rates at extremes confirm mean reversion setup
 * - Higher threshold (reversal trades are inherently riskier)
 * - Moderate positions (reversals can fail)
 */
const REGIME_CONFIGS: Record<MarketRegime, RegimeConfig> = {
  trending_up: {
    tradeCooldownMs: 15_000,  // 15s — trends are directional, allow frequent entries
    stopLossAtrMultiplier: 1.5,  // Phase 40 FIX: tightened from 2.0 — was causing 4.5% avg SL distance
    takeProfitRrRatio: 2.5,      // Let winners run in trends
    skipAgents: [],           // All agents useful in trends
    agentWeights: {
      TechnicalAnalyst: 1.30,
      OrderFlowAnalyst: 1.30,
      SentimentAnalyst: 0.85,
      FundingRateAnalyst: 1.05,
      LiquidationHeatmap: 0.90,
      WhaleTracker: 1.15,
      MacroAnalyst: 1.00,
      MLPredictionAgent: 1.20,
      PatternMatcher: 1.15,
      VolumeProfileAnalyzer: 0.90,
      ForexCorrelationAgent: 1.05,
      OnChainAnalyst: 1.10,
      OnChainFlowAnalyst: 1.10,
      NewsSentinel: 0.95,
    },
    familyWeights: {
      technical: 1.30,
      order_flow: 1.20,
      on_chain: 1.10,
      sentiment: 0.85,
      macro: 1.00,
      predictive: 1.15,
      whale: 1.10,
      funding: 0.95,
    },
    consensusThresholdMultiplier: 0.82,
    positionSizeMultiplier: 1.15,
    minAgentConfidence: 0.35,
    maxDissent: 0.40,
    counterTrendPenalty: 0.20,
  },

  trending_down: {
    tradeCooldownMs: 20_000,  // 20s — downtrends are faster, slightly more caution
    stopLossAtrMultiplier: 1.6,  // Phase 40 FIX: tightened from 2.2 — was causing massive SL distances
    takeProfitRrRatio: 2.0,      // Slightly lower R:R — down moves are faster, take profit sooner
    skipAgents: [],           // All agents useful in downtrends
    agentWeights: {
      TechnicalAnalyst: 1.30,
      OrderFlowAnalyst: 1.25,
      SentimentAnalyst: 1.00,
      FundingRateAnalyst: 1.20,
      LiquidationHeatmap: 1.20,
      WhaleTracker: 1.15,
      MacroAnalyst: 1.00,
      MLPredictionAgent: 1.10,
      PatternMatcher: 1.10,
      VolumeProfileAnalyzer: 0.85,
      ForexCorrelationAgent: 1.05,
      OnChainAnalyst: 1.10,
      OnChainFlowAnalyst: 1.10,
      NewsSentinel: 1.05,
    },
    familyWeights: {
      technical: 1.25,
      order_flow: 1.20,
      on_chain: 1.10,
      sentiment: 1.05,
      macro: 1.00,
      predictive: 1.05,
      whale: 1.10,
      funding: 1.15,
    },
    consensusThresholdMultiplier: 0.85,
    positionSizeMultiplier: 1.05,
    minAgentConfidence: 0.38,
    maxDissent: 0.38,
    counterTrendPenalty: 0.22,
  },

  range_bound: {
    tradeCooldownMs: 25_000,  // Phase 47: was 45s; live audit showed 309/hr blocks. Range_bound = lowest-risk regime, doesn't need 45s gap
    stopLossAtrMultiplier: 1.2,  // Phase 40 FIX: tightened from 1.5 — range trades need tight stops
    takeProfitRrRatio: 1.5,      // Lower R:R — limited profit potential per trade in ranges
    skipAgents: ['MLPredictionAgent', 'NewsSentinel'],  // ML trend predictions unreliable in ranges; news rarely moves ranges
    agentWeights: {
      TechnicalAnalyst: 1.15,
      OrderFlowAnalyst: 1.15,
      SentimentAnalyst: 0.70,
      FundingRateAnalyst: 1.10,
      LiquidationHeatmap: 0.80,
      WhaleTracker: 0.80,
      MacroAnalyst: 0.80,
      MLPredictionAgent: 0.70,
      PatternMatcher: 0.90,
      VolumeProfileAnalyzer: 1.25,
      ForexCorrelationAgent: 0.85,
      OnChainAnalyst: 0.80,
      OnChainFlowAnalyst: 0.80,
      NewsSentinel: 0.75,
    },
    familyWeights: {
      technical: 1.15,
      order_flow: 1.10,
      on_chain: 0.80,
      sentiment: 0.75,
      macro: 0.85,
      predictive: 0.80,
      whale: 0.80,
      funding: 1.10,
    },
    consensusThresholdMultiplier: 1.30,  // Phase 40 FIX v3: lowered from 1.40 to 1.30 — 70% was blocking ALL BTC trades. Effective threshold: 50% * 1.30 = 65%. Still high enough to prevent noise trades, but allows genuinely strong signals through.
    positionSizeMultiplier: 0.60,  // Phase 40 FIX v2: reduced from 0.80 — smaller positions in range_bound to limit damage from oscillation
    minAgentConfidence: 0.50,  // Phase 40 FIX v2: raised from 0.42 — need higher conviction in range_bound
    maxDissent: 0.20,  // Phase 40 FIX v2: reduced from 0.30 — less dissent allowed in range_bound
    counterTrendPenalty: 0.15,
  },

  high_volatility: {
    tradeCooldownMs: 35_000,  // Phase 47: was 60s; audit showed 271/hr blocks. 35s still throttles rapid-fire while halving missed opportunity
    stopLossAtrMultiplier: 2.0,  // Phase 40 FIX: tightened from 3.5 — was causing 4.5%+ SL distances, too wide
    takeProfitRrRatio: 2.0,      // Standard R:R — volatility cuts both ways
    skipAgents: ['PatternMatcher', 'MLPredictionAgent', 'ForexCorrelationAgent'],  // Patterns break in chaos; ML unreliable; forex correlation decouples
    agentWeights: {
      TechnicalAnalyst: 1.00,
      OrderFlowAnalyst: 1.40,
      SentimentAnalyst: 0.50,
      FundingRateAnalyst: 1.30,
      LiquidationHeatmap: 1.50,
      WhaleTracker: 1.25,
      MacroAnalyst: 0.80,
      MLPredictionAgent: 0.75,
      PatternMatcher: 0.50,
      VolumeProfileAnalyzer: 0.70,
      ForexCorrelationAgent: 0.70,
      OnChainAnalyst: 0.90,
      OnChainFlowAnalyst: 0.90,
      NewsSentinel: 0.80,
    },
    familyWeights: {
      technical: 1.00,
      order_flow: 1.35,
      on_chain: 0.90,
      sentiment: 0.55,
      macro: 0.80,
      predictive: 0.75,
      whale: 1.20,
      funding: 1.25,
    },
    consensusThresholdMultiplier: 1.15,  // Phase 40 FIX: reduced from 1.30 — was making effective threshold 75.4%, impossible to trade
    positionSizeMultiplier: 0.55,
    minAgentConfidence: 0.50,
    maxDissent: 0.25,
    counterTrendPenalty: 0.30,
  },

  breakout: {
    tradeCooldownMs: 10_000,  // 10s — breakouts are time-sensitive, allow fast entries
    stopLossAtrMultiplier: 1.8,  // Phase 40 FIX: tightened from 2.5 — tighter protection against fakeouts
    takeProfitRrRatio: 3.0,      // High R:R — breakouts offer the best risk/reward when genuine
    skipAgents: [],           // All agents useful for breakout confirmation
    agentWeights: {
      TechnicalAnalyst: 1.40,
      OrderFlowAnalyst: 1.45,
      SentimentAnalyst: 0.85,
      FundingRateAnalyst: 1.10,
      LiquidationHeatmap: 1.10,
      WhaleTracker: 1.10,
      MacroAnalyst: 0.90,
      MLPredictionAgent: 1.20,
      PatternMatcher: 1.30,
      VolumeProfileAnalyzer: 1.30,
      ForexCorrelationAgent: 0.90,
      OnChainAnalyst: 1.00,
      OnChainFlowAnalyst: 1.00,
      NewsSentinel: 1.10,
    },
    familyWeights: {
      technical: 1.35,
      order_flow: 1.40,
      on_chain: 1.00,
      sentiment: 0.85,
      macro: 0.90,
      predictive: 1.20,
      whale: 1.05,
      funding: 1.05,
    },
    consensusThresholdMultiplier: 0.78,
    positionSizeMultiplier: 1.10,
    minAgentConfidence: 0.40,
    maxDissent: 0.35,
    counterTrendPenalty: 0.25,
  },

  mean_reverting: {
    tradeCooldownMs: 30_000,  // 30s — mean reversion needs confirmation, moderate pace
    stopLossAtrMultiplier: 1.3,  // Phase 40 FIX: tightened from 1.8 — mean reversion needs tight stops
    takeProfitRrRatio: 1.8,      // Moderate R:R — reversion targets are well-defined (mean/VWAP)
    skipAgents: ['ForexCorrelationAgent'],  // Forex correlation less relevant for mean reversion
    agentWeights: {
      TechnicalAnalyst: 1.25,
      OrderFlowAnalyst: 1.20,
      SentimentAnalyst: 1.40,
      FundingRateAnalyst: 1.30,
      LiquidationHeatmap: 1.10,
      WhaleTracker: 1.05,
      MacroAnalyst: 0.90,
      MLPredictionAgent: 0.90,
      PatternMatcher: 1.00,
      VolumeProfileAnalyzer: 1.10,
      ForexCorrelationAgent: 0.85,
      OnChainAnalyst: 0.95,
      OnChainFlowAnalyst: 0.95,
      NewsSentinel: 0.90,
    },
    familyWeights: {
      technical: 1.20,
      order_flow: 1.15,
      on_chain: 0.95,
      sentiment: 1.35,
      macro: 0.90,
      predictive: 0.90,
      whale: 1.00,
      funding: 1.25,
    },
    consensusThresholdMultiplier: 1.05,  // Phase 40 FIX: reduced from 1.10 — was making effective threshold 63.8%
    positionSizeMultiplier: 0.85,
    minAgentConfidence: 0.45,
    maxDissent: 0.30,
    counterTrendPenalty: 0.18,
  },
};

// ============================================================
// COOLDOWN DEFAULTS (used when regime is unknown)
// ============================================================
const DEFAULT_TRADE_COOLDOWN_MS = 30_000; // 30s default

// ============================================================
// ADAPTIVE CALIBRATION
// ============================================================

interface TradeOutcomeRecord {
  regime: MarketRegime;
  direction: 'long' | 'short';
  pnlPercent: number;
  consensusStrength: number;
  positionSizeMultiplier: number;
  timestamp: number;
  agentContributions: Record<string, number>; // agent name → confidence
}

/**
 * AdaptiveCalibrator — learns from trade outcomes to adjust regime thresholds.
 * 
 * Adjustments are bounded (±20% from base) to prevent runaway drift.
 * Uses exponential moving average with α=0.05 for slow, stable adaptation.
 */
class AdaptiveCalibrator {
  private outcomes: TradeOutcomeRecord[] = [];
  private readonly MAX_OUTCOMES = 500;
  private readonly LEARNING_RATE = 0.05; // Slow adaptation
  private readonly MAX_DRIFT = 0.20;     // Max ±20% from base config

  // Current adaptive adjustments (multiplied on top of base config)
  private adjustments: Record<MarketRegime, {
    consensusThreshold: number;
    positionSize: number;
    agentWeights: Record<string, number>;
  }> = {} as any;

  constructor() {
    // Initialize neutral adjustments for all regimes
    const regimes: MarketRegime[] = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];
    for (const regime of regimes) {
      this.adjustments[regime] = {
        consensusThreshold: 1.0,
        positionSize: 1.0,
        agentWeights: {},
      };
    }
  }

  /**
   * Record a trade outcome for adaptive learning.
   */
  recordOutcome(outcome: TradeOutcomeRecord): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.MAX_OUTCOMES) {
      this.outcomes.shift();
    }
    this.recalibrate(outcome.regime);
  }

  /**
   * Get the adaptive adjustment for a regime's consensus threshold.
   */
  getConsensusAdjustment(regime: MarketRegime): number {
    return this.adjustments[regime]?.consensusThreshold || 1.0;
  }

  /**
   * Get the adaptive adjustment for a regime's position size.
   */
  getPositionSizeAdjustment(regime: MarketRegime): number {
    return this.adjustments[regime]?.positionSize || 1.0;
  }

  /**
   * Get the adaptive adjustment for a specific agent in a regime.
   */
  getAgentWeightAdjustment(regime: MarketRegime, agentName: string): number {
    return this.adjustments[regime]?.agentWeights[agentName] || 1.0;
  }

  /**
   * Recalibrate adjustments based on recent outcomes for a specific regime.
   */
  private recalibrate(regime: MarketRegime): void {
    const regimeOutcomes = this.outcomes.filter(o => o.regime === regime);
    if (regimeOutcomes.length < 10) return; // Need minimum sample size

    const recent = regimeOutcomes.slice(-50); // Last 50 trades in this regime
    const winRate = recent.filter(o => o.pnlPercent > 0).length / recent.length;
    const avgPnl = recent.reduce((sum, o) => sum + o.pnlPercent, 0) / recent.length;

    // Consensus threshold adjustment:
    // If win rate is low → raise threshold (be more selective)
    // If win rate is high → lower threshold (capture more opportunities)
    const targetWinRate = 0.55; // Aim for 55% win rate
    const winRateDelta = winRate - targetWinRate;
    const thresholdAdj = 1.0 - (winRateDelta * this.LEARNING_RATE * 10);
    this.adjustments[regime].consensusThreshold = this.clampAdjustment(thresholdAdj);

    // Position size adjustment:
    // If average PnL is negative → reduce position size
    // If average PnL is positive → increase position size (slowly)
    const sizeAdj = avgPnl > 0
      ? 1.0 + (Math.min(avgPnl, 5) / 100 * this.LEARNING_RATE * 5)
      : 1.0 + (Math.max(avgPnl, -5) / 100 * this.LEARNING_RATE * 5);
    this.adjustments[regime].positionSize = this.clampAdjustment(sizeAdj);

    // Per-agent weight adjustment:
    // Track which agents contributed to winning vs losing trades
    const agentWinContrib: Record<string, number[]> = {};
    const agentLoseContrib: Record<string, number[]> = {};

    for (const outcome of recent) {
      for (const [agent, confidence] of Object.entries(outcome.agentContributions)) {
        if (outcome.pnlPercent > 0) {
          if (!agentWinContrib[agent]) agentWinContrib[agent] = [];
          agentWinContrib[agent].push(confidence);
        } else {
          if (!agentLoseContrib[agent]) agentLoseContrib[agent] = [];
          agentLoseContrib[agent].push(confidence);
        }
      }
    }

    // Adjust agent weights based on win/loss contribution
    const allAgents = new Set([...Object.keys(agentWinContrib), ...Object.keys(agentLoseContrib)]);
    for (const agent of allAgents) {
      const winConfs = agentWinContrib[agent] || [];
      const loseConfs = agentLoseContrib[agent] || [];
      const avgWinConf = winConfs.length > 0 ? winConfs.reduce((a, b) => a + b, 0) / winConfs.length : 0;
      const avgLoseConf = loseConfs.length > 0 ? loseConfs.reduce((a, b) => a + b, 0) / loseConfs.length : 0;

      // If agent is more confident in wins than losses → boost
      // If agent is more confident in losses than wins → dampen
      const confDelta = avgWinConf - avgLoseConf;
      const agentAdj = 1.0 + (confDelta * this.LEARNING_RATE * 2);
      this.adjustments[regime].agentWeights[agent] = this.clampAdjustment(agentAdj);
    }
  }

  /**
   * Clamp adjustment to prevent runaway drift.
   */
  private clampAdjustment(value: number): number {
    return Math.max(1.0 - this.MAX_DRIFT, Math.min(1.0 + this.MAX_DRIFT, value));
  }

  /**
   * Get calibration metrics for monitoring.
   */
  getMetrics(): {
    totalOutcomes: number;
    perRegime: Record<string, {
      outcomes: number;
      winRate: number;
      avgPnl: number;
      consensusAdj: number;
      positionSizeAdj: number;
    }>;
  } {
    const regimes: MarketRegime[] = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];
    const perRegime: Record<string, any> = {};

    for (const regime of regimes) {
      const regimeOutcomes = this.outcomes.filter(o => o.regime === regime);
      const winRate = regimeOutcomes.length > 0
        ? regimeOutcomes.filter(o => o.pnlPercent > 0).length / regimeOutcomes.length
        : 0;
      const avgPnl = regimeOutcomes.length > 0
        ? regimeOutcomes.reduce((sum, o) => sum + o.pnlPercent, 0) / regimeOutcomes.length
        : 0;

      perRegime[regime] = {
        outcomes: regimeOutcomes.length,
        winRate: Math.round(winRate * 100) / 100,
        avgPnl: Math.round(avgPnl * 100) / 100,
        consensusAdj: Math.round(this.adjustments[regime].consensusThreshold * 100) / 100,
        positionSizeAdj: Math.round(this.adjustments[regime].positionSize * 100) / 100,
      };
    }

    return {
      totalOutcomes: this.outcomes.length,
      perRegime,
    };
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let calibratorInstance: AdaptiveCalibrator | null = null;

function getCalibrator(): AdaptiveCalibrator {
  if (!calibratorInstance) {
    calibratorInstance = new AdaptiveCalibrator();
  }
  return calibratorInstance;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Get the full regime configuration (base + adaptive adjustments).
 */
export function getRegimeConfig(regime: MarketRegime | string): RegimeConfig {
  const baseRegime = (regime as MarketRegime) || 'range_bound';
  const config = REGIME_CONFIGS[baseRegime] || REGIME_CONFIGS.range_bound;
  return config;
}

/**
 * Get agent weight multiplier for a specific agent in a regime.
 * Combines base config + adaptive learning.
 */
export function getAgentWeightMultiplier(regime: MarketRegime | string, agentName: string): number {
  const config = getRegimeConfig(regime);
  const baseWeight = config.agentWeights[agentName] || 1.0;
  const adaptiveAdj = getCalibrator().getAgentWeightAdjustment(regime as MarketRegime, agentName);
  return Math.max(0.3, Math.min(2.0, baseWeight * adaptiveAdj));
}

/**
 * Get family weight adjustments for a regime.
 * Used by SignalAggregator.
 */
export function getFamilyWeightAdjustments(regime: MarketRegime | string): FamilyWeightConfig {
  const config = getRegimeConfig(regime);
  return { ...config.familyWeights };
}

/**
 * Get consensus threshold multiplier for a regime.
 * Combines base config + adaptive learning.
 */
export function getConsensusThresholdMultiplier(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  const adaptiveAdj = getCalibrator().getConsensusAdjustment(regime as MarketRegime);
  return Math.max(0.60, Math.min(1.60, config.consensusThresholdMultiplier * adaptiveAdj));
}

/**
 * Get position size multiplier for a regime.
 * Combines base config + adaptive learning.
 */
export function getPositionSizeMultiplier(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  const adaptiveAdj = getCalibrator().getPositionSizeAdjustment(regime as MarketRegime);
  return Math.max(0.30, Math.min(1.50, config.positionSizeMultiplier * adaptiveAdj));
}

/**
 * Get counter-trend penalty for a regime.
 */
export function getCounterTrendPenalty(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.counterTrendPenalty;
}

/**
 * Get minimum agent confidence for a regime.
 */
export function getMinAgentConfidence(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.minAgentConfidence;
}

/**
 * Get maximum dissent ratio for a regime.
 */
export function getMaxDissent(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.maxDissent;
}

/**
 * Get stop-loss ATR multiplier for a regime.
 * Used by EnhancedTradeExecutor.calculateDynamicLevels() for regime-aware stop placement.
 * Higher values = wider stops (e.g., 3.5 in high_volatility vs 1.5 in range_bound).
 */
export function getStopLossAtrMultiplier(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.stopLossAtrMultiplier || 2.5; // fallback to old hardcoded default
}

/**
 * Get take-profit risk:reward ratio for a regime.
 * TP distance = stopDistance * this ratio.
 * Higher values = bigger profit targets (e.g., 3.0 in breakout vs 1.5 in range_bound).
 */
export function getTakeProfitRrRatio(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.takeProfitRrRatio || 2.0; // fallback to old hardcoded default
}

/**
 * Get trade cooldown in milliseconds for a regime.
 * Used by AutomatedSignalProcessor to enforce per-regime minimum intervals.
 */
export function getTradeCooldownMs(regime: MarketRegime | string): number {
  const config = getRegimeConfig(regime);
  return config.tradeCooldownMs || DEFAULT_TRADE_COOLDOWN_MS;
}

/**
 * Get list of agents to skip in a regime.
 * Used by GlobalSymbolAnalyzer for selective agent activation.
 */
export function getSkipAgents(regime: MarketRegime | string): string[] {
  const config = getRegimeConfig(regime);
  return config.skipAgents || [];
}

/**
 * Record a trade outcome for adaptive calibration.
 */
export function recordCalibrationOutcome(outcome: {
  regime: MarketRegime | string;
  direction: 'long' | 'short';
  pnlPercent: number;
  consensusStrength: number;
  positionSizeMultiplier: number;
  agentContributions: Record<string, number>;
}): void {
  getCalibrator().recordOutcome({
    ...outcome,
    regime: outcome.regime as MarketRegime,
    timestamp: Date.now(),
  });
}

/**
 * Get calibration metrics for monitoring dashboard.
 */
export function getCalibrationMetrics() {
  return getCalibrator().getMetrics();
}

/**
 * Get a summary of all regime configs for debugging/display.
 */
export function getAllRegimeConfigs(): Record<string, {
  consensusThreshold: number;
  positionSize: number;
  topAgents: string[];
  bottomAgents: string[];
}> {
  const result: Record<string, any> = {};
  const regimes: MarketRegime[] = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

  for (const regime of regimes) {
    const config = REGIME_CONFIGS[regime];
    const sorted = Object.entries(config.agentWeights).sort((a, b) => b[1] - a[1]);
    result[regime] = {
      consensusThreshold: config.consensusThresholdMultiplier,
      positionSize: config.positionSizeMultiplier,
      topAgents: sorted.slice(0, 3).map(([name, w]) => `${name} (${w}x)`),
      bottomAgents: sorted.slice(-3).map(([name, w]) => `${name} (${w}x)`),
    };
  }

  return result;
}

// ============================================================
// PHASE 34: REGIME TRANSITION SMOOTHING
// ============================================================
// When regime changes (e.g., trending → high_volatility), we blend
// old and new parameters over a grace period to avoid signal whiplash.
// This prevents:
// 1. Sudden stop-loss width changes that trigger premature exits
// 2. Abrupt cooldown changes that either flood or starve signals
// 3. Position size jumps that create unbalanced risk exposure

export interface TransitionState {
  symbol: string;
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  transitionStartMs: number;
  gracePeriodMs: number;
}

/**
 * Grace period durations per transition type.
 * More disruptive transitions get longer grace periods.
 */
function getGracePeriodMs(from: MarketRegime, to: MarketRegime): number {
  // Transitions INTO high_volatility are the most dangerous — longer grace
  if (to === 'high_volatility') return 120_000; // 2 minutes
  // Transitions FROM high_volatility back to calm — also need time to normalize
  if (from === 'high_volatility') return 90_000; // 1.5 minutes
  // Breakout transitions are time-sensitive — shorter grace
  if (to === 'breakout' || from === 'breakout') return 45_000; // 45 seconds
  // Trending ↔ range transitions — moderate grace
  if ((from === 'trending_up' || from === 'trending_down') && to === 'range_bound') return 60_000;
  if (from === 'range_bound' && (to === 'trending_up' || to === 'trending_down')) return 60_000;
  // Default grace period
  return 60_000; // 1 minute
}

/**
 * RegimeTransitionSmoother — blends old/new regime parameters during transitions.
 * 
 * Architecture:
 * - Tracks per-symbol transition state
 * - When a regime change is detected, starts a grace period
 * - During grace period, all getSmoothed*() functions return blended values
 * - Blend uses linear interpolation: starts at 100% old → ends at 100% new
 * - After grace period expires, returns pure new regime values
 */
class RegimeTransitionSmoother {
  private transitions: Map<string, TransitionState> = new Map();

  /**
   * Notify the smoother that a regime change occurred for a symbol.
   */
  onRegimeChange(symbol: string, from: MarketRegime, to: MarketRegime): void {
    const gracePeriodMs = getGracePeriodMs(from, to);
    this.transitions.set(symbol, {
      symbol,
      fromRegime: from,
      toRegime: to,
      transitionStartMs: Date.now(),
      gracePeriodMs,
    });
    console.log(`[RegimeTransitionSmoother] ${symbol}: ${from} → ${to}, grace period ${(gracePeriodMs / 1000).toFixed(0)}s`);
  }

  /**
   * Get the current blend factor for a symbol.
   * Returns 0.0 = fully old regime, 1.0 = fully new regime.
   * Returns null if no active transition.
   */
  getBlendFactor(symbol: string): { factor: number; from: MarketRegime; to: MarketRegime } | null {
    const state = this.transitions.get(symbol);
    if (!state) return null;

    const elapsed = Date.now() - state.transitionStartMs;
    if (elapsed >= state.gracePeriodMs) {
      // Grace period expired — clean up and return null (fully new regime)
      this.transitions.delete(symbol);
      return null;
    }

    // Linear interpolation: 0 → 1 over grace period
    const factor = elapsed / state.gracePeriodMs;
    return { factor, from: state.fromRegime, to: state.toRegime };
  }

  /**
   * Get smoothed numeric value by blending old and new regime configs.
   */
  blendNumeric(symbol: string, currentRegime: MarketRegime, getter: (regime: MarketRegime) => number): number {
    const blend = this.getBlendFactor(symbol);
    if (!blend) return getter(currentRegime);

    const oldValue = getter(blend.from);
    const newValue = getter(blend.to);
    const blended = oldValue + (newValue - oldValue) * blend.factor;
    return blended;
  }

  /**
   * Get the active transition state for a symbol (for dashboard display).
   */
  getTransitionState(symbol: string): TransitionState | null {
    const state = this.transitions.get(symbol);
    if (!state) return null;

    const elapsed = Date.now() - state.transitionStartMs;
    if (elapsed >= state.gracePeriodMs) {
      this.transitions.delete(symbol);
      return null;
    }
    return state;
  }

  /**
   * Get all active transitions (for dashboard display).
   */
  getAllTransitions(): TransitionState[] {
    const now = Date.now();
    const active: TransitionState[] = [];
    for (const [symbol, state] of this.transitions.entries()) {
      if (now - state.transitionStartMs < state.gracePeriodMs) {
        active.push(state);
      } else {
        this.transitions.delete(symbol);
      }
    }
    return active;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let smootherInstance: RegimeTransitionSmoother | null = null;

export function getRegimeTransitionSmoother(): RegimeTransitionSmoother {
  if (!smootherInstance) {
    smootherInstance = new RegimeTransitionSmoother();
  }
  return smootherInstance;
}

// ============================================================
// SMOOTHED PUBLIC API
// ============================================================

/**
 * Get smoothed stop-loss ATR multiplier (blended during regime transitions).
 */
export function getSmoothedStopLossAtrMultiplier(regime: MarketRegime | string, symbol: string): number {
  return getRegimeTransitionSmoother().blendNumeric(
    symbol,
    regime as MarketRegime,
    (r) => getRegimeConfig(r).stopLossAtrMultiplier || 2.5
  );
}

/**
 * Get smoothed take-profit R:R ratio (blended during regime transitions).
 */
export function getSmoothedTakeProfitRrRatio(regime: MarketRegime | string, symbol: string): number {
  return getRegimeTransitionSmoother().blendNumeric(
    symbol,
    regime as MarketRegime,
    (r) => getRegimeConfig(r).takeProfitRrRatio || 2.0
  );
}

/**
 * Get smoothed trade cooldown (blended during regime transitions).
 */
export function getSmoothedTradeCooldownMs(regime: MarketRegime | string, symbol: string): number {
  return Math.round(getRegimeTransitionSmoother().blendNumeric(
    symbol,
    regime as MarketRegime,
    (r) => getRegimeConfig(r).tradeCooldownMs || DEFAULT_TRADE_COOLDOWN_MS
  ));
}

/**
 * Get smoothed position size multiplier (blended during regime transitions).
 */
export function getSmoothedPositionSizeMultiplier(regime: MarketRegime | string, symbol: string): number {
  const smoother = getRegimeTransitionSmoother();
  const adaptiveAdj = getCalibrator().getPositionSizeAdjustment(regime as MarketRegime);
  const blendedBase = smoother.blendNumeric(
    symbol,
    regime as MarketRegime,
    (r) => getRegimeConfig(r).positionSizeMultiplier
  );
  return Math.max(0.30, Math.min(1.50, blendedBase * adaptiveAdj));
}

/**
 * Get smoothed consensus threshold multiplier (blended during regime transitions).
 */
export function getSmoothedConsensusThresholdMultiplier(regime: MarketRegime | string, symbol: string): number {
  const smoother = getRegimeTransitionSmoother();
  const adaptiveAdj = getCalibrator().getConsensusAdjustment(regime as MarketRegime);
  const blendedBase = smoother.blendNumeric(
    symbol,
    regime as MarketRegime,
    (r) => getRegimeConfig(r).consensusThresholdMultiplier
  );
  return Math.max(0.60, Math.min(1.60, blendedBase * adaptiveAdj));
}
