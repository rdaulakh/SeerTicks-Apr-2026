/**
 * Phase 8 — Reason-string harmonization + dynamic emergency floor
 *
 * Two coupled changes:
 *
 *   1. ProfitLockGuard.CATASTROPHIC_REASON_PATTERNS now matches the strings
 *      the engine actually emits. Pre-Phase-8 patterns were all underscore-
 *      prefixed identifiers (`emergency_`, `hard_stop_`, ...) but the exit
 *      managers emitted human-readable ("Emergency exit: Position down -1.45%")
 *      or SCREAM_CASE ("DEAD_MANS_SWITCH: ...") strings — so
 *      `isCatastrophicReason` structurally always returned false and the
 *      bypass branch was dead code. Emergencies were only allowed through
 *      the gross-PnL floor, meaning a dead-man's-switch or daily-loss
 *      circuit breaker at gross +0.3% (say, price feed died mid-winner)
 *      would get BLOCKED by the guard. Phase 8 closes that gap.
 *
 *   2. IntelligentExitManager's "absolute safety net" emergency exit at
 *      pnlPercent <= -2.5% is replaced with
 *      `getTradingConfig().profitLock.catastrophicStopPercent`. Post-Phase-7
 *      that value is -1.2% — the same as the hard SL. Aligning the safety
 *      net to the configured floor closes the 1.3% bleed window that existed
 *      when `position.stopLoss` was missing/corrupted.
 *
 * Together: (1) lets kill-switches exit regardless of gross PnL; (2) caps
 * the fallback-path loss at the configured hard-stop level.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAllowClose,
  isCatastrophicReason,
} from '../services/ProfitLockGuard';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 8 — ProfitLockGuard reason patterns match real emitted strings', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  describe('isCatastrophicReason — live-emitted strings', () => {
    // Actual strings from:
    //   IntelligentExitManager line ~660, ~1232: `Emergency exit: Position down ...`
    //   PositionGuardian line 183:  `DEAD_MANS_SWITCH: No price data`
    //   PositionGuardian line 351:  `DAILY_LOSS_LIMIT: $X.XX > $Y.YY`
    const liveStrings: ReadonlyArray<[string, string]> = [
      ['Emergency exit: Position down -1.45% (limit: -1.20%)', 'IEM emergency floor'],
      ['Emergency exit: Position down -3.00% (limit: -2.50%)', 'IEM legacy safety net'],
      ['DEAD_MANS_SWITCH: No price data for 15s', 'PositionGuardian dead-man switch'],
      ['DAILY_LOSS_LIMIT: $520.00 > $500.00', 'PositionGuardian daily-loss'],
    ];

    it.each(liveStrings)(
      'recognizes %p as catastrophic (%s)',
      (reason) => {
        expect(isCatastrophicReason(reason)).toBe(true);
      },
    );
  });

  describe('isCatastrophicReason — deliberately NON-catastrophic strings', () => {
    // These exit reasons must route through net-profit-ok or grossPnl paths.
    // Adding them to catastrophic patterns would let losers close below net
    // floor and break the Phase 7 breakeven-stop net_profit_ok contract.
    const nonCatastrophic: ReadonlyArray<string> = [
      // Breakeven SL hit at gross +0.5% — a PROFITABLE close, must be net_profit_ok.
      'Stop-Loss hit: Price $100.50 breached SL $100.50 (+0.50%)',
      // Hard SL hit at gross -1.2% — routed via catastrophic_grossPnl, not pattern.
      'Stop-Loss hit: Price $98.80 breached SL $98.80 (-1.20%)',
      // Discretionary exits — must block when net-negative.
      'time_exit',
      'consensus_flip',
      'Take-Profit hit: Price $101.50 reached TP $101.50 (+1.50%)',
      // Breakeven fallback exit — relies on guard's net-profit branch.
      'Breakeven exit: Price returned to entry after reaching +1.20%',
      // Partial profit (intentionally allowed via net_profit_ok at +X%).
      'Partial profit at +1.50% (target: 1.0%)',
    ];

    it.each(nonCatastrophic)(
      'does NOT match %p as catastrophic',
      (reason) => {
        expect(isCatastrophicReason(reason)).toBe(false);
      },
    );
  });

  it('dead-man-switch at gross +0.3% (price feed silent) NOW exits (pre-Phase-8: BLOCKED)', () => {
    // Pre-Phase-8: `isCatastrophicReason('DEAD_MANS_SWITCH...')` was false,
    // gross +0.3% − 0.25% drag = net +0.05% < 0.15% floor → BLOCKED.
    // A silent price feed during a tiny winner meant the position stayed
    // open with no price updates — exactly the blow-up risk the dead-man
    // switch exists to prevent.
    //
    // Post-Phase-8: matches `dead_mans_switch` pattern → allow via
    // catastrophic_reason path regardless of gross PnL.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.3,
      'DEAD_MANS_SWITCH: No price data for 15s',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_reason/);
    expect(res.reason).toMatch(/DEAD_MANS_SWITCH/);
  });

  it('daily-loss-limit at gross −0.5% (above floor) NOW exits (pre-Phase-8: BLOCKED)', () => {
    // Pre-Phase-8: reason pattern didn't match, gross -0.5% > -1.2% floor,
    // net -0.75% < 0.15% floor → BLOCKED. The circuit breaker couldn't
    // actually close the losers it was supposed to halt.
    //
    // Post-Phase-8: matches `daily_loss_limit` → catastrophic_reason.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      99.5,
      'DAILY_LOSS_LIMIT: $520.00 > $500.00',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_reason/);
  });

  it('IEM "Emergency exit" string at gross −1.3% exits via catastrophic_reason (was: grossPnl branch only)', () => {
    // This is the string IntelligentExitManager.evaluateExitConditionsRaw
    // now emits at the configured emergency floor. Pre-Phase-8 the guard
    // didn't recognize it as catastrophic, so the exit only squeaked through
    // the grossPnl branch. Post-Phase-8 it matches `emergency exit` and
    // takes the catastrophic_reason branch directly — cleaner, and works
    // even if catastrophicStopPercent were ever unset.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      98.7,
      'Emergency exit: Position down -1.30% (limit: -1.20%)',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_reason/);
    expect(res.reason).toMatch(/Emergency exit/);
  });

  it('breakeven-stop "Stop-Loss hit" at +0.5% still routes through net_profit_ok (Phase 7 regression guard)', () => {
    // Phase 8 expanded catastrophic patterns but DELIBERATELY did not add
    // 'stop-loss hit'. This test guards against a future drive-by addition
    // that would silently break Phase 7's breakeven-stop contract.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.5,
      'Stop-Loss hit: Price $100.50 breached SL $100.50 (+0.50%)',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/net_profit_ok/);
    expect(res.reason).not.toMatch(/catastrophic_reason/);
  });

  it('hard-SL "Stop-Loss hit" at gross −1.2% still routes through catastrophic_grossPnl (Phase 7 regression guard)', () => {
    // Same regression guard for the other side of Stop-Loss hit: at the
    // hard-stop level, `stop-loss hit` does NOT match a pattern (good),
    // and the grossPnl branch catches it because catastrophicStopPercent
    // is aligned to -1.2% (Phase 7).
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      98.8,
      'Stop-Loss hit: Price $98.80 breached SL $98.80 (-1.20%)',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_grossPnl/);
  });

  it('discretionary "time_exit" at gross −1.0% is STILL BLOCKED (Phase 7 invariant)', () => {
    // Phase 8 must not accidentally widen the guard — non-catastrophic
    // reasons at losses above the hard-stop floor must still be held.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      99,
      'time_exit',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(-1, 4);
  });
});

describe('Phase 8 — dynamic emergency floor (config-driven, not hardcoded -2.5%)', () => {
  // These tests exercise the guard's observable behavior directly rather
  // than spinning up an IEM + mocks. The important invariant for the
  // end-to-end behavior (IEM emits "Emergency exit: ..." → guard allows)
  // is covered by the pattern test above.

  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('config invariant — catastrophicStopPercent drives both the guard floor and the IEM emergency floor', () => {
    // Post-Phase-8 this is the single knob that controls the "how deep can
    // a loser bleed" floor. Both the guard's gross-PnL branch AND the
    // IntelligentExitManager emergency-exit safety net read this value.
    const cfg = getTradingConfig();
    expect(cfg.profitLock.catastrophicStopPercent).toBe(-1.2);
    // Aligned with the hard SL (Phase 7 invariant we keep intact).
    expect(cfg.profitLock.catastrophicStopPercent).toBe(
      cfg.exits.hardStopLossPercent,
    );
  });

  it('tightening catastrophicStopPercent tightens the guard bypass (no hardcoded -2.5 anywhere)', () => {
    // Flip config to a tighter floor and confirm the guard follows.
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: { ...PRODUCTION_CONFIG.profitLock, catastrophicStopPercent: -0.8 },
    });

    // At gross -0.9% with a non-catastrophic reason: below the new -0.8%
    // floor → guard allows via grossPnl.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      99.1,
      'time_exit',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_grossPnl/);
    expect(res.reason).toMatch(/-0\.8%/); // floor echoed in reason string
  });

  it('loosening catastrophicStopPercent loosens the guard (proves no hardcoded -2.5 fallback)', () => {
    // Flip to a looser floor; a -2.0% loss (which would have hit the old
    // hardcoded -2.5% safety net) should still be BLOCKED by the guard
    // because it's above the new -3.0% floor and below the net-profit floor.
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: { ...PRODUCTION_CONFIG.profitLock, catastrophicStopPercent: -3.0 },
    });

    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      98,
      'time_exit',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(-2, 4);
  });
});
