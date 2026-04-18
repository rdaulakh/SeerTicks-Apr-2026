/**
 * Pipeline Router — Exposes Intent-Driven Architecture data to the dashboard.
 * 
 * Phase 30: Provides endpoints for:
 * - Market regime status (MarketRegimeAI)
 * - Signal aggregation details (SignalAggregator)
 * - Decision evaluation metrics (DecisionEvaluator)
 * - Scenario projections (ScenarioEngine)
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";

export const pipelineRouter = router({
  /**
   * Get current market regime for a symbol.
   */
  getRegime: protectedProcedure
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getMarketRegimeAI } = await import("../services/MarketRegimeAI");
        const regimeAI = getMarketRegimeAI();
        const symbol = input?.symbol || 'BTC-USD';
        const context = await regimeAI.getMarketContext(symbol);
        return {
          success: true,
          regime: context.regime,
          confidence: context.regimeConfidence,
          volatilityClass: context.volatilityClass,
          keyDrivers: context.keyDrivers,
          agentGuidance: context.agentGuidance,
          timestamp: context.timestamp,
        };
      } catch (error) {
        return {
          success: false,
          regime: 'unknown',
          confidence: 0,
          volatilityClass: 'medium' as const,
          keyDrivers: [],
          agentGuidance: {},
          timestamp: Date.now(),
          error: (error as Error)?.message,
        };
      }
    }),

  /**
   * Get decision evaluator metrics.
   */
  getDecisionMetrics: protectedProcedure.query(async () => {
    try {
      const { getDecisionEvaluator } = await import("../services/DecisionEvaluator");
      const evaluator = getDecisionEvaluator();
      const metrics = evaluator.getMetrics();
      return { success: true, ...metrics };
    } catch (error) {
      return {
        success: false,
        totalEvaluated: 0,
        totalApproved: 0,
        totalRejected: 0,
        approvalRate: 0,
        avgScore: 0,
        recentDecisions: [],
        error: (error as Error)?.message,
      };
    }
  }),

  /**
   * Get scenario engine accuracy metrics.
   */
  getScenarioMetrics: protectedProcedure.query(async () => {
    try {
      const { getScenarioEngine } = await import("../services/ScenarioEngine");
      const engine = getScenarioEngine();
      const metrics = engine.getAccuracyMetrics();
      return { success: true, ...metrics };
    } catch (error) {
      return {
        success: false,
        totalProjections: 0,
        avgDeviation: 0,
        accuracyByRegime: {},
        error: (error as Error)?.message,
      };
    }
  }),

  /**
   * Get full pipeline status — all layers in one call.
   */
  getFullStatus: protectedProcedure
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const symbol = input?.symbol || 'BTC-USD';
      const status: Record<string, unknown> = {
        timestamp: Date.now(),
        symbol,
      };

      // Layer 1: Market Regime
      try {
        const { getMarketRegimeAI } = await import("../services/MarketRegimeAI");
        const regimeAI = getMarketRegimeAI();
        const context = await regimeAI.getMarketContext(symbol);
        status.regime = {
          active: true,
          regime: context.regime,
          confidence: context.regimeConfidence,
          volatilityClass: context.volatilityClass,
          keyDrivers: context.keyDrivers,
        };
      } catch {
        status.regime = { active: false, regime: 'unknown' };
      }

      // Layer 2: Decision Evaluator
      try {
        const { getDecisionEvaluator } = await import("../services/DecisionEvaluator");
        const evaluator = getDecisionEvaluator();
        const metrics = evaluator.getMetrics();
        status.decisionEvaluator = {
          active: true,
          totalEvaluated: metrics.totalEvaluated,
          approvalRate: metrics.approvalRate,
          avgScore: metrics.avgScore,
          recentDecisions: metrics.recentDecisions.slice(0, 5),
        };
      } catch {
        status.decisionEvaluator = { active: false };
      }

      // Layer 3: Scenario Engine
      try {
        const { getScenarioEngine } = await import("../services/ScenarioEngine");
        const engine = getScenarioEngine();
        const metrics = engine.getAccuracyMetrics();
        status.scenarioEngine = {
          active: true,
          totalProjections: metrics.totalProjections,
          avgDeviation: metrics.avgDeviation,
        };
      } catch {
        status.scenarioEngine = { active: false };
      }

      return status;
    }),

  /**
   * Project scenarios for a hypothetical trade (for UI preview).
   */
  projectScenario: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      currentPrice: z.number(),
      direction: z.enum(['long', 'short']),
      consensusStrength: z.number().min(0).max(1),
    }))
    .query(async ({ input }) => {
      try {
        const { getScenarioEngine } = await import("../services/ScenarioEngine");
        const { getMarketRegimeAI } = await import("../services/MarketRegimeAI");

        const regimeAI = getMarketRegimeAI();
        const context = await regimeAI.getMarketContext(input.symbol);

        const engine = getScenarioEngine();
        const projection = engine.project(
          input.currentPrice,
          input.direction,
          input.consensusStrength,
          context.regime,
          { atrPercent: context.volatilityClass === 'high' ? 4.0 : context.volatilityClass === 'low' ? 1.0 : 2.0 },
        );

        return { success: true, projection, regime: context.regime };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 31: Get calibration metrics — adaptive learning stats.
   */
  getCalibrationMetrics: protectedProcedure
    .query(async () => {
      try {
        const { getCalibrationMetrics, getAllRegimeConfigs } = await import("../services/RegimeCalibration");
        return {
          success: true,
          metrics: getCalibrationMetrics(),
          configs: getAllRegimeConfigs(),
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 32: Get portfolio risk metrics — exposure, drawdown, halt status.
   */
  getPortfolioRiskMetrics: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const { getPortfolioRiskManager, getAllPortfolioRiskManagers } = await import("../services/PortfolioRiskManager");
        const userIdStr = ctx.user?.id?.toString() || 'default';
        const userIdNum = ctx.user?.id || 0;
        const manager = getPortfolioRiskManager(userIdStr);
        
        // Get equity and positions from paper wallet
        const { getPaperWallet } = await import("../db");
        const wallet = await getPaperWallet(userIdNum);
        const equity = wallet?.balance ? parseFloat(wallet.balance.toString()) : 10000;
        
        // Get open positions
        const { PositionManager } = await import("../PositionManager");
        const positionManager = new PositionManager();
        const openPositions = await positionManager.getOpenPositions(userIdNum);
        
        const portfolioPositions = openPositions.map((p: any) => ({
          symbol: p.symbol,
          side: (p.side || 'long') as 'long' | 'short',
          notionalValue: parseFloat(p.quantity || '0') * parseFloat(p.entryPrice || p.price || '0'),
          unrealizedPnl: p.unrealizedPnl || 0,
          entryPrice: parseFloat(p.entryPrice || p.price || '0'),
          currentPrice: parseFloat(p.currentPrice || p.price || '0'),
          quantity: parseFloat(p.quantity || '0'),
        }));
        
        return {
          success: true,
          metrics: manager.getMetrics(equity, portfolioPositions),
          config: manager.getConfig(),
          equity,
          positionCount: openPositions.length,
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 34: Get comprehensive regime intelligence dashboard data.
   * Returns: current regime, transition state, cooldown timers, active/skipped agents,
   * stop-loss config, calibration metrics, and regime history.
   */
  getRegimeDashboard: protectedProcedure
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const symbol = input?.symbol || 'BTC-USD';
      try {
        const { getMarketRegimeAI } = await import("../services/MarketRegimeAI");
        const {
          getRegimeConfig, getCalibrationMetrics, getAllRegimeConfigs,
          getRegimeTransitionSmoother, getSmoothedStopLossAtrMultiplier,
          getSmoothedTakeProfitRrRatio, getSmoothedTradeCooldownMs,
          getSmoothedPositionSizeMultiplier, getSmoothedConsensusThresholdMultiplier,
          getSkipAgents, getTradeCooldownMs, getStopLossAtrMultiplier, getTakeProfitRrRatio,
        } = await import("../services/RegimeCalibration");

        const regimeAI = getMarketRegimeAI();
        const context = await regimeAI.getMarketContext(symbol);
        const regime = context.regime;
        const config = getRegimeConfig(regime);
        const smoother = getRegimeTransitionSmoother();
        const transitionState = smoother.getTransitionState(symbol);
        const allTransitions = smoother.getAllTransitions();
        const regimeHistory = regimeAI.getRegimeHistory(symbol).slice(-20);

        // Current effective (smoothed) values
        const effectiveValues = {
          stopLossAtrMultiplier: getSmoothedStopLossAtrMultiplier(regime, symbol),
          takeProfitRrRatio: getSmoothedTakeProfitRrRatio(regime, symbol),
          tradeCooldownMs: getSmoothedTradeCooldownMs(regime, symbol),
          positionSizeMultiplier: getSmoothedPositionSizeMultiplier(regime, symbol),
          consensusThresholdMultiplier: getSmoothedConsensusThresholdMultiplier(regime, symbol),
        };

        // Base (unsmoothed) values for comparison
        const baseValues = {
          stopLossAtrMultiplier: getStopLossAtrMultiplier(regime),
          takeProfitRrRatio: getTakeProfitRrRatio(regime),
          tradeCooldownMs: getTradeCooldownMs(regime),
          positionSizeMultiplier: config.positionSizeMultiplier,
          consensusThresholdMultiplier: config.consensusThresholdMultiplier,
        };

        // Active vs skipped agents
        const skipAgents = getSkipAgents(regime);
        const allAgentNames = Object.keys(config.agentWeights);
        const activeAgents = allAgentNames.filter(a => !skipAgents.includes(a));

        return {
          success: true,
          symbol,
          regime,
          regimeConfidence: context.regimeConfidence,
          previousRegime: context.previousRegime,
          regimeAge: context.regimeAge,
          volatilityClass: context.volatilityClass,
          trendStrength: context.trendStrength,
          trendDirection: context.trendDirection,
          keyDrivers: context.keyDrivers,
          effectiveValues,
          baseValues,
          isTransitioning: !!transitionState,
          transitionState: transitionState ? {
            from: transitionState.fromRegime,
            to: transitionState.toRegime,
            elapsed: Date.now() - transitionState.transitionStartMs,
            gracePeriodMs: transitionState.gracePeriodMs,
            progress: Math.min(1, (Date.now() - transitionState.transitionStartMs) / transitionState.gracePeriodMs),
          } : null,
          allTransitions: allTransitions.map(t => ({
            symbol: t.symbol,
            from: t.fromRegime,
            to: t.toRegime,
            elapsed: Date.now() - t.transitionStartMs,
            gracePeriodMs: t.gracePeriodMs,
            progress: Math.min(1, (Date.now() - t.transitionStartMs) / t.gracePeriodMs),
          })),
          activeAgents,
          skipAgents,
          agentWeights: config.agentWeights,
          calibration: getCalibrationMetrics(),
          allRegimeConfigs: getAllRegimeConfigs(),
          regimeHistory,
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 35: Get cross-cycle signal memory stats.
   */
  getCrossCycleMemory: protectedProcedure
    .input(z.object({ symbol: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getCrossCycleMemory } = await import('../services/CrossCycleMemory');
        const memory = getCrossCycleMemory();
        const symbol = input?.symbol || 'BTC-USD';
        const context = memory.getContext(symbol);
        const allStats = memory.getStats();
        return {
          success: true,
          symbol,
          ...context,
          allSymbolStats: allStats,
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 35: Get agent re-trigger stats.
   */
  getRetriggerStats: protectedProcedure
    .query(async () => {
      try {
        const { getAgentRetriggerService } = await import('../services/AgentRetriggerService');
        const stats = getAgentRetriggerService().getStats();
        return { success: true, ...stats };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 35: Run Monte Carlo simulation on demand.
   */
  runMonteCarlo: protectedProcedure
    .input(z.object({
      currentPrice: z.number(),
      direction: z.enum(['long', 'short']),
      regime: z.string().optional(),
      strength: z.number().optional(),
      atrPercent: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMonteCarloSimulator } = await import('../services/MonteCarloSimulator');
        const mc = getMonteCarloSimulator();
        const result = mc.simulate(
          input.currentPrice,
          input.direction,
          input.regime || 'range_bound',
          input.strength || 0.5,
          input.atrPercent
        );
        const projection = mc.toScenarioProjection(
          result,
          input.currentPrice,
          input.direction,
          input.regime || 'range_bound'
        );
        return {
          success: true,
          monteCarlo: result,
          projection,
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 36: Get regime performance tracking data.
   */
  getRegimePerformance: protectedProcedure
    .query(async () => {
      try {
        const { getRegimePerformanceTracker } = await import('../services/RegimePerformanceTracker');
        const tracker = getRegimePerformanceTracker();
        const summary = tracker.getSummary();
        return { success: true, ...summary };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),

  /**
   * Phase 36: Get conviction heatmap data from CrossCycleMemory.
   * Returns per-symbol, per-agent conviction scores for heatmap visualization.
   */
  getConvictionHeatmap: protectedProcedure
    .query(async () => {
      try {
        const { getCrossCycleMemory } = await import('../services/CrossCycleMemory');
        const memory = getCrossCycleMemory();
        const allStats = memory.getStats();

        // Build heatmap: symbol -> agent -> { signal, conviction, consecutiveCycles }
        const heatmapData: Record<string, Record<string, {
          signal: string;
          conviction: number;
          consecutiveCycles: number;
          flipCount: number;
        }>> = {};

        for (const symbol of Object.keys(allStats)) {
          const ctx = memory.getContext(symbol);
          heatmapData[symbol] = {};
          for (const [agent, persistence] of Object.entries(ctx.signalPersistence)) {
            heatmapData[symbol][agent] = {
              signal: persistence.currentSignal,
              conviction: persistence.convictionScore,
              consecutiveCycles: persistence.consecutiveCycles,
              flipCount: persistence.flipCount,
            };
          }
        }

        // Collect all unique agent names
        const allAgents = new Set<string>();
        for (const agents of Object.values(heatmapData)) {
          for (const agent of Object.keys(agents)) {
            allAgents.add(agent);
          }
        }

        return {
          success: true,
          heatmap: heatmapData,
          symbols: Object.keys(heatmapData),
          agents: Array.from(allAgents).sort(),
        };
      } catch (error) {
        return { success: false, error: (error as Error)?.message };
      }
    }),
});
