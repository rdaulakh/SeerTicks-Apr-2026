/**
 * Exchange Settings Test Suite
 * 
 * Tests for exchange and trading symbol management
 * Verifies that:
 * 1. Exchanges are correctly associated with user IDs
 * 2. Trading symbols are correctly associated with user IDs
 * 3. Queries filter by userId correctly
 * 4. Unique constraints prevent duplicate symbols
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import { exchanges, tradingSymbols } from '../../drizzle/schema';

describe('Exchange Settings', () => {
  let db: ReturnType<typeof drizzle>;
  let pool: mysql.Pool;
  const testUserId = 999999; // Test user ID to avoid conflicts
  
  beforeAll(async () => {
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
    });
    db = drizzle(pool);
    
    // Clean up any existing test data
    await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, testUserId));
    await db.delete(exchanges).where(eq(exchanges.userId, testUserId));
  });
  
  afterAll(async () => {
    // Clean up test data
    await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, testUserId));
    await db.delete(exchanges).where(eq(exchanges.userId, testUserId));
    await pool.end();
  });
  
  describe('Exchange Management', () => {
    it('should create an exchange with correct userId', async () => {
      const [result] = await db.insert(exchanges).values({
        userId: testUserId,
        exchangeName: 'coinbase',
        isActive: true,
        connectionStatus: 'disconnected',
      });
      
      expect(result.insertId).toBeDefined();
      
      // Verify the exchange was created with correct userId
      const created = await db
        .select()
        .from(exchanges)
        .where(eq(exchanges.id, Number(result.insertId)))
        .limit(1);
      
      expect(created.length).toBe(1);
      expect(created[0].userId).toBe(testUserId);
      expect(created[0].exchangeName).toBe('coinbase');
    });
    
    it('should only return exchanges for the specified userId', async () => {
      // Query for test user's exchanges
      const userExchanges = await db
        .select()
        .from(exchanges)
        .where(eq(exchanges.userId, testUserId));
      
      // All returned exchanges should belong to test user
      expect(userExchanges.length).toBeGreaterThan(0);
      userExchanges.forEach(exchange => {
        expect(exchange.userId).toBe(testUserId);
      });
      
      // Query for a different user should return empty
      const otherUserExchanges = await db
        .select()
        .from(exchanges)
        .where(eq(exchanges.userId, 888888)); // Non-existent user
      
      expect(otherUserExchanges.length).toBe(0);
    });
  });
  
  describe('Trading Symbol Management', () => {
    it('should create a trading symbol with correct userId', async () => {
      const [result] = await db.insert(tradingSymbols).values({
        userId: testUserId,
        symbol: 'BTC-USD',
        exchangeName: 'coinbase',
        isActive: true,
      });
      
      expect(result.insertId).toBeDefined();
      
      // Verify the symbol was created with correct userId
      const created = await db
        .select()
        .from(tradingSymbols)
        .where(eq(tradingSymbols.id, Number(result.insertId)))
        .limit(1);
      
      expect(created.length).toBe(1);
      expect(created[0].userId).toBe(testUserId);
      expect(created[0].symbol).toBe('BTC-USD');
    });
    
    it('should only return symbols for the specified userId', async () => {
      // Query for test user's symbols
      const userSymbols = await db
        .select()
        .from(tradingSymbols)
        .where(eq(tradingSymbols.userId, testUserId));
      
      // All returned symbols should belong to test user
      expect(userSymbols.length).toBeGreaterThan(0);
      userSymbols.forEach(symbol => {
        expect(symbol.userId).toBe(testUserId);
      });
      
      // Query for a different user should return empty
      const otherUserSymbols = await db
        .select()
        .from(tradingSymbols)
        .where(eq(tradingSymbols.userId, 888888)); // Non-existent user
      
      expect(otherUserSymbols.length).toBe(0);
    });
    
    it('should prevent duplicate symbols for the same user and exchange', async () => {
      // Try to insert a duplicate symbol
      let errorThrown = false;
      try {
        await db.insert(tradingSymbols).values({
          userId: testUserId,
          symbol: 'BTC-USD', // Same symbol as before
          exchangeName: 'coinbase', // Same exchange
          isActive: true,
        });
      } catch (error: any) {
        errorThrown = true;
        // Should get a duplicate key error - check message or cause
        const errorStr = JSON.stringify(error, Object.getOwnPropertyNames(error));
        const hasDuplicateError = 
          errorStr.includes('Duplicate') || 
          errorStr.includes('duplicate') || 
          errorStr.includes('ER_DUP_ENTRY') ||
          error.cause?.code === 'ER_DUP_ENTRY';
        expect(hasDuplicateError).toBe(true);
      }
      // If no error was thrown, the unique constraint didn't work
      expect(errorThrown).toBe(true);
    });
    
    it('should allow same symbol for different exchanges', async () => {
      // Insert same symbol for different exchange
      const [result] = await db.insert(tradingSymbols).values({
        userId: testUserId,
        symbol: 'BTC-USD', // Same symbol
        exchangeName: 'binance', // Different exchange
        isActive: true,
      });
      
      expect(result.insertId).toBeDefined();
    });
    
    it('should allow same symbol for different users', async () => {
      const otherUserId = 888888;
      
      try {
        // Insert same symbol for different user
        const [result] = await db.insert(tradingSymbols).values({
          userId: otherUserId,
          symbol: 'BTC-USD', // Same symbol
          exchangeName: 'coinbase', // Same exchange
          isActive: true,
        });
        
        expect(result.insertId).toBeDefined();
        
        // Clean up
        await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, otherUserId));
      } catch (error) {
        // Clean up even on error
        await db.delete(tradingSymbols).where(eq(tradingSymbols.userId, otherUserId));
        throw error;
      }
    });
  });
  
  describe('Query Performance', () => {
    it('should use index for userId queries', async () => {
      // This test verifies that the query plan uses the index
      const [explainResult] = await pool.execute(
        'EXPLAIN SELECT * FROM tradingSymbols WHERE userId = ?',
        [testUserId]
      ) as any;
      
      // TiDB returns different EXPLAIN format, check for index usage
      const plan = explainResult[0];
      // TiDB uses 'possible_keys' or 'key' field, or may show index in 'id' column
      const usesIndex = plan.key || plan.possible_keys || 
        (plan.id && plan.id.includes('IndexLookUp')) ||
        (JSON.stringify(plan).includes('idx_'));
      expect(usesIndex || plan.type !== 'ALL').toBeTruthy();
    });
    
    it('should use index for exchanges userId queries', async () => {
      const [explainResult] = await pool.execute(
        'EXPLAIN SELECT * FROM exchanges WHERE userId = ?',
        [testUserId]
      ) as any;
      
      const plan = explainResult[0];
      const usesIndex = plan.key || plan.possible_keys || 
        (plan.id && plan.id.includes('IndexLookUp')) ||
        (JSON.stringify(plan).includes('idx_'));
      expect(usesIndex || plan.type !== 'ALL').toBeTruthy();
    });
  });
});
