import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { loadCandlesFromDatabase, loadCandlesByDateRange } from "../db/candleStorage";

export const candlesRouter = router({
  /**
   * Get recent candles from database
   * Returns the most recent N candles for a symbol/timeframe
   */
  getCandles: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.string().default("1h"),
        limit: z.number().min(1).max(10000).default(100),
      })
    )
    .query(async ({ input }) => {
      const candles = await loadCandlesFromDatabase(
        input.symbol,
        input.timeframe,
        input.limit
      );
      return candles;
    }),

  /**
   * Get candles within a specific date range
   * Useful for backtesting and historical analysis
   */
  getCandlesInRange: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.string(),
        startTime: z.number(), // Unix timestamp in milliseconds
        endTime: z.number(),   // Unix timestamp in milliseconds
      })
    )
    .query(async ({ input }) => {
      const candles = await loadCandlesByDateRange(
        input.symbol,
        input.timeframe,
        input.startTime,
        input.endTime
      );
      return candles;
    }),

  /**
   * Get available data info for a symbol
   * Returns metadata about what data is available
   */
  getDataInfo: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.string(),
      })
    )
    .query(async ({ input }) => {
      const candles = await loadCandlesFromDatabase(
        input.symbol,
        input.timeframe,
        1000000 // Load all to get range
      );
      
      if (candles.length === 0) {
        return {
          available: false,
          count: 0,
          earliestDate: null,
          latestDate: null,
        };
      }

      return {
        available: true,
        count: candles.length,
        earliestDate: new Date(candles[0].timestamp).toISOString(),
        latestDate: new Date(candles[candles.length - 1].timestamp).toISOString(),
      };
    }),
});
