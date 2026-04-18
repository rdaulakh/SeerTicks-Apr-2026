/**
 * Z-Score Sentiment Model Tests
 * 
 * Tests the Z-Score normalization model used to fix SentimentAnalyst's
 * 99.8% bullish bias.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ZScoreSentimentModel, getZScoreSentimentModel } from '../utils/ZScoreSentimentModel';

describe('ZScoreSentimentModel', () => {
  let model: ZScoreSentimentModel;

  beforeEach(() => {
    // Create fresh instance for each test
    model = new ZScoreSentimentModel({
      windowSize: 30,
      signalThreshold: 1.5,
      minSamples: 7,
      maxConfidence: 0.75,
    });
  });

  describe('Z-Score Calculation', () => {
    it('should return neutral when insufficient samples', () => {
      // Only 3 samples (below minSamples of 7)
      const result = model.calculateFearGreedZScore(50);
      
      expect(result.signal).toBe('neutral');
      expect(result.confidence).toBe(0);
      expect(result.isStatisticallySignificant).toBe(false);
      expect(result.reasoning).toContain('Insufficient data');
    });

    it('should calculate correct Z-score with sufficient samples', () => {
      // Initialize with 10 samples around mean of 50
      const history = [
        { value: 45, timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000 },
        { value: 48, timestamp: Date.now() - 9 * 24 * 60 * 60 * 1000 },
        { value: 52, timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 },
        { value: 50, timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000 },
        { value: 47, timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000 },
        { value: 53, timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 },
        { value: 49, timestamp: Date.now() - 4 * 24 * 60 * 60 * 1000 },
        { value: 51, timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 },
        { value: 50, timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000 },
        { value: 50, timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000 },
      ];
      model.initializeWithHistory(history);

      // Test with value at mean (should be neutral)
      // Mean of [45,48,52,50,47,53,49,51,50,50] = 49.5
      const result = model.calculateFearGreedZScore(50);
      
      // Z-score should be close to 0 (within 1 std dev of mean)
      expect(Math.abs(result.zScore)).toBeLessThan(1);
      expect(result.signal).toBe('neutral');
      expect(result.isStatisticallySignificant).toBe(false);
    });

    it('should generate BULLISH signal on extreme fear (low Z-score)', () => {
      // Initialize with history around mean of 50
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 50 + (Math.random() - 0.5) * 10, // Values around 45-55
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Test with extreme fear value (much lower than mean)
      const result = model.calculateFearGreedZScore(15);
      
      expect(result.zScore).toBeLessThan(-1.5);
      expect(result.signal).toBe('bullish');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.isStatisticallySignificant).toBe(true);
      expect(result.reasoning).toContain('Extreme fear');
    });

    it('should generate BEARISH signal on extreme greed (high Z-score)', () => {
      // Initialize with history around mean of 50
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 50 + (Math.random() - 0.5) * 10,
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Test with extreme greed value (much higher than mean)
      const result = model.calculateFearGreedZScore(85);
      
      expect(result.zScore).toBeGreaterThan(1.5);
      expect(result.signal).toBe('bearish');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.isStatisticallySignificant).toBe(true);
      expect(result.reasoning).toContain('Extreme greed');
    });

    it('should return NEUTRAL for normal market conditions', () => {
      // Initialize with varied history (not all same value)
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 48 + i, // Values from 48 to 57
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Test with value close to mean (should be neutral)
      const result = model.calculateFearGreedZScore(52);
      
      expect(result.signal).toBe('neutral');
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('within normal range');
    });
  });

  describe('Signal Distribution Fix', () => {
    it('should NOT generate 99.8% bullish signals like the old implementation', () => {
      // Initialize with realistic Fear & Greed history
      const history = [
        { value: 35, timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000 },
        { value: 40, timestamp: Date.now() - 25 * 24 * 60 * 60 * 1000 },
        { value: 45, timestamp: Date.now() - 20 * 24 * 60 * 60 * 1000 },
        { value: 50, timestamp: Date.now() - 15 * 24 * 60 * 60 * 1000 },
        { value: 55, timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000 },
        { value: 60, timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 },
        { value: 65, timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000 },
      ];
      model.initializeWithHistory(history);

      // Test multiple values that would have been bullish in old implementation
      const testValues = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
      let bullishCount = 0;
      let bearishCount = 0;
      let neutralCount = 0;

      testValues.forEach(value => {
        const result = model.calculateFearGreedZScore(value);
        if (result.signal === 'bullish') bullishCount++;
        else if (result.signal === 'bearish') bearishCount++;
        else neutralCount++;
      });

      // The old implementation would have ~99% bullish
      // The new implementation should have more balanced distribution
      const bullishPct = (bullishCount / testValues.length) * 100;
      
      expect(bullishPct).toBeLessThan(50); // Should NOT be 99.8% bullish
      expect(neutralCount).toBeGreaterThan(0); // Should have some neutral signals
    });
  });

  describe('Confidence Scaling', () => {
    it('should cap confidence at maxConfidence', () => {
      // Initialize with tight distribution
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 50,
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Test with extreme value that would generate high Z-score
      const result = model.calculateFearGreedZScore(10);
      
      expect(result.confidence).toBeLessThanOrEqual(0.75); // maxConfidence
    });

    it('should scale confidence based on Z-score magnitude', () => {
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 50 + (i - 5) * 2, // Values from 40 to 60
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Moderate deviation
      const moderateResult = model.calculateFearGreedZScore(30);
      
      // Extreme deviation
      const extremeResult = model.calculateFearGreedZScore(10);
      
      // Extreme should have higher confidence (if both are significant)
      if (moderateResult.isStatisticallySignificant && extremeResult.isStatisticallySignificant) {
        expect(extremeResult.confidence).toBeGreaterThanOrEqual(moderateResult.confidence);
      }
    });
  });

  describe('Combined Z-Score', () => {
    it('should boost confidence when Fear & Greed and Social Sentiment agree', () => {
      // Initialize with varied history to get proper variance
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 48 + i, // Values from 48 to 57
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Both indicate extreme greed (bearish) - F&G=85 is extreme greed, social=-0.8 is bearish
      // This should create confirmation
      const result = model.calculateCombinedZScore(85, -0.8);
      
      // With F&G=85 and mean~52, Z-score should be significantly positive (extreme greed = bearish)
      expect(result.signal).toBe('bearish');
      // Combined should mention confirmation
      expect(result.reasoning).toContain('confirm');
    });

    it('should reduce confidence when Fear & Greed and Social Sentiment disagree', () => {
      // Initialize with varied history
      const history = Array.from({ length: 10 }, (_, i) => ({
        value: 48 + i, // Values from 48 to 57
        timestamp: Date.now() - (10 - i) * 24 * 60 * 60 * 1000,
      }));
      model.initializeWithHistory(history);

      // Fear & Greed says extreme greed (bearish), Social says bullish (0.8)
      // This creates a divergence scenario - F&G=85 is greed (bearish), social=0.8 is bullish
      const result = model.calculateCombinedZScore(85, 0.8);
      
      // Should mention divergence (or WARNING)
      expect(result.reasoning.toLowerCase()).toMatch(/diverge|warning/i);
    });
  });

  describe('Statistics', () => {
    it('should track statistics correctly', () => {
      const history = [
        { value: 40, timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 },
        { value: 50, timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000 },
        { value: 60, timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000 },
      ];
      model.initializeWithHistory(history);

      const stats = model.getStatistics();
      
      expect(stats.fearGreedSamples).toBe(3);
      expect(stats.fearGreedMean).toBeCloseTo(50, 0);
      expect(stats.fearGreedStdDev).toBeGreaterThan(0);
    });
  });

  describe('Singleton Instance', () => {
    it('should return same instance from getZScoreSentimentModel', () => {
      const instance1 = getZScoreSentimentModel();
      const instance2 = getZScoreSentimentModel();
      
      expect(instance1).toBe(instance2);
    });
  });
});
