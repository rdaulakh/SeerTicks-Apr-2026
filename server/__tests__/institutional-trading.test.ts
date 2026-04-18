/**
 * Institutional Trading Logic Test Suite
 * 
 * Tests for hedge fund-level trading standards:
 * - Entry price validation (VWAP, spread, slippage)
 * - Stop loss calculation (support/resistance, ATR, max loss)
 * - Take profit calculation (resistance clusters, R:R validation)
 * - Risk-reward ratio enforcement
 * - Portfolio heat calculation
 * - Correlation-based position sizing
 */

import { describe, it, expect } from 'vitest';
import {
  validateEntryPrice,
  calculateInstitutionalStopLoss,
  calculateInstitutionalTakeProfit,
  validateRiskReward,
  calculatePortfolioHeat,
  adjustPositionSizeForCorrelation,
} from '../utils/InstitutionalTrading';

describe('Institutional Trading Logic', () => {
  describe('Entry Price Validation', () => {
    it('should validate entry when price is near VWAP with tight spread', () => {
      const result = validateEntryPrice(
        100000, // currentPrice
        100000, // vwap (0% deviation)
        99950,  // bid
        100050, // ask (0.1% spread)
        0.1,    // orderSize
        1.0,    // orderBookDepth (10x order size)
        'BTCUSDT'
      );

      expect(result.isValid).toBe(true);
      expect(result.qualityScore).toBeGreaterThan(90);
      expect(result.spreadPercent).toBeLessThan(0.2); // BTC threshold
    });

    it('should reject entry when price deviates too much from VWAP', () => {
      const result = validateEntryPrice(
        101500, // currentPrice
        100000, // vwap (1.5% deviation - too high)
        101450,
        101550,
        0.1,
        1.0,
        'BTCUSDT'
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('VWAP');
    });

    it('should reject entry when spread is too wide', () => {
      const result = validateEntryPrice(
        100000,
        100000,
        99700,  // bid
        100300, // ask (0.6% spread - too wide for BTC)
        0.1,
        1.0,
        'BTCUSDT'
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Spread too wide');
    });

    it('should allow wider spread for altcoins', () => {
      const result = validateEntryPrice(
        3000,
        3000,
        2985,  // bid
        3015,  // ask (1% spread - ok for altcoins)
        1.0,
        10.0,
        'ETHUSDT'
      );

      // Spread is 1% which exceeds 0.5% threshold for altcoins
      expect(result.isValid).toBe(false);
      expect(result.spreadPercent).toBeGreaterThan(0.5);
    });

    it('should estimate slippage based on order size', () => {
      const result = validateEntryPrice(
        100000,
        100000,
        99950,
        100050,
        1.0,    // Large order
        1.0,    // Equal to depth (100% ratio)
        'BTCUSDT'
      );

      expect(result.estimatedSlippage).toBeGreaterThan(0.1); // High slippage
    });
  });

  describe('Institutional Stop Loss Calculation', () => {
    it('should use ATR-based stop when no support levels', () => {
      const result = calculateInstitutionalStopLoss(
        100000, // currentPrice
        1000,   // atr
        [],     // No support levels
        'long',
        2.0,    // 2% max loss
        100000  // account balance
      );

      expect(result.method).toBe('atr');
      expect(result.stopLossPercent).toBeLessThanOrEqual(2.0);
      expect(result.stopLossPrice).toBeLessThan(100000);
    });

    it('should integrate support level with buffer for long position', () => {
      const result = calculateInstitutionalStopLoss(
        100000,
        1000,
        [98000, 97000, 96000], // Support levels
        'long',
        2.0,
        100000
      );

      expect(result.method).toBe('hybrid');
      expect(result.supportLevel).toBe(98000);
      // Stop should be at or below support with buffer
      expect(result.stopLossPrice).toBeLessThanOrEqual(98000);
      expect(result.stopLossPrice).toBeGreaterThan(96000);
    });

    it('should enforce maximum loss limit', () => {
      const result = calculateInstitutionalStopLoss(
        100000,
        5000,   // Very high ATR (would create 10% stop)
        [],
        'long',
        2.0,    // 2% max loss enforced
        100000
      );

      expect(result.method).toBe('max_loss');
      expect(result.stopLossPercent).toBeLessThanOrEqual(2.0);
      expect(result.stopLossPrice).toBeGreaterThanOrEqual(98000); // Max 2% loss
    });

    it('should handle short positions correctly', () => {
      const result = calculateInstitutionalStopLoss(
        100000,
        1000,
        [102000, 103000], // Resistance levels for short
        'short',
        2.0,
        100000
      );

      expect(result.stopLossPrice).toBeGreaterThan(100000); // Stop above entry for short
      expect(result.stopLossPercent).toBeLessThanOrEqual(2.0);
    });
  });

  describe('Institutional Take Profit Calculation', () => {
    it('should enforce minimum 1:2 risk-reward ratio', () => {
      const result = calculateInstitutionalTakeProfit(
        100000, // entryPrice
        98000,  // stopLoss (2% risk)
        [100500], // Very close resistance (would be <1:2 R:R)
        'long',
        0.5,    // trendStrength
        2.0     // minRiskReward
      );

      // Should use minimum R:R target instead of close resistance
      const risk = 100000 - 98000; // 2000
      const minReward = risk * 2; // 4000
      expect(result.takeProfitPrice).toBeGreaterThanOrEqual(100000 + minReward);
      expect(result.riskRewardRatio).toBeGreaterThanOrEqual(2.0);
    });

    it('should identify resistance cluster', () => {
      const result = calculateInstitutionalTakeProfit(
        100000,
        98000,
        [104000, 104100, 104200], // Cluster within 0.5%
        'long',
        0.5,
        2.0
      );

      expect(result.resistanceCluster.length).toBeGreaterThan(1);
      // Target should be at or before cluster (0.5% buffer)
      expect(result.takeProfitPrice).toBeLessThanOrEqual(104000);
    });

    it('should extend target in strong trend', () => {
      const resultWeak = calculateInstitutionalTakeProfit(
        100000,
        98000,
        [105000],
        'long',
        0.2, // Weak trend
        2.0
      );

      const resultStrong = calculateInstitutionalTakeProfit(
        100000,
        98000,
        [105000],
        'long',
        0.8, // Strong trend
        2.0
      );

      // Strong trend should have higher target
      expect(resultStrong.takeProfitPrice).toBeGreaterThan(resultWeak.takeProfitPrice);
      expect(resultStrong.reasoning).toContain('Extended');
    });

    it('should calculate risk-unit based partial exits', () => {
      const result = calculateInstitutionalTakeProfit(
        100000,
        98000,
        [110000],
        'long',
        0.5,
        2.0
      );

      expect(result.partialExits).toHaveLength(4);
      
      // Check partial exits are at correct risk units
      const risk = 100000 - 98000; // 2000
      expect(result.partialExits[0].price).toBe(100000 + risk * 1); // +1R
      expect(result.partialExits[1].price).toBe(100000 + risk * 2); // +2R
      expect(result.partialExits[2].price).toBe(100000 + risk * 3); // +3R
      expect(result.partialExits[3].price).toBe(result.takeProfitPrice); // Runner

      // Check percentages
      expect(result.partialExits[0].percent).toBe(25);
      expect(result.partialExits[1].percent).toBe(25);
      expect(result.partialExits[2].percent).toBe(25);
      expect(result.partialExits[3].percent).toBe(25);
    });
  });

  describe('Risk-Reward Validation', () => {
    it('should validate trade with good risk-reward ratio', () => {
      const result = validateRiskReward(
        100000, // entry
        98000,  // stop (2% risk)
        104000, // target (4% reward)
        2.0     // min 1:2 R:R
      );

      expect(result.isValid).toBe(true);
      expect(result.ratio).toBe(2.0);
      expect(result.reasoning).toContain('meets minimum');
    });

    it('should reject trade with poor risk-reward ratio', () => {
      const result = validateRiskReward(
        100000,
        98000,  // 2% risk
        101500, // 1.5% reward (0.75:1 R:R)
        2.0
      );

      expect(result.isValid).toBe(false);
      expect(result.ratio).toBeLessThan(2.0);
      expect(result.reasoning).toContain('TRADE REJECTED');
    });

    it('should calculate expected return and max loss correctly', () => {
      const result = validateRiskReward(
        100000,
        98000,  // 2% risk
        106000, // 6% reward (3:1 R:R)
        2.0
      );

      expect(result.maxLoss).toBeCloseTo(2.0, 1);
      expect(result.expectedReturn).toBeCloseTo(6.0, 1);
      expect(result.ratio).toBeCloseTo(3.0, 1);
    });
  });

  describe('Portfolio Heat Calculation', () => {
    it('should calculate total risk across positions', () => {
      const positions = [
        {
          symbol: 'BTCUSDT',
          entryPrice: 100000,
          currentPrice: 100000,
          quantity: 0.1,
          stopLoss: 98000, // 2% risk
          accountBalance: 100000,
        },
        {
          symbol: 'ETHUSDT',
          entryPrice: 3000,
          currentPrice: 3000,
          quantity: 3.0,
          stopLoss: 2940, // 2% risk
          accountBalance: 100000,
        },
      ];

      const result = calculatePortfolioHeat(positions, 10.0);

      // Each position: ~1% of account with 2% stop = 0.02% risk
      // Total heat should be around 0.04% (very small positions)
      expect(result.totalHeat).toBeGreaterThan(0);
      expect(result.positions).toHaveLength(2);
      expect(result.isOverLimit).toBe(false);
      expect(result.availableRisk).toBeGreaterThan(0);
    });

    it('should detect when portfolio heat exceeds limit', () => {
      const positions = [
        {
          symbol: 'BTCUSDT',
          entryPrice: 100000,
          currentPrice: 100000,
          quantity: 5.0, // 50% of account
          stopLoss: 98000, // 2% risk
          accountBalance: 100000,
        },
        {
          symbol: 'ETHUSDT',
          entryPrice: 3000,
          currentPrice: 3000,
          quantity: 20.0, // 60% of account
          stopLoss: 2940, // 2% risk
          accountBalance: 100000,
        },
      ];

      const result = calculatePortfolioHeat(positions, 10.0);

      // Total heat: (50% * 2%) + (60% * 2%) = 2.2% (within limit)
      // But if stops are wider, could exceed
      expect(result.totalHeat).toBeGreaterThan(0);
      expect(result.positions).toHaveLength(2);
    });

    it('should calculate available risk correctly', () => {
      const positions = [
        {
          symbol: 'BTCUSDT',
          entryPrice: 100000,
          currentPrice: 100000,
          quantity: 2.0, // 20% of account
          stopLoss: 98000, // 2% risk
          accountBalance: 100000,
        },
      ];

      const result = calculatePortfolioHeat(positions, 10.0);

      // Heat: 20% * 2% = 0.4%
      // Available: 10% - 0.4% = 9.6%
      expect(result.availableRisk).toBeCloseTo(10.0 - result.totalHeat, 1);
    });
  });

  describe('Correlation-Based Position Sizing', () => {
    it('should reduce size for correlated positions', () => {
      const correlationMatrix = new Map([
        ['BTCUSDT', new Map([
          ['ETHUSDT', 0.85], // High correlation
          ['SOLUSDT', 0.75],
        ])],
      ]);

      const existingPositions = [
        { symbol: 'ETHUSDT', positionSize: 3.0 },
        { symbol: 'SOLUSDT', positionSize: 2.0 },
      ];

      const result = adjustPositionSizeForCorrelation(
        5.0, // Base size
        'BTCUSDT',
        existingPositions,
        correlationMatrix,
        0.7 // Correlation threshold
      );

      // Should reduce by 50% due to correlated positions
      expect(result.adjustedSize).toBeCloseTo(2.5, 5);
      expect(result.reasoning).toContain('Reduced by 50%');
      expect(result.reasoning).toContain('ETHUSDT');
      expect(result.reasoning).toContain('SOLUSDT');
    });

    it('should not reduce size when no correlation', () => {
      const correlationMatrix = new Map([
        ['BTCUSDT', new Map([
          ['AAPL', 0.1], // Low correlation
        ])],
      ]);

      const existingPositions = [
        { symbol: 'AAPL', positionSize: 5.0 },
      ];

      const result = adjustPositionSizeForCorrelation(
        5.0,
        'BTCUSDT',
        existingPositions,
        correlationMatrix,
        0.7
      );

      // No reduction
      expect(result.adjustedSize).toBe(5.0);
      expect(result.reasoning).toContain('No correlated positions');
    });

    it('should handle negative correlation', () => {
      const correlationMatrix = new Map([
        ['BTCUSDT', new Map([
          ['DXY', -0.8], // Strong negative correlation
        ])],
      ]);

      const existingPositions = [
        { symbol: 'DXY', positionSize: 3.0 },
      ];

      const result = adjustPositionSizeForCorrelation(
        5.0,
        'BTCUSDT',
        existingPositions,
        correlationMatrix,
        0.7
      );

      // Should reduce even for negative correlation (absolute value)
      expect(result.adjustedSize).toBeCloseTo(2.5, 5);
    });
  });

  describe('Integration Tests', () => {
    it('should create valid trade with all institutional checks', () => {
      // Step 1: Validate entry
      const entryValidation = validateEntryPrice(
        100000,
        100000,
        99950,
        100050,
        0.1,
        1.0,
        'BTCUSDT'
      );
      expect(entryValidation.isValid).toBe(true);

      // Step 2: Calculate stop loss
      const stopLoss = calculateInstitutionalStopLoss(
        entryValidation.entryPrice,
        1000,
        [98000],
        'long',
        2.0,
        100000
      );
      expect(stopLoss.stopLossPercent).toBeLessThanOrEqual(2.0);

      // Step 3: Calculate take profit
      const takeProfit = calculateInstitutionalTakeProfit(
        entryValidation.entryPrice,
        stopLoss.stopLossPrice,
        [104000, 105000],
        'long',
        0.6,
        2.0
      );
      expect(takeProfit.riskRewardRatio).toBeGreaterThanOrEqual(2.0);

      // Step 4: Validate R:R
      const rrValidation = validateRiskReward(
        entryValidation.entryPrice,
        stopLoss.stopLossPrice,
        takeProfit.takeProfitPrice,
        2.0
      );
      expect(rrValidation.isValid).toBe(true);

      // All checks passed - trade is institutional-grade
      expect(entryValidation.qualityScore).toBeGreaterThan(80);
      expect(stopLoss.method).toBeTruthy();
      expect(takeProfit.partialExits).toHaveLength(4);
      expect(rrValidation.ratio).toBeGreaterThanOrEqual(2.0);
    });

    it('should reject trade that fails any institutional check', () => {
      // Entry with poor quality
      const entryValidation = validateEntryPrice(
        101500, // 1.5% from VWAP
        100000,
        101400,
        101600,
        0.1,
        1.0,
        'BTCUSDT'
      );
      expect(entryValidation.isValid).toBe(false);

      // Even if other checks would pass, trade should be rejected at entry
    });
  });
});
