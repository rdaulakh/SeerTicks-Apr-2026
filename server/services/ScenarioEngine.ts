import { getActiveClock } from '../_core/clock';
/**
 * ScenarioEngine — Best / Worst / Realistic Outcome Projection
 * 
 * Phase 30: The missing "scenario simulation" layer from the ThinkTank architecture.
 * 
 * Before a trade is executed, this engine projects three scenarios:
 * 1. BEST CASE: What happens if the signal is right and market cooperates
 * 2. WORST CASE: What happens if the signal is wrong or black swan hits
 * 3. REALISTIC CASE: Most probable outcome based on historical regime behavior
 * 
 * The output is used to:
 * - Set dynamic stop-loss and take-profit levels
 * - Adjust position sizing based on risk/reward ratio
 * - Provide the trader with clear expectations
 * - Log projected vs actual for continuous improvement
 */

export interface ScenarioProjection {
  bestCase: {
    priceTarget: number;
    pnlPercent: number;
    probability: number;
    timeframeHours: number;
    reasoning: string;
  };
  worstCase: {
    priceTarget: number;
    pnlPercent: number;
    probability: number;
    timeframeHours: number;
    reasoning: string;
  };
  realisticCase: {
    priceTarget: number;
    pnlPercent: number;
    probability: number;
    timeframeHours: number;
    reasoning: string;
  };
  riskRewardRatio: number;
  expectedValue: number;       // Probability-weighted expected PnL %
  suggestedStopLoss: number;   // Price level
  suggestedTakeProfit: number;  // Price level
  maxHoldingPeriodHours: number;
  regime: string;
}

interface VolatilityProfile {
  atr14: number;
  atrPercent: number;
  dailyRange: number;
  recentHigh: number;
  recentLow: number;
}

/**
 * Regime-specific behavior profiles based on historical crypto market data.
 * These define how far price typically moves in each regime.
 */
const REGIME_PROFILES: Record<string, {
  avgMovePercent: number;
  maxMovePercent: number;
  avgHoldHours: number;
  winRate: number;
  bestCaseMultiplier: number;
  worstCaseMultiplier: number;
}> = {
  trending_up: {
    avgMovePercent: 2.5,
    maxMovePercent: 8.0,
    avgHoldHours: 12,
    winRate: 0.62,
    bestCaseMultiplier: 2.5,
    worstCaseMultiplier: 0.8,
  },
  trending_down: {
    avgMovePercent: 3.0,
    maxMovePercent: 10.0,
    avgHoldHours: 8,
    winRate: 0.55,
    bestCaseMultiplier: 2.0,
    worstCaseMultiplier: 1.2,
  },
  range_bound: {
    avgMovePercent: 1.2,
    maxMovePercent: 3.5,
    avgHoldHours: 6,
    winRate: 0.58,
    bestCaseMultiplier: 1.5,
    worstCaseMultiplier: 0.7,
  },
  high_volatility: {
    avgMovePercent: 4.0,
    maxMovePercent: 15.0,
    avgHoldHours: 4,
    winRate: 0.48,
    bestCaseMultiplier: 3.0,
    worstCaseMultiplier: 1.5,
  },
  breakout: {
    avgMovePercent: 5.0,
    maxMovePercent: 20.0,
    avgHoldHours: 16,
    winRate: 0.45,
    bestCaseMultiplier: 4.0,
    worstCaseMultiplier: 1.0,
  },
  mean_reverting: {
    avgMovePercent: 1.5,
    maxMovePercent: 4.0,
    avgHoldHours: 8,
    winRate: 0.60,
    bestCaseMultiplier: 1.8,
    worstCaseMultiplier: 0.6,
  },
};

const DEFAULT_PROFILE = REGIME_PROFILES.range_bound;

/**
 * ScenarioEngine — projects trade outcomes before execution.
 */
export class ScenarioEngine {
  private historicalOutcomes: Array<{
    projected: ScenarioProjection;
    actual: { pnlPercent: number; holdHours: number; exitReason: string };
    regime: string;
    timestamp: number;
  }> = [];
  private readonly MAX_HISTORY = 200;

  /**
   * Project scenarios for a potential trade.
   * 
   * @param currentPrice Current market price
   * @param direction Trade direction (long/short)
   * @param consensusStrength Signal strength from aggregator (0-1)
   * @param regime Current market regime
   * @param volatility Volatility profile (ATR-based)
   * @param evaluationScore DecisionEvaluator quality score (0-1)
   */
  project(
    currentPrice: number,
    direction: 'long' | 'short',
    consensusStrength: number,
    regime: string,
    volatility?: Partial<VolatilityProfile>,
    evaluationScore?: number
  ): ScenarioProjection {
    const profile = REGIME_PROFILES[regime] || DEFAULT_PROFILE;
    const atrPercent = volatility?.atrPercent || profile.avgMovePercent;
    const qualityScore = evaluationScore || 0.5;

    // Direction multiplier: +1 for long, -1 for short
    const dirMult = direction === 'long' ? 1 : -1;

    // ========================================
    // Best Case Scenario
    // ========================================
    const bestMovePercent = atrPercent * profile.bestCaseMultiplier * (0.8 + consensusStrength * 0.4);
    const bestPriceTarget = currentPrice * (1 + dirMult * bestMovePercent / 100);
    const bestProbability = profile.winRate * (0.7 + qualityScore * 0.3) * (0.8 + consensusStrength * 0.2);
    const bestTimeframe = profile.avgHoldHours * 1.5;

    // ========================================
    // Worst Case Scenario
    // ========================================
    const worstMovePercent = atrPercent * profile.worstCaseMultiplier * (1.2 - consensusStrength * 0.2);
    const worstPriceTarget = currentPrice * (1 - dirMult * worstMovePercent / 100);
    const worstProbability = (1 - profile.winRate) * (1.2 - qualityScore * 0.2);
    const worstTimeframe = profile.avgHoldHours * 0.5; // Losses happen faster

    // ========================================
    // Realistic Case Scenario
    // ========================================
    const realisticMovePercent = atrPercent * (0.5 + consensusStrength * 0.5);
    const realisticPriceTarget = currentPrice * (1 + dirMult * realisticMovePercent / 100);
    const realisticProbability = 0.5 + (profile.winRate - 0.5) * qualityScore;
    const realisticTimeframe = profile.avgHoldHours;

    // ========================================
    // Risk/Reward Calculation
    // ========================================
    const reward = bestMovePercent * Math.min(1, bestProbability);
    const risk = worstMovePercent * Math.min(1, worstProbability);
    const riskRewardRatio = risk > 0 ? reward / risk : 1.0;

    // Expected Value: probability-weighted PnL
    const expectedValue = 
      (bestMovePercent * bestProbability * 0.3) +
      (realisticMovePercent * realisticProbability * 0.5) -
      (worstMovePercent * worstProbability * 0.2);

    // ========================================
    // Dynamic Stop-Loss and Take-Profit
    // ========================================
    // Stop-loss: worst case price with a small buffer
    const stopLossDistance = worstMovePercent * 0.8; // Tighter than worst case
    const suggestedStopLoss = currentPrice * (1 - dirMult * stopLossDistance / 100);

    // Take-profit: between realistic and best case
    const takeProfitDistance = realisticMovePercent + (bestMovePercent - realisticMovePercent) * 0.3;
    const suggestedTakeProfit = currentPrice * (1 + dirMult * takeProfitDistance / 100);

    // Max holding period based on regime
    const maxHoldingPeriodHours = bestTimeframe * 1.5;

    return {
      bestCase: {
        priceTarget: Math.round(bestPriceTarget * 100) / 100,
        pnlPercent: Math.round(bestMovePercent * 100) / 100,
        probability: Math.round(Math.min(1, bestProbability) * 100) / 100,
        timeframeHours: Math.round(bestTimeframe),
        reasoning: this.generateBestCaseReasoning(regime, direction, consensusStrength, bestMovePercent),
      },
      worstCase: {
        priceTarget: Math.round(worstPriceTarget * 100) / 100,
        pnlPercent: Math.round(-worstMovePercent * 100) / 100,
        probability: Math.round(Math.min(1, worstProbability) * 100) / 100,
        timeframeHours: Math.round(worstTimeframe),
        reasoning: this.generateWorstCaseReasoning(regime, direction, worstMovePercent),
      },
      realisticCase: {
        priceTarget: Math.round(realisticPriceTarget * 100) / 100,
        pnlPercent: Math.round(realisticMovePercent * 100) / 100,
        probability: Math.round(Math.min(1, realisticProbability) * 100) / 100,
        timeframeHours: Math.round(realisticTimeframe),
        reasoning: this.generateRealisticReasoning(regime, direction, consensusStrength, realisticMovePercent),
      },
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      expectedValue: Math.round(expectedValue * 100) / 100,
      suggestedStopLoss: Math.round(suggestedStopLoss * 100) / 100,
      suggestedTakeProfit: Math.round(suggestedTakeProfit * 100) / 100,
      maxHoldingPeriodHours: Math.round(maxHoldingPeriodHours),
      regime,
    };
  }

  /**
   * Record actual outcome for continuous improvement.
   * Compares projected scenarios against what actually happened.
   */
  recordOutcome(
    projected: ScenarioProjection,
    actual: { pnlPercent: number; holdHours: number; exitReason: string }
  ): { accuracy: string; deviation: number } {
    this.historicalOutcomes.push({
      projected,
      actual,
      regime: projected.regime,
      timestamp: getActiveClock().now(),
    });

    if (this.historicalOutcomes.length > this.MAX_HISTORY) {
      this.historicalOutcomes.shift();
    }

    // Calculate how close the realistic projection was
    const deviation = Math.abs(actual.pnlPercent - projected.realisticCase.pnlPercent);
    let accuracy = 'poor';
    if (deviation < 1) accuracy = 'excellent';
    else if (deviation < 3) accuracy = 'good';
    else if (deviation < 5) accuracy = 'fair';

    return { accuracy, deviation: Math.round(deviation * 100) / 100 };
  }

  /**
   * Get projection accuracy metrics.
   */
  getAccuracyMetrics(): {
    totalProjections: number;
    avgDeviation: number;
    accuracyByRegime: Record<string, { count: number; avgDeviation: number }>;
  } {
    if (this.historicalOutcomes.length === 0) {
      return { totalProjections: 0, avgDeviation: 0, accuracyByRegime: {} };
    }

    const totalDeviation = this.historicalOutcomes.reduce((sum, o) => {
      return sum + Math.abs(o.actual.pnlPercent - o.projected.realisticCase.pnlPercent);
    }, 0);

    const byRegime: Record<string, { count: number; totalDeviation: number }> = {};
    for (const o of this.historicalOutcomes) {
      if (!byRegime[o.regime]) {
        byRegime[o.regime] = { count: 0, totalDeviation: 0 };
      }
      byRegime[o.regime].count++;
      byRegime[o.regime].totalDeviation += Math.abs(o.actual.pnlPercent - o.projected.realisticCase.pnlPercent);
    }

    const accuracyByRegime: Record<string, { count: number; avgDeviation: number }> = {};
    for (const [regime, data] of Object.entries(byRegime)) {
      accuracyByRegime[regime] = {
        count: data.count,
        avgDeviation: Math.round((data.totalDeviation / data.count) * 100) / 100,
      };
    }

    return {
      totalProjections: this.historicalOutcomes.length,
      avgDeviation: Math.round((totalDeviation / this.historicalOutcomes.length) * 100) / 100,
      accuracyByRegime,
    };
  }

  // ========================================
  // Private reasoning generators
  // ========================================

  private generateBestCaseReasoning(regime: string, direction: string, strength: number, movePercent: number): string {
    const regimeLabel = regime.replace(/_/g, ' ');
    if (regime === 'trending_up' && direction === 'long') {
      return `Strong uptrend continuation with ${(strength * 100).toFixed(0)}% consensus. Momentum and volume support a ${movePercent.toFixed(1)}% move.`;
    }
    if (regime === 'trending_down' && direction === 'short') {
      return `Downtrend acceleration with ${(strength * 100).toFixed(0)}% consensus. Selling pressure could drive ${movePercent.toFixed(1)}% decline.`;
    }
    if (regime === 'breakout') {
      return `Breakout confirmation with ${(strength * 100).toFixed(0)}% consensus. If volume sustains, ${movePercent.toFixed(1)}% extension possible.`;
    }
    return `${regimeLabel} regime with ${(strength * 100).toFixed(0)}% consensus supports ${direction} for ${movePercent.toFixed(1)}% target.`;
  }

  private generateWorstCaseReasoning(regime: string, direction: string, movePercent: number): string {
    if (regime === 'high_volatility') {
      return `High volatility regime increases reversal risk. Sudden ${movePercent.toFixed(1)}% adverse move possible on liquidation cascade.`;
    }
    if (regime === 'breakout') {
      return `False breakout risk — if volume fades, ${movePercent.toFixed(1)}% reversal back to range likely.`;
    }
    if (regime === 'trending_up' && direction === 'short') {
      return `Counter-trend ${direction} in uptrend. ${movePercent.toFixed(1)}% squeeze risk if trend resumes.`;
    }
    if (regime === 'trending_down' && direction === 'long') {
      return `Counter-trend ${direction} in downtrend. ${movePercent.toFixed(1)}% drawdown risk if selling resumes.`;
    }
    return `Adverse ${movePercent.toFixed(1)}% move if signal invalidated. Stop-loss recommended.`;
  }

  private generateRealisticReasoning(regime: string, direction: string, strength: number, movePercent: number): string {
    const regimeLabel = regime.replace(/_/g, ' ');
    const confidenceLabel = strength > 0.7 ? 'high' : strength > 0.4 ? 'moderate' : 'low';
    return `Based on ${regimeLabel} regime behavior and ${confidenceLabel} consensus (${(strength * 100).toFixed(0)}%), most likely outcome is ${movePercent.toFixed(1)}% ${direction === 'long' ? 'gain' : 'decline'}.`;
  }
}

// Singleton
let scenarioEngine: ScenarioEngine | null = null;

export function getScenarioEngine(): ScenarioEngine {
  if (!scenarioEngine) {
    scenarioEngine = new ScenarioEngine();
  }
  return scenarioEngine;
}
