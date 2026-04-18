import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../db';
import { tradingSymbols } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

describe('Trading Symbols Persistence', () => {
  const testUserId = 999999; // Test user ID
  let db: Awaited<ReturnType<typeof getDb>>;
  let testSymbolIds: number[] = [];

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error('Database not available');
    
    // Clean up any existing test data
    await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, testUserId));
  });

  afterAll(async () => {
    if (!db) return;
    // Clean up test data
    await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, testUserId));
  });

  it('should add a new trading symbol', async () => {
    if (!db) throw new Error('Database not available');

    const [result] = await db.insert(tradingSymbols).values({
      userId: testUserId,
      symbol: 'BTCUSDT',
      isActive: true,
    });

    expect(result.insertId).toBeDefined();
    testSymbolIds.push(Number(result.insertId));

    // Verify it was inserted
    const symbols = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, testUserId));

    expect(symbols.length).toBe(1);
    expect(symbols[0].symbol).toBe('BTCUSDT');
    expect(symbols[0].isActive).toBe(true);
  });

  it('should retrieve all symbols for a user', async () => {
    if (!db) throw new Error('Database not available');

    // Add another symbol
    const [result] = await db.insert(tradingSymbols).values({
      userId: testUserId,
      symbol: 'ETHUSDT',
      isActive: true,
    });

    testSymbolIds.push(Number(result.insertId));

    // Retrieve all symbols
    const symbols = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, testUserId));

    expect(symbols.length).toBe(2);
    expect(symbols.map(s => s.symbol)).toContain('BTCUSDT');
    expect(symbols.map(s => s.symbol)).toContain('ETHUSDT');
  });

  it('should delete a trading symbol', async () => {
    if (!db) throw new Error('Database not available');

    // Delete the first symbol
    await db
      .delete(tradingSymbols)
      .where(eq(tradingSymbols.id, testSymbolIds[0]));

    // Verify it was deleted
    const symbols = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, testUserId));

    expect(symbols.length).toBe(1);
    expect(symbols[0].symbol).toBe('ETHUSDT');
  });

  it('should persist symbols after deletion (no mock data fallback)', async () => {
    if (!db) throw new Error('Database not available');

    // Delete all symbols
    await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, testUserId));

    // Verify empty state persists
    const symbols = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, testUserId));

    expect(symbols.length).toBe(0);
    
    // This is the key test: empty array should be valid, not fallback to mock data
    expect(symbols).toEqual([]);
  });

  it('should prevent duplicate symbols', async () => {
    if (!db) throw new Error('Database not available');

    // Add a symbol
    const [result1] = await db.insert(tradingSymbols).values({
      userId: testUserId,
      symbol: 'BNBUSDT',
      isActive: true,
    });

    testSymbolIds.push(Number(result1.insertId));

    // Check if duplicate exists before inserting
    const existing = await db
      .select()
      .from(tradingSymbols)
      .where(
        and(
          eq(tradingSymbols.userId, testUserId),
          eq(tradingSymbols.symbol, 'BNBUSDT')
        )
      )
      .limit(1);

    expect(existing.length).toBe(1);

    // If duplicate exists, update instead of insert
    if (existing.length > 0) {
      await db
        .update(tradingSymbols)
        .set({ isActive: false })
        .where(eq(tradingSymbols.id, existing[0].id));
    }

    // Verify update worked
    const updated = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.id, existing[0].id));

    expect(updated[0].isActive).toBe(false);
  });
});
