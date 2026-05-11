/**
 * Tests for BayesianAggregator (Phase 70).
 *
 * Verifies the central claim: correlated agents produce LESS effective
 * information than independent agents, even with identical raw counts.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregate,
  applyGate,
  buildCorrelationMap,
  IDENTITY_CORRELATION,
  type AgentVote,
} from '../services/BayesianAggregator';

describe('BayesianAggregator', () => {
  describe('effective-N reduction', () => {
    it('5 independent agents → effectiveN ≈ 5', () => {
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      const result = aggregate(votes, IDENTITY_CORRELATION);
      expect(result.rawN).toBe(5);
      expect(result.effectiveN).toBeCloseTo(5, 1);
    });

    it('5 perfectly-correlated agents → effectiveN ≈ 1', () => {
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      // Build a correlation map where every pair (off-diagonal) has corr=1
      const corrRows = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i !== j) {
            corrRows.push({ agentA: `Agent${i}`, agentB: `Agent${j}`, correlation: 1 });
          }
        }
      }
      const corr = buildCorrelationMap(corrRows);
      const result = aggregate(votes, corr);
      // For full correlation: sumMatrix = N*N (all entries = 1), effectiveN = N²/N² = 1
      expect(result.effectiveN).toBeCloseTo(1, 1);
      expect(result.avgCorrelation).toBeCloseTo(1, 2);
    });

    it('5 agents pairwise-corr 0.8 → effectiveN ≈ 1.22', () => {
      // Theoretical: N² / (N + N(N-1)ρ) = 25 / (5 + 20·0.8) = 25 / 21 ≈ 1.19
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      const corrRows = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i !== j) {
            corrRows.push({ agentA: `Agent${i}`, agentB: `Agent${j}`, correlation: 0.8 });
          }
        }
      }
      const corr = buildCorrelationMap(corrRows);
      const result = aggregate(votes, corr);
      expect(result.effectiveN).toBeGreaterThan(1.0);
      expect(result.effectiveN).toBeLessThan(1.5);
      expect(result.avgCorrelation).toBeCloseTo(0.8, 2);
    });
  });

  describe('posterior calibration', () => {
    it('unanimous bullish with high confidence → posterior > 0.5', () => {
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      const result = aggregate(votes, IDENTITY_CORRELATION);
      expect(result.posteriorMean).toBeGreaterThan(0.7);
      expect(result.bullishWeight).toBeGreaterThan(result.bearishWeight);
    });

    it('split 3-bull / 2-bear → posterior near 0.5', () => {
      const votes: AgentVote[] = [
        { agentName: 'A', direction: 1, confidence: 0.7 },
        { agentName: 'B', direction: 1, confidence: 0.7 },
        { agentName: 'C', direction: 1, confidence: 0.7 },
        { agentName: 'D', direction: -1, confidence: 0.7 },
        { agentName: 'E', direction: -1, confidence: 0.7 },
      ];
      const result = aggregate(votes, IDENTITY_CORRELATION);
      // 3/5 bullish → posterior should be around 0.6 (not far from 0.5)
      expect(result.posteriorMean).toBeGreaterThan(0.5);
      expect(result.posteriorMean).toBeLessThan(0.7);
    });

    it('no votes → uniform prior (mean=0.5, std=sqrt(1/12))', () => {
      const result = aggregate([], IDENTITY_CORRELATION);
      expect(result.posteriorMean).toBe(0.5);
      expect(result.posteriorStd).toBeCloseTo(Math.sqrt(1 / 12), 4);
      expect(result.effectiveN).toBe(0);
      expect(result.rawN).toBe(0);
    });

    it('correlated agents produce HIGHER std than independent agents (same raw N)', () => {
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      const corrRows = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i !== j) {
            corrRows.push({ agentA: `Agent${i}`, agentB: `Agent${j}`, correlation: 0.95 });
          }
        }
      }
      const corrHigh = buildCorrelationMap(corrRows);
      const resIndep = aggregate(votes, IDENTITY_CORRELATION);
      const resCorr = aggregate(votes, corrHigh);
      // Same raw N + same direction but high correlation = LESS information = higher uncertainty
      expect(resCorr.posteriorStd).toBeGreaterThan(resIndep.posteriorStd);
    });
  });

  describe('A/B comparison with naive aggregator', () => {
    it('5 perfectly-correlated bulls: naive says high mean, Bayesian shows true uncertainty', () => {
      const votes: AgentVote[] = Array.from({ length: 5 }, (_, i) => ({
        agentName: `Agent${i}`,
        direction: 1 as 1,
        confidence: 0.8,
      }));
      const corrRows = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i !== j) {
            corrRows.push({ agentA: `Agent${i}`, agentB: `Agent${j}`, correlation: 1 });
          }
        }
      }
      const corr = buildCorrelationMap(corrRows);
      const result = aggregate(votes, corr);
      // Naive will say 1.0 (every weighted vote is bullish)
      expect(result.naiveMean).toBe(1.0);
      // Bayesian sees only ~1 effective agent → posterior is closer to 0.5
      // and std is meaningfully high
      expect(result.posteriorMean).toBeLessThan(0.85);
      expect(result.posteriorStd).toBeGreaterThan(0.15);
    });
  });

  describe('gate decisions', () => {
    it('rejects high-mean / high-std (the false confidence case)', () => {
      // effectiveN >= 1.5 so we fall through to the uncertainty check
      const result = {
        posteriorMean: 0.78,
        posteriorStd: 0.25,  // exceeds 0.18 cap
        effectiveN: 2.5,
        rawN: 5,
        avgCorrelation: 0.9,
        naiveMean: 0.9,
        bullishWeight: 4,
        bearishWeight: 0.5,
      };
      const gate = applyGate(result);
      expect(gate.approved).toBe(false);
      if (!gate.approved) expect(gate.reason).toMatch(/uncertain/);
    });

    it('approves clean high-mean / low-std with adequate effectiveN', () => {
      const result = {
        posteriorMean: 0.80,
        posteriorStd: 0.10,
        effectiveN: 4.2,
        rawN: 5,
        avgCorrelation: 0.2,
        naiveMean: 0.85,
        bullishWeight: 3,
        bearishWeight: 0.3,
      };
      const gate = applyGate(result);
      expect(gate.approved).toBe(true);
      if (gate.approved) expect(gate.direction).toBe('bullish');
    });

    it('rejects low effectiveN (single noisy voter)', () => {
      const result = {
        posteriorMean: 0.9,
        posteriorStd: 0.15,
        effectiveN: 1.0,
        rawN: 1,
        avgCorrelation: 0,
        naiveMean: 0.9,
        bullishWeight: 0.8,
        bearishWeight: 0,
      };
      const gate = applyGate(result);
      expect(gate.approved).toBe(false);
      if (!gate.approved) expect(gate.reason).toMatch(/effectiveN/);
    });

    it('rejects mean too close to 0.5', () => {
      const result = {
        posteriorMean: 0.58,  // distance from 0.5 = 0.08 < 0.15
        posteriorStd: 0.10,
        effectiveN: 5,
        rawN: 5,
        avgCorrelation: 0.1,
        naiveMean: 0.6,
        bullishWeight: 3,
        bearishWeight: 2,
      };
      const gate = applyGate(result);
      expect(gate.approved).toBe(false);
      if (!gate.approved) expect(gate.reason).toMatch(/close to 0.5/);
    });
  });
});
