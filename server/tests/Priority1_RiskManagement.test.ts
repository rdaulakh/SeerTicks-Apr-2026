/**
 * Priority 1 Risk Management Tests
 * 
 * Tests for:
 * 1. Daily Drawdown Limit (-10%)
 * 2. Max Position Limit (3 concurrent)
 * 3. Iceberg Order Detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DailyDrawdownTracker,
  PositionLimitTracker,
  Week9RiskManager,
} from '../services/Week9RiskManager';
import { IcebergOrderDetector } from '../services/IcebergOrderDetector';

// ============================================================================
// DAILY DRAWDOWN TRACKER TESTS
// ============================================================================

describe('DailyDrawdownTracker', () => {
  let tracker: DailyDrawdownTracker;
  const config = {
    maxDailyDrawdownPercent: 0.10,
    maxConcurrentPositions: 3,
    kellyFraction: 0.25,
    minWinRate: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxConsecutiveLosses: 3,
    maxGlobalConsecutiveLosses: 5,
    cooldownMinutes: 30,
    maxCorrelatedExposure: 0.30,
    correlationThreshold: 0.70,
    maxPositionSize: 0.20,
    maxTotalExposure: 0.80,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 10,
  };

  beforeEach(() => {
    tracker = new DailyDrawdownTracker(config);
    tracker.forceReset(10000);
  });

  it('should initialize with correct starting equity', () => {
    const status = tracker.getStatus();
    expect(status.startOfDayEquity).toBe(10000);
    expect(status.isHalted).toBe(false);
  });

  it('should track positive P&L correctly', () => {
    tracker.recordTradePnL(500);
    const status = tracker.getStatus();
    expect(status.dailyPnL).toBe(500);
    expect(status.currentEquity).toBe(10500);
    expect(status.isHalted).toBe(false);
  });

  it('should track negative P&L correctly', () => {
    tracker.recordTradePnL(-300);
    const status = tracker.getStatus();
    expect(status.dailyPnL).toBe(-300);
    expect(status.currentEquity).toBe(9700);
    expect(status.isHalted).toBe(false);
  });

  it('should halt trading at -10% drawdown', () => {
    tracker.recordTradePnL(-1000);
    expect(tracker.isTradingHalted()).toBe(true);
    const status = tracker.getStatus();
    expect(status.isHalted).toBe(true);
  });

  it('should halt trading when exceeding -10% drawdown', () => {
    tracker.recordTradePnL(-1200);
    expect(tracker.isTradingHalted()).toBe(true);
  });

  it('should not halt at -9% drawdown', () => {
    tracker.recordTradePnL(-900);
    expect(tracker.isTradingHalted()).toBe(false);
  });

  it('should remain halted after hitting limit', () => {
    tracker.recordTradePnL(-1000);
    tracker.recordTradePnL(500);
    expect(tracker.isTradingHalted()).toBe(true);
  });

  it('should reset on force reset', () => {
    tracker.recordTradePnL(-1000);
    expect(tracker.isTradingHalted()).toBe(true);
    tracker.forceReset(15000);
    expect(tracker.isTradingHalted()).toBe(false);
    expect(tracker.getStatus().startOfDayEquity).toBe(15000);
  });
});

// ============================================================================
// POSITION LIMIT TRACKER TESTS
// ============================================================================

describe('PositionLimitTracker', () => {
  let tracker: PositionLimitTracker;
  const config = {
    maxDailyDrawdownPercent: 0.10,
    maxConcurrentPositions: 3,
    kellyFraction: 0.25,
    minWinRate: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxConsecutiveLosses: 3,
    maxGlobalConsecutiveLosses: 5,
    cooldownMinutes: 30,
    maxCorrelatedExposure: 0.30,
    correlationThreshold: 0.70,
    maxPositionSize: 0.20,
    maxTotalExposure: 0.80,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 10,
  };

  beforeEach(() => {
    tracker = new PositionLimitTracker(config);
  });

  it('should start with no positions', () => {
    const status = tracker.getStatus();
    expect(status.currentPositions).toBe(0);
    expect(status.maxPositions).toBe(3);
    expect(status.canOpenPosition).toBe(true);
  });

  it('should allow opening first position', () => {
    const canOpen = tracker.canOpenPosition('BTC-USD');
    expect(canOpen.canOpenPosition).toBe(true);
    expect(canOpen.currentPositions).toBe(0);
  });

  it('should track registered positions', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    const status = tracker.getStatus();
    expect(status.currentPositions).toBe(1);
    expect(status.openSymbols).toContain('BTC-USD');
  });

  it('should allow up to 3 positions', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    tracker.registerPosition('ETH-USD', 500, 'long');
    tracker.registerPosition('SOL-USD', 300, 'short');
    const status = tracker.getStatus();
    expect(status.currentPositions).toBe(3);
    expect(status.canOpenPosition).toBe(false);
  });

  it('should block 4th position', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    tracker.registerPosition('ETH-USD', 500, 'long');
    tracker.registerPosition('SOL-USD', 300, 'short');
    const canOpen = tracker.canOpenPosition('DOGE-USD');
    expect(canOpen.canOpenPosition).toBe(false);
    expect(canOpen.reason).toContain('Max concurrent positions');
  });

  it('should block duplicate symbol position', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    const canOpen = tracker.canOpenPosition('BTC-USD');
    expect(canOpen.canOpenPosition).toBe(false);
    expect(canOpen.reason).toContain('Already have open position');
  });

  it('should allow new position after closing one', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    tracker.registerPosition('ETH-USD', 500, 'long');
    tracker.registerPosition('SOL-USD', 300, 'short');
    expect(tracker.canOpenPosition('DOGE-USD').canOpenPosition).toBe(false);
    tracker.removePosition('ETH-USD');
    expect(tracker.canOpenPosition('DOGE-USD').canOpenPosition).toBe(true);
  });

  it('should clear all positions', () => {
    tracker.registerPosition('BTC-USD', 1000, 'long');
    tracker.registerPosition('ETH-USD', 500, 'long');
    tracker.clearPositions();
    const status = tracker.getStatus();
    expect(status.currentPositions).toBe(0);
    expect(status.openSymbols).toHaveLength(0);
  });
});

// ============================================================================
// ICEBERG ORDER DETECTOR TESTS
// ============================================================================

describe('IcebergOrderDetector', () => {
  let detector: IcebergOrderDetector;

  beforeEach(() => {
    detector = new IcebergOrderDetector();
  });

  it('should detect iceberg pattern from repeated same-size orders', () => {
    const trades = [
      { price: 50000, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 5000 },
      { price: 50001, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 4000 },
      { price: 50002, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 3000 },
      { price: 50003, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 2000 },
      { price: 50004, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 1000 },
    ];
    const result = detector.detectIcebergPattern('BTC-USD', trades);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.direction).toBe('buy');
  });

  it('should not detect iceberg from random trades', () => {
    const trades = [
      { price: 50000, size: 0.5, side: 'buy' as const, timestamp: Date.now() - 5000 },
      { price: 50100, size: 2.3, side: 'sell' as const, timestamp: Date.now() - 4000 },
      { price: 49900, size: 0.1, side: 'buy' as const, timestamp: Date.now() - 3000 },
    ];
    const result = detector.detectIcebergPattern('BTC-USD', trades);
    expect(result.detected).toBe(false);
  });

  it('should detect sell-side iceberg', () => {
    const trades = [
      { price: 50000, size: 2.0, side: 'sell' as const, timestamp: Date.now() - 5000 },
      { price: 49999, size: 2.0, side: 'sell' as const, timestamp: Date.now() - 4000 },
      { price: 49998, size: 2.0, side: 'sell' as const, timestamp: Date.now() - 3000 },
      { price: 49997, size: 2.0, side: 'sell' as const, timestamp: Date.now() - 2000 },
      { price: 49996, size: 2.0, side: 'sell' as const, timestamp: Date.now() - 1000 },
    ];
    const result = detector.detectIcebergPattern('BTC-USD', trades);
    expect(result.detected).toBe(true);
    expect(result.direction).toBe('sell');
  });

  it('should generate bullish signal for buy iceberg', () => {
    const trades = [
      { price: 50000, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 5000 },
      { price: 50001, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 4000 },
      { price: 50002, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 3000 },
      { price: 50003, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 2000 },
      { price: 50004, size: 1.5, side: 'buy' as const, timestamp: Date.now() - 1000 },
    ];
    const signal = detector.generateSignal('BTC-USD', trades);
    if (signal) {
      expect(signal.direction).toBe('bullish');
      expect(signal.confidence).toBeGreaterThan(0.5);
    }
  });
});

// ============================================================================
// WEEK9 RISK MANAGER INTEGRATION TESTS
// ============================================================================

describe('Week9RiskManager Integration', () => {
  let riskManager: Week9RiskManager;

  beforeEach(() => {
    riskManager = new Week9RiskManager({
      maxDailyDrawdownPercent: 0.10,
      maxConcurrentPositions: 3,
    });
    riskManager.updateEquity(10000);
  });

  it('should block trade when daily drawdown limit hit', () => {
    riskManager.recordTrade({
      symbol: 'BTC-USD',
      direction: 'long',
      entryPrice: 50000,
      exitPrice: 45000,
      pnlPercent: -0.10,
      pnlAbsolute: -1000,
      timestamp: Date.now(),
      holdTimeMs: 3600000,
    });
    const result = riskManager.calculatePositionSize('ETH-USD', 9000, 9000);
    expect(result.canTrade).toBe(false);
    expect(result.dailyDrawdownStatus.isHalted).toBe(true);
  });

  it('should block trade when max positions reached', () => {
    riskManager.registerPosition('BTC-USD', 1000, 'long');
    riskManager.registerPosition('ETH-USD', 500, 'long');
    riskManager.registerPosition('SOL-USD', 300, 'short');
    const result = riskManager.calculatePositionSize('DOGE-USD', 10000, 10000);
    expect(result.canTrade).toBe(false);
    expect(result.positionLimitStatus.canOpenPosition).toBe(false);
  });

  it('should report comprehensive risk status', () => {
    riskManager.registerPosition('BTC-USD', 1000, 'long');
    const status = riskManager.getRiskStatus();
    expect(status.dailyDrawdown).toBeDefined();
    expect(status.positionLimit).toBeDefined();
    expect(status.positionLimit.currentPositions).toBe(1);
    expect(status.config.maxDailyDrawdownPercent).toBe(0.10);
    expect(status.config.maxConcurrentPositions).toBe(3);
  });

  it('should reset all trackers', () => {
    riskManager.registerPosition('BTC-USD', 1000, 'long');
    riskManager.recordTrade({
      symbol: 'ETH-USD',
      direction: 'long',
      entryPrice: 3000,
      exitPrice: 2700,
      pnlPercent: -0.10,
      pnlAbsolute: -1000,
      timestamp: Date.now(),
      holdTimeMs: 3600000,
    });
    riskManager.reset();
    const status = riskManager.getRiskStatus();
    expect(status.positionLimit.currentPositions).toBe(0);
    expect(status.dailyDrawdown.isHalted).toBe(false);
  });
});
