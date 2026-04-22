/**
 * Value-at-Risk (VaR) Calculator
 * 
 * Implements three methods for calculating VaR:
 * 1. Historical VaR: Uses actual historical returns
 * 2. Parametric VaR: Assumes normal distribution
 * 3. Monte Carlo VaR: Simulates portfolio paths
 * 
 * VaR answers: "What is the maximum expected loss over a given time period
 * at a specified confidence level?"
 */

/**
 * Calculate Historical VaR
 * Uses actual historical returns to determine worst-case loss at confidence level
 * 
 * @param returns Array of historical returns (as decimals, e.g., 0.05 for 5%)
 * @param confidenceLevel Confidence level (e.g., 0.95 for 95%, 0.99 for 99%)
 * @param portfolioValue Current portfolio value
 * @returns VaR in dollar terms
 */
export function calculateHistoricalVaR(
  returns: number[],
  confidenceLevel: number,
  portfolioValue: number
): number {
  if (returns.length === 0) return 0;

  // Sort returns from worst to best
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // Find the percentile corresponding to (1 - confidence level)
  const percentileIndex = Math.floor((1 - confidenceLevel) * sortedReturns.length);
  const varReturn = sortedReturns[percentileIndex];

  // Convert return to dollar loss (negative return = loss)
  const varDollar = Math.abs(varReturn * portfolioValue);

  return varDollar;
}

/**
 * Calculate Parametric VaR
 * Assumes returns follow a normal distribution
 * 
 * @param meanReturn Mean of historical returns
 * @param stdDeviation Standard deviation of returns
 * @param confidenceLevel Confidence level (0.95 or 0.99)
 * @param portfolioValue Current portfolio value
 * @param timeHorizon Time horizon in days (default 1)
 * @returns VaR in dollar terms
 */
export function calculateParametricVaR(
  meanReturn: number,
  stdDeviation: number,
  confidenceLevel: number,
  portfolioValue: number,
  timeHorizon: number = 1
): number {
  // Z-scores for common confidence levels
  const zScores: { [key: number]: number } = {
    0.90: 1.28,
    0.95: 1.65,
    0.99: 2.33,
  };

  const zScore = zScores[confidenceLevel] || 1.65;

  // Adjust for time horizon (square root of time rule)
  const adjustedStdDev = stdDeviation * Math.sqrt(timeHorizon);

  // Calculate VaR: VaR = portfolio_value × z_score × σ × √t - mean
  const varReturn = zScore * adjustedStdDev - meanReturn * timeHorizon;
  const varDollar = Math.abs(varReturn * portfolioValue);

  return varDollar;
}

/**
 * Calculate Monte Carlo VaR
 * Simulates portfolio paths based on historical volatility and correlation
 * 
 * @param meanReturn Mean of historical returns
 * @param stdDeviation Standard deviation of returns
 * @param confidenceLevel Confidence level (0.95 or 0.99)
 * @param portfolioValue Current portfolio value
 * @param numSimulations Number of Monte Carlo simulations (default 10,000)
 * @param timeHorizon Time horizon in days (default 1)
 * @returns VaR in dollar terms
 */
export function calculateMonteCarloVaR(
  meanReturn: number,
  stdDeviation: number,
  confidenceLevel: number,
  portfolioValue: number,
  numSimulations: number = 10000,
  timeHorizon: number = 1
): number {
  const simulatedReturns: number[] = [];

  // Run simulations
  for (let i = 0; i < numSimulations; i++) {
    // Generate random return using Box-Muller transform for normal distribution.
    //
    // Math.random() can return 0 (docs: "in the range 0 to less than 1"), and
    // Math.log(0) = -Infinity, which makes z = NaN and poisons the entire
    // simulated-returns array.  Clamp u1 to a small positive epsilon so the
    // log is always finite.  Using Number.MIN_VALUE would still underflow on
    // some engines; 1e-300 keeps -log within safe double range.
    const u1Raw = Math.random();
    const u1 = u1Raw > 0 ? u1Raw : 1e-300;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Simulate return for time horizon
    const simulatedReturn = meanReturn * timeHorizon + z * stdDeviation * Math.sqrt(timeHorizon);
    simulatedReturns.push(simulatedReturn);
  }

  // Calculate VaR from simulated returns
  return calculateHistoricalVaR(simulatedReturns, confidenceLevel, portfolioValue);
}

/**
 * Calculate all three VaR methods and return comparison
 */
export interface VaRResult {
  historicalVaR: number;
  parametricVaR: number;
  monteCarloVaR: number;
  averageVaR: number;
  confidenceLevel: number;
  timeHorizon: number;
}

export function calculateAllVaR(
  returns: number[],
  portfolioValue: number,
  confidenceLevel: number = 0.95,
  timeHorizon: number = 1
): VaRResult {
  if (returns.length === 0) {
    return {
      historicalVaR: 0,
      parametricVaR: 0,
      monteCarloVaR: 0,
      averageVaR: 0,
      confidenceLevel,
      timeHorizon,
    };
  }

  // Calculate mean and std deviation
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDeviation = Math.sqrt(variance);

  // Calculate VaR using all three methods
  const historicalVaR = calculateHistoricalVaR(returns, confidenceLevel, portfolioValue);
  const parametricVaR = calculateParametricVaR(
    meanReturn,
    stdDeviation,
    confidenceLevel,
    portfolioValue,
    timeHorizon
  );
  const monteCarloVaR = calculateMonteCarloVaR(
    meanReturn,
    stdDeviation,
    confidenceLevel,
    portfolioValue,
    10000,
    timeHorizon
  );

  // Calculate average VaR across methods
  const averageVaR = (historicalVaR + parametricVaR + monteCarloVaR) / 3;

  return {
    historicalVaR,
    parametricVaR,
    monteCarloVaR,
    averageVaR,
    confidenceLevel,
    timeHorizon,
  };
}

/**
 * Calculate Conditional VaR (CVaR) / Expected Shortfall
 * Average loss beyond the VaR threshold
 */
export function calculateCVaR(
  returns: number[],
  confidenceLevel: number,
  portfolioValue: number
): number {
  if (returns.length === 0) return 0;

  // Sort returns from worst to best
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // Find the VaR threshold
  const percentileIndex = Math.floor((1 - confidenceLevel) * sortedReturns.length);

  // Calculate average of returns beyond VaR threshold
  const tailReturns = sortedReturns.slice(0, percentileIndex + 1);
  const avgTailReturn = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;

  // Convert to dollar terms
  const cvarDollar = Math.abs(avgTailReturn * portfolioValue);

  return cvarDollar;
}

/**
 * Calculate portfolio VaR contribution for a single position
 * Measures how much a position contributes to overall portfolio VaR
 */
export function calculateVaRContribution(
  positionValue: number,
  positionVolatility: number,
  portfolioVaR: number,
  portfolioValue: number,
  correlationWithPortfolio: number
): number {
  // VaR contribution = (position value / portfolio value) × correlation × (portfolio VaR / portfolio value)
  const weight = positionValue / portfolioValue;
  const marginalVaR = correlationWithPortfolio * positionVolatility * portfolioValue;
  const varContribution = weight * marginalVaR;

  return varContribution;
}

/**
 * Calculate incremental VaR
 * Change in portfolio VaR from adding or removing a position
 */
export function calculateIncrementalVaR(
  portfolioVaRBefore: number,
  portfolioVaRAfter: number
): number {
  return portfolioVaRAfter - portfolioVaRBefore;
}

/**
 * Determine if VaR breach has occurred
 */
export interface VaRBreach {
  breached: boolean;
  actualLoss: number;
  varThreshold: number;
  excessLoss: number;
  breachPercent: number;
}

export function checkVaRBreach(actualLoss: number, varThreshold: number): VaRBreach {
  const breached = actualLoss > varThreshold;
  const excessLoss = Math.max(0, actualLoss - varThreshold);
  const breachPercent = varThreshold > 0 ? (excessLoss / varThreshold) * 100 : 0;

  return {
    breached,
    actualLoss,
    varThreshold,
    excessLoss,
    breachPercent,
  };
}
