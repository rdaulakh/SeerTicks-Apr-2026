import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { getHighFrequencyOrchestrator } from '../services/HighFrequencyOrchestrator';

/**
 * High-Frequency Trading Router
 * 
 * Provides tRPC endpoints for controlling and monitoring HFT system
 */

export const highFrequencyRouter = router({
  /**
   * Start high-frequency trading
   */
  start: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
      stopLossPercent: z.number().min(0).max(10).optional(),
      takeProfitPercent: z.number().min(0).max(20).optional(),
      requireMultiSignal: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const orchestrator = getHighFrequencyOrchestrator();

      // Update config if provided
      if (input.symbols || input.minConfidence !== undefined || 
          input.stopLossPercent !== undefined || input.takeProfitPercent !== undefined ||
          input.requireMultiSignal !== undefined) {
        orchestrator.updateConfig({
          symbols: input.symbols,
          scalpingConfig: {
            minConfidence: input.minConfidence,
            stopLossPercent: input.stopLossPercent,
            takeProfitPercent: input.takeProfitPercent,
            requireMultiSignal: input.requireMultiSignal,
          },
        });
      }

      await orchestrator.start();

      return {
        success: true,
        message: 'High-frequency trading started',
        status: orchestrator.getStatus(),
      };
    }),

  /**
   * Stop high-frequency trading
   */
  stop: protectedProcedure
    .mutation(async () => {
      const orchestrator = getHighFrequencyOrchestrator();
      await orchestrator.stop();

      return {
        success: true,
        message: 'High-frequency trading stopped',
        status: orchestrator.getStatus(),
      };
    }),

  /**
   * Get HFT status
   */
  getStatus: protectedProcedure
    .query(() => {
      const orchestrator = getHighFrequencyOrchestrator();
      return orchestrator.getStatus();
    }),

  /**
   * Update HFT configuration
   */
  updateConfig: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
      stopLossPercent: z.number().min(0).max(10).optional(),
      takeProfitPercent: z.number().min(0).max(20).optional(),
      maxPositionSize: z.number().min(0).optional(),
      requireMultiSignal: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const orchestrator = getHighFrequencyOrchestrator();

      orchestrator.updateConfig({
        symbols: input.symbols,
        scalpingConfig: {
          minConfidence: input.minConfidence,
          stopLossPercent: input.stopLossPercent,
          takeProfitPercent: input.takeProfitPercent,
          maxPositionSize: input.maxPositionSize,
          requireMultiSignal: input.requireMultiSignal,
        },
      });

      return {
        success: true,
        message: 'Configuration updated',
        status: orchestrator.getStatus(),
      };
    }),

  /**
   * Get current price for a symbol
   */
  getCurrentPrice: protectedProcedure
    .input(z.object({
      symbol: z.string(),
    }))
    .query(({ input }) => {
      const orchestrator = getHighFrequencyOrchestrator();
      const price = orchestrator.getCurrentPrice(input.symbol);

      return {
        symbol: input.symbol,
        price,
        timestamp: Date.now(),
      };
    }),

  /**
   * Reset statistics
   */
  resetStats: protectedProcedure
    .mutation(() => {
      const orchestrator = getHighFrequencyOrchestrator();
      orchestrator.resetStats();

      return {
        success: true,
        message: 'Statistics reset',
      };
    }),

  /**
   * Get scalping configuration
   */
  getConfig: protectedProcedure
    .query(() => {
      const orchestrator = getHighFrequencyOrchestrator();
      const status = orchestrator.getStatus();

      return {
        symbols: status.symbols,
        strategyConfig: orchestrator['strategyEngine'].getConfig(),
      };
    }),
});
