import { getDb } from "../db";
import {
  tradingStrategies,
  strategyPositions,
  paperPositions,
  InsertTradingStrategy,
  TradingStrategy,
} from "../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

/**
 * Strategy Risk Tracker
 * 
 * Tracks risk metrics and performance at the strategy level for:
 * - Risk parity allocation across strategies
 * - Performance-based capital reallocation
 * - Per-strategy risk limits and circuit breakers
 * - Strategy health monitoring
 */
export class StrategyRiskTracker {
  private userId: number;

  constructor(userId: number) {
    this.userId = userId;
  }

  /**
   * Create a new trading strategy
   */
  async createStrategy(params: {
    strategyName: string;
    strategyType: "scalping" | "day_trading" | "swing_trading" | "momentum" | "mean_reversion" | "breakout" | "trend_following" | "custom";
    description?: string;
    allocatedCapital: number;
    maxCapital: number;
    maxPositions?: number;
    maxDrawdown?: number;
    maxDailyLoss: number;
    maxPositionSize?: number;
  }): Promise<TradingStrategy> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const strategy: InsertTradingStrategy = {
      userId: this.userId,
      strategyName: params.strategyName,
      strategyType: params.strategyType,
      description: params.description,
      allocatedCapital: params.allocatedCapital.toString(),
      availableCapital: params.allocatedCapital.toString(),
      maxCapital: params.maxCapital.toString(),
      maxPositions: params.maxPositions || 5,
      maxDrawdown: params.maxDrawdown?.toString() || "15.00",
      maxDailyLoss: params.maxDailyLoss.toString(),
      maxPositionSize: params.maxPositionSize?.toString() || "20.00",
    };

    const result = await db.insert(tradingStrategies).values(strategy);
    const strategyId = Number(result[0].insertId);

    const created = await db
      .select()
      .from(tradingStrategies)
      .where(eq(tradingStrategies.id, strategyId))
      .limit(1);

    return created[0];
  }

  /**
   * Link a position to a strategy
   */
  async linkPositionToStrategy(
    strategyId: number,
    positionId: number,
    isPaperTrading: boolean,
    entryValue: number
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    await db.insert(strategyPositions).values({
      strategyId,
      positionId,
      isPaperTrading,
      entryValue: entryValue.toString(),
    });
  }

  /**
   * Update strategy metrics based on current positions
   */
  async updateStrategyMetrics(strategyId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      // Get strategy
      const strategies = await db
        .select()
        .from(tradingStrategies)
        .where(eq(tradingStrategies.id, strategyId))
        .limit(1);

      if (strategies.length === 0) return;

      const strategy = strategies[0];

      // Get strategy positions
      const positions = await db
        .select()
        .from(strategyPositions)
        .where(eq(strategyPositions.strategyId, strategyId));

      // Calculate metrics from positions
      let totalPnL = 0;
      let unrealizedPnL = 0;
      let realizedPnL = 0;
      let currentValue = 0;

      for (const strategyPos of positions) {
        // Get position details
        const posDetails = await db
          .select()
          .from(paperPositions)
          .where(eq(paperPositions.id, strategyPos.positionId))
          .limit(1);

        if (posDetails.length > 0) {
          const pos = posDetails[0];
          const pnl = parseFloat(pos.unrealizedPnL?.toString() || "0");
          
          if (pos.status === "open") {
            unrealizedPnL += pnl;
            const currentPrice = parseFloat(pos.currentPrice?.toString() || "0");
            const quantity = parseFloat(pos.quantity.toString());
            currentValue += currentPrice * quantity;
          } else if (pos.status === "closed") {
            realizedPnL += pnl;
          }
        }
      }

      totalPnL = realizedPnL + unrealizedPnL;

      // Calculate available capital
      const allocatedCapital = parseFloat(strategy.allocatedCapital.toString());
      const availableCapital = allocatedCapital - currentValue;

      // Calculate drawdown
      const peakCapital = allocatedCapital + Math.max(0, totalPnL);
      const currentCapital = allocatedCapital + totalPnL;
      const currentDrawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;

      // Update strategy
      await db
        .update(tradingStrategies)
        .set({
          availableCapital: availableCapital.toString(),
          totalPnL: totalPnL.toString(),
          realizedPnL: realizedPnL.toString(),
          unrealizedPnL: unrealizedPnL.toString(),
          currentDrawdown: currentDrawdown.toString(),
          maxDrawdownReached: Math.max(
            parseFloat(strategy.maxDrawdownReached.toString()),
            currentDrawdown
          ).toString(),
        })
        .where(eq(tradingStrategies.id, strategyId));

      console.log(`[StrategyRiskTracker] Updated strategy ${strategyId}: P&L=$${totalPnL.toFixed(2)}, Drawdown=${currentDrawdown.toFixed(2)}%`);
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error updating strategy metrics:`, error);
    }
  }

  /**
   * Calculate performance score for a strategy (0-100)
   */
  async calculatePerformanceScore(strategyId: number): Promise<number> {
    const db = await getDb();
    if (!db) return 50;

    try {
      const strategies = await db
        .select()
        .from(tradingStrategies)
        .where(eq(tradingStrategies.id, strategyId))
        .limit(1);

      if (strategies.length === 0) return 50;

      const strategy = strategies[0];

      // Factors:
      // 1. Win rate (0-40 points)
      const winRate = parseFloat(strategy.winRate.toString());
      const winRateScore = Math.min(40, (winRate / 100) * 40);

      // 2. Profit factor (0-30 points)
      const profitFactor = strategy.profitFactor ? parseFloat(strategy.profitFactor.toString()) : 1;
      const profitFactorScore = Math.min(30, (profitFactor / 3) * 30); // 3.0 = perfect score

      // 3. Sharpe ratio (0-20 points)
      const sharpeRatio = strategy.sharpeRatio ? parseFloat(strategy.sharpeRatio.toString()) : 0;
      const sharpeScore = Math.min(20, Math.max(0, (sharpeRatio / 2) * 20)); // 2.0 = perfect score

      // 4. Drawdown penalty (-10 points max)
      const currentDrawdown = parseFloat(strategy.currentDrawdown.toString());
      const maxDrawdown = parseFloat(strategy.maxDrawdown.toString());
      const drawdownPenalty = currentDrawdown > maxDrawdown ? -10 : 0;

      // 5. Activity bonus (0-10 points)
      const totalTrades = strategy.totalTrades;
      const activityScore = Math.min(10, (totalTrades / 100) * 10); // 100 trades = full score

      const totalScore = Math.max(0, Math.min(100,
        winRateScore + profitFactorScore + sharpeScore + drawdownPenalty + activityScore
      ));

      // Update performance score
      await db
        .update(tradingStrategies)
        .set({ performanceScore: totalScore.toString() })
        .where(eq(tradingStrategies.id, strategyId));

      return totalScore;
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error calculating performance score:`, error);
      return 50;
    }
  }

  /**
   * Reallocate capital based on strategy performance
   */
  async reallocateCapitalByPerformance(totalCapital: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      // Get all active strategies
      const strategies = await db
        .select()
        .from(tradingStrategies)
        .where(
          and(
            eq(tradingStrategies.userId, this.userId),
            eq(tradingStrategies.isActive, true),
            eq(tradingStrategies.isPaused, false)
          )
        );

      if (strategies.length === 0) return;

      // Calculate performance scores
      const strategyScores: { id: number; score: number }[] = [];
      for (const strategy of strategies) {
        const score = await this.calculatePerformanceScore(strategy.id);
        strategyScores.push({ id: strategy.id, score });
      }

      // Calculate total score
      const totalScore = strategyScores.reduce((sum, s) => sum + s.score, 0);

      if (totalScore === 0) {
        // Equal allocation if no scores
        const equalAllocation = totalCapital / strategies.length;
        for (const strategy of strategies) {
          await db
            .update(tradingStrategies)
            .set({ allocatedCapital: equalAllocation.toString() })
            .where(eq(tradingStrategies.id, strategy.id));
        }
        return;
      }

      // Allocate proportionally to performance
      for (const { id, score } of strategyScores) {
        const allocation = (score / totalScore) * totalCapital;
        
        // Respect max capital limits
        const strategy = strategies.find(s => s.id === id);
        if (strategy) {
          const maxCapital = parseFloat(strategy.maxCapital.toString());
          const finalAllocation = Math.min(allocation, maxCapital);

          await db
            .update(tradingStrategies)
            .set({ allocatedCapital: finalAllocation.toString() })
            .where(eq(tradingStrategies.id, id));

          console.log(`[StrategyRiskTracker] Reallocated $${finalAllocation.toFixed(2)} to strategy ${id} (score: ${score.toFixed(1)})`);
        }
      }
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error reallocating capital:`, error);
    }
  }

  /**
   * Check if strategy should be paused due to risk limits
   */
  async checkStrategyRiskLimits(strategyId: number): Promise<{
    shouldPause: boolean;
    reason?: string;
  }> {
    const db = await getDb();
    if (!db) return { shouldPause: false };

    try {
      const strategies = await db
        .select()
        .from(tradingStrategies)
        .where(eq(tradingStrategies.id, strategyId))
        .limit(1);

      if (strategies.length === 0) return { shouldPause: false };

      const strategy = strategies[0];

      // Check drawdown limit
      const currentDrawdown = parseFloat(strategy.currentDrawdown.toString());
      const maxDrawdown = parseFloat(strategy.maxDrawdown.toString());
      if (currentDrawdown >= maxDrawdown) {
        await this.pauseStrategy(strategyId, `Max drawdown reached: ${currentDrawdown.toFixed(2)}%`);
        return {
          shouldPause: true,
          reason: `Drawdown ${currentDrawdown.toFixed(2)}% exceeds limit ${maxDrawdown.toFixed(2)}%`,
        };
      }

      // Check daily loss limit
      const maxDailyLoss = parseFloat(strategy.maxDailyLoss.toString());
      const dailyLoss = await this.getDailyLoss(strategy.userId);
      if (dailyLoss >= maxDailyLoss) {
        await this.pauseStrategy(strategyId, `Daily loss limit reached: $${dailyLoss.toFixed(2)}`);
        return {
          shouldPause: true,
          reason: `Daily loss $${dailyLoss.toFixed(2)} exceeds limit $${maxDailyLoss.toFixed(2)}`,
        };
      }

      // Check performance score
      const performanceScore = parseFloat(strategy.performanceScore.toString());
      if (performanceScore < 30 && strategy.totalTrades > 20) {
        await this.pauseStrategy(strategyId, `Low performance score: ${performanceScore.toFixed(1)}`);
        return {
          shouldPause: true,
          reason: `Performance score ${performanceScore.toFixed(1)} below threshold`,
        };
      }

      return { shouldPause: false };
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error checking risk limits:`, error);
      return { shouldPause: false };
    }
  }

  /**
   * Get total realized loss for the user's closed positions today.
   * Only sums negative realizedPnl values (losses).
   * Returns a positive number representing the magnitude of loss.
   */
  private async getDailyLoss(userId: number): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const todayStart = sql`CURDATE()`;
      const closedToday = await db
        .select({ realizedPnl: paperPositions.realizedPnl })
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.userId, userId),
            eq(paperPositions.status, "closed"),
            gte(paperPositions.exitTime, todayStart)
          )
        );

      let totalLoss = 0;
      for (const row of closedToday) {
        const pnl = parseFloat(row.realizedPnl || "0");
        if (pnl < 0) {
          totalLoss += Math.abs(pnl);
        }
      }

      return totalLoss;
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error calculating daily loss:`, error);
      return 0;
    }
  }

  /**
   * Pause a strategy
   */
  async pauseStrategy(strategyId: number, reason: string): Promise<void> {
    const db = await getDb();
    if (!db) return;

    await db
      .update(tradingStrategies)
      .set({
        isPaused: true,
        pauseReason: reason,
      })
      .where(eq(tradingStrategies.id, strategyId));

    console.log(`[StrategyRiskTracker] Strategy ${strategyId} paused: ${reason}`);
  }

  /**
   * Resume a paused strategy
   */
  async resumeStrategy(strategyId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    await db
      .update(tradingStrategies)
      .set({
        isPaused: false,
        pauseReason: null,
      })
      .where(eq(tradingStrategies.id, strategyId));

    console.log(`[StrategyRiskTracker] Strategy ${strategyId} resumed`);
  }

  /**
   * Get all strategies for user
   */
  async getAllStrategies(): Promise<TradingStrategy[]> {
    const db = await getDb();
    if (!db) return [];

    return await db
      .select()
      .from(tradingStrategies)
      .where(eq(tradingStrategies.userId, this.userId))
      .orderBy(desc(tradingStrategies.performanceScore));
  }

  /**
   * Get strategy performance summary
   */
  async getStrategyPerformanceSummary(strategyId: number): Promise<{
    totalPnL: string;
    winRate: string;
    totalTrades: number;
    openPositions: number;
    strategy: TradingStrategy;
    positionCount: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    sharpeRatio: number | null;
    maxDrawdown: number;
  } | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      const strategies = await db
        .select()
        .from(tradingStrategies)
        .where(eq(tradingStrategies.id, strategyId))
        .limit(1);

      if (strategies.length === 0) return null;

      const strategy = strategies[0];

      // Get position count
      const positions = await db
        .select()
        .from(strategyPositions)
        .where(eq(strategyPositions.strategyId, strategyId));

      return {
        totalPnL: strategy.totalPnL?.toString() || "0.00",
        winRate: strategy.winRate?.toString() || "0.00",
        totalTrades: strategy.totalTrades || 0,
        openPositions: positions.length,
        strategy,
        positionCount: positions.length,
        avgWin: strategy.avgWin ? parseFloat(strategy.avgWin.toString()) : 0,
        avgLoss: strategy.avgLoss ? parseFloat(strategy.avgLoss.toString()) : 0,
        profitFactor: strategy.profitFactor ? parseFloat(strategy.profitFactor.toString()) : 0,
        sharpeRatio: strategy.sharpeRatio ? parseFloat(strategy.sharpeRatio.toString()) : null,
        maxDrawdown: parseFloat(strategy.maxDrawdownReached.toString()),
      };
    } catch (error) {
      console.error(`[StrategyRiskTracker] Error getting performance summary:`, error);
      return null;
    }
  }
}
