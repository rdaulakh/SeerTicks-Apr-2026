/**
 * Advanced Indicators Test Suite
 * 
 * Tests for Stochastic Oscillator, ATR, and Fibonacci calculations
 */

import { describe, it, expect } from 'vitest';
import { calculateStochastic, calculateATR, calculateFibonacci, detectStochasticCrossover } from '../utils/AdvancedIndicators';
import type { Candle } from '../WebSocketCandleCache';

// Helper to create test candles
function createTestCandles(count: number, basePrice: number = 100): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const variation = (Math.random() - 0.5) * 10; // Random variation ±5
    const open = price;
    const close = price + variation;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    
    candles.push({
      timestamp: Date.now() - (count - i) * 60000,
      open,
      high,
      low,
      close,
      volume: 1000 + Math.random() * 500,
    });
    
    price = close;
  }
  
  return candles;
}

describe('Stochastic Oscillator', () => {
  it('should calculate stochastic values within 0-100 range', () => {
    const candles = createTestCandles(50);
    const result = calculateStochastic(candles, 14, 3);
    
    expect(result.k).toBeGreaterThanOrEqual(0);
    expect(result.k).toBeLessThanOrEqual(100);
    expect(result.d).toBeGreaterThanOrEqual(0);
    expect(result.d).toBeLessThanOrEqual(100);
  });

  it('should return neutral values for insufficient data', () => {
    const candles = createTestCandles(10);
    const result = calculateStochastic(candles, 14, 3);
    
    expect(result.k).toBe(50);
    expect(result.d).toBe(50);
  });

  it('should generate kValues array', () => {
    const candles = createTestCandles(50);
    const result = calculateStochastic(candles, 14, 3);
    
    expect(result.kValues).toBeDefined();
    expect(result.kValues.length).toBeGreaterThan(0);
  });

  it('should detect bullish crossover', () => {
    const crossover = detectStochasticCrossover(25, 20, 19, 21);
    expect(crossover).toBe('bullish');
  });

  it('should detect bearish crossover', () => {
    const crossover = detectStochasticCrossover(75, 80, 81, 79);
    expect(crossover).toBe('bearish');
  });

  it('should detect no crossover', () => {
    const crossover = detectStochasticCrossover(50, 45, 48, 43);
    expect(crossover).toBe('none');
  });
});

describe('ATR (Average True Range)', () => {
  it('should calculate ATR for valid data', () => {
    const candles = createTestCandles(50);
    const atr = calculateATR(candles, 14);
    
    expect(atr).toBeGreaterThan(0);
    expect(typeof atr).toBe('number');
  });

  it('should return 0 for insufficient data', () => {
    const candles = createTestCandles(10);
    const atr = calculateATR(candles, 14);
    
    expect(atr).toBe(0);
  });

  it('should calculate higher ATR for volatile market', () => {
    // Create volatile candles
    const volatileCandles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const basePrice = 100;
      const volatility = 20; // High volatility
      volatileCandles.push({
        timestamp: Date.now() - (50 - i) * 60000,
        open: basePrice + (Math.random() - 0.5) * volatility,
        high: basePrice + Math.random() * volatility,
        low: basePrice - Math.random() * volatility,
        close: basePrice + (Math.random() - 0.5) * volatility,
        volume: 1000,
      });
    }

    // Create stable candles
    const stableCandles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const basePrice = 100;
      const volatility = 2; // Low volatility
      stableCandles.push({
        timestamp: Date.now() - (50 - i) * 60000,
        open: basePrice + (Math.random() - 0.5) * volatility,
        high: basePrice + Math.random() * volatility,
        low: basePrice - Math.random() * volatility,
        close: basePrice + (Math.random() - 0.5) * volatility,
        volume: 1000,
      });
    }

    const volatileATR = calculateATR(volatileCandles, 14);
    const stableATR = calculateATR(stableCandles, 14);

    expect(volatileATR).toBeGreaterThan(stableATR);
  });
});

describe('Fibonacci Retracement', () => {
  it('should calculate fibonacci levels', () => {
    const candles = createTestCandles(50);
    const fib = calculateFibonacci(candles, 50);
    
    expect(fib.levels).toBeDefined();
    expect(fib.levels['0%']).toBeDefined();
    expect(fib.levels['23.6%']).toBeDefined();
    expect(fib.levels['38.2%']).toBeDefined();
    expect(fib.levels['50%']).toBeDefined();
    expect(fib.levels['61.8%']).toBeDefined();
    expect(fib.levels['78.6%']).toBeDefined();
    expect(fib.levels['100%']).toBeDefined();
  });

  it('should determine trend direction', () => {
    const candles = createTestCandles(50);
    const fib = calculateFibonacci(candles, 50);
    
    expect(['uptrend', 'downtrend']).toContain(fib.direction);
  });

  it('should have correct level ordering for uptrend', () => {
    // Create uptrend candles
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const price = 100 + i * 2; // Consistent uptrend
      candles.push({
        timestamp: Date.now() - (50 - i) * 60000,
        open: price,
        high: price + 1,
        low: price - 0.5,
        close: price + 0.5,
        volume: 1000,
      });
    }

    const fib = calculateFibonacci(candles, 50);
    
    if (fib.direction === 'uptrend') {
      expect(fib.levels['0%']).toBeLessThan(fib.levels['50%']);
      expect(fib.levels['50%']).toBeLessThan(fib.levels['100%']);
    }
  });

  it('should handle minimal data', () => {
    const candles = createTestCandles(2);
    const fib = calculateFibonacci(candles, 50);
    
    expect(fib.levels).toBeDefined();
    expect(fib.high).toBeDefined();
    expect(fib.low).toBeDefined();
  });

  it('should calculate 50% level as midpoint', () => {
    const candles = createTestCandles(50);
    const fib = calculateFibonacci(candles, 50);
    
    const midpoint = (fib.high + fib.low) / 2;
    expect(Math.abs(fib.levels['50%'] - midpoint)).toBeLessThan(0.01);
  });
});

describe('Stochastic Integration', () => {
  it('should work with real-world-like data', () => {
    // Simulate BTC price movement
    const candles: Candle[] = [];
    let price = 50000;
    
    for (let i = 0; i < 100; i++) {
      const trend = Math.sin(i / 10) * 1000; // Cyclical movement
      const noise = (Math.random() - 0.5) * 500;
      const close = price + trend + noise;
      
      candles.push({
        timestamp: Date.now() - (100 - i) * 3600000,
        open: price,
        high: Math.max(price, close) + Math.random() * 200,
        low: Math.min(price, close) - Math.random() * 200,
        close,
        volume: 1000000 + Math.random() * 500000,
      });
      
      price = close;
    }

    const stochastic = calculateStochastic(candles, 14, 3);
    
    expect(stochastic.k).toBeGreaterThanOrEqual(0);
    expect(stochastic.k).toBeLessThanOrEqual(100);
    expect(stochastic.kValues.length).toBeGreaterThan(0);
  });
});
