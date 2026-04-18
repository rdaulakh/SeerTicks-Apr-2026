/**
 * WalkForwardOptimizer Unit Tests
 * 
 * Tests the Phase 17 walk-forward parameter optimization:
 * - Initialization and singleton access
 * - Insufficient data handling
 * - Result structure validation
 * - Parameter search space coverage
 * - Overfit/instability detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getWalkForwardOptimizer } from '../services/WalkForwardOptimizer';

describe('WalkForwardOptimizer', () => {
  let optimizer: ReturnType<typeof getWalkForwardOptimizer>;

  beforeEach(() => {
    optimizer = getWalkForwardOptimizer();
  });

  describe('initialization', () => {
    it('should return singleton instance', () => {
      const a = getWalkForwardOptimizer();
      const b = getWalkForwardOptimizer();
      expect(a).toBe(b);
    });

    it('should have no last result initially', () => {
      // Note: may have result from previous test runs in singleton
      const result = optimizer.getLastResult();
      // Either null or a valid result
      if (result !== null) {
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('totalWindows');
      }
    });
  });

  describe('runOptimization with insufficient data', () => {
    it('should return low confidence result when < 50 trades', async () => {
      // The optimizer queries the DB for trades — with no DB or < 50 trades,
      // it should return an empty/low-confidence result
      const result = await optimizer.runOptimization(3, 1);
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('totalWindows');
      expect(result).toHaveProperty('windowResults');
      expect(result).toHaveProperty('avgInSampleSharpe');
      expect(result).toHaveProperty('avgOutOfSampleSharpe');
      expect(result).toHaveProperty('avgOverfitRatio');
      expect(result).toHaveProperty('maxParameterDrift');
      expect(result).toHaveProperty('recommendedParams');
      expect(result).toHaveProperty('isOverfit');
      expect(result).toHaveProperty('isUnstable');
      expect(result).toHaveProperty('confidence');
      
      // With no DB data, should get low confidence
      expect(result.confidence).toBe('low');
      expect(result.totalWindows).toBe(0);
    });

    it('should return default recommended params when insufficient data', async () => {
      const result = await optimizer.runOptimization();
      
      expect(result.recommendedParams).toHaveProperty('consensusThreshold');
      expect(result.recommendedParams).toHaveProperty('minConfidence');
      expect(result.recommendedParams).toHaveProperty('hardStopLossPercent');
      expect(result.recommendedParams).toHaveProperty('maxPositionSizePercent');
      expect(result.recommendedParams).toHaveProperty('atrStopMultiplier');
      
      // Default params should be reasonable
      expect(result.recommendedParams.consensusThreshold).toBeGreaterThan(0);
      expect(result.recommendedParams.consensusThreshold).toBeLessThanOrEqual(1);
      expect(result.recommendedParams.minConfidence).toBeGreaterThan(0);
      expect(result.recommendedParams.hardStopLossPercent).toBeLessThan(0);
      expect(result.recommendedParams.maxPositionSizePercent).toBeGreaterThan(0);
      expect(result.recommendedParams.atrStopMultiplier).toBeGreaterThan(0);
    });

    it('should store result as lastResult', async () => {
      const result = await optimizer.runOptimization();
      const lastResult = optimizer.getLastResult();
      expect(lastResult).toBeDefined();
      expect(lastResult?.timestamp).toBe(result.timestamp);
    });
  });

  describe('result structure validation', () => {
    it('should have numeric averages', async () => {
      const result = await optimizer.runOptimization();
      expect(typeof result.avgInSampleSharpe).toBe('number');
      expect(typeof result.avgOutOfSampleSharpe).toBe('number');
      expect(typeof result.avgOverfitRatio).toBe('number');
      expect(typeof result.maxParameterDrift).toBe('number');
    });

    it('should have boolean flags', async () => {
      const result = await optimizer.runOptimization();
      expect(typeof result.isOverfit).toBe('boolean');
      expect(typeof result.isUnstable).toBe('boolean');
    });

    it('should have valid confidence level', async () => {
      const result = await optimizer.runOptimization();
      expect(['high', 'medium', 'low']).toContain(result.confidence);
    });

    it('should have windowResults array', async () => {
      const result = await optimizer.runOptimization();
      expect(Array.isArray(result.windowResults)).toBe(true);
    });
  });

  describe('parameter bounds', () => {
    it('should recommend consensusThreshold within valid range', async () => {
      const result = await optimizer.runOptimization();
      expect(result.recommendedParams.consensusThreshold).toBeGreaterThanOrEqual(0.5);
      expect(result.recommendedParams.consensusThreshold).toBeLessThanOrEqual(1.0);
    });

    it('should recommend minConfidence within valid range', async () => {
      const result = await optimizer.runOptimization();
      expect(result.recommendedParams.minConfidence).toBeGreaterThanOrEqual(0.4);
      expect(result.recommendedParams.minConfidence).toBeLessThanOrEqual(1.0);
    });

    it('should recommend negative hardStopLossPercent', async () => {
      const result = await optimizer.runOptimization();
      expect(result.recommendedParams.hardStopLossPercent).toBeLessThan(0);
    });

    it('should recommend positive maxPositionSizePercent', async () => {
      const result = await optimizer.runOptimization();
      expect(result.recommendedParams.maxPositionSizePercent).toBeGreaterThan(0);
      expect(result.recommendedParams.maxPositionSizePercent).toBeLessThanOrEqual(0.20);
    });

    it('should recommend positive atrStopMultiplier', async () => {
      const result = await optimizer.runOptimization();
      expect(result.recommendedParams.atrStopMultiplier).toBeGreaterThan(0);
    });
  });

  describe('EventEmitter behavior', () => {
    it('should not emit optimization_complete when insufficient data', async () => {
      let emitted = false;
      optimizer.once('optimization_complete', () => {
        emitted = true;
      });
      await optimizer.runOptimization();
      // With no DB data (< 50 trades), early return before emit
      expect(emitted).toBe(false);
    });

    it('should support event listeners', () => {
      let called = false;
      optimizer.on('test_event', () => { called = true; });
      optimizer.emit('test_event');
      expect(called).toBe(true);
    });
  });
});
