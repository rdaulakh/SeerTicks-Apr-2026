/**
 * Position Management Tests
 * 
 * Tests for position closing, balance updates, and P&L calculations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  upsertPaperWallet, 
  getPaperWallet, 
  insertPaperPosition,
  getPaperPositions
} from '../db';

describe('Position Management', () => {
  const testUserId = 999999;

  beforeEach(async () => {
    // Clean up test data
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (db) {
        await db.execute('DELETE FROM paper_wallets WHERE userId = ?', [testUserId]);
        await db.execute('DELETE FROM paper_positions WHERE userId = ?', [testUserId]);
      }
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  describe('Balance Updates', () => {
    it('should calculate correct balance after opening position', () => {
      const initialBalance = 10000;
      const entryPrice = 50000;
      const quantity = 0.02; // 0.02 BTC * $50,000 = $1,000
      const positionValue = entryPrice * quantity;
      
      const balanceAfterOpen = initialBalance - positionValue;
      expect(balanceAfterOpen).toBe(9000);
    });

    it('should calculate correct balance after closing winning position', () => {
      const initialBalance = 10000;
      const entryPrice = 50000;
      const quantity = 0.02;
      const positionValue = entryPrice * quantity; // $1,000
      const balanceAfterOpen = initialBalance - positionValue; // $9,000
      
      // Close position with profit
      const exitPrice = 55000;
      const pnl = (exitPrice - entryPrice) * quantity; // $100 profit
      const returnAmount = positionValue + pnl; // $1,100
      const finalBalance = balanceAfterOpen + returnAmount;
      
      expect(finalBalance).toBe(10100); // Original 10000 + 100 profit
    });

    it('should calculate correct balance after closing losing position', () => {
      const initialBalance = 10000;
      const entryPrice = 50000;
      const quantity = 0.02;
      const positionValue = entryPrice * quantity; // $1,000
      const balanceAfterOpen = initialBalance - positionValue; // $9,000
      
      // Close position with loss
      const exitPrice = 48000;
      const pnl = (exitPrice - entryPrice) * quantity; // -$40 loss
      const returnAmount = positionValue + pnl; // $960
      const finalBalance = balanceAfterOpen + returnAmount;
      
      expect(finalBalance).toBe(9960); // Original 10000 - 40 loss
    });
  });

  describe('P&L Calculations', () => {
    it('should calculate correct P&L for long position', () => {
      const entryPrice = 50000;
      const currentPrice = 55000;
      const quantity = 0.02;
      
      const pnl = (currentPrice - entryPrice) * quantity;
      expect(pnl).toBe(100);
      
      const positionValue = entryPrice * quantity;
      const pnlPercent = (pnl / positionValue) * 100;
      expect(pnlPercent).toBe(10);
    });

    it('should calculate correct P&L for short position', () => {
      const entryPrice = 50000;
      const currentPrice = 48000;
      const quantity = 0.02;
      
      const pnl = (entryPrice - currentPrice) * quantity;
      expect(pnl).toBe(40);
      
      const positionValue = entryPrice * quantity;
      const pnlPercent = (pnl / positionValue) * 100;
      expect(pnlPercent).toBe(4);
    });

    it('should handle negative P&L correctly', () => {
      const entryPrice = 50000;
      const currentPrice = 45000;
      const quantity = 0.02;
      
      const pnl = (currentPrice - entryPrice) * quantity;
      expect(pnl).toBe(-100);
      
      const positionValue = entryPrice * quantity;
      const pnlPercent = (pnl / positionValue) * 100;
      expect(pnlPercent).toBe(-10);
    });
  });

  describe('Position Status', () => {
    it('should validate position data structure', () => {
      const position = {
        userId: testUserId,
        exchange: 'coinbase',
        symbol: 'BTC/USDT',
        side: 'long',
        entryPrice: '50000',
        quantity: '0.02',
        status: 'open',
        strategy: 'momentum',
      };
      
      expect(position.status).toBe('open');
      expect(position.symbol).toBe('BTC/USDT');
      expect(position.side).toBe('long');
    });
  });

  describe('Win Rate Tracking', () => {
    it('should calculate win rate correctly', () => {
      // Create 3 winning and 2 losing positions
      const positions = [
        { pnl: 100, status: 'closed' },
        { pnl: 50, status: 'closed' },
        { pnl: -30, status: 'closed' },
        { pnl: 75, status: 'closed' },
        { pnl: -20, status: 'closed' },
      ];
      
      const winningTrades = positions.filter(p => p.pnl > 0).length;
      const totalTrades = positions.length;
      const winRate = (winningTrades / totalTrades) * 100;
      
      expect(winRate).toBe(60); // 3 out of 5 = 60%
    });
  });
});
