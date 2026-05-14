/**
 * Indicator Cache
 * 
 * Caches technical indicator values (RSI, MACD, Bollinger Bands) and only
 * recalculates when new candle closes, achieving 10× performance improvement.
 * 
 * Key insight: Indicators are based on historical candles, so they only change
 * when a new candle is added to the dataset (not on every tick).
 */

import { Candle } from '../WebSocketCandleCache';

export interface CachedIndicators {
  rsi: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    pctB: number; // Phase 93.18 — %B = (price-lower)/(upper-lower). Sensorium reads this; was missing → defaulted to 0.5.
  };
  lastCandleTimestamp: number; // Timestamp of last candle used for calculation
  calculatedAt: number; // When this cache entry was created
}

/**
 * Indicator Cache Manager
 * Stores calculated indicators per symbol/interval and invalidates on new candle
 */
export class IndicatorCache {
  private cache: Map<string, CachedIndicators> = new Map();
  private hitCount: number = 0;
  private missCount: number = 0;

  /**
   * Get cache key for symbol + interval
   */
  private getCacheKey(symbol: string, interval: string): string {
    return `${symbol}_${interval}`;
  }

  /**
   * Get cached indicators if still valid
   * Returns null if cache miss or invalidated
   */
  get(symbol: string, interval: string, latestCandleTimestamp: number): CachedIndicators | null {
    const key = this.getCacheKey(symbol, interval);
    const cached = this.cache.get(key);

    if (!cached) {
      this.missCount++;
      return null;
    }

    // Check if cache is still valid (same candle timestamp)
    if (cached.lastCandleTimestamp === latestCandleTimestamp) {
      this.hitCount++;
      return cached;
    }

    // Cache invalidated (new candle closed)
    this.missCount++;
    return null;
  }

  /**
   * Store calculated indicators in cache
   */
  set(
    symbol: string,
    interval: string,
    indicators: Omit<CachedIndicators, 'calculatedAt'>
  ): void {
    const key = this.getCacheKey(symbol, interval);
    this.cache.set(key, {
      ...indicators,
      calculatedAt: Date.now(),
    });
  }

  /**
   * Invalidate cache for a symbol/interval (force recalculation)
   */
  invalidate(symbol: string, interval: string): void {
    const key = this.getCacheKey(symbol, interval);
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
  } {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }
}

// Singleton instance
let indicatorCacheInstance: IndicatorCache | null = null;

export function getIndicatorCache(): IndicatorCache {
  if (!indicatorCacheInstance) {
    indicatorCacheInstance = new IndicatorCache();
  }
  return indicatorCacheInstance;
}

/**
 * Calculate RSI (Relative Strength Index)
 * 14-period RSI is standard
 */
export function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    return 50; // Neutral if insufficient data
  }

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) {
    return 100; // All gains, maximum RSI
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * Standard: 12, 26, 9
 *
 * Phase 93.18 — CRITICAL BUG FIX: previous implementation set
 *   `const signal = macd; const histogram = macd - signal;`
 * which made `histogram` literally always 0. The Sensorium read
 * `evidence.macd.histogram` into `technical.macdHist`, so 100% of the
 * brain's 33k+ entry decisions saw macdHist === 0. We now compute a
 * proper signal line as an EMA of the MACD series.
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (candles.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Build the MACD series across the trailing window so we can compute a
  // signal line. We need `signalPeriod` MACD values to seed the EMA, plus a
  // small extra buffer so the EMA stabilises. We use signalPeriod*3 by
  // default (27 with the standard 9-period signal) — cheap and stable.
  const macdSeriesLen = signalPeriod * 3;
  const startIdx = Math.max(slowPeriod, candles.length - macdSeriesLen);
  const macdSeries: number[] = [];
  for (let i = startIdx; i <= candles.length; i++) {
    const window = candles.slice(0, i);
    if (window.length < slowPeriod) continue;
    const fast = calculateEMA(window, fastPeriod);
    const slow = calculateEMA(window, slowPeriod);
    macdSeries.push(fast - slow);
  }

  const macd = macdSeries[macdSeries.length - 1] ?? 0;

  // EMA of the MACD series — that's the signal line.
  let signal = macd;
  if (macdSeries.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    // Seed with SMA over the first `signalPeriod` values.
    let ema =
      macdSeries.slice(0, signalPeriod).reduce((a, b) => a + b, 0) /
      signalPeriod;
    for (let i = signalPeriod; i < macdSeries.length; i++) {
      ema = (macdSeries[i] - ema) * k + ema;
    }
    signal = ema;
  }

  const histogram = macd - signal;
  return { macd, signal, histogram };
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(candles: Candle[], period: number): number {
  if (candles.length < period) {
    return candles[candles.length - 1].close;
  }

  const multiplier = 2 / (period + 1);
  let ema = candles[candles.length - period].close;

  for (let i = candles.length - period + 1; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Bollinger Bands
 * Standard: 20-period SMA, 2 standard deviations
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number; pctB: number } {
  if (candles.length < period) {
    const lastClose = candles[candles.length - 1].close;
    return { upper: lastClose, middle: lastClose, lower: lastClose, pctB: 0.5 };
  }

  // Calculate SMA (middle band)
  const recentCandles = candles.slice(-period);
  const sum = recentCandles.reduce((acc, c) => acc + c.close, 0);
  const middle = sum / period;

  // Calculate standard deviation
  const squaredDiffs = recentCandles.map(c => Math.pow(c.close - middle, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
  const standardDeviation = Math.sqrt(variance);

  const upper = middle + stdDev * standardDeviation;
  const lower = middle - stdDev * standardDeviation;

  // Phase 93.18 — %B is the price's normalized position within the bands.
  // 0 = at lower band, 0.5 = at middle, 1 = at upper. Sensorium reads this
  // as `technical.bbPctB`. Without it the Sensorium defaulted to 0.5 across
  // 100% of brain decisions.
  const last = candles[candles.length - 1].close;
  const width = upper - lower;
  const pctB = width > 0 ? (last - lower) / width : 0.5;

  return { upper, middle, lower, pctB };
}
