/**
 * A++ Grade Optimization Router
 * 
 * Provides endpoints for:
 * - Running A++ grade backtests
 * - Analyzing losses and root causes
 * - Running automated parameter optimization
 * - Getting current quality gate status
 * - Continuous improvement cycle management
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { APlusPlusBacktestEngine, BacktestResult } from '../backtest/APlusPlusBacktestEngine';
import { LossRootCauseAnalyzer } from '../analysis/LossRootCauseAnalyzer';
import { AutomatedParameterOptimizer, OptimizationResult } from '../optimization/AutomatedParameterOptimizer';
import { getSignalQualityGate } from '../services/SignalQualityGate';
import { getMacroVetoEnforcer } from '../services/MacroVetoEnforcer';
import { getRegimeDirectionFilter } from '../services/RegimeDirectionFilter';

// Store latest results in memory for quick access
let latestBacktestResult: BacktestResult | null = null;
let latestOptimizationResult: OptimizationResult | null = null;
let optimizationInProgress = false;

export const aplusPlusRouter = router({
  /**
   * Run A++ grade backtest with current or custom parameters
   */
  runBacktest: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      consensusThreshold: z.number().min(0.3).max(0.95).optional(),
      confidenceThreshold: z.number().min(0.3).max(0.95).optional(),
      minAgentAgreement: z.number().min(1).max(8).optional(),
      enableMacroVeto: z.boolean().optional(),
      enableRegimeFilter: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const config = {
        symbols: input?.symbols || ['BTC-USD', 'ETH-USD'],
        startDate: input?.startDate ? new Date(input.startDate) : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: input?.endDate ? new Date(input.endDate) : new Date(),
        consensusThreshold: input?.consensusThreshold || 0.70,
        confidenceThreshold: input?.confidenceThreshold || 0.65,
        minAgentAgreement: input?.minAgentAgreement || 4,
        enableMacroVeto: input?.enableMacroVeto ?? true,
        enableRegimeFilter: input?.enableRegimeFilter ?? true,
      };

      const engine = new APlusPlusBacktestEngine(config);
      latestBacktestResult = await engine.run();

      return {
        success: true,
        result: {
          grade: latestBacktestResult.grade,
          gradeReason: latestBacktestResult.gradeReason,
          totalTrades: latestBacktestResult.totalTrades,
          winningTrades: latestBacktestResult.winningTrades,
          losingTrades: latestBacktestResult.losingTrades,
          winRate: latestBacktestResult.winRate,
          totalPnL: latestBacktestResult.totalPnL,
          totalPnLPercent: latestBacktestResult.totalPnLPercent,
          profitFactor: latestBacktestResult.profitFactor,
          maxDrawdownPercent: latestBacktestResult.maxDrawdownPercent,
          sharpeRatio: latestBacktestResult.sharpeRatio,
          sortinoRatio: latestBacktestResult.sortinoRatio,
          tradesBlockedByMacroVeto: latestBacktestResult.tradesBlockedByMacroVeto,
          tradesBlockedByRegimeFilter: latestBacktestResult.tradesBlockedByRegimeFilter,
          tradesBlockedByConsensus: latestBacktestResult.tradesBlockedByConsensus,
          tradesBlockedByConfidence: latestBacktestResult.tradesBlockedByConfidence,
          tradesBlockedByAgentAgreement: latestBacktestResult.tradesBlockedByAgentAgreement,
        },
      };
    }),

  /**
   * Get latest backtest result
   */
  getLatestBacktest: protectedProcedure.query(() => {
    if (!latestBacktestResult) {
      return { success: false, message: 'No backtest has been run yet' };
    }

    return {
      success: true,
      result: {
        grade: latestBacktestResult.grade,
        gradeReason: latestBacktestResult.gradeReason,
        totalTrades: latestBacktestResult.totalTrades,
        winningTrades: latestBacktestResult.winningTrades,
        losingTrades: latestBacktestResult.losingTrades,
        winRate: latestBacktestResult.winRate,
        totalPnL: latestBacktestResult.totalPnL,
        totalPnLPercent: latestBacktestResult.totalPnLPercent,
        profitFactor: latestBacktestResult.profitFactor,
        maxDrawdownPercent: latestBacktestResult.maxDrawdownPercent,
        sharpeRatio: latestBacktestResult.sharpeRatio,
        sortinoRatio: latestBacktestResult.sortinoRatio,
        tradesBlockedByMacroVeto: latestBacktestResult.tradesBlockedByMacroVeto,
        tradesBlockedByRegimeFilter: latestBacktestResult.tradesBlockedByRegimeFilter,
        tradesBlockedByConsensus: latestBacktestResult.tradesBlockedByConsensus,
        tradesBlockedByConfidence: latestBacktestResult.tradesBlockedByConfidence,
        tradesBlockedByAgentAgreement: latestBacktestResult.tradesBlockedByAgentAgreement,
        trades: latestBacktestResult.trades.slice(0, 50), // Limit to 50 trades for response size
      },
    };
  }),

  /**
   * Analyze losses from latest backtest
   */
  analyzeLosses: protectedProcedure.mutation(async () => {
    if (!latestBacktestResult) {
      return { success: false, message: 'No backtest result available. Run a backtest first.' };
    }

    const analyzer = new LossRootCauseAnalyzer();
    const analysis = await analyzer.analyze(latestBacktestResult);

    return {
      success: true,
      analysis: {
        totalLosses: analysis.totalLosses,
        totalLossAmount: analysis.totalLossAmount,
        avgLossPerTrade: analysis.avgLossPerTrade,
        topCauses: analysis.topCauses,
        patterns: analysis.patterns.map(p => ({
          name: p.name,
          description: p.description,
          frequency: p.frequency,
          avgLoss: p.avgLoss,
          suggestedFix: p.suggestedFix,
        })),
        parameterChanges: analysis.parameterChanges,
        strategyRecommendations: analysis.strategyRecommendations,
        priorityActions: analysis.priorityActions,
        currentGrade: analysis.currentGrade,
        projectedGrade: analysis.projectedGrade,
        improvementPath: analysis.improvementPath,
        aiAnalysis: analysis.aiAnalysis,
      },
    };
  }),

  /**
   * Run automated parameter optimization
   */
  runOptimization: protectedProcedure
    .input(z.object({
      maxIterations: z.number().min(1).max(20).optional(),
      targetWinRate: z.number().min(0.5).max(0.9).optional(),
      targetProfitFactor: z.number().min(1.0).max(5.0).optional(),
    }).optional())
    .mutation(async ({ input }) => {
      if (optimizationInProgress) {
        return { success: false, message: 'Optimization already in progress' };
      }

      optimizationInProgress = true;

      try {
        const optimizer = new AutomatedParameterOptimizer({
          maxIterations: input?.maxIterations || 5,
          targetWinRate: input?.targetWinRate || 0.65,
          targetProfitFactor: input?.targetProfitFactor || 2.0,
        });

        latestOptimizationResult = await optimizer.optimize();

        return {
          success: true,
          result: {
            success: latestOptimizationResult.success,
            finalGrade: latestOptimizationResult.finalGrade,
            totalIterations: latestOptimizationResult.iterations.length,
            totalImprovement: latestOptimizationResult.totalImprovement,
            optimizedParameters: latestOptimizationResult.optimizedParameters,
            summary: latestOptimizationResult.summary,
            iterations: latestOptimizationResult.iterations.map(it => ({
              iteration: it.iteration,
              grade: it.grade,
              winRate: it.result.winRate,
              profitFactor: it.result.profitFactor,
              parameters: it.parameters,
            })),
          },
        };
      } finally {
        optimizationInProgress = false;
      }
    }),

  /**
   * Get latest optimization result
   */
  getLatestOptimization: protectedProcedure.query(() => {
    if (!latestOptimizationResult) {
      return { success: false, message: 'No optimization has been run yet' };
    }

    return {
      success: true,
      result: {
        success: latestOptimizationResult.success,
        finalGrade: latestOptimizationResult.finalGrade,
        totalIterations: latestOptimizationResult.iterations.length,
        totalImprovement: latestOptimizationResult.totalImprovement,
        optimizedParameters: latestOptimizationResult.optimizedParameters,
        summary: latestOptimizationResult.summary,
      },
    };
  }),

  /**
   * Get current quality gate status
   */
  getQualityGateStatus: protectedProcedure.query(() => {
    const qualityGate = getSignalQualityGate();
    const macroVeto = getMacroVetoEnforcer();
    const regimeFilter = getRegimeDirectionFilter();

    const config = qualityGate.getConfig();
    const stats = qualityGate.getStats();
    const macroState = macroVeto.getMacroTrendState();
    const regimeState = regimeFilter.getRegimeState();

    return {
      config: {
        consensusThreshold: config.consensusThreshold,
        confidenceThreshold: config.confidenceThreshold,
        minAgentAgreement: config.minAgentAgreement,
        minExecutionScore: config.minExecutionScore,
        enableMacroVeto: config.enableMacroVeto,
        enableRegimeFilter: config.enableRegimeFilter,
      },
      stats: {
        totalChecks: stats.totalChecks,
        passed: stats.passed,
        rejected: stats.rejected,
        passRate: stats.passRate,
      },
      macroTrend: {
        direction: macroState.direction,
        confidence: macroState.confidence,
        regime: macroState.regime,
        vetoActive: macroState.vetoActive,
        isFresh: macroVeto.isMacroDataFresh(),
      },
      regime: {
        regime: regimeState.regime,
        confidence: regimeState.confidence,
        allowedActions: regimeState.allowedActions,
        isFresh: regimeFilter.isRegimeDataFresh(),
      },
    };
  }),

  /**
   * Update quality gate configuration
   */
  updateQualityGateConfig: protectedProcedure
    .input(z.object({
      consensusThreshold: z.number().min(0.3).max(0.95).optional(),
      confidenceThreshold: z.number().min(0.3).max(0.95).optional(),
      minAgentAgreement: z.number().min(1).max(8).optional(),
      enableMacroVeto: z.boolean().optional(),
      enableRegimeFilter: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const qualityGate = getSignalQualityGate();
      qualityGate.updateConfig(input);

      return {
        success: true,
        message: 'Quality gate configuration updated',
        newConfig: qualityGate.getConfig(),
      };
    }),

  /**
   * Get A++ grade requirements and current status
   */
  getGradeRequirements: protectedProcedure.query(() => {
    const requirements = {
      'A++': {
        winRate: 0.65,
        profitFactor: 2.0,
        sharpeRatio: 1.5,
        maxDrawdown: 0.10,
        description: 'Exceptional performance across all metrics',
      },
      'A+': {
        winRate: 0.60,
        profitFactor: 1.5,
        sharpeRatio: 1.0,
        maxDrawdown: 0.15,
        description: 'Excellent performance with strong risk-adjusted returns',
      },
      'A': {
        winRate: 0.55,
        profitFactor: 1.2,
        sharpeRatio: 0.5,
        maxDrawdown: 0.20,
        description: 'Good performance with acceptable risk',
      },
      'B': {
        winRate: 0.50,
        profitFactor: 1.0,
        sharpeRatio: 0,
        maxDrawdown: 0.25,
        description: 'Breakeven or slightly profitable',
      },
    };

    const currentMetrics = latestBacktestResult ? {
      winRate: latestBacktestResult.winRate,
      profitFactor: latestBacktestResult.profitFactor,
      sharpeRatio: latestBacktestResult.sharpeRatio,
      maxDrawdown: latestBacktestResult.maxDrawdownPercent / 100,
      currentGrade: latestBacktestResult.grade,
    } : null;

    return {
      requirements,
      currentMetrics,
      optimizationInProgress,
    };
  }),

  /**
   * Run continuous improvement cycle
   * This is the main "backtest → fix → retest" loop
   */
  runContinuousImprovement: protectedProcedure
    .input(z.object({
      targetGrade: z.enum(['A++', 'A+', 'A', 'B']).optional(),
      maxCycles: z.number().min(1).max(10).optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const targetGrade = input?.targetGrade || 'A++';
      const maxCycles = input?.maxCycles || 5;
      const results: any[] = [];

      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        console.log(`\n=== IMPROVEMENT CYCLE ${cycle}/${maxCycles} ===`);

        // Step 1: Run backtest
        const engine = new APlusPlusBacktestEngine();
        const backtestResult = await engine.run();
        latestBacktestResult = backtestResult;

        // Step 2: Check if target reached
        if (backtestResult.grade === targetGrade || 
            (targetGrade === 'A++' && ['A++'].includes(backtestResult.grade)) ||
            (targetGrade === 'A+' && ['A++', 'A+'].includes(backtestResult.grade)) ||
            (targetGrade === 'A' && ['A++', 'A+', 'A'].includes(backtestResult.grade))) {
          results.push({
            cycle,
            grade: backtestResult.grade,
            winRate: backtestResult.winRate,
            profitFactor: backtestResult.profitFactor,
            status: 'TARGET_REACHED',
          });
          break;
        }

        // Step 3: Analyze losses
        const analyzer = new LossRootCauseAnalyzer();
        const analysis = await analyzer.analyze(backtestResult);

        results.push({
          cycle,
          grade: backtestResult.grade,
          winRate: backtestResult.winRate,
          profitFactor: backtestResult.profitFactor,
          topCauses: analysis.topCauses,
          priorityActions: analysis.priorityActions.slice(0, 3),
          status: 'CONTINUING',
        });

        // Step 4: Apply fixes (the quality gate is already updated with A++ parameters)
        // In a real implementation, we would dynamically adjust parameters here
      }

      return {
        success: true,
        targetGrade,
        cyclesCompleted: results.length,
        finalGrade: results[results.length - 1]?.grade || 'F',
        targetReached: results[results.length - 1]?.status === 'TARGET_REACHED',
        cycles: results,
      };
    }),
});
