/**
 * AdaptiveConsensusEngine Unit Tests
 * 
 * Tests the Phase 16 adaptive consensus engine:
 * - Singleton access
 * - Start/stop lifecycle
 * - getStatus structure
 * - Weight adjustment from alpha validation results
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock DB
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe('AdaptiveConsensusEngine', () => {
  let getAdaptiveConsensusEngine: typeof import('../services/AdaptiveConsensusEngine').getAdaptiveConsensusEngine;

  beforeEach(async () => {
    const mod = await import('../services/AdaptiveConsensusEngine');
    getAdaptiveConsensusEngine = mod.getAdaptiveConsensusEngine;
  });

  afterEach(() => {
    const engine = getAdaptiveConsensusEngine(1);
    engine.stop();
  });

  describe('initialization', () => {
    it('should return singleton instance for same userId', () => {
      const a = getAdaptiveConsensusEngine(1);
      const b = getAdaptiveConsensusEngine(1);
      expect(a).toBe(b);
    });
  });

  describe('start / stop lifecycle', () => {
    it('should start without error', () => {
      const engine = getAdaptiveConsensusEngine(1);
      expect(() => engine.start()).not.toThrow();
    });

    it('should stop without error', () => {
      const engine = getAdaptiveConsensusEngine(1);
      engine.start();
      expect(() => engine.stop()).not.toThrow();
    });

    it('should handle multiple start calls', () => {
      const engine = getAdaptiveConsensusEngine(1);
      engine.start();
      expect(() => engine.start()).not.toThrow();
    });

    it('should handle stop without start', () => {
      const engine = getAdaptiveConsensusEngine(1);
      expect(() => engine.stop()).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return valid status structure', () => {
      const engine = getAdaptiveConsensusEngine(1);
      const status = engine.getStatus();
      
      expect(status).toHaveProperty('isActive');
      expect(status).toHaveProperty('lastUpdate');
      expect(status).toHaveProperty('totalUpdates');
      expect(status).toHaveProperty('currentWeights');
      expect(status).toHaveProperty('prunedAgents');
      expect(status).toHaveProperty('boostedAgents');
    });

    it('should have correct types in status', () => {
      const engine = getAdaptiveConsensusEngine(1);
      const status = engine.getStatus();
      
      expect(typeof status.isActive).toBe('boolean');
      expect(typeof status.lastUpdate).toBe('number');
      expect(typeof status.totalUpdates).toBe('number');
      expect(Array.isArray(status.currentWeights)).toBe(true);
      expect(Array.isArray(status.prunedAgents)).toBe(true);
      expect(Array.isArray(status.boostedAgents)).toBe(true);
    });

    it('should reflect active state after start', () => {
      const engine = getAdaptiveConsensusEngine(1);
      engine.start();
      const status = engine.getStatus();
      expect(status.isActive).toBe(true);
    });

    it('should reflect inactive state after stop', () => {
      const engine = getAdaptiveConsensusEngine(1);
      engine.start();
      engine.stop();
      const status = engine.getStatus();
      expect(status.isActive).toBe(false);
    });
  });

  describe('EventEmitter behavior', () => {
    it('should support event listeners', () => {
      const engine = getAdaptiveConsensusEngine(1);
      let emitted = false;
      engine.on('test', () => { emitted = true; });
      engine.emit('test');
      expect(emitted).toBe(true);
    });
  });
});
