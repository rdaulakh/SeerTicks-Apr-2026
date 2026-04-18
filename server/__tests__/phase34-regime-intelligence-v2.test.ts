/**
 * Phase 34: Regime Intelligence v2 Tests
 *
 * Tests for:
 * 1. Regime-aware stop-loss adjustment (ATR multipliers per regime)
 * 2. Regime transition smoothing (grace period blending)
 * 3. Smoothed public API functions
 * 4. Navigation cleanup (removed pages, added regime dashboard)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. REGIME-AWARE STOP-LOSS ADJUSTMENT
// ============================================================
describe('Phase 34: Regime-Aware Stop-Loss Adjustment', () => {
  it('should have stopLossAtrMultiplier in all regime configs', async () => {
    const { getRegimeConfig } = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

    for (const regime of regimes) {
      const config = getRegimeConfig(regime);
      expect(config.stopLossAtrMultiplier).toBeDefined();
      expect(typeof config.stopLossAtrMultiplier).toBe('number');
      expect(config.stopLossAtrMultiplier).toBeGreaterThan(0);
      expect(config.stopLossAtrMultiplier).toBeLessThanOrEqual(5);
    }
  });

  it('should have takeProfitRrRatio in all regime configs', async () => {
    const { getRegimeConfig } = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

    for (const regime of regimes) {
      const config = getRegimeConfig(regime);
      expect(config.takeProfitRrRatio).toBeDefined();
      expect(typeof config.takeProfitRrRatio).toBe('number');
      expect(config.takeProfitRrRatio).toBeGreaterThan(0);
    }
  });

  it('should have wider stops in high_volatility than trending', async () => {
    const { getStopLossAtrMultiplier } = await import('../services/RegimeCalibration');
    const hvMultiplier = getStopLossAtrMultiplier('high_volatility');
    const trendingMultiplier = getStopLossAtrMultiplier('trending_up');
    expect(hvMultiplier).toBeGreaterThan(trendingMultiplier);
  });

  it('should have wider stops in breakout than range_bound (breakouts need room to develop)', async () => {
    const { getStopLossAtrMultiplier } = await import('../services/RegimeCalibration');
    const breakoutMultiplier = getStopLossAtrMultiplier('breakout');
    const rangeMultiplier = getStopLossAtrMultiplier('range_bound');
    // Breakouts need wider stops to avoid fakeout stop-hunts
    expect(breakoutMultiplier).toBeGreaterThan(rangeMultiplier);
  });

  it('should return correct multiplier via getter function', async () => {
    const { getStopLossAtrMultiplier, getRegimeConfig } = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

    for (const regime of regimes) {
      const fromGetter = getStopLossAtrMultiplier(regime);
      const fromConfig = getRegimeConfig(regime).stopLossAtrMultiplier;
      expect(fromGetter).toBe(fromConfig);
    }
  });

  it('should return correct R:R ratio via getter function', async () => {
    const { getTakeProfitRrRatio, getRegimeConfig } = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

    for (const regime of regimes) {
      const fromGetter = getTakeProfitRrRatio(regime);
      const fromConfig = getRegimeConfig(regime).takeProfitRrRatio;
      expect(fromGetter).toBe(fromConfig);
    }
  });

  it('should have higher R:R in trending than high_volatility', async () => {
    const { getTakeProfitRrRatio } = await import('../services/RegimeCalibration');
    const trendingRR = getTakeProfitRrRatio('trending_up');
    const hvRR = getTakeProfitRrRatio('high_volatility');
    expect(trendingRR).toBeGreaterThan(hvRR);
  });
});

// ============================================================
// 2. REGIME TRANSITION SMOOTHING
// ============================================================
describe('Phase 34: Regime Transition Smoothing', () => {
  it('should create a singleton smoother', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const s1 = getRegimeTransitionSmoother();
    const s2 = getRegimeTransitionSmoother();
    expect(s1).toBe(s2);
  });

  it('should return null blend factor when no transition active', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();
    const result = smoother.getBlendFactor('TEST-NOTRANSITION');
    expect(result).toBeNull();
  });

  it('should track transition state after onRegimeChange', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();
    smoother.onRegimeChange('TEST-SMOOTH-1', 'trending_up', 'high_volatility');

    const state = smoother.getTransitionState('TEST-SMOOTH-1');
    expect(state).not.toBeNull();
    expect(state!.fromRegime).toBe('trending_up');
    expect(state!.toRegime).toBe('high_volatility');
    expect(state!.gracePeriodMs).toBeGreaterThan(0);
  });

  it('should return blend factor between 0 and 1 during transition', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();
    smoother.onRegimeChange('TEST-SMOOTH-2', 'range_bound', 'breakout');

    const blend = smoother.getBlendFactor('TEST-SMOOTH-2');
    expect(blend).not.toBeNull();
    expect(blend!.factor).toBeGreaterThanOrEqual(0);
    expect(blend!.factor).toBeLessThanOrEqual(1);
    expect(blend!.from).toBe('range_bound');
    expect(blend!.to).toBe('breakout');
  });

  it('should blend numeric values between old and new regime', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();
    smoother.onRegimeChange('TEST-SMOOTH-3', 'trending_up', 'high_volatility');

    // The blended value should be between the two regime values
    const blended = smoother.blendNumeric('TEST-SMOOTH-3', 'high_volatility', (r) => {
      if (r === 'trending_up') return 2.0;
      if (r === 'high_volatility') return 3.5;
      return 2.5;
    });

    // At the start of transition (factor ≈ 0), should be close to old value (2.0)
    expect(blended).toBeGreaterThanOrEqual(2.0);
    expect(blended).toBeLessThanOrEqual(3.5);
  });

  it('should return pure new value when no transition active', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();

    const value = smoother.blendNumeric('TEST-NO-TRANSITION', 'trending_up', (r) => {
      if (r === 'trending_up') return 2.0;
      return 3.0;
    });

    expect(value).toBe(2.0);
  });

  it('should list all active transitions', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();
    smoother.onRegimeChange('TEST-MULTI-1', 'range_bound', 'trending_up');
    smoother.onRegimeChange('TEST-MULTI-2', 'trending_down', 'breakout');

    const all = smoother.getAllTransitions();
    const symbols = all.map(t => t.symbol);
    expect(symbols).toContain('TEST-MULTI-1');
    expect(symbols).toContain('TEST-MULTI-2');
  });

  it('should assign longer grace period for transitions into high_volatility', async () => {
    const { getRegimeTransitionSmoother } = await import('../services/RegimeCalibration');
    const smoother = getRegimeTransitionSmoother();

    smoother.onRegimeChange('TEST-GRACE-HV', 'trending_up', 'high_volatility');
    const hvState = smoother.getTransitionState('TEST-GRACE-HV');

    smoother.onRegimeChange('TEST-GRACE-RB', 'trending_up', 'range_bound');
    const rbState = smoother.getTransitionState('TEST-GRACE-RB');

    expect(hvState!.gracePeriodMs).toBeGreaterThan(rbState!.gracePeriodMs);
  });
});

// ============================================================
// 3. SMOOTHED PUBLIC API
// ============================================================
describe('Phase 34: Smoothed Public API', () => {
  it('getSmoothedStopLossAtrMultiplier returns valid number', async () => {
    const { getSmoothedStopLossAtrMultiplier } = await import('../services/RegimeCalibration');
    const val = getSmoothedStopLossAtrMultiplier('trending_up', 'BTC-USD');
    expect(typeof val).toBe('number');
    expect(val).toBeGreaterThan(0);
  });

  it('getSmoothedTakeProfitRrRatio returns valid number', async () => {
    const { getSmoothedTakeProfitRrRatio } = await import('../services/RegimeCalibration');
    const val = getSmoothedTakeProfitRrRatio('high_volatility', 'BTC-USD');
    expect(typeof val).toBe('number');
    expect(val).toBeGreaterThan(0);
  });

  it('getSmoothedTradeCooldownMs returns valid number', async () => {
    const { getSmoothedTradeCooldownMs } = await import('../services/RegimeCalibration');
    const val = getSmoothedTradeCooldownMs('range_bound', 'BTC-USD');
    expect(typeof val).toBe('number');
    expect(val).toBeGreaterThan(0);
    expect(Number.isInteger(val)).toBe(true); // Should be rounded
  });

  it('getSmoothedPositionSizeMultiplier returns clamped value', async () => {
    const { getSmoothedPositionSizeMultiplier } = await import('../services/RegimeCalibration');
    const val = getSmoothedPositionSizeMultiplier('high_volatility', 'BTC-USD');
    expect(val).toBeGreaterThanOrEqual(0.30);
    expect(val).toBeLessThanOrEqual(1.50);
  });

  it('getSmoothedConsensusThresholdMultiplier returns clamped value', async () => {
    const { getSmoothedConsensusThresholdMultiplier } = await import('../services/RegimeCalibration');
    const val = getSmoothedConsensusThresholdMultiplier('breakout', 'BTC-USD');
    expect(val).toBeGreaterThanOrEqual(0.60);
    expect(val).toBeLessThanOrEqual(1.60);
  });

  it('smoothed values match base values when no transition active', async () => {
    const {
      getSmoothedStopLossAtrMultiplier, getStopLossAtrMultiplier,
      getSmoothedTakeProfitRrRatio, getTakeProfitRrRatio,
    } = await import('../services/RegimeCalibration');

    // Use a symbol that has no active transition
    const symbol = 'NO-TRANSITION-SYMBOL';
    const regime = 'trending_up';

    const smoothedSL = getSmoothedStopLossAtrMultiplier(regime, symbol);
    const baseSL = getStopLossAtrMultiplier(regime);
    expect(smoothedSL).toBe(baseSL);

    const smoothedTP = getSmoothedTakeProfitRrRatio(regime, symbol);
    const baseTP = getTakeProfitRrRatio(regime);
    expect(smoothedTP).toBe(baseTP);
  });
});

// ============================================================
// 4. NAVIGATION CLEANUP
// ============================================================
describe('Phase 34: Navigation Cleanup', () => {
  it('should not import removed pages in App.tsx', async () => {
    const fs = await import('fs');
    const appContent = fs.readFileSync('/home/ubuntu/seer/client/src/App.tsx', 'utf-8');

    // Removed pages should not be imported
    expect(appContent).not.toContain('import AdvancedAI');
    expect(appContent).not.toContain('import APlusPlusOptimization');
    expect(appContent).not.toContain('import DataIngestion');
    expect(appContent).not.toContain('"/health"');

    // Regime Dashboard should be imported and routed
    expect(appContent).toContain('import RegimeDashboard');
    expect(appContent).toContain('/regime-dashboard');
  });

  it('should have regime dashboard in Navigation more items', async () => {
    const fs = await import('fs');
    const navContent = fs.readFileSync('/home/ubuntu/seer/client/src/components/Navigation.tsx', 'utf-8');

    // Removed items should not be in moreNavItems
    expect(navContent).not.toContain('"/advanced-ai"');
    expect(navContent).not.toContain('"/a-plus-plus"');
    expect(navContent).not.toContain('"/data-ingestion"');
    expect(navContent).not.toContain('"/health"');

    // Regime Dashboard should be present
    expect(navContent).toContain('/regime-dashboard');
    expect(navContent).toContain('Regime Intelligence');
  });

  it('should have 10 items in More menu (added System Health in Phase 42)', async () => {
    const fs = await import('fs');
    const navContent = fs.readFileSync('/home/ubuntu/seer/client/src/components/Navigation.tsx', 'utf-8');

    // Extract moreNavItems array
    const match = navContent.match(/const moreNavItems = \[([\s\S]*?)\];/);
    expect(match).not.toBeNull();

    // Count items by counting `{ path:` occurrences
    const items = (match![1].match(/\{ path:/g) || []).length;
    expect(items).toBe(10);
  });
});

// ============================================================
// 5. REGIME CONFIG COMPLETENESS
// ============================================================
describe('Phase 34: Regime Config Completeness', () => {
  it('all regime configs should have all required fields', async () => {
    const { getRegimeConfig } = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];

    for (const regime of regimes) {
      const config = getRegimeConfig(regime);
      // Phase 33 fields
      expect(config.tradeCooldownMs).toBeDefined();
      expect(config.skipAgents).toBeDefined();
      // Phase 34 fields
      expect(config.stopLossAtrMultiplier).toBeDefined();
      expect(config.takeProfitRrRatio).toBeDefined();
      // Core fields
      expect(config.consensusThresholdMultiplier).toBeDefined();
      expect(config.positionSizeMultiplier).toBeDefined();
      expect(config.agentWeights).toBeDefined();
    }
  });
});
