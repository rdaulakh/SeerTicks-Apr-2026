/**
 * Trading Signals Router
 * 
 * Endpoints for generating and managing trading signals
 */

import { z } from "zod";
import { getActiveClock } from '../_core/clock';
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getCandleCache } from "../WebSocketCandleCache";
import { getTradingSignalEngine } from "../services/TradingSignalEngine";
import {
  saveTradingSignal,
  getRecentSignals,
  getSignalsBySymbol,
  getUnexecutedSignals,
  getRecentSignalsByTime,
  getSignalStats,
  markSignalExecuted,
} from "../db/signalsDb";
import { calculateRSI, calculateMACD } from "../utils/IndicatorCache";
import { calculateStochastic, calculateATR, calculateFibonacci } from "../utils/AdvancedIndicators";

export const tradingSignalsRouter = router({
  /**
   * Generate signals for a symbol
   */
  generateSignals: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        saveToDb: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const candleCache = getCandleCache();
      let candles = candleCache.getCandles(input.symbol, '1h', 200);

      // If insufficient data, try to seed from database
      if (candles.length < 50) {
        console.log(`[TradingSignals] Insufficient candle data (${candles.length}), attempting to seed from database...`);
        await candleCache.seedHistoricalCandles(input.symbol, '1h');
        candles = candleCache.getCandles(input.symbol, '1h', 200);
        
        // If still insufficient after seeding, throw error with helpful message
        if (candles.length < 50) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient candle data for ${input.symbol}. Need at least 50 candles for technical analysis, currently have ${candles.length}. Please wait for more data to accumulate or ensure the symbol is actively trading.`,
          });
        }
      }

      const signalEngine = getTradingSignalEngine();
      const signals = signalEngine.generateSignals(input.symbol, candles);

      // Save signals to database if requested
      if (input.saveToDb && signals.length > 0) {
        for (const signal of signals) {
          await saveTradingSignal({
            userId: ctx.user.id,
            symbol: signal.symbol,
            signalType: signal.type,
            source: signal.source,
            strength: signal.strength,
            confidence: signal.confidence,
            price: signal.price.toString(),
            indicators: signal.indicators,
            reasoning: signal.reasoning,
            executed: false,
          });
        }
      }

      return {
        success: true,
        signals,
        count: signals.length,
      };
    }),

  /**
   * Get recent signals
   */
  getRecentSignals: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const signals = await getRecentSignals(ctx.user.id, input.limit);
      return signals;
    }),

  /**
   * Get signals for a specific symbol
   */
  getSignalsBySymbol: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const signals = await getSignalsBySymbol(ctx.user.id, input.symbol, input.limit);
      return signals;
    }),

  /**
   * Get unexecuted signals
   */
  getUnexecutedSignals: protectedProcedure.query(async ({ ctx }) => {
    const signals = await getUnexecutedSignals(ctx.user.id);
    return signals;
  }),

  /**
   * Get signals from last N hours
   */
  getRecentSignalsByTime: protectedProcedure
    .input(
      z.object({
        hoursAgo: z.number().min(1).max(168).default(24), // Max 1 week
      })
    )
    .query(async ({ ctx, input }) => {
      const signals = await getRecentSignalsByTime(ctx.user.id, input.hoursAgo);
      return signals;
    }),

  /**
   * Get signal statistics
   */
  getSignalStats: protectedProcedure.query(async ({ ctx }) => {
    const stats = await getSignalStats(ctx.user.id);
    return stats;
  }),

  /**
   * Mark signal as executed
   */
  markExecuted: protectedProcedure
    .input(
      z.object({
        signalId: z.number(),
        tradeId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await markSignalExecuted(input.signalId, input.tradeId);
      return { success: true };
    }),

  /**
   * Get current indicators for a symbol
   */
  getCurrentIndicators: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
      })
    )
    .query(async ({ input }) => {
      const candleCache = getCandleCache();
      let candles = candleCache.getCandles(input.symbol, '1h', 200);

      // If insufficient data, try to seed from database
      if (candles.length < 50) {
        console.log(`[TradingSignals] Insufficient candle data (${candles.length}), attempting to seed from database...`);
        await candleCache.seedHistoricalCandles(input.symbol, '1h');
        candles = candleCache.getCandles(input.symbol, '1h', 200);
        
        // If still insufficient after seeding, throw error with helpful message
        if (candles.length < 50) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient candle data for ${input.symbol}. Need at least 50 candles for technical analysis, currently have ${candles.length}. Please wait for more data to accumulate or ensure the symbol is actively trading.`,
          });
        }
      }

      const rsi = calculateRSI(candles, 14);
      const macd = calculateMACD(candles, 12, 26, 9);
      const stochastic = calculateStochastic(candles, 14, 3);
      const atr = calculateATR(candles, 14);
      const fibonacci = calculateFibonacci(candles, 50);

      return {
        symbol: input.symbol,
        timestamp: getActiveClock().now(),
        rsi,
        macd,
        stochastic: {
          k: stochastic.k,
          d: stochastic.d,
        },
        atr,
        fibonacci,
        currentPrice: candles[candles.length - 1].close,
      };
    }),

  /**
   * Update signal engine configuration
   */
  updateConfig: protectedProcedure
    .input(
      z.object({
        rsi: z
          .object({
            enabled: z.boolean().optional(),
            oversold: z.number().min(0).max(50).optional(),
            overbought: z.number().min(50).max(100).optional(),
          })
          .optional(),
        macd: z
          .object({
            enabled: z.boolean().optional(),
            signalThreshold: z.number().optional(),
          })
          .optional(),
        stochastic: z
          .object({
            enabled: z.boolean().optional(),
            oversold: z.number().min(0).max(50).optional(),
            overbought: z.number().min(50).max(100).optional(),
          })
          .optional(),
        combined: z
          .object({
            enabled: z.boolean().optional(),
            minConfirmations: z.number().min(1).max(3).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const signalEngine = getTradingSignalEngine();
      signalEngine.updateConfig(input);
      return {
        success: true,
        config: signalEngine.getConfig(),
      };
    }),

  /**
   * Get current signal engine configuration
   */
  getConfig: protectedProcedure.query(async () => {
    const signalEngine = getTradingSignalEngine();
    return signalEngine.getConfig();
  }),
});
