/**
 * Test for Candle Data Validation - Insufficient Data Handling
 * 
 * Verifies that the system properly handles insufficient candle data scenarios
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getCandleCache } from '../WebSocketCandleCache';

describe('Candle Data Validation', () => {
  beforeAll(() => {
    // Initialize candle cache
    const cache = getCandleCache();
    expect(cache).toBeDefined();
  });

  it('should return empty array when no candles are available', () => {
    const cache = getCandleCache();
    const candles = cache.getCandles('NONEXISTENT-SYMBOL', '1h', 200);
    
    expect(candles).toBeDefined();
    expect(Array.isArray(candles)).toBe(true);
    expect(candles.length).toBe(0);
    
    console.log('✅ Empty array returned for non-existent symbol');
  });

  it('should detect insufficient candle data (< 50 candles)', () => {
    const cache = getCandleCache();
    
    // Add a small number of test candles
    const testSymbol = 'TEST-INSUFFICIENT';
    const testCandles = Array.from({ length: 30 }, (_, i) => ({
      timestamp: Date.now() - (30 - i) * 60000,
      open: 50000 + i * 10,
      high: 50100 + i * 10,
      low: 49900 + i * 10,
      close: 50000 + i * 10,
      volume: 1000,
    }));

    // Seed the cache with insufficient data
    cache.seedHistoricalCandles(testSymbol, '1h', testCandles);
    
    const candles = cache.getCandles(testSymbol, '1h', 200);
    
    expect(candles.length).toBeLessThan(50);
    console.log(`✅ Detected insufficient data: ${candles.length} candles (need 50+)`);
  });

  it('should have sufficient candles for technical analysis (>= 50)', () => {
    const cache = getCandleCache();
    
    // Add sufficient test candles
    const testSymbol = 'TEST-SUFFICIENT';
    const testCandles = Array.from({ length: 100 }, (_, i) => ({
      timestamp: Date.now() - (100 - i) * 60000,
      open: 50000 + i * 10,
      high: 50100 + i * 10,
      low: 49900 + i * 10,
      close: 50000 + i * 10,
      volume: 1000,
    }));

    // Seed the cache with sufficient data
    cache.seedHistoricalCandles(testSymbol, '1h', testCandles);
    
    const candles = cache.getCandles(testSymbol, '1h', 200);
    
    expect(candles.length).toBeGreaterThanOrEqual(50);
    console.log(`✅ Sufficient data available: ${candles.length} candles`);
  });

  it('should validate candle data structure', () => {
    const cache = getCandleCache();
    
    const testSymbol = 'TEST-STRUCTURE';
    const testCandles = [{
      timestamp: Date.now(),
      open: 50000,
      high: 50100,
      low: 49900,
      close: 50050,
      volume: 1000,
    }];

    cache.seedHistoricalCandles(testSymbol, '1h', testCandles);
    const candles = cache.getCandles(testSymbol, '1h', 10);
    
    if (candles.length > 0) {
      const candle = candles[0];
      
      // Verify all required fields exist
      expect(candle).toHaveProperty('timestamp');
      expect(candle).toHaveProperty('open');
      expect(candle).toHaveProperty('high');
      expect(candle).toHaveProperty('low');
      expect(candle).toHaveProperty('close');
      expect(candle).toHaveProperty('volume');
      
      // Verify data types
      expect(typeof candle.timestamp).toBe('number');
      expect(typeof candle.open).toBe('number');
      expect(typeof candle.high).toBe('number');
      expect(typeof candle.low).toBe('number');
      expect(typeof candle.close).toBe('number');
      expect(typeof candle.volume).toBe('number');
      
      console.log('✅ Candle data structure validated');
    }
  });

  it('should handle cache stats correctly', () => {
    const cache = getCandleCache();
    const stats = cache.getStats();
    
    expect(stats).toBeDefined();
    expect(typeof stats).toBe('object');
    
    // Stats should have symbol information
    if (stats.symbols && stats.symbols.length > 0) {
      expect(Array.isArray(stats.symbols)).toBe(true);
      console.log('✅ Cache stats retrieved successfully');
      console.log(`Found ${stats.symbols.length} symbols in cache`);
    } else {
      console.log('✅ Cache stats retrieved (empty cache)');
    }
  });
});
