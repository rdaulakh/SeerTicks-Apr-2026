/**
 * Kelly Criterion Unit Tests
 * 
 * Tests optimal position sizing calculations
 */

import { describe, it, expect } from 'vitest';
import { KellyCriterion } from '../KellyCriterion';

describe('KellyCriterion', () => {
  describe('calculatePositionSize', () => {
    it('should calculate correct Kelly fraction for positive edge', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.6, // 60% win rate
        profitFactor: 2.0, // 2:1 profit factor
        confidence: 1.0, // Full confidence
        currentPrice: 50000,
        accountBalance: 100000,
        fractionOfKelly: 1.0, // Full Kelly
      });

      // Kelly formula: f* = (p * b - q) / b
      // f* = (0.6 * 2 - 0.4) / 2 = (1.2 - 0.4) / 2 = 0.4
      expect(result.kellyFraction).toBeCloseTo(0.4, 2);
      expect(result.adjustedFraction).toBeCloseTo(0.25, 2); // Capped at max 25%
      expect(result.positionSizeUSD).toBeCloseTo(25000, 0);
    });

    it('should apply half-Kelly by default', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.6,
        profitFactor: 2.0,
        confidence: 1.0,
        currentPrice: 50000,
        accountBalance: 100000,
        fractionOfKelly: 0.5, // Half-Kelly
      });

      // Half-Kelly: 0.4 * 0.5 = 0.2
      expect(result.kellyFraction).toBeCloseTo(0.2, 2);
      expect(result.positionSizeUSD).toBeCloseTo(20000, 0);
    });

    it('should adjust for agent confidence', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.6,
        profitFactor: 2.0,
        confidence: 0.5, // 50% confidence
        currentPrice: 50000,
        accountBalance: 100000,
        fractionOfKelly: 1.0,
      });

      // Kelly: 0.4, adjusted for confidence: 0.4 * 0.5 = 0.2
      expect(result.adjustedFraction).toBeCloseTo(0.2, 2);
      expect(result.positionSizeUSD).toBeCloseTo(20000, 0);
    });

    it('should return zero position size for negative edge', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.4, // 40% win rate (negative edge)
        profitFactor: 1.5,
        confidence: 1.0,
        currentPrice: 50000,
        accountBalance: 100000,
      });

      expect(result.kellyFraction).toBeLessThanOrEqual(0.01); // Allow small floating point error
      expect(result.adjustedFraction).toBeCloseTo(0, 5);
      expect(result.positionSizeUSD).toBeCloseTo(0, 5);
      expect(result.reasoning).toContain('0.00%'); // Zero allocation
    });

    it('should cap position size at maximum', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.8, // Very high win rate
        profitFactor: 3.0,
        confidence: 1.0,
        currentPrice: 50000,
        accountBalance: 100000,
        maxPositionSize: 0.15, // Max 15%
        fractionOfKelly: 1.0,
      });

      expect(result.adjustedFraction).toBeLessThanOrEqual(0.15);
      expect(result.positionSizeUSD).toBeLessThanOrEqual(15000);
    });

    it('should calculate position size in units correctly', () => {
      const result = KellyCriterion.calculatePositionSize({
        winRate: 0.6,
        profitFactor: 2.0,
        confidence: 1.0,
        currentPrice: 50000,
        accountBalance: 100000,
        fractionOfKelly: 0.5,
      });

      // $20,000 / $50,000 = 0.4 units
      expect(result.positionSizeUnits).toBeCloseTo(0.4, 2);
    });

    it('should throw error for invalid win rate', () => {
      expect(() => {
        KellyCriterion.calculatePositionSize({
          winRate: 1.5, // Invalid (> 1)
          profitFactor: 2.0,
          confidence: 1.0,
          currentPrice: 50000,
          accountBalance: 100000,
        });
      }).toThrow('Invalid win rate');
    });

    it('should throw error for invalid profit factor', () => {
      expect(() => {
        KellyCriterion.calculatePositionSize({
          winRate: 0.6,
          profitFactor: -1.0, // Invalid (negative)
          confidence: 1.0,
          currentPrice: 50000,
          accountBalance: 100000,
        });
      }).toThrow('Invalid profit factor');
    });
  });

  describe('calculatePortfolioAllocation', () => {
    it('should allocate capital across multiple symbols', () => {
      const symbols = [
        { symbol: 'BTCUSDT', winRate: 0.65, profitFactor: 2.0, confidence: 0.8, currentPrice: 50000 },
        { symbol: 'ETHUSDT', winRate: 0.60, profitFactor: 1.8, confidence: 0.7, currentPrice: 3000 },
        { symbol: 'BNBUSDT', winRate: 0.55, profitFactor: 1.5, confidence: 0.6, currentPrice: 300 },
      ];

      const allocation = KellyCriterion.calculatePortfolioAllocation(
        symbols,
        100000,
        {
          maxPositionSize: 0.25,
          fractionOfKelly: 0.5,
          minConfidence: 0.5,
        }
      );

      expect(allocation.size).toBe(3);
      expect(allocation.has('BTCUSDT')).toBe(true);
      expect(allocation.has('ETHUSDT')).toBe(true);
      expect(allocation.has('BNBUSDT')).toBe(true);

      // BTC should have largest allocation (highest confidence)
      const btcAllocation = allocation.get('BTCUSDT')!;
      const ethAllocation = allocation.get('ETHUSDT')!;
      expect(btcAllocation.positionSizeUSD).toBeGreaterThan(ethAllocation.positionSizeUSD);
    });

    it('should filter symbols below minimum confidence', () => {
      const symbols = [
        { symbol: 'BTCUSDT', winRate: 0.65, profitFactor: 2.0, confidence: 0.8, currentPrice: 50000 },
        { symbol: 'ETHUSDT', winRate: 0.60, profitFactor: 1.8, confidence: 0.4, currentPrice: 3000 }, // Below min
      ];

      const allocation = KellyCriterion.calculatePortfolioAllocation(
        symbols,
        100000,
        {
          minConfidence: 0.5,
        }
      );

      expect(allocation.size).toBe(1);
      expect(allocation.has('BTCUSDT')).toBe(true);
      expect(allocation.has('ETHUSDT')).toBe(false);
    });

    it('should normalize allocation when total exceeds 100%', () => {
      const symbols = [
        { symbol: 'BTCUSDT', winRate: 0.8, profitFactor: 3.0, confidence: 1.0, currentPrice: 50000 },
        { symbol: 'ETHUSDT', winRate: 0.8, profitFactor: 3.0, confidence: 1.0, currentPrice: 3000 },
        { symbol: 'BNBUSDT', winRate: 0.8, profitFactor: 3.0, confidence: 1.0, currentPrice: 300 },
      ];

      const allocation = KellyCriterion.calculatePortfolioAllocation(
        symbols,
        100000,
        {
          maxPositionSize: 0.5, // Allow large positions
          fractionOfKelly: 1.0,
        }
      );

      // Calculate total allocation
      let totalAllocation = 0;
      allocation.forEach(result => {
        totalAllocation += result.adjustedFraction;
      });

      // Should not exceed 100%
      expect(totalAllocation).toBeLessThanOrEqual(1.0);
    });

    it('should return empty allocation for no eligible symbols', () => {
      const symbols = [
        { symbol: 'BTCUSDT', winRate: 0.4, profitFactor: 1.0, confidence: 0.3, currentPrice: 50000 }, // Negative edge + low confidence
      ];

      const allocation = KellyCriterion.calculatePortfolioAllocation(
        symbols,
        100000,
        {
          minConfidence: 0.5,
        }
      );

      expect(allocation.size).toBe(0);
    });
  });

  describe('calculateExpectedGrowthRate', () => {
    it('should calculate positive growth rate for positive edge', () => {
      const growthRate = KellyCriterion.calculateExpectedGrowthRate(0.6, 2.0);
      expect(growthRate).toBeGreaterThan(0);
    });

    it('should calculate negative growth rate for negative edge', () => {
      const growthRate = KellyCriterion.calculateExpectedGrowthRate(0.3, 1.2); // Stronger negative edge
      expect(growthRate).toBeLessThan(0);
    });
  });

  describe('calculateRiskOfRuin', () => {
    it('should calculate low risk of ruin for positive edge', () => {
      const riskOfRuin = KellyCriterion.calculateRiskOfRuin(0.6, 2.0, 0.2);
      expect(riskOfRuin).toBeLessThan(0.5); // Less than 50% risk
    });

    it('should cap risk of ruin at 100%', () => {
      const riskOfRuin = KellyCriterion.calculateRiskOfRuin(0.3, 1.0, 0.5);
      expect(riskOfRuin).toBeLessThanOrEqual(1.0);
    });
  });
});
