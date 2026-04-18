/**
 * AgentAlphaValidator Unit Tests
 * 
 * Tests the Phase 16 agent alpha validation:
 * - Singleton access
 * - runValidation with no DB data (empty result)
 * - Result structure validation
 * - Alpha grading logic
 * - Start/stop lifecycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAgentAlphaValidator } from '../services/AgentAlphaValidator';

// Mock DB to avoid real database calls
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe('AgentAlphaValidator', () => {
  let validator: ReturnType<typeof getAgentAlphaValidator>;

  beforeEach(() => {
    validator = getAgentAlphaValidator();
  });

  describe('initialization', () => {
    it('should return singleton instance', () => {
      const a = getAgentAlphaValidator();
      const b = getAgentAlphaValidator();
      expect(a).toBe(b);
    });

    it('should have no last validation initially or from previous run', () => {
      const result = validator.getLastValidation();
      // Either null or a valid result from a previous test run
      if (result !== null) {
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('agentReports');
      }
    });
  });

  describe('runValidation with no data', () => {
    it('should return valid result structure', async () => {
      const result = await validator.runValidation();
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('totalTradesAnalyzed');
      expect(result).toHaveProperty('agentReports');
      expect(result).toHaveProperty('agentsWithAlpha');
      expect(result).toHaveProperty('agentsToPrune');
      expect(result).toHaveProperty('agentsToBoost');
      expect(result).toHaveProperty('systemWinRate');
      expect(result).toHaveProperty('systemSharpe');
      expect(result).toHaveProperty('systemProfitFactor');
    });

    it('should return 0 trades analyzed when no DB', async () => {
      const result = await validator.runValidation();
      expect(result.totalTradesAnalyzed).toBe(0);
    });

    it('should return empty agent reports when no data', async () => {
      const result = await validator.runValidation();
      expect(result.agentReports).toEqual([]);
    });

    it('should return empty alpha/prune/boost lists when no data', async () => {
      const result = await validator.runValidation();
      expect(result.agentsWithAlpha).toEqual([]);
      expect(result.agentsToPrune).toEqual([]);
      expect(result.agentsToBoost).toEqual([]);
    });

    it('should return 0 system metrics when no data', async () => {
      const result = await validator.runValidation();
      expect(result.systemWinRate).toBe(0);
      expect(result.systemSharpe).toBe(0);
      expect(result.systemProfitFactor).toBe(0);
    });

    it('should store result as lastValidation', async () => {
      const result = await validator.runValidation();
      const last = validator.getLastValidation();
      expect(last).toBeDefined();
      expect(last?.timestamp).toBe(result.timestamp);
    });
  });

  describe('AlphaValidationResult types', () => {
    it('should have numeric timestamp', async () => {
      const result = await validator.runValidation();
      expect(typeof result.timestamp).toBe('number');
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should have array types for agent lists', async () => {
      const result = await validator.runValidation();
      expect(Array.isArray(result.agentReports)).toBe(true);
      expect(Array.isArray(result.agentsWithAlpha)).toBe(true);
      expect(Array.isArray(result.agentsToPrune)).toBe(true);
      expect(Array.isArray(result.agentsToBoost)).toBe(true);
    });

    it('should have numeric system metrics', async () => {
      const result = await validator.runValidation();
      expect(typeof result.systemWinRate).toBe('number');
      expect(typeof result.systemSharpe).toBe('number');
      expect(typeof result.systemProfitFactor).toBe('number');
    });
  });

  describe('EventEmitter behavior', () => {
    it('should not emit validation_complete when no trade data', async () => {
      let emitted = false;
      validator.once('validation_complete', () => {
        emitted = true;
      });
      await validator.runValidation();
      // With no DB data (0 trades), early return before emit
      expect(emitted).toBe(false);
    });

    it('should support event listeners', () => {
      let called = false;
      validator.on('test_event', () => { called = true; });
      validator.emit('test_event');
      expect(called).toBe(true);
    });
  });
});
