/**
 * Risk Management tRPC Router
 * 
 * Exposes institutional-grade risk management functions to frontend
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import {
  assessPortfolioRisk,
  assessPositionRisk,
  preTradeRiskCheck,
  calculateDailyRebalancing,
} from '../risk/RiskManagementService';
import {
  calculateKelly,
  calculatePositionSize,
  calculateRebalance,
} from '../risk/KellyCriterion';
import { calculateAllVaR } from '../risk/VaRCalculator';
import { calculateDrawdown, getCircuitBreakerStatus } from '../risk/DrawdownMonitor';
import { allocateCapital, DEFAULT_ALLOCATION } from '../risk/CapitalAllocationManager';
import {
  createStrategy,
  getStrategiesByUserId,
  getActiveStrategies,
  updateStrategy,
  createRiskMetric,
  getLatestRiskMetric,
  getRiskMetricsHistory,
  createCapitalAllocation,
  getLatestCapitalAllocation,
  getCapitalAllocationHistory,
  createRiskEvent,
  getUnresolvedRiskEvents,
  getRiskEventsHistory,
  resolveRiskEvent,
  createPortfolioSnapshot,
  getPortfolioSnapshotsHistory,
  getLatestPortfolioSnapshot,
  getLatestPositionRiskMetric,
  getPositionRiskMetricsForUser,
} from '../db/riskDb';
import { getPaperWallet, getPaperPositions, getTradingModeConfig } from '../db';

export const riskRouter = router({
  // ============================================================================
  // PORTFOLIO RISK ASSESSMENT
  // ============================================================================

  /**
   * Get comprehensive portfolio risk assessment
   */
  getPortfolioRisk: protectedProcedure
    .input(
      z.object({
        equityCurveDays: z.number().default(90),
        dailyReturnsDays: z.number().default(90),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get paper wallet
      const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      if (!wallet) {
        throw new Error('Paper wallet not found');
      }

      // Get portfolio snapshots for equity curve
      const snapshots = await getPortfolioSnapshotsHistory(userId, input.equityCurveDays);
      const equityCurve = snapshots.map((s) => Number(s.totalEquity));

      // Calculate daily returns from equity curve
      const dailyReturns: number[] = [];
      for (let i = 1; i < equityCurve.length; i++) {
        const returnPct = (equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1];
        dailyReturns.push(returnPct);
      }

      // Get current positions
      const positions = await getPaperPositions(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      const positionsValue = positions.reduce(
        (sum, p) => sum + Number(p.currentPrice) * Number(p.quantity),
        0
      );

      // Calculate required margin (simplified: 10% of position value)
      const requiredMargin = positionsValue * 0.1;

      // Assess portfolio risk
      const assessment = await assessPortfolioRisk({
        portfolioValue: Number(wallet.equity),
        cashBalance: Number(wallet.balance),
        positionsValue,
        numberOfPositions: positions.length,
        equityCurve,
        dailyReturns,
        currentPositionsValue: positionsValue,
        requiredMargin,
      });

      return assessment;
    }),

  /**
   * Get current circuit breaker status
   */
  getCircuitBreakerStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Get latest risk metric
    const latestMetric = await getLatestRiskMetric(userId);
    const currentDrawdown = latestMetric ? Number(latestMetric.currentDrawdown) : 0;

    return getCircuitBreakerStatus(currentDrawdown);
  }),

  /**
   * Get capital allocation breakdown
   */
  getCapitalAllocation: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Get latest allocation or calculate new one
    let allocation = await getLatestCapitalAllocation(userId);

    if (!allocation) {
      // Create initial allocation
      const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      if (!wallet) {
        throw new Error('Paper wallet not found');
      }

      const tiers = allocateCapital(Number(wallet.equity), DEFAULT_ALLOCATION);

      allocation = await createCapitalAllocation({
        userId,
        timestamp: new Date(),
        totalCapital: tiers.totalCapital.toString(),
        activeTradingCapital: tiers.activeTradingCapital.toString(),
        maintenanceMarginBuffer: tiers.maintenanceMarginBuffer.toString(),
        drawdownProtectionReserve: tiers.drawdownProtectionReserve.toString(),
        opportunityCapital: tiers.opportunityCapital.toString(),
        activeTradingPercent: DEFAULT_ALLOCATION.activeTradingPercent.toString(),
        marginBufferPercent: DEFAULT_ALLOCATION.marginBufferPercent.toString(),
        drawdownReservePercent: DEFAULT_ALLOCATION.drawdownReservePercent.toString(),
        opportunityPercent: DEFAULT_ALLOCATION.opportunityPercent.toString(),
        strategyAllocations: {},
        trigger: 'scheduled',
        reason: 'Initial allocation',
      });
    }

    return allocation;
  }),

  /**
   * Get capital allocation history
   */
  getCapitalAllocationHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return getCapitalAllocationHistory(ctx.user.id, input.limit);
    }),

  // ============================================================================
  // POSITION RISK ASSESSMENT
  // ============================================================================

  /**
   * Assess risk for a specific position
   */
  assessPosition: protectedProcedure
    .input(
      z.object({
        positionId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get position
      const positions = await getPaperPositions(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      const position = positions.find((p) => p.id === input.positionId);

      if (!position) {
        throw new Error('Position not found');
      }

      // Get wallet for portfolio value
      const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      if (!wallet) {
        throw new Error('Paper wallet not found');
      }

      // Get latest risk metric for portfolio VaR
      const latestMetric = await getLatestRiskMetric(userId);
      const portfolioVaR = latestMetric ? Number(latestMetric.portfolioVaR95) : 0;

      // Calculate position value
      const positionValue = Number(position.currentPrice) * Number(position.quantity);

      // Simplified: use 0.5 correlation and empty returns array
      // In production, calculate actual correlation and historical returns
      const assessment = await assessPositionRisk({
        positionId: position.id,
        symbol: position.symbol,
        positionValue,
        entryPrice: Number(position.entryPrice),
        currentPrice: Number(position.currentPrice),
        stopLoss: Number(position.stopLoss || 0),
        takeProfit: Number(position.takeProfit || 0),
        portfolioValue: Number(wallet.equity),
        portfolioVaR,
        correlationWithPortfolio: 0.5,
        historicalReturns: [],
        kellyFraction: 0.05, // 5% default Kelly fraction
        availableCapital: Number(wallet.balance),
      });

      return assessment;
    }),

  /**
   * Get position risk metrics
   */
  getPositionRiskMetrics: protectedProcedure.query(async ({ ctx }) => {
    return getPositionRiskMetricsForUser(ctx.user.id);
  }),

  // ============================================================================
  // PRE-TRADE RISK CHECKS
  // ============================================================================

  /**
   * Check if a new position can be opened
   */
  checkPreTrade: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        requestedSize: z.number(),
        currentPrice: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get wallet
      const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
      if (!wallet) {
        throw new Error('Paper wallet not found');
      }

      // Get current positions
      const positions = await getPaperPositions(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');

      // Get latest risk metric for drawdown
      const latestMetric = await getLatestRiskMetric(userId);
      const currentDrawdown = latestMetric ? Number(latestMetric.currentDrawdown) : 0;

      // Perform pre-trade risk check
      const check = await preTradeRiskCheck({
        symbol: input.symbol,
        requestedSize: input.requestedSize,
        currentPrice: input.currentPrice,
        portfolioValue: Number(wallet.equity),
        availableCapital: Number(wallet.balance),
        currentPositionsCount: positions.length,
        maxPositions: 10, // Default risk limit — overridden by strategy config if present
        maxPositionSizePercent: 20, // Default risk limit — 20% max single position
        currentDrawdown,
        kellyFraction: 0.05, // Conservative 5% Kelly fraction (half-Kelly)
      });

      return check;
    }),

  // ============================================================================
  // KELLY CRITERION & POSITION SIZING
  // ============================================================================

  /**
   * Calculate Kelly optimal position size
   */
  calculateKellySize: protectedProcedure
    .input(
      z.object({
        meanReturn: z.number(),
        stdDeviation: z.number(),
        riskFreeRate: z.number().default(0.03),
        availableCapital: z.number(),
        currentPrice: z.number(),
      })
    )
    .query(async ({ input }) => {
      // Calculate Kelly fraction
      const kelly = calculateKelly({
        meanReturn: input.meanReturn,
        stdDeviation: input.stdDeviation,
        riskFreeRate: input.riskFreeRate,
      });

      // Calculate position size
      const positionSize = calculatePositionSize({
        availableCapital: input.availableCapital,
        kellyFraction: kelly.adjustedFraction,
        currentPrice: input.currentPrice,
      });

      return {
        kelly,
        positionSize,
      };
    }),

  /**
   * Calculate rebalancing recommendations
   */
  getRebalancingRecommendations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Get wallet
    const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
    if (!wallet) {
      throw new Error('Paper wallet not found');
    }

    // Get positions
    const positions = await getPaperPositions(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');

    // Calculate rebalancing
    const recommendations = await calculateDailyRebalancing({
      positions: positions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        currentValue: Number(p.currentPrice) * Number(p.quantity),
        kellyFraction: 0.05, // TODO: Calculate from strategy
      })),
      currentEquity: Number(wallet.equity),
    });

    return recommendations;
  }),

  // ============================================================================
  // RISK METRICS & HISTORY
  // ============================================================================

  /**
   * Get latest risk metrics
   */
  getLatestRiskMetrics: protectedProcedure.query(async ({ ctx }) => {
    return getLatestRiskMetric(ctx.user.id);
  }),

  /**
   * Get risk metrics history
   */
  getRiskMetricsHistory: protectedProcedure
    .input(
      z.object({
        startDate: z.date(),
        endDate: z.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getRiskMetricsHistory(ctx.user.id, input.startDate, input.endDate);
    }),

  /**
   * Create risk metric snapshot
   */
  createRiskMetricSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Get wallet
    const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
    if (!wallet) {
      throw new Error('Paper wallet not found');
    }

    // Get portfolio snapshots for calculations
    const snapshots = await getPortfolioSnapshotsHistory(userId, 90);
    const equityCurve = snapshots.map((s) => Number(s.totalEquity));

    // Calculate daily returns
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const returnPct = (equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1];
      dailyReturns.push(returnPct);
    }

    // Calculate VaR
    const var95 = calculateAllVaR(dailyReturns, Number(wallet.equity), 0.95, 1);
    const var99 = calculateAllVaR(dailyReturns, Number(wallet.equity), 0.99, 1);

    // Calculate drawdown
    const drawdown = calculateDrawdown(Number(wallet.equity), equityCurve);
    const circuitBreaker = getCircuitBreakerStatus(drawdown.currentDrawdown);

    // Create risk metric
    const metric = await createRiskMetric({
      userId,
      timestamp: new Date(),
      portfolioValue: wallet.equity,
      portfolioVaR95: var95.averageVaR.toString(),
      portfolioVaR99: var99.averageVaR.toString(),
      historicalVaR: var95.historicalVaR.toString(),
      parametricVaR: var95.parametricVaR.toString(),
      monteCarloVaR: var95.monteCarloVaR.toString(),
      currentDrawdown: drawdown.currentDrawdown.toString(),
      maxDrawdown: drawdown.maxDrawdown.toString(),
      peakEquity: drawdown.peakEquity.toString(),
      drawdownDuration: drawdown.drawdownDuration,
      circuitBreakerLevel: circuitBreaker.level,
    });

    return metric;
  }),

  // ============================================================================
  // RISK EVENTS
  // ============================================================================

  /**
   * Get unresolved risk events
   */
  getUnresolvedRiskEvents: protectedProcedure.query(async ({ ctx }) => {
    return getUnresolvedRiskEvents(ctx.user.id);
  }),

  /**
   * Get risk events history
   */
  getRiskEventsHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      return getRiskEventsHistory(ctx.user.id, input.limit);
    }),

  /**
   * Create risk event
   */
  createRiskEvent: protectedProcedure
    .input(
      z.object({
        eventType: z.enum([
          'drawdown_alert',
          'var_breach',
          'margin_warning',
          'circuit_breaker_yellow',
          'circuit_breaker_orange',
          'circuit_breaker_red',
          'circuit_breaker_emergency',
          'position_size_violation',
          'correlation_spike',
          'volatility_spike',
          'reserve_deployment',
          'forced_liquidation',
        ]),
        severity: z.enum(['info', 'warning', 'critical', 'emergency']),
        title: z.string(),
        description: z.string().optional(),
        portfolioValue: z.number().optional(),
        drawdownPercent: z.number().optional(),
        actionTaken: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createRiskEvent({
        userId: ctx.user.id,
        timestamp: new Date(),
        eventType: input.eventType,
        severity: input.severity,
        title: input.title,
        description: input.description,
        portfolioValue: input.portfolioValue?.toString(),
        drawdownPercent: input.drawdownPercent?.toString(),
        actionTaken: input.actionTaken,
        resolved: false,
      });
    }),

  /**
   * Resolve risk event
   */
  resolveRiskEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.number(),
        resolutionNotes: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return resolveRiskEvent(input.eventId, input.resolutionNotes);
    }),

  // ============================================================================
  // PORTFOLIO SNAPSHOTS
  // ============================================================================

  /**
   * Get portfolio snapshots history (equity curve)
   */
  getPortfolioSnapshots: protectedProcedure
    .input(z.object({ days: z.number().default(90) }))
    .query(async ({ ctx, input }) => {
      return getPortfolioSnapshotsHistory(ctx.user.id, input.days);
    }),

  /**
   * Create daily portfolio snapshot
   */
  createPortfolioSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Get wallet
    const wallet = await getPaperWallet(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
    if (!wallet) {
      throw new Error('Paper wallet not found');
    }

    // Get positions
    const positions = await getPaperPositions(userId, ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live');
    const positionsValue = positions.reduce(
      (sum, p) => sum + Number(p.currentPrice) * Number(p.quantity),
      0
    );

    // Get previous snapshot for daily return calculation
    const previousSnapshot = await getLatestPortfolioSnapshot(userId);
    const dailyReturn = previousSnapshot
      ? (Number(wallet.equity) - Number(previousSnapshot.totalEquity)) /
        Number(previousSnapshot.totalEquity)
      : 0;
    const dailyPnL = previousSnapshot
      ? Number(wallet.equity) - Number(previousSnapshot.totalEquity)
      : 0;

    // Get latest risk metric
    const latestMetric = await getLatestRiskMetric(userId);

    // Create snapshot
    const snapshot = await createPortfolioSnapshot({
      userId,
      snapshotDate: new Date(),
      totalEquity: wallet.equity,
      cash: wallet.balance,
      positionsValue: positionsValue.toString(),
      unrealizedPnL: wallet.unrealizedPnL,
      realizedPnL: wallet.realizedPnL,
      dailyReturn: dailyReturn.toString(),
      dailyPnL: dailyPnL.toString(),
      numberOfPositions: positions.length,
      positionDetails: positions.map((p) => ({
        symbol: p.symbol,
        value: Number(p.currentPrice) * Number(p.quantity),
        pnl: Number(p.unrealizedPnL),
      })),
      portfolioVaR95: latestMetric?.portfolioVaR95,
      currentDrawdown: latestMetric?.currentDrawdown,
      sharpeRatio: latestMetric?.sharpeRatio30d,
    });

    return snapshot;
  }),

  // ============================================================================
  // STRATEGIES
  // ============================================================================

  /**
   * Get all strategies
   */
  getStrategies: protectedProcedure.query(async ({ ctx }) => {
    return getStrategiesByUserId(ctx.user.id);
  }),

  /**
   * Get active strategies
   */
  getActiveStrategies: protectedProcedure.query(async ({ ctx }) => {
    return getActiveStrategies(ctx.user.id);
  }),

  /**
   * Create new strategy
   */
  createStrategy: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(['momentum', 'mean_reversion', 'breakout', 'scalping', 'swing', 'arbitrage']),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createStrategy({
        userId: ctx.user.id,
        name: input.name,
        type: input.type,
        description: input.description,
        status: 'active',
      });
    }),

  /**
   * Update strategy
   */
  updateStrategy: protectedProcedure
    .input(
      z.object({
        strategyId: z.number(),
        status: z.enum(['active', 'suspended', 'archived']).optional(),
        allocatedCapital: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updates: any = {};
      if (input.status) updates.status = input.status;
      if (input.allocatedCapital !== undefined)
        updates.allocatedCapital = input.allocatedCapital.toString();

      return updateStrategy(input.strategyId, updates);
    }),
});
