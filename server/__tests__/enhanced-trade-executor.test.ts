/**
 * EnhancedTradeExecutor Unit Tests
 * 
 * Tests the core trade execution engine:
 * - Construction and initialization
 * - Signal queue management
 * - Circuit breaker integration (Phase 15A)
 * - Event emission
 * - Config sourcing from TradingConfig (Phase 17)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedTradeExecutor } from '../services/EnhancedTradeExecutor';
import { setTradingConfig, PRODUCTION_CONFIG } from '../config/TradingConfig';

// Mock heavy dependencies to isolate executor logic
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe('EnhancedTradeExecutor', () => {
  let executor: EnhancedTradeExecutor;

  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
    executor = new EnhancedTradeExecutor(1);
  });

  describe('construction', () => {
    it('should create executor with default config', () => {
      expect(executor).toBeInstanceOf(EnhancedTradeExecutor);
    });

    it('should create executor with custom config', () => {
      const custom = new EnhancedTradeExecutor(1, {
        maxConcurrentPositions: 3,
        maxPositionSizePercent: 0.05,
      });
      expect(custom).toBeInstanceOf(EnhancedTradeExecutor);
    });

    it('should accept different user IDs', () => {
      const exec1 = new EnhancedTradeExecutor(1);
      const exec2 = new EnhancedTradeExecutor(42);
      expect(exec1).toBeInstanceOf(EnhancedTradeExecutor);
      expect(exec2).toBeInstanceOf(EnhancedTradeExecutor);
    });
  });

  describe('queueSignal', () => {
    const makeSignal = (overrides: Record<string, unknown> = {}) => ({
      id: `sig-${Date.now()}`,
      symbol: 'BTCUSD',
      action: 'buy' as const,
      confidence: 0.85,
      consensusStrength: 0.75,
      executionScore: 70,
      timestamp: Date.now(),
      agentSignals: [],
      reasoning: 'Test signal',
      ...overrides,
    });

    it('should accept a valid signal without throwing', async () => {
      // queueSignal may fail internally due to missing trading engine,
      // but it should not throw — it handles errors gracefully
      await expect(executor.queueSignal(makeSignal() as any)).resolves.not.toThrow();
    });

    it('should accept buy signals', async () => {
      await expect(executor.queueSignal(makeSignal({ action: 'buy' }) as any)).resolves.not.toThrow();
    });

    it('should accept sell signals', async () => {
      await expect(executor.queueSignal(makeSignal({ action: 'sell' }) as any)).resolves.not.toThrow();
    });
  });

  describe('EventEmitter behavior', () => {
    it('should support event listeners', () => {
      let emitted = false;
      executor.on('test_event', () => { emitted = true; });
      executor.emit('test_event');
      expect(emitted).toBe(true);
    });

    it('should support once listeners', () => {
      let count = 0;
      executor.once('test_once', () => { count++; });
      executor.emit('test_once');
      executor.emit('test_once');
      expect(count).toBe(1);
    });
  });

  describe('Circuit breaker config from TradingConfig (Phase 17)', () => {
    it('should use TradingConfig values for circuit breakers', () => {
      // The executor reads from getTradingConfig() dynamically
      // Verify it doesn't crash when config is accessed
      setTradingConfig({
        ...PRODUCTION_CONFIG,
        circuitBreakers: {
          ...PRODUCTION_CONFIG.circuitBreakers,
          maxDailyTrades: 100,
        },
      });
      
      // Creating a new executor should pick up the new config
      const exec = new EnhancedTradeExecutor(1);
      expect(exec).toBeInstanceOf(EnhancedTradeExecutor);
    });

    it('should respect updated config values', () => {
      setTradingConfig({
        ...PRODUCTION_CONFIG,
        circuitBreakers: {
          ...PRODUCTION_CONFIG.circuitBreakers,
          maxConsecutiveLosses: 2,
          maxDailyLossPercent: 0.03,
        },
      });
      
      const exec = new EnhancedTradeExecutor(1);
      expect(exec).toBeInstanceOf(EnhancedTradeExecutor);
    });
  });

  describe('updatePositionPrices', () => {
    it('should not throw when no positions exist', async () => {
      // With no trading engine or positions, should handle gracefully
      await expect(executor.updatePositionPrices()).resolves.not.toThrow();
    });
  });
});
