/**
 * Kelly Criterion Position Sizing Calculator
 * 
 * Implements the Kelly Criterion for optimal position sizing and leverage calculation.
 * Based on institutional best practices from HFT firms and hedge funds.
 * 
 * Formula: f = μ / σ²
 * Where:
 *   f = optimal leverage/allocation
 *   μ = mean excess returns (returns - risk-free rate)
 *   σ = standard deviation of returns
 * 
 * Expected growth rate: g = r + (S² / 2)
 * Where:
 *   g = expected compound growth rate
 *   r = risk-free rate
 *   S = Sharpe ratio (μ / σ)
 */

export interface KellyParameters {
  meanReturn: number; // Mean return of strategy (decimal, e.g., 0.107 for 10.7%)
  stdDeviation: number; // Standard deviation of returns (decimal)
  riskFreeRate: number; // Risk-free rate (decimal, e.g., 0.03 for 3%)
  conservativeMultiplier?: number; // Conservative multiplier (default 0.5 for Half-Kelly)
}

export interface KellyResult {
  kellyFraction: number; // Raw Kelly fraction (f)
  adjustedFraction: number; // Conservative adjusted fraction
  expectedGrowthRate: number; // Expected compound growth rate
  sharpeRatio: number; // Risk-adjusted return measure
  meanExcessReturn: number; // Returns above risk-free rate
  recommendedLeverage: number; // Recommended leverage factor
}

export interface PositionSizeParameters {
  availableCapital: number; // Available capital for trading
  kellyFraction: number; // Kelly fraction to use
  currentPrice: number; // Current asset price
  volatilityAdjustment?: number; // Volatility-based adjustment (default 1.0)
  correlationAdjustment?: number; // Correlation-based adjustment (default 1.0)
  maxRiskPerTrade?: number; // Maximum risk per trade as % of capital (default 0.02 = 2%)
}

export interface PositionSizeResult {
  basePositionSize: number; // Base position size in USD
  adjustedPositionSize: number; // After volatility and correlation adjustments
  maxPositionSize: number; // Maximum allowed based on risk limits
  recommendedPositionSize: number; // Final recommended size
  quantity: number; // Number of units to trade
  riskAmount: number; // Dollar amount at risk
  riskPercent: number; // Percentage of capital at risk
}

/**
 * Calculate Kelly Criterion optimal leverage and expected growth rate
 */
export function calculateKelly(params: KellyParameters): KellyResult {
  const {
    meanReturn,
    stdDeviation,
    riskFreeRate,
    conservativeMultiplier = 0.5, // Default to Half-Kelly
  } = params;

  // Calculate mean excess return (μ)
  const meanExcessReturn = meanReturn - riskFreeRate;

  // Calculate Sharpe ratio (S = μ / σ)
  const sharpeRatio = stdDeviation > 0 ? meanExcessReturn / stdDeviation : 0;

  // Calculate Kelly fraction (f = μ / σ²)
  const kellyFraction = stdDeviation > 0 ? meanExcessReturn / (stdDeviation * stdDeviation) : 0;

  // Apply conservative multiplier (typically 0.5 for Half-Kelly)
  const adjustedFraction = kellyFraction * conservativeMultiplier;

  // Calculate expected growth rate (g = r + S²/2)
  const expectedGrowthRate = riskFreeRate + (sharpeRatio * sharpeRatio) / 2;

  // Recommended leverage is the adjusted Kelly fraction
  const recommendedLeverage = Math.max(1, adjustedFraction);

  return {
    kellyFraction,
    adjustedFraction,
    expectedGrowthRate,
    sharpeRatio,
    meanExcessReturn,
    recommendedLeverage,
  };
}

/**
 * Calculate optimal position size based on Kelly Criterion and risk constraints
 */
export function calculatePositionSize(params: PositionSizeParameters): PositionSizeResult {
  const {
    availableCapital,
    kellyFraction,
    currentPrice,
    volatilityAdjustment = 1.0,
    correlationAdjustment = 1.0,
    maxRiskPerTrade = 0.02, // 2% default
  } = params;

  // Base position size from Kelly
  const basePositionSize = availableCapital * kellyFraction;

  // Apply volatility adjustment
  // Low volatility (< 20th percentile): multiply by 1.2
  // Normal volatility: no adjustment (1.0)
  // High volatility (> 80th percentile): multiply by 0.6
  const volatilityAdjustedSize = basePositionSize * volatilityAdjustment;

  // Apply correlation adjustment
  // Correlation < 0.3: no adjustment (1.0)
  // Correlation 0.3-0.6: reduce by 20% (0.8)
  // Correlation > 0.6: reduce by 40% (0.6)
  const adjustedPositionSize = volatilityAdjustedSize * correlationAdjustment;

  // Apply maximum risk per trade limit
  const maxPositionSize = availableCapital * maxRiskPerTrade;

  // Final recommended size is the minimum of adjusted size and max risk limit
  const recommendedPositionSize = Math.min(adjustedPositionSize, maxPositionSize);

  // Calculate quantity (number of units)
  const quantity = currentPrice > 0 ? recommendedPositionSize / currentPrice : 0;

  // Calculate risk metrics
  const riskAmount = recommendedPositionSize;
  const riskPercent = availableCapital > 0 ? (riskAmount / availableCapital) * 100 : 0;

  return {
    basePositionSize,
    adjustedPositionSize,
    maxPositionSize,
    recommendedPositionSize,
    quantity,
    riskAmount,
    riskPercent,
  };
}

/**
 * Determine volatility adjustment factor based on current volatility percentile
 */
export function getVolatilityAdjustment(volatilityPercentile: number): number {
  if (volatilityPercentile < 20) {
    return 1.2; // Low volatility: increase position size
  } else if (volatilityPercentile > 80) {
    return 0.6; // High volatility: decrease position size
  } else {
    return 1.0; // Normal volatility: no adjustment
  }
}

/**
 * Determine correlation adjustment factor based on correlation with existing positions
 */
export function getCorrelationAdjustment(correlation: number): number {
  if (correlation < 0.3) {
    return 1.0; // Low correlation: no adjustment
  } else if (correlation >= 0.3 && correlation <= 0.6) {
    return 0.8; // Medium correlation: reduce by 20%
  } else {
    return 0.6; // High correlation: reduce by 40%
  }
}

/**
 * Calculate rolling Sharpe ratio from historical returns
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number,
  annualizationFactor: number = Math.sqrt(252) // Daily returns to annual
): number {
  if (returns.length === 0) return 0;

  // Calculate mean return
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate excess return
  const excessReturn = meanReturn - riskFreeRate / 252; // Assuming daily risk-free rate

  // Calculate standard deviation
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Calculate Sharpe ratio
  const sharpeRatio = stdDev > 0 ? excessReturn / stdDev : 0;

  // Annualize
  return sharpeRatio * annualizationFactor;
}

/**
 * Calculate Sortino ratio (focuses on downside deviation)
 */
export function calculateSortinoRatio(
  returns: number[],
  targetReturn: number,
  annualizationFactor: number = Math.sqrt(252)
): number {
  if (returns.length === 0) return 0;

  // Calculate mean return
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate downside deviation (only negative deviations from target)
  const downsideReturns = returns.filter((r) => r < targetReturn);
  if (downsideReturns.length === 0) return Infinity; // No downside

  const downsideVariance =
    downsideReturns.reduce((sum, r) => sum + Math.pow(r - targetReturn, 2), 0) /
    downsideReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);

  // Calculate Sortino ratio
  const sortinoRatio = downsideDev > 0 ? (meanReturn - targetReturn) / downsideDev : 0;

  // Annualize
  return sortinoRatio * annualizationFactor;
}

/**
 * Calculate Calmar ratio (return / maximum drawdown)
 */
export function calculateCalmarRatio(
  equityCurve: number[],
  annualizationFactor: number = 252
): number {
  if (equityCurve.length < 2) return 0;

  // Calculate total return
  const totalReturn = (equityCurve[equityCurve.length - 1] - equityCurve[0]) / equityCurve[0];
  const annualizedReturn = totalReturn * (annualizationFactor / equityCurve.length);

  // Calculate maximum drawdown
  let maxDrawdown = 0;
  let peak = equityCurve[0];

  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate Calmar ratio
  return maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
}

/**
 * Rebalance portfolio positions to maintain optimal Kelly leverage
 * 
 * This implements the counter-intuitive "buy into profits, sell into losses" strategy
 * that maintains optimal long-term growth rate.
 */
export interface RebalanceParameters {
  currentEquity: number; // Current account equity
  currentPositionValue: number; // Current value of positions
  targetLeverage: number; // Target Kelly leverage
  minRebalanceThreshold?: number; // Minimum deviation to trigger rebalance (default 0.05 = 5%)
}

export interface RebalanceResult {
  needsRebalancing: boolean;
  currentLeverage: number;
  targetPositionValue: number;
  adjustmentNeeded: number; // Positive = buy more, negative = sell
  adjustmentPercent: number;
  action: 'buy' | 'sell' | 'hold';
}

export function calculateRebalance(params: RebalanceParameters): RebalanceResult {
  const { currentEquity, currentPositionValue, targetLeverage, minRebalanceThreshold = 0.05 } =
    params;

  // Calculate current leverage
  const currentLeverage = currentEquity > 0 ? currentPositionValue / currentEquity : 0;

  // Calculate target position value
  const targetPositionValue = currentEquity * targetLeverage;

  // Calculate adjustment needed
  const adjustmentNeeded = targetPositionValue - currentPositionValue;
  const adjustmentPercent = currentPositionValue > 0 ? adjustmentNeeded / currentPositionValue : 0;

  // Determine if rebalancing is needed
  const needsRebalancing = Math.abs(adjustmentPercent) > minRebalanceThreshold;

  // Determine action
  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (needsRebalancing) {
    action = adjustmentNeeded > 0 ? 'buy' : 'sell';
  }

  return {
    needsRebalancing,
    currentLeverage,
    targetPositionValue,
    adjustmentNeeded,
    adjustmentPercent: adjustmentPercent * 100, // Convert to percentage
    action,
  };
}
