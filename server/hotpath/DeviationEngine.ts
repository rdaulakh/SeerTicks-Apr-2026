import { NormalizedTick } from "../exchanges";
import { RedisHelpers } from "./redisClient";

/**
 * Hot Path Deviation Engine
 * Calculates deviation scores when actual price deviates from expected path
 */

/**
 * Expected path definition
 * Defines the anticipated price movement over time
 */
export interface ExpectedPath {
  symbol: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: number; // in minutes
  milestones: PathMilestone[];
  createdAt: number; // timestamp
}

/**
 * Path milestone - expected price at a specific time
 */
export interface PathMilestone {
  timeOffset: number; // minutes from entry
  expectedPrice: number;
  tolerance: number; // percentage tolerance (e.g., 0.02 = 2%)
}

/**
 * Deviation score result
 */
export interface DeviationScore {
  symbol: string;
  currentPrice: number;
  expectedPrice: number;
  deviation: number; // percentage deviation
  deviationScore: number; // 0-1 score (0 = on path, 1 = max deviation)
  isAlert: boolean; // true if deviation exceeds threshold
  timestamp: number;
}

/**
 * Deviation Engine for path-based trading
 */
export class DeviationEngine {
  private readonly ALERT_THRESHOLD = 0.7; // Alert when deviation score > 0.7
  private readonly MAX_DEVIATION_PERCENT = 5.0; // Max expected deviation (5%)

  /**
   * Calculate deviation score for current price vs expected path
   */
  calculateDeviation(
    currentTick: NormalizedTick,
    expectedPath: ExpectedPath
  ): DeviationScore {
    const currentTime = currentTick.timestamp;
    const elapsedMinutes = (currentTime - expectedPath.createdAt) / (1000 * 60);

    // Find the relevant milestone or interpolate
    const expectedPrice = this.getExpectedPriceAtTime(expectedPath, elapsedMinutes);

    // Calculate percentage deviation
    const deviation = ((currentTick.price - expectedPrice) / expectedPrice) * 100;
    const absDeviation = Math.abs(deviation);

    // Normalize to 0-1 score
    const deviationScore = Math.min(absDeviation / this.MAX_DEVIATION_PERCENT, 1.0);

    // Check if alert should be triggered
    const isAlert = deviationScore > this.ALERT_THRESHOLD;

    return {
      symbol: expectedPath.symbol,
      currentPrice: currentTick.price,
      expectedPrice,
      deviation,
      deviationScore,
      isAlert,
      timestamp: currentTime,
    };
  }

  /**
   * Get expected price at a specific time offset
   * Interpolates between milestones if necessary
   */
  private getExpectedPriceAtTime(path: ExpectedPath, elapsedMinutes: number): number {
    // If before first milestone, use entry price
    if (elapsedMinutes <= 0) {
      return path.entryPrice;
    }

    // If after last milestone, use target price
    if (elapsedMinutes >= path.timeHorizon) {
      return path.targetPrice;
    }

    // Find surrounding milestones
    const milestones = path.milestones.sort((a, b) => a.timeOffset - b.timeOffset);
    
    let prevMilestone = { timeOffset: 0, expectedPrice: path.entryPrice, tolerance: 0 };
    let nextMilestone = { timeOffset: path.timeHorizon, expectedPrice: path.targetPrice, tolerance: 0 };

    for (let i = 0; i < milestones.length; i++) {
      if (milestones[i].timeOffset <= elapsedMinutes) {
        prevMilestone = milestones[i];
      }
      if (milestones[i].timeOffset > elapsedMinutes) {
        nextMilestone = milestones[i];
        break;
      }
    }

    // Linear interpolation between milestones
    const timeDiff = nextMilestone.timeOffset - prevMilestone.timeOffset;
    const priceDiff = nextMilestone.expectedPrice - prevMilestone.expectedPrice;
    const timeRatio = (elapsedMinutes - prevMilestone.timeOffset) / timeDiff;

    return prevMilestone.expectedPrice + (priceDiff * timeRatio);
  }

  /**
   * Check if price is within tolerance of expected path
   */
  isWithinTolerance(
    currentPrice: number,
    expectedPath: ExpectedPath,
    elapsedMinutes: number
  ): boolean {
    const expectedPrice = this.getExpectedPriceAtTime(expectedPath, elapsedMinutes);
    
    // Find the tolerance for this time period
    let tolerance = 0.02; // Default 2%
    
    for (const milestone of expectedPath.milestones) {
      if (milestone.timeOffset >= elapsedMinutes) {
        tolerance = milestone.tolerance;
        break;
      }
    }

    const deviation = Math.abs((currentPrice - expectedPrice) / expectedPrice);
    return deviation <= tolerance;
  }

  /**
   * Generate a simple expected path based on entry and target
   */
  generateSimplePath(
    symbol: string,
    entryPrice: number,
    targetPrice: number,
    stopLoss: number,
    timeHorizon: number
  ): ExpectedPath {
    const milestones: PathMilestone[] = [];
    const numMilestones = 4; // Create 4 intermediate milestones

    for (let i = 1; i <= numMilestones; i++) {
      const timeOffset = (timeHorizon / (numMilestones + 1)) * i;
      const priceProgress = (targetPrice - entryPrice) / (numMilestones + 1) * i;
      const expectedPrice = entryPrice + priceProgress;

      milestones.push({
        timeOffset,
        expectedPrice,
        tolerance: 0.02, // 2% tolerance
      });
    }

    return {
      symbol,
      entryPrice,
      targetPrice,
      stopLoss,
      timeHorizon,
      milestones,
      createdAt: Date.now(),
    };
  }

  /**
   * Store deviation score in Redis and return it
   */
  async processAndStoreDeviation(
    exchange: string,
    tick: NormalizedTick,
    expectedPath: ExpectedPath
  ): Promise<DeviationScore> {
    const deviationScore = this.calculateDeviation(tick, expectedPath);

    // Store in Redis
    await RedisHelpers.storeDeviation(exchange, expectedPath.symbol, deviationScore.deviationScore);

    return deviationScore;
  }

  /**
   * Check if stop loss or take profit has been hit
   */
  checkExitConditions(
    currentPrice: number,
    expectedPath: ExpectedPath,
    side: "long" | "short"
  ): {
    shouldExit: boolean;
    reason: "stop_loss" | "take_profit" | null;
  } {
    if (side === "long") {
      if (currentPrice <= expectedPath.stopLoss) {
        return { shouldExit: true, reason: "stop_loss" };
      }
      if (currentPrice >= expectedPath.targetPrice) {
        return { shouldExit: true, reason: "take_profit" };
      }
    } else {
      // Short position
      if (currentPrice >= expectedPath.stopLoss) {
        return { shouldExit: true, reason: "stop_loss" };
      }
      if (currentPrice <= expectedPath.targetPrice) {
        return { shouldExit: true, reason: "take_profit" };
      }
    }

    return { shouldExit: false, reason: null };
  }

  /**
   * Calculate dynamic stop loss based on deviation
   * Tightens stop loss as price moves in favor
   */
  calculateDynamicStopLoss(
    entryPrice: number,
    currentPrice: number,
    initialStopLoss: number,
    side: "long" | "short"
  ): number {
    if (side === "long") {
      const profitPercent = (currentPrice - entryPrice) / entryPrice;
      
      // If in profit, move stop loss to breakeven + some buffer
      if (profitPercent > 0.02) { // 2% profit
        const newStopLoss = entryPrice + (entryPrice * 0.005); // Breakeven + 0.5%
        return Math.max(newStopLoss, initialStopLoss);
      }
    } else {
      const profitPercent = (entryPrice - currentPrice) / entryPrice;
      
      if (profitPercent > 0.02) {
        const newStopLoss = entryPrice - (entryPrice * 0.005);
        return Math.min(newStopLoss, initialStopLoss);
      }
    }

    return initialStopLoss;
  }
}

// Singleton instance
let deviationEngineInstance: DeviationEngine | null = null;

/**
 * Get Deviation Engine singleton instance
 */
export function getDeviationEngine(): DeviationEngine {
  if (!deviationEngineInstance) {
    deviationEngineInstance = new DeviationEngine();
  }
  return deviationEngineInstance;
}
