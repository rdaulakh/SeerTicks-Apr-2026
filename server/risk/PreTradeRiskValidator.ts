import { getDb } from "../db";
import { preTradeValidations, InsertPreTradeValidation } from "../../drizzle/schema";
import { calculateKelly, type KellyParameters } from "./KellyCriterion";
import { calculateAllVaR, type VaRResult } from "./VaRCalculator";
import { getCircuitBreakerStatus, type CircuitBreakerStatus } from "./DrawdownMonitor";
import { calculateAvailableCapital, canOpenPosition } from "./CapitalAllocationManager";
import { riskLogger } from '../utils/logger';

export interface PreTradeRequest {
  userId: number;
  strategyId?: number;
  symbol: string;
  side: "long" | "short";
  requestedQuantity: number;
  currentPrice: number;
  confidence?: number; // Win probability for Kelly
}

export interface PreTradeValidationResult {
  passed: boolean;
  overallRiskScore: number; // 0-100
  kellyCheck: {
    passed: boolean;
    optimalSize: number;
    deviation: number; // % deviation from optimal
  };
  varCheck: {
    passed: boolean;
    portfolioVaR: number;
    positionVaR: number;
    varLimit: number;
    utilization: number; // %
  };
  circuitBreakerCheck: {
    passed: boolean;
    active: boolean;
    reason?: string;
  };
  balanceCheck: {
    passed: boolean;
    availableBalance: number;
    requiredMargin: number;
    utilization: number; // %
  };
  positionLimitCheck: {
    passed: boolean;
    currentPositions: number;
    maxPositions: number;
  };
  rejectionReasons: string[];
  recommendedAction?: string;
  requiresApproval: boolean;
}

/**
 * Pre-Trade Risk Validator
 * 
 * Validates every trade against multiple risk criteria before execution:
 * - Kelly Criterion optimal sizing
 * - VaR limits
 * - Circuit breaker status
 * - Balance and margin requirements
 * - Position limits
 * 
 * All validations are logged to preTradeValidations table for audit trail.
 */
export class PreTradeRiskValidator {
  private totalCapital: number;
  private currentEquity: number;
  private openPositionsCount: number;
  private portfolioVaR: number;

  constructor(
    totalCapital: number,
    currentEquity: number,
    openPositionsCount: number,
    portfolioVaR: number
  ) {
    this.totalCapital = totalCapital;
    this.currentEquity = currentEquity;
    this.openPositionsCount = openPositionsCount;
    this.portfolioVaR = portfolioVaR;
  }

  /**
   * Validate a trade request against all risk criteria
   */
  async validateTrade(request: PreTradeRequest): Promise<PreTradeValidationResult> {
    const rejectionReasons: string[] = [];
    let overallRiskScore = 0;

    // 1. Kelly Criterion Check
    const kellyCheck = await this.validateKellyCriterion(request);
    if (!kellyCheck.passed) {
      rejectionReasons.push(
        `Position size ${request.requestedQuantity} deviates ${kellyCheck.deviation.toFixed(1)}% from Kelly optimal size ${kellyCheck.optimalSize.toFixed(4)}`
      );
    }
    overallRiskScore += kellyCheck.passed ? 20 : 0;

    // 2. VaR Check
    const varCheck = await this.validateVaR(request);
    if (!varCheck.passed) {
      rejectionReasons.push(
        `VaR utilization ${varCheck.utilization.toFixed(1)}% exceeds safe limit. Portfolio VaR: $${varCheck.portfolioVaR.toFixed(2)}, Position VaR: $${varCheck.positionVaR.toFixed(2)}`
      );
    }
    overallRiskScore += varCheck.passed ? 25 : 0;

    // 3. Circuit Breaker Check
    const circuitBreakerCheck = this.validateCircuitBreaker();
    if (!circuitBreakerCheck.passed) {
      rejectionReasons.push(
        `Circuit breaker is active: ${circuitBreakerCheck.reason}`
      );
    }
    overallRiskScore += circuitBreakerCheck.passed ? 20 : 0;

    // 4. Balance Check
    const balanceCheck = await this.validateBalance(request);
    if (!balanceCheck.passed) {
      rejectionReasons.push(
        `Insufficient available balance. Required: $${balanceCheck.requiredMargin.toFixed(2)}, Available: $${balanceCheck.availableBalance.toFixed(2)}`
      );
    }
    overallRiskScore += balanceCheck.passed ? 20 : 0;

    // 5. Position Limit Check
    const positionLimitCheck = await this.validatePositionLimits(request);
    if (!positionLimitCheck.passed) {
      rejectionReasons.push(
        `Maximum position limit reached: ${positionLimitCheck.currentPositions}/${positionLimitCheck.maxPositions}`
      );
    }
    overallRiskScore += positionLimitCheck.passed ? 15 : 0;

    // Determine if trade requires manual approval (high risk but not rejected)
    const requiresApproval = overallRiskScore >= 50 && overallRiskScore < 80;

    // Overall pass/fail
    const passed = rejectionReasons.length === 0;

    // Generate recommended action
    let recommendedAction: string | undefined;
    if (!passed) {
      if (!balanceCheck.passed) {
        recommendedAction = "Add more capital or close existing positions to free up margin";
      } else if (!circuitBreakerCheck.passed) {
        recommendedAction = "Wait for circuit breaker to reset or reduce risk exposure";
      } else if (!kellyCheck.passed) {
        recommendedAction = `Reduce position size to ${kellyCheck.optimalSize.toFixed(4)} (Kelly optimal)`;
      } else if (!varCheck.passed) {
        recommendedAction = "Reduce position size or close high-risk positions to lower VaR";
      } else if (!positionLimitCheck.passed) {
        recommendedAction = "Close existing positions before opening new ones";
      }
    } else if (requiresApproval) {
      recommendedAction = "Trade is within acceptable risk but requires manual approval";
    }

    const result: PreTradeValidationResult = {
      passed,
      overallRiskScore,
      kellyCheck,
      varCheck,
      circuitBreakerCheck,
      balanceCheck,
      positionLimitCheck,
      rejectionReasons,
      recommendedAction,
      requiresApproval,
    };

    // Log validation to database
    await this.logValidation(request, result);

    return result;
  }

  /**
   * Validate position size against Kelly Criterion
   */
  private async validateKellyCriterion(request: PreTradeRequest): Promise<{
    passed: boolean;
    optimalSize: number;
    deviation: number;
  }> {
    // Estimate mean return and std deviation based on confidence
    // Higher confidence = higher expected return
    const confidence = request.confidence || 0.6;
    const meanReturn = confidence * 0.15; // Scale to ~9% for 60% confidence
    const stdDeviation = 0.20; // 20% volatility assumption

    // Calculate Kelly optimal fraction
    const kellyParams: KellyParameters = {
      meanReturn,
      stdDeviation,
      riskFreeRate: 0.02,
      conservativeMultiplier: 0.5, // Half-Kelly for safety
    };

    const kellyResult = calculateKelly(kellyParams);
    const kellyOptimalSize = (kellyResult.adjustedFraction * this.totalCapital) / request.currentPrice;

    // Calculate deviation from optimal
    const requestedValue = request.requestedQuantity * request.currentPrice;
    const optimalValue = kellyOptimalSize * request.currentPrice;
    const deviation = optimalValue > 0 ? Math.abs((requestedValue - optimalValue) / optimalValue) * 100 : 0;

    // Allow up to 50% deviation from Kelly optimal
    const passed = deviation <= 50;

    return {
      passed,
      optimalSize: kellyOptimalSize,
      deviation,
    };
  }

  /**
   * Validate position against VaR limits
   */
  private async validateVaR(request: PreTradeRequest): Promise<{
    passed: boolean;
    portfolioVaR: number;
    positionVaR: number;
    varLimit: number;
    utilization: number;
  }> {
    // Use current portfolio VaR
    const portfolioVaR = this.portfolioVaR;

    // Calculate position VaR (simplified: 2 standard deviations)
    const positionValue = request.requestedQuantity * request.currentPrice;
    const volatility = 0.02; // 2% daily volatility assumption
    const positionVaR = positionValue * volatility * 2; // 95% confidence

    // VaR limit (10% of total capital)
    const varLimit = this.totalCapital * 0.10;

    // Calculate utilization
    const totalVaR = portfolioVaR + positionVaR;
    const utilization = (totalVaR / varLimit) * 100;

    // Pass if utilization is below 100%
    const passed = utilization <= 100;

    return {
      passed,
      portfolioVaR,
      positionVaR,
      varLimit,
      utilization,
    };
  }

  /**
   * Validate circuit breaker status
   */
  private validateCircuitBreaker(): {
    passed: boolean;
    active: boolean;
    reason?: string;
  } {
    // Calculate current drawdown
    const drawdown = ((this.totalCapital - this.currentEquity) / this.totalCapital) * 100;

    // Get circuit breaker status
    const cbStatus = getCircuitBreakerStatus(drawdown);

    // Circuit breaker is active if not green level and new positions are not allowed
    const isActive = cbStatus.level !== 'green' && !cbStatus.restrictions.allowNewPositions;
    const reason = isActive ? `Circuit breaker ${cbStatus.level.toUpperCase()}: ${cbStatus.actions.join(', ')}` : undefined;

    return {
      passed: !isActive,
      active: isActive,
      reason,
    };
  }

  /**
   * Validate available balance and margin requirements
   */
  private async validateBalance(request: PreTradeRequest): Promise<{
    passed: boolean;
    availableBalance: number;
    requiredMargin: number;
    utilization: number;
  }> {
    // Calculate available balance
    const availableBalance = this.currentEquity;

    // Calculate required margin (position value for paper trading, position value / leverage for real)
    const positionValue = request.requestedQuantity * request.currentPrice;
    const requiredMargin = positionValue; // No leverage in paper trading

    // Calculate margin utilization
    const utilization = (requiredMargin / this.totalCapital) * 100;

    // Pass if we have sufficient balance and margin utilization is reasonable
    const passed = availableBalance >= requiredMargin && utilization <= 90;

    return {
      passed,
      availableBalance,
      requiredMargin,
      utilization,
    };
  }

  /**
   * Validate position count limits
   */
  private async validatePositionLimits(request: PreTradeRequest): Promise<{
    passed: boolean;
    currentPositions: number;
    maxPositions: number;
  }> {
    // Use provided open positions count
    const currentPositions = this.openPositionsCount;

    // Default max positions (can be made configurable per user/strategy)
    const maxPositions = request.strategyId ? 5 : 10; // Strategies have lower limits

    const passed = currentPositions < maxPositions;

    return {
      passed,
      currentPositions,
      maxPositions,
    };
  }

  /**
   * Log validation result to database for audit trail
   */
  private async logValidation(
    request: PreTradeRequest,
    result: PreTradeValidationResult
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      const requestedValue = request.requestedQuantity * request.currentPrice;

      const validation: InsertPreTradeValidation = {
        userId: request.userId,
        strategyId: request.strategyId,
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.requestedQuantity.toString(),
        requestedValue: requestedValue.toString(),
        currentPrice: request.currentPrice.toString(),
        passed: result.passed,
        overallRiskScore: result.overallRiskScore.toString(),
        kellyOptimalSize: result.kellyCheck.optimalSize.toString(),
        kellyDeviation: result.kellyCheck.deviation.toString(),
        kellyPassed: result.kellyCheck.passed,
        portfolioVaR: result.varCheck.portfolioVaR.toString(),
        positionVaR: result.varCheck.positionVaR.toString(),
        varLimit: result.varCheck.varLimit.toString(),
        varUtilization: result.varCheck.utilization.toString(),
        varPassed: result.varCheck.passed,
        circuitBreakerActive: result.circuitBreakerCheck.active,
        circuitBreakerReason: result.circuitBreakerCheck.reason,
        circuitBreakerPassed: result.circuitBreakerCheck.passed,
        availableBalance: result.balanceCheck.availableBalance.toString(),
        requiredMargin: result.balanceCheck.requiredMargin.toString(),
        marginUtilization: result.balanceCheck.utilization.toString(),
        balancePassed: result.balanceCheck.passed,
        currentPositions: result.positionLimitCheck.currentPositions,
        maxPositions: result.positionLimitCheck.maxPositions,
        positionLimitPassed: result.positionLimitCheck.passed,
        rejectionReasons: JSON.stringify(result.rejectionReasons),
        recommendedAction: result.recommendedAction,
        requiresApproval: result.requiresApproval,
      };

      await db.insert(preTradeValidations).values(validation);
    } catch (error) {
      riskLogger.error('Failed to log validation', { error: (error as Error)?.message });
    }
  }
}
