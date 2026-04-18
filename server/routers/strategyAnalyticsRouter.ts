import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getStrategyPerformanceAnalytics } from "../analytics/StrategyPerformance";

export const strategyAnalyticsRouter = router({
  /**
   * Get performance stats for all strategies
   */
  getAllStats: protectedProcedure
    .input(z.object({
      daysBack: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const analytics = getStrategyPerformanceAnalytics();
      return await analytics.getAllStrategyStats(ctx.user.id, input.daysBack);
    }),

  /**
   * Get strategy recommendations
   */
  getRecommendations: protectedProcedure
    .query(async ({ ctx }) => {
      const analytics = getStrategyPerformanceAnalytics();
      return await analytics.getStrategyRecommendations(ctx.user.id);
    }),

  /**
   * Get top performing strategies
   */
  getTopStrategies: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const analytics = getStrategyPerformanceAnalytics();
      return await analytics.getTopStrategies(ctx.user.id, input.limit);
    }),

  /**
   * Get worst performing strategies
   */
  getWorstStrategies: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const analytics = getStrategyPerformanceAnalytics();
      return await analytics.getWorstStrategies(ctx.user.id, input.limit);
    }),
});
