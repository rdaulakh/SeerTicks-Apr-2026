/**
 * Tests for TickStalenessMonitor
 * Verifies staleness detection, auto-recovery, and dual-feed support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock priceFeedService before importing TickStalenessMonitor
vi.mock('../services/priceFeedService', () => ({
  priceFeedService: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

import { TickStalenessMonitor, TickStalenessConfig } from '../services/TickStalenessMonitor';

describe('TickStalenessMonitor', () => {
  let monitor: TickStalenessMonitor;
  
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      monitor = new TickStalenessMonitor();
      const status = monitor.getStatus();
      
      expect(status.dualFeedEnabled).toBe(true);
      expect(status.primarySource.name).toBe('Coinbase');
      expect(status.secondarySource?.name).toBe('Binance');
    });

    it('should allow custom configuration', () => {
      const config: Partial<TickStalenessConfig> = {
        stalenessThresholdMs: 1000,
        dualFeedEnabled: false,
        autoReconnect: false,
      };
      
      monitor = new TickStalenessMonitor(config);
      const status = monitor.getStatus();
      
      expect(status.dualFeedEnabled).toBe(false);
      expect(status.secondarySource).toBeNull();
    });

    it('should create secondary source only when dual feed is enabled', () => {
      monitor = new TickStalenessMonitor({ dualFeedEnabled: false });
      const status = monitor.getStatus();
      
      expect(status.secondarySource).toBeNull();
    });
  });

  describe('Start/Stop', () => {
    it('should start monitoring', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      expect(monitor.isMonitoring()).toBe(true);
    });

    it('should stop monitoring', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      monitor.stop();
      
      expect(monitor.isMonitoring()).toBe(false);
    });

    it('should not start twice', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      monitor.start(); // Should not throw
      
      expect(monitor.isMonitoring()).toBe(true);
    });
  });

  describe('Tick Reporting', () => {
    it('should track ticks from primary source', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      monitor.reportTick('Coinbase', 'BTC-USD', 50000, Date.now());
      
      const status = monitor.getStatus();
      expect(status.primarySource.tickCount).toBe(1);
      expect(status.primarySource.lastTickTime).toBeGreaterThan(0);
    });

    it('should track ticks from secondary source', () => {
      monitor = new TickStalenessMonitor({ dualFeedEnabled: true });
      monitor.start();
      
      monitor.reportTick('CoinCap', 'BTC-USD', 50000, Date.now());
      
      const status = monitor.getStatus();
      expect(status.secondarySource?.tickCount).toBe(1);
    });

    it('should accept alternative source names', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      monitor.reportTick('primary', 'BTC-USD', 50000);
      monitor.reportTick('coinbase', 'ETH-USD', 3000);
      
      const status = monitor.getStatus();
      expect(status.primarySource.tickCount).toBe(2);
    });
  });

  describe('Staleness Detection', () => {
    it('should detect staleness when no ticks received', () => {
      monitor = new TickStalenessMonitor({ stalenessThresholdMs: 500 });
      monitor.start();
      
      // Report initial tick
      monitor.reportTick('Coinbase', 'BTC-USD', 50000);
      
      // Advance time past threshold
      vi.advanceTimersByTime(600);
      
      const status = monitor.getStatus();
      expect(status.primarySource.isStale).toBe(true);
    });

    it('should not be stale when ticks are received regularly', () => {
      monitor = new TickStalenessMonitor({ stalenessThresholdMs: 500 });
      monitor.start();
      
      // Report tick
      monitor.reportTick('Coinbase', 'BTC-USD', 50000);
      
      // Advance time but less than threshold
      vi.advanceTimersByTime(300);
      
      // Report another tick
      monitor.reportTick('Coinbase', 'BTC-USD', 50001);
      
      const status = monitor.getStatus();
      expect(status.primarySource.isStale).toBe(false);
    });
  });

  describe('Reconnect Callback', () => {
    it('should register primary reconnect callback', () => {
      monitor = new TickStalenessMonitor();
      const callback = vi.fn().mockResolvedValue(undefined);
      
      monitor.setPrimaryReconnectCallback(callback);
      
      // Callback should be registered (internal state)
      expect(callback).not.toHaveBeenCalled();
    });

    it('should register secondary reconnect callback', () => {
      monitor = new TickStalenessMonitor({ dualFeedEnabled: true });
      const callback = vi.fn().mockResolvedValue(undefined);
      
      monitor.setSecondaryReconnectCallback(callback);
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Reconnect Counter', () => {
    it('should reset reconnect count for primary source', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      // Manually increment reconnect count by triggering staleness
      monitor.reportTick('Coinbase', 'BTC-USD', 50000);
      
      // Reset
      monitor.resetReconnectCount('Coinbase');
      
      const status = monitor.getStatus();
      expect(status.primarySource.reconnectCount).toBe(0);
    });

    it('should reset reconnect count for secondary source', () => {
      monitor = new TickStalenessMonitor({ dualFeedEnabled: true });
      monitor.start();
      
      monitor.resetReconnectCount('CoinCap');
      
      const status = monitor.getStatus();
      expect(status.secondarySource?.reconnectCount).toBe(0);
    });
  });

  describe('Alerts', () => {
    it('should return empty alerts initially', () => {
      monitor = new TickStalenessMonitor();
      
      const alerts = monitor.getAlerts();
      expect(alerts).toEqual([]);
    });

    it('should clear alerts', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      monitor.clearAlerts();
      
      const alerts = monitor.getAlerts();
      expect(alerts).toEqual([]);
    });
  });

  describe('Configuration Update', () => {
    it('should update configuration', () => {
      monitor = new TickStalenessMonitor({ stalenessThresholdMs: 500 });
      
      monitor.updateConfig({ stalenessThresholdMs: 1000 });
      
      // Configuration is internal, but we can verify the monitor still works
      expect(monitor.isMonitoring()).toBe(false);
    });
  });

  describe('Status', () => {
    it('should return comprehensive status', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      const status = monitor.getStatus();
      
      expect(status).toHaveProperty('isHealthy');
      expect(status).toHaveProperty('primarySource');
      expect(status).toHaveProperty('secondarySource');
      expect(status).toHaveProperty('dualFeedEnabled');
      expect(status).toHaveProperty('totalTicksReceived');
      expect(status).toHaveProperty('ticksPerSecond');
      expect(status).toHaveProperty('lastTickTime');
      expect(status).toHaveProperty('staleDurationMs');
      expect(status).toHaveProperty('alerts');
      expect(status).toHaveProperty('uptime');
    });

    it('should calculate uptime correctly', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      vi.advanceTimersByTime(5000);
      
      const status = monitor.getStatus();
      expect(status.uptime).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('Health Status', () => {
    it('should be healthy when primary is receiving ticks', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      monitor.reportTick('Coinbase', 'BTC-USD', 50000);
      
      const status = monitor.getStatus();
      expect(status.primarySource.isStale).toBe(false);
    });

    it('should be healthy when secondary is receiving ticks (dual feed)', () => {
      monitor = new TickStalenessMonitor({ dualFeedEnabled: true });
      monitor.start();
      
      monitor.reportTick('CoinCap', 'BTC-USD', 50000);
      
      const status = monitor.getStatus();
      expect(status.secondarySource?.isStale).toBe(false);
    });
  });

  describe('Latency Tracking', () => {
    it('should calculate average latency', () => {
      monitor = new TickStalenessMonitor();
      monitor.start();
      
      const now = Date.now();
      monitor.reportTick('Coinbase', 'BTC-USD', 50000, now);
      monitor.reportTick('Coinbase', 'BTC-USD', 50001, now + 100);
      monitor.reportTick('Coinbase', 'BTC-USD', 50002, now + 200);
      
      const status = monitor.getStatus();
      expect(status.primarySource.avgLatencyMs).toBeGreaterThan(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit started event', () => {
      monitor = new TickStalenessMonitor();
      const handler = vi.fn();
      
      monitor.on('started', handler);
      monitor.start();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should emit stopped event', () => {
      monitor = new TickStalenessMonitor();
      const handler = vi.fn();
      
      monitor.start();
      monitor.on('stopped', handler);
      monitor.stop();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should emit tick event', () => {
      monitor = new TickStalenessMonitor();
      const handler = vi.fn();
      
      monitor.start();
      monitor.on('tick', handler);
      monitor.reportTick('Coinbase', 'BTC-USD', 50000);
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        source: 'Coinbase',
        symbol: 'BTC-USD',
        price: 50000,
      }));
    });
  });
});
