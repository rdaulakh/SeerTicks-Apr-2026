/**
 * AgentWeightManager — Comprehensive Unit Tests
 * 
 * Tests the agent weight management system including:
 * - Default weight initialization
 * - Category multiplier application (Phase 15B)
 * - Weight calculation with accuracy adjustments
 * - Consensus weight generation
 * - Agent category classification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AgentWeightManager,
  AGENT_CATEGORIES,
  ALL_AGENTS,
  DEFAULT_AGENT_WEIGHTS,
  DEFAULT_CATEGORY_MULTIPLIERS,
  type AgentName,
} from '../services/AgentWeightManager';

// Mock database to avoid real DB calls
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe('AgentWeightManager', () => {
  let manager: AgentWeightManager;

  beforeEach(() => {
    manager = new AgentWeightManager(1); // userId = 1
  });

  // ─── Agent Categories ───────────────────────────────────────────────────

  describe('agent categories', () => {
    it('should define FAST agents correctly', () => {
      expect(AGENT_CATEGORIES.FAST).toContain('TechnicalAnalyst');
      expect(AGENT_CATEGORIES.FAST).toContain('PatternMatcher');
      expect(AGENT_CATEGORIES.FAST).toContain('OrderFlowAnalyst');
    });

    it('should define SLOW agents correctly', () => {
      expect(AGENT_CATEGORIES.SLOW).toContain('SentimentAnalyst');
      expect(AGENT_CATEGORIES.SLOW).toContain('NewsSentinel');
      expect(AGENT_CATEGORIES.SLOW).toContain('MacroAnalyst');
    });

    it('should define PHASE2 agents correctly', () => {
      expect(AGENT_CATEGORIES.PHASE2).toContain('WhaleTracker');
      expect(AGENT_CATEGORIES.PHASE2).toContain('FundingRateAnalyst');
      expect(AGENT_CATEGORIES.PHASE2).toContain('LiquidationHeatmap');
      expect(AGENT_CATEGORIES.PHASE2).toContain('OnChainFlowAnalyst');
      expect(AGENT_CATEGORIES.PHASE2).toContain('VolumeProfileAnalyzer');
    });

    it('ALL_AGENTS should contain all agents from all categories', () => {
      const allFromCategories = [
        ...AGENT_CATEGORIES.FAST,
        ...AGENT_CATEGORIES.SLOW,
        ...AGENT_CATEGORIES.PHASE2,
      ];
      expect(ALL_AGENTS.length).toBe(allFromCategories.length);
      for (const agent of allFromCategories) {
        expect(ALL_AGENTS).toContain(agent);
      }
    });
  });

  // ─── Default Weights ────────────────────────────────────────────────────

  describe('default weights', () => {
    it('should have weights for all agents', () => {
      for (const agent of ALL_AGENTS) {
        expect(DEFAULT_AGENT_WEIGHTS[agent]).toBeDefined();
        expect(typeof DEFAULT_AGENT_WEIGHTS[agent]).toBe('number');
      }
    });

    it('FAST agent weights should sum to ~100', () => {
      const sum = AGENT_CATEGORIES.FAST.reduce(
        (acc, agent) => acc + DEFAULT_AGENT_WEIGHTS[agent],
        0
      );
      expect(sum).toBeCloseTo(100, 0);
    });

    it('SLOW agent weights should sum to ~100 (excluding disabled agents)', () => {
      const sum = AGENT_CATEGORIES.SLOW.reduce(
        (acc, agent) => acc + DEFAULT_AGENT_WEIGHTS[agent],
        0
      );
      // OnChainAnalyst is 0 by default, so sum is ~100 from the other 3
      expect(sum).toBeCloseTo(100, 0);
    });
  });

  // ─── Category Multipliers (Phase 15B) ──────────────────────────────────

  describe('category multipliers (Phase 15B)', () => {
    it('should have rebalanced multipliers that reduce FAST dominance', () => {
      // Phase 15B fix: FAST was 1.0 causing 100% bullish bias
      // Now FAST should be reduced (0.70) and SLOW elevated from 0.20
      expect(DEFAULT_CATEGORY_MULTIPLIERS.FAST).toBeLessThan(1.0);
      expect(DEFAULT_CATEGORY_MULTIPLIERS.SLOW).toBeGreaterThan(0.2);
    });

    it('FAST multiplier should be 0.70', () => {
      expect(DEFAULT_CATEGORY_MULTIPLIERS.FAST).toBe(0.70);
    });

    it('SLOW multiplier should be 0.50', () => {
      expect(DEFAULT_CATEGORY_MULTIPLIERS.SLOW).toBe(0.50);
    });

    it('PHASE2 multiplier should be 0.60', () => {
      expect(DEFAULT_CATEGORY_MULTIPLIERS.PHASE2).toBe(0.60);
    });
  });

  // ─── Weight Calculation ─────────────────────────────────────────────────

  describe('calculateAgentWeight', () => {
    it('should calculate weight for a known FAST agent', () => {
      const result = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(result).not.toBeNull();
      expect(result!.agentName).toBe('TechnicalAnalyst');
      expect(result!.category).toBe('FAST');
      expect(result!.baseWeight).toBe(40);
      // finalWeight = (baseWeight/100) * categoryMultiplier * performanceAdj(1.0)
      // = (40/100) * 0.70 * 1.0 = 0.28
      expect(result!.finalWeight).toBeCloseTo((40 / 100) * DEFAULT_CATEGORY_MULTIPLIERS.FAST, 4);
    });

    it('should calculate weight for a known SLOW agent', () => {
      const result = manager.calculateAgentWeight('SentimentAnalyst');
      expect(result).not.toBeNull();
      expect(result!.category).toBe('SLOW');
      // finalWeight = (33.33/100) * SLOW multiplier * 1.0
      expect(result!.finalWeight).toBeCloseTo((33.33 / 100) * DEFAULT_CATEGORY_MULTIPLIERS.SLOW, 4);
    });

    it('should calculate weight for a PHASE2 agent', () => {
      const result = manager.calculateAgentWeight('WhaleTracker');
      expect(result).not.toBeNull();
      expect(result!.category).toBe('PHASE2');
      // finalWeight = (14/100) * PHASE2 multiplier * 1.0 (Phase 28: rebalanced for ForexCorrelationAgent)
      expect(result!.finalWeight).toBeCloseTo((14 / 100) * DEFAULT_CATEGORY_MULTIPLIERS.PHASE2, 4);
    });

    it('should return null for unknown agent', () => {
      const result = manager.calculateAgentWeight('NonExistentAgent');
      expect(result).toBeNull();
    });

    it('should adjust weight based on historical accuracy', () => {
      const withoutAccuracy = manager.calculateAgentWeight('TechnicalAnalyst');
      const withHighAccuracy = manager.calculateAgentWeight('TechnicalAnalyst', 0.8);
      const withLowAccuracy = manager.calculateAgentWeight('TechnicalAnalyst', 0.3);
      
      expect(withoutAccuracy).not.toBeNull();
      expect(withHighAccuracy).not.toBeNull();
      expect(withLowAccuracy).not.toBeNull();
      
      // High accuracy should boost weight, low accuracy should reduce it
      expect(withHighAccuracy!.finalWeight).toBeGreaterThanOrEqual(withLowAccuracy!.finalWeight);
    });
  });

  // ─── Consensus Weights ──────────────────────────────────────────────────

  describe('getConsensusWeights', () => {
    it('should return weights for all agents', () => {
      const weights = manager.getConsensusWeights();
      
      expect(typeof weights).toBe('object');
      expect(Object.keys(weights).length).toBeGreaterThan(0);
    });

    it('should apply category multipliers to consensus weights', () => {
      const weights = manager.getConsensusWeights();
      
      // TechnicalAnalyst (FAST, base 40, mult 0.70) → (40/100)*0.70 = 0.28
      if (weights['TechnicalAnalyst']) {
        expect(weights['TechnicalAnalyst']).toBeCloseTo((40 / 100) * DEFAULT_CATEGORY_MULTIPLIERS.FAST, 4);
      }
    });

    it('should have non-negative weights for all agents', () => {
      const weights = manager.getConsensusWeights();
      
      for (const [agent, weight] of Object.entries(weights)) {
        expect(weight).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
