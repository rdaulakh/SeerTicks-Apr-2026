/**
 * Capital Allocation Manager
 * 
 * Implements four-tier capital structure:
 * 1. Active Trading Capital (60-70%): Currently deployed in positions
 * 2. Maintenance Margin Buffer (15-20%): Prevents margin calls
 * 3. Drawdown Protection Reserve (10-15%): Activates during drawdowns
 * 4. Opportunity Capital (5-10%): Reserved for high-conviction setups
 */

export interface CapitalTiers {
  totalCapital: number;
  activeTradingCapital: number;
  maintenanceMarginBuffer: number;
  drawdownProtectionReserve: number;
  opportunityCapital: number;
}

export interface CapitalAllocationConfig {
  activeTradingPercent: number; // 60-70%
  marginBufferPercent: number; // 15-20%
  drawdownReservePercent: number; // 10-15%
  opportunityPercent: number; // 5-10%
}

export interface ReserveDeployment {
  tier: 1 | 2 | 3;
  amountDeployed: number;
  percentDeployed: number;
  remainingReserve: number;
  trigger: 'drawdown_10' | 'drawdown_15' | 'drawdown_20';
  actions: string[];
}

/**
 * Default institutional-grade allocation
 */
export const DEFAULT_ALLOCATION: CapitalAllocationConfig = {
  activeTradingPercent: 65,
  marginBufferPercent: 18,
  drawdownReservePercent: 12,
  opportunityPercent: 5,
};

/**
 * Calculate capital allocation across four tiers
 */
export function allocateCapital(
  totalCapital: number,
  config: CapitalAllocationConfig = DEFAULT_ALLOCATION
): CapitalTiers {
  // Validate percentages sum to 100
  const totalPercent =
    config.activeTradingPercent +
    config.marginBufferPercent +
    config.drawdownReservePercent +
    config.opportunityPercent;

  if (Math.abs(totalPercent - 100) > 0.01) {
    throw new Error(`Capital allocation percentages must sum to 100%, got ${totalPercent}%`);
  }

  return {
    totalCapital,
    activeTradingCapital: (totalCapital * config.activeTradingPercent) / 100,
    maintenanceMarginBuffer: (totalCapital * config.marginBufferPercent) / 100,
    drawdownProtectionReserve: (totalCapital * config.drawdownReservePercent) / 100,
    opportunityCapital: (totalCapital * config.opportunityPercent) / 100,
  };
}

/**
 * Calculate available capital for new positions
 */
export function calculateAvailableCapital(
  tiers: CapitalTiers,
  currentPositionsValue: number,
  requiredMargin: number
): {
  availableForTrading: number;
  marginBufferRemaining: number;
  totalAvailable: number;
  utilizationPercent: number;
} {
  // Available for trading = Active trading capital - currently deployed
  const availableForTrading = Math.max(0, tiers.activeTradingCapital - currentPositionsValue);

  // Margin buffer remaining = Buffer - required margin
  const marginBufferRemaining = Math.max(0, tiers.maintenanceMarginBuffer - requiredMargin);

  // Total available = Available trading + margin buffer (if needed)
  const totalAvailable = availableForTrading + marginBufferRemaining;

  // Utilization percentage
  const utilizationPercent =
    tiers.activeTradingCapital > 0
      ? (currentPositionsValue / tiers.activeTradingCapital) * 100
      : 0;

  return {
    availableForTrading,
    marginBufferRemaining,
    totalAvailable,
    utilizationPercent,
  };
}

/**
 * Deploy drawdown protection reserve based on drawdown severity
 */
export function deployReserve(
  drawdownPercent: number,
  reserveAmount: number,
  previousDeployments: number = 0
): ReserveDeployment | null {
  const availableReserve = reserveAmount - previousDeployments;

  if (drawdownPercent >= 10 && drawdownPercent < 15) {
    // Tier 1: Deploy 30% of reserve
    const deploymentPercent = 0.3;
    const amountToDeploy = availableReserve * deploymentPercent;

    return {
      tier: 1,
      amountDeployed: amountToDeploy,
      percentDeployed: deploymentPercent * 100,
      remainingReserve: availableReserve - amountToDeploy,
      trigger: 'drawdown_10',
      actions: [
        'Deploy 30% of reserve capital',
        'Maintain existing positions',
        'Prevent forced liquidations',
        'Allow strategies time to recover',
      ],
    };
  } else if (drawdownPercent >= 15 && drawdownPercent < 20) {
    // Tier 2: Deploy additional 40% of reserve
    const deploymentPercent = 0.4;
    const amountToDeploy = availableReserve * deploymentPercent;

    return {
      tier: 2,
      amountDeployed: amountToDeploy,
      percentDeployed: deploymentPercent * 100,
      remainingReserve: availableReserve - amountToDeploy,
      trigger: 'drawdown_15',
      actions: [
        'Deploy additional 40% of reserve',
        'Begin selective position reduction',
        'Close weakest performers',
        'Increase monitoring to hourly',
      ],
    };
  } else if (drawdownPercent >= 20) {
    // Tier 3: Deploy remaining 30% of reserve
    const deploymentPercent = 0.3;
    const amountToDeploy = availableReserve * deploymentPercent;

    return {
      tier: 3,
      amountDeployed: amountToDeploy,
      percentDeployed: deploymentPercent * 100,
      remainingReserve: availableReserve - amountToDeploy,
      trigger: 'drawdown_20',
      actions: [
        'Deploy remaining 30% of reserve',
        'Initiate systematic position reduction',
        'Preserve capital for future opportunities',
        'Suspend automated trading',
      ],
    };
  }

  return null; // No deployment needed
}

/**
 * Calculate reserve replenishment plan after deployment
 */
export interface ReplenishmentPlan {
  targetReserve: number;
  currentReserve: number;
  deficit: number;
  profitAllocationPercent: number; // % of profits to allocate to reserve
  positionSizeReduction: number; // % reduction in position sizes
  estimatedTimeToReplenish: number; // Days (estimated)
}

export function calculateReplenishmentPlan(
  targetReserve: number,
  currentReserve: number,
  avgDailyProfit: number
): ReplenishmentPlan {
  const deficit = Math.max(0, targetReserve - currentReserve);

  // Allocate 50% of profits to reserve until restored
  const profitAllocationPercent = 50;

  // Reduce position sizes by 20% to accelerate recovery
  const positionSizeReduction = 20;

  // Estimate time to replenish
  const dailyReplenishment = avgDailyProfit * (profitAllocationPercent / 100);
  const estimatedTimeToReplenish =
    dailyReplenishment > 0 ? Math.ceil(deficit / dailyReplenishment) : Infinity;

  return {
    targetReserve,
    currentReserve,
    deficit,
    profitAllocationPercent,
    positionSizeReduction,
    estimatedTimeToReplenish,
  };
}

/**
 * Dynamic reserve sizing based on market volatility
 */
export function calculateDynamicReserve(
  baseReserve: number,
  volatilityPercentile: number,
  currentVaR: number
): {
  adjustedReserve: number;
  volatilityMultiplier: number;
  varMultiplier: number;
  reason: string;
} {
  let volatilityMultiplier = 1.0;
  let reason = 'Normal volatility';

  // Adjust based on volatility percentile
  if (volatilityPercentile < 30) {
    // Low volatility: normal reserve
    volatilityMultiplier = 1.0;
    reason = 'Low volatility - normal reserve';
  } else if (volatilityPercentile >= 30 && volatilityPercentile < 70) {
    // Normal volatility: normal reserve
    volatilityMultiplier = 1.0;
    reason = 'Normal volatility - normal reserve';
  } else if (volatilityPercentile >= 70 && volatilityPercentile < 90) {
    // Elevated volatility: increase by 30%
    volatilityMultiplier = 1.3;
    reason = 'Elevated volatility - increase reserve by 30%';
  } else {
    // Extreme volatility: increase by 60%
    volatilityMultiplier = 1.6;
    reason = 'Extreme volatility - increase reserve by 60%';
  }

  // Ensure reserve covers at least 2x VaR
  const varMultiplier = currentVaR > 0 ? Math.max(1.0, (2 * currentVaR) / baseReserve) : 1.0;

  // Use the higher of volatility or VaR multiplier
  const finalMultiplier = Math.max(volatilityMultiplier, varMultiplier);
  const adjustedReserve = baseReserve * finalMultiplier;

  return {
    adjustedReserve,
    volatilityMultiplier,
    varMultiplier,
    reason,
  };
}

/**
 * Allocate capital across multiple strategies using risk parity
 */
export interface StrategyAllocation {
  strategyId: number;
  strategyName: string;
  volatility: number;
  allocation: number;
  allocationPercent: number;
}

export function allocateAcrossStrategies(
  totalCapital: number,
  strategies: Array<{ id: number; name: string; volatility: number }>
): StrategyAllocation[] {
  // Risk parity: allocate inversely proportional to volatility
  // allocation_i = (1 / volatility_i) / Σ(1 / volatility_j)

  // Calculate sum of inverse volatilities
  const sumInverseVol = strategies.reduce((sum, s) => sum + 1 / s.volatility, 0);

  // Allocate capital
  return strategies.map((strategy) => {
    const inverseVol = 1 / strategy.volatility;
    const allocationPercent = (inverseVol / sumInverseVol) * 100;
    const allocation = (totalCapital * allocationPercent) / 100;

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      volatility: strategy.volatility,
      allocation,
      allocationPercent,
    };
  });
}

/**
 * Performance-based reallocation
 * Increase allocation to high-performing strategies, decrease for underperformers
 */
export interface PerformanceReallocation {
  strategyId: number;
  currentAllocation: number;
  newAllocation: number;
  change: number;
  changePercent: number;
  reason: string;
}

export function reallocateByPerformance(
  strategies: Array<{
    id: number;
    currentAllocation: number;
    sharpeRatio: number;
    consecutiveLossDays: number;
  }>,
  totalCapital: number
): PerformanceReallocation[] {
  const reallocations: PerformanceReallocation[] = [];

  for (const strategy of strategies) {
    let adjustmentFactor = 1.0;
    let reason = 'No change';

    // Increase allocation for high Sharpe ratio
    if (strategy.sharpeRatio > 1.5) {
      adjustmentFactor = 1.1; // Increase by 10%
      reason = 'High Sharpe ratio (>1.5) - increase by 10%';
    }

    // Decrease allocation for low Sharpe ratio
    else if (strategy.sharpeRatio < 0.5 && strategy.sharpeRatio >= 0) {
      adjustmentFactor = 0.8; // Decrease by 20%
      reason = 'Low Sharpe ratio (<0.5) - decrease by 20%';
    }

    // Suspend strategy with negative Sharpe for 60+ days
    else if (strategy.sharpeRatio < 0 && strategy.consecutiveLossDays >= 60) {
      adjustmentFactor = 0; // Suspend
      reason = 'Negative Sharpe for 60+ days - suspend strategy';
    }

    const newAllocation = strategy.currentAllocation * adjustmentFactor;
    const change = newAllocation - strategy.currentAllocation;
    const changePercent =
      strategy.currentAllocation > 0 ? (change / strategy.currentAllocation) * 100 : 0;

    reallocations.push({
      strategyId: strategy.id,
      currentAllocation: strategy.currentAllocation,
      newAllocation,
      change,
      changePercent,
      reason,
    });
  }

  // Normalize allocations to sum to total capital
  const totalNewAllocation = reallocations.reduce((sum, r) => sum + r.newAllocation, 0);
  if (totalNewAllocation > 0) {
    const normalizationFactor = totalCapital / totalNewAllocation;
    for (const reallocation of reallocations) {
      reallocation.newAllocation *= normalizationFactor;
      reallocation.change = reallocation.newAllocation - reallocation.currentAllocation;
      reallocation.changePercent =
        reallocation.currentAllocation > 0
          ? (reallocation.change / reallocation.currentAllocation) * 100
          : 0;
    }
  }

  return reallocations;
}

/**
 * Check if position can be opened given capital constraints
 */
export function canOpenPosition(
  positionSize: number,
  availableCapital: number,
  maxPositionSizePercent: number,
  totalCapital: number,
  currentPositionsCount: number,
  maxPositions: number
): {
  allowed: boolean;
  reason: string;
  maxAllowedSize: number;
} {
  // Check position count limit
  if (currentPositionsCount >= maxPositions) {
    return {
      allowed: false,
      reason: `Maximum positions limit reached (${maxPositions})`,
      maxAllowedSize: 0,
    };
  }

  // Check available capital
  if (positionSize > availableCapital) {
    return {
      allowed: false,
      reason: `Insufficient available capital ($${availableCapital.toFixed(2)})`,
      maxAllowedSize: availableCapital,
    };
  }

  // Check maximum position size as % of total capital
  const maxAllowedSize = (totalCapital * maxPositionSizePercent) / 100;
  if (positionSize > maxAllowedSize) {
    return {
      allowed: false,
      reason: `Position exceeds ${maxPositionSizePercent}% of total capital`,
      maxAllowedSize,
    };
  }

  return {
    allowed: true,
    reason: 'Position approved',
    maxAllowedSize,
  };
}
