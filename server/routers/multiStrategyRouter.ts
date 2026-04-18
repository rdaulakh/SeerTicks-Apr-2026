import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createStrategyInstance,
  getStrategyInstance,
  getUserStrategyInstances,
  getActiveStrategyInstances,
  updateStrategyInstance,
  deleteStrategyInstance,
  createStrategyPerformance,
  getStrategyPerformance,
  updateStrategyPerformance,
  getStrategyPositions,
  getStrategyOpenPositions,
  getStrategyOrders,
  getStrategyTrades,
  calculateStrategyPerformance,
} from "../strategyDb";

/**
 * Multi-Strategy Execution Router
 * Manages multiple trading strategies running simultaneously
 */
export const multiStrategyRouter = router({
  // ============================================================================
  // Strategy Instance Management
  // ============================================================================

  /**
   * Create a new strategy instance
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        strategyType: z.string().min(1).max(50),
        config: z.record(z.string(), z.any()),
        allocatedBalance: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const strategyId = await createStrategyInstance({
        userId: ctx.user.id,
        name: input.name,
        strategyType: input.strategyType,
        config: input.config,
        allocatedBalance: input.allocatedBalance,
        currentBalance: input.allocatedBalance, // Start with full allocation
        status: "paused",
      });

      // Create initial performance record
      await createStrategyPerformance({
        strategyId,
        userId: ctx.user.id,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: "0.00",
        totalPnL: "0.00",
        realizedPnL: "0.00",
        unrealizedPnL: "0.00",
        avgWin: "0.00",
        avgLoss: "0.00",
        maxDrawdown: "0.00",
        openPositions: 0,
        maxOpenPositions: 0,
        totalCommission: "0.00",
      });

      return { strategyId };
    }),

  /**
   * Get all strategy instances for the user
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return await getUserStrategyInstances(ctx.user.id);
  }),

  /**
   * Get active strategy instances
   */
  listActive: protectedProcedure.query(async ({ ctx }) => {
    return await getActiveStrategyInstances(ctx.user.id);
  }),

  /**
   * Get a specific strategy instance
   */
  get: protectedProcedure.input(z.object({ strategyId: z.number() })).query(async ({ ctx, input }) => {
    return await getStrategyInstance(input.strategyId, ctx.user.id);
  }),

  /**
   * Update strategy instance configuration
   */
  update: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
        name: z.string().min(1).max(100).optional(),
        config: z.record(z.string(), z.any()).optional(),
        allocatedBalance: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { strategyId, ...updates } = input;
      await updateStrategyInstance(strategyId, ctx.user.id, updates);
      return { success: true };
    }),

  /**
   * Start a strategy instance
   */
  start: protectedProcedure.input(z.object({ strategyId: z.number() })).mutation(async ({ ctx, input }) => {
    await updateStrategyInstance(input.strategyId, ctx.user.id, {
      status: "active",
      startedAt: new Date(),
    });
    return { success: true };
  }),

  /**
   * Pause a strategy instance
   */
  pause: protectedProcedure.input(z.object({ strategyId: z.number() })).mutation(async ({ ctx, input }) => {
    await updateStrategyInstance(input.strategyId, ctx.user.id, {
      status: "paused",
    });
    return { success: true };
  }),

  /**
   * Stop a strategy instance
   */
  stop: protectedProcedure.input(z.object({ strategyId: z.number() })).mutation(async ({ ctx, input }) => {
    await updateStrategyInstance(input.strategyId, ctx.user.id, {
      status: "stopped",
      stoppedAt: new Date(),
    });
    return { success: true };
  }),

  /**
   * Delete a strategy instance
   */
  delete: protectedProcedure.input(z.object({ strategyId: z.number() })).mutation(async ({ ctx, input }) => {
    // Check if strategy has open positions
    const openPositions = await getStrategyOpenPositions(input.strategyId, ctx.user.id);
    if (openPositions.length > 0) {
      throw new Error("Cannot delete strategy with open positions. Close all positions first.");
    }

    await deleteStrategyInstance(input.strategyId, ctx.user.id);
    return { success: true };
  }),

  // ============================================================================
  // Strategy Performance Tracking
  // ============================================================================

  /**
   * Get strategy performance metrics
   */
  getPerformance: protectedProcedure.input(z.object({ strategyId: z.number() })).query(async ({ ctx, input }) => {
    return await getStrategyPerformance(input.strategyId, ctx.user.id);
  }),

  /**
   * Refresh strategy performance metrics
   */
  refreshPerformance: protectedProcedure
    .input(z.object({ strategyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const performance = await calculateStrategyPerformance(input.strategyId, ctx.user.id);
      if (!performance) {
        throw new Error("Failed to calculate strategy performance");
      }

      await updateStrategyPerformance(input.strategyId, ctx.user.id, performance);
      return performance;
    }),

  // ============================================================================
  // Strategy-Specific Data
  // ============================================================================

  /**
   * Get all positions for a strategy
   */
  getPositions: protectedProcedure.input(z.object({ strategyId: z.number() })).query(async ({ ctx, input }) => {
    return await getStrategyPositions(input.strategyId, ctx.user.id);
  }),

  /**
   * Get open positions for a strategy
   */
  getOpenPositions: protectedProcedure.input(z.object({ strategyId: z.number() })).query(async ({ ctx, input }) => {
    return await getStrategyOpenPositions(input.strategyId, ctx.user.id);
  }),

  /**
   * Get orders for a strategy
   */
  getOrders: protectedProcedure
    .input(z.object({ strategyId: z.number(), limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return await getStrategyOrders(input.strategyId, ctx.user.id, input.limit);
    }),

  /**
   * Get trades for a strategy
   */
  getTrades: protectedProcedure
    .input(z.object({ strategyId: z.number(), limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return await getStrategyTrades(input.strategyId, ctx.user.id, input.limit);
    }),

  // ============================================================================
  // Dashboard Data
  // ============================================================================

  /**
   * Get aggregated dashboard data for all strategies
   */
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    const strategies = await getUserStrategyInstances(ctx.user.id);

    const dashboardData = await Promise.all(
      strategies.map(async (strategy) => {
        const performance = await getStrategyPerformance(strategy.id, ctx.user.id);
        const openPositions = await getStrategyOpenPositions(strategy.id, ctx.user.id);

        return {
          ...strategy,
          performance,
          openPositionsCount: openPositions.length,
        };
      })
    );

    // Calculate aggregate metrics
    const aggregate = dashboardData.reduce(
      (acc, strategy) => {
        if (strategy.performance) {
          acc.totalPnL += parseFloat(strategy.performance.totalPnL || "0");
          acc.totalTrades += strategy.performance.totalTrades;
          acc.totalOpenPositions += strategy.openPositionsCount;
          if (strategy.status === "active") {
            acc.activeStrategies++;
          }
        }
        return acc;
      },
      {
        totalPnL: 0,
        totalTrades: 0,
        totalOpenPositions: 0,
        activeStrategies: 0,
      }
    );

    return {
      strategies: dashboardData,
      aggregate: {
        ...aggregate,
        totalPnL: aggregate.totalPnL.toFixed(2),
      },
    };
  }),
});
