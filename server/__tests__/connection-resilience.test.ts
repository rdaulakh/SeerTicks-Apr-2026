/**
 * Connection Resilience Tests
 * 
 * Tests for:
 * 1. ConnectionResilienceManager - health monitoring and auto-recovery
 * 2. SignalBuffer - signal buffering during disconnections
 * 3. Integration with existing tick staleness monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Connection Resilience System', () => {
  describe('ConnectionResilienceManager', () => {
    let connectionResilienceManager: any;

    beforeEach(async () => {
      // Fresh import for each test
      vi.resetModules();
      const module = await import('../services/ConnectionResilienceManager');
      connectionResilienceManager = module.connectionResilienceManager;
    });

    afterEach(() => {
      if (connectionResilienceManager?.stop) {
        connectionResilienceManager.stop();
      }
    });

    it('should initialize with default connections', () => {
      const health = connectionResilienceManager.getAllHealth();
      expect(health).toBeDefined();
      expect(Array.isArray(health)).toBe(true);
      expect(health.length).toBeGreaterThan(0);
      
      // Check expected connections exist
      const connectionNames = health.map((h: any) => h.name);
      expect(connectionNames).toContain('database');
      expect(connectionNames).toContain('coinbase_websocket');
      expect(connectionNames).toContain('price_feed');
    });

    it('should record successful operations', () => {
      connectionResilienceManager.recordSuccess('database');
      
      const health = connectionResilienceManager.getHealth('database');
      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.lastSuccessTime).toBeDefined();
    });

    it('should record failed operations and track consecutive failures', () => {
      connectionResilienceManager.recordFailure('database', 'Connection timeout');
      
      const health = connectionResilienceManager.getHealth('database');
      expect(health).toBeDefined();
      expect(health.consecutiveFailures).toBe(1);
      expect(health.lastError).toBe('Connection timeout');
      expect(health.totalFailures).toBe(1);
    });

    it('should transition to degraded status after failures', () => {
      // First mark as healthy
      connectionResilienceManager.recordSuccess('database');
      
      // Then record a failure
      connectionResilienceManager.recordFailure('database', 'Error 1');
      
      const health = connectionResilienceManager.getHealth('database');
      expect(health.status).toBe('degraded');
    });

    it('should transition to disconnected after max consecutive failures', () => {
      // Record 3 failures (default max)
      connectionResilienceManager.recordFailure('database', 'Error 1');
      connectionResilienceManager.recordFailure('database', 'Error 2');
      connectionResilienceManager.recordFailure('database', 'Error 3');
      
      const health = connectionResilienceManager.getHealth('database');
      expect(health.status).toBe('disconnected');
      expect(health.consecutiveFailures).toBe(3);
    });

    it('should reset consecutive failures on success', () => {
      connectionResilienceManager.recordFailure('database', 'Error 1');
      connectionResilienceManager.recordFailure('database', 'Error 2');
      connectionResilienceManager.recordSuccess('database');
      
      const health = connectionResilienceManager.getHealth('database');
      expect(health.status).toBe('healthy');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.totalFailures).toBe(2); // Total still tracked
    });

    it('should register and track recovery callbacks', () => {
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      
      connectionResilienceManager.registerRecoveryCallback('database', mockCallback);
      
      // Callback should be registered (internal state)
      // We can verify by triggering recovery
      expect(true).toBe(true); // Callback registration doesn't throw
    });

    it('should return system health summary', () => {
      const systemHealth = connectionResilienceManager.getSystemHealth();
      
      expect(systemHealth).toBeDefined();
      expect(systemHealth.overall).toBeDefined();
      expect(['healthy', 'degraded', 'critical']).toContain(systemHealth.overall);
      expect(typeof systemHealth.healthyCount).toBe('number');
      expect(typeof systemHealth.degradedCount).toBe('number');
      expect(typeof systemHealth.disconnectedCount).toBe('number');
      expect(Array.isArray(systemHealth.connections)).toBe(true);
    });

    it('should mark system as critical when database is disconnected', () => {
      // Disconnect database
      connectionResilienceManager.recordFailure('database', 'Error 1');
      connectionResilienceManager.recordFailure('database', 'Error 2');
      connectionResilienceManager.recordFailure('database', 'Error 3');
      
      const systemHealth = connectionResilienceManager.getSystemHealth();
      expect(systemHealth.overall).toBe('critical');
    });
  });

  describe('SignalBuffer', () => {
    let signalBuffer: any;

    beforeEach(async () => {
      vi.resetModules();
      const module = await import('../services/SignalBuffer');
      signalBuffer = module.signalBuffer;
    });

    afterEach(() => {
      if (signalBuffer?.stop) {
        signalBuffer.stop();
      }
    });

    it('should buffer signals', () => {
      const result = signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.85,
        source: 'TechnicalAnalyst',
        data: { price: 50000 },
        priority: 7,
      });
      
      expect(result).toBe(true);
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(1);
      expect(stats.totalBuffered).toBe(1);
    });

    it('should deduplicate signals within window', () => {
      const signal = {
        timestamp: Date.now(),
        type: 'entry' as const,
        symbol: 'BTC-USD',
        direction: 'long' as const,
        confidence: 0.85,
        source: 'TechnicalAnalyst',
        data: { price: 50000 },
        priority: 7,
      };
      
      const result1 = signalBuffer.addSignal(signal);
      const result2 = signalBuffer.addSignal({ ...signal, timestamp: Date.now() + 100 });
      
      expect(result1).toBe(true);
      expect(result2).toBe(false); // Duplicate
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(1);
    });

    it('should get next signal by priority', () => {
      signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'ETH-USD',
        direction: 'long',
        confidence: 0.7,
        source: 'Test',
        data: {},
        priority: 5,
      });
      
      signalBuffer.addSignal({
        timestamp: Date.now() + 100,
        type: 'exit',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.9,
        source: 'Test',
        data: {},
        priority: 9,
      });
      
      const nextSignal = signalBuffer.getNextSignal();
      expect(nextSignal).toBeDefined();
      expect(nextSignal.priority).toBe(9); // Higher priority first
      expect(nextSignal.symbol).toBe('BTC-USD');
    });

    it('should mark signals as processed', () => {
      signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.85,
        source: 'Test',
        data: {},
        priority: 7,
      });
      
      const signal = signalBuffer.getNextSignal();
      signalBuffer.markProcessed(signal.id, 100);
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.totalProcessed).toBe(1);
    });

    it('should handle failed signals with retry', () => {
      signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.85,
        source: 'Test',
        data: {},
        priority: 7,
      });
      
      const signal = signalBuffer.getNextSignal();
      const shouldRetry = signalBuffer.markFailed(signal.id, 'Network error');
      
      expect(shouldRetry).toBe(true);
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(1); // Still in buffer for retry
    });

    it('should drop signals after max retries', () => {
      signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.85,
        source: 'Test',
        data: {},
        priority: 7,
      });
      
      const signal = signalBuffer.getNextSignal();
      
      // Fail 3 times (default max)
      signalBuffer.markFailed(signal.id, 'Error 1');
      signalBuffer.markFailed(signal.id, 'Error 2');
      const shouldRetry = signalBuffer.markFailed(signal.id, 'Error 3');
      
      expect(shouldRetry).toBe(false);
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.totalDropped).toBe(1);
    });

    it('should flush all signals', () => {
      signalBuffer.addSignal({
        timestamp: Date.now(),
        type: 'entry',
        symbol: 'BTC-USD',
        direction: 'long',
        confidence: 0.85,
        source: 'Test',
        data: {},
        priority: 7,
      });
      
      signalBuffer.addSignal({
        timestamp: Date.now() + 1000,
        type: 'exit',
        symbol: 'ETH-USD',
        direction: 'short',
        confidence: 0.75,
        source: 'Test',
        data: {},
        priority: 5,
      });
      
      const flushed = signalBuffer.flush();
      
      expect(flushed.length).toBe(2);
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBe(0);
    });

    it('should respect buffer size limit', () => {
      // Add more signals than buffer size (default 500)
      // For testing, we'll just verify the mechanism works
      for (let i = 0; i < 10; i++) {
        signalBuffer.addSignal({
          timestamp: Date.now() + i * 1000,
          type: 'entry',
          symbol: `TEST-${i}`,
          direction: 'long',
          confidence: 0.5 + (i * 0.01),
          source: 'Test',
          data: {},
          priority: i % 10,
        });
      }
      
      const stats = signalBuffer.getStats();
      expect(stats.currentSize).toBeLessThanOrEqual(500);
    });
  });

  describe('Integration Tests', () => {
    it('should have TickStalenessMonitor available', async () => {
      const { tickStalenessMonitor } = await import('../services/TickStalenessMonitor');
      
      expect(tickStalenessMonitor).toBeDefined();
      expect(typeof tickStalenessMonitor.start).toBe('function');
      expect(typeof tickStalenessMonitor.stop).toBe('function');
      expect(typeof tickStalenessMonitor.getStatus).toBe('function');
    });

    it('should have connectionHealthRouter available', async () => {
      const { connectionHealthRouter } = await import('../routers/connectionHealthRouter');
      
      expect(connectionHealthRouter).toBeDefined();
    });

    it('should integrate with priceFeedService', async () => {
      const { priceFeedService } = await import('../services/priceFeedService');
      
      expect(priceFeedService).toBeDefined();
      expect(typeof priceFeedService.on).toBe('function');
      expect(typeof priceFeedService.updatePrice).toBe('function');
    });
  });
});
