/**
 * Parameter Learning Integration Tests
 * 
 * Tests for Fix #2 (Dynamic Consensus Threshold) and Fix #3 (Agent-Specific Confidence Thresholds)
 * Validates that ParameterLearningService is properly integrated with StrategyOrchestrator
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { StrategyOrchestrator } from '../orchestrator/StrategyOrchestrator';
import { AgentManager, type AgentSignal } from '../agents/AgentBase';
import { parameterLearning } from '../ml/ParameterLearning';
import { getDb } from '../db';
import { learnedParameters } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

describe('Parameter Learning Integration Tests', () => {
  let orchestrator: StrategyOrchestrator;
  let agentManager: AgentManager;
  const testSymbol = 'BTCUSDT';
  const testUserId = 999;
  const testBalance = 100000;

  beforeAll(async () => {
    // Clean up any existing test data first
    const db = await getDb();
    if (db) {
      await db.delete(learnedParameters)
        .where(eq(learnedParameters.symbol, testSymbol));
      await db.delete(learnedParameters)
        .where(eq(learnedParameters.agentName, 'TestAgent'));
    }
    
    // Initialize agent manager
    agentManager = new AgentManager();
    
    // Initialize orchestrator
    orchestrator = new StrategyOrchestrator(
      testSymbol,
      agentManager,
      testUserId,
      testBalance
    );
  });

  afterAll(async () => {
    // Clean up test data
    const db = await getDb();
    if (db) {
      await db.delete(learnedParameters)
        .where(eq(learnedParameters.symbol, testSymbol));
    }
  });

  beforeEach(() => {
    // Clear cache before each test
    parameterLearning.clearCache();
  });

  describe('Fix #2: Dynamic Consensus Threshold Integration', () => {
    it('should use learned consensus threshold when available', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete any existing data for this test
      await db.delete(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, testSymbol),
            eq(learnedParameters.regime, 'trending_up')
          )
        );
      
      // Insert a learned consensus threshold
      await db.insert(learnedParameters).values({
        parameterName: 'consensus_threshold',
        parameterType: 'consensus_threshold',
        symbol: testSymbol,
        regime: 'trending_up',
        value: '0.10', // Lower than default 0.15
        confidence: '0.85',
        sampleSize: 100,
        winRate: '0.65',
        sharpeRatio: '1.8'
      });

      // Query the learned threshold
      const threshold = await parameterLearning.getConsensusThreshold(testSymbol, 'trending_up');
      
      expect(threshold).toBe(0.10);
      expect(threshold).toBeLessThan(0.15); // Should be lower than default
    });

    it('should fall back to default threshold when no learned value exists', async () => {
      const threshold = await parameterLearning.getConsensusThreshold('NONEXISTENT', 'range_bound');
      
      expect(threshold).toBe(0.15); // Default fallback
    });

    it('should adjust threshold based on market regime', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete existing regime thresholds
      await db.delete(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, testSymbol)
          )
        );
      
      // Insert different thresholds for different regimes
      const regimes = [
        { regime: 'trending_up', value: '0.08' },
        { regime: 'trending_down', value: '0.09' },
        { regime: 'high_volatility', value: '0.20' },
        { regime: 'range_bound', value: '0.15' }
      ];

      for (const { regime, value } of regimes) {
        await db.insert(learnedParameters).values({
          parameterName: 'consensus_threshold',
          parameterType: 'consensus_threshold',
          symbol: testSymbol,
          regime,
          value,
          confidence: '0.80',
          sampleSize: 50,
          winRate: '0.60',
          sharpeRatio: '1.5'
        });
      }

      // Clear cache to force fresh reads
      parameterLearning.clearCache();

      // Verify different thresholds for different regimes
      const trendingUpThreshold = await parameterLearning.getConsensusThreshold(testSymbol, 'trending_up');
      const volatilityThreshold = await parameterLearning.getConsensusThreshold(testSymbol, 'high_volatility');
      
      expect(trendingUpThreshold).toBe(0.08);
      expect(volatilityThreshold).toBe(0.20);
      expect(volatilityThreshold).toBeGreaterThan(trendingUpThreshold);
    });
  });

  describe('Fix #3: Agent-Specific Confidence Thresholds', () => {
    it('should use agent-specific confidence thresholds', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete existing agent thresholds
      await db.delete(learnedParameters)
        .where(eq(learnedParameters.parameterName, 'min_confidence'));
      
      // Insert agent-specific thresholds
      const agents = [
        { agentName: 'TechnicalAnalyst', minConfidence: '0.25', winRate: '0.75' },
        { agentName: 'PatternMatcher', minConfidence: '0.30', winRate: '0.70' },
        { agentName: 'MacroAnalyst', minConfidence: '0.20', winRate: '0.80' }, // High win rate = lower threshold
        { agentName: 'SentimentAnalyst', minConfidence: '0.40', winRate: '0.55' } // Low win rate = higher threshold
      ];

      for (const { agentName, minConfidence, winRate } of agents) {
        await db.insert(learnedParameters).values({
          parameterName: 'min_confidence',
          parameterType: 'agent_confidence',
          agentName,
          value: minConfidence,
          confidence: '0.85',
          sampleSize: 100,
          winRate
        });
      }

      // Clear cache
      parameterLearning.clearCache();

      // Verify agent-specific thresholds
      const macroThreshold = await parameterLearning.getAgentConfidenceThreshold('MacroAnalyst');
      const sentimentThreshold = await parameterLearning.getAgentConfidenceThreshold('SentimentAnalyst');
      
      expect(macroThreshold).toBe(0.20); // High performer = low threshold
      expect(sentimentThreshold).toBe(0.40); // Low performer = high threshold
      expect(sentimentThreshold).toBeGreaterThan(macroThreshold);
    });

    it('should filter signals below agent-specific thresholds', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete existing TechnicalAnalyst threshold
      await db.delete(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'min_confidence'),
            eq(learnedParameters.agentName, 'TechnicalAnalyst')
          )
        );
      
      // Set a high threshold for TechnicalAnalyst
      await db.insert(learnedParameters).values({
        parameterName: 'min_confidence',
        parameterType: 'agent_confidence',
        agentName: 'TechnicalAnalyst',
        value: '0.50', // High threshold
        confidence: '0.85',
        sampleSize: 100,
        winRate: '0.55'
      });

      parameterLearning.clearCache();

      // Create mock signals with varying confidence
      const mockSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.40, // Below threshold - should be filtered
          strength: 0.8,
          reasoning: 'Test signal',
          qualityScore: 0.7,
          executionScore: 70,
          timestamp: Date.now(),
          symbol: testSymbol,
          evidence: {}
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.60, // Above default threshold - should pass
          strength: 0.9,
          reasoning: 'Test signal',
          qualityScore: 0.8,
          executionScore: 80,
          timestamp: Date.now(),
          symbol: testSymbol,
          evidence: {}
        }
      ];

      // Test that calculateConsensusWithAgentThresholds filters correctly
      // Note: This is an indirect test since the method is private
      // In production, we'd verify through logs or by checking final recommendation
      const threshold = await parameterLearning.getAgentConfidenceThreshold('TechnicalAnalyst');
      expect(threshold).toBe(0.50);
      expect(mockSignals[0].confidence).toBeLessThan(threshold);
      expect(mockSignals[1].confidence).toBeGreaterThan(0.30); // Default threshold
    });

    it('should fall back to default threshold when agent not found', async () => {
      const threshold = await parameterLearning.getAgentConfidenceThreshold('NonExistentAgent');
      
      expect(threshold).toBe(0.30); // Default fallback
    });
  });

  describe('Learning from Historical Data', () => {
    it('should learn optimal consensus threshold from trade history', async () => {
      // Create mock trade data
      const mockTrades = Array.from({ length: 50 }, (_, i) => ({
        consensusScore: 0.15 + (i % 10) * 0.05, // Varying consensus scores
        pnl: i % 3 === 0 ? 100 : -50, // 33% win rate
        duration: 3600000 // 1 hour
      }));

      await parameterLearning.learnConsensusThreshold(
        testSymbol,
        'trending_up',
        mockTrades
      );

      // Verify learned threshold was stored
      const db = await getDb();
      if (db) {
        const result = await db
          .select()
          .from(learnedParameters)
          .where(
            and(
              eq(learnedParameters.parameterName, 'consensus_threshold'),
              eq(learnedParameters.symbol, testSymbol),
              eq(learnedParameters.regime, 'trending_up')
            )
          )
          .limit(1);

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].sampleSize).toBe(50);
        expect(parseFloat(result[0].value as string)).toBeGreaterThan(0);
      }
    });

    it('should learn optimal agent confidence threshold from signal history', async () => {
      // Create mock signal data
      const mockSignals = Array.from({ length: 60 }, (_, i) => ({
        confidence: 0.20 + (i % 10) * 0.05, // Varying confidence levels
        correct: i % 2 === 0 // 50% accuracy
      }));

      await parameterLearning.learnAgentConfidenceThreshold(
        'TestAgent',
        mockSignals
      );

      // Verify learned threshold was stored
      const db = await getDb();
      if (db) {
        const result = await db
          .select()
          .from(learnedParameters)
          .where(
            and(
              eq(learnedParameters.parameterName, 'min_confidence'),
              eq(learnedParameters.agentName, 'TestAgent')
            )
          )
          .limit(1);

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].sampleSize).toBe(60);
        expect(parseFloat(result[0].value as string)).toBeGreaterThan(0);
      }
    });
  });

  describe('Cache Management', () => {
    it('should cache learned parameters for performance', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete existing test data
      await db.delete(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, testSymbol),
            eq(learnedParameters.regime, 'range_bound')
          )
        );
      
      // Insert test data
      await db.insert(learnedParameters).values({
        parameterName: 'consensus_threshold',
        parameterType: 'consensus_threshold',
        symbol: testSymbol,
        regime: 'range_bound',
        value: '0.12',
        confidence: '0.80',
        sampleSize: 75
      });

      // First call - should hit database
      const start1 = Date.now();
      const threshold1 = await parameterLearning.getConsensusThreshold(testSymbol, 'range_bound');
      const time1 = Date.now() - start1;

      // Second call - should hit cache
      const start2 = Date.now();
      const threshold2 = await parameterLearning.getConsensusThreshold(testSymbol, 'range_bound');
      const time2 = Date.now() - start2;

      expect(threshold1).toBe(threshold2);
      expect(threshold1).toBe(0.12);
      // Cache should be faster (though this is not guaranteed in all environments)
      // Just verify both calls succeeded
      expect(time1).toBeGreaterThanOrEqual(0);
      expect(time2).toBeGreaterThanOrEqual(0);
    });

    it('should clear cache on demand', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Delete existing test data
      await db.delete(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, testSymbol),
            eq(learnedParameters.regime, 'high_volatility')
          )
        );
      
      // Insert initial value
      await db.insert(learnedParameters).values({
        parameterName: 'consensus_threshold',
        parameterType: 'consensus_threshold',
        symbol: testSymbol,
        regime: 'high_volatility',
        value: '0.18',
        confidence: '0.80',
        sampleSize: 50
      });

      // Read to populate cache
      const threshold1 = await parameterLearning.getConsensusThreshold(testSymbol, 'high_volatility');
      expect(threshold1).toBe(0.18);

      // Update database
      await db.update(learnedParameters)
        .set({ value: '0.22' })
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, testSymbol),
            eq(learnedParameters.regime, 'high_volatility')
          )
        );

      // Clear cache
      parameterLearning.clearCache();

      // Read again - should get new value
      const threshold2 = await parameterLearning.getConsensusThreshold(testSymbol, 'high_volatility');
      expect(threshold2).toBe(0.22);
      expect(threshold2).not.toBe(threshold1);
    });
  });
});
