/**
 * Week 10: Performance Analytics Tests
 * Tests for trade journal, P&L attribution, drawdown analysis, and risk-adjusted metrics
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PerformanceAnalytics,
  getPerformanceAnalytics,
  resetPerformanceAnalytics,
} from '../services/PerformanceAnalytics';

describe('Week 10: Performance Analytics', () => {
  let analytics: PerformanceAnalytics;

  beforeEach(() => {
    resetPerformanceAnalytics();
    analytics = new PerformanceAnalytics({ riskFreeRate: 0.05, tradingDaysPerYear: 365 });
    analytics.initialize(10000);
  });

  describe('Trade Journal', () => {
    it('should record trade entry correctly', () => {
      const tradeId = analytics.recordTradeEntry({
        symbol: 'BTC-USD', direction: 'long', entryPrice: 50000, quantity: 0.1, positionSize: 5000,
        entryTime: Date.now(), strategy: 'momentum', entryReason: 'Strong bullish signal',
        stopLoss: 48000, takeProfit: 55000,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.15, positionSizePercent: 50, riskRewardRatio: 2.5 },
        tags: ['momentum', 'btc'], notes: 'Test trade',
      });
      expect(tradeId).toBeDefined();
      expect(tradeId).toMatch(/^trade_/);
      const openTrades = analytics.getOpenTrades();
      expect(openTrades).toHaveLength(1);
      expect(openTrades[0].symbol).toBe('BTC-USD');
    });

    it('should record trade exit and calculate P&L', () => {
      const tradeId = analytics.recordTradeEntry({
        symbol: 'ETH-USD', direction: 'long', entryPrice: 3000, quantity: 1, positionSize: 3000,
        entryTime: Date.now() - 3600000, strategy: 'breakout', entryReason: 'Resistance breakout',
        stopLoss: 2850, takeProfit: 3300,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: false },
        riskMetrics: { kellyFraction: 0.12, positionSizePercent: 30, riskRewardRatio: 2.0 },
        tags: ['breakout'], notes: '',
      });
      const trade = analytics.recordTradeExit(tradeId, 3150, 'Take profit hit');
      expect(trade).not.toBeNull();
      expect(trade!.exitPrice).toBe(3150);
      expect(trade!.pnlPercent).toBeCloseTo(5, 1);
      expect(trade!.pnlAbsolute).toBeCloseTo(150, 0);
    });

    it('should handle short trades correctly', () => {
      const tradeId = analytics.recordTradeEntry({
        symbol: 'DOGE-USD', direction: 'short', entryPrice: 0.10, quantity: 10000, positionSize: 1000,
        entryTime: Date.now(), strategy: 'reversal', entryReason: 'Bearish divergence',
        stopLoss: 0.11, takeProfit: 0.08,
        entryValidation: { agentConsensus: true, timeframeAlignment: false, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.08, positionSizePercent: 10, riskRewardRatio: 2.0 },
        tags: ['short', 'meme'], notes: '',
      });
      const trade = analytics.recordTradeExit(tradeId, 0.09, 'Target reached');
      expect(trade!.pnlPercent).toBeCloseTo(10, 1);
      expect(trade!.pnlAbsolute).toBeCloseTo(100, 0);
    });
  });

  describe('Equity Curve and Drawdown', () => {
    it('should track equity changes correctly', () => {
      const trade1 = analytics.recordTradeEntry({
        symbol: 'BTC-USD', direction: 'long', entryPrice: 50000, quantity: 0.1, positionSize: 5000,
        entryTime: Date.now(), strategy: 'momentum', entryReason: 'Test',
        stopLoss: 48000, takeProfit: 55000,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.15, positionSizePercent: 50, riskRewardRatio: 2.5 },
        tags: [], notes: '',
      });
      analytics.recordTradeExit(trade1, 52000, 'Profit');
      const summary = analytics.getSummary();
      expect(summary.equity.current).toBeCloseTo(10200, 0);
      expect(summary.equity.peak).toBeCloseTo(10200, 0);
    });

    it('should calculate drawdown correctly', () => {
      const trade1 = analytics.recordTradeEntry({
        symbol: 'BTC-USD', direction: 'long', entryPrice: 50000, quantity: 0.1, positionSize: 5000,
        entryTime: Date.now(), strategy: 'test', entryReason: 'Test',
        stopLoss: 48000, takeProfit: 55000,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.15, positionSizePercent: 50, riskRewardRatio: 2.5 },
        tags: [], notes: '',
      });
      analytics.recordTradeExit(trade1, 55000, 'Win');
      const trade2 = analytics.recordTradeEntry({
        symbol: 'ETH-USD', direction: 'long', entryPrice: 3000, quantity: 1, positionSize: 3000,
        entryTime: Date.now(), strategy: 'test', entryReason: 'Test',
        stopLoss: 2700, takeProfit: 3300,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.10, positionSizePercent: 30, riskRewardRatio: 1.0 },
        tags: [], notes: '',
      });
      analytics.recordTradeExit(trade2, 2700, 'Loss');
      const drawdown = analytics.getDrawdownAnalysis();
      expect(drawdown.currentDrawdown).toBeGreaterThan(0);
      expect(drawdown.currentDrawdownPercent).toBeGreaterThan(0);
    });
  });

  describe('P&L Attribution', () => {
    beforeEach(() => {
      const symbols = ['BTC-USD', 'ETH-USD', 'BTC-USD', 'SOL-USD', 'ETH-USD'];
      const strategies = ['momentum', 'breakout', 'momentum', 'trend', 'breakout'];
      const results = [500, -200, 300, 150, -100];
      symbols.forEach((symbol, i) => {
        const entryPrice = symbol === 'BTC-USD' ? 50000 : symbol === 'ETH-USD' ? 3000 : 100;
        const positionSize = 1000;
        const pnlPercent = (results[i] / positionSize) * 100;
        const exitPrice = entryPrice * (1 + pnlPercent / 100);
        const tradeId = analytics.recordTradeEntry({
          symbol, direction: 'long', entryPrice, quantity: positionSize / entryPrice, positionSize,
          entryTime: Date.now() - (5 - i) * 3600000, strategy: strategies[i], entryReason: 'Test',
          stopLoss: entryPrice * 0.95, takeProfit: entryPrice * 1.10,
          entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
          riskMetrics: { kellyFraction: 0.10, positionSizePercent: 10, riskRewardRatio: 2.0 },
          tags: [], notes: '',
        });
        analytics.recordTradeExit(tradeId, exitPrice, 'Test exit');
      });
    });

    it('should attribute P&L by symbol', () => {
      const attribution = analytics.getPnLAttribution();
      expect(attribution.bySymbol.size).toBe(3);
      const btcPnL = attribution.bySymbol.get('BTC-USD');
      expect(btcPnL).toBeDefined();
      expect(btcPnL!.totalTrades).toBe(2);
      expect(btcPnL!.totalPnL).toBeCloseTo(800, 0);
    });

    it('should attribute P&L by strategy', () => {
      const attribution = analytics.getPnLAttribution();
      expect(attribution.byStrategy.size).toBe(3);
      const momentumPnL = attribution.byStrategy.get('momentum');
      expect(momentumPnL).toBeDefined();
      expect(momentumPnL!.totalTrades).toBe(2);
    });
  });

  describe('Risk-Adjusted Metrics', () => {
    beforeEach(() => {
      const trades = [
        { pnlPercent: 5 }, { pnlPercent: -2 }, { pnlPercent: 3 }, { pnlPercent: 4 }, { pnlPercent: -1 },
        { pnlPercent: 6 }, { pnlPercent: -3 }, { pnlPercent: 2 }, { pnlPercent: 5 }, { pnlPercent: -2 },
      ];
      trades.forEach((t, i) => {
        const entryPrice = 1000;
        const positionSize = 1000;
        const exitPrice = entryPrice * (1 + t.pnlPercent / 100);
        const tradeId = analytics.recordTradeEntry({
          symbol: 'BTC-USD', direction: 'long', entryPrice, quantity: 1, positionSize,
          entryTime: Date.now() - (10 - i) * 86400000, strategy: 'test', entryReason: 'Test',
          stopLoss: entryPrice * 0.95, takeProfit: entryPrice * 1.10,
          entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
          riskMetrics: { kellyFraction: 0.10, positionSizePercent: 10, riskRewardRatio: 2.0 },
          tags: [], notes: '',
        });
        analytics.recordTradeExit(tradeId, exitPrice, 'Test');
      });
    });

    it('should calculate win rate correctly', () => {
      const metrics = analytics.getRiskAdjustedMetrics();
      expect(metrics.totalTrades).toBe(10);
      expect(metrics.winningTrades).toBe(6);
      expect(metrics.losingTrades).toBe(4);
      expect(metrics.winRate).toBeCloseTo(0.6, 2);
    });

    it('should calculate profit factor correctly', () => {
      const metrics = analytics.getRiskAdjustedMetrics();
      expect(metrics.profitFactor).toBeGreaterThan(2);
    });

    it('should calculate expectancy', () => {
      const metrics = analytics.getRiskAdjustedMetrics();
      expect(metrics.expectancy).toBeCloseTo(17, 0);
    });

    it('should track win/loss streaks', () => {
      const metrics = analytics.getRiskAdjustedMetrics();
      expect(metrics.maxWinStreak).toBeGreaterThan(0);
      expect(metrics.maxLossStreak).toBeGreaterThan(0);
    });
  });

  describe('Journal Filtering', () => {
    beforeEach(() => {
      const tradeData = [
        { symbol: 'BTC-USD', strategy: 'momentum', time: Date.now() - 86400000 * 5 },
        { symbol: 'ETH-USD', strategy: 'breakout', time: Date.now() - 86400000 * 4 },
        { symbol: 'BTC-USD', strategy: 'trend', time: Date.now() - 86400000 * 3 },
        { symbol: 'SOL-USD', strategy: 'momentum', time: Date.now() - 86400000 * 2 },
        { symbol: 'ETH-USD', strategy: 'momentum', time: Date.now() - 86400000 * 1 },
      ];
      tradeData.forEach(t => {
        const tradeId = analytics.recordTradeEntry({
          symbol: t.symbol, direction: 'long', entryPrice: 1000, quantity: 1, positionSize: 1000,
          entryTime: t.time, strategy: t.strategy, entryReason: 'Test',
          stopLoss: 950, takeProfit: 1100,
          entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
          riskMetrics: { kellyFraction: 0.10, positionSizePercent: 10, riskRewardRatio: 2.0 },
          tags: [], notes: '',
        });
        analytics.recordTradeExit(tradeId, 1050, 'Test');
      });
    });

    it('should filter by symbol', () => {
      const btcTrades = analytics.getJournal({ symbol: 'BTC-USD' });
      expect(btcTrades).toHaveLength(2);
      btcTrades.forEach(t => expect(t.symbol).toBe('BTC-USD'));
    });

    it('should filter by strategy', () => {
      const momentumTrades = analytics.getJournal({ strategy: 'momentum' });
      expect(momentumTrades).toHaveLength(3);
      momentumTrades.forEach(t => expect(t.strategy).toBe('momentum'));
    });

    it('should limit results', () => {
      const limitedTrades = analytics.getJournal({ limit: 2 });
      expect(limitedTrades).toHaveLength(2);
    });
  });

  describe('CSV Export', () => {
    it('should export journal to CSV format', () => {
      const tradeId = analytics.recordTradeEntry({
        symbol: 'BTC-USD', direction: 'long', entryPrice: 50000, quantity: 0.1, positionSize: 5000,
        entryTime: Date.now(), strategy: 'momentum', entryReason: 'Strong signal',
        stopLoss: 48000, takeProfit: 55000,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.15, positionSizePercent: 50, riskRewardRatio: 2.5 },
        tags: ['test', 'btc'], notes: 'Test trade',
      });
      analytics.recordTradeExit(tradeId, 52000, 'Take profit');
      const csv = analytics.exportJournalToCSV();
      expect(csv).toContain('ID,Symbol,Direction');
      expect(csv).toContain('BTC-USD');
      expect(csv).toContain('long');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty metrics gracefully', () => {
      const emptyAnalytics = new PerformanceAnalytics();
      emptyAnalytics.initialize(10000);
      const metrics = emptyAnalytics.getRiskAdjustedMetrics();
      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
    });

    it('should handle trade exit for non-existent trade', () => {
      const result = analytics.recordTradeExit('non-existent-id', 1000, 'Test');
      expect(result).toBeNull();
    });

    it('should handle reset correctly', () => {
      const tradeId = analytics.recordTradeEntry({
        symbol: 'BTC-USD', direction: 'long', entryPrice: 50000, quantity: 0.1, positionSize: 5000,
        entryTime: Date.now(), strategy: 'test', entryReason: 'Test',
        stopLoss: 48000, takeProfit: 55000,
        entryValidation: { agentConsensus: true, timeframeAlignment: true, volumeConfirmation: true },
        riskMetrics: { kellyFraction: 0.15, positionSizePercent: 50, riskRewardRatio: 2.5 },
        tags: [], notes: '',
      });
      analytics.recordTradeExit(tradeId, 52000, 'Test');
      analytics.reset();
      const summary = analytics.getSummary();
      expect(summary.trades.total).toBe(0);
      expect(summary.equity.initial).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getPerformanceAnalytics', () => {
      const instance1 = getPerformanceAnalytics();
      const instance2 = getPerformanceAnalytics();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetPerformanceAnalytics', () => {
      const instance1 = getPerformanceAnalytics();
      instance1.initialize(5000);
      resetPerformanceAnalytics();
      const instance2 = getPerformanceAnalytics();
      expect(instance2).not.toBe(instance1);
    });
  });
});
