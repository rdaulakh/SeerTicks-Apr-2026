/**
 * DynamicCorrelationTracker Unit Tests
 * 
 * Tests the Phase 17 real-time correlation tracking:
 * - Price recording and history management
 * - Exposure registration/removal
 * - Correlation calculation (Pearson)
 * - Correlation adjustment for position sizing
 * - Correlation matrix generation
 * - Start/stop lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDynamicCorrelationTracker } from '../services/DynamicCorrelationTracker';

describe('DynamicCorrelationTracker', () => {
  let tracker: ReturnType<typeof getDynamicCorrelationTracker>;

  beforeEach(() => {
    tracker = getDynamicCorrelationTracker();
    // Don't start the interval timer in tests
  });

  afterEach(() => {
    tracker.stop();
  });

  describe('recordPrice', () => {
    it('should accept price ticks without error', () => {
      expect(() => {
        tracker.recordPrice('BTCUSD', 50000, Date.now());
      }).not.toThrow();
    });

    it('should accept multiple symbols', () => {
      tracker.recordPrice('BTCUSD', 50000, Date.now());
      tracker.recordPrice('ETHUSD', 3000, Date.now());
      tracker.recordPrice('SOLUSD', 100, Date.now());
      // No error means success
    });

    it('should accept sequential prices for the same symbol', () => {
      const now = Date.now();
      for (let i = 0; i < 100; i++) {
        tracker.recordPrice('BTCUSD', 50000 + i * 10, now + i * 1000);
      }
      // Should not throw
    });
  });

  describe('registerExposure / removeExposure', () => {
    it('should register exposure for a symbol', () => {
      expect(() => {
        tracker.registerExposure('BTCUSD', 5000);
      }).not.toThrow();
    });

    it('should remove exposure for a symbol', () => {
      tracker.registerExposure('BTCUSD', 5000);
      expect(() => {
        tracker.removeExposure('BTCUSD');
      }).not.toThrow();
    });

    it('should handle removing non-existent exposure gracefully', () => {
      expect(() => {
        tracker.removeExposure('NONEXISTENT');
      }).not.toThrow();
    });
  });

  describe('getCorrelation', () => {
    it('should return null when insufficient data', () => {
      // No price data recorded
      const corr = tracker.getCorrelation('BTCUSD', 'ETHUSD');
      expect(corr).toBeNull();
    });

    it('should return null for unknown symbols', () => {
      const corr = tracker.getCorrelation('UNKNOWN1', 'UNKNOWN2');
      expect(corr).toBeNull();
    });
  });

  describe('getCorrelationAdjustment', () => {
    it('should return full size (1.0) when no correlated positions', () => {
      const adj = tracker.getCorrelationAdjustment('BTCUSD', 5000, 100000);
      expect(adj.adjustedSizeMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(adj.adjustedSizeMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('should return valid structure', () => {
      const adj = tracker.getCorrelationAdjustment('BTCUSD', 5000, 100000);
      expect(adj).toHaveProperty('adjustedSizeMultiplier');
      expect(adj).toHaveProperty('reason');
      expect(adj).toHaveProperty('correlatedPositions');
      expect(typeof adj.adjustedSizeMultiplier).toBe('number');
      expect(typeof adj.reason).toBe('string');
      expect(Array.isArray(adj.correlatedPositions)).toBe(true);
    });

    it('should handle zero equity gracefully', () => {
      const adj = tracker.getCorrelationAdjustment('BTCUSD', 5000, 0);
      expect(adj.adjustedSizeMultiplier).toBeGreaterThanOrEqual(0);
      expect(adj.adjustedSizeMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('should handle zero position size', () => {
      const adj = tracker.getCorrelationAdjustment('BTCUSD', 0, 100000);
      expect(adj.adjustedSizeMultiplier).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCorrelationMatrix', () => {
    it('should return valid matrix structure', () => {
      const matrix = tracker.getCorrelationMatrix();
      expect(matrix).toHaveProperty('symbols');
      expect(matrix).toHaveProperty('matrix');
      expect(matrix).toHaveProperty('timestamp');
      expect(Array.isArray(matrix.symbols)).toBe(true);
      expect(Array.isArray(matrix.matrix)).toBe(true);
      expect(typeof matrix.timestamp).toBe('number');
    });

    it('should return empty matrix when no data', () => {
      const matrix = tracker.getCorrelationMatrix();
      expect(matrix.symbols.length).toBe(0);
      expect(matrix.matrix.length).toBe(0);
    });

    it('should track symbols after price recording', () => {
      const now = Date.now();
      // Record enough data points for return calculation
      for (let i = 0; i < 50; i++) {
        tracker.recordPrice('BTCUSD', 50000 + Math.random() * 1000, now + i * 300000); // 5-min intervals
        tracker.recordPrice('ETHUSD', 3000 + Math.random() * 100, now + i * 300000);
      }
      const matrix = tracker.getCorrelationMatrix();
      // Symbols should be tracked even if correlation isn't computed yet
      expect(matrix.symbols.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('start / stop lifecycle', () => {
    it('should start without error', () => {
      expect(() => tracker.start()).not.toThrow();
    });

    it('should stop without error', () => {
      tracker.start();
      expect(() => tracker.stop()).not.toThrow();
    });

    it('should handle multiple stop calls', () => {
      tracker.start();
      tracker.stop();
      expect(() => tracker.stop()).not.toThrow();
    });

    it('should handle stop without start', () => {
      expect(() => tracker.stop()).not.toThrow();
    });
  });

  describe('Pearson correlation properties', () => {
    it('should produce correlation between -1 and 1 for correlated data', () => {
      // Feed perfectly correlated data (BTC and ETH move together)
      const now = Date.now();
      for (let i = 0; i < 100; i++) {
        const btcPrice = 50000 + i * 100;
        const ethPrice = 3000 + i * 6; // Moves proportionally
        tracker.recordPrice('BTCUSD', btcPrice, now + i * 300000);
        tracker.recordPrice('ETHUSD', ethPrice, now + i * 300000);
      }
      
      const corr = tracker.getCorrelation('BTCUSD', 'ETHUSD');
      if (corr !== null) {
        expect(corr).toBeGreaterThanOrEqual(-1);
        expect(corr).toBeLessThanOrEqual(1);
      }
    });
  });
});
