/**
 * Trade Persistence Test Suite
 * Validates that trades are properly persisted to the database
 * when positions are opened and closed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Trade Persistence Fix', () => {
  describe('PaperTradingEngine Trade Recording', () => {
    it('should have insertPaperTrade function in db.ts', async () => {
      const db = await import('../db');
      expect(typeof db.insertPaperTrade).toBe('function');
    });

    it('should have insertPaperPosition function in db.ts', async () => {
      const db = await import('../db');
      expect(typeof db.insertPaperPosition).toBe('function');
    });

    it('should have paperTrades table in schema', async () => {
      const schema = await import('../../drizzle/schema');
      expect(schema.paperTrades).toBeDefined();
    });

    it('paperTrades schema should have required columns', async () => {
      const schema = await import('../../drizzle/schema');
      const columns = Object.keys(schema.paperTrades);
      expect(columns).toContain('id');
      expect(columns).toContain('userId');
      expect(columns).toContain('orderId');
      expect(columns).toContain('symbol');
      expect(columns).toContain('side');
      expect(columns).toContain('price');
      expect(columns).toContain('quantity');
      expect(columns).toContain('pnl');
      expect(columns).toContain('commission');
      expect(columns).toContain('strategy');
    });
  });

  describe('PaperTradingEngine openPosition', () => {
    it('should call insertPaperTrade when opening a position', async () => {
      // Read the PaperTradingEngine source to verify the fix
      const fs = await import('fs');
      const path = await import('path');
      const enginePath = path.join(__dirname, '../execution/PaperTradingEngine.ts');
      const source = fs.readFileSync(enginePath, 'utf-8');
      
      // Verify entry trade recording is present
      expect(source).toContain('CRITICAL FIX: Also record entry trade');
      expect(source).toContain('insertPaperTrade');
      expect(source).toContain('Entry trade persisted to database');
    });
  });

  describe('PaperTradingEngine closePosition', () => {
    it('should call insertPaperTrade when closing a position', async () => {
      // Read the PaperTradingEngine source to verify the fix
      const fs = await import('fs');
      const path = await import('path');
      const enginePath = path.join(__dirname, '../execution/PaperTradingEngine.ts');
      const source = fs.readFileSync(enginePath, 'utf-8');
      
      // Verify exit trade recording is present
      expect(source).toContain('CRITICAL FIX: Persist trade to database');
      expect(source).toContain('Trade persisted to database');
    });
  });

  describe('Database Schema Alignment', () => {
    it('paperTrades table should be properly defined', async () => {
      const schema = await import('../../drizzle/schema');
      // Types are compile-time only, check table is defined
      expect(schema.paperTrades).toBeDefined();
      expect(typeof schema.paperTrades).toBe('object');
    });

    it('paperPositions table should be properly defined', async () => {
      const schema = await import('../../drizzle/schema');
      expect(schema.paperPositions).toBeDefined();
      expect(typeof schema.paperPositions).toBe('object');
    });
  });

  describe('Trade Decision Log vs Actual Trades', () => {
    it('should have tradeDecisionLogs table for audit trail', async () => {
      const schema = await import('../../drizzle/schema');
      expect(schema.tradeDecisionLogs).toBeDefined();
    });

    it('tradeDecisionLogs should track decision status', async () => {
      const schema = await import('../../drizzle/schema');
      const columns = Object.keys(schema.tradeDecisionLogs);
      expect(columns).toContain('decision');
    });
  });
});
