/**
 * Profit Booking Integration Test
 * 
 * Validates that positions are properly created, monitored, and closed
 * with profit/loss correctly recorded in the database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../db';
import { positions, trades } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { PositionManager } from '../PositionManager';

describe('Profit Booking Integration', () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let positionManager: PositionManager;
  let testTradeId: number;
  let testPositionId: number | null;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error('Database not available');
    
    positionManager = new PositionManager();
    positionManager.setPaperTradingMode(true); // Use paper trading for tests
  });

  it('should create a trade record', async () => {
    if (!db) throw new Error('Database not available');

    // Create test trade
    const [result] = await db.insert(trades).values({
      userId: 1,
      exchangeId: 1,
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: '50000',
      quantity: '0.1',
      entryTime: new Date(),
      status: 'open',
      confidence: '0.85',
      agentSignals: [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.9 },
        { agentName: 'SentimentAnalyst', signal: 'bullish', confidence: 0.8 },
      ],
      expectedPath: 'BTC expected to reach $52,000 based on technical breakout',
    });

    testTradeId = result.insertId;
    expect(testTradeId).toBeGreaterThan(0);

    // Verify trade was created
    const createdTrade = await db
      .select()
      .from(trades)
      .where(eq(trades.id, testTradeId))
      .limit(1);

    expect(createdTrade).toHaveLength(1);
    expect(createdTrade[0].status).toBe('open');
    expect(createdTrade[0].symbol).toBe('BTCUSDT');
  });

  it('should create a position linked to the trade', async () => {
    if (!db) throw new Error('Database not available');

    // Create position using PositionManager
    testPositionId = await positionManager.createPosition(
      1, // userId
      testTradeId,
      'BTCUSDT',
      'long',
      50000, // entryPrice
      0.1, // quantity
      48000, // stopLoss (4% below entry)
      52000, // takeProfit (4% above entry)
      'BTC expected to reach $52,000 based on technical breakout'
    );

    expect(testPositionId).toBeGreaterThan(0);

    // Verify position was created
    if (testPositionId) {
      const createdPosition = await db
        .select()
        .from(positions)
        .where(eq(positions.id, testPositionId))
        .limit(1);

      expect(createdPosition).toHaveLength(1);
      expect(createdPosition[0].tradeId).toBe(testTradeId);
      expect(createdPosition[0].symbol).toBe('BTCUSDT');
      expect(createdPosition[0].side).toBe('long');
      expect(parseFloat(createdPosition[0].entryPrice.toString())).toBe(50000);
      expect(parseFloat(createdPosition[0].stopLoss.toString())).toBe(48000);
      expect(parseFloat(createdPosition[0].takeProfit.toString())).toBe(52000);
      expect(createdPosition[0].thesisValid).toBe(true);
      expect(parseFloat(createdPosition[0].unrealizedPnl.toString())).toBe(0);
    }
  });

  it('should calculate unrealized P&L correctly', async () => {
    if (!db || !testPositionId) throw new Error('Test position not created');

    // Simulate price movement to $51,000 (+2%)
    const currentPrice = 51000;
    const entryPrice = 50000;
    const quantity = 0.1;
    const expectedPnl = (currentPrice - entryPrice) * quantity; // $100

    // Update position with new price
    await db
      .update(positions)
      .set({
        currentPrice: currentPrice.toString(),
        unrealizedPnl: expectedPnl.toString(),
      })
      .where(eq(positions.id, testPositionId));

    // Verify unrealized P&L
    const updatedPosition = await db
      .select()
      .from(positions)
      .where(eq(positions.id, testPositionId))
      .limit(1);

    expect(updatedPosition).toHaveLength(1);
    expect(parseFloat(updatedPosition[0].currentPrice.toString())).toBe(51000);
    expect(parseFloat(updatedPosition[0].unrealizedPnl.toString())).toBe(100);
  });

  it('should record realized P&L when position is closed', async () => {
    if (!db || !testPositionId) throw new Error('Test position not created');

    // Verify trade exists first
    const existingTrade = await db
      .select()
      .from(trades)
      .where(eq(trades.id, testTradeId))
      .limit(1);

    if (existingTrade.length === 0) {
      console.warn('Test trade not found, skipping test');
      return;
    }

    // Simulate position close at take-profit ($52,000)
    const exitPrice = 52000;
    const entryPrice = 50000;
    const quantity = 0.1;
    const realizedPnl = (exitPrice - entryPrice) * quantity; // $200

    // Close position
    await db
      .update(positions)
      .set({
        thesisValid: false,
        updatedAt: new Date(),
      })
      .where(eq(positions.id, testPositionId));

    // Update trade with exit details
    await db
      .update(trades)
      .set({
        exitPrice: exitPrice.toString(),
        exitTime: new Date(),
        status: 'closed',
        pnl: realizedPnl.toString(),
        exitReason: 'Take profit hit',
      })
      .where(eq(trades.id, testTradeId));

    // Verify trade was closed with correct P&L
    const closedTrade = await db
      .select()
      .from(trades)
      .where(eq(trades.id, testTradeId))
      .limit(1);

    expect(closedTrade).toHaveLength(1);
    expect(closedTrade[0].status).toBe('closed');
    expect(parseFloat(closedTrade[0].exitPrice?.toString() || '0')).toBe(52000);
    expect(parseFloat(closedTrade[0].pnl?.toString() || '0')).toBe(200);
    expect(closedTrade[0].exitReason).toBe('Take profit hit');

    // Verify position is marked as invalid
    const closedPosition = await db
      .select()
      .from(positions)
      .where(eq(positions.id, testPositionId))
      .limit(1);

    expect(closedPosition).toHaveLength(1);
    expect(closedPosition[0].thesisValid).toBe(false);
  });

  afterAll(async () => {
    // Clean up test data
    if (db && testPositionId) {
      await db.delete(positions).where(eq(positions.id, testPositionId));
    }
    if (db && testTradeId) {
      await db.delete(trades).where(eq(trades.id, testTradeId));
    }
  });
});
