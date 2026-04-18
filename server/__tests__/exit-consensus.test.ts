import { describe, it, expect } from 'vitest';
import { calculateExitConsensus, ExitConsensus } from '../services/AutomatedSignalProcessor';
import type { AgentSignal } from '../agents/AgentBase';

describe('Exit Consensus Calculator', () => {
  const agentWeights = {
    'TechnicalAnalyst': 0.40,
    'PatternMatcher': 0.35,
    'OrderFlowAnalyst': 0.25,
    'SentimentAnalyst': 0.15,
  };

  describe('calculateExitConsensus', () => {
    it('should return hold when no signals have exit recommendations', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bullish',
          confidence: 0.8,
          strength: 0.7,
          executionScore: 80,
          reasoning: 'Test',
          qualityScore: 0.8,
          processingTime: 10,
          dataFreshness: 1,
          // No exitRecommendation
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights);

      expect(result.action).toBe('hold');
      expect(result.confidence).toBe(0);
      expect(result.votingAgents).toBe(0);
    });

    it('should calculate full exit consensus when majority agree', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bearish',
          confidence: 0.8,
          strength: 0.7,
          executionScore: 80,
          reasoning: 'RSI overbought',
          qualityScore: 0.8,
          processingTime: 10,
          dataFreshness: 1,
          exitRecommendation: {
            action: 'full_exit',
            urgency: 'high',
            reason: 'RSI overbought (82)',
            confidence: 0.85,
          },
        },
        {
          agentName: 'PatternMatcher',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bearish',
          confidence: 0.75,
          strength: 0.6,
          executionScore: 70,
          reasoning: 'Pattern reversal',
          qualityScore: 0.7,
          processingTime: 15,
          dataFreshness: 2,
          exitRecommendation: {
            action: 'full_exit',
            urgency: 'high',
            reason: 'Pattern alpha decayed',
            confidence: 0.80,
          },
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights, 0.6);

      expect(result.action).toBe('full_exit');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.urgency).toBe('high');
      expect(result.votingAgents).toBe(2);
      expect(result.exitVotes).toBe(2);
    });

    it('should calculate partial exit consensus', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'neutral',
          confidence: 0.6,
          strength: 0.5,
          executionScore: 60,
          reasoning: 'Mixed signals',
          qualityScore: 0.6,
          processingTime: 10,
          dataFreshness: 1,
          exitRecommendation: {
            action: 'partial_exit',
            urgency: 'medium',
            reason: 'RSI elevated (72)',
            exitPercent: 50,
            confidence: 0.70,
          },
        },
        {
          agentName: 'PatternMatcher',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'neutral',
          confidence: 0.55,
          strength: 0.5,
          executionScore: 55,
          reasoning: 'Pattern weakening',
          qualityScore: 0.6,
          processingTime: 15,
          dataFreshness: 2,
          exitRecommendation: {
            action: 'partial_exit',
            urgency: 'low',
            reason: 'Pattern confidence dropping',
            exitPercent: 25,
            confidence: 0.65,
          },
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights, 0.5);

      expect(result.action).toBe('partial_exit');
      expect(result.exitPercent).toBeDefined();
      expect(result.exitPercent).toBeGreaterThan(0);
      expect(result.votingAgents).toBe(2);
    });

    it('should track highest urgency level', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bearish',
          confidence: 0.9,
          strength: 0.85,
          executionScore: 90,
          reasoning: 'Critical exit',
          qualityScore: 0.9,
          processingTime: 10,
          dataFreshness: 1,
          exitRecommendation: {
            action: 'full_exit',
            urgency: 'critical',
            reason: 'Emergency exit - RSI > 90',
            confidence: 0.95,
          },
        },
        {
          agentName: 'PatternMatcher',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bearish',
          confidence: 0.7,
          strength: 0.6,
          executionScore: 70,
          reasoning: 'Exit signal',
          qualityScore: 0.7,
          processingTime: 15,
          dataFreshness: 2,
          exitRecommendation: {
            action: 'full_exit',
            urgency: 'medium',
            reason: 'Pattern invalidated',
            confidence: 0.75,
          },
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights, 0.5);

      expect(result.urgency).toBe('critical');
    });

    it('should return hold when consensus below threshold', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bullish',
          confidence: 0.8,
          strength: 0.7,
          executionScore: 80,
          reasoning: 'Still bullish',
          qualityScore: 0.8,
          processingTime: 10,
          dataFreshness: 1,
          exitRecommendation: {
            action: 'hold',
            urgency: 'low',
            reason: 'No exit signals',
            confidence: 0.2,
          },
        },
        {
          agentName: 'PatternMatcher',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bullish',
          confidence: 0.75,
          strength: 0.65,
          executionScore: 75,
          reasoning: 'Pattern intact',
          qualityScore: 0.75,
          processingTime: 15,
          dataFreshness: 2,
          exitRecommendation: {
            action: 'hold',
            urgency: 'low',
            reason: 'Pattern holding steady',
            confidence: 0.15,
          },
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights, 0.6);

      expect(result.action).toBe('hold');
      expect(result.holdVotes).toBe(2);
    });

    it('should use default weights for unknown agents', () => {
      const signals: AgentSignal[] = [
        {
          agentName: 'UnknownAgent',
          symbol: 'BTC-USD',
          timestamp: Date.now(),
          signal: 'bearish',
          confidence: 0.9,
          strength: 0.85,
          executionScore: 90,
          reasoning: 'Exit now',
          qualityScore: 0.9,
          processingTime: 10,
          dataFreshness: 1,
          exitRecommendation: {
            action: 'full_exit',
            urgency: 'high',
            reason: 'Unknown agent exit signal',
            confidence: 0.90,
          },
        },
      ];

      const result = calculateExitConsensus(signals, agentWeights, 0.01);

      // Should still process even with unknown agent (uses 0.05 default weight)
      expect(result.votingAgents).toBe(1);
      expect(result.exitVotes).toBe(1);
    });
  });
});
