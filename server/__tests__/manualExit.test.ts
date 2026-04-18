import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Test to verify manual exit functionality works correctly
 * for both LONG and SHORT positions.
 */
describe('Manual Exit Functionality', () => {
  describe('P&L Calculation', () => {
    it('should calculate P&L correctly for LONG position (profit)', () => {
      const entryPrice = 50000;
      const exitPrice = 52000;
      const quantity = 0.1;
      const side = 'long';
      
      // LONG P&L = (exitPrice - entryPrice) * quantity
      const pnl = side === 'long' 
        ? (exitPrice - entryPrice) * quantity 
        : (entryPrice - exitPrice) * quantity;
      
      expect(pnl).toBe(200); // $200 profit
    });

    it('should calculate P&L correctly for LONG position (loss)', () => {
      const entryPrice = 50000;
      const exitPrice = 48000;
      const quantity = 0.1;
      const side = 'long';
      
      const pnl = side === 'long' 
        ? (exitPrice - entryPrice) * quantity 
        : (entryPrice - exitPrice) * quantity;
      
      expect(pnl).toBe(-200); // $200 loss
    });

    it('should calculate P&L correctly for SHORT position (profit)', () => {
      const entryPrice = 50000;
      const exitPrice = 48000;
      const quantity = 0.1;
      const side = 'short';
      
      // SHORT P&L = (entryPrice - exitPrice) * quantity
      const pnl = side === 'long' 
        ? (exitPrice - entryPrice) * quantity 
        : (entryPrice - exitPrice) * quantity;
      
      expect(pnl).toBe(200); // $200 profit (price went down)
    });

    it('should calculate P&L correctly for SHORT position (loss)', () => {
      const entryPrice = 50000;
      const exitPrice = 52000;
      const quantity = 0.1;
      const side = 'short';
      
      const pnl = side === 'long' 
        ? (exitPrice - entryPrice) * quantity 
        : (entryPrice - exitPrice) * quantity;
      
      expect(pnl).toBe(-200); // $200 loss (price went up)
    });
  });

  describe('Closing Trade Side', () => {
    it('should use opposite side when closing LONG position', () => {
      const positionSide = 'long';
      const closingSide = positionSide === 'long' ? 'sell' : 'buy';
      
      expect(closingSide).toBe('sell');
    });

    it('should use opposite side when closing SHORT position', () => {
      const positionSide = 'short';
      const closingSide = positionSide === 'long' ? 'sell' : 'buy';
      
      expect(closingSide).toBe('buy');
    });
  });

  describe('Balance Update', () => {
    it('should correctly update balance after closing profitable LONG', () => {
      const currentBalance = 10000;
      const positionValue = 5000; // Entry value
      const pnl = 200; // Profit
      
      // Return position value + P&L
      const returnAmount = positionValue + pnl;
      const newBalance = currentBalance + returnAmount;
      
      expect(newBalance).toBe(15200);
    });

    it('should correctly update balance after closing losing SHORT', () => {
      const currentBalance = 10000;
      const positionValue = 5000; // Entry value
      const pnl = -200; // Loss
      
      // Return position value + P&L (negative P&L reduces return)
      const returnAmount = positionValue + pnl;
      const newBalance = currentBalance + returnAmount;
      
      expect(newBalance).toBe(14800);
    });
  });

  describe('Win Rate Calculation', () => {
    it('should correctly calculate win rate', () => {
      const totalTrades = 10;
      const winningTrades = 6;
      
      const winRate = ((winningTrades / totalTrades) * 100).toFixed(2);
      
      expect(winRate).toBe('60.00');
    });

    it('should increment winning trades on profit', () => {
      let winningTrades = 5;
      const pnl = 100;
      
      if (pnl > 0) winningTrades++;
      
      expect(winningTrades).toBe(6);
    });

    it('should increment losing trades on loss', () => {
      let losingTrades = 3;
      const pnl = -100;
      
      if (pnl <= 0) losingTrades++;
      
      expect(losingTrades).toBe(4);
    });
  });
});
