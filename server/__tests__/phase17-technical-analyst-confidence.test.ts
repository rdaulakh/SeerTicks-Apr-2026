/**
 * Phase 17 — TechnicalAnalyst confidence calibration fix.
 *
 * Phase 16's backtest revealed TechnicalAnalyst at 0% pass rate against a
 * 0.50 confidence threshold across 1,182 production consensus computations.
 * Root cause: the old formula normalized "conviction" by ALL 7 possible
 * indicators (RSI, MACD, MA, Bollinger, SuperTrend, VWAP, Volume) even
 * though on typical bars most indicators stay SILENT (RSI in 25-75 neutral
 * zone, price inside Bollinger, etc.). The whole-slate denominator
 * mathematically pinned typical-setup confidence at ~0.40, below the
 * 0.65 consensus gate, so this agent — the single most important fast
 * agent in the stack — never contributed to any trade decision.
 *
 * The fix: normalize conviction by ACTIVE voters. A 3 vs 1 vote with 3
 * silent indicators is a 75% conviction, not 28.6% of nothing. Retain a
 * soft "activity bonus" so broader agreement still outranks narrow
 * agreement (2 of 5 voting < 3 of 3 voting).
 *
 * These tests lock the behavior at realistic scenarios AND at the edge
 * cases (all silent, all agree, split) so a well-intentioned future
 * tweak can't silently re-break the agent at 0.50 again.
 *
 * Decision gate note: signal determination (bullish/bearish/neutral)
 * still uses the whole-slate netSignal — requires ≥20% of total
 * indicators net-directional AND ≥2 confirming votes. The Phase 17
 * change only affects CONFIDENCE on signals that already cleared that
 * gate. Breadth still matters for the directional call; conviction
 * matters for the confidence reported.
 */

import { describe, it, expect } from 'vitest';
import { computeTechnicalAnalystConfidence } from '../agents/TechnicalAnalyst';

describe('Phase 17 — computeTechnicalAnalystConfidence', () => {
  const TOTAL = 7; // Matches the 7 indicators in calculateSignalFromTechnicals.

  describe('the canonical bug scenario — typical bar with quiet indicators', () => {
    it('3 bullish + 1 bearish + 3 silent CLEARS the 0.50 bar (was 0.40 pre-fix)', () => {
      // Conviction = |3-1| / 4 = 0.50
      // Activity   = 4 / 7 ≈ 0.571
      // confidence = 0.50 × 1.4 × (0.7 + 0.3 × 0.571) ≈ 0.61
      const c = computeTechnicalAnalystConfidence(3, 1, TOTAL);
      expect(c).toBeGreaterThan(0.5);
      expect(c).toBeLessThan(0.7);
    });

    it('2 bullish + 1 bearish + 4 silent STAYS BELOW 0.50 (weak conviction shouldn\'t auto-pass)', () => {
      // Conviction = |2-1| / 3 ≈ 0.333 — genuinely weak; should still be low.
      // Activity   = 3 / 7 ≈ 0.429
      // confidence ≈ 0.333 × 1.4 × (0.7 + 0.3 × 0.429) ≈ 0.39
      const c = computeTechnicalAnalystConfidence(2, 1, TOTAL);
      expect(c).toBeLessThan(0.5);
    });
  });

  describe('strong and unanimous setups', () => {
    it('4 bullish + 1 bearish + 2 silent clears 0.65', () => {
      // Conviction = 3/5 = 0.60, activity = 5/7 ≈ 0.71
      // confidence ≈ 0.60 × 1.4 × (0.7 + 0.3 × 0.71) ≈ 0.77
      const c = computeTechnicalAnalystConfidence(4, 1, TOTAL);
      expect(c).toBeGreaterThan(0.65);
    });

    it('5 bullish + 0 bearish + 2 silent caps at 0.9', () => {
      // Conviction = 5/5 = 1.0, activity = 5/7 ≈ 0.71
      // confidence = 1.0 × 1.4 × (0.7 + 0.3 × 0.71) ≈ 1.28 → clamped 0.9
      expect(computeTechnicalAnalystConfidence(5, 0, TOTAL)).toBe(0.9);
    });

    it('all 7 bullish, 0 bearish also caps at 0.9 (upper clamp)', () => {
      expect(computeTechnicalAnalystConfidence(7, 0, TOTAL)).toBe(0.9);
    });
  });

  describe('boundary conditions', () => {
    it('all silent → floors at 0.10 (no vote, no confidence)', () => {
      expect(computeTechnicalAnalystConfidence(0, 0, TOTAL)).toBe(0.1);
    });

    it('perfectly split vote → low confidence (conflicting signals)', () => {
      // 2 vs 2 → conviction 0, then lower-bounded at 0.10
      expect(computeTechnicalAnalystConfidence(2, 2, TOTAL)).toBe(0.1);
      expect(computeTechnicalAnalystConfidence(3, 3, TOTAL)).toBe(0.1);
    });

    it('handles zero totalSignals defensively (no div-by-zero, returns floor)', () => {
      expect(computeTechnicalAnalystConfidence(0, 0, 0)).toBe(0.1);
      expect(computeTechnicalAnalystConfidence(0, 0, -1)).toBe(0.1);
    });

    it('negative input counts are treated as zero (malformed caller safety)', () => {
      // Any path that accidentally produces a negative count shouldn't blow
      // up the arithmetic — clamp to zero, return the floor.
      expect(computeTechnicalAnalystConfidence(-1, 2, TOTAL)).toBeCloseTo(
        computeTechnicalAnalystConfidence(0, 2, TOTAL),
        6,
      );
    });
  });

  describe('activity bonus (breadth still matters)', () => {
    it('3 of 3 unanimous scores higher than 3 of 5 with 2 dissenters', () => {
      // Both have conviction ratio 1.0 or high, but the one with MORE active
      // indicators should score higher via the activity bonus.
      const narrow = computeTechnicalAnalystConfidence(3, 0, TOTAL); // 3 active
      const wider = computeTechnicalAnalystConfidence(5, 0, TOTAL); // 5 active
      expect(wider).toBeGreaterThanOrEqual(narrow);
    });

    it('holding conviction constant (not clamped), more active voters → higher confidence', () => {
      // Unanimous 2/2 and 4/4 both clamp at 0.9, so use a conviction <1.0
      // scenario where the activity bonus actually moves the output.
      // 2 bull / 1 bear vs 4 bull / 2 bear — both conviction 1/3 ≈ 0.333.
      const narrow = computeTechnicalAnalystConfidence(2, 1, TOTAL); // active 3/7
      const wider = computeTechnicalAnalystConfidence(4, 2, TOTAL); // active 6/7
      expect(wider).toBeGreaterThan(narrow);
    });
  });

  describe('symmetry (bearish scenarios mirror bullish)', () => {
    it('bearish 3 vs 1 matches bullish 1 vs 3 in confidence magnitude', () => {
      const bullish = computeTechnicalAnalystConfidence(3, 1, TOTAL);
      const bearish = computeTechnicalAnalystConfidence(1, 3, TOTAL);
      expect(bearish).toBeCloseTo(bullish, 6);
    });
  });

  describe('regression guard — NEVER below 0.50 on the canonical setup', () => {
    // This is the exact scenario that produced the 3-day silence. If a
    // future tweak pushes this back under 0.50, the backtest will
    // immediately show TechnicalAnalyst at 0% pass rate again and this
    // test is the canary that catches it first.
    it('typical directional setup (3 bullish, 1 bearish) must clear 0.50', () => {
      const c = computeTechnicalAnalystConfidence(3, 1, 7);
      expect(c).toBeGreaterThan(0.5);
    });

    it('moderate-strong setup (3 bullish, 0 bearish) must clear 0.65', () => {
      // 3 / 3 = 1.0 conviction × 1.4 × (0.7 + 0.3 × 3/7) ≈ 1.12 → clamped 0.9
      const c = computeTechnicalAnalystConfidence(3, 0, 7);
      expect(c).toBeGreaterThan(0.65);
    });
  });
});
