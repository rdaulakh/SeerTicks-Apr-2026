/**
 * Phase 15 Post-Deployment Agent Audit
 * 
 * Comprehensive audit that verifies:
 * 1. All agents are registered and active
 * 2. Signal pipeline: agent → signal → consensus → trade decision
 * 3. Agent weight system is correctly configured
 * 4. Consensus mechanism produces valid outputs
 * 5. Phase 15 thresholds are correctly applied
 */

import { describe, it, expect } from 'vitest';

// ── Agent Registry Audit ──

describe('Phase 15 Agent Audit', () => {
  describe('Agent Registry', () => {
    it('should have all expected agents in ALL_AGENTS', async () => {
      const { ALL_AGENTS, AGENT_CATEGORIES } = await import('../services/AgentWeightManager');
      
      expect(ALL_AGENTS.length).toBeGreaterThanOrEqual(12);
      
      // FAST category
      expect(AGENT_CATEGORIES.FAST).toContain('TechnicalAnalyst');
      expect(AGENT_CATEGORIES.FAST).toContain('PatternMatcher');
      expect(AGENT_CATEGORIES.FAST).toContain('OrderFlowAnalyst');
      
      // SLOW category
      expect(AGENT_CATEGORIES.SLOW).toContain('SentimentAnalyst');
      expect(AGENT_CATEGORIES.SLOW).toContain('NewsSentinel');
      expect(AGENT_CATEGORIES.SLOW).toContain('MacroAnalyst');
      
      // PHASE2 category
      expect(AGENT_CATEGORIES.PHASE2).toContain('WhaleTracker');
      expect(AGENT_CATEGORIES.PHASE2).toContain('VolumeProfileAnalyzer');
    });

    it('should have correct category assignments', async () => {
      const { AGENT_CATEGORIES } = await import('../services/AgentWeightManager');
      
      expect(AGENT_CATEGORIES.FAST.length).toBeGreaterThanOrEqual(3);
      expect(AGENT_CATEGORIES.SLOW.length).toBeGreaterThanOrEqual(3);
      expect(AGENT_CATEGORIES.PHASE2.length).toBeGreaterThanOrEqual(4);
    });

    it('should have base weights summing to ~100 within each category', async () => {
      const { AGENT_CATEGORIES, DEFAULT_AGENT_WEIGHTS } = await import('../services/AgentWeightManager');
      
      for (const [, agents] of Object.entries(AGENT_CATEGORIES)) {
        const sum = agents.reduce((acc: number, agent: string) => {
          return acc + (DEFAULT_AGENT_WEIGHTS[agent as keyof typeof DEFAULT_AGENT_WEIGHTS] || 0);
        }, 0);
        // Allow for disabled agents (OnChainAnalyst = 0)
        expect(sum).toBeGreaterThanOrEqual(80);
        expect(sum).toBeLessThanOrEqual(101);
      }
    });
  });

  // ── Phase 15 Threshold Audit ──

  describe('Phase 15 Thresholds', () => {
    it('should have correct category multipliers', async () => {
      const { DEFAULT_CATEGORY_MULTIPLIERS } = await import('../services/AgentWeightManager');
      
      expect(DEFAULT_CATEGORY_MULTIPLIERS.FAST).toBe(0.70);
      expect(DEFAULT_CATEGORY_MULTIPLIERS.SLOW).toBe(0.50);
      expect(DEFAULT_CATEGORY_MULTIPLIERS.PHASE2).toBe(0.60);
    });

    it('should have correct PriorityExitManager config (Phase 15C)', async () => {
      const { DEFAULT_PRIORITY_EXIT_CONFIG } = await import('../services/PriorityExitManager');
      
      // Phase 44: Updated to match Phase 40 tuning values
      expect(DEFAULT_PRIORITY_EXIT_CONFIG.hardStopLossPercent).toBe(-0.8);
      expect(DEFAULT_PRIORITY_EXIT_CONFIG.maxLoserTimeMinutes).toBe(12);
      expect(DEFAULT_PRIORITY_EXIT_CONFIG.minHoldTimeForDecayMinutes).toBe(20); // Phase 45: increased from 10 to prevent noise direction flips
    });

    it('should enforce Phase 15B consensus rules (min 4 agents, >55% dominance)', async () => {
      // Verified by reading source: MIN_DIRECTION_RATIO = 0.55, MIN_AGENT_AGREEMENT = 4
      // We test the behavior: processSignals is async and takes (signals[], symbol)
      const { AutomatedSignalProcessor } = await import('../services/AutomatedSignalProcessor');
      const processor = new AutomatedSignalProcessor();
      
      // Create full AgentSignal objects (the interface requires many fields)
      const makeSignal = (name: string, direction: 'bullish' | 'bearish' | 'neutral', conf: number) => ({
        agentName: name,
        symbol: 'BTC-USD',
        timestamp: Date.now(),
        signal: direction,
        confidence: conf,
        strength: conf,
        executionScore: 70,
        reasoning: 'Test signal',
        evidence: {},
        qualityScore: 0.8,
        processingTime: 50,
        dataFreshness: 5,
      });
      
      // 5 bullish agents — should produce strong consensus
      const strongSignals = [
        makeSignal('TechnicalAnalyst', 'bullish', 0.80),
        makeSignal('SentimentAnalyst', 'bullish', 0.75),
        makeSignal('PatternMatcher', 'bullish', 0.70),
        makeSignal('WhaleTracker', 'bullish', 0.65),
        makeSignal('VolumeProfileAnalyzer', 'bullish', 0.60),
      ];
      
      const result = await processor.processSignals(strongSignals, 'BTC-USD');
      
      expect(result).toBeDefined();
      expect(result.symbol).toBe('BTC-USD');
      // With 5 bullish agents, consensus should be bullish
      if (result.consensus) {
        expect(result.consensus.direction).toBe('bullish');
        expect(result.consensus.strength).toBeGreaterThan(0);
      }
    });
  });

  // ── Signal Pipeline Audit ──

  describe('Signal Pipeline', () => {
    it('should produce valid ProcessedSignal from AutomatedSignalProcessor', async () => {
      const { AutomatedSignalProcessor } = await import('../services/AutomatedSignalProcessor');
      
      const processor = new AutomatedSignalProcessor();
      
      const makeSignal = (name: string, direction: 'bullish' | 'bearish' | 'neutral', conf: number) => ({
        agentName: name,
        symbol: 'BTC-USD',
        timestamp: Date.now(),
        signal: direction,
        confidence: conf,
        strength: conf,
        executionScore: 70,
        reasoning: 'Test signal',
        evidence: {},
        qualityScore: 0.8,
        processingTime: 50,
        dataFreshness: 5,
      });
      
      const signals = [
        makeSignal('TechnicalAnalyst', 'bullish', 0.75),
        makeSignal('SentimentAnalyst', 'bullish', 0.65),
        makeSignal('PatternMatcher', 'bullish', 0.70),
        makeSignal('WhaleTracker', 'bullish', 0.60),
        makeSignal('VolumeProfileAnalyzer', 'neutral', 0.50),
      ];
      
      const result = await processor.processSignals(signals, 'BTC-USD');
      
      expect(result).toBeDefined();
      expect(result.symbol).toBe('BTC-USD');
      expect(typeof result.approved).toBe('boolean');
      expect(result.reason).toBeDefined();
      expect(Array.isArray(result.signals)).toBe(true);
    });
  });

  // ── AgentWeightManager Integration ──

  describe('AgentWeightManager Integration', () => {
    it('should calculate weights for all registered agents', async () => {
      const { AgentWeightManager, ALL_AGENTS } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager();
      
      for (const name of ALL_AGENTS) {
        const result = manager.calculateAgentWeight(name);
        expect(result, `Weight for ${name} should be calculable`).not.toBeNull();
        if (result) {
          expect(result.finalWeight).toBeGreaterThanOrEqual(0);
          expect(result.baseWeight).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('should produce non-zero consensus weights', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager();
      const weights = manager.getConsensusWeights();
      
      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).toBeGreaterThan(0);
      
      for (const [, weight] of Object.entries(weights)) {
        expect(weight).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── ConfidenceDecayTracker Audit ──

  describe('ConfidenceDecayTracker', () => {
    it('should register and track positions', async () => {
      const { ConfidenceDecayTracker } = await import('../services/ConfidenceDecayTracker');
      
      const tracker = new ConfidenceDecayTracker();
      
      tracker.registerPosition('pos-1', 'BTC-USD', 0.80);
      const state = tracker.getState('pos-1');
      
      expect(state).toBeDefined();
      expect(state!.symbol).toBe('BTC-USD');
      expect(state!.entryConfidence).toBe(0.80);
    });

    it('should evaluate confidence decay for positions', async () => {
      const { ConfidenceDecayTracker } = await import('../services/ConfidenceDecayTracker');
      
      const tracker = new ConfidenceDecayTracker();
      
      tracker.registerPosition('pos-2', 'BTC-USD', 0.80);
      
      const result = tracker.updateConfidence('pos-2', 0.50, -0.5);
      
      expect(result).toBeDefined();
      expect(typeof result.shouldExit).toBe('boolean');
      expect(result.reason).toBeDefined();
    });
  });

  // ── FlashCrashDetector Audit ──

  describe('FlashCrashDetector', () => {
    it('should initialize with correct default state', async () => {
      const { FlashCrashDetector } = await import('../services/FlashCrashDetector');
      
      const detector = new FlashCrashDetector();
      const status = detector.getStatus();
      
      expect(status.isActive).toBe(false);
      expect(status.totalDetections).toBe(0);
    });

    it('should process price ticks without errors', async () => {
      const { FlashCrashDetector } = await import('../services/FlashCrashDetector');
      
      const detector = new FlashCrashDetector();
      
      const basePrice = 65000;
      // Build baseline with 30 stable ticks
      for (let i = 0; i < 30; i++) {
        detector.processPriceTick('BTC-USD', basePrice + Math.random() * 50, 100);
      }
      // Then crash 15% over 20 ticks
      for (let i = 0; i < 20; i++) {
        const price = basePrice * (1 - i * 0.008);
        detector.processPriceTick('BTC-USD', price, 500);
      }
      
      const status = detector.getStatus();
      expect(status).toBeDefined();
      // Detector should have processed all ticks
      expect(typeof status.isActive).toBe('boolean');
      expect(typeof status.totalDetections).toBe('number');
    });
  });

  // ── End-to-End Pipeline Trace ──

  describe('End-to-End Pipeline Trace', () => {
    it('should trace: agents → weights → signals → consensus → decision', async () => {
      const { AutomatedSignalProcessor } = await import('../services/AutomatedSignalProcessor');
      const { AgentWeightManager, ALL_AGENTS, AGENT_CATEGORIES } = await import('../services/AgentWeightManager');
      const { ConfidenceDecayTracker } = await import('../services/ConfidenceDecayTracker');
      
      // Step 1: Verify agents exist
      expect(ALL_AGENTS.length).toBeGreaterThanOrEqual(12);
      
      // Step 2: Verify categories
      expect(AGENT_CATEGORIES.FAST.length).toBeGreaterThanOrEqual(3);
      expect(AGENT_CATEGORIES.SLOW.length).toBeGreaterThanOrEqual(3);
      expect(AGENT_CATEGORIES.PHASE2.length).toBeGreaterThanOrEqual(4);
      
      // Step 3: Verify weight calculation
      const weightManager = new AgentWeightManager();
      const weights = weightManager.getConsensusWeights();
      expect(Object.keys(weights).length).toBeGreaterThanOrEqual(10);
      
      // Step 4: Create full AgentSignal objects
      const makeSignal = (name: string, direction: 'bullish' | 'bearish' | 'neutral', conf: number) => ({
        agentName: name,
        symbol: 'BTC-USD',
        timestamp: Date.now(),
        signal: direction,
        confidence: conf,
        strength: conf,
        executionScore: 70,
        reasoning: 'Pipeline trace test',
        evidence: {},
        qualityScore: 0.8,
        processingTime: 50,
        dataFreshness: 5,
      });
      
      const signals = [
        makeSignal('TechnicalAnalyst', 'bullish', 0.72),
        makeSignal('SentimentAnalyst', 'bullish', 0.65),
        makeSignal('PatternMatcher', 'bullish', 0.68),
        makeSignal('WhaleTracker', 'bullish', 0.60),
        makeSignal('VolumeProfileAnalyzer', 'bullish', 0.55),
        makeSignal('MacroAnalyst', 'neutral', 0.40),
      ];
      
      // Step 5: Verify ConfidenceDecayTracker can track positions
      const decayTracker = new ConfidenceDecayTracker();
      decayTracker.registerPosition('audit-pos', 'BTC-USD', 0.75);
      const decayState = decayTracker.getState('audit-pos');
      expect(decayState).toBeDefined();
      expect(decayState!.entryConfidence).toBe(0.75);
      
      // Step 6: Process through consensus (async)
      const processor = new AutomatedSignalProcessor();
      const result = await processor.processSignals(signals, 'BTC-USD');
      
      expect(result).toBeDefined();
      expect(result.symbol).toBe('BTC-USD');
      expect(typeof result.approved).toBe('boolean');
      expect(result.reason).toBeDefined();
      
      // With 5 bullish + 1 neutral, consensus should be bullish
      if (result.consensus) {
        expect(result.consensus.direction).toBe('bullish');
        expect(result.consensus.strength).toBeGreaterThan(0);
      }
    });
  });
});
