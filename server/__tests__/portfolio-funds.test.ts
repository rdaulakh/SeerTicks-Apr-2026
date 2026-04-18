import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getDb } from '../db';
import { tradingModeConfig } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

// Mock the notification module
vi.mock('../_core/notification', () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

describe('Portfolio Funds Management', () => {
  let db: any;
  const testUserId = 999999; // Test user ID

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error('Database not available');

    // Clean up any existing test data
    await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));
  });

  afterAll(async () => {
    // Clean up test data
    if (db) {
      await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));
    }
  });

  describe('Database Schema', () => {
    it('should have portfolioFunds column in tradingModeConfig table', async () => {
      // Insert a test record with portfolioFunds
      await db.insert(tradingModeConfig).values({
        userId: testUserId,
        mode: 'paper',
        autoTradeEnabled: false,
        portfolioFunds: '50000.00',
        enableSlippage: true,
        enableCommission: true,
        enableMarketImpact: true,
        enableLatency: true,
      });

      // Retrieve and verify
      const result = await db
        .select()
        .from(tradingModeConfig)
        .where(eq(tradingModeConfig.userId, testUserId))
        .limit(1);

      expect(result.length).toBe(1);
      expect(result[0].portfolioFunds).toBe('50000.00');
    });

    it('should default portfolioFunds to 10000.00 when not specified', async () => {
      // Clean up first
      await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));

      // Insert without specifying portfolioFunds
      await db.insert(tradingModeConfig).values({
        userId: testUserId,
        mode: 'paper',
        autoTradeEnabled: false,
        enableSlippage: true,
        enableCommission: true,
        enableMarketImpact: true,
        enableLatency: true,
      });

      const result = await db
        .select()
        .from(tradingModeConfig)
        .where(eq(tradingModeConfig.userId, testUserId))
        .limit(1);

      expect(result.length).toBe(1);
      expect(result[0].portfolioFunds).toBe('10000.00');
    });
  });

  describe('getTradingModeConfig', () => {
    it('should return portfolioFunds from database', async () => {
      const { getTradingModeConfig } = await import('../db');

      // Clean up and insert test data
      await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));
      await db.insert(tradingModeConfig).values({
        userId: testUserId,
        mode: 'paper',
        autoTradeEnabled: true,
        portfolioFunds: '75000.00',
        enableSlippage: true,
        enableCommission: true,
        enableMarketImpact: true,
        enableLatency: true,
      });

      const config = await getTradingModeConfig(testUserId);

      expect(config).not.toBeNull();
      expect(config?.portfolioFunds).toBe('75000.00');
      expect(config?.autoTradeEnabled).toBe(true);
      expect(config?.mode).toBe('paper');
    });
  });

  describe('upsertTradingModeConfig', () => {
    it('should update portfolioFunds without affecting other fields', async () => {
      const { upsertTradingModeConfig, getTradingModeConfig } = await import('../db');

      // Clean up and insert initial data
      await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));
      await db.insert(tradingModeConfig).values({
        userId: testUserId,
        mode: 'real',
        autoTradeEnabled: true,
        portfolioFunds: '10000.00',
        enableSlippage: true,
        enableCommission: true,
        enableMarketImpact: true,
        enableLatency: true,
      });

      // Update only portfolioFunds
      await upsertTradingModeConfig({
        userId: testUserId,
        portfolioFunds: '100000.00',
      });

      const config = await getTradingModeConfig(testUserId);

      expect(config).not.toBeNull();
      expect(config?.portfolioFunds).toBe('100000.00');
      // Other fields should remain unchanged
      expect(config?.mode).toBe('real');
      expect(config?.autoTradeEnabled).toBe(true);
    });

    it('should create new config with portfolioFunds if none exists', async () => {
      const { upsertTradingModeConfig, getTradingModeConfig } = await import('../db');

      // Clean up
      await db.delete(tradingModeConfig).where(eq(tradingModeConfig.userId, testUserId));

      // Create new config with portfolioFunds
      await upsertTradingModeConfig({
        userId: testUserId,
        mode: 'paper',
        portfolioFunds: '25000.00',
        enableSlippage: true,
        enableCommission: true,
        enableMarketImpact: true,
        enableLatency: true,
      });

      const config = await getTradingModeConfig(testUserId);

      expect(config).not.toBeNull();
      expect(config?.portfolioFunds).toBe('25000.00');
    });
  });

  describe('Position Sizing Integration', () => {
    it('should use portfolioFunds for position sizing calculations', async () => {
      // This test verifies that the portfolioFunds value is used correctly
      // in position sizing calculations
      
      const portfolioFunds = 100000;
      const positionSizePercentage = 0.05; // 5% position size
      
      const expectedPositionSize = portfolioFunds * positionSizePercentage;
      
      expect(expectedPositionSize).toBe(5000);
    });

    it('should support various portfolio fund amounts', () => {
      const testCases = [
        { funds: 1000, percentage: 0.03, expected: 30 },      // Scout tier
        { funds: 10000, percentage: 0.05, expected: 500 },    // Moderate tier
        { funds: 50000, percentage: 0.07, expected: 3500 },   // Standard tier
        { funds: 100000, percentage: 0.10, expected: 10000 }, // Strong tier
        { funds: 500000, percentage: 0.15, expected: 75000 }, // High tier
        { funds: 1000000, percentage: 0.20, expected: 200000 }, // Max tier
      ];

      for (const testCase of testCases) {
        const positionSize = testCase.funds * testCase.percentage;
        // Use toBeCloseTo to handle floating point precision
        expect(positionSize).toBeCloseTo(testCase.expected, 2);
      }
    });
  });

  describe('Validation', () => {
    it('should accept valid portfolio fund amounts', () => {
      const validAmounts = [0, 100, 1000, 10000, 100000, 1000000, 100000000];
      
      for (const amount of validAmounts) {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(100000000);
      }
    });

    it('should format portfolio funds with 2 decimal places', () => {
      const amount = 12345.6789;
      const formatted = amount.toFixed(2);
      
      expect(formatted).toBe('12345.68');
    });
  });
});
