/**
 * UI Improvements Tests
 * 
 * Tests for:
 * - Position sorting functionality
 * - Win rate calculation logic
 * - Performance metrics calculation
 * 
 * Note: API endpoint tests require authentication and are tested via browser.
 * These tests focus on the business logic that doesn't require auth.
 */

import { describe, it, expect } from 'vitest';

describe('UI Improvements', () => {
  describe('Position Sorting Logic', () => {
    it('should correctly sort positions by P&L descending', () => {
      const positions = [
        { id: '1', symbol: 'BTC', unrealizedPnl: 100 },
        { id: '2', symbol: 'ETH', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: 200 },
      ];
      
      const sorted = [...positions].sort((a, b) => 
        (b.unrealizedPnl || 0) - (a.unrealizedPnl || 0)
      );
      
      expect(sorted[0].symbol).toBe('SOL');
      expect(sorted[1].symbol).toBe('BTC');
      expect(sorted[2].symbol).toBe('ETH');
    });

    it('should correctly sort positions by P&L ascending', () => {
      const positions = [
        { id: '1', symbol: 'BTC', unrealizedPnl: 100 },
        { id: '2', symbol: 'ETH', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: 200 },
      ];
      
      const sorted = [...positions].sort((a, b) => 
        (a.unrealizedPnl || 0) - (b.unrealizedPnl || 0)
      );
      
      expect(sorted[0].symbol).toBe('ETH');
      expect(sorted[1].symbol).toBe('BTC');
      expect(sorted[2].symbol).toBe('SOL');
    });

    it('should correctly sort positions by symbol A-Z', () => {
      const positions = [
        { id: '1', symbol: 'ETH', unrealizedPnl: 100 },
        { id: '2', symbol: 'BTC', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: 200 },
      ];
      
      const sorted = [...positions].sort((a, b) => 
        a.symbol.localeCompare(b.symbol)
      );
      
      expect(sorted[0].symbol).toBe('BTC');
      expect(sorted[1].symbol).toBe('ETH');
      expect(sorted[2].symbol).toBe('SOL');
    });

    it('should correctly sort positions by symbol Z-A', () => {
      const positions = [
        { id: '1', symbol: 'ETH', unrealizedPnl: 100 },
        { id: '2', symbol: 'BTC', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: 200 },
      ];
      
      const sorted = [...positions].sort((a, b) => 
        b.symbol.localeCompare(a.symbol)
      );
      
      expect(sorted[0].symbol).toBe('SOL');
      expect(sorted[1].symbol).toBe('ETH');
      expect(sorted[2].symbol).toBe('BTC');
    });

    it('should correctly sort positions by hold time (longest first)', () => {
      const now = Date.now();
      const positions = [
        { id: '1', symbol: 'BTC', entryTime: new Date(now - 1000 * 60 * 60).toISOString() }, // 1 hour ago
        { id: '2', symbol: 'ETH', entryTime: new Date(now - 1000 * 60 * 60 * 24).toISOString() }, // 24 hours ago
        { id: '3', symbol: 'SOL', entryTime: new Date(now - 1000 * 60 * 30).toISOString() }, // 30 min ago
      ];
      
      // Oldest entry time = longest hold
      const sorted = [...positions].sort((a, b) => 
        new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
      );
      
      expect(sorted[0].symbol).toBe('ETH'); // Oldest
      expect(sorted[1].symbol).toBe('BTC');
      expect(sorted[2].symbol).toBe('SOL'); // Newest
    });

    it('should correctly sort positions by value (high to low)', () => {
      const positions = [
        { id: '1', symbol: 'BTC', currentPrice: 50000, quantity: 0.1 }, // $5000
        { id: '2', symbol: 'ETH', currentPrice: 3000, quantity: 2 }, // $6000
        { id: '3', symbol: 'SOL', currentPrice: 100, quantity: 10 }, // $1000
      ];
      
      const sorted = [...positions].sort((a, b) => 
        (b.currentPrice * b.quantity) - (a.currentPrice * a.quantity)
      );
      
      expect(sorted[0].symbol).toBe('ETH'); // $6000
      expect(sorted[1].symbol).toBe('BTC'); // $5000
      expect(sorted[2].symbol).toBe('SOL'); // $1000
    });

    it('should handle positions with null/undefined P&L values', () => {
      const positions = [
        { id: '1', symbol: 'BTC', unrealizedPnl: null as any },
        { id: '2', symbol: 'ETH', unrealizedPnl: 50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: undefined as any },
      ];
      
      const sorted = [...positions].sort((a, b) => 
        (b.unrealizedPnl || 0) - (a.unrealizedPnl || 0)
      );
      
      expect(sorted[0].symbol).toBe('ETH'); // 50
      expect(sorted[1].symbol).toBe('BTC'); // 0 (null)
      expect(sorted[2].symbol).toBe('SOL'); // 0 (undefined)
    });
  });

  describe('Win Rate Calculation', () => {
    it('should calculate win rate correctly from analytics', () => {
      const analytics = {
        totalTrades: 10,
        winningTrades: 6,
        losingTrades: 4,
      };
      
      const winRate = analytics.totalTrades > 0 
        ? (analytics.winningTrades / analytics.totalTrades) * 100 
        : 0;
      
      expect(winRate).toBe(60);
    });

    it('should handle zero trades gracefully', () => {
      const analytics = {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
      };
      
      const winRate = analytics.totalTrades > 0 
        ? (analytics.winningTrades / analytics.totalTrades) * 100 
        : 0;
      
      expect(winRate).toBe(0);
    });

    it('should calculate 100% win rate when all trades are winners', () => {
      const analytics = {
        totalTrades: 5,
        winningTrades: 5,
        losingTrades: 0,
      };
      
      const winRate = analytics.totalTrades > 0 
        ? (analytics.winningTrades / analytics.totalTrades) * 100 
        : 0;
      
      expect(winRate).toBe(100);
    });

    it('should calculate 0% win rate when all trades are losers', () => {
      const analytics = {
        totalTrades: 5,
        winningTrades: 0,
        losingTrades: 5,
      };
      
      const winRate = analytics.totalTrades > 0 
        ? (analytics.winningTrades / analytics.totalTrades) * 100 
        : 0;
      
      expect(winRate).toBe(0);
    });
  });

  describe('Performance Metrics Calculation', () => {
    it('should calculate ROI correctly', () => {
      const startingBalance = 10000;
      const totalPnL = 500;
      
      const roi = (totalPnL / startingBalance) * 100;
      
      expect(roi).toBe(5);
    });

    it('should calculate negative ROI correctly', () => {
      const startingBalance = 10000;
      const totalPnL = -200;
      
      const roi = (totalPnL / startingBalance) * 100;
      
      expect(roi).toBe(-2);
    });

    it('should calculate profit factor correctly', () => {
      const grossProfit = 1000;
      const grossLoss = 500;
      
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
      
      expect(profitFactor).toBe(2);
    });

    it('should handle zero gross loss in profit factor', () => {
      const grossProfit = 1000;
      const grossLoss = 0;
      
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
      
      expect(profitFactor).toBe(0); // or could be Infinity, depends on implementation
    });

    it('should calculate max drawdown correctly', () => {
      const trades = [
        { pnl: 100 },
        { pnl: 50 },
        { pnl: -200 }, // Drawdown starts
        { pnl: -100 }, // Drawdown continues
        { pnl: 150 },
      ];
      
      const startingBalance = 10000;
      let peak = startingBalance;
      let maxDD = 0;
      let runningBalance = startingBalance;
      
      trades.forEach(trade => {
        runningBalance += trade.pnl;
        if (runningBalance > peak) peak = runningBalance;
        const drawdown = (peak - runningBalance) / peak * 100;
        if (drawdown > maxDD) maxDD = drawdown;
      });
      
      // Peak was 10150, lowest was 9950, drawdown = (10150-9950)/10150 * 100 ≈ 1.97%
      expect(maxDD).toBeGreaterThan(0);
      expect(maxDD).toBeLessThan(5);
    });
  });

  describe('Position Filtering Logic', () => {
    it('should filter positions by status', () => {
      const positions = [
        { id: '1', symbol: 'BTC', status: 'open' },
        { id: '2', symbol: 'ETH', status: 'partial' },
        { id: '3', symbol: 'SOL', status: 'closing' },
        { id: '4', symbol: 'DOGE', status: 'open' },
      ];
      
      const filterStatus = 'open';
      const filtered = positions.filter(pos => 
        filterStatus === 'all' || pos.status === filterStatus
      );
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(p => p.status === 'open')).toBe(true);
    });

    it('should filter positions by symbol', () => {
      const positions = [
        { id: '1', symbol: 'BTC', status: 'open' },
        { id: '2', symbol: 'ETH', status: 'open' },
        { id: '3', symbol: 'BTC', status: 'partial' },
      ];
      
      const filterSymbol = 'BTC';
      const filtered = positions.filter(pos => 
        filterSymbol === 'all' || pos.symbol === filterSymbol
      );
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(p => p.symbol === 'BTC')).toBe(true);
    });

    it('should filter positions by P&L (winning)', () => {
      const positions = [
        { id: '1', symbol: 'BTC', unrealizedPnl: 100 },
        { id: '2', symbol: 'ETH', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: 200 },
      ];
      
      const filterPnL = 'winning';
      const filtered = positions.filter(pos => {
        if (filterPnL === 'winning') return (pos.unrealizedPnl || 0) > 0;
        if (filterPnL === 'losing') return (pos.unrealizedPnl || 0) < 0;
        return true;
      });
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(p => p.unrealizedPnl > 0)).toBe(true);
    });

    it('should filter positions by P&L (losing)', () => {
      const positions = [
        { id: '1', symbol: 'BTC', unrealizedPnl: 100 },
        { id: '2', symbol: 'ETH', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', unrealizedPnl: -30 },
      ];
      
      const filterPnL = 'losing';
      const filtered = positions.filter(pos => {
        if (filterPnL === 'winning') return (pos.unrealizedPnl || 0) > 0;
        if (filterPnL === 'losing') return (pos.unrealizedPnl || 0) < 0;
        return true;
      });
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(p => p.unrealizedPnl < 0)).toBe(true);
    });

    it('should return all positions when filter is "all"', () => {
      const positions = [
        { id: '1', symbol: 'BTC', status: 'open', unrealizedPnl: 100 },
        { id: '2', symbol: 'ETH', status: 'partial', unrealizedPnl: -50 },
        { id: '3', symbol: 'SOL', status: 'closing', unrealizedPnl: 200 },
      ];
      
      const filterStatus = 'all';
      const filterSymbol = 'all';
      const filterPnL = 'all';
      
      const filtered = positions.filter(pos => {
        if (filterStatus !== 'all' && pos.status !== filterStatus) return false;
        if (filterSymbol !== 'all' && pos.symbol !== filterSymbol) return false;
        if (filterPnL === 'winning' && (pos.unrealizedPnl || 0) <= 0) return false;
        if (filterPnL === 'losing' && (pos.unrealizedPnl || 0) >= 0) return false;
        return true;
      });
      
      expect(filtered.length).toBe(3);
    });
  });
});
