/**
 * Phase 25 — Stuck-position escape hatch.
 *
 * Phase 24 covers the case where agents flip on a stuck trade. But there is
 * a worse scenario: agents are STILL bullish (haven't flipped) yet the market
 * refuses to cooperate. The trade has been open for hours, has NEVER produced
 * a real unrealized gain (peak < 0.30%), and just bleeds slowly. The agents
 * are wrong AND they don't know it.
 *
 * Phase 25's trigger fires WITHOUT requiring an agent flip. Pure time +
 * no-progress + contained-loss heuristic:
 *
 *   - holdMinutes ≥ minHoldMinutes (default 120 = 2 hours)
 *   - peakUnrealizedPnlPercent < peakProfitNotReachedPct (default 0.30%)
 *   - netPnlPercent in (-1.0%, -0.20%] (real loss, not catastrophic)
 *
 * The peak-PnL filter is the safety: if the trade EVER crossed 0.30%, this
 * is a giveback (handled by trailing stops), not a stuck loser.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';
import {
  evaluateStuckPosition,
  shouldAllowClose,
  type ProfitLockPosition,
  type StuckPositionConfig,
} from '../services/ProfitLockGuard';

const baseCfg: StuckPositionConfig =
  PRODUCTION_CONFIG.profitLock.stuckPositionExit;

const stuckLong: ProfitLockPosition = {
  side: 'long',
  entryPrice: 100,
  exchange: 'binance',
  // No entry/current direction supplied — Phase 25 doesn't care.
  peakUnrealizedPnlPercent: 0.10,  // never reached profit zone
  holdMinutes: 150,                 // 2.5 hours
};

describe('Phase 25 — TradingConfig.profitLock.stuckPositionExit defaults', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('stuckPositionExit is enabled by default in production', () => {
    expect(getTradingConfig().profitLock.stuckPositionExit.enabled).toBe(true);
  });

  it('minHoldMinutes ≥ Phase-24 minHoldMinutes (longer threshold for non-flip case)', () => {
    // Phase 25 cuts WITHOUT agent flip — riskier than Phase 24 which has the
    // agent-flip safety. To compensate, Phase 25's hold threshold must be at
    // least as long as Phase 24's.
    const stuck = getTradingConfig().profitLock.stuckPositionExit;
    const thesis = getTradingConfig().profitLock.thesisInvalidationExit;
    expect(stuck.minHoldMinutes).toBeGreaterThanOrEqual(thesis.minHoldMinutes);
  });

  it('minHoldMinutes is at least 60 (give the market real time)', () => {
    expect(getTradingConfig().profitLock.stuckPositionExit.minHoldMinutes).toBeGreaterThanOrEqual(60);
  });

  it('peakProfitNotReachedPct matches Phase 24 (consistent semantics)', () => {
    const stuck = getTradingConfig().profitLock.stuckPositionExit;
    const thesis = getTradingConfig().profitLock.thesisInvalidationExit;
    expect(stuck.peakProfitNotReachedPct).toBe(thesis.peakProfitNotReachedPct);
  });

  it('loss window is contained: minLossToTriggerPct > maxLossToTriggerPct (both negative)', () => {
    const cfg = getTradingConfig().profitLock.stuckPositionExit;
    expect(cfg.minLossToTriggerPct).toBeLessThan(0);
    expect(cfg.maxLossToTriggerPct).toBeLessThan(cfg.minLossToTriggerPct);
  });

  it('loss window matches Phase 24 (handoff to catastrophic is consistent)', () => {
    const stuck = getTradingConfig().profitLock.stuckPositionExit;
    const thesis = getTradingConfig().profitLock.thesisInvalidationExit;
    expect(stuck.minLossToTriggerPct).toBe(thesis.minLossToTriggerPct);
    expect(stuck.maxLossToTriggerPct).toBe(thesis.maxLossToTriggerPct);
  });
});

describe('Phase 25 — evaluateStuckPosition pure helper', () => {
  it('returns stuck=true when ALL conditions are met', () => {
    const r = evaluateStuckPosition(stuckLong, -0.50, baseCfg);
    expect(r.stuck).toBe(true);
    expect(r.reason).toMatch(/hold=150m peak=0\.100% netPnl=-0\.500% \(no_progress\)/);
  });

  it('disabled config never triggers', () => {
    const r = evaluateStuckPosition(stuckLong, -0.50, { ...baseCfg, enabled: false });
    expect(r.stuck).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('undefined config never triggers', () => {
    const r = evaluateStuckPosition(stuckLong, -0.50, undefined);
    expect(r.stuck).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('hold too short → not stuck (default 120m threshold)', () => {
    const r = evaluateStuckPosition({ ...stuckLong, holdMinutes: 60 }, -0.50, baseCfg);
    expect(r.stuck).toBe(false);
    expect(r.reason).toMatch(/hold_too_short/);
  });

  it('peak PnL crossed 0.30% → not stuck (giveback case, NOT a stuck loser)', () => {
    const r = evaluateStuckPosition(
      { ...stuckLong, peakUnrealizedPnlPercent: 0.45 },
      -0.50,
      baseCfg,
    );
    expect(r.stuck).toBe(false);
    expect(r.reason).toMatch(/peak_reached/);
  });

  it('does NOT require agent flip — fires even when entry/current direction missing', () => {
    // The whole point of Phase 25 vs Phase 24: works without direction context.
    const noDirection: ProfitLockPosition = {
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
      peakUnrealizedPnlPercent: 0.05,
      holdMinutes: 150,
      // entryDirection / currentDirection / strength all undefined
    };
    const r = evaluateStuckPosition(noDirection, -0.50, baseCfg);
    expect(r.stuck).toBe(true);
  });

  it('loss too small (in noise band) → not stuck', () => {
    const r = evaluateStuckPosition(stuckLong, -0.05, baseCfg);
    expect(r.stuck).toBe(false);
    expect(r.reason).toMatch(/loss_too_small/);
  });

  it('loss is positive (winner) → not stuck', () => {
    const r = evaluateStuckPosition(stuckLong, +0.10, baseCfg);
    expect(r.stuck).toBe(false);
    expect(r.reason).toMatch(/loss_too_small/);
  });

  it('loss catastrophic → handed off to catastrophic stop', () => {
    const r = evaluateStuckPosition(stuckLong, -1.50, baseCfg);
    expect(r.stuck).toBe(false);
    expect(r.reason).toMatch(/loss_catastrophic/);
  });
});

describe('Phase 25 — shouldAllowClose integrates stuck-position as fifth allow path', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('allows close when position is stuck (Phase 25 fires, Phase 24 cannot)', () => {
    // Same position, but agents are STILL bullish (no flip). Phase 24 path
    // declines (not_flipped). Phase 25 path takes over because hold > 120m
    // and peak < 0.30%.
    const stillBullish: ProfitLockPosition = {
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bullish',  // NOT flipped
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.10,
      holdMinutes: 150,
    };
    const decision = shouldAllowClose(stillBullish, 99.50, 'MAX_LOSER_TIME');
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/stuck_position/);
  });

  it('Phase 24 fires before Phase 25 when both apply (preserves precedence)', () => {
    const flippedAndStuck: ProfitLockPosition = {
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bearish',  // flipped
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.10,
      holdMinutes: 150,
    };
    const decision = shouldAllowClose(flippedAndStuck, 99.50, 'DIRECTION_FLIP');
    expect(decision.allow).toBe(true);
    // Phase 24 (thesis_invalidated) takes precedence over Phase 25
    expect(decision.reason).toMatch(/thesis_invalidated/);
  });

  it('still blocks when neither thesis nor stuck applies (fresh trade with bad luck)', () => {
    const fresh: ProfitLockPosition = {
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bullish',
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.05,
      holdMinutes: 30,  // too fresh for Phase 25
    };
    const decision = shouldAllowClose(fresh, 99.50, 'DIRECTION_FLIP');
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/profit_lock_block/);
  });

  it('disabled stuck-position config falls through to next path', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: {
        ...PRODUCTION_CONFIG.profitLock,
        stuckPositionExit: {
          ...PRODUCTION_CONFIG.profitLock.stuckPositionExit,
          enabled: false,
        },
      },
    });
    const stillBullish: ProfitLockPosition = {
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bullish',
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.10,
      holdMinutes: 150,
    };
    const decision = shouldAllowClose(stillBullish, 99.50, 'MAX_LOSER_TIME');
    expect(decision.allow).toBe(false);
  });
});

describe('Phase 25 — canonical scenarios', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('BTC #4 with agents still bullish but stuck for 3 hours → ALLOW close', () => {
    // Same BTC scenario as Phase 24, but suppose agents had NOT flipped.
    // Phase 24 wouldn't fire. Phase 25 catches it.
    const btcStillBullish: ProfitLockPosition = {
      side: 'long',
      entryPrice: 77847.98,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bullish',  // hypothetical: agents haven't flipped
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.081,
      holdMinutes: 176,
    };
    const decision = shouldAllowClose(btcStillBullish, 77575.78, 'MAX_LOSER_TIME');
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/stuck_position/);
  });
});
