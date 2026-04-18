/**
 * Drawdown Monitor and Circuit Breaker System
 * 
 * Implements tiered circuit breakers based on drawdown severity:
 * - 5-10%: Yellow Alert (increase monitoring)
 * - 10-15%: Orange Alert (reduce position sizes, tighten stops)
 * - 15-20%: Red Alert (halt new positions, activate reserves)
 * - >20%: Emergency Protocol (systematic position reduction)
 */

export interface DrawdownMetrics {
  currentEquity: number;
  peakEquity: number;
  currentDrawdown: number; // Percentage from peak
  currentDrawdownDollar: number; // Dollar amount from peak
  drawdownDuration: number; // Days in drawdown
  maxDrawdown: number; // Maximum drawdown in period
  recoveryFactor: number; // Current equity / previous peak
}

export interface CircuitBreakerStatus {
  level: 'green' | 'yellow' | 'orange' | 'red' | 'emergency';
  drawdownPercent: number;
  actions: string[];
  restrictions: {
    allowNewPositions: boolean;
    maxPositionSizeMultiplier: number; // Multiply normal size by this
    requireTighterStops: boolean;
    activateReserves: boolean;
    forcePositionReduction: boolean;
  };
}

/**
 * Calculate current drawdown metrics
 */
export function calculateDrawdown(
  currentEquity: number,
  equityCurve: number[]
): DrawdownMetrics {
  if (equityCurve.length === 0) {
    return {
      currentEquity,
      peakEquity: currentEquity,
      currentDrawdown: 0,
      currentDrawdownDollar: 0,
      drawdownDuration: 0,
      maxDrawdown: 0,
      recoveryFactor: 1,
    };
  }

  // Find peak equity
  const peakEquity = Math.max(...equityCurve, currentEquity);

  // Calculate current drawdown
  const currentDrawdownDollar = peakEquity - currentEquity;
  const currentDrawdown = peakEquity > 0 ? (currentDrawdownDollar / peakEquity) * 100 : 0;

  // Calculate drawdown duration (days since peak)
  let drawdownDuration = 0;
  for (let i = equityCurve.length - 1; i >= 0; i--) {
    if (equityCurve[i] >= peakEquity) {
      break;
    }
    drawdownDuration++;
  }

  // Calculate maximum drawdown in period
  let maxDrawdown = 0;
  let runningPeak = equityCurve[0];
  for (const equity of equityCurve) {
    if (equity > runningPeak) {
      runningPeak = equity;
    }
    const dd = runningPeak > 0 ? ((runningPeak - equity) / runningPeak) * 100 : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }

  // Recovery factor
  const recoveryFactor = peakEquity > 0 ? currentEquity / peakEquity : 1;

  return {
    currentEquity,
    peakEquity,
    currentDrawdown,
    currentDrawdownDollar,
    drawdownDuration,
    maxDrawdown: Math.max(maxDrawdown, currentDrawdown),
    recoveryFactor,
  };
}

/**
 * Determine circuit breaker status based on drawdown level
 */
export function getCircuitBreakerStatus(drawdownPercent: number): CircuitBreakerStatus {
  if (drawdownPercent < 5) {
    // Green: Normal operations
    return {
      level: 'green',
      drawdownPercent,
      actions: ['Normal operations', 'Continue standard monitoring'],
      restrictions: {
        allowNewPositions: true,
        maxPositionSizeMultiplier: 1.0,
        requireTighterStops: false,
        activateReserves: false,
        forcePositionReduction: false,
      },
    };
  } else if (drawdownPercent >= 5 && drawdownPercent < 10) {
    // Yellow Alert: Increase monitoring
    return {
      level: 'yellow',
      drawdownPercent,
      actions: [
        'Increase monitoring frequency',
        'Review position correlations',
        'Check strategy performance',
        'Verify risk parameters',
      ],
      restrictions: {
        allowNewPositions: true,
        maxPositionSizeMultiplier: 1.0,
        requireTighterStops: false,
        activateReserves: false,
        forcePositionReduction: false,
      },
    };
  } else if (drawdownPercent >= 10 && drawdownPercent < 15) {
    // Orange Alert: Reduce risk
    return {
      level: 'orange',
      drawdownPercent,
      actions: [
        'Reduce new position sizes by 30%',
        'Tighten stop losses on existing positions',
        'Review and close weakest performers',
        'Increase cash reserves',
      ],
      restrictions: {
        allowNewPositions: true,
        maxPositionSizeMultiplier: 0.7, // 30% reduction
        requireTighterStops: true,
        activateReserves: false,
        forcePositionReduction: false,
      },
    };
  } else if (drawdownPercent >= 15 && drawdownPercent < 20) {
    // Red Alert: Halt new positions, activate reserves
    return {
      level: 'red',
      drawdownPercent,
      actions: [
        'HALT all new position entries',
        'Activate drawdown protection reserve',
        'Close positions with negative risk/reward',
        'Preserve capital for recovery',
      ],
      restrictions: {
        allowNewPositions: false,
        maxPositionSizeMultiplier: 0,
        requireTighterStops: true,
        activateReserves: true,
        forcePositionReduction: true,
      },
    };
  } else {
    // Emergency: Systematic liquidation
    return {
      level: 'emergency',
      drawdownPercent,
      actions: [
        'EMERGENCY: Begin systematic position reduction',
        'Deploy all reserve capital',
        'Close all positions with losses > 10%',
        'Preserve remaining capital',
        'Suspend automated trading',
      ],
      restrictions: {
        allowNewPositions: false,
        maxPositionSizeMultiplier: 0,
        requireTighterStops: true,
        activateReserves: true,
        forcePositionReduction: true,
      },
    };
  }
}

/**
 * Calculate maximum drawdown from equity curve
 */
export function calculateMaxDrawdown(equityCurve: number[]): {
  maxDrawdown: number;
  maxDrawdownDollar: number;
  peakValue: number;
  troughValue: number;
  peakIndex: number;
  troughIndex: number;
  recoveryIndex: number | null;
  recoveryTime: number | null;
} {
  if (equityCurve.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownDollar: 0,
      peakValue: 0,
      troughValue: 0,
      peakIndex: 0,
      troughIndex: 0,
      recoveryIndex: null,
      recoveryTime: null,
    };
  }

  let maxDrawdown = 0;
  let maxDrawdownDollar = 0;
  let peakValue = equityCurve[0];
  let troughValue = equityCurve[0];
  let peakIndex = 0;
  let troughIndex = 0;
  let currentPeak = equityCurve[0];
  let currentPeakIndex = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    const value = equityCurve[i];

    // Update current peak
    if (value > currentPeak) {
      currentPeak = value;
      currentPeakIndex = i;
    }

    // Calculate drawdown from current peak
    const drawdownDollar = currentPeak - value;
    const drawdown = currentPeak > 0 ? (drawdownDollar / currentPeak) * 100 : 0;

    // Update max drawdown if this is worse
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDollar = drawdownDollar;
      peakValue = currentPeak;
      peakIndex = currentPeakIndex;
      troughValue = value;
      troughIndex = i;
    }
  }

  // Find recovery point (when equity exceeds peak after trough)
  let recoveryIndex: number | null = null;
  let recoveryTime: number | null = null;

  for (let i = troughIndex + 1; i < equityCurve.length; i++) {
    if (equityCurve[i] >= peakValue) {
      recoveryIndex = i;
      recoveryTime = i - troughIndex;
      break;
    }
  }

  return {
    maxDrawdown,
    maxDrawdownDollar,
    peakValue,
    troughValue,
    peakIndex,
    troughIndex,
    recoveryIndex,
    recoveryTime,
  };
}

/**
 * Calculate underwater period (time spent in drawdown)
 */
export function calculateUnderwaterPeriod(equityCurve: number[]): {
  totalDays: number;
  underwaterDays: number;
  underwaterPercent: number;
  currentUnderwaterStreak: number;
  longestUnderwaterStreak: number;
} {
  if (equityCurve.length === 0) {
    return {
      totalDays: 0,
      underwaterDays: 0,
      underwaterPercent: 0,
      currentUnderwaterStreak: 0,
      longestUnderwaterStreak: 0,
    };
  }

  let underwaterDays = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let peak = equityCurve[0];

  for (const value of equityCurve) {
    if (value >= peak) {
      // New peak, reset streak
      peak = value;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
      currentStreak = 0;
    } else {
      // Underwater
      underwaterDays++;
      currentStreak++;
    }
  }

  // Check if current streak is longest
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  const totalDays = equityCurve.length;
  const underwaterPercent = totalDays > 0 ? (underwaterDays / totalDays) * 100 : 0;

  return {
    totalDays,
    underwaterDays,
    underwaterPercent,
    currentUnderwaterStreak: currentStreak,
    longestUnderwaterStreak: longestStreak,
  };
}

/**
 * Estimate time to recovery from current drawdown
 * Based on historical recovery patterns
 */
export function estimateRecoveryTime(
  currentDrawdown: number,
  avgDailyReturn: number,
  historicalRecoveryTimes: number[]
): {
  estimatedDays: number;
  confidence: 'low' | 'medium' | 'high';
  basedOn: 'historical' | 'mathematical' | 'hybrid';
} {
  // If we have historical recovery data, use it
  if (historicalRecoveryTimes.length > 0) {
    const avgRecoveryTime =
      historicalRecoveryTimes.reduce((sum, t) => sum + t, 0) / historicalRecoveryTimes.length;

    return {
      estimatedDays: Math.round(avgRecoveryTime),
      confidence: historicalRecoveryTimes.length >= 5 ? 'high' : 'medium',
      basedOn: 'historical',
    };
  }

  // Otherwise, use mathematical estimation
  // Days to recover = ln(1 / (1 - drawdown)) / avg_daily_return
  if (avgDailyReturn > 0) {
    const drawdownDecimal = currentDrawdown / 100;
    const daysToRecover = Math.log(1 / (1 - drawdownDecimal)) / avgDailyReturn;

    return {
      estimatedDays: Math.round(daysToRecover),
      confidence: 'low',
      basedOn: 'mathematical',
    };
  }

  // If no positive returns, recovery is uncertain
  return {
    estimatedDays: Infinity,
    confidence: 'low',
    basedOn: 'mathematical',
  };
}
