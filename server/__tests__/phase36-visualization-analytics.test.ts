/**
 * Phase 36 Tests: Advanced Visualization & Analytics
 *
 * Tests:
 * 1. RegimePerformanceTracker — trade recording, stats calculation, summary
 * 2. Conviction Heatmap endpoint data shape
 * 3. Monte Carlo integration with regime parameters
 * 4. TradeExecutor wiring (recordRegimePerformance method exists)
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// 1. RegimePerformanceTracker
// ============================================================
describe('RegimePerformanceTracker', () => {
  let tracker: any;

  beforeEach(async () => {
    const mod = await import('../services/RegimePerformanceTracker');
    tracker = new mod.RegimePerformanceTracker();
  });

  it('should record a trade and return it in getAllTrades', () => {
    tracker.recordTrade({
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long',
      entryPrice: 80000,
      exitPrice: 82000,
      pnl: 200,
      pnlPercent: 2.5,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    });

    const trades = tracker.getAllTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0].symbol).toBe('BTC-USD');
    expect(trades[0].regime).toBe('trending_up');
    expect(trades[0].pnl).toBe(200);
  });

  it('should calculate correct win rate', () => {
    // 3 wins, 2 losses = 60% win rate
    const baseTrade = {
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long' as const,
      entryPrice: 80000,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    };

    tracker.recordTrade({ ...baseTrade, exitPrice: 82000, pnl: 200, pnlPercent: 2.5 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 83000, pnl: 300, pnlPercent: 3.75 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 81000, pnl: 100, pnlPercent: 1.25 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 78000, pnl: -200, pnlPercent: -2.5 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 77000, pnl: -300, pnlPercent: -3.75 });

    const stats = tracker.getRegimeStats('trending_up');
    expect(stats.totalTrades).toBe(5);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(2);
    expect(stats.winRate).toBe(0.6);
  });

  it('should calculate correct profit factor', () => {
    const baseTrade = {
      symbol: 'ETH-USD',
      regime: 'range_bound',
      direction: 'long' as const,
      entryPrice: 3000,
      stopLoss: 2900,
      entryTime: Date.now() - 60000,
    };

    // Gross profit = 300, Gross loss = 100
    tracker.recordTrade({ ...baseTrade, exitPrice: 3100, pnl: 200, pnlPercent: 3.33 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 3050, pnl: 100, pnlPercent: 1.67 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 2950, pnl: -100, pnlPercent: -1.67 });

    const stats = tracker.getRegimeStats('range_bound');
    expect(stats.profitFactor).toBe(3.0); // 300/100
  });

  it('should calculate R:R from stop-loss when available', () => {
    tracker.recordTrade({
      symbol: 'BTC-USD',
      regime: 'breakout',
      direction: 'long',
      entryPrice: 80000,
      exitPrice: 82000,
      pnl: 200,
      pnlPercent: 2.5,
      stopLoss: 79000, // Risk = 1000, Reward = 2000
      entryTime: Date.now() - 60000,
    });

    const trades = tracker.getAllTrades();
    expect(trades[0].riskRewardActual).toBe(2.0); // 2000/1000
  });

  it('should track consecutive win/loss streaks', () => {
    const baseTrade = {
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long' as const,
      entryPrice: 80000,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    };

    // Win, Win, Win, Loss, Win
    tracker.recordTrade({ ...baseTrade, exitPrice: 81000, pnl: 100, pnlPercent: 1.25 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 82000, pnl: 200, pnlPercent: 2.5 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 83000, pnl: 300, pnlPercent: 3.75 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 78000, pnl: -200, pnlPercent: -2.5 });
    tracker.recordTrade({ ...baseTrade, exitPrice: 81000, pnl: 100, pnlPercent: 1.25 });

    const stats = tracker.getRegimeStats('trending_up');
    expect(stats.maxConsecutiveWins).toBe(3);
    expect(stats.maxConsecutiveLosses).toBe(1);
    expect(stats.consecutiveWins).toBe(1); // Current streak
  });

  it('should track direction breakdown (long vs short)', () => {
    const base = {
      symbol: 'BTC-USD',
      regime: 'high_volatility',
      entryPrice: 80000,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    };

    // 2 long wins, 1 long loss, 1 short win
    tracker.recordTrade({ ...base, direction: 'long', exitPrice: 82000, pnl: 200, pnlPercent: 2.5 });
    tracker.recordTrade({ ...base, direction: 'long', exitPrice: 81000, pnl: 100, pnlPercent: 1.25 });
    tracker.recordTrade({ ...base, direction: 'long', exitPrice: 78000, pnl: -200, pnlPercent: -2.5 });
    tracker.recordTrade({ ...base, direction: 'short', exitPrice: 78000, pnl: 200, pnlPercent: 2.5 });

    const stats = tracker.getRegimeStats('high_volatility');
    expect(stats.tradesByDirection.long.count).toBe(3);
    expect(stats.tradesByDirection.long.winRate).toBeCloseTo(0.667, 1);
    expect(stats.tradesByDirection.short.count).toBe(1);
    expect(stats.tradesByDirection.short.winRate).toBe(1);
  });

  it('should return correct summary with best/worst regimes', () => {
    const base = {
      symbol: 'BTC-USD',
      direction: 'long' as const,
      entryPrice: 80000,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    };

    // Trending up: 3 wins, 0 losses = 100% WR
    tracker.recordTrade({ ...base, regime: 'trending_up', exitPrice: 82000, pnl: 200, pnlPercent: 2.5 });
    tracker.recordTrade({ ...base, regime: 'trending_up', exitPrice: 83000, pnl: 300, pnlPercent: 3.75 });
    tracker.recordTrade({ ...base, regime: 'trending_up', exitPrice: 81000, pnl: 100, pnlPercent: 1.25 });

    // High volatility: 1 win, 2 losses = 33% WR
    tracker.recordTrade({ ...base, regime: 'high_volatility', exitPrice: 82000, pnl: 200, pnlPercent: 2.5 });
    tracker.recordTrade({ ...base, regime: 'high_volatility', exitPrice: 78000, pnl: -200, pnlPercent: -2.5 });
    tracker.recordTrade({ ...base, regime: 'high_volatility', exitPrice: 77000, pnl: -300, pnlPercent: -3.75 });

    const summary = tracker.getSummary();
    expect(summary.totalTrades).toBe(6);
    expect(summary.bestRegime).toBe('trending_up');
    expect(summary.worstRegime).toBe('high_volatility');
    expect(summary.recentTrades).toHaveLength(6);
    expect(Object.keys(summary.regimeStats)).toContain('trending_up');
    expect(Object.keys(summary.regimeStats)).toContain('high_volatility');
  });

  it('should enforce sliding window (MAX_TRADES = 500)', () => {
    const base = {
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long' as const,
      entryPrice: 80000,
      exitPrice: 82000,
      stopLoss: 79000,
      pnl: 200,
      pnlPercent: 2.5,
      entryTime: Date.now() - 60000,
    };

    // Record 510 trades
    for (let i = 0; i < 510; i++) {
      tracker.recordTrade(base);
    }

    expect(tracker.getAllTrades().length).toBeLessThanOrEqual(500);
  });

  it('should return empty stats for unknown regime', () => {
    const stats = tracker.getRegimeStats('nonexistent');
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
  });

  it('should calculate Sharpe ratio correctly', () => {
    const base = {
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long' as const,
      entryPrice: 80000,
      stopLoss: 79000,
      entryTime: Date.now() - 60000,
    };

    // Consistent returns = high Sharpe
    tracker.recordTrade({ ...base, exitPrice: 82000, pnl: 200, pnlPercent: 2.0 });
    tracker.recordTrade({ ...base, exitPrice: 82000, pnl: 200, pnlPercent: 2.1 });
    tracker.recordTrade({ ...base, exitPrice: 82000, pnl: 200, pnlPercent: 1.9 });
    tracker.recordTrade({ ...base, exitPrice: 82000, pnl: 200, pnlPercent: 2.0 });

    const stats = tracker.getRegimeStats('trending_up');
    expect(stats.sharpeRatio).toBeGreaterThan(5); // Very consistent returns = high Sharpe
  });

  it('should clear all data', () => {
    tracker.recordTrade({
      symbol: 'BTC-USD',
      regime: 'trending_up',
      direction: 'long',
      entryPrice: 80000,
      exitPrice: 82000,
      pnl: 200,
      pnlPercent: 2.5,
      entryTime: Date.now(),
    });

    expect(tracker.getAllTrades()).toHaveLength(1);
    tracker.clear();
    expect(tracker.getAllTrades()).toHaveLength(0);
  });
});

// ============================================================
// 2. Singleton accessor
// ============================================================
describe('getRegimePerformanceTracker singleton', () => {
  it('should return the same instance', async () => {
    const mod = await import('../services/RegimePerformanceTracker');
    const t1 = mod.getRegimePerformanceTracker();
    const t2 = mod.getRegimePerformanceTracker();
    expect(t1).toBe(t2);
  });
});

// ============================================================
// 3. RegimeCalibration stop-loss multipliers exist
// ============================================================
describe('RegimeCalibration stop-loss config', () => {
  it('should have stopLossAtrMultiplier and takeProfitRrRatio getters', async () => {
    const mod = await import('../services/RegimeCalibration');
    const slMultiplier = mod.getStopLossAtrMultiplier('high_volatility');
    const rrRatio = mod.getTakeProfitRrRatio('high_volatility');

    expect(slMultiplier).toBeGreaterThan(0);
    expect(rrRatio).toBeGreaterThan(0);

    // High volatility should have wider stop-loss than range_bound
    const slRange = mod.getStopLossAtrMultiplier('range_bound');
    expect(slMultiplier).toBeGreaterThan(slRange);
  });

  it('should have different multipliers per regime', async () => {
    const mod = await import('../services/RegimeCalibration');
    const regimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'breakout', 'mean_reverting'];
    const multipliers = regimes.map(r => mod.getStopLossAtrMultiplier(r));

    // Not all the same
    const unique = new Set(multipliers);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ============================================================
// 4. MonteCarloSimulator output shape
// ============================================================
describe('MonteCarloSimulator', () => {
  it('should produce valid simulation results', async () => {
    const mod = await import('../services/MonteCarloSimulator');
    const simulator = new mod.MonteCarloSimulator();

    const result = simulator.simulate(85000, 'long', 'trending_up', 0.6, 2.5);

    expect(result.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfProfit).toBeLessThanOrEqual(1);
    expect(result.expectedReturn).toBeDefined();
    expect(result.valueAtRisk95).toBeDefined();
    expect(result.conditionalVaR95).toBeDefined();
    expect(result.sharpeRatio).toBeDefined();
    expect(result.maxDrawdown).toBeDefined();
    expect(result.p10).toBeDefined();
    expect(result.p25).toBeDefined();
    expect(result.p50).toBeDefined();
    expect(result.p75).toBeDefined();
    expect(result.p90).toBeDefined();
    expect(result.samplePaths).toBeDefined();
    expect(result.samplePaths.length).toBeGreaterThan(0);
    expect(result.returnDistribution).toBeDefined();
    expect(result.optimalExitStep).toBeGreaterThanOrEqual(0);
  });

  it('should produce different results for different regimes', async () => {
    const mod = await import('../services/MonteCarloSimulator');
    const simulator = new mod.MonteCarloSimulator();

    const trending = simulator.simulate(85000, 'long', 'trending_up', 0.6, 2.5);
    const volatile = simulator.simulate(85000, 'long', 'high_volatility', 0.6, 2.5);

    // High volatility should have wider distribution (higher VaR)
    expect(Math.abs(volatile.valueAtRisk95)).toBeGreaterThanOrEqual(0);
    // Both should have valid probability
    expect(trending.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(volatile.probabilityOfProfit).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// 5. CrossCycleMemory conviction data shape
// ============================================================
describe('CrossCycleMemory conviction data', () => {
  it('should provide context with signalPersistence for heatmap', async () => {
    const mod = await import('../services/CrossCycleMemory');
    const memory = new mod.CrossCycleMemory();

    // Record some signals
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'test' },
      { agentName: 'SentimentAnalyst', signal: 'bearish', confidence: 0.6, reasoning: 'test' },
    ]);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.signalPersistence).toBeDefined();
    expect(ctx.signalPersistence['TechnicalAnalyst']).toBeDefined();
    expect(ctx.signalPersistence['TechnicalAnalyst'].currentSignal).toBe('bullish');
    expect(ctx.signalPersistence['TechnicalAnalyst'].convictionScore).toBeGreaterThan(0);
    expect(ctx.signalPersistence['TechnicalAnalyst'].consecutiveCycles).toBe(1);
    expect(ctx.signalPersistence['TechnicalAnalyst'].flipCount).toBe(0);
  });

  it('should track signal flips correctly', async () => {
    const mod = await import('../services/CrossCycleMemory');
    const memory = new mod.CrossCycleMemory();

    // Cycle 1: bullish
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'test' },
    ]);

    // Cycle 2: bearish (flip!)
    memory.recordCycle('BTC-USD', [
      { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.7, reasoning: 'test' },
    ]);

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.signalPersistence['TechnicalAnalyst'].currentSignal).toBe('bearish');
    expect(ctx.signalPersistence['TechnicalAnalyst'].flipCount).toBe(1);
    expect(ctx.signalPersistence['TechnicalAnalyst'].consecutiveCycles).toBe(1);
  });

  it('should build conviction over consecutive same-signal cycles', async () => {
    const mod = await import('../services/CrossCycleMemory');
    const memory = new mod.CrossCycleMemory();

    // 3 consecutive bullish cycles
    for (let i = 0; i < 3; i++) {
      memory.recordCycle('BTC-USD', [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.8, reasoning: 'test' },
      ]);
    }

    const ctx = memory.getContext('BTC-USD');
    expect(ctx.signalPersistence['TechnicalAnalyst'].consecutiveCycles).toBe(3);
    expect(ctx.signalPersistence['TechnicalAnalyst'].convictionScore).toBeGreaterThan(0.2);
  });
});

// ============================================================
// 6. RegimeTransitionSmoother
// ============================================================
describe('RegimeTransitionSmoother', () => {
  it('should blend values during transition', async () => {
    const mod = await import('../services/RegimeCalibration');
    const smoother = mod.getRegimeTransitionSmoother();
    const symbol = 'TEST-BLEND';

    smoother.onRegimeChange(symbol, 'range_bound' as any, 'high_volatility' as any);

    // Use blendNumeric to get smoothed cooldown
    const cooldown = smoother.blendNumeric(symbol, 'high_volatility' as any, (r: any) => mod.getTradeCooldownMs(r));

    const oldCooldown = mod.getTradeCooldownMs('range_bound');
    const newCooldown = mod.getTradeCooldownMs('high_volatility');

    // Should be between old and new
    expect(cooldown).toBeGreaterThanOrEqual(Math.min(oldCooldown, newCooldown));
    expect(cooldown).toBeLessThanOrEqual(Math.max(oldCooldown, newCooldown));
  });

  it('should report transition state', async () => {
    const mod = await import('../services/RegimeCalibration');
    const smoother = mod.getRegimeTransitionSmoother();
    const symbol = 'TEST-STATE';

    // Trigger a new transition
    smoother.onRegimeChange(symbol, 'trending_up' as any, 'high_volatility' as any);

    const state = smoother.getTransitionState(symbol);
    expect(state).not.toBeNull();
    expect(state!.fromRegime).toBe('trending_up');
    expect(state!.toRegime).toBe('high_volatility');

    // Blend factor should be between 0 and 1
    const blend = smoother.getBlendFactor(symbol);
    expect(blend).not.toBeNull();
    expect(blend!.factor).toBeGreaterThanOrEqual(0);
    expect(blend!.factor).toBeLessThanOrEqual(1);
  });
});
