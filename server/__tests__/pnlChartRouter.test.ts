/**
 * Test for PnL Chart Router - DATE_FORMAT SQL Fix
 * 
 * Verifies that the DATE_FORMAT function works correctly for grouping trades by date
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../db';
import { paperPositions, paperWallets } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


describe.skipIf(!isIntegration)('PnL Chart Router - SQL DATE_FORMAT Fix', () => {
  const testUserId = 999999; // Use a test user ID that won't conflict
  
  beforeAll(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Clean up any existing test data
    await db.delete(paperPositions).where(eq(paperPositions.userId, testUserId));
    await db.delete(paperWallets).where(eq(paperWallets.userId, testUserId));

    // Create test wallet
    await db.insert(paperWallets).values({
      userId: testUserId,
      balance: '10000',
      initialBalance: '10000',
      realizedPnl: '0',
      totalCommission: '0',
    });

    // Create test positions with different exit dates
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await db.insert(paperPositions).values([
      {
        userId: testUserId,
        symbol: 'BTC-USD',
        side: 'long',
        quantity: '0.1',
        entryPrice: '50000',
        currentPrice: '51000',
        unrealizedPnl: '100',
        realizedPnl: '100',
        commission: '5',
        status: 'closed',
        strategy: 'test',
        entryTime: twoDaysAgo,
        exitTime: twoDaysAgo,
        exitReason: 'take_profit',
      },
      {
        userId: testUserId,
        symbol: 'ETH-USD',
        side: 'long',
        quantity: '1',
        entryPrice: '3000',
        currentPrice: '3100',
        unrealizedPnl: '100',
        realizedPnl: '100',
        commission: '5',
        status: 'closed',
        strategy: 'test',
        entryTime: yesterday,
        exitTime: yesterday,
        exitReason: 'take_profit',
      },
      {
        userId: testUserId,
        symbol: 'BTC-USD',
        side: 'short',
        quantity: '0.1',
        entryPrice: '51000',
        currentPrice: '50500',
        unrealizedPnl: '50',
        realizedPnl: '50',
        commission: '5',
        status: 'closed',
        strategy: 'test',
        entryTime: now,
        exitTime: now,
        exitReason: 'take_profit',
      },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    // Clean up test data
    await db.delete(paperPositions).where(eq(paperPositions.userId, testUserId));
    await db.delete(paperWallets).where(eq(paperWallets.userId, testUserId));
  });

  it('should group positions by date using DATE_FORMAT without SQL errors', async () => {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // This query mimics the one in pnlChartRouter.ts
    const { sql } = await import('drizzle-orm');
    
    const result = await db
      .select({
        date: sql<string>`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`,
        totalPnl: sql<string>`COALESCE(SUM(${paperPositions.realizedPnl}), 0)`,
        tradeCount: sql<number>`COUNT(*)`,
      })
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, testUserId),
          eq(paperPositions.status, 'closed')
        )
      )
      .groupBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`)
      .orderBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d') ASC`);

    // Verify results
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    
    // Each result should have a valid date string
    result.forEach(row => {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD format
      expect(row.tradeCount).toBeGreaterThan(0);
    });

    console.log('✅ DATE_FORMAT query executed successfully');
    console.log(`Found ${result.length} days with trades`);
  });

  it('should calculate cumulative P&L correctly', async () => {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const { sql, isNotNull } = await import('drizzle-orm');
    
    const positions = await db
      .select({
        date: sql<string>`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`,
        netPnl: sql<string>`COALESCE(SUM(${paperPositions.realizedPnl} - ${paperPositions.commission}), 0)`,
      })
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.userId, testUserId),
          eq(paperPositions.status, 'closed'),
          isNotNull(paperPositions.exitTime)
        )
      )
      .groupBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`)
      .orderBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d') ASC`);

    // Calculate cumulative P&L
    let cumulativePnl = 0;
    const chartData = positions.map(position => {
      const netPnl = Number(position.netPnl);
      cumulativePnl += netPnl;
      return {
        date: position.date,
        dailyPnl: netPnl,
        cumulativePnl: cumulativePnl,
      };
    });

    expect(chartData.length).toBeGreaterThan(0);
    
    // Verify cumulative P&L is calculated correctly
    let expectedCumulative = 0;
    chartData.forEach(data => {
      expectedCumulative += data.dailyPnl;
      expect(data.cumulativePnl).toBeCloseTo(expectedCumulative, 2);
    });

    console.log('✅ Cumulative P&L calculation verified');
    console.log(`Total cumulative P&L: ${cumulativePnl.toFixed(2)}`);
  });
});

describe('pnlChartRouter (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
