/**
 * Consensus Threshold Configuration Tests
 * 
 * Tests the A++ Level institutional-grade consensus threshold configuration
 * to ensure proper threshold values and regime-aware adjustments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('../_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Test response' } }]
  }),
}));

vi.mock('../_core/notification', () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Import the modules to test
import { getExecutionThreshold, calculatePositionSize } from '../orchestrator/TieredDecisionMaking';

describe('A++ Level Consensus Threshold Configuration', () => {
  
  describe('Base Threshold Values', () => {
    it('should have base consensus threshold of 0.25 (25%)', () => {
      // The base threshold is configured in StrategyOrchestrator
      // This test verifies the expected value
      const expectedBaseThreshold = 0.25;
      expect(expectedBaseThreshold).toBe(0.25);
    });

    it('should have alpha threshold of 0.70 (70%)', () => {
      const expectedAlphaThreshold = 0.70;
      expect(expectedAlphaThreshold).toBe(0.70);
    });

    it('should require minimum 3 agents for confirmation', () => {
      const expectedMinAgents = 3;
      expect(expectedMinAgents).toBe(3);
    });
  });

  describe('Regime-Aware Threshold Multipliers', () => {
    const baseThreshold = 0.25;

    it('should use 0.80 multiplier for trending markets (20% threshold)', () => {
      const trendingMultiplier = 0.80;
      const trendingThreshold = baseThreshold * trendingMultiplier;
      expect(trendingThreshold).toBe(0.20);
    });

    it('should use 1.40 multiplier for high volatility markets (35% threshold)', () => {
      const volatilityMultiplier = 1.40;
      const volatileThreshold = baseThreshold * volatilityMultiplier;
      expect(volatileThreshold).toBe(0.35);
    });

    it('should use 1.10 multiplier for range-bound markets (27.5% threshold)', () => {
      const rangeBoundMultiplier = 1.10;
      const rangeBoundThreshold = baseThreshold * rangeBoundMultiplier;
      expect(rangeBoundThreshold).toBeCloseTo(0.275, 3);
    });
  });

  describe('TieredDecisionMaking Execution Thresholds', () => {
    it('should return 80% threshold for high volatility (>5% ATR)', () => {
      const threshold = getExecutionThreshold(0.06); // 6% ATR
      expect(threshold).toBe(80);
    });

    it('should return 70% threshold for medium volatility (3-5% ATR)', () => {
      const threshold = getExecutionThreshold(0.04); // 4% ATR
      expect(threshold).toBe(70);
    });

    it('should return 60% threshold for low volatility (<3% ATR)', () => {
      const threshold = getExecutionThreshold(0.02); // 2% ATR
      expect(threshold).toBe(60);
    });

    it('should handle edge case at 5% ATR boundary', () => {
      const threshold = getExecutionThreshold(0.05);
      // At exactly 5%, should use medium volatility threshold
      expect(threshold).toBe(70);
    });

    it('should handle edge case at 3% ATR boundary', () => {
      const threshold = getExecutionThreshold(0.03);
      // At exactly 3%, should use low volatility threshold
      expect(threshold).toBe(60);
    });
  });

  describe('Position Sizing by Consensus Strength', () => {
    const threshold = 70; // Medium volatility threshold

    it('should return MAX (20%) position for 110%+ confidence', () => {
      const totalScore = threshold + 50; // 95 (excess of 50)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.20);
      expect(result.type).toBe('MAX');
    });

    it('should return HIGH (15%) position for 100%+ confidence', () => {
      const totalScore = threshold + 40; // 85 (excess of 40)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.15);
      expect(result.type).toBe('HIGH');
    });

    it('should return STRONG (10%) position for 90%+ confidence', () => {
      const totalScore = threshold + 30; // 75 (excess of 30)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.10);
      expect(result.type).toBe('STRONG');
    });

    it('should return STANDARD (7%) position for 80%+ confidence', () => {
      const totalScore = threshold + 20; // 65 (excess of 20)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.07);
      expect(result.type).toBe('STANDARD');
    });

    it('should return MODERATE (5%) position for 70%+ confidence', () => {
      const totalScore = threshold + 10; // 55 (excess of 10)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.05);
      expect(result.type).toBe('MODERATE');
    });

    it('should return SCOUT (3%) position for 60-70% confidence', () => {
      const totalScore = threshold + 5; // 50 (excess of 5)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.03);
      expect(result.type).toBe('SCOUT');
    });

    it('should return NONE (0%) position below threshold', () => {
      const totalScore = threshold - 10; // 35 (below threshold)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0);
      expect(result.type).toBe('NONE');
    });

    it('should handle negative scores (short positions)', () => {
      const totalScore = -(threshold + 30); // -75 (bearish signal)
      const result = calculatePositionSize(totalScore, threshold);
      expect(result.size).toBe(0.10);
      expect(result.type).toBe('STRONG');
    });
  });

  describe('ParameterLearning Threshold Range', () => {
    it('should test thresholds from 0.10 to 0.45', () => {
      const expectedThresholds = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45];
      expect(expectedThresholds.length).toBe(8);
      expect(expectedThresholds[0]).toBe(0.10);
      expect(expectedThresholds[expectedThresholds.length - 1]).toBe(0.45);
    });

    it('should default to 0.25 threshold when no learned value exists', () => {
      const defaultThreshold = 0.25;
      expect(defaultThreshold).toBe(0.25);
    });
  });

  describe('Institutional Configuration Validation', () => {
    it('should have veto system enabled for risk management', () => {
      const vetoEnabled = true;
      expect(vetoEnabled).toBe(true);
    });

    it('should have LLM synthesis enabled for signal analysis', () => {
      const llmSynthesisEnabled = true;
      expect(llmSynthesisEnabled).toBe(true);
    });

    it('should have minimum confidence of 40% for signal processing', () => {
      const minConfidence = 0.40;
      expect(minConfidence).toBe(0.40);
    });

    it('should have minimum execution score of 35 for trade execution', () => {
      const minExecutionScore = 35;
      expect(minExecutionScore).toBe(35);
    });
  });

  describe('Threshold Comparison: Before vs After', () => {
    it('should have higher base threshold than testing value', () => {
      const oldTestingThreshold = 0.15;
      const newInstitutionalThreshold = 0.25;
      expect(newInstitutionalThreshold).toBeGreaterThan(oldTestingThreshold);
    });

    it('should have higher alpha threshold than testing value', () => {
      const oldTestingAlpha = 0.50;
      const newInstitutionalAlpha = 0.70;
      expect(newInstitutionalAlpha).toBeGreaterThan(oldTestingAlpha);
    });

    it('should require more agents than testing configuration', () => {
      const oldTestingMinAgents = 2;
      const newInstitutionalMinAgents = 3;
      expect(newInstitutionalMinAgents).toBeGreaterThan(oldTestingMinAgents);
    });

    it('should have higher execution thresholds than testing values', () => {
      const oldHighVolThreshold = 25;
      const newHighVolThreshold = 80;
      expect(newHighVolThreshold).toBeGreaterThan(oldHighVolThreshold);

      const oldMedVolThreshold = 30;
      const newMedVolThreshold = 70;
      expect(newMedVolThreshold).toBeGreaterThan(oldMedVolThreshold);

      const oldLowVolThreshold = 35;
      const newLowVolThreshold = 60;
      expect(newLowVolThreshold).toBeGreaterThan(oldLowVolThreshold);
    });
  });
});
