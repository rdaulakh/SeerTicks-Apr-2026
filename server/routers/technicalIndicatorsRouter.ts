import { router, protectedProcedure } from "../_core/trpc";
import { getActiveClock } from '../_core/clock';
import { z } from "zod";
import { getCandleCache } from "../WebSocketCandleCache";
import { calculateRSI, calculateMACD, calculateBollingerBands } from "../utils/IndicatorCache";

/**
 * Technical Indicators Router
 * Exposes RSI, MACD, and Bollinger Bands indicators to the frontend
 */
export const technicalIndicatorsRouter = router({
  /**
   * Get all technical indicators for a symbol
   */
  getIndicators: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
        rsiPeriod: z.number().min(2).max(50).default(14),
        macdFast: z.number().min(2).max(50).default(12),
        macdSlow: z.number().min(2).max(100).default(26),
        macdSignal: z.number().min(2).max(50).default(9),
        bbPeriod: z.number().min(2).max(100).default(20),
        bbStdDev: z.number().min(1).max(5).default(2),
      })
    )
    .query(async ({ input }) => {
      const {
        symbol,
        interval,
        rsiPeriod,
        macdFast,
        macdSlow,
        macdSignal,
        bbPeriod,
        bbStdDev,
      } = input;

      // Get candles from cache
      const candleCache = getCandleCache();
      const candles = candleCache.getCandles(symbol, interval, 200);

      if (candles.length === 0) {
        return {
          symbol,
          interval,
          timestamp: getActiveClock().now(),
          indicators: null,
          error: "No candle data available for this symbol",
        };
      }

      // Calculate indicators
      const rsi = calculateRSI(candles, rsiPeriod);
      const macd = calculateMACD(candles, macdFast, macdSlow, macdSignal);
      const bollingerBands = calculateBollingerBands(candles, bbPeriod, bbStdDev);

      // Get current price from latest candle
      const currentPrice = candles[candles.length - 1].close;

      return {
        symbol,
        interval,
        timestamp: getActiveClock().now(),
        currentPrice,
        indicators: {
          rsi: {
            value: rsi,
            period: rsiPeriod,
            signal: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral',
          },
          macd: {
            macd: macd.macd,
            signal: macd.signal,
            histogram: macd.histogram,
            fastPeriod: macdFast,
            slowPeriod: macdSlow,
            signalPeriod: macdSignal,
            crossover: macd.histogram > 0 ? 'bullish' : 'bearish',
          },
          bollingerBands: {
            upper: bollingerBands.upper,
            middle: bollingerBands.middle,
            lower: bollingerBands.lower,
            period: bbPeriod,
            stdDev: bbStdDev,
            position: currentPrice > bollingerBands.upper
              ? 'above_upper'
              : currentPrice < bollingerBands.lower
              ? 'below_lower'
              : 'within_bands',
            bandwidth: ((bollingerBands.upper - bollingerBands.lower) / bollingerBands.middle) * 100,
          },
        },
      };
    }),

  /**
   * Get RSI only
   */
  getRSI: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
        period: z.number().min(2).max(50).default(14),
      })
    )
    .query(async ({ input }) => {
      const { symbol, interval, period } = input;

      const candleCache = getCandleCache();
      const candles = candleCache.getCandles(symbol, interval, period + 50);

      if (candles.length === 0) {
        return { symbol, interval, value: null, error: "No data available" };
      }

      const rsi = calculateRSI(candles, period);

      return {
        symbol,
        interval,
        period,
        value: rsi,
        signal: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral',
        timestamp: getActiveClock().now(),
      };
    }),

  /**
   * Get MACD only
   */
  getMACD: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
        fastPeriod: z.number().min(2).max(50).default(12),
        slowPeriod: z.number().min(2).max(100).default(26),
        signalPeriod: z.number().min(2).max(50).default(9),
      })
    )
    .query(async ({ input }) => {
      const { symbol, interval, fastPeriod, slowPeriod, signalPeriod } = input;

      const candleCache = getCandleCache();
      const candles = candleCache.getCandles(symbol, interval, slowPeriod + signalPeriod + 50);

      if (candles.length === 0) {
        return { symbol, interval, value: null, error: "No data available" };
      }

      const macd = calculateMACD(candles, fastPeriod, slowPeriod, signalPeriod);

      return {
        symbol,
        interval,
        fastPeriod,
        slowPeriod,
        signalPeriod,
        macd: macd.macd,
        signal: macd.signal,
        histogram: macd.histogram,
        crossover: macd.histogram > 0 ? 'bullish' : 'bearish',
        timestamp: getActiveClock().now(),
      };
    }),

  /**
   * Get Bollinger Bands only
   */
  getBollingerBands: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
        period: z.number().min(2).max(100).default(20),
        stdDev: z.number().min(1).max(5).default(2),
      })
    )
    .query(async ({ input }) => {
      const { symbol, interval, period, stdDev } = input;

      const candleCache = getCandleCache();
      const candles = candleCache.getCandles(symbol, interval, period + 50);

      if (candles.length === 0) {
        return { symbol, interval, value: null, error: "No data available" };
      }

      const bb = calculateBollingerBands(candles, period, stdDev);
      const currentPrice = candles[candles.length - 1].close;

      return {
        symbol,
        interval,
        period,
        stdDev,
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
        currentPrice,
        position: currentPrice > bb.upper
          ? 'above_upper'
          : currentPrice < bb.lower
          ? 'below_lower'
          : 'within_bands',
        bandwidth: ((bb.upper - bb.lower) / bb.middle) * 100,
        timestamp: getActiveClock().now(),
      };
    }),

  /**
   * Get indicator history for charting
   */
  getIndicatorHistory: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
        limit: z.number().min(10).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const { symbol, interval, limit } = input;

      const candleCache = getCandleCache();
      const candles = candleCache.getCandles(symbol, interval, limit + 50); // Extra for indicator calculation

      if (candles.length === 0) {
        return { symbol, interval, data: [], error: "No data available" };
      }

      // Calculate indicators for each candle (sliding window)
      const history = [];
      const minCandles = 50; // Minimum candles needed for accurate indicators

      for (let i = minCandles; i < candles.length; i++) {
        const windowCandles = candles.slice(0, i + 1);
        
        const rsi = calculateRSI(windowCandles, 14);
        const macd = calculateMACD(windowCandles, 12, 26, 9);
        const bb = calculateBollingerBands(windowCandles, 20, 2);

        history.push({
          timestamp: candles[i].timestamp,
          close: candles[i].close,
          rsi,
          macd: macd.macd,
          macdSignal: macd.signal,
          macdHistogram: macd.histogram,
          bbUpper: bb.upper,
          bbMiddle: bb.middle,
          bbLower: bb.lower,
        });
      }

      // Return only the requested limit
      const trimmedHistory = history.slice(-limit);

      return {
        symbol,
        interval,
        data: trimmedHistory,
      };
    }),
});
