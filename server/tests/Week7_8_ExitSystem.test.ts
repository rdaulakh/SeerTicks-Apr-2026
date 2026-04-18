/**
 * Week 7-8 Exit System Tests
 * 
 * Tests for:
 * - StructureBasedExitManager (ATR stops, support/resistance breaks)
 * - LayeredProfitManager (33%/33%/34% profit targets)
 * - IntegratedExitManager (combined exit logic)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StructureBasedExitManager, OHLCV, Position as StructurePosition } from '../services/StructureBasedExitManager';
import { LayeredProfitManager, Position as ProfitPosition } from '../services/LayeredProfitManager';
import { IntegratedExitManager, ManagedPosition } from '../services/IntegratedExitManager';

// Helper to create mock candles
function createMockCandles(
  basePrice: number,
  count: number,
  volatility: number = 0.02
): OHLCV[] {
  const candles: OHLCV[] = [];
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    
    candles.push({
      open,
      high,
      low,
      close,
      volume: 1000 + Math.random() * 500,
      timestamp: Date.now() - (count - i) * 3600000,
    });
    
    price = close;
  }
  
  return candles;
}

// Helper to create a trending candle set
function createTrendingCandles(
  startPrice: number,
  endPrice: number,
  count: number
): OHLCV[] {
  const candles: OHLCV[] = [];
  const priceStep = (endPrice - startPrice) / count;
  
  for (let i = 0; i < count; i++) {
    const open = startPrice + priceStep * i;
    const close = startPrice + priceStep * (i + 1);
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    
    candles.push({
      open,
      high,
      low,
      close,
      volume: 1000 + Math.random() * 500,
      timestamp: Date.now() - (count - i) * 3600000,
    });
  }
  
  return candles;
}

describe('StructureBasedExitManager', () => {
  let exitManager: StructureBasedExitManager;

  beforeEach(() => {
    exitManager = new StructureBasedExitManager();
  });

  describe('ATR Calculation', () => {
    it('should calculate ATR correctly from candles', () => {
      const candles = createMockCandles(100, 20, 0.02);
      const atr = exitManager.calculateATR(candles);
      
      expect(atr).toBeGreaterThan(0);
      expect(atr).toBeLessThan(candles[0].close * 0.1); // ATR should be reasonable
    });

    it('should handle insufficient candles gracefully', () => {
      const candles = createMockCandles(100, 5, 0.02);
      const atr = exitManager.calculateATR(candles);
      
      expect(atr).toBeGreaterThan(0);
    });
  });

  describe('ATR Stop Detection', () => {
    it('should trigger ATR stop for long position when price drops', async () => {
      const candles = createMockCandles(100, 20, 0.02);
      const atr = exitManager.calculateATR(candles);
      
      const position: StructurePosition = {
        id: 'test-1',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 100,
        unrealizedPnL: -10,
        openTime: Date.now() - 3600000,
      };
      
      // Price dropped below ATR stop (2.5x ATR)
      const currentPrice = 100 - (atr * 2.5) - 1;
      
      const signals = await exitManager.calculateExitConditions(position, currentPrice, candles);
      const atrStop = signals.find(s => s.type === 'atr_stop');
      
      expect(atrStop).toBeDefined();
      expect(atrStop?.urgency).toBe('immediate');
    });

    it('should trigger ATR stop for short position when price rises', async () => {
      const candles = createMockCandles(100, 20, 0.02);
      const atr = exitManager.calculateATR(candles);
      
      const position: StructurePosition = {
        id: 'test-2',
        symbol: 'BTCUSDT',
        direction: 'short',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 100,
        unrealizedPnL: -10,
        openTime: Date.now() - 3600000,
      };
      
      // Price rose above ATR stop
      const currentPrice = 100 + (atr * 2.5) + 1;
      
      const signals = await exitManager.calculateExitConditions(position, currentPrice, candles);
      const atrStop = signals.find(s => s.type === 'atr_stop');
      
      expect(atrStop).toBeDefined();
      expect(atrStop?.urgency).toBe('immediate');
    });

    it('should NOT trigger ATR stop when price is within range', async () => {
      const candles = createMockCandles(100, 20, 0.02);
      
      const position: StructurePosition = {
        id: 'test-3',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now() - 3600000,
      };
      
      // Price at entry (no stop triggered)
      const currentPrice = 100;
      
      const signals = await exitManager.calculateExitConditions(position, currentPrice, candles);
      const atrStop = signals.find(s => s.type === 'atr_stop');
      
      expect(atrStop).toBeUndefined();
    });
  });

  describe('Safety Conditions', () => {
    it('should trigger max time exit after 4 hours', async () => {
      const candles = createMockCandles(100, 20, 0.02);
      
      const position: StructurePosition = {
        id: 'test-4',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now() - (5 * 60 * 60 * 1000), // 5 hours ago
      };
      
      const signals = await exitManager.calculateExitConditions(position, 100, candles);
      const timeExit = signals.find(s => s.type === 'max_time_exit');
      
      expect(timeExit).toBeDefined();
      expect(timeExit?.urgency).toBe('immediate');
    });

    it('should trigger drawdown protection at 3% loss', async () => {
      const candles = createMockCandles(100, 20, 0.02);
      
      const position: StructurePosition = {
        id: 'test-5',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 96, // 4% down
        unrealizedPnL: -4,
        openTime: Date.now() - 3600000,
      };
      
      const signals = await exitManager.calculateExitConditions(position, 96, candles);
      const drawdownExit = signals.find(s => s.type === 'drawdown_protection');
      
      expect(drawdownExit).toBeDefined();
      expect(drawdownExit?.urgency).toBe('immediate');
    });
  });

  describe('Trailing Stop', () => {
    it('should update trailing stop for long position when price rises', () => {
      const position: StructurePosition = {
        id: 'test-6',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 110,
        unrealizedPnL: 10,
        openTime: Date.now() - 3600000,
        trailingStopActive: true,
        trailingStopPrice: 105,
      };
      
      // Price rose to 110
      const newStop = exitManager.updateTrailingStop(position, 110);
      
      // New stop should be higher than old stop
      expect(newStop).toBeGreaterThan(105);
    });

    it('should NOT lower trailing stop for long position', () => {
      const position: StructurePosition = {
        id: 'test-7',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        notionalValue: 105,
        unrealizedPnL: 5,
        openTime: Date.now() - 3600000,
        trailingStopActive: true,
        trailingStopPrice: 108,
      };
      
      // Price dropped to 105
      const newStop = exitManager.updateTrailingStop(position, 105);
      
      // Stop should remain at 108
      expect(newStop).toBe(108);
    });
  });

  describe('Most Urgent Signal', () => {
    it('should return immediate signals first', () => {
      const signals = [
        { type: 'trend_break' as const, urgency: 'high' as const, confidence: 0.8, reason: 'test' },
        { type: 'atr_stop' as const, urgency: 'immediate' as const, confidence: 0.9, reason: 'test' },
        { type: 'support_break' as const, urgency: 'medium' as const, confidence: 0.7, reason: 'test' },
      ];
      
      const mostUrgent = exitManager.getMostUrgentSignal(signals);
      
      expect(mostUrgent?.type).toBe('atr_stop');
      expect(mostUrgent?.urgency).toBe('immediate');
    });

    it('should sort by confidence when urgency is equal', () => {
      const signals = [
        { type: 'atr_stop' as const, urgency: 'immediate' as const, confidence: 0.7, reason: 'test' },
        { type: 'drawdown_protection' as const, urgency: 'immediate' as const, confidence: 0.95, reason: 'test' },
      ];
      
      const mostUrgent = exitManager.getMostUrgentSignal(signals);
      
      expect(mostUrgent?.type).toBe('drawdown_protection');
    });
  });
});

describe('LayeredProfitManager', () => {
  let profitManager: LayeredProfitManager;

  beforeEach(() => {
    profitManager = new LayeredProfitManager();
  });

  describe('Profit Target Initialization', () => {
    it('should initialize three profit targets for long position', () => {
      const position: ProfitPosition = {
        id: 'test-1',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      const targets = profitManager.initializeProfitTargets(position);
      
      expect(targets).toHaveLength(3);
      expect(targets[0].price).toBeCloseTo(101, 2); // +1%
      expect(targets[1].price).toBeCloseTo(101.5, 2); // +1.5%
      expect(targets[2].price).toBeCloseTo(102, 2); // +2%
    });

    it('should initialize profit targets for short position', () => {
      const position: ProfitPosition = {
        id: 'test-2',
        symbol: 'BTCUSDT',
        direction: 'short',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      const targets = profitManager.initializeProfitTargets(position);
      
      expect(targets).toHaveLength(3);
      expect(targets[0].price).toBeCloseTo(99, 2); // -1%
      expect(targets[1].price).toBeCloseTo(98.5, 2); // -1.5%
      expect(targets[2].price).toBeCloseTo(98, 2); // -2%
    });
  });

  describe('Profit Target Execution', () => {
    it('should trigger first profit target at +1%', () => {
      const position: ProfitPosition = {
        id: 'test-3',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 101,
        unrealizedPnL: 1,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      
      // Price at +1%
      const actions = profitManager.checkProfitTargets(position, 101);
      
      const partialExit = actions.find(a => a.type === 'partial_exit');
      expect(partialExit).toBeDefined();
      expect(partialExit?.size).toBeCloseTo(0.33, 2);
      expect(partialExit?.reason).toContain('1.0%');
    });

    it('should move to breakeven after first target', () => {
      const position: ProfitPosition = {
        id: 'test-4',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 101,
        unrealizedPnL: 1,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      profitManager.checkProfitTargets(position, 101);
      
      const status = profitManager.getTargetStatus(position.id);
      
      expect(status.breakevenActive).toBe(true);
      expect(status.breakevenPrice).toBeGreaterThan(100); // Slightly above entry
    });

    it('should activate trailing stop after second target', () => {
      const position: ProfitPosition = {
        id: 'test-5',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 101.5,
        unrealizedPnL: 1.5,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      
      // Hit first target
      profitManager.checkProfitTargets(position, 101);
      
      // Hit second target
      const actions = profitManager.checkProfitTargets(position, 101.5);
      
      const trailingAction = actions.find(a => a.type === 'activate_trailing_stop');
      expect(trailingAction).toBeDefined();
      
      const status = profitManager.getTargetStatus(position.id);
      expect(status.trailingActive).toBe(true);
    });

    it('should trigger all three targets sequentially', () => {
      const position: ProfitPosition = {
        id: 'test-6',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      
      // Hit all targets
      profitManager.checkProfitTargets(position, 101);
      profitManager.checkProfitTargets(position, 101.5);
      profitManager.checkProfitTargets(position, 102);
      
      const status = profitManager.getTargetStatus(position.id);
      
      expect(status.targets[0].executed).toBe(true);
      expect(status.targets[1].executed).toBe(true);
      expect(status.targets[2].executed).toBe(true);
    });
  });

  describe('Breakeven Stop', () => {
    it('should trigger breakeven stop when price falls back', () => {
      const position: ProfitPosition = {
        id: 'test-7',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 0.67, // After first partial exit
        initialSize: 1,
        notionalValue: 67,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      profitManager.checkProfitTargets(position, 101); // Hit first target
      
      // Price falls back to breakeven level
      const breakevenAction = profitManager.checkBreakevenStop(position, 100.05);
      
      expect(breakevenAction).toBeDefined();
      expect(breakevenAction?.type).toBe('full_exit');
    });
  });

  describe('Trailing Stop', () => {
    it('should update trailing stop as price rises', () => {
      const position: ProfitPosition = {
        id: 'test-8',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 0.34,
        initialSize: 1,
        notionalValue: 35,
        unrealizedPnL: 1,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      profitManager.checkProfitTargets(position, 101);
      profitManager.checkProfitTargets(position, 101.5);
      
      // Price continues to rise
      const newStop = profitManager.updateTrailingStop(position, 103);
      
      expect(newStop).toBeDefined();
      expect(newStop).toBeGreaterThan(102); // Stop should trail the price
    });
  });

  describe('Cleanup', () => {
    it('should clean up position data', () => {
      const position: ProfitPosition = {
        id: 'test-9',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      profitManager.initializeProfitTargets(position);
      expect(profitManager.getActivePositions()).toContain(position.id);
      
      profitManager.cleanupPosition(position.id);
      expect(profitManager.getActivePositions()).not.toContain(position.id);
    });
  });
});

describe('IntegratedExitManager', () => {
  let exitManager: IntegratedExitManager;

  beforeEach(() => {
    exitManager = new IntegratedExitManager();
  });

  describe('Position Registration', () => {
    it('should register a position for management', () => {
      const position: ManagedPosition = {
        id: 'test-1',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      exitManager.registerPosition(position);
      
      const registered = exitManager.getPosition(position.id);
      expect(registered).toBeDefined();
      expect(registered?.symbol).toBe('BTCUSDT');
    });

    it('should initialize profit targets on registration', () => {
      const position: ManagedPosition = {
        id: 'test-2',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      exitManager.registerPosition(position);
      
      const status = exitManager.getProfitTargetStatus(position.id);
      expect(status.targets).toHaveLength(3);
    });
  });

  describe('Exit Decision Making', () => {
    it('should return no exit when conditions are normal', async () => {
      const position: ManagedPosition = {
        id: 'test-3',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      exitManager.registerPosition(position);
      
      const candles = createMockCandles(100, 20, 0.01);
      const decision = await exitManager.updatePosition(position.id, 100, candles);
      
      expect(decision.shouldExit).toBe(false);
      expect(decision.exitType).toBe('none');
    });

    it('should trigger partial exit at profit target', async () => {
      const position: ManagedPosition = {
        id: 'test-4',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 101,
        unrealizedPnL: 1,
        openTime: Date.now(),
      };
      
      exitManager.registerPosition(position);
      
      const candles = createMockCandles(100, 20, 0.01);
      const decision = await exitManager.updatePosition(position.id, 101, candles);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.exitType).toBe('partial');
      expect(decision.exitSize).toBeCloseTo(0.33, 2);
    });

    it('should trigger full exit on max time', async () => {
      const position: ManagedPosition = {
        id: 'test-5',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now() - (5 * 60 * 60 * 1000), // 5 hours ago
      };
      
      exitManager.registerPosition(position);
      
      const candles = createMockCandles(100, 20, 0.01);
      const decision = await exitManager.updatePosition(position.id, 100, candles);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.exitType).toBe('full');
      expect(decision.reason).toContain('Max hold time');
    });

    it('should trigger full exit on drawdown protection', async () => {
      const position: ManagedPosition = {
        id: 'test-6',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 95, // 5% down
        unrealizedPnL: -5,
        openTime: Date.now() - 3600000,
      };
      
      exitManager.registerPosition(position);
      
      const candles = createMockCandles(95, 20, 0.01);
      const decision = await exitManager.updatePosition(position.id, 95, candles);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.exitType).toBe('full');
      // Either ATR stop or drawdown protection can trigger - both are valid immediate exits
      expect(decision.urgency).toBe('immediate');
    });
  });

  describe('Configuration', () => {
    it('should allow disabling specific exit types', async () => {
      // Create a fresh exit manager with time-based exits disabled
      const customExitManager = new IntegratedExitManager({
        enableTimeBasedExits: false,
        enableStructureExits: false, // Also disable structure to isolate test
        enableDrawdownProtection: false,
      });
      
      const position: ManagedPosition = {
        id: 'test-7',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now() - (5 * 60 * 60 * 1000), // 5 hours ago
      };
      
      customExitManager.registerPosition(position);
      
      const candles = createMockCandles(100, 20, 0.01);
      const decision = await customExitManager.updatePosition(position.id, 100, candles);
      
      // With all structure/time exits disabled, should NOT trigger exit
      expect(decision.shouldExit).toBe(false);
    });

    it('should return current configuration', () => {
      const config = exitManager.getConfig();
      
      expect(config.enableStructureExits).toBe(true);
      expect(config.enableLayeredProfits).toBe(true);
      // TradingConfig.exits.maxWinnerTimeMinutes = 120 → 120/60 = 2 hours
      expect(config.maxHoldTimeHours).toBe(2);
      expect(config.maxDrawdownPercent).toBe(0.02);
    });
  });

  describe('Position Removal', () => {
    it('should remove position from management', () => {
      const position: ManagedPosition = {
        id: 'test-8',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now(),
      };
      
      exitManager.registerPosition(position);
      expect(exitManager.getPosition(position.id)).toBeDefined();
      
      exitManager.removePosition(position.id);
      expect(exitManager.getPosition(position.id)).toBeUndefined();
    });
  });

  describe('Statistics', () => {
    it('should return statistics', () => {
      const position1: ManagedPosition = {
        id: 'test-9',
        symbol: 'BTCUSDT',
        direction: 'long',
        averagePrice: 100,
        currentSize: 1,
        initialSize: 1,
        notionalValue: 100,
        unrealizedPnL: 0,
        openTime: Date.now() - 3600000, // 1 hour ago
      };
      
      const position2: ManagedPosition = {
        id: 'test-10',
        symbol: 'ETHUSDT',
        direction: 'short',
        averagePrice: 3000,
        currentSize: 0.5,
        initialSize: 0.5,
        notionalValue: 1500,
        unrealizedPnL: 0,
        openTime: Date.now() - 7200000, // 2 hours ago
      };
      
      exitManager.registerPosition(position1);
      exitManager.registerPosition(position2);
      
      const stats = exitManager.getStatistics();
      
      expect(stats.activePositions).toBe(2);
      expect(stats.avgHoldTime).toBeGreaterThan(60); // At least 60 minutes average
    });
  });
});

describe('Exit System Integration', () => {
  it('should prioritize immediate structure exits over profit targets', async () => {
    const exitManager = new IntegratedExitManager();
    
    const position: ManagedPosition = {
      id: 'test-integration-1',
      symbol: 'BTCUSDT',
      direction: 'long',
      averagePrice: 100,
      currentSize: 1,
      initialSize: 1,
      notionalValue: 95, // 5% down (triggers drawdown protection)
      unrealizedPnL: -5,
      openTime: Date.now() - 3600000,
    };
    
    exitManager.registerPosition(position);
    
    const candles = createMockCandles(95, 20, 0.01);
    const decision = await exitManager.updatePosition(position.id, 95, candles);
    
    // Should trigger drawdown protection (immediate) not profit target
    expect(decision.shouldExit).toBe(true);
    expect(decision.urgency).toBe('immediate');
    expect(decision.details.triggeredBy).toContain('structure');
  });

  it('should handle multiple profit targets in sequence', async () => {
    const exitManager = new IntegratedExitManager();
    
    const position: ManagedPosition = {
      id: 'test-integration-2',
      symbol: 'BTCUSDT',
      direction: 'long',
      averagePrice: 100,
      currentSize: 1,
      initialSize: 1,
      notionalValue: 100,
      unrealizedPnL: 0,
      openTime: Date.now(),
    };
    
    exitManager.registerPosition(position);
    
    const candles = createMockCandles(100, 20, 0.01);
    
    // First target at +1%
    let decision = await exitManager.updatePosition(position.id, 101, candles);
    expect(decision.exitType).toBe('partial');
    
    // Update position after partial exit
    const updatedPosition = exitManager.getPosition(position.id);
    if (updatedPosition) {
      updatedPosition.currentSize = 0.67;
    }
    
    // Second target at +1.5%
    decision = await exitManager.updatePosition(position.id, 101.5, candles);
    expect(decision.exitType).toBe('partial');
  });
});
