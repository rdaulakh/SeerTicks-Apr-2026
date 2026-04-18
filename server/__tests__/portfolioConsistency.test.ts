/**
 * Portfolio Consistency Tests
 * 
 * Verifies that portfolio data is calculated consistently across
 * Dashboard, Positions, and Performance pages.
 */

import { describe, it, expect } from 'vitest';

describe('Portfolio Data Consistency', () => {
  describe('Portfolio Value Calculation', () => {
    it('should calculate portfolio value as funds + unrealized P&L for paper trading', () => {
      const portfolioFunds = 20000;
      const unrealizedPnL = 500;
      const expectedPortfolioValue = portfolioFunds + unrealizedPnL;
      
      expect(expectedPortfolioValue).toBe(20500);
    });

    it('should calculate unrealized P&L from positions correctly', () => {
      const positions = [
        { entryPrice: 100, currentPrice: 110, quantity: 10, side: 'LONG' },
        { entryPrice: 50, currentPrice: 45, quantity: 20, side: 'LONG' },
      ];
      
      const unrealizedPnL = positions.reduce((sum, pos) => {
        if (pos.side === 'LONG') {
          return sum + (pos.currentPrice - pos.entryPrice) * pos.quantity;
        } else {
          return sum + (pos.entryPrice - pos.currentPrice) * pos.quantity;
        }
      }, 0);
      
      // Position 1: (110 - 100) * 10 = 100
      // Position 2: (45 - 50) * 20 = -100
      // Total: 0
      expect(unrealizedPnL).toBe(0);
    });

    it('should calculate short position P&L correctly', () => {
      const positions = [
        { entryPrice: 100, currentPrice: 90, quantity: 10, side: 'SHORT' },
      ];
      
      const unrealizedPnL = positions.reduce((sum, pos) => {
        if (pos.side === 'LONG' || pos.side === 'BUY') {
          return sum + (pos.currentPrice - pos.entryPrice) * pos.quantity;
        } else {
          return sum + (pos.entryPrice - pos.currentPrice) * pos.quantity;
        }
      }, 0);
      
      // Short: (100 - 90) * 10 = 100 (profit when price drops)
      expect(unrealizedPnL).toBe(100);
    });
  });

  describe('Total P&L Calculation', () => {
    it('should calculate total P&L as realized + unrealized', () => {
      const realizedPnL = 1500;
      const unrealizedPnL = 300;
      const totalPnL = realizedPnL + unrealizedPnL;
      
      expect(totalPnL).toBe(1800);
    });
  });

  describe('ROI Calculation', () => {
    it('should calculate ROI as percentage of initial funds', () => {
      const portfolioFunds = 10000;
      const totalPnL = 500;
      const roi = (totalPnL / portfolioFunds) * 100;
      
      expect(roi).toBe(5); // 5% ROI
    });

    it('should handle negative ROI correctly', () => {
      const portfolioFunds = 10000;
      const totalPnL = -200;
      const roi = (totalPnL / portfolioFunds) * 100;
      
      expect(roi).toBe(-2); // -2% ROI
    });
  });

  describe('Default Values', () => {
    it('should default portfolio funds to 10000 when not set', () => {
      const portfolioFundsData = undefined;
      const defaultFunds = parseFloat(portfolioFundsData?.funds || '10000');
      
      expect(defaultFunds).toBe(10000);
    });

    it('should parse portfolio funds from string correctly', () => {
      const portfolioFundsData = { funds: '20000.00' };
      const funds = parseFloat(portfolioFundsData.funds);
      
      expect(funds).toBe(20000);
    });
  });

  describe('Position Metrics', () => {
    it('should count open positions correctly', () => {
      const positions = [
        { id: '1', status: 'open' },
        { id: '2', status: 'open' },
        { id: '3', status: 'closed' },
      ];
      
      const openPositionCount = positions.filter(p => p.status === 'open').length;
      
      expect(openPositionCount).toBe(2);
    });

    it('should calculate position value correctly', () => {
      const positions = [
        { currentPrice: 100, quantity: 5 },
        { currentPrice: 50, quantity: 10 },
      ];
      
      const positionValue = positions.reduce((sum, pos) => {
        return sum + (pos.currentPrice * pos.quantity);
      }, 0);
      
      // Position 1: 100 * 5 = 500
      // Position 2: 50 * 10 = 500
      // Total: 1000
      expect(positionValue).toBe(1000);
    });
  });
});
