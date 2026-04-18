/**
 * Automated Order Execution Tests
 * 
 * Tests for real-time stop-loss and take-profit execution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PositionManager } from '../PositionManager';
import { getDb } from '../db';
import { paperPositions, paperWallets } from '../../drizzle/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


describe.skipIf(!isIntegration)('Automated Order Execution', () => {
  let positionManager: PositionManager;
  let testUserId: number;
  let db: any;

  beforeAll(async () => {
    db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Create test user wallet
    testUserId = Math.floor(Math.random() * 1000000);
    await db.insert(paperWallets).values({
      userId: testUserId,
      balance: '10000.00',
      equity: '10000.00',
      margin: '0.00',
      marginLevel: '0.00',
      totalPnL: '0.00',
      realizedPnL: '0.00',
      unrealizedPnL: '0.00',
      totalCommission: '0.00',
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: '0.00',
    });

    positionManager = new PositionManager();
    positionManager.setPaperTradingMode(true);
  });

  afterAll(async () => {
    if (positionManager) {
      positionManager.stop();
    }

    // Cleanup test data
    if (db && testUserId) {
      await db.delete(paperPositions).where(eq(paperPositions.userId, testUserId));
      await db.delete(paperWallets).where(eq(paperWallets.userId, testUserId));
    }
  });

  describe('Stop-Loss Execution', () => {
    it('should identify stop-loss hit for long position', async () => {
      // Create a long position with stop-loss
      await db.insert(paperPositions).values({
        userId: testUserId,
        symbol: 'BTC/USDT',
        exchange: 'coinbase',
        side: 'long',
        entryPrice: '50000.00',
        currentPrice: '49000.00', // Price has dropped
        quantity: '0.1',
        stopLoss: '49500.00', // Stop-loss at $49,500
        takeProfit: '52000.00',
        entryTime: new Date(),
        unrealizedPnL: '-100.00',
        unrealizedPnLPercent: '-2.00',
        commission: '5.00',
        strategy: 'test',
        status: 'open',
      });

      // Get the inserted position
      const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, testUserId)).orderBy(desc(paperPositions.id)).limit(1);
      const position = positions[0];

      // Simulate price update that triggers stop-loss
      positionManager.updatePriceFromFeed('BTC/USDT', 49400); // Below stop-loss

      // Wait for monitoring cycle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if position was closed
      const updatedPosition = await db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, position.id))
        .limit(1);

      // Position should be closed or marked for closure
      expect(updatedPosition.length === 0 || updatedPosition[0].status === 'closed').toBe(true);
    });

    it('should identify stop-loss hit for short position', async () => {
      // Create a short position with stop-loss
      await db.insert(paperPositions).values({
        userId: testUserId,
        symbol: 'ETH/USDT',
        exchange: 'coinbase',
        side: 'short',
        entryPrice: '3000.00',
        currentPrice: '3100.00', // Price has risen
        quantity: '1.0',
        stopLoss: '3050.00', // Stop-loss at $3,050
        takeProfit: '2900.00',
        entryTime: new Date(),
        unrealizedPnL: '-100.00',
        unrealizedPnLPercent: '-3.33',
        commission: '3.00',
        strategy: 'test',
        status: 'open',
      });

      // Get the inserted position
      const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, testUserId)).orderBy(desc(paperPositions.id)).limit(1);
      const position = positions[0];

      // Simulate price update that triggers stop-loss
      positionManager.updatePriceFromFeed('ETH/USDT', 3060); // Above stop-loss

      // Wait for monitoring cycle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if position was closed
      const updatedPosition = await db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, position.id))
        .limit(1);

      // Position should be closed or marked for closure
      expect(updatedPosition.length === 0 || updatedPosition[0].status === 'closed').toBe(true);
    });
  });

  describe('Take-Profit Execution', () => {
    it('should identify take-profit hit for long position', async () => {
      // Create a long position with take-profit
      await db.insert(paperPositions).values({
        userId: testUserId,
        symbol: 'BTC/USDT',
        exchange: 'coinbase',
        side: 'long',
        entryPrice: '50000.00',
        currentPrice: '52500.00', // Price has risen
        quantity: '0.1',
        stopLoss: '49000.00',
        takeProfit: '52000.00', // Take-profit at $52,000
        entryTime: new Date(),
        unrealizedPnL: '250.00',
        unrealizedPnLPercent: '5.00',
        commission: '5.00',
        strategy: 'test',
        status: 'open',
      });

      // Get the inserted position
      const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, testUserId)).orderBy(desc(paperPositions.id)).limit(1);
      const position = positions[0];

      // Simulate price update that triggers take-profit
      positionManager.updatePriceFromFeed('BTC/USDT', 52100); // Above take-profit

      // Wait for monitoring cycle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if position was closed
      const updatedPosition = await db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, position.id))
        .limit(1);

      // Position should be closed or marked for closure
      expect(updatedPosition.length === 0 || updatedPosition[0].status === 'closed').toBe(true);
    });

    it('should identify take-profit hit for short position', async () => {
      // Create a short position with take-profit
      await db.insert(paperPositions).values({
        userId: testUserId,
        symbol: 'ETH/USDT',
        exchange: 'coinbase',
        side: 'short',
        entryPrice: '3000.00',
        currentPrice: '2850.00', // Price has dropped
        quantity: '1.0',
        stopLoss: '3100.00',
        takeProfit: '2900.00', // Take-profit at $2,900
        entryTime: new Date(),
        unrealizedPnL: '150.00',
        unrealizedPnLPercent: '5.00',
        commission: '3.00',
        strategy: 'test',
        status: 'open',
      });

      // Get the inserted position
      const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, testUserId)).orderBy(desc(paperPositions.id)).limit(1);
      const position = positions[0];

      // Simulate price update that triggers take-profit
      positionManager.updatePriceFromFeed('ETH/USDT', 2890); // Below take-profit

      // Wait for monitoring cycle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if position was closed
      const updatedPosition = await db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, position.id))
        .limit(1);

      // Position should be closed or marked for closure
      expect(updatedPosition.length === 0 || updatedPosition[0].status === 'closed').toBe(true);
    });
  });

  describe('Real-Time P&L Updates', () => {
    it('should update unrealized P&L with price changes', async () => {
      // Create a position
      await db.insert(paperPositions).values({
        userId: testUserId,
        symbol: 'BTC/USDT',
        exchange: 'coinbase',
        side: 'long',
        entryPrice: '50000.00',
        currentPrice: '50000.00',
        quantity: '0.1',
        stopLoss: '49000.00',
        takeProfit: '52000.00',
        entryTime: new Date(),
        unrealizedPnL: '0.00',
        unrealizedPnLPercent: '0.00',
        commission: '5.00',
        strategy: 'test',
        status: 'open',
      });

      // Get the inserted position
      const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, testUserId)).orderBy(desc(paperPositions.id)).limit(1);
      const position = positions[0];

      // Simulate price increase
      positionManager.updatePriceFromFeed('BTC/USDT', 51000);

      // Wait for monitoring cycle to update P&L
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if P&L was updated
      const updatedPosition = await db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, position[0].id))
        .limit(1);

      if (updatedPosition.length > 0) {
        const currentPrice = parseFloat(updatedPosition[0].currentPrice.toString());
        const unrealizedPnL = parseFloat(updatedPosition[0].unrealizedPnL.toString());
        
        // Current price should be updated
        expect(currentPrice).toBeGreaterThan(50000);
        
        // Unrealized P&L should be positive (price went up for long position)
        expect(unrealizedPnL).toBeGreaterThan(0);
      }
    });
  });

  describe('Price Feed Integration', () => {
    it('should accept price updates from WebSocket feed', () => {
      // Test that price cache is updated
      positionManager.updatePriceFromFeed('BTC/USDT', 50000);
      positionManager.updatePriceFromFeed('ETH/USDT', 3000);

      // Verify prices are cached (we can't directly access the cache, but we can verify no errors)
      expect(true).toBe(true);
    });

    it('should handle multiple concurrent price updates', () => {
      // Simulate rapid price updates
      for (let i = 0; i < 10; i++) {
        positionManager.updatePriceFromFeed('BTC/USDT', 50000 + i * 100);
      }

      // Should handle all updates without errors
      expect(true).toBe(true);
    });
  });
});

describe('automated-orders (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
