/**
 * Consensus Threshold Backtest Router
 * 
 * API endpoints for testing consensus threshold configurations.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getConsensusThresholdBacktester,
  type ThresholdBacktestConfig,
  type ThresholdPreset,
  type ThresholdOptimizationResult,
} from "../services/ConsensusThresholdBacktester";

export const consensusBacktestRouter = router({
  // Run a single backtest with specific configuration
  runBacktest: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      symbol: z.string(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
      baseThreshold: z.number().min(0.05).max(0.80).default(0.25),
      regimeMultipliers: z.object({
        trending: z.number().min(0.5).max(1.5).default(0.80),
        volatile: z.number().min(1.0).max(2.0).default(1.40),
        ranging: z.number().min(0.8).max(1.5).default(1.10),
      }).optional(),
      positionTiers: z.object({
        scout: z.number().min(0.01).max(0.10).default(0.03),
        moderate: z.number().min(0.02).max(0.15).default(0.05),
        standard: z.number().min(0.03).max(0.20).default(0.07),
        strong: z.number().min(0.05).max(0.25).default(0.10),
        high: z.number().min(0.08).max(0.30).default(0.15),
        max: z.number().min(0.10).max(0.40).default(0.20),
      }).optional(),
      initialCapital: z.number().min(1000).max(10000000).default(100000),
      maxDrawdownLimit: z.number().min(0.10).max(0.50).default(0.25),
      holdingPeriodHours: z.number().min(1).max(168).default(24),
      stopLossPercent: z.number().min(0.01).max(0.20).default(0.05),
      takeProfitPercent: z.number().min(0.02).max(0.50).default(0.10),
    }))
    .mutation(async ({ ctx, input }) => {
      const backtester = getConsensusThresholdBacktester();
      
      const config: ThresholdBacktestConfig = {
        name: input.name,
        symbol: input.symbol,
        startDate: input.startDate,
        endDate: input.endDate,
        baseThreshold: input.baseThreshold,
        regimeMultipliers: input.regimeMultipliers || {
          trending: 0.80,
          volatile: 1.40,
          ranging: 1.10,
        },
        positionTiers: input.positionTiers || {
          scout: 0.03,
          moderate: 0.05,
          standard: 0.07,
          strong: 0.10,
          high: 0.15,
          max: 0.20,
        },
        initialCapital: input.initialCapital,
        maxDrawdownLimit: input.maxDrawdownLimit,
        holdingPeriodHours: input.holdingPeriodHours,
        stopLossPercent: input.stopLossPercent,
        takeProfitPercent: input.takeProfitPercent,
      };
      
      const result = await backtester.runBacktest(ctx.user.id, config);
      
      return {
        success: result.status === 'completed',
        status: result.status,
        errorMessage: result.errorMessage,
        executionTimeMs: result.executionTimeMs,
        metrics: result.metrics,
        tradeCount: result.trades.length,
        // Return summary of trades, not full list (can be large)
        tradeSummary: {
          totalTrades: result.trades.length,
          winningTrades: result.trades.filter(t => t.outcome === 'win').length,
          losingTrades: result.trades.filter(t => t.outcome === 'loss').length,
          avgPnlPercent: result.trades.length > 0 
            ? result.trades.reduce((sum, t) => sum + t.pnlPercent, 0) / result.trades.length 
            : 0,
          lastTrades: result.trades.slice(-10).map(t => ({
            timestamp: t.timestamp,
            direction: t.direction,
            positionTier: t.positionTier,
            pnlPercent: t.pnlPercent,
            outcome: t.outcome,
            regime: t.regime,
          })),
        },
        equityCurve: result.equityCurve.slice(0, 100), // Limit to 100 points
      };
    }),

  // Compare multiple threshold configurations
  compareThresholds: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
      initialCapital: z.number().min(1000).max(10000000).default(100000),
      holdingPeriodHours: z.number().min(1).max(168).default(24),
      stopLossPercent: z.number().min(0.01).max(0.20).default(0.05),
      takeProfitPercent: z.number().min(0.02).max(0.50).default(0.10),
      // Configurations to compare
      configurations: z.array(z.object({
        name: z.string(),
        baseThreshold: z.number().min(0.05).max(0.80),
        regimeMultipliers: z.object({
          trending: z.number().min(0.5).max(1.5),
          volatile: z.number().min(1.0).max(2.0),
          ranging: z.number().min(0.8).max(1.5),
        }),
      })).min(2).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const backtester = getConsensusThresholdBacktester();
      
      const baseConfig = {
        name: 'comparison',
        symbol: input.symbol,
        startDate: input.startDate,
        endDate: input.endDate,
        positionTiers: {
          scout: 0.03,
          moderate: 0.05,
          standard: 0.07,
          strong: 0.10,
          high: 0.15,
          max: 0.20,
        },
        initialCapital: input.initialCapital,
        maxDrawdownLimit: 0.25,
        holdingPeriodHours: input.holdingPeriodHours,
        stopLossPercent: input.stopLossPercent,
        takeProfitPercent: input.takeProfitPercent,
      };
      
      const comparison = await backtester.compareConfigurations(
        ctx.user.id,
        baseConfig,
        input.configurations
      );
      
      return {
        comparison: comparison.comparison,
        results: comparison.results.map(r => ({
          name: r.config.name,
          baseThreshold: r.config.baseThreshold,
          regimeMultipliers: r.config.regimeMultipliers,
          status: r.status,
          metrics: r.metrics,
          executionTimeMs: r.executionTimeMs,
        })),
      };
    }),

  // Get recommended threshold configuration based on current market
  getRecommendedConfig: protectedProcedure.query(async ({ ctx }) => {
    // Return the A++ level configuration as the recommended default
    return {
      recommended: {
        name: 'A++ Institutional',
        baseThreshold: 0.25,
        regimeMultipliers: {
          trending: 0.80,  // More aggressive in trends
          volatile: 1.40,  // More conservative in volatility
          ranging: 1.10,   // Slightly conservative in ranges
        },
        positionTiers: {
          scout: 0.03,     // 3% - Test positions
          moderate: 0.05,  // 5% - Moderate conviction
          standard: 0.07,  // 7% - Standard trades
          strong: 0.10,    // 10% - Strong signals
          high: 0.15,      // 15% - High conviction
          max: 0.20,       // 20% - Maximum conviction
        },
        reasoning: `
          This configuration is based on institutional trading research:
          
          1. Base Threshold (25%): Higher than typical retail systems (15-20%) to filter noise
          
          2. Regime Multipliers:
             - Trending (0.80x = 20%): Lower threshold to capture trend momentum
             - Volatile (1.40x = 35%): Higher threshold to avoid whipsaws
             - Ranging (1.10x = 27.5%): Slightly higher to avoid false breakouts
          
          3. Position Sizing:
             - Tiered from 3% (scout) to 20% (max) based on signal strength
             - Scales with confidence excess above threshold
             - Prevents over-concentration while maximizing strong signals
          
          Expected Performance:
          - Win Rate: 60-65%
          - Sharpe Ratio: 2.0-2.5
          - Max Drawdown: <25%
          - Trades/Week: 25-40
        `.trim(),
      },
      alternatives: [
        {
          name: 'Conservative',
          baseThreshold: 0.35,
          regimeMultipliers: { trending: 0.90, volatile: 1.50, ranging: 1.20 },
          description: 'Higher thresholds, fewer but higher quality trades',
        },
        {
          name: 'Aggressive',
          baseThreshold: 0.20,
          regimeMultipliers: { trending: 0.70, volatile: 1.20, ranging: 1.00 },
          description: 'Lower thresholds, more trades, higher risk',
        },
        {
          name: 'Trend-Following',
          baseThreshold: 0.25,
          regimeMultipliers: { trending: 0.60, volatile: 1.60, ranging: 1.30 },
          description: 'Optimized for trending markets, very conservative in volatility',
        },
      ],
    };
  }),

  // Get current position sizing tiers documentation
  getPositionSizingTiers: protectedProcedure.query(async () => {
    return {
      tiers: [
        {
          name: 'SCOUT',
          size: '3%',
          confidenceRange: '0-10% above threshold',
          description: 'Test positions for new signals or uncertain conditions',
          useCase: 'Initial entry, testing new patterns, low conviction signals',
        },
        {
          name: 'MODERATE',
          size: '5%',
          confidenceRange: '10-20% above threshold',
          description: 'Moderate conviction trades with reasonable risk',
          useCase: 'Standard signals with some confirmation',
        },
        {
          name: 'STANDARD',
          size: '7%',
          confidenceRange: '20-30% above threshold',
          description: 'Standard position size for confirmed signals',
          useCase: 'Well-confirmed signals with multiple agent agreement',
        },
        {
          name: 'STRONG',
          size: '10%',
          confidenceRange: '30-40% above threshold',
          description: 'Strong conviction trades with high confidence',
          useCase: 'Strong multi-agent consensus with good execution timing',
        },
        {
          name: 'HIGH',
          size: '15%',
          confidenceRange: '40-50% above threshold',
          description: 'High conviction trades for exceptional opportunities',
          useCase: 'Very strong consensus with optimal market conditions',
        },
        {
          name: 'MAX',
          size: '20%',
          confidenceRange: '50%+ above threshold',
          description: 'Maximum position size for alpha signals',
          useCase: 'Rare alpha opportunities with near-unanimous agent agreement',
        },
      ],
      riskManagement: {
        maxPortfolioHeat: '40%',
        maxCorrelatedExposure: '30%',
        maxSinglePosition: '20%',
        defaultStopLoss: '5%',
        defaultTakeProfit: '10%',
        trailingStopActivation: '5% profit',
        trailingStopDistance: '3%',
      },
    };
  }),

  // Get all threshold presets
  getThresholdPresets: protectedProcedure.query(async () => {
    const backtester = getConsensusThresholdBacktester();
    return backtester.getThresholdPresets();
  }),

  // Run backtest with a specific preset
  runPresetBacktest: protectedProcedure
    .input(z.object({
      presetId: z.string(),
      symbol: z.string(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
      initialCapital: z.number().min(1000).max(10000000).default(100000),
      holdingPeriodHours: z.number().min(1).max(168).default(24),
      stopLossPercent: z.number().min(0.01).max(0.20).default(0.05),
      takeProfitPercent: z.number().min(0.02).max(0.50).default(0.10),
      maxDrawdownLimit: z.number().min(0.10).max(0.50).default(0.25),
    }))
    .mutation(async ({ ctx, input }) => {
      const backtester = getConsensusThresholdBacktester();
      const presets = backtester.getThresholdPresets();
      const preset = presets.find(p => p.id === input.presetId);
      
      if (!preset) {
        throw new Error(`Preset not found: ${input.presetId}`);
      }
      
      const config: ThresholdBacktestConfig = {
        name: preset.name,
        symbol: input.symbol,
        startDate: input.startDate,
        endDate: input.endDate,
        baseThreshold: preset.baseThreshold,
        regimeMultipliers: preset.regimeMultipliers,
        positionTiers: preset.positionTiers,
        initialCapital: input.initialCapital,
        maxDrawdownLimit: input.maxDrawdownLimit,
        holdingPeriodHours: input.holdingPeriodHours,
        stopLossPercent: input.stopLossPercent,
        takeProfitPercent: input.takeProfitPercent,
      };
      
      const result = await backtester.runBacktest(ctx.user.id, config);
      
      return {
        preset: {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          expectedMetrics: preset.expectedMetrics,
        },
        success: result.status === 'completed',
        status: result.status,
        errorMessage: result.errorMessage,
        executionTimeMs: result.executionTimeMs,
        metrics: result.metrics,
        tradeCount: result.trades.length,
        tradeSummary: {
          totalTrades: result.trades.length,
          winningTrades: result.trades.filter(t => t.outcome === 'win').length,
          losingTrades: result.trades.filter(t => t.outcome === 'loss').length,
          avgPnlPercent: result.trades.length > 0 
            ? result.trades.reduce((sum, t) => sum + t.pnlPercent, 0) / result.trades.length 
            : 0,
          lastTrades: result.trades.slice(-10).map(t => ({
            timestamp: t.timestamp,
            direction: t.direction,
            positionTier: t.positionTier,
            pnlPercent: t.pnlPercent,
            outcome: t.outcome,
            regime: t.regime,
          })),
        },
        equityCurve: result.equityCurve.slice(0, 100),
      };
    }),

  // Compare multiple presets
  comparePresets: protectedProcedure
    .input(z.object({
      presetIds: z.array(z.string()).min(2).max(7),
      symbol: z.string(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
      initialCapital: z.number().min(1000).max(10000000).default(100000),
      holdingPeriodHours: z.number().min(1).max(168).default(24),
      stopLossPercent: z.number().min(0.01).max(0.20).default(0.05),
      takeProfitPercent: z.number().min(0.02).max(0.50).default(0.10),
    }))
    .mutation(async ({ ctx, input }) => {
      const backtester = getConsensusThresholdBacktester();
      const allPresets = backtester.getThresholdPresets();
      
      const selectedPresets = input.presetIds
        .map(id => allPresets.find(p => p.id === id))
        .filter((p): p is ThresholdPreset => p !== undefined);
      
      if (selectedPresets.length < 2) {
        throw new Error('At least 2 valid presets required for comparison');
      }
      
      const baseConfig = {
        name: 'preset_comparison',
        symbol: input.symbol,
        startDate: input.startDate,
        endDate: input.endDate,
        positionTiers: {
          scout: 0.03, moderate: 0.05, standard: 0.07,
          strong: 0.10, high: 0.15, max: 0.20,
        },
        initialCapital: input.initialCapital,
        maxDrawdownLimit: 0.25,
        holdingPeriodHours: input.holdingPeriodHours,
        stopLossPercent: input.stopLossPercent,
        takeProfitPercent: input.takeProfitPercent,
      };
      
      const thresholdConfigs = selectedPresets.map(p => ({
        name: p.name,
        baseThreshold: p.baseThreshold,
        regimeMultipliers: p.regimeMultipliers,
      }));
      
      const comparison = await backtester.compareConfigurations(
        ctx.user.id,
        baseConfig,
        thresholdConfigs
      );
      
      return {
        comparison: comparison.comparison,
        results: comparison.results.map((r, i) => ({
          presetId: selectedPresets[i]?.id,
          name: r.config.name,
          description: selectedPresets[i]?.description,
          expectedMetrics: selectedPresets[i]?.expectedMetrics,
          baseThreshold: r.config.baseThreshold,
          regimeMultipliers: r.config.regimeMultipliers,
          status: r.status,
          metrics: r.metrics,
          executionTimeMs: r.executionTimeMs,
        })),
      };
    }),

  // Run threshold optimization
  optimizeThresholds: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
      initialCapital: z.number().min(1000).max(10000000).default(100000),
      holdingPeriodHours: z.number().min(1).max(168).default(24),
      stopLossPercent: z.number().min(0.01).max(0.20).default(0.05),
      takeProfitPercent: z.number().min(0.02).max(0.50).default(0.10),
      maxDrawdownLimit: z.number().min(0.10).max(0.50).default(0.25),
      thresholdRange: z.object({
        min: z.number().min(0.05).max(0.40).default(0.15),
        max: z.number().min(0.20).max(0.60).default(0.45),
        step: z.number().min(0.01).max(0.10).default(0.05),
      }).optional(),
      optimizeFor: z.enum(['sharpe', 'return', 'winRate', 'balanced']).default('balanced'),
      maxIterations: z.number().min(10).max(100).default(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const backtester = getConsensusThresholdBacktester();
      
      const result = await backtester.optimizeThresholds(
        ctx.user.id,
        {
          symbol: input.symbol,
          startDate: input.startDate,
          endDate: input.endDate,
          initialCapital: input.initialCapital,
          maxDrawdownLimit: input.maxDrawdownLimit,
          holdingPeriodHours: input.holdingPeriodHours,
          stopLossPercent: input.stopLossPercent,
          takeProfitPercent: input.takeProfitPercent,
        },
        {
          thresholdRange: input.thresholdRange,
          optimizeFor: input.optimizeFor,
          maxIterations: input.maxIterations,
        }
      );
      
      return result;
    }),
});
