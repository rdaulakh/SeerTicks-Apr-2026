/**
 * Phase 18 — PatternMatcher unvalidated-confidence discount fix.
 *
 * Phase 16 backtest revealed PatternMatcher at 0% pass rate against ANY
 * threshold (0.50, 0.55, 0.60, 0.65, 0.70) across 16,520 production
 * consensus rows. Root cause discovered by reading the actual
 * production logs:
 *
 *   [PatternMatcher] No validated patterns found, using detected
 *    patterns with reduced confidence
 *
 * That message fires every few seconds because the `winningPatterns`
 * DB table is empty (the audit confirmed it has 2 references, never
 * populated by any pipeline). So the agent is ALWAYS in its fallback
 * branch, which halved confidence:
 *
 *   const confidence = Math.max(0.05, Math.min(0.95,
 *     bestDetected.confidence * 0.5));
 *
 * A clean 0.90-confidence detection became 0.45. With the downstream
 * damping factors (overextension × 0.75, regime × 0.85, etc.) on top,
 * PatternMatcher confidence settled in the 0.30-0.40 band — under
 * every consensus threshold, every time.
 *
 * Phase 18: replace the 50% chop with a 15% discount. Detection
 * confidence is already calibrated; the original halving was
 * double-counting risk. Pattern-validation loop (Phase 23) will
 * populate winningPatterns and switch to the validated-path math —
 * this is the bridge fix.
 */

import { describe, it, expect } from 'vitest';
import { computeUnvalidatedPatternConfidence } from '../agents/PatternMatcher';

describe('Phase 18 — computeUnvalidatedPatternConfidence', () => {
  describe('the canonical bug scenario — strong detections were getting halved', () => {
    it('0.90 detection → 0.765 (was 0.45 pre-fix)', () => {
      const c = computeUnvalidatedPatternConfidence(0.9);
      expect(c).toBeCloseTo(0.765, 4);
      // The whole point: this MUST clear the 0.50 consensus floor that
      // the old 50% chop pinned us below.
      expect(c).toBeGreaterThan(0.5);
    });

    it('0.80 detection → 0.68 (was 0.40 pre-fix, below floor)', () => {
      const c = computeUnvalidatedPatternConfidence(0.8);
      expect(c).toBeCloseTo(0.68, 4);
      expect(c).toBeGreaterThan(0.5);
    });

    it('0.70 detection → 0.595 (was 0.35 pre-fix)', () => {
      // Edge of the 0.50 bar — PatternMatcher's median detection
      // probably lives around here on real bars.
      const c = computeUnvalidatedPatternConfidence(0.7);
      expect(c).toBeCloseTo(0.595, 4);
      expect(c).toBeGreaterThan(0.5);
    });
  });

  describe('weak detections still stay below the bar (right thing)', () => {
    it('0.50 detection → 0.425 (still below 0.50 floor)', () => {
      const c = computeUnvalidatedPatternConfidence(0.5);
      expect(c).toBeCloseTo(0.425, 4);
      expect(c).toBeLessThan(0.5);
    });

    it('0.40 detection → 0.34 (well below)', () => {
      const c = computeUnvalidatedPatternConfidence(0.4);
      expect(c).toBeCloseTo(0.34, 4);
    });
  });

  describe('upper clamp', () => {
    it('1.0 detection caps at 0.85 (within 0.95 ceiling)', () => {
      // 1.0 × 0.85 = 0.85. Below the 0.95 cap; cap doesn't activate.
      expect(computeUnvalidatedPatternConfidence(1.0)).toBeCloseTo(0.85, 4);
    });

    it('clamps at 0.95 ceiling for any improbable >1.12 input', () => {
      // Defensive cap so a buggy upstream that returned >1.0 can't push
      // the agent into "100% confident" territory and dominate consensus.
      expect(computeUnvalidatedPatternConfidence(1.5)).toBe(0.95);
      expect(computeUnvalidatedPatternConfidence(10)).toBe(0.95);
    });
  });

  describe('lower clamp', () => {
    it('zero or negative detection floors at 0.05', () => {
      expect(computeUnvalidatedPatternConfidence(0)).toBe(0.05);
      expect(computeUnvalidatedPatternConfidence(-0.5)).toBe(0.05);
    });

    it('NaN / Infinity → safe floor (no agent crash on weird input)', () => {
      expect(computeUnvalidatedPatternConfidence(NaN)).toBe(0.05);
      expect(computeUnvalidatedPatternConfidence(Infinity)).toBe(0.05);
      expect(computeUnvalidatedPatternConfidence(-Infinity)).toBe(0.05);
    });

    it('tiny positive input lifts the floor (0.05 detection → 0.0425, but clamped to 0.05)', () => {
      // 0.05 × 0.85 = 0.0425, below the 0.05 floor → clamped to 0.05.
      expect(computeUnvalidatedPatternConfidence(0.05)).toBe(0.05);
      // 0.06 × 0.85 = 0.051, just above the floor — passes through.
      expect(computeUnvalidatedPatternConfidence(0.06)).toBeCloseTo(0.051, 4);
    });
  });

  describe('regression guard — never ship a halving regression', () => {
    // If a future "tighter is safer" change reverts to `* 0.5` or smaller,
    // this catches it before the agent silently goes back to 0% pass rate.
    it('discount factor is at most 0.85× (no halving regression)', () => {
      const c = computeUnvalidatedPatternConfidence(0.8);
      // c / 0.8 must be ≥ 0.85 (allowing for floor clamps not to fire here).
      expect(c / 0.8).toBeGreaterThanOrEqual(0.85);
    });

    it('typical detection (0.75) clears the 0.50 consensus bar', () => {
      // The single test that matters: PatternMatcher must be capable of
      // contributing to consensus on normal-quality detections. If this
      // breaks, Phase 16's backtest will show 0% pass rate again.
      expect(computeUnvalidatedPatternConfidence(0.75)).toBeGreaterThan(0.5);
    });
  });

  describe('monotonicity — better detection → better confidence', () => {
    it('strictly increasing in the input range [0.1, 1.0]', () => {
      const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const values = samples.map((s) => computeUnvalidatedPatternConfidence(s));
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });
  });
});
