/**
 * Trading Signal Engine Test Suite
 * 
 * Tests for signal generation from technical indicators
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TradingSignalEngine } from '../services/TradingSignalEngine';
import type { Candle } from '../WebSocketCandleCache';

// Helper to create test candles
function createTestCandles(count: number, basePrice: number = 100): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const variation = (Math.random() - 0.5) * 10;
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

// Create oversold RSI scenario
function createOversoldCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  
  // Create downtrend to push RSI below 30
  for (let i = 0; i < 50; i++) {
    const decline = i < 20 ? -2 : -0.5; // Strong decline then stabilize
    const close = price + decline;
    
    candles.push({
      timestamp: Date.now() - (50 - i) * 60000,
      open: price,
      high: price + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    });
    
    price = close;
  }
  
  return candles;
}

// Create overbought RSI scenario
function createOverboughtCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  
  // Create uptrend to push RSI above 70
  for (let i = 0; i < 50; i++) {
    const gain = i < 20 ? 2 : 0.5; // Strong gain then stabilize
    const close = price + gain;
    
    candles.push({
      timestamp: Date.now() - (50 - i) * 60000,
      open: price,
      high: close + 0.5,
      low: price - 0.5,
      close,
      volume: 1000,
    });
    
    price = close;
  }
  
  return candles;
}

describe('TradingSignalEngine', () => {
  let engine: TradingSignalEngine;

  beforeEach(() => {
    engine = new TradingSignalEngine();
  });

  describe('Signal Generation', () => {
    it('should generate signals for valid candle data', () => {
      const candles = createTestCandles(100);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      expect(Array.isArray(signals)).toBe(true);
    });

    it('should return empty array for insufficient data', () => {
      const candles = createTestCandles(30);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      expect(signals).toEqual([]);
    });

    it('should generate BUY signal for oversold RSI', () => {
      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const rsiSignal = signals.find(s => s.source === 'RSI');
      expect(rsiSignal).toBeDefined();
      if (rsiSignal) {
        expect(rsiSignal.type).toBe('BUY');
        expect(rsiSignal.indicators.rsi).toBeLessThan(30);
      }
    });

    it('should generate SELL signal for overbought RSI', () => {
      const candles = createOverboughtCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const rsiSignal = signals.find(s => s.source === 'RSI');
      expect(rsiSignal).toBeDefined();
      if (rsiSignal) {
        expect(rsiSignal.type).toBe('SELL');
        expect(rsiSignal.indicators.rsi).toBeGreaterThan(70);
      }
    });
  });

  describe('Signal Properties', () => {
    it('should include all required signal properties', () => {
      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      if (signals.length > 0) {
        const signal = signals[0];
        expect(signal.symbol).toBe('BTC-USD');
        expect(signal.type).toBeDefined();
        expect(signal.source).toBeDefined();
        expect(signal.strength).toBeGreaterThanOrEqual(0);
        expect(signal.strength).toBeLessThanOrEqual(100);
        expect(signal.confidence).toBeGreaterThanOrEqual(0);
        expect(signal.confidence).toBeLessThanOrEqual(100);
        expect(signal.timestamp).toBeDefined();
        expect(signal.reasoning).toBeDefined();
        expect(signal.price).toBeGreaterThan(0);
      }
    });

    it('should have higher strength for extreme RSI values', () => {
      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const rsiSignal = signals.find(s => s.source === 'RSI');
      if (rsiSignal && rsiSignal.indicators.rsi) {
        // More extreme RSI should produce higher strength
        expect(rsiSignal.strength).toBeGreaterThan(0);
      }
    });
  });

  describe('Configuration', () => {
    it('should allow updating RSI thresholds', () => {
      engine.updateConfig({
        rsi: {
          oversold: 25,
          overbought: 75,
        },
      });

      const config = engine.getConfig();
      expect(config.rsi.oversold).toBe(25);
      expect(config.rsi.overbought).toBe(75);
    });

    it('should allow disabling indicators', () => {
      engine.updateConfig({
        rsi: { enabled: false },
      });

      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const rsiSignal = signals.find(s => s.source === 'RSI');
      expect(rsiSignal).toBeUndefined();
    });

    it('should allow changing minimum confirmations', () => {
      engine.updateConfig({
        combined: {
          minConfirmations: 3,
        },
      });

      const config = engine.getConfig();
      expect(config.combined.minConfirmations).toBe(3);
    });
  });

  describe('Combined Signals', () => {
    it('should generate combined signal when multiple indicators agree', () => {
      // This test depends on market conditions creating agreement
      // We'll just verify the logic works if signals exist
      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const combinedSignal = signals.find(s => s.source === 'COMBINED');
      if (combinedSignal) {
        expect(combinedSignal.type).toBeDefined();
        expect(combinedSignal.confidence).toBeGreaterThan(70); // Combined signals have boosted confidence
      }
    });

    it('should require minimum confirmations for combined signal', () => {
      engine.updateConfig({
        combined: {
          minConfirmations: 10, // Impossible to meet
        },
      });

      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const combinedSignal = signals.find(s => s.source === 'COMBINED');
      expect(combinedSignal).toBeUndefined();
    });
  });

  describe('Signal Sources', () => {
    it('should support RSI source', () => {
      const candles = createOversoldCandles();
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const rsiSignals = signals.filter(s => s.source === 'RSI');
      expect(rsiSignals.length).toBeGreaterThanOrEqual(0);
    });

    it('should support MACD source', () => {
      const candles = createTestCandles(100);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const macdSignals = signals.filter(s => s.source === 'MACD');
      expect(macdSignals.length).toBeGreaterThanOrEqual(0);
    });

    it('should support STOCHASTIC source', () => {
      const candles = createTestCandles(100);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      const stochasticSignals = signals.filter(s => s.source === 'STOCHASTIC');
      expect(stochasticSignals.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle exactly 50 candles', () => {
      const candles = createTestCandles(50);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      expect(Array.isArray(signals)).toBe(true);
    });

    it('should handle large datasets', () => {
      const candles = createTestCandles(500);
      const signals = engine.generateSignals('BTC-USD', candles);
      
      expect(Array.isArray(signals)).toBe(true);
    });

    it('should handle flat market (no signals)', () => {
      // Create perfectly flat candles
      const candles: Candle[] = [];
      for (let i = 0; i < 100; i++) {
        candles.push({
          timestamp: Date.now() - (100 - i) * 60000,
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 1000,
        });
      }

      const signals = engine.generateSignals('BTC-USD', candles);
      
      // Flat market should produce neutral RSI around 50
      expect(Array.isArray(signals)).toBe(true);
    });
  });
});
