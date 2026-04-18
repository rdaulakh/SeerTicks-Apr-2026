import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { PreTradeRiskValidator, type PreTradeRequest } from "../risk/PreTradeRiskValidator";
import { PortfolioSnapshotService } from "../portfolio/PortfolioSnapshotService";
import { StrategyRiskTracker } from "../strategy/StrategyRiskTracker";
import { getPaperWallet, getPaperPositions, getTradingModeConfig } from '../db';

/**
 * Advanced Risk Management Router
 * 
 * Provides endpoints for:
 * - Pre-trade risk validation
 * - Portfolio snapshots and equity curves
 * - Strategy-level risk tracking
 */
export const advancedRiskRouter = router({
  /**
   * Validate a trade before execution
   */
  validateTrade: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        side: z.enum(["long", "short"]),
        requestedQuantity: z.number(),
        currentPrice: z.number(),
        confidence: z.number().optional(),
        strategyId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get real portfolio metrics from database
      const tradingMode = ((await getTradingModeConfig(ctx.user.id))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      const wallet = await getPaperWallet(ctx.user.id, tradingMode);
      const openPositions = await getPaperPositions(ctx.user.id, tradingMode);

      const totalCapital = wallet ? parseFloat(wallet.balance) : 10000;
      const unrealizedPnL = openPositions.reduce(
        (sum, p) => sum + parseFloat(p.unrealizedPnL || '0'), 0
      );
      const currentEquity = wallet ? parseFloat(wallet.equity) : totalCapital + unrealizedPnL;
      const openPositionsCount = openPositions.length;
      const portfolioVaR = 0; // VaR calculation is expensive; 0 is acceptable when no positions

      const validator = new PreTradeRiskValidator(
        totalCapital,
        currentEquity,
        openPositionsCount,
        portfolioVaR
      );

      const request: PreTradeRequest = {
        userId: ctx.user.id,
        strategyId: input.strategyId,
        symbol: input.symbol,
        side: input.side,
        requestedQuantity: input.requestedQuantity,
        currentPrice: input.currentPrice,
        confidence: input.confidence,
      };

      const result = await validator.validateTrade(request);

      return {
        passed: result.passed,
        overallRiskScore: result.overallRiskScore,
        kellyCheck: result.kellyCheck,
        varCheck: result.varCheck,
        circuitBreakerCheck: result.circuitBreakerCheck,
        balanceCheck: result.balanceCheck,
        positionLimitCheck: result.positionLimitCheck,
        rejectionReasons: result.rejectionReasons,
        recommendedAction: result.recommendedAction,
        requiresApproval: result.requiresApproval,
      };
    }),

  /**
   * Capture portfolio snapshot
   */
  captureSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
    const service = new PortfolioSnapshotService(ctx.user.id);
    await service.captureSnapshot();
    return { success: true };
  }),

  /**
   * Get portfolio snapshot history
   */
  getSnapshotHistory: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new PortfolioSnapshotService(ctx.user.id);
      const history = await service.getSnapshotHistory(input.days);
      return history;
    }),

  /**
   * Get equity curve for charting
   */
  getEquityCurve: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new PortfolioSnapshotService(ctx.user.id);
      const curve = await service.getEquityCurveForChart(input.days);
      return curve;
    }),

  /**
   * Get performance metrics
   */
  getPerformanceMetrics: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new PortfolioSnapshotService(ctx.user.id);
      const metrics = await service.getPerformanceMetrics(input.days);
      return metrics;
    }),

  /**
   * Create a new trading strategy
   */
  createStrategy: protectedProcedure
    .input(
      z.object({
        strategyName: z.string(),
        strategyType: z.enum([
          "scalping",
          "day_trading",
          "swing_trading",
          "momentum",
          "mean_reversion",
          "breakout",
          "trend_following",
          "custom",
        ]),
        description: z.string().optional(),
        allocatedCapital: z.number(),
        maxCapital: z.number(),
        maxPositions: z.number().optional(),
        maxDrawdown: z.number().optional(),
        maxDailyLoss: z.number(),
        maxPositionSize: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      const strategy = await tracker.createStrategy(input);
      return strategy;
    }),

  /**
   * Get all strategies
   */
  getAllStrategies: protectedProcedure.query(async ({ ctx }) => {
    const tracker = new StrategyRiskTracker(ctx.user.id);
    const strategies = await tracker.getAllStrategies();
    return strategies;
  }),

  /**
   * Get strategy performance summary
   */
  getStrategyPerformance: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      const summary = await tracker.getStrategyPerformanceSummary(input.strategyId);
      return summary;
    }),

  /**
   * Update strategy metrics
   */
  updateStrategyMetrics: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      await tracker.updateStrategyMetrics(input.strategyId);
      return { success: true };
    }),

  /**
   * Reallocate capital by performance
   */
  reallocateCapital: protectedProcedure
    .input(
      z.object({
        totalCapital: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      await tracker.reallocateCapitalByPerformance(input.totalCapital);
      return { success: true };
    }),

  /**
   * Pause a strategy
   */
  pauseStrategy: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
        reason: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      await tracker.pauseStrategy(input.strategyId, input.reason);
      return { success: true };
    }),

  /**
   * Resume a strategy
   */
  resumeStrategy: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      await tracker.resumeStrategy(input.strategyId);
      return { success: true };
    }),

  /**
   * Check strategy risk limits
   */
  checkStrategyRiskLimits: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const tracker = new StrategyRiskTracker(ctx.user.id);
      const result = await tracker.checkStrategyRiskLimits(input.strategyId);
      return result;
    }),
});
