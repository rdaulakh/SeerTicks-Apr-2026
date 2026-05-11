/**
 * BayesianAggregator — Phase 70
 *
 * Replaces the naive weighted-average consensus with a covariance-aware
 * Bayesian update. Solves the false-confidence problem: 5 correlated
 * agents all reading the same 5-min candle behave as ~1 effective agent,
 * not 5 — the naive aggregator double-counts that information.
 *
 * Inputs:
 *   - signals: list of (agentName, direction in {-1,+1,0}, confidence in 0..1)
 *   - correlations: optional pairwise correlation map (defaults to no-correlation)
 *   - weights: per-agent weight (defaults to 1)
 *
 * Outputs (PURE — no side effects):
 *   - posteriorMean: 0..1 belief that the trade is correct (bullish-aligned)
 *   - posteriorStd: uncertainty around the mean
 *   - effectiveN: <= rawN; the information-theoretic agent count
 *   - avgCorrelation: average pairwise correlation among reporting agents
 *
 * Math:
 *   1. Each agent emits a "vote" (direction × confidence).
 *   2. Build the agent correlation matrix Σ from `correlations` (default I).
 *   3. effective_N = N² / sum(Σ)  (Kish's design effect — reduces N when
 *      agents are correlated).
 *   4. Prior: Beta(α=1, β=1) — uniform belief.
 *   5. Likelihood: each agent contributes `effective_weight × confidence`
 *      pseudo-trials to α (bullish) or β (bearish).
 *   6. Posterior: Beta(α', β') where α' = α + Σ_bullish, β' = β + Σ_bearish.
 *   7. posteriorMean = α' / (α' + β')
 *      posteriorStd = sqrt(α' × β' / ((α' + β')² × (α' + β' + 1)))
 */

export interface AgentVote {
  agentName: string;
  /** -1 = bearish, +1 = bullish, 0 = neutral */
  direction: -1 | 0 | 1;
  /** 0..1 confidence */
  confidence: number;
  /** Optional per-agent weight (defaults to 1) */
  weight?: number;
}

export interface CorrelationMap {
  /** Sparse pairwise correlations. Symmetric and self=1 are inferred. */
  get(agentA: string, agentB: string): number;
}

export interface BayesianResult {
  posteriorMean: number;     // 0..1
  posteriorStd: number;      // 0..0.5 (Beta max std at mean=0.5, n=1)
  effectiveN: number;        // <= rawN
  rawN: number;
  avgCorrelation: number;    // mean pairwise correlation among voters
  naiveMean: number;         // legacy weighted average for A/B
  bullishWeight: number;
  bearishWeight: number;
}

/** Identity correlation — no correlations known. */
export const IDENTITY_CORRELATION: CorrelationMap = {
  get(a, b) { return a === b ? 1 : 0; },
};

/** Build a correlation map from a flat array of pairwise rows. */
export function buildCorrelationMap(
  rows: { agentA: string; agentB: string; correlation: number }[],
): CorrelationMap {
  const map = new Map<string, number>();
  for (const r of rows) {
    const a = r.agentA;
    const b = r.agentB;
    if (a === b) continue;
    // Symmetric: store both orderings.
    const v = clamp(r.correlation, -1, 1);
    map.set(`${a}|${b}`, v);
    map.set(`${b}|${a}`, v);
  }
  return {
    get(a: string, b: string): number {
      if (a === b) return 1;
      return map.get(`${a}|${b}`) ?? 0;
    },
  };
}

/**
 * Pure Bayesian aggregation.
 *
 * @param votes  agents' directional votes with confidence
 * @param correlations  pairwise agent correlation (default: identity)
 */
export function aggregate(
  votes: AgentVote[],
  correlations: CorrelationMap = IDENTITY_CORRELATION,
): BayesianResult {
  // Filter to agents with a real opinion (skip neutrals and zero-conf).
  const directional = votes.filter(v => v.direction !== 0 && v.confidence > 0);
  const rawN = directional.length;

  if (rawN === 0) {
    return {
      posteriorMean: 0.5,        // No information → uniform prior
      posteriorStd: Math.sqrt(1 / 12),  // Variance of Uniform(0,1) = 1/12
      effectiveN: 0,
      rawN: 0,
      avgCorrelation: 0,
      naiveMean: 0.5,
      bullishWeight: 0,
      bearishWeight: 0,
    };
  }

  // ── 1. Naive weighted average (legacy A/B baseline) ──
  let sumWConf = 0;
  let sumWeightedBullishConf = 0;
  for (const v of directional) {
    const w = v.weight ?? 1;
    sumWConf += w * v.confidence;
    // direction in {-1,+1}; map bearish (-1) → 0 vote, bullish (+1) → 1 vote
    const vote = v.direction === 1 ? 1 : 0;
    sumWeightedBullishConf += w * v.confidence * vote;
  }
  const naiveMean = sumWConf > 0 ? sumWeightedBullishConf / sumWConf : 0.5;

  // ── 2. Effective-N via Kish's design effect ──
  // For an N×N correlation matrix R with row sums r_i,
  // effective_N = N² / sum(r_i) = N² / sum_ij(R_ij)
  let sumMatrix = 0;
  let pairCount = 0;
  let pairCorrSum = 0;
  for (let i = 0; i < rawN; i++) {
    for (let j = 0; j < rawN; j++) {
      const corr = correlations.get(directional[i].agentName, directional[j].agentName);
      sumMatrix += corr;
      if (i !== j) {
        pairCount++;
        pairCorrSum += corr;
      }
    }
  }
  const avgCorrelation = pairCount > 0 ? pairCorrSum / pairCount : 0;
  const effectiveN = sumMatrix > 0 ? (rawN * rawN) / sumMatrix : rawN;
  // Clamp: effective N can never exceed raw N (mathematically) and never go below 1
  const effectiveNClamped = Math.max(1, Math.min(rawN, effectiveN));

  // ── 3. Beta posterior ──
  // Prior: Beta(1, 1) — uniform.
  // Each agent contributes (effectiveN/rawN) × weight × confidence pseudo-trials.
  // This downweights individual contributions when agents are correlated.
  const effectiveWeight = effectiveNClamped / rawN; // <= 1
  let alpha = 1;
  let beta = 1;
  for (const v of directional) {
    const w = v.weight ?? 1;
    const contribution = effectiveWeight * w * v.confidence;
    if (v.direction === 1) alpha += contribution;
    else beta += contribution;
  }

  const total = alpha + beta;
  const posteriorMean = alpha / total;
  // Beta variance = αβ / ((α+β)² (α+β+1))
  const posteriorVariance = (alpha * beta) / (total * total * (total + 1));
  const posteriorStd = Math.sqrt(posteriorVariance);

  return {
    posteriorMean,
    posteriorStd,
    effectiveN: effectiveNClamped,
    rawN,
    avgCorrelation,
    naiveMean,
    bullishWeight: alpha - 1,  // Subtract prior
    bearishWeight: beta - 1,
  };
}

/**
 * Trade gate. Returns whether posterior is strong enough AND uncertain enough
 * to actually fire a trade. The user-requested behavior: a high-mean / high-uncertainty
 * consensus (the false-confidence case) should be REJECTED, not approved.
 */
export interface GateConfig {
  /** Posterior must be at least this far from 0.5 (e.g. 0.15 → >0.65 or <0.35) */
  minDistanceFromHalf: number;
  /** Posterior std must be below this — high uncertainty rejects */
  maxUncertainty: number;
  /** Minimum effective N — at least this many independent voices */
  minEffectiveN: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  minDistanceFromHalf: 0.15,  // posterior must be > 0.65 or < 0.35 for trade
  maxUncertainty: 0.18,       // std cap — beyond this, too unreliable
  minEffectiveN: 1.5,         // need at least 1.5 independent voices
};

export type GateDecision =
  | { approved: true; direction: 'bullish' | 'bearish'; reason: string }
  | { approved: false; reason: string };

export function applyGate(
  result: BayesianResult,
  config: GateConfig = DEFAULT_GATE_CONFIG,
): GateDecision {
  const distance = Math.abs(result.posteriorMean - 0.5);

  if (result.effectiveN < config.minEffectiveN) {
    return {
      approved: false,
      reason: `effectiveN=${result.effectiveN.toFixed(2)} < ${config.minEffectiveN} (need more independent voters)`,
    };
  }

  if (result.posteriorStd > config.maxUncertainty) {
    return {
      approved: false,
      reason: `posteriorStd=${result.posteriorStd.toFixed(3)} > ${config.maxUncertainty} (too uncertain)`,
    };
  }

  if (distance < config.minDistanceFromHalf) {
    return {
      approved: false,
      reason: `posterior=${result.posteriorMean.toFixed(3)} too close to 0.5 (need distance>=${config.minDistanceFromHalf})`,
    };
  }

  return {
    approved: true,
    direction: result.posteriorMean > 0.5 ? 'bullish' : 'bearish',
    reason: `posterior=${result.posteriorMean.toFixed(3)}±${result.posteriorStd.toFixed(3)} effN=${result.effectiveN.toFixed(2)}`,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
