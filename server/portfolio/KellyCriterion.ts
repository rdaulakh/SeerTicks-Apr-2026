/**
 * Kelly Criterion Position Sizing Module
 * 
 * Implements optimal position sizing based on:
 * - Win rate (probability of winning)
 * - Profit factor (average win / average loss)
 * - Agent confidence scores
 * - Portfolio risk constraints
 * 
 * Formula: f* = (p * b - q) / b
 * Where:
 * - f* = fraction of capital to risk
 * - p = probability of winning (win rate)
 * - q = probability of losing (1 - p)
 * - b = profit factor (average win / average loss)
 */

export interface KellyInput {
  winRate: number;          // 0-1 (e.g., 0.65 for 65% win rate)
  profitFactor: number;     // Average win / average loss (e.g., 2.0)
  confidence: number;       // Agent confidence 0-1
  currentPrice: number;     // Current asset price
  accountBalance: number;   // Total account balance
  maxPositionSize?: number; // Max position size as fraction (default 0.25)
  fractionOfKelly?: number; // Fraction of Kelly to use (default 0.5 for half-Kelly)
}

export interface PositionSizeResult {
  kellyFraction: number;        // Raw Kelly fraction
  adjustedFraction: number;     // Adjusted for confidence and constraints
  positionSizeUSD: number;      // Position size in USD
  positionSizeUnits: number;    // Position size in units (e.g., BTC)
  riskPercentage: number;       // Risk as percentage of account
  reasoning: string;            // Explanation of calculation
}

export class KellyCriterion {
  /**
   * Calculate optimal position size using Kelly Criterion
   */
  static calculatePositionSize(input: KellyInput): PositionSizeResult {
    const {
      winRate,
      profitFactor,
      confidence,
      currentPrice,
      accountBalance,
      maxPositionSize = 0.25, // Default max 25% of account
      fractionOfKelly = 0.5,  // Default half-Kelly for safety
    } = input;

    // Validate inputs
    if (winRate <= 0 || winRate >= 1) {
      throw new Error(`Invalid win rate: ${winRate}. Must be between 0 and 1.`);
    }
    if (profitFactor <= 0) {
      throw new Error(`Invalid profit factor: ${profitFactor}. Must be positive.`);
    }
    if (confidence < 0 || confidence > 1) {
      throw new Error(`Invalid confidence: ${confidence}. Must be between 0 and 1.`);
    }

    // Calculate Kelly fraction: f* = (p * b - q) / b
    const p = winRate;
    const q = 1 - winRate;
    const b = profitFactor;
    
    let kellyFraction = (p * b - q) / b;

    // Kelly can be negative if edge is negative (don't trade)
    if (kellyFraction <= 0) {
      return {
        kellyFraction: 0,
        adjustedFraction: 0,
        positionSizeUSD: 0,
        positionSizeUnits: 0,
        riskPercentage: 0,
        reasoning: `Negative Kelly fraction (${kellyFraction.toFixed(4)}). No edge detected. Do not trade.`,
      };
    }

    // Apply fractional Kelly (e.g., half-Kelly for reduced volatility)
    kellyFraction *= fractionOfKelly;

    // Adjust for agent confidence (reduce position if confidence is low)
    let adjustedFraction = kellyFraction * confidence;

    // Apply maximum position size constraint
    if (adjustedFraction > maxPositionSize) {
      adjustedFraction = maxPositionSize;
    }

    // Calculate position size
    const positionSizeUSD = accountBalance * adjustedFraction;
    const positionSizeUnits = positionSizeUSD / currentPrice;
    const riskPercentage = adjustedFraction * 100;

    // Build reasoning
    const reasoning = this.buildReasoning({
      kellyFraction,
      adjustedFraction,
      winRate,
      profitFactor,
      confidence,
      fractionOfKelly,
      maxPositionSize,
    });

    return {
      kellyFraction,
      adjustedFraction,
      positionSizeUSD,
      positionSizeUnits,
      riskPercentage,
      reasoning,
    };
  }

  /**
   * Calculate optimal allocation across multiple symbols
   */
  static calculatePortfolioAllocation(
    symbols: {
      symbol: string;
      winRate: number;
      profitFactor: number;
      confidence: number;
      currentPrice: number;
    }[],
    accountBalance: number,
    options: {
      maxPositionSize?: number;
      fractionOfKelly?: number;
      minConfidence?: number; // Minimum confidence to allocate capital
    } = {}
  ): Map<string, PositionSizeResult> {
    const {
      maxPositionSize = 0.25,
      fractionOfKelly = 0.5,
      minConfidence = 0.5,
    } = options;

    // Filter symbols by minimum confidence
    const eligibleSymbols = symbols.filter(s => s.confidence >= minConfidence);

    if (eligibleSymbols.length === 0) {
      return new Map();
    }

    // Calculate raw Kelly fractions for each symbol
    const kellyResults = eligibleSymbols.map(s => ({
      symbol: s.symbol,
      result: this.calculatePositionSize({
        ...s,
        accountBalance,
        maxPositionSize,
        fractionOfKelly,
      }),
    }));

    // Calculate total desired allocation
    const totalAllocation = kellyResults.reduce((sum, r) => sum + r.result.adjustedFraction, 0);

    // If total allocation exceeds 1.0, normalize proportionally
    if (totalAllocation > 1.0) {
      const scaleFactor = 1.0 / totalAllocation;
      kellyResults.forEach(r => {
        r.result.adjustedFraction *= scaleFactor;
        r.result.positionSizeUSD *= scaleFactor;
        r.result.positionSizeUnits *= scaleFactor;
        r.result.riskPercentage *= scaleFactor;
        r.result.reasoning += ` (Scaled by ${(scaleFactor * 100).toFixed(1)}% due to portfolio constraints)`;
      });
    }

    // Convert to Map
    const allocation = new Map<string, PositionSizeResult>();
    kellyResults.forEach(r => {
      allocation.set(r.symbol, r.result);
    });

    return allocation;
  }

  /**
   * Build human-readable reasoning for position size calculation
   */
  private static buildReasoning(params: {
    kellyFraction: number;
    adjustedFraction: number;
    winRate: number;
    profitFactor: number;
    confidence: number;
    fractionOfKelly: number;
    maxPositionSize: number;
  }): string {
    const {
      kellyFraction,
      adjustedFraction,
      winRate,
      profitFactor,
      confidence,
      fractionOfKelly,
      maxPositionSize,
    } = params;

    const parts: string[] = [];

    // Base Kelly calculation
    parts.push(
      `Kelly Criterion: ${(kellyFraction * 100).toFixed(2)}% of capital (Win Rate: ${(winRate * 100).toFixed(1)}%, Profit Factor: ${profitFactor.toFixed(2)})`
    );

    // Fractional Kelly adjustment
    if (fractionOfKelly < 1.0) {
      parts.push(
        `Applied ${(fractionOfKelly * 100).toFixed(0)}% Kelly for reduced volatility`
      );
    }

    // Confidence adjustment
    if (confidence < 1.0) {
      parts.push(
        `Adjusted for agent confidence: ${(confidence * 100).toFixed(0)}%`
      );
    }

    // Max position size constraint
    if (adjustedFraction >= maxPositionSize) {
      parts.push(
        `Capped at maximum position size: ${(maxPositionSize * 100).toFixed(0)}%`
      );
    }

    // Final allocation
    parts.push(
      `Final allocation: ${(adjustedFraction * 100).toFixed(2)}% of capital`
    );

    return parts.join('. ');
  }

  /**
   * Calculate expected growth rate (Kelly's advantage)
   * Higher growth rate = better risk-adjusted returns
   */
  static calculateExpectedGrowthRate(
    winRate: number,
    profitFactor: number
  ): number {
    const p = winRate;
    const q = 1 - winRate;
    const b = profitFactor;

    // Expected growth rate: p * ln(1 + b) + q * ln(1 - 1)
    // Simplified: p * ln(1 + b) - q * ln(b + 1)
    const growthRate = p * Math.log(1 + b) + q * Math.log(1 - 1 / (b + 1));

    return growthRate;
  }

  /**
   * Calculate risk of ruin (probability of losing entire capital)
   * Lower is better
   */
  static calculateRiskOfRuin(
    winRate: number,
    profitFactor: number,
    kellyFraction: number
  ): number {
    const p = winRate;
    const q = 1 - winRate;
    const b = profitFactor;

    // Risk of ruin formula (simplified)
    // RoR = (q/p)^(capital / kelly_bet)
    const riskOfRuin = Math.pow(q / p, 1 / (kellyFraction * b));

    return Math.min(riskOfRuin, 1.0); // Cap at 100%
  }
}
