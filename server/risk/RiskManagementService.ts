/**
 * Risk Management Service
 * 
 * Integrates all risk management modules:
 * - Kelly Criterion position sizing
 * - VaR calculation and monitoring
 * - Drawdown monitoring and circuit breakers
 * - Capital allocation management
 * 
 * Provides comprehensive risk assessment and position management
 */

import {
  calculateKelly,
  calculatePositionSize,
  getVolatilityAdjustment,
  getCorrelationAdjustment,
  calculateRebalance,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,
  type KellyParameters,
  type PositionSizeParameters,
  type RebalanceParameters,
} from './KellyCriterion';

import {
  calculateAllVaR,
  calculateCVaR,
  calculateVaRContribution,
  checkVaRBreach,
  type VaRResult,
} from './VaRCalculator';

import {
  calculateDrawdown,
  getCircuitBreakerStatus,
  calculateMaxDrawdown,
  calculateUnderwaterPeriod,
  estimateRecoveryTime,
  type DrawdownMetrics,
  type CircuitBreakerStatus,
} from './DrawdownMonitor';

import {
  allocateCapital,
  calculateAvailableCapital,
  deployReserve,
  calculateReplenishmentPlan,
  calculateDynamicReserve,
  allocateAcrossStrategies,
  reallocateByPerformance,
  canOpenPosition,
  DEFAULT_ALLOCATION,
  type CapitalTiers,
  type CapitalAllocationConfig,
} from './CapitalAllocationManager';

/**
 * Comprehensive portfolio risk assessment
 */
export interface PortfolioRiskAssessment {
  // Portfolio Metrics
  portfolioValue: number;
  cashBalance: number;
  positionsValue: number;
  numberOfPositions: number;

  // VaR Metrics
  var95: VaRResult;
  var99: VaRResult;
  cvar95: number;
  cvar99: number;

  // Drawdown Metrics
  drawdown: DrawdownMetrics;
  circuitBreaker: CircuitBreakerStatus;

  // Risk-Adjusted Performance
  sharpeRatio30d: number;
  sharpeRatio60d: number;
  sharpeRatio90d: number;
  sortinoRatio: number;
  calmarRatio: number;

  // Capital Allocation
  capitalTiers: CapitalTiers;
  availableCapital: {
    availableForTrading: number;
    marginBufferRemaining: number;
    totalAvailable: number;
    utilizationPercent: number;
  };

  // Risk Status
  overallRiskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'critical';
  warnings: string[];
  recommendations: string[];
}

/**
 * Position-specific risk assessment
 */
export interface PositionRiskAssessment {
  positionId: number;
  symbol: string;
  positionValue: number;

  // Kelly Sizing
  kellyOptimalSize: number;
  currentSize: number;
  sizeDeviation: number; // % from optimal

  // VaR Metrics
  positionVaR95: number;
  varContribution: number; // Contribution to portfolio VaR

  // Correlation
  correlationWithPortfolio: number;

  // Risk Metrics
  stopLossDistance: number; // % from current price
  takeProfitDistance: number; // % from current price
  riskRewardRatio: number;

  // Recommendations
  action: 'hold' | 'increase' | 'decrease' | 'close';
  reason: string;
}

/**
 * Calculate comprehensive portfolio risk assessment
 */
export async function assessPortfolioRisk(params: {
  portfolioValue: number;
  cashBalance: number;
  positionsValue: number;
  numberOfPositions: number;
  equityCurve: number[];
  dailyReturns: number[];
  currentPositionsValue: number;
  requiredMargin: number;
  riskFreeRate?: number;
  capitalAllocationConfig?: CapitalAllocationConfig;
}): Promise<PortfolioRiskAssessment> {
  const {
    portfolioValue,
    cashBalance,
    positionsValue,
    numberOfPositions,
    equityCurve,
    dailyReturns,
    currentPositionsValue,
    requiredMargin,
    riskFreeRate = 0.03,
    capitalAllocationConfig = DEFAULT_ALLOCATION,
  } = params;

  // Calculate VaR metrics
  const var95 = calculateAllVaR(dailyReturns, portfolioValue, 0.95, 1);
  const var99 = calculateAllVaR(dailyReturns, portfolioValue, 0.99, 1);
  const cvar95 = calculateCVaR(dailyReturns, 0.95, portfolioValue);
  const cvar99 = calculateCVaR(dailyReturns, 0.99, portfolioValue);

  // Calculate drawdown metrics
  const drawdown = calculateDrawdown(portfolioValue, equityCurve);
  const circuitBreaker = getCircuitBreakerStatus(drawdown.currentDrawdown);

  // Calculate risk-adjusted performance
  const sharpeRatio30d = calculateSharpeRatio(dailyReturns.slice(-30), riskFreeRate);
  const sharpeRatio60d = calculateSharpeRatio(dailyReturns.slice(-60), riskFreeRate);
  const sharpeRatio90d = calculateSharpeRatio(dailyReturns.slice(-90), riskFreeRate);
  const sortinoRatio = calculateSortinoRatio(dailyReturns, riskFreeRate / 252);
  const calmarRatio = calculateCalmarRatio(equityCurve);

  // Calculate capital allocation
  const capitalTiers = allocateCapital(portfolioValue, capitalAllocationConfig);
  const availableCapital = calculateAvailableCapital(
    capitalTiers,
    currentPositionsValue,
    requiredMargin
  );

  // Determine overall risk level
  let overallRiskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'critical' = 'low';
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Risk level based on circuit breaker
  if (circuitBreaker.level === 'emergency') {
    overallRiskLevel = 'critical';
    warnings.push(`CRITICAL: Drawdown ${drawdown.currentDrawdown.toFixed(2)}% - Emergency protocol active`);
  } else if (circuitBreaker.level === 'red') {
    overallRiskLevel = 'high';
    warnings.push(`HIGH RISK: Drawdown ${drawdown.currentDrawdown.toFixed(2)}% - No new positions allowed`);
  } else if (circuitBreaker.level === 'orange') {
    overallRiskLevel = 'elevated';
    warnings.push(`Elevated risk: Drawdown ${drawdown.currentDrawdown.toFixed(2)}% - Reduce position sizes`);
  } else if (circuitBreaker.level === 'yellow') {
    overallRiskLevel = 'moderate';
    warnings.push(`Moderate risk: Drawdown ${drawdown.currentDrawdown.toFixed(2)}% - Increase monitoring`);
  }

  // VaR warnings
  if (var95.averageVaR > portfolioValue * 0.05) {
    warnings.push(`VaR exceeds 5% of portfolio value ($${var95.averageVaR.toFixed(2)})`);
    recommendations.push('Consider reducing position sizes or increasing diversification');
  }

  // Margin utilization warnings
  if (availableCapital.utilizationPercent > 90) {
    warnings.push(`High margin utilization: ${availableCapital.utilizationPercent.toFixed(1)}%`);
    recommendations.push('Close some positions to free up margin buffer');
  } else if (availableCapital.utilizationPercent > 70) {
    warnings.push(`Elevated margin utilization: ${availableCapital.utilizationPercent.toFixed(1)}%`);
  }

  // Sharpe ratio recommendations
  if (sharpeRatio90d < 0.5) {
    recommendations.push('Low Sharpe ratio - review strategy performance and consider adjustments');
  }

  // Diversification recommendations
  if (numberOfPositions < 3) {
    recommendations.push('Consider increasing diversification (currently only ' + numberOfPositions + ' positions)');
  }

  return {
    portfolioValue,
    cashBalance,
    positionsValue,
    numberOfPositions,
    var95,
    var99,
    cvar95,
    cvar99,
    drawdown,
    circuitBreaker,
    sharpeRatio30d,
    sharpeRatio60d,
    sharpeRatio90d,
    sortinoRatio,
    calmarRatio,
    capitalTiers,
    availableCapital,
    overallRiskLevel,
    warnings,
    recommendations,
  };
}

/**
 * Assess risk for a specific position
 */
export async function assessPositionRisk(params: {
  positionId: number;
  symbol: string;
  positionValue: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  portfolioValue: number;
  portfolioVaR: number;
  correlationWithPortfolio: number;
  historicalReturns: number[];
  kellyFraction: number;
  availableCapital: number;
}): Promise<PositionRiskAssessment> {
  const {
    positionId,
    symbol,
    positionValue,
    entryPrice,
    currentPrice,
    stopLoss,
    takeProfit,
    portfolioValue,
    portfolioVaR,
    correlationWithPortfolio,
    historicalReturns,
    kellyFraction,
    availableCapital,
  } = params;

  // Calculate Kelly optimal size
  const kellyOptimalSize = availableCapital * kellyFraction;
  const sizeDeviation = kellyOptimalSize > 0 ? ((positionValue - kellyOptimalSize) / kellyOptimalSize) * 100 : 0;

  // Calculate position VaR
  const positionVolatility = historicalReturns.length > 0
    ? Math.sqrt(
        historicalReturns.reduce((sum, r) => {
          const mean = historicalReturns.reduce((s, v) => s + v, 0) / historicalReturns.length;
          return sum + Math.pow(r - mean, 2);
        }, 0) / historicalReturns.length
      )
    : 0.02; // Default 2% volatility

  const positionVaR95 = positionValue * 1.65 * positionVolatility; // Parametric VaR at 95%

  // Calculate VaR contribution
  const varContribution = calculateVaRContribution(
    positionValue,
    positionVolatility,
    portfolioVaR,
    portfolioValue,
    correlationWithPortfolio
  );

  // Calculate risk metrics
  const stopLossDistance = currentPrice > 0 ? Math.abs((stopLoss - currentPrice) / currentPrice) * 100 : 0;
  const takeProfitDistance = currentPrice > 0 ? Math.abs((takeProfit - currentPrice) / currentPrice) * 100 : 0;
  const riskRewardRatio = stopLossDistance > 0 ? takeProfitDistance / stopLossDistance : 0;

  // Determine action and reason
  let action: 'hold' | 'increase' | 'decrease' | 'close' = 'hold';
  let reason = 'Position within optimal parameters';

  if (sizeDeviation > 50) {
    action = 'decrease';
    reason = `Position ${sizeDeviation.toFixed(1)}% above Kelly optimal - reduce to manage risk`;
  } else if (sizeDeviation < -30 && correlationWithPortfolio < 0.3) {
    action = 'increase';
    reason = `Position ${Math.abs(sizeDeviation).toFixed(1)}% below optimal and low correlation - consider increasing`;
  } else if (correlationWithPortfolio > 0.7) {
    action = 'decrease';
    reason = `High correlation (${(correlationWithPortfolio * 100).toFixed(1)}%) with portfolio - reduce for diversification`;
  } else if (riskRewardRatio < 1.5) {
    action = 'close';
    reason = `Poor risk/reward ratio (${riskRewardRatio.toFixed(2)}) - consider closing`;
  }

  return {
    positionId,
    symbol,
    positionValue,
    kellyOptimalSize,
    currentSize: positionValue,
    sizeDeviation,
    positionVaR95,
    varContribution,
    correlationWithPortfolio,
    stopLossDistance,
    takeProfitDistance,
    riskRewardRatio,
    action,
    reason,
  };
}

/**
 * Pre-trade risk check before opening new position
 */
export interface PreTradeRiskCheck {
  approved: boolean;
  reason: string;
  recommendedSize: number;
  maxAllowedSize: number;
  warnings: string[];
  circuitBreakerLevel: string;
}

export async function preTradeRiskCheck(params: {
  symbol: string;
  requestedSize: number;
  currentPrice: number;
  portfolioValue: number;
  availableCapital: number;
  currentPositionsCount: number;
  maxPositions: number;
  maxPositionSizePercent: number;
  currentDrawdown: number;
  kellyFraction: number;
  correlationWithPortfolio?: number;
  volatilityPercentile?: number;
}): Promise<PreTradeRiskCheck> {
  const {
    symbol,
    requestedSize,
    currentPrice,
    portfolioValue,
    availableCapital,
    currentPositionsCount,
    maxPositions,
    maxPositionSizePercent,
    currentDrawdown,
    kellyFraction,
    correlationWithPortfolio = 0.5,
    volatilityPercentile = 50,
  } = params;

  const warnings: string[] = [];

  // Check circuit breaker status
  const circuitBreaker = getCircuitBreakerStatus(currentDrawdown);

  if (!circuitBreaker.restrictions.allowNewPositions) {
    return {
      approved: false,
      reason: `Circuit breaker ${circuitBreaker.level.toUpperCase()}: New positions not allowed`,
      recommendedSize: 0,
      maxAllowedSize: 0,
      warnings: circuitBreaker.actions,
      circuitBreakerLevel: circuitBreaker.level,
    };
  }

  // Check position count limit
  const positionCheck = canOpenPosition(
    requestedSize,
    availableCapital,
    maxPositionSizePercent,
    portfolioValue,
    currentPositionsCount,
    maxPositions
  );

  if (!positionCheck.allowed) {
    return {
      approved: false,
      reason: positionCheck.reason,
      recommendedSize: 0,
      maxAllowedSize: positionCheck.maxAllowedSize,
      warnings,
      circuitBreakerLevel: circuitBreaker.level,
    };
  }

  // Calculate recommended size using Kelly with adjustments
  const volatilityAdj = getVolatilityAdjustment(volatilityPercentile);
  const correlationAdj = getCorrelationAdjustment(correlationWithPortfolio);

  const positionSizeResult = calculatePositionSize({
    availableCapital,
    kellyFraction,
    currentPrice,
    volatilityAdjustment: volatilityAdj,
    correlationAdjustment: correlationAdj,
    maxRiskPerTrade: 0.02, // 2% max risk
  });

  // Apply circuit breaker position size multiplier
  const adjustedRecommendedSize =
    positionSizeResult.recommendedPositionSize * circuitBreaker.restrictions.maxPositionSizeMultiplier;

  // Warnings
  if (requestedSize > adjustedRecommendedSize * 1.2) {
    warnings.push(
      `Requested size ($${requestedSize.toFixed(2)}) exceeds Kelly optimal by >20%. Recommended: $${adjustedRecommendedSize.toFixed(2)}`
    );
  }

  if (correlationWithPortfolio > 0.6) {
    warnings.push(`High correlation (${(correlationWithPortfolio * 100).toFixed(1)}%) with existing positions`);
  }

  if (volatilityPercentile > 80) {
    warnings.push(`High volatility environment - position size reduced by ${((1 - volatilityAdj) * 100).toFixed(0)}%`);
  }

  // Approve if requested size is within limits
  const approved = requestedSize <= positionCheck.maxAllowedSize;

  return {
    approved,
    reason: approved ? 'Position approved' : 'Position size exceeds limits',
    recommendedSize: adjustedRecommendedSize,
    maxAllowedSize: positionCheck.maxAllowedSize,
    warnings,
    circuitBreakerLevel: circuitBreaker.level,
  };
}

/**
 * Calculate daily rebalancing recommendations
 */
export interface RebalancingRecommendations {
  needsRebalancing: boolean;
  positions: Array<{
    positionId: number;
    symbol: string;
    currentSize: number;
    targetSize: number;
    adjustment: number;
    action: 'buy' | 'sell' | 'hold';
  }>;
  totalAdjustment: number;
  reason: string;
}

export async function calculateDailyRebalancing(params: {
  positions: Array<{
    id: number;
    symbol: string;
    currentValue: number;
    kellyFraction: number;
  }>;
  currentEquity: number;
  minRebalanceThreshold?: number;
}): Promise<RebalancingRecommendations> {
  const { positions, currentEquity, minRebalanceThreshold = 0.05 } = params;

  const recommendations: RebalancingRecommendations = {
    needsRebalancing: false,
    positions: [],
    totalAdjustment: 0,
    reason: 'No rebalancing needed',
  };

  for (const position of positions) {
    const targetSize = currentEquity * position.kellyFraction;
    const adjustment = targetSize - position.currentValue;
    const adjustmentPercent = position.currentValue > 0 ? adjustment / position.currentValue : 0;

    const needsRebalancing = Math.abs(adjustmentPercent) > minRebalanceThreshold;

    let action: 'buy' | 'sell' | 'hold' = 'hold';
    if (needsRebalancing) {
      action = adjustment > 0 ? 'buy' : 'sell';
      recommendations.needsRebalancing = true;
    }

    recommendations.positions.push({
      positionId: position.id,
      symbol: position.symbol,
      currentSize: position.currentValue,
      targetSize,
      adjustment,
      action,
    });

    recommendations.totalAdjustment += Math.abs(adjustment);
  }

  if (recommendations.needsRebalancing) {
    recommendations.reason = `Rebalancing needed: ${recommendations.positions.filter(p => p.action !== 'hold').length} positions deviate >5% from Kelly optimal`;
  }

  return recommendations;
}
