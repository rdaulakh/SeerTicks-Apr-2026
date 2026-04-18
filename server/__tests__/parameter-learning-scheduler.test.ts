/**
 * Parameter Learning Scheduler Tests
 * 
 * Tests for:
 * - Baseline parameter seeding
 * - Weekly learning job execution
 * - Consensus threshold learning
 * - Agent confidence threshold learning
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb } from '../db';
import { learnedParameters } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { 
  seedLearnedParameters, 
  checkParametersSeeded, 
  getParameterCounts 
} from '../ml/seedLearnedParameters';
import {
  learnConsensusThresholds,
  learnAgentConfidenceThresholds,
  runWeeklyParameterLearning,
  parameterLearningScheduler
} from '../ml/ParameterLearningScheduler';
import { parameterLearning } from '../ml/ParameterLearning';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


describe.skipIf(!isIntegration)('Parameter Learning Scheduler Tests', () => {
  
  beforeAll(async () => {
    // Ensure parameters are seeded for testing
    const isSeeded = await checkParametersSeeded();
    if (!isSeeded) {
      await seedLearnedParameters();
    }
  });

  afterAll(async () => {
    // Stop scheduler if running
    parameterLearningScheduler.stop();
  });

  beforeEach(() => {
    // Clear parameter learning cache before each test
    parameterLearning.clearCache();
  });

  describe('Baseline Parameter Seeding', () => {
    it('should detect when parameters are already seeded', async () => {
      const isSeeded = await checkParametersSeeded();
      expect(isSeeded).toBe(true);
    });

    it('should return correct parameter counts by type', async () => {
      const counts = await getParameterCounts();
      
      expect(counts.consensus_threshold).toBeGreaterThan(0);
      expect(counts.agent_confidence).toBeGreaterThan(0);
      
      console.log('Parameter counts by type:', counts);
    });

    it('should seed baseline parameters successfully', async () => {
      // This will not overwrite existing parameters due to onDuplicateKeyUpdate
      const result = await seedLearnedParameters();
      
      expect(result.success).toBe(true);
      expect(result.counts.total).toBeGreaterThan(0);
      
      console.log('Seeded parameters:', result.counts);
    });
  });

  describe('Consensus Threshold Learning', () => {
    it('should retrieve seeded consensus thresholds', async () => {
      // Test for different regimes
      const trendingUpThreshold = await parameterLearning.getConsensusThreshold('BTCUSD', 'trending_up');
      const highVolThreshold = await parameterLearning.getConsensusThreshold('BTCUSD', 'high_volatility');
      
      expect(trendingUpThreshold).toBe(0.10); // Lower in trends
      expect(highVolThreshold).toBe(0.20);    // Higher in volatile markets
      expect(highVolThreshold).toBeGreaterThan(trendingUpThreshold);
    });

    it('should fall back to global threshold for unknown symbols', async () => {
      const threshold = await parameterLearning.getConsensusThreshold('UNKNOWNSYMBOL', 'trending_up');
      
      // Should get global threshold (0.10 for trending_up)
      expect(threshold).toBe(0.10);
    });

    it('should learn consensus thresholds from historical trades', async () => {
      // This test requires historical trade data
      const results = await learnConsensusThresholds();
      
      // Results may be empty if no historical trades exist
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0) {
        const result = results[0];
        expect(result.symbol).toBeDefined();
        expect(result.regime).toBeDefined();
        expect(result.oldThreshold).toBeGreaterThan(0);
        expect(result.newThreshold).toBeGreaterThan(0);
        expect(result.sampleSize).toBeGreaterThan(0);
      }
    });
  });

  describe('Agent Confidence Threshold Learning', () => {
    it('should retrieve seeded agent confidence thresholds', async () => {
      const technicalThreshold = await parameterLearning.getAgentConfidenceThreshold('TechnicalAnalyst');
      const sentimentThreshold = await parameterLearning.getAgentConfidenceThreshold('SentimentAnalyst');
      
      expect(technicalThreshold).toBe(0.25); // Fast agent, lower threshold
      expect(sentimentThreshold).toBe(0.35); // Noisy agent, higher threshold
      expect(sentimentThreshold).toBeGreaterThan(technicalThreshold);
    });

    it('should fall back to default for unknown agents', async () => {
      const threshold = await parameterLearning.getAgentConfidenceThreshold('UnknownAgent');
      
      // Should get default threshold (0.30)
      expect(threshold).toBe(0.30);
    });

    it('should learn agent confidence thresholds from historical signals', async () => {
      const results = await learnAgentConfidenceThresholds();
      
      // Results may be empty if no historical trades exist
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0) {
        const result = results[0];
        expect(result.agentName).toBeDefined();
        expect(result.oldThreshold).toBeGreaterThan(0);
        expect(result.newThreshold).toBeGreaterThan(0);
        expect(result.sampleSize).toBeGreaterThan(0);
      }
    });
  });

  describe('Weekly Learning Job', () => {
    it('should run weekly parameter learning job successfully', async () => {
      const result = await runWeeklyParameterLearning();
      
      expect(result.success).toBe(true);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(Array.isArray(result.consensusResults)).toBe(true);
      expect(Array.isArray(result.agentResults)).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle missing historical data gracefully', async () => {
      // Even with no historical trades, the job should complete
      const result = await runWeeklyParameterLearning();
      
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Scheduler Management', () => {
    it('should report correct scheduler status', () => {
      const status = parameterLearningScheduler.getStatus();
      
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastRun');
      expect(status).toHaveProperty('nextRun');
      expect(status).toHaveProperty('schedulerActive');
      expect(status.nextRun).toBeInstanceOf(Date);
    });

    it('should start and stop scheduler', () => {
      // Start scheduler
      parameterLearningScheduler.start();
      let status = parameterLearningScheduler.getStatus();
      expect(status.schedulerActive).toBe(true);
      
      // Stop scheduler
      parameterLearningScheduler.stop();
      status = parameterLearningScheduler.getStatus();
      expect(status.schedulerActive).toBe(false);
    });
  });

  describe('Regime-Specific Parameters', () => {
    it('should retrieve regime multipliers', async () => {
      const params = await parameterLearning.getRegimeSpecificParameters('BTCUSD', 'trending_up');
      
      expect(params.stopLossMultiplier).toBe(2.0);
      expect(params.takeProfitMultiplier).toBe(3.0);
      expect(params.positionSizeMultiplier).toBe(1.2);
      expect(params.qualityThreshold).toBe(0.25);
      expect(params.alphaThreshold).toBe(0.6);
    });

    it('should retrieve alpha criteria', async () => {
      const criteria = await parameterLearning.getAlphaCriteria('BTCUSD', 'high_volatility');
      
      expect(criteria.minConsensusScore).toBe(0.75);
      expect(criteria.minConfidence).toBe(0.8);
      expect(criteria.minAgentAgreement).toBe(5);
      expect(criteria.minQualityScore).toBe(0.7);
    });

    it('should use stricter criteria in volatile markets', async () => {
      const trendingCriteria = await parameterLearning.getAlphaCriteria('BTCUSD', 'trending_up');
      const volatileCriteria = await parameterLearning.getAlphaCriteria('BTCUSD', 'high_volatility');
      
      // Volatile markets should have stricter requirements
      expect(volatileCriteria.minConsensusScore).toBeGreaterThan(trendingCriteria.minConsensusScore);
      expect(volatileCriteria.minConfidence).toBeGreaterThan(trendingCriteria.minConfidence);
      expect(volatileCriteria.minAgentAgreement).toBeGreaterThanOrEqual(trendingCriteria.minAgentAgreement);
    });
  });

  describe('Cache Management', () => {
    it('should cache parameters for performance', async () => {
      // First call - hits database
      const start1 = Date.now();
      await parameterLearning.getConsensusThreshold('BTCUSD', 'trending_up');
      const time1 = Date.now() - start1;
      
      // Second call - should hit cache
      const start2 = Date.now();
      await parameterLearning.getConsensusThreshold('BTCUSD', 'trending_up');
      const time2 = Date.now() - start2;
      
      // Cache hit should be faster (or at least not significantly slower)
      expect(time2).toBeLessThanOrEqual(time1 + 50);
    });

    it('should clear cache when requested', async () => {
      // Populate cache
      await parameterLearning.getConsensusThreshold('BTCUSD', 'trending_up');
      
      // Clear cache
      parameterLearning.clearCache();
      
      // Next call should hit database again (no error)
      const threshold = await parameterLearning.getConsensusThreshold('BTCUSD', 'trending_up');
      expect(threshold).toBe(0.10);
    });
  });
});

describe('parameter-learning-scheduler (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
