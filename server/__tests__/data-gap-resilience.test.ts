/**
 * DataGapResilience — Unit Tests
 * 
 * Tests the Phase 13E data gap resilience service including:
 * - Module exports
 * - Stats interface
 * - Singleton instance
 * - Lifecycle (stop)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock priceFeedService to avoid real connections
vi.mock('../services/priceFeedService', () => ({
  priceFeedService: {
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    getPrice: vi.fn().mockReturnValue(50000),
    getMonitoredSymbols: vi.fn().mockReturnValue(['BTC-USD', 'ETH-USD']),
    updatePrice: vi.fn(),
    emit: vi.fn(),
  },
}));

describe('DataGapResilience', () => {
  describe('module exports', () => {
    it('should export dataGapResilience singleton', async () => {
      const mod = await import('../services/DataGapResilience');
      expect(mod.dataGapResilience).toBeDefined();
    });

    it('should export ResilienceStats interface (used by singleton)', async () => {
      const mod = await import('../services/DataGapResilience');
      const stats = mod.dataGapResilience.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('stats', () => {
    it('should return stats with all required fields', async () => {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      const stats = dataGapResilience.getStats();
      
      expect(stats).toHaveProperty('restPollCount');
      expect(stats).toHaveProperty('restPollErrors');
      expect(stats).toHaveProperty('backfillCount');
      expect(stats).toHaveProperty('backfillTicksRecovered');
      expect(stats).toHaveProperty('gapsDetected');
      expect(stats).toHaveProperty('gapsRecoveredRapid');
      expect(stats).toHaveProperty('isRESTPolling');
      expect(stats).toHaveProperty('lastRESTPrice');
      expect(stats).toHaveProperty('lastBackfillAt');
      expect(stats).toHaveProperty('lastGapScanAt');
    });

    it('should have numeric stats fields', async () => {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      const stats = dataGapResilience.getStats();
      
      expect(typeof stats.restPollCount).toBe('number');
      expect(typeof stats.gapsDetected).toBe('number');
      expect(typeof stats.backfillCount).toBe('number');
    });

    it('should have boolean isRESTPolling field', async () => {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      const stats = dataGapResilience.getStats();
      
      expect(typeof stats.isRESTPolling).toBe('boolean');
    });
  });

  describe('lifecycle', () => {
    it('should stop without errors', async () => {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      expect(() => dataGapResilience.stop()).not.toThrow();
    });
  });

  describe('event emitter', () => {
    it('should be an EventEmitter', async () => {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      expect(typeof dataGapResilience.on).toBe('function');
      expect(typeof dataGapResilience.emit).toBe('function');
    });
  });
});
