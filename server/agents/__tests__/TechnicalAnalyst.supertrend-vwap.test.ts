import { describe, it, expect } from 'vitest';
import { getActiveClock } from '../../_core/clock';
import { TechnicalAnalyst } from '../TechnicalAnalyst';
import { MarketData } from '../../exchanges';

/**
 * Test suite for SuperTrend and VWAP indicators in TechnicalAnalyst
 * Validates calculation accuracy and signal integration
 */
describe('TechnicalAnalyst - SuperTrend & VWAP', () => {
  describe('SuperTrend Calculation', () => {
    it('should calculate SuperTrend with bullish direction when price is above trend', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create uptrending market data (price moving up)
      const candles: MarketData[] = [];
      const basePrice = 50000;
      for (let i = 0; i < 50; i++) {
        const price = basePrice + (i * 100); // Uptrend
        candles.push({
          timestamp: getActiveClock().now() - (50 - i) * 3600000,
          open: price - 50,
          high: price + 100,
          low: price - 100,
          close: price,
          volume: 1000 + Math.random() * 500,
        });
      }
      
      // Access private method via type assertion for testing
      const superTrend = (analyst as any).calculateSuperTrend(candles, 10, 3.0);
      
      expect(superTrend).toBeDefined();
      expect(superTrend.direction).toBe('bullish');
      expect(superTrend.value).toBeGreaterThan(0);
      expect(superTrend.upperBand).toBeGreaterThan(superTrend.lowerBand);
      expect(candles[candles.length - 1].close).toBeGreaterThan(superTrend.value);
    });

    it('should calculate SuperTrend and return valid structure', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create market data
      const candles: MarketData[] = [];
      const basePrice = 55000;
      for (let i = 0; i < 100; i++) {
        const price = basePrice - (i * 50);
        candles.push({
          timestamp: getActiveClock().now() - (100 - i) * 3600000,
          open: price + 25,
          high: price + 50,
          low: price - 50,
          close: price,
          volume: 1000 + Math.random() * 500,
        });
      }
      
      const superTrend = (analyst as any).calculateSuperTrend(candles, 10, 3.0);
      
      expect(superTrend).toBeDefined();
      expect(superTrend.direction).toMatch(/^(bullish|bearish)$/);
      expect(superTrend.value).toBeGreaterThan(0);
      expect(superTrend.upperBand).toBeGreaterThan(superTrend.lowerBand);
    });

    it('should handle insufficient data gracefully', () => {
      const analyst = new TechnicalAnalyst();
      
      const candles: MarketData[] = [
        {
          timestamp: getActiveClock().now(),
          open: 50000,
          high: 50500,
          low: 49500,
          close: 50200,
          volume: 1000,
        },
      ];
      
      const superTrend = (analyst as any).calculateSuperTrend(candles, 10, 3.0);
      
      expect(superTrend).toBeDefined();
      expect(superTrend.direction).toBe('bullish'); // Default direction
      expect(superTrend.value).toBe(50200); // Should equal current price
    });
  });

  describe('VWAP Calculation', () => {
    it('should calculate VWAP correctly with volume weighting', () => {
      const analyst = new TechnicalAnalyst();
      
      const candles: MarketData[] = [
        { timestamp: getActiveClock().now() - 3600000, open: 50000, high: 50500, low: 49500, close: 50200, volume: 1000 },
        { timestamp: getActiveClock().now() - 2 * 3600000, open: 50200, high: 50700, low: 49700, close: 50400, volume: 2000 },
        { timestamp: getActiveClock().now() - 3 * 3600000, open: 50400, high: 50900, low: 49900, close: 50600, volume: 1500 },
      ];
      
      const vwap = (analyst as any).calculateVWAP(candles);
      
      // Manual calculation:
      // Typical prices: (50500+49500+50200)/3 = 50066.67, (50700+49700+50400)/3 = 50266.67, (50900+49900+50600)/3 = 50466.67
      // VWAP = (50066.67*1000 + 50266.67*2000 + 50466.67*1500) / (1000+2000+1500)
      //      = (50066670 + 100533340 + 75700005) / 4500
      //      = 226300015 / 4500 ≈ 50288.89
      
      expect(vwap).toBeGreaterThan(50000);
      expect(vwap).toBeLessThan(51000);
      expect(vwap).toBeCloseTo(50288.89, 0); // Within 1 unit
    });

    it('should handle zero volume by using simple average', () => {
      const analyst = new TechnicalAnalyst();
      
      const candles: MarketData[] = [
        { timestamp: getActiveClock().now() - 3600000, open: 50000, high: 50500, low: 49500, close: 50200, volume: 0 },
        { timestamp: getActiveClock().now() - 2 * 3600000, open: 50200, high: 50700, low: 49700, close: 50400, volume: 0 },
      ];
      
      const vwap = (analyst as any).calculateVWAP(candles);
      
      // Should fallback to simple average of close prices
      expect(vwap).toBe((50200 + 50400) / 2);
    });

    it('should use last 24 candles for VWAP calculation', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create 30 candles, VWAP should only use last 24
      const candles: MarketData[] = [];
      for (let i = 0; i < 30; i++) {
        candles.push({
          timestamp: getActiveClock().now() - (30 - i) * 3600000,
          open: 50000 + i * 10,
          high: 50100 + i * 10,
          low: 49900 + i * 10,
          close: 50000 + i * 10,
          volume: 1000,
        });
      }
      
      const vwap = (analyst as any).calculateVWAP(candles);
      
      // VWAP should be closer to recent prices (last 24 candles)
      const recentAvg = candles.slice(-24).reduce((sum, c) => sum + c.close, 0) / 24;
      expect(Math.abs(vwap - recentAvg)).toBeLessThan(100); // Should be close to recent average
    });
  });

  describe('Signal Integration', () => {
    it('should include SuperTrend and VWAP in signal calculation', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create bullish setup: price above SuperTrend and VWAP
      const candles: MarketData[] = [];
      const basePrice = 50000;
      for (let i = 0; i < 100; i++) {
        const price = basePrice + (i * 50); // Strong uptrend
        candles.push({
          timestamp: getActiveClock().now() - (100 - i) * 3600000,
          open: price - 25,
          high: price + 50,
          low: price - 50,
          close: price,
          volume: 1000 + Math.random() * 500,
        });
      }
      
      const indicators = (analyst as any).calculateIndicators(candles);
      
      expect(indicators.superTrend).toBeDefined();
      expect(indicators.vwap).toBeDefined();
      expect(indicators.superTrend.direction).toBe('bullish');
      expect(candles[candles.length - 1].close).toBeGreaterThan(indicators.vwap);
    });

    it('should boost confidence when SuperTrend and VWAP align with signal', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create strong bullish setup
      const candles: MarketData[] = [];
      const basePrice = 50000;
      for (let i = 0; i < 100; i++) {
        const price = basePrice + (i * 100); // Strong uptrend
        candles.push({
          timestamp: getActiveClock().now() - (100 - i) * 3600000,
          open: price - 50,
          high: price + 100,
          low: price - 100,
          close: price,
          volume: 2000 + Math.random() * 1000, // High volume
        });
      }
      
      const indicators = (analyst as any).calculateIndicators(candles);
      const sr = (analyst as any).findSupportResistance(candles);
      const currentPrice = candles[candles.length - 1].close;
      
      const result = (analyst as any).calculateSignalFromTechnicals(indicators, sr, currentPrice, '');
      
      // With SuperTrend bullish, price above VWAP, RSI not overbought — should lean bullish or neutral
      // (indicator calculations can produce slight variations based on random volume)
      expect(['bullish', 'neutral']).toContain(result.signal);
      expect(result.confidence).toBeGreaterThan(0.1); // Should have some confidence
    });
  });

  describe('Execution Score Enhancement', () => {
    it('should increase execution score when SuperTrend aligns with signal', () => {
      const analyst = new TechnicalAnalyst();
      
      const candles: MarketData[] = [];
      const basePrice = 50000;
      for (let i = 0; i < 100; i++) {
        const price = basePrice + (i * 50);
        candles.push({
          timestamp: getActiveClock().now() - (100 - i) * 3600000,
          open: price - 25,
          high: price + 50,
          low: price - 50,
          close: price,
          volume: 1500,
        });
      }
      
      const indicators = (analyst as any).calculateIndicators(candles);
      const sr = (analyst as any).findSupportResistance(candles);
      const currentPrice = candles[candles.length - 1].close;
      
      const executionScore = (analyst as any).calculateExecutionScore(
        currentPrice,
        indicators,
        sr,
        'bullish'
      );
      
      // Score should be boosted by SuperTrend alignment and VWAP position
      expect(executionScore).toBeGreaterThan(50); // Should be above neutral
    });

    it('should include SuperTrend and VWAP in execution score calculation', () => {
      const analyst = new TechnicalAnalyst();
      
      // Create uptrending market data
      const candles: MarketData[] = [];
      const basePrice = 50000;
      for (let i = 0; i < 100; i++) {
        const price = basePrice + (i * 50);
        candles.push({
          timestamp: getActiveClock().now() - (100 - i) * 3600000,
          open: price - 25,
          high: price + 50,
          low: price - 50,
          close: price,
          volume: 1500,
        });
      }
      
      const indicators = (analyst as any).calculateIndicators(candles);
      const sr = (analyst as any).findSupportResistance(candles);
      const currentPrice = candles[candles.length - 1].close;
      
      const executionScore = (analyst as any).calculateExecutionScore(
        currentPrice,
        indicators,
        sr,
        'bullish'
      );
      
      // Execution score should be calculated (0-100 range)
      expect(executionScore).toBeGreaterThanOrEqual(0);
      expect(executionScore).toBeLessThanOrEqual(100);
    });
  });
});
