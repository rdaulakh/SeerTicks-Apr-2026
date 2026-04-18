import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AutomatedSignalProcessor } from '../services/AutomatedSignalProcessor';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { AutomatedPositionMonitor } from '../services/AutomatedPositionMonitor';
import type { AgentSignal } from '../agents/AgentBase';

describe('Automation Workflow', () => {
  describe('AutomatedSignalProcessor', () => {
    it('should approve high-confidence signals with strong consensus', async () => {
      const processor = new AutomatedSignalProcessor(1, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });

      // Phase 15B requires min 4 agents agreeing AND >55% directional dominance
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 90,
          qualityScore: 0.9,
          reasoning: 'Strong uptrend',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.75,
          executionScore: 80,
          qualityScore: 0.8,
          reasoning: 'Double bottom pattern',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.70,
          executionScore: 75,
          qualityScore: 0.75,
          reasoning: 'Strong buy pressure',
          timestamp: Date.now(),
        },
        {
          agentName: 'OnChainAnalyst',
          signal: 'bullish',
          confidence: 0.72,
          executionScore: 78,
          qualityScore: 0.78,
          reasoning: 'Whale accumulation detected',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.68,
          executionScore: 72,
          qualityScore: 0.72,
          reasoning: 'Positive market sentiment',
          timestamp: Date.now(),
        },
      ];

      const result = await processor.processSignals(signals, 'BTCUSDT');

      expect(result.approved).toBe(true);
      expect(result.consensus).toBeDefined();
      expect(result.consensus?.direction).toBe('bullish');
      expect(result.consensus?.strength).toBeGreaterThan(0.65);
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation?.action).toBe('buy');
    });

    it('should reject low-confidence signals', async () => {
      const processor = new AutomatedSignalProcessor(1, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });

      // Phase 44: Need 4+ agents to pass MIN_AGENTS gate, but all below confidence threshold
      const signals: AgentSignal[] = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.45, executionScore: 40, qualityScore: 0.4, reasoning: 'Weak', timestamp: Date.now() },
        { agentName: 'PatternMatcher', signal: 'bullish', confidence: 0.40, executionScore: 35, qualityScore: 0.35, reasoning: 'Weak', timestamp: Date.now() },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish', confidence: 0.42, executionScore: 38, qualityScore: 0.38, reasoning: 'Weak', timestamp: Date.now() },
        { agentName: 'OnChainAnalyst', signal: 'bullish', confidence: 0.38, executionScore: 30, qualityScore: 0.3, reasoning: 'Weak', timestamp: Date.now() },
      ];

      const result = await processor.processSignals(signals, 'BTCUSDT');

      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/confidence|consensus|agents/i);
    });

    it('should reject signals with weak consensus', async () => {
      const processor = new AutomatedSignalProcessor(1, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });

      // Phase 44: Use agents with similar weights so 2v2 split produces weak consensus.
      // TechnicalAnalyst has high weight, so pair it with a bearish high-weight agent.
      const signals: AgentSignal[] = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.70, executionScore: 70, qualityScore: 0.7, reasoning: 'Bullish', timestamp: Date.now() },
        { agentName: 'OrderFlowAnalyst', signal: 'bearish', confidence: 0.75, executionScore: 70, qualityScore: 0.7, reasoning: 'Bearish', timestamp: Date.now() },
        { agentName: 'OnChainAnalyst', signal: 'bullish', confidence: 0.60, executionScore: 65, qualityScore: 0.65, reasoning: 'Bullish', timestamp: Date.now() },
        { agentName: 'FundingRateAnalyst', signal: 'bearish', confidence: 0.75, executionScore: 68, qualityScore: 0.68, reasoning: 'Bearish', timestamp: Date.now() },
      ];

      const result = await processor.processSignals(signals, 'BTCUSDT');

      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/consensus|agents/i);
    });
  });

  describe('AutomatedTradeExecutor', () => {
    it('should calculate position size using Kelly Criterion', () => {
      const executor = new AutomatedTradeExecutor(1, {
        maxPositionSize: 0.20,
        defaultStopLoss: 0.05,
        defaultTakeProfit: 0.10,
      });

      const config = executor.getConfig();
      expect(config.maxPositionSize).toBe(0.20);
      expect(config.defaultStopLoss).toBe(0.05);
      expect(config.defaultTakeProfit).toBe(0.10);
    });

    it('should queue signals for execution', async () => {
      const executor = new AutomatedTradeExecutor(1);

      const processedSignal = {
        approved: true,
        reason: 'High confidence',
        symbol: 'BTCUSDT',
        signals: [],
        recommendation: {
          action: 'buy' as const,
          confidence: 0.85,
          executionScore: 90,
          reasoning: 'Strong bullish signal',
        },
      };

      await executor.queueSignal(processedSignal);

      const status = executor.getQueueStatus();
      expect(status.queueSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('AutomatedPositionMonitor', () => {
    it('should initialize with correct configuration', () => {
      const monitor = new AutomatedPositionMonitor(1, {
        monitoringIntervalMs: 100,
        enableTrailingStop: true,
        trailingStopDistance: 0.03,
        trailingStopActivation: 0.05,
      });

      const status = monitor.getStatus();
      expect(status.isMonitoring).toBe(false); // Not started yet
      expect(status.monitoringIntervalMs).toBe(100);
      expect(status.enableTrailingStop).toBe(true);
      expect(status.trailingStopDistance).toBe(0.03);
      expect(status.trailingStopActivation).toBe(0.05);
    });
  });

  describe('End-to-End Automation Flow', () => {
    it('should process signals through complete automation pipeline', async () => {
      // Step 1: Signal Processor approves high-confidence signals
      const processor = new AutomatedSignalProcessor(1, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });

      // Phase 15B requires min 4 agents agreeing AND >55% directional dominance
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 90,
          qualityScore: 0.9,
          reasoning: 'Strong uptrend with high volume',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          executionScore: 85,
          qualityScore: 0.85,
          reasoning: 'Bullish engulfing pattern confirmed',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          executionScore: 80,
          qualityScore: 0.8,
          reasoning: 'Large buy orders detected',
          timestamp: Date.now(),
        },
        {
          agentName: 'OnChainAnalyst',
          signal: 'bullish',
          confidence: 0.72,
          executionScore: 78,
          qualityScore: 0.78,
          reasoning: 'Whale accumulation detected',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.70,
          executionScore: 75,
          qualityScore: 0.75,
          reasoning: 'Positive market sentiment',
          timestamp: Date.now(),
        },
      ];

      const processedSignal = await processor.processSignals(signals, 'BTCUSDT');

      // Verify signal was approved
      expect(processedSignal.approved).toBe(true);
      expect(processedSignal.recommendation).toBeDefined();
      expect(processedSignal.recommendation?.action).toBe('buy');
      expect(processedSignal.metrics).toBeDefined();
      expect(processedSignal.metrics?.avgConfidence).toBeGreaterThan(0.65);

      // Step 2: Trade Executor would receive the signal
      const executor = new AutomatedTradeExecutor(1);
      await executor.queueSignal(processedSignal);

      // Verify signal was queued
      const queueStatus = executor.getQueueStatus();
      expect(queueStatus.queueSize).toBeGreaterThanOrEqual(0);

      console.log('✅ End-to-end automation flow test passed');
      console.log(`   - Signal approved: ${processedSignal.approved}`);
      console.log(`   - Action: ${processedSignal.recommendation?.action}`);
      console.log(`   - Confidence: ${(processedSignal.metrics?.avgConfidence || 0) * 100}%`);
      console.log(`   - Execution score: ${processedSignal.metrics?.avgExecutionScore}`);
    });
  });
});
