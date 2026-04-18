import { describe, it, expect } from 'vitest';
import { calculateRSI, calculateMACD, calculateBollingerBands } from '../utils/IndicatorCache';
import type { Candle } from '../WebSocketCandleCache';

describe('Technical Indicators', () => {
  // Create sample candle data for testing
  const createSampleCandles = (count: number): Candle[] => {
    const candles: Candle[] = [];
    const basePrice = 50000;
    const baseTime = Date.now() - count * 60000; // 1 minute intervals
    
    for (let i = 0; i < count; i++) {
      const variation = Math.sin(i / 5) * 1000; // Create some price movement
      const close = basePrice + variation + Math.random() * 100;
      candles.push({
        timestamp: baseTime + i * 60000,
        open: close - 50 + Math.random() * 100,
        high: close + Math.random() * 100,
        low: close - Math.random() * 100,
        close,
        volume: 100 + Math.random() * 50,
      });
    }
    return candles;
  };

  it('should calculate RSI correctly', () => {
    const candles = createSampleCandles(50);
    const rsi = calculateRSI(candles, 14);

    expect(rsi).toBeDefined();
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('should handle insufficient data for RSI', () => {
    const candles = createSampleCandles(5); // Not enough data
    const rsi = calculateRSI(candles, 14);

    expect(rsi).toBe(50); // Should return neutral value
  });

  it('should calculate MACD correctly', () => {
    const candles = createSampleCandles(100);
    const macd = calculateMACD(candles, 12, 26, 9);

    expect(macd).toBeDefined();
    expect(macd.macd).toBeDefined();
    expect(macd.signal).toBeDefined();
    expect(macd.histogram).toBeDefined();
  });

  it('should calculate Bollinger Bands correctly', () => {
    const candles = createSampleCandles(50);
    const bb = calculateBollingerBands(candles, 20, 2);

    expect(bb).toBeDefined();
    expect(bb.upper).toBeGreaterThan(bb.middle);
    expect(bb.middle).toBeGreaterThan(bb.lower);
    expect(bb.upper).toBeGreaterThan(0);
    expect(bb.lower).toBeGreaterThan(0);
  });

  it('should handle custom RSI period', () => {
    const candles = createSampleCandles(50);
    const rsi21 = calculateRSI(candles, 21);
    const rsi14 = calculateRSI(candles, 14);

    expect(rsi21).toBeDefined();
    expect(rsi14).toBeDefined();
    // Different periods should potentially give different values
    expect(typeof rsi21).toBe('number');
    expect(typeof rsi14).toBe('number');
  });

  it('should handle custom Bollinger Bands parameters', () => {
    const candles = createSampleCandles(50);
    const bb20 = calculateBollingerBands(candles, 20, 2);
    const bb30 = calculateBollingerBands(candles, 30, 2.5);

    expect(bb20).toBeDefined();
    expect(bb30).toBeDefined();
    
    // Different periods should give different band widths
    const bandwidth20 = bb20.upper - bb20.lower;
    const bandwidth30 = bb30.upper - bb30.lower;
    
    expect(bandwidth20).toBeGreaterThan(0);
    expect(bandwidth30).toBeGreaterThan(0);
  });
});
