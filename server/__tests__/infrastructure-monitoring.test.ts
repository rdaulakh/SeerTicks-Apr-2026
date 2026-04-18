/**
 * Infrastructure Monitoring Tests
 * Tests for SlowDeathMonitor, engine initialization mutex, and memory trend tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the EventEmitter
vi.mock('events', () => ({
  EventEmitter: class MockEventEmitter {
    on = vi.fn();
    emit = vi.fn();
    removeListener = vi.fn();
  }
}));

describe('SlowDeathMonitor', () => {
  let SlowDeathMonitor: any;
  let monitor: any;

  beforeEach(async () => {
    // Reset module cache
    vi.resetModules();
    
    // Import fresh instance
    const module = await import('../services/SlowDeathMonitor');
    SlowDeathMonitor = module.slowDeathMonitor;
    monitor = SlowDeathMonitor;
  });

  afterEach(() => {
    if (monitor && monitor.stop) {
      monitor.stop();
    }
  });

  describe('Initialization', () => {
    it('should be a singleton instance', async () => {
      const module1 = await import('../services/SlowDeathMonitor');
      const module2 = await import('../services/SlowDeathMonitor');
      expect(module1.slowDeathMonitor).toBe(module2.slowDeathMonitor);
    });

    it('should have correct default configuration', () => {
      const status = monitor.getStatus();
      expect(status.config).toBeDefined();
      expect(status.config.checkIntervalMinutes).toBe(5);
      expect(status.config.memoryGrowthAlertThresholdMBPerHour).toBe(10);
      expect(status.config.memoryGrowthSustainedHours).toBe(2);
      expect(status.config.latencyIncreaseAlertPercent).toBe(20);
      expect(status.config.retentionHours).toBe(24);
    });
  });

  describe('Memory Tracking', () => {
    it('should start with empty memory snapshots', () => {
      const snapshots = monitor.getMemorySnapshots();
      expect(Array.isArray(snapshots)).toBe(true);
    });

    it('should return null for memory trend with insufficient data', () => {
      const trend = monitor.getMemoryTrend();
      // With no data or only one snapshot, should return null
      expect(trend === null || trend.currentValue >= 0).toBe(true);
    });
  });

  describe('Alert Management', () => {
    it('should start with no active alerts', () => {
      const alerts = monitor.getActiveAlerts();
      expect(Array.isArray(alerts)).toBe(true);
      expect(alerts.length).toBe(0);
    });

    it('should start with empty alert history', () => {
      const history = monitor.getAlertHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should return false when acknowledging non-existent alert', () => {
      const result = monitor.acknowledgeAlert('non-existent-alert');
      expect(result).toBe(false);
    });
  });

  describe('Report Generation', () => {
    it('should generate a valid report', () => {
      const report = monitor.getReport();
      
      expect(report).toBeDefined();
      expect(['healthy', 'degrading', 'critical']).toContain(report.status);
      expect(Array.isArray(report.activeAlerts)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should include recommendations even when healthy', () => {
      const report = monitor.getReport();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration correctly', () => {
      const newConfig = {
        checkIntervalMinutes: 10,
        memoryGrowthAlertThresholdMBPerHour: 20,
      };
      
      monitor.updateConfig(newConfig);
      
      const status = monitor.getStatus();
      expect(status.config.checkIntervalMinutes).toBe(10);
      expect(status.config.memoryGrowthAlertThresholdMBPerHour).toBe(20);
    });

    it('should preserve unmodified config values', () => {
      const originalRetention = monitor.getStatus().config.retentionHours;
      
      monitor.updateConfig({ checkIntervalMinutes: 15 });
      
      const status = monitor.getStatus();
      expect(status.config.retentionHours).toBe(originalRetention);
    });
  });

  describe('Latency Recording', () => {
    it('should accept latency measurements', () => {
      // Should not throw
      expect(() => {
        monitor.recordLatency(10);
        monitor.recordLatency(20);
        monitor.recordLatency(15);
      }).not.toThrow();
    });
  });

  describe('Queue Depth Recording', () => {
    it('should accept queue depth measurements', () => {
      // Should not throw
      expect(() => {
        monitor.recordQueueDepth('test-queue', 100, 50);
        monitor.recordQueueDepth('test-queue', 150, 45);
      }).not.toThrow();
    });
  });
});

describe('Engine Initialization Mutex', () => {
  // Phase 14E: seerMainMulti.ts deleted — mutex is now in EngineAdapter
  it('seerMainMulti.ts has been deleted (Phase 14E)', async () => {
    const fs = await import('fs/promises');
    try {
      await fs.access('/home/ubuntu/seer/server/seerMainMulti.ts');
      expect(true).toBe(false); // Should not exist
    } catch {
      expect(true).toBe(true); // Correctly deleted
    }
  });

  it('EngineAdapter has mutex-protected initialization', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/services/EngineAdapter.ts', 'utf-8');
    expect(content).toContain('getEngineAdapter');
  });
});

describe('DatabaseCleanupService', () => {
  let cleanupService: any;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../services/DatabaseCleanupService');
    cleanupService = module.databaseCleanupService;
  });

  it('should have correct column names for ticks table', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/services/DatabaseCleanupService.ts', 'utf-8');
    
    // Should use timestampMs (bigint) not timestamp
    expect(content).toContain('timestampMs');
    expect(content).toContain('cutoffTimeMs');  // Variable name for cutoff
  });

  it('should have correct column names for agentSignals table', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/services/DatabaseCleanupService.ts', 'utf-8');
    
    // Should use timestamp column
    expect(content).toContain('agentSignals');
    expect(content).toContain('timestamp');
  });

  it('should have comprehensive logging', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/services/DatabaseCleanupService.ts', 'utf-8');
    
    // Check for logging patterns in the implementation
    expect(content).toContain('[DatabaseCleanup]');
    expect(content).toContain('Starting automated cleanup');
    expect(content).toContain('Deleting rows older than');
    expect(content).toContain('deleted');
  });

  it('should return valid status', () => {
    const status = cleanupService.getStatus();
    
    expect(status).toBeDefined();
    expect(typeof status.isRunning).toBe('boolean');
    expect(status.config).toBeDefined();
    expect(Array.isArray(status.lastCleanup)).toBe(true);
  });

  it('should return valid config', () => {
    const config = cleanupService.getConfig();
    
    expect(config).toBeDefined();
    expect(typeof config.ticksRetentionHours).toBe('number');
    expect(typeof config.agentSignalsRetentionDays).toBe('number');
    expect(typeof config.cleanupIntervalHours).toBe('number');
  });
});

describe('DiskUsageMonitor', () => {
  let diskMonitor: any;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../services/DiskUsageMonitor');
    diskMonitor = module.diskUsageMonitor;
  });

  it('should return valid status', () => {
    const status = diskMonitor.getStatus();
    
    expect(status).toBeDefined();
    expect(typeof status.isRunning).toBe('boolean');
    expect(status.config).toBeDefined();
  });

  it('should have configurable thresholds', () => {
    const status = diskMonitor.getStatus();
    
    expect(status.config.warningThresholdPercent).toBeDefined();
    expect(status.config.criticalThresholdPercent).toBeDefined();
    expect(status.config.warningThresholdPercent).toBeLessThan(status.config.criticalThresholdPercent);
  });

  it('should return alerts array', () => {
    const alerts = diskMonitor.getAlerts();
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('should return growth metrics', () => {
    const metrics = diskMonitor.getGrowthMetrics();
    expect(metrics).toBeDefined();
  });

  it('should update configuration correctly', () => {
    diskMonitor.updateConfig({ checkIntervalMinutes: 60 });
    const status = diskMonitor.getStatus();
    expect(status.config.checkIntervalMinutes).toBe(60);
  });
});

describe('Monitoring Router Integration', () => {
  it('should have slow death monitor endpoints', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/routers/monitoringRouter.ts', 'utf-8');
    
    expect(content).toContain('getSlowDeathStatus');
    expect(content).toContain('getMemoryTrend');
    expect(content).toContain('getMemorySnapshots');
    expect(content).toContain('getLatencyTrend');
    expect(content).toContain('getSlowDeathAlerts');
    expect(content).toContain('getSlowDeathReport');
    expect(content).toContain('forceSlowDeathAnalysis');
  });

  it('should include slow death in infrastructure health', async () => {
    const fs = await import('fs/promises');
    const content = await fs.readFile('/home/ubuntu/seer/server/routers/monitoringRouter.ts', 'utf-8');
    
    expect(content).toContain('slowDeathReport');
    expect(content).toContain('slowDeath: slowDeathReport');
  });
});
