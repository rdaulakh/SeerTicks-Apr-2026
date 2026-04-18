/**
 * Tests for Agent Consensus Integration and Market Microstructure Analysis
 * 
 * Tests:
 * 1. AgentWeightManager - Configurable agent weights in consensus
 * 2. MarketMicrostructureAnalyzer - Bid/ask spread analysis
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock database
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe('Agent Consensus Integration', () => {
  describe('AgentWeightManager', () => {
    it('should export AgentWeightManager class and singleton', async () => {
      const { AgentWeightManager, getAgentWeightManager } = await import('../services/AgentWeightManager');
      
      expect(AgentWeightManager).toBeDefined();
      expect(getAgentWeightManager).toBeDefined();
      
      const manager = getAgentWeightManager(1);
      expect(manager).toBeInstanceOf(AgentWeightManager);
    });
    
    it('should have correct agent categories', async () => {
      const { AGENT_CATEGORIES, ALL_AGENTS } = await import('../services/AgentWeightManager');
      
      // Fast agents
      expect(AGENT_CATEGORIES.FAST).toContain('TechnicalAnalyst');
      expect(AGENT_CATEGORIES.FAST).toContain('PatternMatcher');
      expect(AGENT_CATEGORIES.FAST).toContain('OrderFlowAnalyst');
      
      // Slow agents
      expect(AGENT_CATEGORIES.SLOW).toContain('SentimentAnalyst');
      expect(AGENT_CATEGORIES.SLOW).toContain('NewsSentinel');
      expect(AGENT_CATEGORIES.SLOW).toContain('MacroAnalyst');
      expect(AGENT_CATEGORIES.SLOW).toContain('OnChainAnalyst');
      
      // Phase 2 agents
      expect(AGENT_CATEGORIES.PHASE2).toContain('WhaleTracker');
      expect(AGENT_CATEGORIES.PHASE2).toContain('FundingRateAnalyst');
      expect(AGENT_CATEGORIES.PHASE2).toContain('LiquidationHeatmap');
      expect(AGENT_CATEGORIES.PHASE2).toContain('OnChainFlowAnalyst');
      expect(AGENT_CATEGORIES.PHASE2).toContain('VolumeProfileAnalyzer');
      
      // All agents should be 13 total (Phase 28: added ForexCorrelationAgent)
      expect(AGENT_CATEGORIES.PHASE2).toContain('ForexCorrelationAgent');
      expect(ALL_AGENTS.length).toBe(13);
    });
    
    it('should have default weights for all agents', async () => {
      const { DEFAULT_AGENT_WEIGHTS, ALL_AGENTS } = await import('../services/AgentWeightManager');
      
      for (const agent of ALL_AGENTS) {
        expect(DEFAULT_AGENT_WEIGHTS[agent]).toBeDefined();
        expect(typeof DEFAULT_AGENT_WEIGHTS[agent]).toBe('number');
        expect(DEFAULT_AGENT_WEIGHTS[agent]).toBeGreaterThanOrEqual(0);
        expect(DEFAULT_AGENT_WEIGHTS[agent]).toBeLessThanOrEqual(100);
      }
    });
    
    it('should have default category multipliers', async () => {
      const { DEFAULT_CATEGORY_MULTIPLIERS } = await import('../services/AgentWeightManager');
      
      expect(DEFAULT_CATEGORY_MULTIPLIERS.FAST).toBe(0.70);
      expect(DEFAULT_CATEGORY_MULTIPLIERS.SLOW).toBe(0.50);
      expect(DEFAULT_CATEGORY_MULTIPLIERS.PHASE2).toBe(0.60);
    });
    
    it('should calculate agent weight correctly', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Test fast agent weight
      const technicalWeight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(technicalWeight).not.toBeNull();
      expect(technicalWeight?.category).toBe('FAST');
      expect(technicalWeight?.categoryMultiplier).toBe(0.70);
      expect(technicalWeight?.baseWeight).toBe(40);
      
      // Test slow agent weight
      const sentimentWeight = manager.calculateAgentWeight('SentimentAnalyst');
      expect(sentimentWeight).not.toBeNull();
      expect(sentimentWeight?.category).toBe('SLOW');
      expect(sentimentWeight?.categoryMultiplier).toBe(0.50);
      
      // Test phase 2 agent weight
      const whaleWeight = manager.calculateAgentWeight('WhaleTracker');
      expect(whaleWeight).not.toBeNull();
      expect(whaleWeight?.category).toBe('PHASE2');
      expect(whaleWeight?.categoryMultiplier).toBe(0.60);
    });
    
    it('should return null for unknown agents', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      const weight = manager.calculateAgentWeight('UnknownAgent');
      
      expect(weight).toBeNull();
    });
    
    it('should get agent category correctly', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      expect(manager.getAgentCategory('TechnicalAnalyst')).toBe('FAST');
      expect(manager.getAgentCategory('SentimentAnalyst')).toBe('SLOW');
      expect(manager.getAgentCategory('WhaleTracker')).toBe('PHASE2');
      expect(manager.getAgentCategory('UnknownAgent')).toBeNull();
    });
    
    it('should update agent weight', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Update weight
      manager.setAgentWeight('TechnicalAnalyst', 50);
      
      const weight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(weight?.baseWeight).toBe(50);
    });
    
    it('should clamp weights to valid range', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Try to set weight above 100
      manager.setAgentWeight('TechnicalAnalyst', 150);
      let weight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(weight?.baseWeight).toBe(100);
      
      // Try to set weight below 0
      manager.setAgentWeight('TechnicalAnalyst', -10);
      weight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(weight?.baseWeight).toBe(0);
    });
    
    it('should update category multiplier', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Update multiplier
      manager.setCategoryMultiplier('FAST', 0.8);
      
      const weight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(weight?.categoryMultiplier).toBe(0.8);
    });
    
    it('should record and track performance', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Record some performance
      manager.recordPerformance('TechnicalAnalyst', true);
      manager.recordPerformance('TechnicalAnalyst', true);
      manager.recordPerformance('TechnicalAnalyst', false);
      
      const summary = manager.getPerformanceSummary();
      expect(summary.TechnicalAnalyst.samples).toBe(3);
      expect(summary.TechnicalAnalyst.accuracy).toBeCloseTo(0.667, 2);
    });
    
    it('should get all weights', async () => {
      const { AgentWeightManager, ALL_AGENTS } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      const allWeights = manager.getAllWeights();
      
      expect(allWeights.length).toBe(ALL_AGENTS.length);
      
      for (const weight of allWeights) {
        expect(weight.agentName).toBeDefined();
        expect(weight.category).toBeDefined();
        expect(weight.baseWeight).toBeDefined();
        expect(weight.categoryMultiplier).toBeDefined();
        expect(weight.finalWeight).toBeDefined();
      }
    });
    
    it('should reset to defaults', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      // Change some weights
      manager.setAgentWeight('TechnicalAnalyst', 80);
      manager.setCategoryMultiplier('FAST', 0.5);
      
      // Reset
      manager.resetToDefaults();
      
      const weight = manager.calculateAgentWeight('TechnicalAnalyst');
      expect(weight?.baseWeight).toBe(40);
      expect(weight?.categoryMultiplier).toBe(0.70);
    });
    
    it('should get and update config', async () => {
      const { AgentWeightManager } = await import('../services/AgentWeightManager');
      
      const manager = new AgentWeightManager(1);
      
      const config = manager.getConfig();
      expect(config.userId).toBe(1);
      expect(config.weights).toBeDefined();
      expect(config.categoryMultipliers).toBeDefined();
      expect(config.isActive).toBe(true);
      
      // Update config
      manager.updateConfig({
        timeframeBonus: 15,
        isActive: false,
      });
      
      const updatedConfig = manager.getConfig();
      expect(updatedConfig.timeframeBonus).toBe(15);
      expect(updatedConfig.isActive).toBe(false);
    });
  });
});

describe('Market Microstructure Analysis', () => {
  describe('MarketMicrostructureAnalyzer', () => {
    it('should export MarketMicrostructureAnalyzer class and singleton', async () => {
      const { MarketMicrostructureAnalyzer, getMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      expect(MarketMicrostructureAnalyzer).toBeDefined();
      expect(getMicrostructureAnalyzer).toBeDefined();
      
      const analyzer = getMicrostructureAnalyzer();
      expect(analyzer).toBeInstanceOf(MarketMicrostructureAnalyzer);
    });
    
    it('should have correct default config', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      const status = analyzer.getStatus();
      
      expect(status.config.tightSpreadThreshold).toBe(0.05);
      expect(status.config.wideSpreadThreshold).toBe(0.15);
      expect(status.config.extremeSpreadThreshold).toBe(0.50);
      expect(status.config.significantImbalance).toBe(0.3);
      expect(status.config.lookbackPeriod).toBe(100);
      expect(status.config.anomalyZScoreThreshold).toBe(2.0);
    });
    
    it('should accept custom config', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer({
        tightSpreadThreshold: 0.03,
        wideSpreadThreshold: 0.20,
      });
      
      const status = analyzer.getStatus();
      expect(status.config.tightSpreadThreshold).toBe(0.03);
      expect(status.config.wideSpreadThreshold).toBe(0.20);
      // Other values should be defaults
      expect(status.config.extremeSpreadThreshold).toBe(0.50);
    });
    
    it('should return null for spread signal when no data', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      const signal = analyzer.getSpreadSignal('BTCUSDT');
      
      expect(signal).toBeNull();
    });
    
    it('should return empty history when no data', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      const history = analyzer.getSpreadHistory('BTCUSDT');
      
      expect(history).toEqual([]);
    });
    
    it('should return neutral execution score when no data', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      const score = analyzer.getExecutionScore('BTCUSDT');
      
      expect(score).toBe(50);
    });
    
    it('should return null for optimal execution price when no data', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      const result = analyzer.calculateOptimalExecutionPrice('BTCUSDT', 'buy', 'medium');
      
      expect(result).toBeNull();
    });
    
    it('should update config', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      
      analyzer.updateConfig({
        tightSpreadThreshold: 0.02,
        lookbackPeriod: 50,
      });
      
      const status = analyzer.getStatus();
      expect(status.config.tightSpreadThreshold).toBe(0.02);
      expect(status.config.lookbackPeriod).toBe(50);
    });
    
    it('should track running status', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      
      let status = analyzer.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.monitoredSymbols).toEqual([]);
    });
    
    it('should stop all monitoring', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      const analyzer = new MarketMicrostructureAnalyzer();
      analyzer.stopAll();
      
      const status = analyzer.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.monitoredSymbols).toEqual([]);
    });
  });
  
  describe('SpreadSignal Interface', () => {
    it('should have correct signal types', async () => {
      const { MarketMicrostructureAnalyzer } = await import('../services/MarketMicrostructureAnalyzer');
      
      // Just verify the module loads correctly with all types
      expect(MarketMicrostructureAnalyzer).toBeDefined();
    });
  });
});

describe('Integration Tests', () => {
  it('should integrate AgentWeightManager with StrategyOrchestrator types', async () => {
    const { AGENT_CATEGORIES } = await import('../services/AgentWeightManager');
    
    // Verify all categories are defined
    expect(AGENT_CATEGORIES.FAST).toBeDefined();
    expect(AGENT_CATEGORIES.SLOW).toBeDefined();
    expect(AGENT_CATEGORIES.PHASE2).toBeDefined();
    
    // Verify arrays are readonly
    expect(Object.isFrozen(AGENT_CATEGORIES.FAST)).toBe(false); // readonly but not frozen
    expect(Array.isArray(AGENT_CATEGORIES.FAST)).toBe(true);
  });
  
  it('should have consistent agent names across modules', async () => {
    const { ALL_AGENTS } = await import('../services/AgentWeightManager');
    
    // Core agents that should always exist
    const expectedAgents = [
      'TechnicalAnalyst',
      'PatternMatcher',
      'OrderFlowAnalyst',
      'SentimentAnalyst',
      'NewsSentinel',
      'MacroAnalyst',
      'OnChainAnalyst',
      'WhaleTracker',
      'FundingRateAnalyst',
      'LiquidationHeatmap',
      'OnChainFlowAnalyst',
      'VolumeProfileAnalyzer',
    ];
    
    for (const agent of expectedAgents) {
      expect(ALL_AGENTS).toContain(agent);
    }
  });
});
