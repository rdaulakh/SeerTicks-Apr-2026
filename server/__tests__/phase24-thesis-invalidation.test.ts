/**
 * Phase 24 — Thesis-invalidated exit escape hatch.
 *
 * Phase 22 unblocked SOL trades; production immediately surfaced the next
 * problem on 2026-04-25:
 *
 *   3 open positions held >3 hours, ALL slightly negative, blocking new
 *   signal slots for their symbols. Tick-level audit:
 *
 *     BTC #4  entry=$77,847.98   peak=+0.081%  trough=-0.399%  TP=+2.90%
 *     ETH #5  entry=$2,325.00    peak=-0.052%  trough=-0.564%  TP=+2.94%
 *     SOL #6  entry=$86.45       peak=+0.012%  trough=-0.093%  TP=+2.90%
 *
 *   ETH never went green. BTC peaked at +0.08% (nowhere near the +0.5%
 *   first profit target). The agents had since flipped to bearish on all
 *   three. But ProfitLockGuard's allow conditions are:
 *     1. Catastrophic exit reason
 *     2. Gross PnL ≤ catastrophicStopPercent (-1.2%)
 *     3. Net PnL ≥ minNetProfitPercentToClose (+0.15%)
 *   None applied → positions sat indefinitely, slot-locked, bleeding slowly.
 *
 * Phase 24 fix: add a fourth allow path — THESIS_INVALIDATED — gated on a
 * conjunction of conservative conditions that together describe "the
 * agents themselves now disagree with this trade and it never had a real
 * chance to work":
 *
 *   - holdMinutes ≥ minHoldMinutes (give it time)
 *   - peakUnrealizedPnlPercent < peakProfitNotReachedPct (never gained traction)
 *   - currentDirection opposite of entryDirection (agents flipped)
 *   - currentConsensusStrength ≥ requiredOpposingStrength (flip is convicted)
 *   - netPnlPercent in (maxLossToTriggerPct, minLossToTriggerPct] (real loss
 *     but not catastrophic — catastrophic still owns the lower band)
 *
 * The escape is conservative by design: noise direction-flips and small
 * unrealized losses on trades that briefly tagged profit do NOT trigger.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';
import {
  evaluateThesisInvalidation,
  shouldAllowClose,
  type ProfitLockPosition,
  type ThesisInvalidationConfig,
} from '../services/ProfitLockGuard';

const baseCfg: ThesisInvalidationConfig =
  PRODUCTION_CONFIG.profitLock.thesisInvalidationExit;

const validInvalidatedPosition: ProfitLockPosition = {
  side: 'long',
  entryPrice: 100,
  exchange: 'binance',
  entryDirection: 'bullish',
  currentDirection: 'bearish',
  currentConsensusStrength: 0.65,
  peakUnrealizedPnlPercent: 0.10,  // never reached profit zone
  holdMinutes: 60,                  // held an hour
};

describe('Phase 24 — TradingConfig.profitLock.thesisInvalidationExit defaults', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('thesisInvalidationExit is enabled by default in production', () => {
    expect(getTradingConfig().profitLock.thesisInvalidationExit.enabled).toBe(true);
  });

  it('minHoldMinutes is at least 30 (gives the trade real time)', () => {
    // Sub-30-min thesis-invalidation is too aggressive — short holds get
    // hit by minute-level consensus noise without enough data to confirm.
    expect(getTradingConfig().profitLock.thesisInvalidationExit.minHoldMinutes).toBeGreaterThanOrEqual(30);
  });

  it('peakProfitNotReachedPct is below the first profit target protection zone', () => {
    // The first profit target is 0.5% with a 0.2% protection zone (i.e.
    // trades within 0.3% of target1 are "near profit"). Phase 24 must NOT
    // fire on trades that came close to but didn't quite hit profit;
    // those are giveback scenarios, not invalidated theses.
    const cfg = getTradingConfig().profitLock.thesisInvalidationExit;
    expect(cfg.peakProfitNotReachedPct).toBeLessThanOrEqual(0.30);
  });

  it('loss window is contained: minLossToTriggerPct > maxLossToTriggerPct (both negative)', () => {
    const cfg = getTradingConfig().profitLock.thesisInvalidationExit;
    expect(cfg.minLossToTriggerPct).toBeLessThan(0);
    expect(cfg.maxLossToTriggerPct).toBeLessThan(cfg.minLossToTriggerPct);
  });

  it('maxLossToTriggerPct is at or above the catastrophic floor', () => {
    // Below the catastrophic floor, the existing catastrophic-stop allow
    // path owns the close. Phase 24 should hand off cleanly — its lower
    // bound MUST be ≥ catastrophic floor so there's no double-coverage gap.
    const cfg = getTradingConfig().profitLock;
    expect(cfg.thesisInvalidationExit.maxLossToTriggerPct).toBeGreaterThanOrEqual(
      cfg.catastrophicStopPercent,
    );
  });
});

describe('Phase 24 — evaluateThesisInvalidation pure helper', () => {
  it('returns invalidated=true when ALL conditions are met', () => {
    const r = evaluateThesisInvalidation(validInvalidatedPosition, -0.50, baseCfg);
    expect(r.invalidated).toBe(true);
    expect(r.reason).toMatch(/hold=60m peak=0\.100% flip=bullish→bearish/);
  });

  it('disabled config never invalidates', () => {
    const r = evaluateThesisInvalidation(validInvalidatedPosition, -0.50, { ...baseCfg, enabled: false });
    expect(r.invalidated).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('undefined config never invalidates', () => {
    const r = evaluateThesisInvalidation(validInvalidatedPosition, -0.50, undefined);
    expect(r.invalidated).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('hold too short → not invalidated', () => {
    const r = evaluateThesisInvalidation(
      { ...validInvalidatedPosition, holdMinutes: 10 },
      -0.50,
      baseCfg,
    );
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/hold_too_short/);
  });

  it('peak PnL crossed profit threshold (trade had its chance) → not invalidated', () => {
    // peak=+0.50% means the trade DID hit profit territory. Even if it gave
    // it back, this is a giveback scenario — handled by trailing stops, NOT
    // thesis invalidation.
    const r = evaluateThesisInvalidation(
      { ...validInvalidatedPosition, peakUnrealizedPnlPercent: 0.50 },
      -0.50,
      baseCfg,
    );
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/peak_reached/);
  });

  it('agents NOT flipped → not invalidated', () => {
    const r = evaluateThesisInvalidation(
      { ...validInvalidatedPosition, currentDirection: 'bullish' },
      -0.50,
      baseCfg,
    );
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/not_flipped/);
  });

  it('agents flipped to neutral (not opposite) → not invalidated', () => {
    const r = evaluateThesisInvalidation(
      { ...validInvalidatedPosition, currentDirection: 'neutral' },
      -0.50,
      baseCfg,
    );
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/not_flipped/);
  });

  it('flip strength below threshold → not invalidated', () => {
    const r = evaluateThesisInvalidation(
      { ...validInvalidatedPosition, currentConsensusStrength: 0.40 },
      -0.50,
      baseCfg,
    );
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/weak_flip/);
  });

  it('loss too small (in noise band) → not invalidated', () => {
    // PnL = -0.05%, threshold minLossToTriggerPct = -0.20%. Loss is too
    // shallow to be a real signal; might just be bid/ask noise.
    const r = evaluateThesisInvalidation(validInvalidatedPosition, -0.05, baseCfg);
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/loss_too_small/);
  });

  it('loss is positive (winning trade) → not invalidated', () => {
    const r = evaluateThesisInvalidation(validInvalidatedPosition, +0.10, baseCfg);
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/loss_too_small/);
  });

  it('loss is catastrophic (below maxLossToTriggerPct) → handed off to catastrophic stop', () => {
    const r = evaluateThesisInvalidation(validInvalidatedPosition, -1.50, baseCfg);
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/loss_catastrophic/);
  });

  it('short side flipped to bullish → invalidated symmetrically', () => {
    const shortPos: ProfitLockPosition = {
      ...validInvalidatedPosition,
      side: 'short',
      entryDirection: 'bearish',
      currentDirection: 'bullish',
    };
    const r = evaluateThesisInvalidation(shortPos, -0.50, baseCfg);
    expect(r.invalidated).toBe(true);
  });

  it('missing thesis context (back-compat) → not invalidated, returns clean reason', () => {
    const minimalPos: ProfitLockPosition = { side: 'long', entryPrice: 100 };
    const r = evaluateThesisInvalidation(minimalPos, -0.50, baseCfg);
    expect(r.invalidated).toBe(false);
    expect(r.reason).toMatch(/hold_too_short/);
  });
});

describe('Phase 24 — shouldAllowClose integrates thesis invalidation as fourth allow path', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('allows close when thesis is invalidated (all conditions met)', () => {
    // Long position at $100, current $99.50 → grossPnl = -0.5%
    // Binance drag = 0.25% → netPnl = -0.75%. This is in the loss window
    // (-1.0 < -0.75 ≤ -0.20), agents flipped, peak PnL never crossed 0.30%,
    // held >30 min → thesis invalidated.
    const decision = shouldAllowClose(
      validInvalidatedPosition,
      99.50,
      'DIRECTION_FLIP',
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/thesis_invalidated/);
  });

  it('still blocks when thesis check fails AND PnL is below profit floor', () => {
    // Same as above but agents have NOT flipped (still bullish for a long).
    // Net PnL is negative, no catastrophic, no thesis invalidation → blocked.
    const decision = shouldAllowClose(
      { ...validInvalidatedPosition, currentDirection: 'bullish' },
      99.50,
      'DIRECTION_FLIP',
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/profit_lock_block/);
  });

  it('catastrophic stop still bypasses (gross ≤ catastrophicStopPercent)', () => {
    // grossPnl at -1.2% → catastrophic owns it; thesis path doesn't matter.
    // 'HARD_STOP_LOSS' matches the `hard_stop_` pattern (path 2: catastrophic
    // reason), which fires before path 3 (catastrophic_grossPnl). Either
    // catastrophic path is acceptable — the assertion just confirms the
    // close is allowed via a catastrophic mechanism, not via thesis or net.
    const decision = shouldAllowClose(
      validInvalidatedPosition,
      98.80, // -1.2% gross
      'HARD_STOP_LOSS',
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/catastrophic/);
  });

  it('net-positive close still allowed (path 3 — the original happy case)', () => {
    // Net positive after drag → original allow path 3 fires before thesis check.
    const decision = shouldAllowClose(
      validInvalidatedPosition,
      100.50, // +0.5% gross, -0.25% drag = +0.25% net
      'profit_target',
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/net_profit_ok/);
  });

  it('thesis-invalidation disabled in config → falls through to block', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: {
        ...PRODUCTION_CONFIG.profitLock,
        thesisInvalidationExit: {
          ...PRODUCTION_CONFIG.profitLock.thesisInvalidationExit,
          enabled: false,
        },
      },
    });
    const decision = shouldAllowClose(
      validInvalidatedPosition,
      99.50,
      'DIRECTION_FLIP',
    );
    expect(decision.allow).toBe(false);
  });
});

describe('Phase 24 — canonical scenarios from the 2026-04-25 incident', () => {
  beforeEach(() => {
    // Reset config — prior describe's "disabled" test mutates the singleton.
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('BTC #4 (entry $77,847, peak +0.08%, agents flipped) → ALLOW close', () => {
    // BTC opened at 9:54Z, by 12:50Z held 176 min, peak was +0.081%, agents
    // flipped to bearish during the hold. Current price $77,575 → gross
    // -0.35% → net -0.55% (Binance) — comfortably in the loss window.
    const btc: ProfitLockPosition = {
      side: 'long',
      entryPrice: 77847.98,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bearish',
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.081,
      holdMinutes: 176,
    };
    const decision = shouldAllowClose(btc, 77575.78, 'DIRECTION_FLIP');
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/thesis_invalidated/);
  });

  it('ETH #5 (entry $2,325, peak -0.05% — NEVER went green) → ALLOW close', () => {
    const eth: ProfitLockPosition = {
      side: 'long',
      entryPrice: 2325.00,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bearish',
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: -0.052,
      holdMinutes: 175,
    };
    const decision = shouldAllowClose(eth, 2314.17, 'DIRECTION_FLIP');
    expect(decision.allow).toBe(true);
    expect(decision.reason).toMatch(/thesis_invalidated/);
  });

  it('SOL #6 (entry $86.45, just opened — too fresh) → still BLOCKED', () => {
    // Fresh trade: held 1 min, well below the 30-min minimum. Phase 24
    // does NOT fire on fresh trades. Profit-lock blocks the close as before.
    const sol: ProfitLockPosition = {
      side: 'long',
      entryPrice: 86.45,
      exchange: 'binance',
      entryDirection: 'bullish',
      currentDirection: 'bearish',
      currentConsensusStrength: 0.65,
      peakUnrealizedPnlPercent: 0.012,
      holdMinutes: 1,
    };
    const decision = shouldAllowClose(sol, 86.42, 'DIRECTION_FLIP');
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/profit_lock_block/);
  });
});
