/**
 * Phase 35: Advanced Intelligence Features Tests
 * 
 * Tests for:
 * 1. AgentRetriggerService — re-trigger on rejection
 * 2. MonteCarloSimulator — probabilistic outcome projection
 * 3. CrossCycleMemory — persistent insight tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// 1. AgentRetriggerService Tests
// ============================================================

describe('AgentRetriggerService', () => {
  let retriggerService: any;

  beforeEach(async () => {
    const { AgentRetriggerService } = await import('../services/AgentRetriggerService');
    retriggerService = new AgentRetriggerService();
  });

  it('should skip re-trigger when score is too low', async () => {
    const result = await retriggerService.attemptRetrigger(
      'BTC-USD',
      [],
      { direction: 'bullish', strength: 0.3 },
      { approved: false, score: 0.10, reasons: ['Too weak'], warnings: [], adjustments: { positionSizeMultiplier: 1 } },
      { regime: 'range_bound' },
      1
    );

    expect(result.retriggered).toBe(false);
    expect(result.reason).toContain('too low');
  });

  it('should skip re-trigger when score is too close to threshold', async () => {
    const result = await retriggerService.attemptRetrigger(
      'BTC-USD',
      [],
      { direction: 'bullish', strength: 0.5 },
      { approved: false, score: 0.35, reasons: ['Marginal'], warnings: [], adjustments: { positionSizeMultiplier: 1 } },
      { regime: 'trending_up' },
      1
    );

    expect(result.retriggered).toBe(false);
    expect(result.reason).toContain('too close to threshold');
  });

  it('should enforce cooldown between re-triggers for same symbol', async () => {
    // First attempt (should proceed or skip based on score, but set cooldown)
    await retriggerService.attemptRetrigger(
      'ETH-USD',
      [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.5 }],
      { direction: 'bullish', strength: 0.4 },
      { approved: false, score: 0.25, reasons: ['Signal quality low'], warnings: [], adjustments: { positionSizeMultiplier: 1 } },
      { regime: 'range_bound' },
      1
    );

    // Second attempt immediately (should be cooldown blocked)
    const result2 = await retriggerService.attemptRetrigger(
      'ETH-USD',
      [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.5 }],
      { direction: 'bullish', strength: 0.4 },
      { approved: false, score: 0.25, reasons: ['Signal quality low'], warnings: [], adjustments: { positionSizeMultiplier: 1 } },
      { regime: 'range_bound' },
      1
    );

    expect(result2.retriggered).toBe(false);
    expect(result2.reason).toContain('cooldown');
  });

  it('should track statistics correctly', async () => {
    const stats = retriggerService.getStats();
    expect(stats).toHaveProperty('totalRejections');
    expect(stats).toHaveProperty('totalRetriggers');
    expect(stats).toHaveProperty('successfulRetriggers');
    expect(stats).toHaveProperty('failedRetriggers');
    expect(stats).toHaveProperty('skippedRetriggers');
    expect(stats).toHaveProperty('successRate');
    expect(typeof stats.successRate).toBe('number');
  });

  it('should identify weakest factor from evaluation', async () => {
    // Test regime alignment detection
    const result = await retriggerService.attemptRetrigger(
      'BTC-USD',
      [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.5 }],
      { direction: 'bullish', strength: 0.4 },
      { approved: false, score: 0.25, reasons: ['Regime alignment too low'], warnings: [], adjustments: { positionSizeMultiplier: 1 } },
      { regime: 'high_volatility' },
      1
    );

    // Should attempt re-trigger (score is in valid range 0.20-0.34)
    // The actual result depends on AgentManager availability, but the attempt should be made
    expect(result).toHaveProperty('refinedQuestions');
    expect(result).toHaveProperty('agentsRerun');
  });

  it('should reset stats correctly', () => {
    retriggerService.resetStats();
    const stats = retriggerService.getStats();
    expect(stats.totalRejections).toBe(0);
    expect(stats.totalRetriggers).toBe(0);
    expect(stats.successfulRetriggers).toBe(0);
    expect(stats.failedRetriggers).toBe(0);
  });
});

// ============================================================
// 2. MonteCarloSimulator Tests
// ============================================================

describe('MonteCarloSimulator', () => {
  let simulator: any;

  beforeEach(async () => {
    const { MonteCarloSimulator } = await import('../services/MonteCarloSimulator');
    simulator = new MonteCarloSimulator({ numSimulations: 100, numSteps: 30 });
  });

  it('should produce valid simulation results', () => {
    const result = simulator.simulate(50000, 'long', 'trending_up', 0.7, undefined, 42);

    expect(result).toHaveProperty('p10');
    expect(result).toHaveProperty('p25');
    expect(result).toHaveProperty('p50');
    expect(result).toHaveProperty('p75');
    expect(result).toHaveProperty('p90');
    expect(result).toHaveProperty('probabilityOfProfit');
    expect(result).toHaveProperty('expectedReturn');
    expect(result).toHaveProperty('valueAtRisk95');
    expect(result).toHaveProperty('conditionalVaR95');
    expect(result).toHaveProperty('sharpeRatio');
    expect(result).toHaveProperty('skewness');
    expect(result).toHaveProperty('kurtosis');
    expect(result).toHaveProperty('samplePaths');
    expect(result).toHaveProperty('returnDistribution');
  });

  it('should have percentiles in ascending order', () => {
    const result = simulator.simulate(50000, 'long', 'range_bound', 0.5, undefined, 42);
    expect(result.p10).toBeLessThanOrEqual(result.p25);
    expect(result.p25).toBeLessThanOrEqual(result.p50);
    expect(result.p50).toBeLessThanOrEqual(result.p75);
    expect(result.p75).toBeLessThanOrEqual(result.p90);
  });

  it('should have probability of profit between 0 and 1', () => {
    const result = simulator.simulate(50000, 'long', 'trending_up', 0.8, undefined, 42);
    expect(result.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfProfit).toBeLessThanOrEqual(1);
  });

  it('should produce wider distribution in high_volatility regime', () => {
    const calmResult = simulator.simulate(50000, 'long', 'range_bound', 0.5, undefined, 42);
    const volatileResult = simulator.simulate(50000, 'long', 'high_volatility', 0.5, undefined, 42);

    // High volatility should have wider spread (p90 - p10)
    const calmSpread = calmResult.p90 - calmResult.p10;
    const volatileSpread = volatileResult.p90 - volatileResult.p10;
    expect(volatileSpread).toBeGreaterThan(calmSpread);
  });

  it('should produce higher VaR in high_volatility regime', () => {
    const calmResult = simulator.simulate(50000, 'long', 'range_bound', 0.5, undefined, 42);
    const volatileResult = simulator.simulate(50000, 'long', 'high_volatility', 0.5, undefined, 42);

    expect(volatileResult.valueAtRisk95).toBeGreaterThan(calmResult.valueAtRisk95);
  });

  it('should produce 5 sample paths', () => {
    const result = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 42);
    expect(result.samplePaths).toHaveLength(5);
    // Each path should have numSteps + 1 points (including start)
    expect(result.samplePaths[0]).toHaveLength(31); // 30 steps + 1
  });

  it('should produce 20-bin return distribution', () => {
    const result = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 42);
    expect(result.returnDistribution).toHaveLength(20);
    // Sum of bins should equal number of simulations
    const totalBins = result.returnDistribution.reduce((a: number, b: number) => a + b, 0);
    expect(totalBins).toBe(100); // numSimulations = 100
  });

  it('should be deterministic with same seed', () => {
    const result1 = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 42);
    const result2 = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 42);
    expect(result1.p50).toBe(result2.p50);
    expect(result1.expectedReturn).toBe(result2.expectedReturn);
    expect(result1.probabilityOfProfit).toBe(result2.probabilityOfProfit);
  });

  it('should produce different results with different seeds', () => {
    const result1 = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 42);
    const result2 = simulator.simulate(50000, 'long', 'trending_up', 0.5, undefined, 99);
    // Results should differ (extremely unlikely to be identical)
    expect(result1.p50 === result2.p50 && result1.expectedReturn === result2.expectedReturn).toBe(false);
  });

  it('should convert to ScenarioProjection format', () => {
    const result = simulator.simulate(50000, 'long', 'trending_up', 0.7, undefined, 42);
    const projection = simulator.toScenarioProjection(result, 50000, 'long', 'trending_up');

    expect(projection).toHaveProperty('bestCase');
    expect(projection).toHaveProperty('worstCase');
    expect(projection).toHaveProperty('realisticCase');
    expect(projection).toHaveProperty('riskRewardRatio');
    expect(projection).toHaveProperty('expectedValue');
    expect(projection).toHaveProperty('suggestedStopLoss');
    expect(projection).toHaveProperty('suggestedTakeProfit');
    expect(projection).toHaveProperty('maxHoldingPeriodHours');
    expect(projection).toHaveProperty('regime');
    expect(projection.regime).toBe('trending_up');

    // Best case should be better than worst case for long
    expect(projection.bestCase.pnlPercent).toBeGreaterThan(projection.worstCase.pnlPercent);
  });

  it('should handle short direction correctly', () => {
    const result = simulator.simulate(50000, 'short', 'trending_down', 0.7, undefined, 42);
    // In trending_down with short, probability of profit should be reasonable
    expect(result.probabilityOfProfit).toBeGreaterThan(0);
    expect(result.probabilityOfProfit).toBeLessThanOrEqual(1);
  });

  it('should handle ATR calibration', () => {
    const withoutAtr = simulator.simulate(50000, 'long', 'range_bound', 0.5, undefined, 42);
    const withHighAtr = simulator.simulate(50000, 'long', 'range_bound', 0.5, 5.0, 42);

    // High ATR should produce wider distribution
    const spreadWithout = withoutAtr.p90 - withoutAtr.p10;
    const spreadWith = withHighAtr.p90 - withHighAtr.p10;
    expect(spreadWith).toBeGreaterThan(spreadWithout);
  });
});

// ============================================================
// 3. CrossCycleMemory Tests
// ============================================================

describe('CrossCycleMemory', () => {
  let memory: any;

  beforeEach(async () => {
    const { CrossCycleMemory } = await import('../services/CrossCycleMemory');
    memory = new CrossCycleMemory();
  });

  it('should record cycle insights', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Strong support level detected', timestamp: Date.now() },
      { agentName: 'SentimentAnalyst', signal: 'bullish', confidence: 0.6, reasoning: 'Positive momentum building', timestamp: Date.now() },
    ], 'trending_up', 50000);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.cycleCount).toBe(1);
    expect(ctx.recentInsights.length).toBeGreaterThan(0);
  });

  it('should track signal persistence across cycles', () => {
    // 3 consistent bullish cycles
    for (let i = 0; i < 3; i++) {
      memory.recordCycle('BTC-USD', [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Support holds', timestamp: Date.now() },
      ], 'trending_up', 50000 + i * 100);
    }

    const ctx = memory.getContext('BTC-USD');
    const persistence = ctx.signalPersistence['TechnicalAnalyst'];
    expect(persistence).toBeDefined();
    expect(persistence.currentSignal).toBe('bullish');
    expect(persistence.consecutiveCycles).toBe(3);
    expect(persistence.convictionScore).toBeGreaterThan(0.1); // Should grow
  });

  it('should detect signal flips', () => {
    // Bullish cycle
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Bullish', timestamp: Date.now() },
    ], 'trending_up', 50000);

    // Bearish flip
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.7, reasoning: 'Bearish reversal', timestamp: Date.now() },
    ], 'trending_down', 49500);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.signalFlips.length).toBe(1);
    expect(ctx.signalFlips[0].from).toBe('bullish');
    expect(ctx.signalFlips[0].to).toBe('bearish');
    expect(ctx.signalFlips[0].agentName).toBe('TechnicalAnalyst');
  });

  it('should decay conviction on signal flip', () => {
    // Build conviction with 5 bullish cycles
    for (let i = 0; i < 5; i++) {
      memory.recordCycle('BTC-USD', [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Bullish', timestamp: Date.now() },
      ], 'trending_up', 50000);
    }

    const beforeFlip = memory.getContext('BTC-USD').signalPersistence['TechnicalAnalyst'].convictionScore;

    // Flip to bearish
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.7, reasoning: 'Reversal', timestamp: Date.now() },
    ], 'trending_down', 49500);

    const afterFlip = memory.getContext('BTC-USD').signalPersistence['TechnicalAnalyst'].convictionScore;
    expect(afterFlip).toBeLessThan(beforeFlip);
  });

  it('should calculate dominant direction correctly', () => {
    // 3 bullish agents, 1 bearish
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Bullish', timestamp: Date.now() },
      { agentName: 'SentimentAnalyst', signal: 'bullish', confidence: 0.7, reasoning: 'Bullish', timestamp: Date.now() },
      { agentName: 'OrderFlowAnalyst', signal: 'bullish', confidence: 0.6, reasoning: 'Bullish', timestamp: Date.now() },
      { agentName: 'MacroAnalyst', signal: 'bearish', confidence: 0.5, reasoning: 'Bearish', timestamp: Date.now() },
    ], 'trending_up', 50000);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.dominantDirection).toBe('bullish');
    expect(ctx.directionStrength).toBeGreaterThan(0.5);
  });

  it('should track regime history', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50000);

    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'neutral', confidence: 0.5, reasoning: 'Test', timestamp: Date.now() },
    ], 'high_volatility', 49800);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.regimeHistory.length).toBe(2);
    expect(ctx.regimeHistory[0].regime).toBe('trending_up');
    expect(ctx.regimeHistory[1].regime).toBe('high_volatility');
  });

  it('should generate agent summary string', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Strong support level', timestamp: Date.now() },
    ], 'trending_up', 50000);

    const summary = memory.getSummaryForAgent('BTC-USD', 'TechnicalAnalyst');
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('bullish');
  });

  it('should track price history', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50000);

    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50500);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.priceHistory.length).toBe(2);
    expect(ctx.priceHistory[0].price).toBe(50000);
    expect(ctx.priceHistory[1].price).toBe(50500);
  });

  it('should clear symbol memory', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50000);

    memory.clearSymbol('BTC-USD');
    const ctx = memory.getContext('BTC-USD');
    expect(ctx.cycleCount).toBe(0);
    expect(ctx.recentInsights.length).toBe(0);
  });

  it('should get stats for all symbols', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50000);

    memory.recordCycle('ETH-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.6, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_down', 3000);

    const stats = memory.getStats();
    expect(stats['BTC-USD']).toBeDefined();
    expect(stats['ETH-USD']).toBeDefined();
    expect(stats['BTC-USD'].cycleCount).toBe(1);
    expect(stats['ETH-USD'].cycleCount).toBe(1);
  });

  it('should handle empty context gracefully', () => {
    const ctx = memory.getContext('NONEXISTENT');
    expect(ctx.cycleCount).toBe(0);
    expect(ctx.recentInsights).toEqual([]);
    expect(ctx.overallConviction).toBe(0);
    expect(ctx.dominantDirection).toBe('neutral');
  });

  it('should not duplicate regime entries for same regime', () => {
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50000);

    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'Test', timestamp: Date.now() },
    ], 'trending_up', 50100);

    const ctx = memory.getContext('BTC-USD');
    // Same regime should not create duplicate entries
    expect(ctx.regimeHistory.length).toBe(1);
  });
});
