/**
 * Risk Management API Router
 *
 * Exposes risk management methods for monitoring and validation.
 * Phase 18: Added VaR status, correlation matrix, walk-forward optimization,
 * and unified TradingConfig endpoints for the Risk Dashboard frontend.
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getRiskManager } from "../RiskManager";

export const riskManagementRouter = router({
  /**
   * Get current risk state
   * Returns drawdown state, limits, and halt status
   */
  getRiskState: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return {
      state: riskManager.getRiskState(),
      isHalted: riskManager.isTradingHalted(),
      haltReason: riskManager.getHaltReason(),
      isMacroVeto: riskManager.isMacroVeto(),
      macroVetoReason: riskManager.getMacroVetoReason(),
    };
  }),

  /**
   * Get risk limits configuration
   */
  getRiskLimits: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return riskManager.getRiskLimits();
  }),

  /**
   * Get drawdown state
   * Returns current balance, daily/weekly drawdown, and halt status
   */
  getDrawdownState: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return riskManager.getRiskState();
  }),

  /**
   * Validate position size before placing order
   * Returns whether the position size is allowed and reason if not
   */
  checkPositionSize: protectedProcedure
    .input(z.object({
      userId: z.number(),
      positionSize: z.number().positive(),
      accountBalance: z.number().positive(),
      symbol: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      return await riskManager.checkPositionSize(
        input.userId,
        input.positionSize,
        input.accountBalance,
        input.symbol
      );
    }),

  /**
   * Validate correlated exposure before opening position
   * Returns whether the new position would exceed correlation limits
   */
  checkCorrelatedExposure: protectedProcedure
    .input(z.object({
      userId: z.number(),
      newSymbol: z.string(),
      newPositionSize: z.number().positive(),
      accountBalance: z.number().positive(),
      openPositions: z.array(z.object({
        symbol: z.string(),
        positionSize: z.number(),
        side: z.enum(['long', 'short']).optional(),
      })),
    }))
    .query(async ({ input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      return await riskManager.checkCorrelatedExposure(
        input.userId,
        input.newSymbol,
        input.newPositionSize,
        input.accountBalance,
        input.openPositions
      );
    }),

  /**
   * Check if trading is currently halted
   */
  isTradingHalted: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return {
      isHalted: riskManager.isTradingHalted(),
      reason: riskManager.getHaltReason(),
    };
  }),

  /**
   * Check if macro veto is active
   */
  isMacroVeto: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return {
      isActive: riskManager.isMacroVeto(),
      reason: riskManager.getMacroVetoReason(),
    };
  }),

  /**
   * Get risk metrics summary
   * Aggregates all risk-related metrics for dashboard display
   */
  getRiskMetrics: protectedProcedure.query(async () => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    const state = riskManager.getRiskState();
    const limits = riskManager.getRiskLimits();

    return {
      // Current state
      currentBalance: state.currentBalance,
      dailyDrawdown: state.dailyDrawdown,
      weeklyDrawdown: state.weeklyDrawdown,
      isHalted: state.isHalted,
      haltReason: state.haltReason,
      
      // Limits
      maxDailyDrawdown: limits.maxDailyDrawdown,
      maxWeeklyDrawdown: limits.maxWeeklyDrawdown,
      maxPositionSize: limits.maxPositionSize,
      maxCorrelatedExposure: limits.maxCorrelatedExposure,
      
      // Utilization percentages
      dailyDrawdownUtilization: state.dailyDrawdown / limits.maxDailyDrawdown,
      weeklyDrawdownUtilization: state.weeklyDrawdown / limits.maxWeeklyDrawdown,
      
      // Risk level
      riskLevel: state.dailyDrawdown > limits.maxDailyDrawdown * 0.8 ? 'critical' :
                 state.dailyDrawdown > limits.maxDailyDrawdown * 0.6 ? 'high' :
                 state.dailyDrawdown > limits.maxDailyDrawdown * 0.4 ? 'medium' : 'low',
    };
  }),

  /**
   * Get recent risk limit breaches
   */
  getRecentBreaches: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(10),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { riskLimitBreaches } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      const breaches = await db
        .select()
        .from(riskLimitBreaches)
        .orderBy(desc(riskLimitBreaches.createdAt))
        .limit(input.limit);
      
      return breaches;
    }),

  /**
   * Validate trade recommendation against risk limits
   * Comprehensive validation before executing a trade
   */
  validateTradeRecommendation: protectedProcedure
    .input(z.object({
      userId: z.number(),
      symbol: z.string(),
      positionSize: z.number().positive(),
      accountBalance: z.number().positive(),
      openPositions: z.array(z.object({
        symbol: z.string(),
        positionSize: z.number(),
        side: z.enum(['long', 'short']).optional(),
      })),
    }))
    .query(async ({ input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      // Check if trading is halted
      if (riskManager.isTradingHalted()) {
        return {
          allowed: false,
          reason: `Trading is halted: ${riskManager.getHaltReason()}`,
          checks: {
            tradingHalted: false,
            positionSize: null,
            correlatedExposure: null,
            macroVeto: false,
          },
        };
      }

      // Check macro veto
      if (riskManager.isMacroVeto()) {
        return {
          allowed: false,
          reason: `Macro veto active: ${riskManager.getMacroVetoReason()}`,
          checks: {
            tradingHalted: true,
            positionSize: null,
            correlatedExposure: null,
            macroVeto: false,
          },
        };
      }

      // Check position size
      const positionSizeCheck = await riskManager.checkPositionSize(
        input.userId,
        input.positionSize,
        input.accountBalance,
        input.symbol
      );

      if (!positionSizeCheck.allowed) {
        return {
          allowed: false,
          reason: positionSizeCheck.reason,
          checks: {
            tradingHalted: true,
            positionSize: false,
            correlatedExposure: null,
            macroVeto: true,
          },
        };
      }

      // Check correlated exposure
      const correlationCheck = await riskManager.checkCorrelatedExposure(
        input.userId,
        input.symbol,
        input.positionSize,
        input.accountBalance,
        input.openPositions
      );

      if (!correlationCheck.allowed) {
        return {
          allowed: false,
          reason: correlationCheck.reason,
          checks: {
            tradingHalted: true,
            positionSize: true,
            correlatedExposure: false,
            macroVeto: true,
          },
        };
      }

      // All checks passed
      return {
        allowed: true,
        reason: 'All risk checks passed',
        checks: {
          tradingHalted: true,
          positionSize: true,
          correlatedExposure: true,
          macroVeto: true,
        },
      };
    }),

  // ================================================================
  // Phase 17+18: VaR, Correlation, Walk-Forward, TradingConfig
  // ================================================================

  /**
   * Phase 17: VaR Risk Gate status
   * Returns current portfolio VaR metrics and data quality indicators
   */
  getVaRStatus: protectedProcedure.query(async () => {
    try {
      const { getVaRStatus } = await import('../services/VaRRiskGate');
      const { getTradingConfig } = await import('../config/TradingConfig');
      const status = getVaRStatus();
      const config = getTradingConfig().varLimits;

      return {
        enabled: config.enabled,
        dataPoints: status.dataPoints,
        recentVolatility: status.recentVolatility,
        recentMeanReturn: status.recentMeanReturn,
        limits: {
          maxPortfolioVaR95Percent: config.maxPortfolioVaR95Percent,
          maxIncrementalVaR95Percent: config.maxIncrementalVaR95Percent,
          maxPortfolioCVaR95Percent: config.maxPortfolioCVaR95Percent,
        },
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        enabled: false,
        dataPoints: 0,
        recentVolatility: 0,
        recentMeanReturn: 0,
        limits: { maxPortfolioVaR95Percent: 0, maxIncrementalVaR95Percent: 0, maxPortfolioCVaR95Percent: 0 },
        timestamp: new Date().toISOString(),
      };
    }
  }),

  /**
   * Phase 17: Dynamic Correlation matrix and status
   * Returns rolling correlations between trading pairs
   */
  getCorrelationMatrix: protectedProcedure.query(async () => {
    try {
      const { getDynamicCorrelationTracker } = await import('../services/DynamicCorrelationTracker');
      const tracker = getDynamicCorrelationTracker();
      const matrix = tracker.getCorrelationMatrix();
      const status = tracker.getStatus();

      return {
        matrix: {
          symbols: matrix.symbols,
          correlations: matrix.matrix,
          windowMinutes: matrix.windowMinutes,
          dataPoints: matrix.dataPoints,
        },
        trackedSymbols: status.trackedSymbols,
        openExposure: status.openExposure,
        correlationPairs: status.correlationPairs.map(p => ({
          symbolA: p.symbolA,
          symbolB: p.symbolB,
          correlation: p.correlation,
          dataPoints: p.dataPoints,
        })),
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        matrix: { symbols: [], correlations: [], windowMinutes: 5, dataPoints: 0 },
        trackedSymbols: [],
        openExposure: {} as Record<string, number>,
        correlationPairs: [],
        timestamp: new Date().toISOString(),
      };
    }
  }),

  /**
   * Phase 17: Walk-Forward Optimization results
   * Returns parameter stability, overfit detection, and recommended parameters
   */
  getWalkForwardResults: protectedProcedure.query(async () => {
    try {
      const { getWalkForwardOptimizer } = await import('../services/WalkForwardOptimizer');
      const result = getWalkForwardOptimizer().getLastResult();

      if (!result) {
        return {
          status: 'pending' as const,
          message: 'Walk-forward optimization has not run yet',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: 'complete' as const,
        timestamp: new Date(result.timestamp).toISOString(),
        totalWindows: result.totalWindows,
        avgInSampleSharpe: result.avgInSampleSharpe,
        avgOutOfSampleSharpe: result.avgOutOfSampleSharpe,
        avgOverfitRatio: result.avgOverfitRatio,
        maxParameterDrift: result.maxParameterDrift,
        isOverfit: result.isOverfit,
        isUnstable: result.isUnstable,
        confidence: result.confidence,
        recommendedParams: result.recommendedParams,
        windows: result.windowResults.map(w => ({
          trainTrades: w.trainTrades,
          testTrades: w.testTrades,
          inSampleSharpe: w.inSampleSharpe,
          outOfSampleSharpe: w.outOfSampleSharpe,
          overfitRatio: w.overfitRatio,
          parameterDrift: w.parameterDrift,
        })),
      };
    } catch {
      return {
        status: 'error' as const,
        message: 'Walk-forward optimizer unavailable',
        timestamp: new Date().toISOString(),
      };
    }
  }),

  /**
   * Phase 17: Unified TradingConfig view
   * Returns full active configuration for all trading parameters
   */
  getTradingConfig: protectedProcedure.query(async () => {
    try {
      const { getTradingConfig, validateConfig } = await import('../config/TradingConfig');
      const config = getTradingConfig();
      const errors = validateConfig(config);

      return {
        config,
        isValid: errors.length === 0,
        validationErrors: errors,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        config: null,
        isValid: false,
        validationErrors: [error instanceof Error ? error.message : 'Unknown error'],
        timestamp: new Date().toISOString(),
      };
    }
  }),

  /**
   * Phase 16: Agent Alpha Validation results
   * Returns per-agent statistical alpha analysis
   */
  getAlphaValidation: protectedProcedure.query(async () => {
    try {
      const { getAgentAlphaValidator } = await import('../services/AgentAlphaValidator');
      const result = getAgentAlphaValidator().getLastValidation();

      if (!result) {
        return { status: 'pending' as const, message: 'Alpha validation has not run yet' };
      }

      return {
        status: 'complete' as const,
        timestamp: new Date(result.timestamp).toISOString(),
        totalTradesAnalyzed: result.totalTradesAnalyzed,
        systemMetrics: {
          winRate: result.systemWinRate,
          sharpeRatio: result.systemSharpe,
          profitFactor: result.systemProfitFactor,
        },
        agentsWithAlpha: result.agentsWithAlpha,
        agentsToBoost: result.agentsToBoost,
        agentsToPrune: result.agentsToPrune,
        agentReports: result.agentReports.map((r: any) => ({
          agentName: r.agentName,
          alphaGrade: r.alphaGrade,
          recommendation: r.recommendation,
          totalTrades: r.totalTrades,
          directionalAccuracy: r.directionalAccuracy,
          sharpeRatio: r.sharpeRatio,
          profitFactor: r.profitFactor,
          informationCoefficient: r.informationCoefficient,
          pValue: r.pValue,
          isSignificant: r.isSignificant,
          hasAlpha: r.hasAlpha,
          rollingWinRate: r.rollingWinRate,
        })),
      };
    } catch {
      return { status: 'error' as const, message: 'Alpha validator unavailable' };
    }
  }),

  /**
   * Phase 16: Adaptive consensus weights
   */
  getConsensusWeights: protectedProcedure.query(async () => {
    try {
      const { getAdaptiveConsensusEngine } = await import('../services/AdaptiveConsensusEngine');
      const status = getAdaptiveConsensusEngine().getStatus();

      return {
        isActive: status.isActive,
        lastUpdate: status.lastUpdate > 0 ? new Date(status.lastUpdate).toISOString() : null,
        totalUpdates: status.totalUpdates,
        boostedAgents: status.boostedAgents,
        prunedAgents: status.prunedAgents,
        weights: status.currentWeights.map((w: any) => ({
          agentName: w.agentName,
          baseWeight: w.baseWeight,
          alphaMultiplier: w.alphaMultiplier,
          rollingMultiplier: w.rollingMultiplier,
          finalWeight: w.finalWeight,
          reason: w.reason,
        })),
      };
    } catch {
      return {
        isActive: false, lastUpdate: null, totalUpdates: 0,
        boostedAgents: 0, prunedAgents: 0, weights: [],
      };
    }
  }),
});
