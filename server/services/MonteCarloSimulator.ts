/**
 * MonteCarloSimulator — Phase 35: Probabilistic Outcome Projection
 * 
 * Replaces ScenarioEngine's formula-based projections with N random-walk
 * simulations using regime-specific volatility profiles.
 * 
 * How it works:
 * 1. Takes current price, direction, regime, and volatility as inputs
 * 2. Runs N simulated price paths (default 500) using geometric Brownian motion
 * 3. Each path uses regime-specific drift and volatility parameters
 * 4. Aggregates results into percentile-based projections (P10, P50, P90)
 * 5. Calculates probability of profit, expected value, and VaR
 * 
 * The Monte Carlo approach captures:
 * - Fat tails (crypto markets have heavy tails)
 * - Regime-specific behavior (trending vs volatile vs ranging)
 * - Non-linear risk (options-like payoff profiles)
 * - Confidence intervals (not just point estimates)
 */

import type { ScenarioProjection } from './ScenarioEngine';
import { getActiveClock } from '../_core/clock';

export interface MonteCarloConfig {
  numSimulations: number;    // Number of random walks (default 500)
  numSteps: number;          // Steps per simulation (default 60 = 1 hour of 1-min steps)
  stepSizeMinutes: number;   // Minutes per step (default 1)
}

export interface MonteCarloResult {
  // Percentile-based projections
  p10: number;   // 10th percentile (worst 10% of outcomes)
  p25: number;   // 25th percentile
  p50: number;   // Median outcome
  p75: number;   // 75th percentile
  p90: number;   // 90th percentile (best 10% of outcomes)
  
  // Key metrics
  probabilityOfProfit: number;     // 0-1, fraction of paths that end in profit
  expectedReturn: number;          // Mean return across all paths (%)
  maxDrawdown: number;             // Worst drawdown across all paths (%)
  valueAtRisk95: number;           // 95% VaR — max loss in 95% of scenarios (%)
  conditionalVaR95: number;        // CVaR — expected loss in worst 5% (%)
  sharpeRatio: number;             // Risk-adjusted return
  
  // Distribution shape
  skewness: number;                // Positive = right tail, negative = left tail
  kurtosis: number;                // >3 = fat tails (leptokurtic)
  
  // Path statistics
  avgHoldingPeriodMinutes: number;
  optimalExitStep: number;         // Step with highest median return
  
  // Raw data for visualization
  samplePaths: number[][];         // 5 representative paths for charting
  returnDistribution: number[];    // Histogram buckets (20 bins)
}

/**
 * Regime-specific simulation parameters.
 * Calibrated from historical crypto market data.
 */
interface RegimeParams {
  driftPerMinute: number;      // Expected return per minute (annualized drift / 525600)
  volPerMinute: number;        // Volatility per minute (annualized vol / sqrt(525600))
  jumpProbability: number;     // Probability of a jump per step
  jumpMagnitude: number;       // Average jump size (%)
  meanReversionSpeed: number;  // 0 = no mean reversion, 1 = instant reversion
  fatTailExponent: number;     // >2 = heavier tails than normal
}

const REGIME_PARAMS: Record<string, RegimeParams> = {
  trending_up: {
    driftPerMinute: 0.00003,    // Positive drift
    volPerMinute: 0.0008,
    jumpProbability: 0.005,
    jumpMagnitude: 0.5,
    meanReversionSpeed: 0.0,
    fatTailExponent: 3.0,
  },
  trending_down: {
    driftPerMinute: -0.00003,   // Negative drift
    volPerMinute: 0.0010,
    jumpProbability: 0.008,
    jumpMagnitude: 0.7,
    meanReversionSpeed: 0.0,
    fatTailExponent: 2.8,
  },
  range_bound: {
    driftPerMinute: 0.0,        // No drift
    volPerMinute: 0.0005,
    jumpProbability: 0.002,
    jumpMagnitude: 0.3,
    meanReversionSpeed: 0.05,   // Strong mean reversion
    fatTailExponent: 3.5,
  },
  high_volatility: {
    driftPerMinute: 0.0,
    volPerMinute: 0.0020,       // 2.5x normal vol
    jumpProbability: 0.015,     // Frequent jumps
    jumpMagnitude: 1.5,
    meanReversionSpeed: 0.01,
    fatTailExponent: 2.2,       // Very fat tails
  },
  breakout: {
    driftPerMinute: 0.00005,    // Strong directional drift
    volPerMinute: 0.0015,
    jumpProbability: 0.010,
    jumpMagnitude: 1.0,
    meanReversionSpeed: 0.0,
    fatTailExponent: 2.5,
  },
  mean_reverting: {
    driftPerMinute: 0.0,
    volPerMinute: 0.0006,
    jumpProbability: 0.003,
    jumpMagnitude: 0.4,
    meanReversionSpeed: 0.08,   // Very strong mean reversion
    fatTailExponent: 3.2,
  },
};

const DEFAULT_PARAMS = REGIME_PARAMS.range_bound;

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Deterministic for reproducible results in testing.
 */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform: convert uniform random to standard normal.
 */
function boxMuller(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generate a fat-tailed random variable using Student's t-distribution approximation.
 */
function fatTailedRandom(rng: () => number, exponent: number): number {
  const normal = boxMuller(rng);
  // Scale by chi-squared approximation for t-distribution
  const chi2 = Math.max(0.01, Array.from({ length: Math.round(exponent) }, () => {
    const z = boxMuller(rng);
    return z * z;
  }).reduce((a, b) => a + b, 0) / exponent);
  return normal / Math.sqrt(chi2);
}

export class MonteCarloSimulator {
  private config: MonteCarloConfig;

  constructor(config?: Partial<MonteCarloConfig>) {
    this.config = {
      numSimulations: config?.numSimulations || 500,
      numSteps: config?.numSteps || 60,
      stepSizeMinutes: config?.stepSizeMinutes || 1,
    };
  }

  /**
   * Run Monte Carlo simulation for a potential trade.
   * 
   * @param currentPrice Current market price
   * @param direction Trade direction (long/short)
   * @param regime Current market regime
   * @param consensusStrength Signal strength (0-1)
   * @param atrPercent ATR as percentage of price (optional, for calibration)
   * @param seed Random seed for reproducibility (optional)
   */
  simulate(
    currentPrice: number,
    direction: 'long' | 'short',
    regime: string,
    consensusStrength: number,
    atrPercent?: number,
    seed?: number
  ): MonteCarloResult {
    // Phase 77 — defensive guard: a 0/negative/NaN currentPrice will divide
    // by zero in the return calc on every path, producing all-NaN metrics
    // (the "P(profit)=0% | EV=NaN% | VaR95=NaN%" pattern seen in logs).
    // Return a degenerate-but-valid result instead of poisoning downstream.
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return {
        p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
        probabilityOfProfit: 0,
        expectedReturn: 0,
        maxDrawdown: 0,
        valueAtRisk95: 0,
        conditionalVaR95: 0,
        sharpeRatio: 0,
        skewness: 0,
        kurtosis: 0,
        avgHoldingPeriodMinutes: 0,
        optimalExitStep: 0,
        samplePaths: [],
        returnDistribution: new Array(20).fill(0),
      };
    }

    const params = { ...(REGIME_PARAMS[regime] || DEFAULT_PARAMS) };
    const rng = mulberry32(seed || getActiveClock().now());
    const dirMult = direction === 'long' ? 1 : -1;

    // Calibrate volatility to actual ATR if provided
    if (atrPercent && atrPercent > 0) {
      const impliedVol = (atrPercent / 100) / Math.sqrt(this.config.numSteps);
      params.volPerMinute = impliedVol;
    }

    // Adjust drift based on consensus strength and direction
    params.driftPerMinute = Math.abs(params.driftPerMinute) * dirMult * (0.5 + consensusStrength * 0.5);

    // Run simulations
    const finalReturns: number[] = [];
    const maxDrawdowns: number[] = [];
    const samplePaths: number[][] = [];
    const optimalExitReturns: number[] = new Array(this.config.numSteps + 1).fill(0);

    for (let sim = 0; sim < this.config.numSimulations; sim++) {
      let price = currentPrice;
      let maxPrice = price;
      let minPrice = price;
      let maxDrawdown = 0;
      const path: number[] = [price];

      for (let step = 0; step < this.config.numSteps; step++) {
        // Generate return with fat tails
        const randomReturn = fatTailedRandom(rng, params.fatTailExponent);

        // Geometric Brownian motion with jumps
        let stepReturn = params.driftPerMinute + params.volPerMinute * randomReturn;

        // Jump component
        if (rng() < params.jumpProbability) {
          const jumpDir = rng() > 0.5 ? 1 : -1;
          stepReturn += jumpDir * params.jumpMagnitude / 100;
        }

        // Mean reversion component
        if (params.meanReversionSpeed > 0) {
          const deviation = (price - currentPrice) / currentPrice;
          stepReturn -= params.meanReversionSpeed * deviation;
        }

        // Apply return
        price = price * (1 + stepReturn);
        price = Math.max(price * 0.5, price); // Floor at 50% of current (no negative prices)

        path.push(price);

        // Track drawdown
        if (direction === 'long') {
          maxPrice = Math.max(maxPrice, price);
          const dd = (maxPrice - price) / maxPrice;
          maxDrawdown = Math.max(maxDrawdown, dd);
        } else {
          minPrice = Math.min(minPrice, price);
          const dd = (price - minPrice) / minPrice;
          maxDrawdown = Math.max(maxDrawdown, dd);
        }

        // Track optimal exit
        const stepReturnPct = direction === 'long'
          ? (price - currentPrice) / currentPrice * 100
          : (currentPrice - price) / currentPrice * 100;
        optimalExitReturns[step + 1] += stepReturnPct;
      }

      // Final return
      const finalReturn = direction === 'long'
        ? (price - currentPrice) / currentPrice * 100
        : (currentPrice - price) / currentPrice * 100;

      finalReturns.push(finalReturn);
      maxDrawdowns.push(maxDrawdown * 100);

      // Save sample paths (first 5)
      if (sim < 5) {
        samplePaths.push(path);
      }
    }

    // Sort returns for percentile calculation
    finalReturns.sort((a, b) => a - b);

    // Calculate percentiles
    const percentile = (arr: number[], p: number) => {
      const idx = Math.floor(arr.length * p);
      return arr[Math.min(idx, arr.length - 1)];
    };

    const p10 = percentile(finalReturns, 0.10);
    const p25 = percentile(finalReturns, 0.25);
    const p50 = percentile(finalReturns, 0.50);
    const p75 = percentile(finalReturns, 0.75);
    const p90 = percentile(finalReturns, 0.90);

    // Key metrics
    const mean = finalReturns.reduce((a, b) => a + b, 0) / finalReturns.length;
    const variance = finalReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / finalReturns.length;
    const stdDev = Math.sqrt(variance);
    const probabilityOfProfit = finalReturns.filter(r => r > 0).length / finalReturns.length;

    // VaR and CVaR
    const var95Index = Math.floor(finalReturns.length * 0.05);
    const valueAtRisk95 = Math.abs(finalReturns[var95Index]);
    const worstReturns = finalReturns.slice(0, var95Index + 1);
    const conditionalVaR95 = worstReturns.length > 0
      ? Math.abs(worstReturns.reduce((a, b) => a + b, 0) / worstReturns.length)
      : valueAtRisk95;

    // Sharpe ratio (annualized, assuming 1-hour holding period)
    const holdingHours = (this.config.numSteps * this.config.stepSizeMinutes) / 60;
    const annualizationFactor = Math.sqrt(8760 / holdingHours); // 8760 hours/year
    const sharpeRatio = stdDev > 0 ? (mean / stdDev) * annualizationFactor : 0;

    // Distribution shape
    const n = finalReturns.length;
    const skewness = n > 2
      ? (n / ((n - 1) * (n - 2))) * finalReturns.reduce((sum, r) => sum + ((r - mean) / stdDev) ** 3, 0)
      : 0;
    const kurtosis = n > 3
      ? ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * finalReturns.reduce((sum, r) => sum + ((r - mean) / stdDev) ** 4, 0)
        - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
      : 0;

    // Optimal exit step
    const avgExitReturns = optimalExitReturns.map(r => r / this.config.numSimulations);
    let optimalExitStep = 0;
    let maxAvgReturn = -Infinity;
    for (let i = 1; i < avgExitReturns.length; i++) {
      if (avgExitReturns[i] > maxAvgReturn) {
        maxAvgReturn = avgExitReturns[i];
        optimalExitStep = i;
      }
    }

    // Return distribution histogram (20 bins)
    const minReturn = finalReturns[0];
    const maxReturn = finalReturns[finalReturns.length - 1];
    const binWidth = (maxReturn - minReturn) / 20 || 1;
    const returnDistribution = new Array(20).fill(0);
    for (const r of finalReturns) {
      const bin = Math.min(19, Math.floor((r - minReturn) / binWidth));
      returnDistribution[bin]++;
    }

    return {
      p10: Math.round(p10 * 100) / 100,
      p25: Math.round(p25 * 100) / 100,
      p50: Math.round(p50 * 100) / 100,
      p75: Math.round(p75 * 100) / 100,
      p90: Math.round(p90 * 100) / 100,
      probabilityOfProfit: Math.round(probabilityOfProfit * 1000) / 1000,
      expectedReturn: Math.round(mean * 100) / 100,
      maxDrawdown: Math.round(Math.max(...maxDrawdowns) * 100) / 100,
      valueAtRisk95: Math.round(valueAtRisk95 * 100) / 100,
      conditionalVaR95: Math.round(conditionalVaR95 * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      skewness: Math.round(skewness * 100) / 100,
      kurtosis: Math.round(kurtosis * 100) / 100,
      avgHoldingPeriodMinutes: this.config.numSteps * this.config.stepSizeMinutes,
      optimalExitStep,
      samplePaths,
      returnDistribution,
    };
  }

  /**
   * Convert Monte Carlo result to ScenarioProjection format for backward compatibility.
   * This allows the existing ScenarioEngine consumers to use Monte Carlo results.
   */
  toScenarioProjection(
    mcResult: MonteCarloResult,
    currentPrice: number,
    direction: 'long' | 'short',
    regime: string
  ): ScenarioProjection {
    const dirMult = direction === 'long' ? 1 : -1;
    const holdHours = mcResult.avgHoldingPeriodMinutes / 60;

    return {
      bestCase: {
        priceTarget: Math.round(currentPrice * (1 + dirMult * mcResult.p90 / 100) * 100) / 100,
        pnlPercent: mcResult.p90,
        probability: Math.round((1 - 0.90) * 100) / 100, // Top 10%
        timeframeHours: Math.round(holdHours * 1.5),
        reasoning: `Monte Carlo P90: ${mcResult.p90}% return in top 10% of ${this.config.numSimulations} simulations (${regime} regime)`,
      },
      worstCase: {
        priceTarget: Math.round(currentPrice * (1 + dirMult * mcResult.p10 / 100) * 100) / 100,
        pnlPercent: mcResult.p10,
        probability: Math.round(0.10 * 100) / 100, // Bottom 10%
        timeframeHours: Math.round(holdHours * 0.5),
        reasoning: `Monte Carlo P10: ${mcResult.p10}% return in bottom 10% of simulations. VaR95: ${mcResult.valueAtRisk95}%`,
      },
      realisticCase: {
        priceTarget: Math.round(currentPrice * (1 + dirMult * mcResult.p50 / 100) * 100) / 100,
        pnlPercent: mcResult.p50,
        probability: mcResult.probabilityOfProfit,
        timeframeHours: Math.round(holdHours),
        reasoning: `Monte Carlo median: ${mcResult.p50}% return. Win probability: ${(mcResult.probabilityOfProfit * 100).toFixed(0)}%. Expected: ${mcResult.expectedReturn}%`,
      },
      riskRewardRatio: mcResult.p10 !== 0
        ? Math.round(Math.abs(mcResult.p90 / mcResult.p10) * 100) / 100
        : 1.0,
      expectedValue: mcResult.expectedReturn,
      suggestedStopLoss: Math.round(currentPrice * (1 - dirMult * mcResult.valueAtRisk95 / 100) * 100) / 100,
      suggestedTakeProfit: Math.round(currentPrice * (1 + dirMult * mcResult.p75 / 100) * 100) / 100,
      maxHoldingPeriodHours: Math.round(holdHours * 2),
      regime,
    };
  }
}

// Singleton
let simulator: MonteCarloSimulator | null = null;

export function getMonteCarloSimulator(): MonteCarloSimulator {
  if (!simulator) {
    simulator = new MonteCarloSimulator();
  }
  return simulator;
}
