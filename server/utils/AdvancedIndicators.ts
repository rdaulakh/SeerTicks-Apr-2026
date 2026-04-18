/**
 * Advanced Technical Indicators
 * 
 * Implements additional technical indicators:
 * - Stochastic Oscillator (%K and %D)
 * - ATR (Average True Range)
 * - Fibonacci Retracement Levels
 */

import { Candle } from '../WebSocketCandleCache';

/**
 * Calculate Stochastic Oscillator
 * %K = (Current Close - Lowest Low) / (Highest High - Lowest Low) * 100
 * %D = 3-period SMA of %K
 * 
 * Standard parameters: 14 periods for %K, 3 periods for %D
 * 
 * Interpretation:
 * - Above 80: Overbought
 * - Below 20: Oversold
 * - %K crossing above %D: Bullish signal
 * - %K crossing below %D: Bearish signal
 */
export function calculateStochastic(
  candles: Candle[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number; d: number; kValues: number[] } {
  if (candles.length < kPeriod) {
    return { k: 50, d: 50, kValues: [] };
  }

  const kValues: number[] = [];

  // Calculate %K for each period
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
    const lowestLow = Math.min(...periodCandles.map(c => c.low));
    const highestHigh = Math.max(...periodCandles.map(c => c.high));
    const currentClose = candles[i].close;

    const range = highestHigh - lowestLow;
    const k = range === 0 ? 50 : ((currentClose - lowestLow) / range) * 100;
    kValues.push(k);
  }

  // Calculate %D (SMA of %K)
  const latestK = kValues[kValues.length - 1];
  let d = latestK;

  if (kValues.length >= dPeriod) {
    const recentKValues = kValues.slice(-dPeriod);
    d = recentKValues.reduce((sum, val) => sum + val, 0) / dPeriod;
  }

  return { k: latestK, d, kValues };
}

/**
 * Calculate ATR (Average True Range)
 * Measures market volatility
 * 
 * True Range = max(high - low, abs(high - previous close), abs(low - previous close))
 * ATR = Average of True Range over N periods
 * 
 * Standard period: 14
 * 
 * Interpretation:
 * - Higher ATR: Higher volatility, wider stops needed
 * - Lower ATR: Lower volatility, tighter stops possible
 * - Used for position sizing and stop-loss placement
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  // Calculate ATR as simple moving average of true ranges
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period;

  return atr;
}

/**
 * Calculate Fibonacci Retracement Levels
 * Based on a price swing (high to low or low to high)
 * 
 * Standard levels: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
 * 
 * Interpretation:
 * - Price often retraces to these levels before continuing trend
 * - 38.2%, 50%, 61.8% are most significant
 * - Used for entry points and profit targets
 */
export interface FibonacciLevels {
  direction: 'uptrend' | 'downtrend';
  high: number;
  low: number;
  levels: {
    '0%': number;
    '23.6%': number;
    '38.2%': number;
    '50%': number;
    '61.8%': number;
    '78.6%': number;
    '100%': number;
  };
}

export function calculateFibonacci(
  candles: Candle[],
  lookbackPeriod: number = 50
): FibonacciLevels {
  if (candles.length < 2) {
    const price = candles[candles.length - 1]?.close || 0;
    return {
      direction: 'uptrend',
      high: price,
      low: price,
      levels: {
        '0%': price,
        '23.6%': price,
        '38.2%': price,
        '50%': price,
        '61.8%': price,
        '78.6%': price,
        '100%': price,
      },
    };
  }

  // Use recent candles for swing calculation
  const recentCandles = candles.slice(-Math.min(lookbackPeriod, candles.length));
  
  const high = Math.max(...recentCandles.map(c => c.high));
  const low = Math.min(...recentCandles.map(c => c.low));
  
  // Find indices of high and low
  const highIndex = recentCandles.findIndex(c => c.high === high);
  const lowIndex = recentCandles.findIndex(c => c.low === low);
  
  // Determine trend direction based on which came first
  const direction = highIndex > lowIndex ? 'uptrend' : 'downtrend';
  
  const diff = high - low;
  
  // For uptrend: levels from low to high
  // For downtrend: levels from high to low
  const levels = direction === 'uptrend' ? {
    '0%': low,
    '23.6%': low + diff * 0.236,
    '38.2%': low + diff * 0.382,
    '50%': low + diff * 0.5,
    '61.8%': low + diff * 0.618,
    '78.6%': low + diff * 0.786,
    '100%': high,
  } : {
    '0%': high,
    '23.6%': high - diff * 0.236,
    '38.2%': high - diff * 0.382,
    '50%': high - diff * 0.5,
    '61.8%': high - diff * 0.618,
    '78.6%': high - diff * 0.786,
    '100%': low,
  };

  return { direction, high, low, levels };
}

/**
 * Detect Stochastic crossover signals
 */
export function detectStochasticCrossover(
  currentK: number,
  currentD: number,
  previousK: number,
  previousD: number
): 'bullish' | 'bearish' | 'none' {
  // Bullish crossover: %K crosses above %D
  if (previousK <= previousD && currentK > currentD) {
    return 'bullish';
  }
  
  // Bearish crossover: %K crosses below %D
  if (previousK >= previousD && currentK < currentD) {
    return 'bearish';
  }
  
  return 'none';
}

/**
 * Calculate position size based on ATR
 * Risk-based position sizing using volatility
 */
export function calculateATRPositionSize(
  accountBalance: number,
  riskPercentage: number,
  atr: number,
  atrMultiplier: number = 2
): number {
  if (atr === 0) return 0;
  
  const riskAmount = accountBalance * (riskPercentage / 100);
  const stopDistance = atr * atrMultiplier;
  
  return riskAmount / stopDistance;
}
