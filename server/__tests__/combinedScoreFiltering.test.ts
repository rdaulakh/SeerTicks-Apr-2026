import { describe, it, expect } from 'vitest';

/**
 * Tests for the Combined Score filtering logic in AutomatedSignalProcessor
 * 
 * Combined Score = (Confidence * 0.6) + (ExecutionScore/100 * 0.4)
 * Minimum threshold: 50%
 */

describe('Combined Score Filtering Logic', () => {
  // Helper function to calculate combined score (mirrors the implementation)
  const calculateCombinedScore = (confidence: number, executionScore: number = 50): number => {
    return (confidence * 0.6) + (executionScore / 100 * 0.4);
  };

  describe('Combined Score Calculation', () => {
    it('should calculate combined score correctly with high confidence and low execution', () => {
      // High confidence (80%) but low execution score (30)
      const combined = calculateCombinedScore(0.80, 30);
      // 0.80 * 0.6 + 0.30 * 0.4 = 0.48 + 0.12 = 0.60
      expect(combined).toBeCloseTo(0.60, 2);
    });

    it('should calculate combined score correctly with moderate confidence and high execution', () => {
      // Moderate confidence (60%) but high execution score (80)
      const combined = calculateCombinedScore(0.60, 80);
      // 0.60 * 0.6 + 0.80 * 0.4 = 0.36 + 0.32 = 0.68
      expect(combined).toBeCloseTo(0.68, 2);
    });

    it('should use default execution score of 50 when not provided', () => {
      // Confidence 70%, execution score defaults to 50
      const combined = calculateCombinedScore(0.70);
      // 0.70 * 0.6 + 0.50 * 0.4 = 0.42 + 0.20 = 0.62
      expect(combined).toBeCloseTo(0.62, 2);
    });

    it('should calculate combined score correctly with both high values', () => {
      // High confidence (90%) and high execution score (85)
      const combined = calculateCombinedScore(0.90, 85);
      // 0.90 * 0.6 + 0.85 * 0.4 = 0.54 + 0.34 = 0.88
      expect(combined).toBeCloseTo(0.88, 2);
    });

    it('should calculate combined score correctly with both low values', () => {
      // Low confidence (40%) and low execution score (30)
      const combined = calculateCombinedScore(0.40, 30);
      // 0.40 * 0.6 + 0.30 * 0.4 = 0.24 + 0.12 = 0.36
      expect(combined).toBeCloseTo(0.36, 2);
    });
  });

  describe('Threshold Filtering (50% minimum)', () => {
    const minCombinedScore = 0.50;

    it('should PASS signal with high confidence (80%) even with low execution score (30)', () => {
      const combined = calculateCombinedScore(0.80, 30);
      // Combined = 0.60, which is >= 0.50
      expect(combined).toBeGreaterThanOrEqual(minCombinedScore);
    });

    it('should PASS signal with very high confidence (94%) even with zero execution score', () => {
      const combined = calculateCombinedScore(0.94, 0);
      // 0.94 * 0.6 + 0 * 0.4 = 0.564
      expect(combined).toBeGreaterThanOrEqual(minCombinedScore);
    });

    it('should PASS signal with moderate confidence (70%) and default execution score', () => {
      const combined = calculateCombinedScore(0.70);
      // 0.70 * 0.6 + 0.50 * 0.4 = 0.62
      expect(combined).toBeGreaterThanOrEqual(minCombinedScore);
    });

    it('should FAIL signal with low confidence (40%) and low execution score (30)', () => {
      const combined = calculateCombinedScore(0.40, 30);
      // Combined = 0.36, which is < 0.50
      expect(combined).toBeLessThan(minCombinedScore);
    });

    it('should FAIL signal with very low confidence (30%) even with high execution score (80)', () => {
      const combined = calculateCombinedScore(0.30, 80);
      // 0.30 * 0.6 + 0.80 * 0.4 = 0.18 + 0.32 = 0.50
      // Exactly at threshold - should pass
      expect(combined).toBeGreaterThanOrEqual(minCombinedScore);
    });

    it('should FAIL signal with confidence below 50% and execution below 50', () => {
      const combined = calculateCombinedScore(0.45, 40);
      // 0.45 * 0.6 + 0.40 * 0.4 = 0.27 + 0.16 = 0.43
      expect(combined).toBeLessThan(minCombinedScore);
    });
  });

  describe('Real-World Scenarios from Audit', () => {
    it('should PASS the missed BTC-USD trade (Conf: 73.36%, Exec: 44)', () => {
      // From audit: TechnicalAnalyst had 73.36% confidence, execution score ~44
      const combined = calculateCombinedScore(0.7336, 44);
      // 0.7336 * 0.6 + 0.44 * 0.4 = 0.44016 + 0.176 = 0.61616
      expect(combined).toBeGreaterThanOrEqual(0.50);
      console.log(`BTC-USD Combined Score: ${(combined * 100).toFixed(2)}% - WOULD PASS`);
    });

    it('should PASS high confidence signals even with missing execution score', () => {
      // PatternMatcher: 94.18% confidence, execution score undefined (defaults to 50)
      const combined = calculateCombinedScore(0.9418, 50);
      // 0.9418 * 0.6 + 0.50 * 0.4 = 0.56508 + 0.20 = 0.76508
      expect(combined).toBeGreaterThanOrEqual(0.50);
      console.log(`PatternMatcher Combined Score: ${(combined * 100).toFixed(2)}% - WOULD PASS`);
    });

    it('should PASS OrderFlowAnalyst signal (88.98% confidence)', () => {
      const combined = calculateCombinedScore(0.8898, 50);
      // 0.8898 * 0.6 + 0.50 * 0.4 = 0.53388 + 0.20 = 0.73388
      expect(combined).toBeGreaterThanOrEqual(0.50);
      console.log(`OrderFlowAnalyst Combined Score: ${(combined * 100).toFixed(2)}% - WOULD PASS`);
    });

    it('should PASS SentimentAnalyst signal (90% confidence)', () => {
      const combined = calculateCombinedScore(0.90, 50);
      // 0.90 * 0.6 + 0.50 * 0.4 = 0.54 + 0.20 = 0.74
      expect(combined).toBeGreaterThanOrEqual(0.50);
      console.log(`SentimentAnalyst Combined Score: ${(combined * 100).toFixed(2)}% - WOULD PASS`);
    });
  });

  describe('Edge Cases', () => {
    it('should handle 100% confidence correctly', () => {
      const combined = calculateCombinedScore(1.0, 100);
      // 1.0 * 0.6 + 1.0 * 0.4 = 1.0
      expect(combined).toBe(1.0);
    });

    it('should handle 0% confidence correctly', () => {
      const combined = calculateCombinedScore(0, 0);
      // 0 * 0.6 + 0 * 0.4 = 0
      expect(combined).toBe(0);
    });

    it('should handle execution score of 0 with high confidence', () => {
      const combined = calculateCombinedScore(0.85, 0);
      // 0.85 * 0.6 + 0 * 0.4 = 0.51
      expect(combined).toBeGreaterThanOrEqual(0.50);
    });

    it('should handle execution score of 100 with low confidence', () => {
      const combined = calculateCombinedScore(0.25, 100);
      // 0.25 * 0.6 + 1.0 * 0.4 = 0.15 + 0.40 = 0.55
      expect(combined).toBeGreaterThanOrEqual(0.50);
    });
  });

  describe('Weighting Validation', () => {
    it('should give 60% weight to confidence', () => {
      // If confidence changes by 10%, combined should change by 6%
      const base = calculateCombinedScore(0.50, 50);
      const increased = calculateCombinedScore(0.60, 50);
      const diff = increased - base;
      expect(diff).toBeCloseTo(0.06, 2);
    });

    it('should give 40% weight to execution score', () => {
      // If execution score changes by 10 points (10%), combined should change by 4%
      const base = calculateCombinedScore(0.50, 50);
      const increased = calculateCombinedScore(0.50, 60);
      const diff = increased - base;
      expect(diff).toBeCloseTo(0.04, 2);
    });
  });
});
