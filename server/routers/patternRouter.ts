/**
 * Pattern Router
 * 
 * Endpoints for pattern detection and AI-powered predictions
 */

import { router, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { detectAllPatterns } from '../agents/PatternDetection';
import { analyzePatterWithLLM, getHistoricalCandles } from '../services/PatternPredictionService';
import { priceFeedService } from '../services/priceFeedService';

export const patternRouter = router({
  /**
   * Detect patterns for a symbol
   */
  detectPatterns: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '6h', '1d']),
        limit: z.number().optional().default(100),
      })
    )
    .query(async ({ input }) => {
      const { symbol, timeframe, limit } = input;
      
      // Get historical candles
      const candles = await getHistoricalCandles(symbol, timeframe, limit);
      
      if (candles.length === 0) {
        return {
          symbol,
          timeframe,
          patterns: [],
          message: 'No historical data available',
        };
      }
      
      // Get current price
      const normalizedSymbol = symbol.includes('-') ? symbol : `${symbol.slice(0, -3)}-${symbol.slice(-3)}`;
      const cachedPrice = priceFeedService.getLatestPrice(normalizedSymbol);
      const currentPrice = cachedPrice?.price || candles[candles.length - 1].close;
      
      // Detect patterns
      const patterns = detectAllPatterns(candles, timeframe, currentPrice);
      
      return {
        symbol,
        timeframe,
        currentPrice,
        patterns,
        candleCount: candles.length,
      };
    }),
  
  /**
   * Get AI prediction for a detected pattern
   */
  predictPattern: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '6h', '1d']),
        patternName: z.string(),
        limit: z.number().optional().default(100),
      })
    )
    .mutation(async ({ input }) => {
      const { symbol, timeframe, patternName, limit } = input;
      
      // Get historical candles
      const candles = await getHistoricalCandles(symbol, timeframe, limit);
      
      if (candles.length === 0) {
        throw new Error('No historical data available');
      }
      
      // Get current price
      const normalizedSymbol = symbol.includes('-') ? symbol : `${symbol.slice(0, -3)}-${symbol.slice(-3)}`;
      const cachedPrice = priceFeedService.getLatestPrice(normalizedSymbol);
      const currentPrice = cachedPrice?.price || candles[candles.length - 1].close;
      
      // Detect patterns
      const patterns = detectAllPatterns(candles, timeframe, currentPrice);
      
      // Find the requested pattern
      const pattern = patterns.find(p => p.name === patternName);
      
      if (!pattern) {
        throw new Error(`Pattern "${patternName}" not detected`);
      }
      
      // Get AI prediction
      const prediction = await analyzePatterWithLLM(symbol, pattern, currentPrice, candles);
      
      return prediction;
    }),
  
  /**
   * Get historical candles for a symbol
   */
  getHistoricalData: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '6h', '1d']),
        limit: z.number().optional().default(100),
      })
    )
    .query(async ({ input }) => {
      const { symbol, timeframe, limit } = input;
      
      const candles = await getHistoricalCandles(symbol, timeframe, limit);
      
      return {
        symbol,
        timeframe,
        candles,
        count: candles.length,
      };
    }),
});
