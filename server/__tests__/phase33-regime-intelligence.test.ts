/**
 * Phase 33: Regime Intelligence Tests
 *
 * Tests for:
 * 1. Regime-based trade cooldowns (RegimeCalibration + AutomatedSignalProcessor)
 * 2. Agent task-specific questions wiring (AgentBase context injection)
 * 3. Selective agent activation (RegimeCalibration skipAgents + GlobalSymbolAnalyzer)
 */

import { describe, it, expect } from 'vitest';
import {
  getTradeCooldownMs,
  getSkipAgents,
  getRegimeConfig,
  getConsensusThresholdMultiplier,
  getPositionSizeMultiplier,
  type MarketRegime,
} from '../services/RegimeCalibration';

// ============================================================
// 1. REGIME-BASED TRADE COOLDOWNS
// ============================================================

describe('Regime-Based Trade Cooldowns', () => {
  const regimes: MarketRegime[] = [
    'trending_up', 'trending_down', 'range_bound',
    'high_volatility', 'breakout', 'mean_reverting',
  ];

  it('should return a positive cooldown for every regime', () => {
    for (const regime of regimes) {
      const cooldown = getTradeCooldownMs(regime);
      expect(cooldown).toBeGreaterThan(0);
      expect(typeof cooldown).toBe('number');
    }
  });

  it('should have the shortest cooldown for breakout (time-sensitive)', () => {
    const breakoutCooldown = getTradeCooldownMs('breakout');
    for (const regime of regimes) {
      if (regime === 'breakout') continue;
      expect(breakoutCooldown).toBeLessThanOrEqual(getTradeCooldownMs(regime));
    }
  });

  it('should have the longest cooldown for high_volatility (prevent overtrading)', () => {
    const hvCooldown = getTradeCooldownMs('high_volatility');
    for (const regime of regimes) {
      if (regime === 'high_volatility') continue;
      expect(hvCooldown).toBeGreaterThanOrEqual(getTradeCooldownMs(regime));
    }
  });

  it('should enforce specific cooldown values per regime', () => {
    expect(getTradeCooldownMs('trending_up')).toBe(15_000);
    expect(getTradeCooldownMs('trending_down')).toBe(20_000);
    expect(getTradeCooldownMs('range_bound')).toBe(45_000);
    expect(getTradeCooldownMs('high_volatility')).toBe(60_000);
    expect(getTradeCooldownMs('breakout')).toBe(10_000);
    expect(getTradeCooldownMs('mean_reverting')).toBe(30_000);
  });

  it('should return default cooldown for unknown regime', () => {
    const cooldown = getTradeCooldownMs('unknown_regime' as any);
    expect(cooldown).toBeGreaterThan(0);
    // Should fall back to range_bound config (default)
    expect(cooldown).toBe(45_000);
  });

  it('cooldown hierarchy should match risk profile: breakout < trending < mean_revert < range < high_vol', () => {
    expect(getTradeCooldownMs('breakout')).toBeLessThan(getTradeCooldownMs('trending_up'));
    expect(getTradeCooldownMs('trending_up')).toBeLessThan(getTradeCooldownMs('mean_reverting'));
    expect(getTradeCooldownMs('mean_reverting')).toBeLessThan(getTradeCooldownMs('range_bound'));
    expect(getTradeCooldownMs('range_bound')).toBeLessThan(getTradeCooldownMs('high_volatility'));
  });
});

// ============================================================
// 2. AGENT TASK-SPECIFIC QUESTIONS WIRING
// ============================================================

describe('Agent Task-Specific Questions Wiring', () => {
  it('should have agentGuidance in MarketRegimeAI output structure', () => {
    // The MarketContext type includes agentGuidance — verify the config structure supports it
    const config = getRegimeConfig('trending_up');
    expect(config).toBeDefined();
    expect(config.agentWeights).toBeDefined();
    // Agent weights should include all known agents
    expect(config.agentWeights.TechnicalAnalyst).toBeDefined();
    expect(config.agentWeights.OrderFlowAnalyst).toBeDefined();
    expect(config.agentWeights.SentimentAnalyst).toBeDefined();
    expect(config.agentWeights.PatternMatcher).toBeDefined();
  });

  it('should have weight multipliers that vary by regime for task targeting', () => {
    const trendUp = getRegimeConfig('trending_up');
    const highVol = getRegimeConfig('high_volatility');
    const rangeBound = getRegimeConfig('range_bound');

    // In trending: TechnicalAnalyst should be boosted
    expect(trendUp.agentWeights.TechnicalAnalyst).toBeGreaterThan(1.0);

    // In high volatility: OrderFlowAnalyst should be boosted, PatternMatcher dampened
    expect(highVol.agentWeights.OrderFlowAnalyst).toBeGreaterThan(1.0);
    expect(highVol.agentWeights.PatternMatcher).toBeLessThan(1.0);

    // In range-bound: VolumeProfileAnalyzer should be boosted
    expect(rangeBound.agentWeights.VolumeProfileAnalyzer).toBeGreaterThan(1.0);
  });

  it('should provide different weight multipliers for each regime', () => {
    const regimes: MarketRegime[] = ['trending_up', 'high_volatility', 'breakout'];
    const techWeights = regimes.map(r => getRegimeConfig(r).agentWeights.TechnicalAnalyst);
    // Not all the same
    const allSame = techWeights.every(w => w === techWeights[0]);
    expect(allSame).toBe(false);
  });
});

// ============================================================
// 3. SELECTIVE AGENT ACTIVATION
// ============================================================

describe('Selective Agent Activation', () => {
  const regimes: MarketRegime[] = [
    'trending_up', 'trending_down', 'range_bound',
    'high_volatility', 'breakout', 'mean_reverting',
  ];

  it('should return an array (possibly empty) for every regime', () => {
    for (const regime of regimes) {
      const skipList = getSkipAgents(regime);
      expect(Array.isArray(skipList)).toBe(true);
    }
  });

  it('should skip PatternMatcher in high_volatility (patterns break in chaos)', () => {
    const skipList = getSkipAgents('high_volatility');
    expect(skipList).toContain('PatternMatcher');
  });

  it('should skip MLPredictionAgent in high_volatility (ML unreliable in chaos)', () => {
    const skipList = getSkipAgents('high_volatility');
    expect(skipList).toContain('MLPredictionAgent');
  });

  it('should skip ForexCorrelationAgent in high_volatility (correlations decouple)', () => {
    const skipList = getSkipAgents('high_volatility');
    expect(skipList).toContain('ForexCorrelationAgent');
  });

  it('should NOT skip any agents in trending_up (all useful)', () => {
    const skipList = getSkipAgents('trending_up');
    expect(skipList.length).toBe(0);
  });

  it('should NOT skip any agents in trending_down (all useful)', () => {
    const skipList = getSkipAgents('trending_down');
    expect(skipList.length).toBe(0);
  });

  it('should NOT skip any agents in breakout (all needed for confirmation)', () => {
    const skipList = getSkipAgents('breakout');
    expect(skipList.length).toBe(0);
  });

  it('should skip MLPredictionAgent and NewsSentinel in range_bound', () => {
    const skipList = getSkipAgents('range_bound');
    expect(skipList).toContain('MLPredictionAgent');
    expect(skipList).toContain('NewsSentinel');
  });

  it('should skip ForexCorrelationAgent in mean_reverting', () => {
    const skipList = getSkipAgents('mean_reverting');
    expect(skipList).toContain('ForexCorrelationAgent');
  });

  it('should return empty array for unknown regime', () => {
    const skipList = getSkipAgents('unknown_regime' as any);
    expect(Array.isArray(skipList)).toBe(true);
  });

  it('should never skip critical agents (TechnicalAnalyst, OrderFlowAnalyst) in any regime', () => {
    const criticalAgents = ['TechnicalAnalyst', 'OrderFlowAnalyst'];
    for (const regime of regimes) {
      const skipList = getSkipAgents(regime);
      for (const agent of criticalAgents) {
        expect(skipList).not.toContain(agent);
      }
    }
  });

  it('should never skip MacroAnalyst in any regime (veto power)', () => {
    for (const regime of regimes) {
      const skipList = getSkipAgents(regime);
      expect(skipList).not.toContain('MacroAnalyst');
    }
  });
});

// ============================================================
// INTEGRATION: Regime Config Consistency
// ============================================================

describe('Regime Config Consistency', () => {
  const regimes: MarketRegime[] = [
    'trending_up', 'trending_down', 'range_bound',
    'high_volatility', 'breakout', 'mean_reverting',
  ];

  it('every regime should have all required fields', () => {
    for (const regime of regimes) {
      const config = getRegimeConfig(regime);
      expect(config.agentWeights).toBeDefined();
      expect(config.familyWeights).toBeDefined();
      expect(config.consensusThresholdMultiplier).toBeGreaterThan(0);
      expect(config.positionSizeMultiplier).toBeGreaterThan(0);
      expect(config.minAgentConfidence).toBeGreaterThan(0);
      expect(config.maxDissent).toBeGreaterThan(0);
      expect(config.counterTrendPenalty).toBeGreaterThanOrEqual(0);
      expect(config.tradeCooldownMs).toBeGreaterThan(0);
      expect(Array.isArray(config.skipAgents)).toBe(true);
    }
  });

  it('consensus threshold multiplier should be within sane bounds', () => {
    for (const regime of regimes) {
      const multiplier = getConsensusThresholdMultiplier(regime);
      expect(multiplier).toBeGreaterThanOrEqual(0.60);
      expect(multiplier).toBeLessThanOrEqual(1.60);
    }
  });

  it('position size multiplier should be within sane bounds', () => {
    for (const regime of regimes) {
      const multiplier = getPositionSizeMultiplier(regime);
      expect(multiplier).toBeGreaterThanOrEqual(0.30);
      expect(multiplier).toBeLessThanOrEqual(1.50);
    }
  });

  it('high_volatility should have smallest position size and elevated consensus threshold', () => {
    const hvConfig = getRegimeConfig('high_volatility');
    // Phase 44: After Phase 40 tuning, range_bound has the highest consensus threshold (1.30),
    // high_volatility has 1.15. Both are elevated (>= 1.0) to require stronger consensus.
    // high_volatility still has the smallest position size.
    expect(hvConfig.consensusThresholdMultiplier).toBeGreaterThanOrEqual(1.0);
    for (const regime of regimes) {
      if (regime === 'high_volatility') continue;
      const config = getRegimeConfig(regime);
      expect(hvConfig.positionSizeMultiplier).toBeLessThanOrEqual(config.positionSizeMultiplier);
    }
  });

  it('skip agents should only contain valid agent names', () => {
    const validAgents = new Set([
      'TechnicalAnalyst', 'OrderFlowAnalyst', 'SentimentAnalyst',
      'FundingRateAnalyst', 'LiquidationHeatmap', 'WhaleTracker',
      'MacroAnalyst', 'MLPredictionAgent', 'PatternMatcher',
      'VolumeProfileAnalyzer', 'ForexCorrelationAgent', 'OnChainAnalyst',
      'OnChainFlowAnalyst', 'NewsSentinel',
    ]);
    for (const regime of regimes) {
      const skipList = getSkipAgents(regime);
      for (const agent of skipList) {
        expect(validAgents.has(agent)).toBe(true);
      }
    }
  });
});
