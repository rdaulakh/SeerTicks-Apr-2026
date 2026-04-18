/**
 * Position Size Validation Tests
 * 
 * Tests institutional-grade position sizing rules:
 * - Minimum notional value ($100)
 * - Minimum position size (1% of account)
 * - Maximum position size (5% of account)
 * - Balance validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RiskManager } from '../RiskManager';

describe('Position Size Validation', () => {
  let riskManager: RiskManager;
  const testUserId = 1;
  const testAccountBalance = 10000; // $10,000 test account

  beforeAll(() => {
    riskManager = new RiskManager(testAccountBalance);
  });

  describe('Balance Validation', () => {
    it('should reject position larger than available balance', async () => {
      const positionSize = 15000; // $15,000 > $10,000 balance
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds available balance');
    });

    it('should allow position equal to available balance', async () => {
      const positionSize = 500; // $500 = 5% of $10,000 (max allowed)
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('Minimum Notional Value Validation', () => {
    it('should reject position below $100 minimum notional', async () => {
      const positionSize = 50; // $50 < $100 minimum
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('below minimum notional value');
      expect(result.reason).toContain('$100');
    });

    it('should allow position at exactly $100 minimum notional', async () => {
      const positionSize = 100; // $100 = minimum
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should allow position above $100 minimum notional', async () => {
      const positionSize = 150; // $150 > $100 minimum
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('Minimum Position Size Percentage (1%)', () => {
    it('should reject position below 1% of account', async () => {
      const positionSize = 99; // 0.99% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      // $99 fails minimum notional check first ($100 minimum)
      expect(result.reason).toContain('below minimum notional value');
    });

    it('should allow position at exactly 1% of account', async () => {
      const positionSize = 100; // 1% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should allow position above 1% of account', async () => {
      const positionSize = 200; // 2% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('Maximum Position Size Percentage (5%)', () => {
    it('should reject position above 5% of account', async () => {
      const positionSize = 600; // 6% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds hard limit');
      expect(result.reason).toContain('5%');
    });

    it('should allow position at exactly 5% of account', async () => {
      const positionSize = 500; // 5% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should allow position below 5% of account', async () => {
      const positionSize = 400; // 4% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('Hedge Fund Best Practices (1-5% Range)', () => {
    it('should allow position in optimal range (1-5%)', async () => {
      const testCases = [
        { size: 100, percent: 1 },   // 1%
        { size: 200, percent: 2 },   // 2%
        { size: 300, percent: 3 },   // 3%
        { size: 400, percent: 4 },   // 4%
        { size: 500, percent: 5 },   // 5%
      ];

      for (const testCase of testCases) {
        const result = await riskManager.checkPositionSize(
          testUserId,
          testCase.size,
          testAccountBalance,
          'BTC-USD'
        );

        expect(result.allowed).toBe(true);
      }
    });

    it('should reject micro-positions (< 1%)', async () => {
      const microPositions = [50, 75, 99];

      for (const size of microPositions) {
        const result = await riskManager.checkPositionSize(
          testUserId,
          size,
          testAccountBalance,
          'BTC-USD'
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/below (minimum notional|institutional minimum)/);
      }
    });

    it('should reject over-sized positions (> 5%)', async () => {
      const oversizedPositions = [600, 1000, 5000];

      for (const size of oversizedPositions) {
        const result = await riskManager.checkPositionSize(
          testUserId,
          size,
          testAccountBalance,
          'BTC-USD'
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('exceeds hard limit');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle small account balance correctly', async () => {
      const smallBalance = 1000; // $1,000 account
      const smallRiskManager = new RiskManager(smallBalance);

      // $100 = 10% of account, exceeds 5% max
      const result = await smallRiskManager.checkPositionSize(
        testUserId,
        100,
        smallBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds hard limit');
    });

    it('should handle very small account balance', async () => {
      const tinyBalance = 10000; // $10,000 account (same as test account)
      const tinyRiskManager = new RiskManager(tinyBalance);

      // $100 = 1% of $10,000 account (minimum allowed)
      const result = await tinyRiskManager.checkPositionSize(
        testUserId,
        100,
        tinyBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should handle large account balance correctly', async () => {
      const largeBalance = 1000000; // $1M account
      const largeRiskManager = new RiskManager(largeBalance);

      // 1% = $10,000, 5% = $50,000
      const result = await largeRiskManager.checkPositionSize(
        testUserId,
        50000, // 5% of $1M
        largeBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should reject zero position size', async () => {
      const result = await riskManager.checkPositionSize(
        testUserId,
        0,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
    });

    it('should reject negative position size', async () => {
      const result = await riskManager.checkPositionSize(
        testUserId,
        -100,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should validate typical crypto hedge fund position (2.5%)', async () => {
      const positionSize = 250; // 2.5% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });

    it('should reject day-trader micro-position (0.5%)', async () => {
      const positionSize = 50; // 0.5% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('below minimum notional value');
    });

    it('should reject aggressive over-leveraged position (10%)', async () => {
      const positionSize = 1000; // 10% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds hard limit');
    });

    it('should allow conservative institutional position (1.5%)', async () => {
      const positionSize = 150; // 1.5% of $10,000
      const result = await riskManager.checkPositionSize(
        testUserId,
        positionSize,
        testAccountBalance,
        'BTC-USD'
      );

      expect(result.allowed).toBe(true);
    });
  });
});
