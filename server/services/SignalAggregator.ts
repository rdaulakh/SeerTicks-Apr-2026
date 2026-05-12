/**
 * SignalAggregator — Correlation-Aware Intelligent Signal Merge
 * 
 * Phase 30: Replaces the dumb weighted average with an intelligent aggregation engine.
 * 
 * Key improvements over the old calculateConsensus:
 * 1. CORRELATION DEDUPLICATION: Agents in the same "family" (e.g., OnChainAnalyst + OnChainFlowAnalyst)
 *    have their combined weight capped to prevent double-counting.
 * 2. SIGNAL QUALITY SCORING: Each signal is scored on freshness, consistency, and data quality.
 * 3. CONVICTION EXTRACTION: Identifies "high conviction" signals where an agent's confidence
 *    is significantly above its historical average.
 * 4. DISSENT ANALYSIS: When a minority of agents disagree with the majority, their reasoning
 *    is analyzed for potential warning signals.
 * 5. REGIME-AWARE FAMILY WEIGHTS: Agent families are weighted differently based on market regime.
 */

import { AgentSignal } from '../agents/AgentBase';
import { getFamilyWeightAdjustments } from './RegimeCalibration';
import { appendFileSync } from 'fs';

export interface AggregatedSignal {
  // Phase 82.3 — widened to allow 'neutral' so the aggregator can honestly
  // report no-consensus instead of fake-picking a side by tiny weight margin.
  // Downstream callers that previously assumed 'bullish'|'bearish' now must
  // gate on strength > 0 (which they already do, since the consensus-threshold
  // check is the canonical "approved" gate).
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;           // 0-1, overall consensus strength
  confidence: number;         // 0-1, quality-adjusted confidence
  bullishWeight: number;
  bearishWeight: number;
  totalWeight: number;
  positionSize?: number;      // ML gate may adjust position size (backward compat with Consensus)
  
  // New fields from intelligent aggregation
  correlationAdjusted: boolean;
  familyBreakdown: FamilyVote[];
  highConvictionAgents: string[];
  dissentingAgents: DissentInfo[];
  signalQuality: number;     // 0-1, overall signal quality score
  regimeAlignment: number;   // 0-1, how well signals align with detected regime
}

interface FamilyVote {
  family: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  weight: number;
  agents: string[];
  agreement: number;         // 0-1, internal agreement within family
}

interface DissentInfo {
  agentName: string;
  signal: string;
  confidence: number;
  reasoning: string;
  family: string;
}

/**
 * Agent families — groups of agents that analyze similar data sources.
 * Agents in the same family are correlated, so their combined weight is capped.
 */
const AGENT_FAMILIES: Record<string, string[]> = {
  'technical': ['TechnicalAnalyst', 'PatternMatcher', 'VolumeProfileAnalyzer'],
  'on_chain': ['OnChainAnalyst', 'OnChainFlowAnalyst'],
  'sentiment': ['SentimentAnalyst', 'NewsSentinel'],
  'order_flow': ['OrderFlowAnalyst', 'LiquidationHeatmap'],
  'macro': ['MacroAnalyst', 'ForexCorrelationAgent'],
  'predictive': ['MLPredictionAgent'],
  'whale': ['WhaleTracker'],
  'funding': ['FundingRateAnalyst'],
};

/**
 * Maximum weight cap per family (as fraction of total weight).
 * Prevents any single data source from dominating the consensus.
 */
const FAMILY_WEIGHT_CAPS: Record<string, number> = {
  'technical': 0.30,    // Max 30% from technical analysis family
  'on_chain': 0.20,     // Max 20% from on-chain family
  'sentiment': 0.15,    // Max 15% from sentiment family
  'order_flow': 0.25,   // Max 25% from order flow family
  'macro': 0.15,        // Max 15% from macro family
  'predictive': 0.15,   // Max 15% from ML predictions
  'whale': 0.10,        // Max 10% from whale tracking
  'funding': 0.10,      // Max 10% from funding rates
};

/**
 * Regime-specific family weight adjustments.
 * In different market regimes, certain families become more/less important.
 */
// Phase 31: REGIME_FAMILY_ADJUSTMENTS replaced by centralized RegimeCalibration
// Use getFamilyWeightAdjustments(regime) instead of static lookup

/**
 * Get the family for a given agent name.
 */
function getAgentFamily(agentName: string): string {
  for (const [family, agents] of Object.entries(AGENT_FAMILIES)) {
    if (agents.includes(agentName)) return family;
  }
  return 'unknown';
}

/**
 * Historical confidence tracker for conviction detection.
 * Tracks rolling average confidence per agent to detect unusual conviction.
 */
class ConvictionTracker {
  private history: Map<string, number[]> = new Map();
  private readonly MAX_HISTORY = 50;

  recordConfidence(agentName: string, confidence: number): void {
    if (!this.history.has(agentName)) {
      this.history.set(agentName, []);
    }
    const hist = this.history.get(agentName)!;
    hist.push(confidence);
    if (hist.length > this.MAX_HISTORY) {
      hist.shift();
    }
  }

  getAverageConfidence(agentName: string): number {
    const hist = this.history.get(agentName);
    if (!hist || hist.length < 5) return 0.5; // Default average
    return hist.reduce((a, b) => a + b, 0) / hist.length;
  }

  isHighConviction(agentName: string, currentConfidence: number): boolean {
    const avg = this.getAverageConfidence(agentName);
    // High conviction = current confidence is >1.3x the agent's historical average
    return currentConfidence > avg * 1.3 && currentConfidence > 0.65;
  }
}

// Singleton conviction tracker
const convictionTracker = new ConvictionTracker();

/**
 * Main aggregation function — replaces the old weighted average.
 * 
 * @param signals - Raw agent signals
 * @param agentWeights - Base agent weights from configuration
 * @param marketContext - MarketRegimeAI context (regime, agentGuidance)
 * @returns AggregatedSignal with correlation-adjusted consensus
 */
export function aggregateSignals(
  signals: AgentSignal[],
  agentWeights: Record<string, number>,
  marketContext?: any
): AggregatedSignal {
  if (signals.length === 0) {
    return createEmptyAggregation();
  }

  const regime = marketContext?.regime as string || 'unknown';
  const regimeConfidence = marketContext?.regimeConfidence as number || 0.5;

  // Step 1: Score each signal's quality
  const scoredSignals = signals.map(s => ({
    ...s,
    qualityScore: calculateSignalQuality(s),
    family: getAgentFamily(s.agentName),
  }));

  // Step 2: Record confidence for conviction tracking
  for (const s of scoredSignals) {
    convictionTracker.recordConfidence(s.agentName, s.confidence);
  }

  // Step 3: Group signals by family
  const familyGroups = new Map<string, typeof scoredSignals>();
  for (const s of scoredSignals) {
    if (!familyGroups.has(s.family)) {
      familyGroups.set(s.family, []);
    }
    familyGroups.get(s.family)!.push(s);
  }

  // Step 4: Calculate per-family votes with correlation deduplication
  const familyVotes: FamilyVote[] = [];
  let totalFamilyWeight = 0;

  for (const [family, familySignals] of familyGroups) {
    // Calculate raw weight for this family
    let familyBullish = 0;
    let familyBearish = 0;
    let familyNeutral = 0;

    for (const s of familySignals) {
      let weight = agentWeights[s.agentName] || 0.05;
      
      // Apply regime-based weight multiplier from MarketRegimeAI
      if (marketContext?.agentGuidance?.[s.agentName]?.weightMultiplier) {
        weight *= marketContext.agentGuidance[s.agentName].weightMultiplier;
      }

      // Quality-adjust the weight
      const qualityAdjustedWeight = weight * s.qualityScore;

      if (s.signal === 'bullish') {
        familyBullish += qualityAdjustedWeight * s.confidence;
      } else if (s.signal === 'bearish') {
        familyBearish += qualityAdjustedWeight * s.confidence;
      } else {
        familyNeutral += qualityAdjustedWeight * s.confidence;
      }
    }

    // Determine family direction
    let familyDirection: 'bullish' | 'bearish' | 'neutral';
    let familyWeight: number;
    
    if (familyBullish > familyBearish && familyBullish > familyNeutral) {
      familyDirection = 'bullish';
      familyWeight = familyBullish;
    } else if (familyBearish > familyBullish && familyBearish > familyNeutral) {
      familyDirection = 'bearish';
      familyWeight = familyBearish;
    } else {
      familyDirection = 'neutral';
      familyWeight = familyNeutral;
    }

    // Apply family weight cap (correlation deduplication)
    const cap = FAMILY_WEIGHT_CAPS[family] || 0.15;
    
    // Apply regime-specific family adjustment
    const familyAdj = getFamilyWeightAdjustments(regime);
    const regimeAdj = familyAdj[family] || 1.0;
    const adjustedCap = cap * regimeAdj;
    
    // Cap will be applied after we know totalFamilyWeight
    
    // Calculate internal agreement (how much the family agrees with itself)
    const totalFamilyVote = familyBullish + familyBearish + familyNeutral;
    const agreement = totalFamilyVote > 0 ? familyWeight / totalFamilyVote : 0;

    familyVotes.push({
      family,
      direction: familyDirection,
      weight: familyWeight,
      agents: familySignals.map(s => s.agentName),
      agreement,
    });

    totalFamilyWeight += familyWeight;
  }

  // Step 5: Apply family weight caps (normalize and cap)
  if (totalFamilyWeight > 0) {
    for (const vote of familyVotes) {
      const normalizedWeight = vote.weight / totalFamilyWeight;
      const cap = FAMILY_WEIGHT_CAPS[vote.family] || 0.15;
      const familyAdj2 = getFamilyWeightAdjustments(regime);
      const regimeAdj = familyAdj2[vote.family] || 1.0;
      const adjustedCap = cap * regimeAdj;
      
      if (normalizedWeight > adjustedCap) {
        // Cap exceeded — redistribute excess
        vote.weight = adjustedCap * totalFamilyWeight;
      }
    }
  }

  // Step 6: Calculate final consensus from family votes
  let bullishWeight = 0;
  let bearishWeight = 0;
  let neutralWeight = 0;

  for (const vote of familyVotes) {
    if (vote.direction === 'bullish') {
      bullishWeight += vote.weight;
    } else if (vote.direction === 'bearish') {
      bearishWeight += vote.weight;
    } else {
      neutralWeight += vote.weight;
    }
  }

  const totalWeight = bullishWeight + bearishWeight + neutralWeight;
  const activeVoteWeight = bullishWeight + bearishWeight;
  const dominantWeight = Math.max(bullishWeight, bearishWeight);

  // DAR (Directional Agreement Ratio) — same formula as before but family-adjusted
  const dar = activeVoteWeight > 0 ? dominantWeight / activeVoteWeight : 0.5;

  // CWS (Confidence-Weighted Strength) — now quality-adjusted
  const cws = activeVoteWeight > 0 ? dominantWeight / activeVoteWeight : 0;

  // Direction determination
  const bullishFamilies = familyVotes.filter(v => v.direction === 'bullish').length;
  const bearishFamilies = familyVotes.filter(v => v.direction === 'bearish').length;
  // Phase 45 FIX: Lowered from 0.60 back to 0.55.
  // Root cause: Family weight caps modify the raw weights, reducing the DAR below 0.60 even when
  // the raw signal split is 60/40. With 2 split families (technical + order_flow), the capped weights
  // produce DAR=0.57 which is below 0.60, blocking ALL consensus. 0.55 allows 55/45 splits through
  // while still requiring a meaningful directional lean.
  const MIN_DIRECTION_RATIO = 0.55;
  // Phase 45 FIX: Lowered from 2 to 1 family agreement.
  // Root cause: When families are internally split (e.g., technical has PatternMatcher=bullish
  // and VolumeProfileAnalyzer=bearish), the net family direction depends on quality-adjusted weights.
  // With 2 families both split, we often get bullFam=1 bearFam=1, which blocked ALL consensus.
  // The weight margin (10-20%) and DAR (60%) requirements already ensure quality consensus.
  // 1 family agreement + weight margin + DAR is sufficient for a valid directional signal.
  const MIN_FAMILY_AGREEMENT = 1; // At least 1 family must agree
  const MIN_WEIGHT_MARGIN = 0.10; // Phase 40: Dominant side must have 10%+ margin over minority

  // Phase 82.3 — widened to include 'neutral' so the final else-branch can
  // honestly report "no consensus" instead of fake-pick by tiny weight tie-break.
  let direction: 'bullish' | 'bearish' | 'neutral';
  let strength = 0;

  // Phase 40: Calculate weight margin — prevents false consensus from near-equal splits
  const weightMargin = activeVoteWeight > 0 ? Math.abs(bullishWeight - bearishWeight) / activeVoteWeight : 0;

  // Phase 45 FIX: Weight-based consensus gate (replaces broken agent-count gate)
  // The old Phase 40 logic required the weight-dominant side to also have MORE agents.
  // This was fundamentally wrong: 2 high-weight bullish agents (0.25 weight) would lose
  // to 3 low-weight bearish agents (0.06 weight), returning strength=0 and blocking all trades.
  // 
  // NEW LOGIC: Weight is the primary signal. Agent count is used only as a tiebreaker
  // when weights are very close (margin < 15%). This respects the agent weighting system
  // where higher-quality agents receive more weight.
  const bullishCount = scoredSignals.filter(s => s.signal === 'bullish').length;
  const bearishCount = scoredSignals.filter(s => s.signal === 'bearish').length;
  const countDiff = Math.abs(bullishCount - bearishCount);
  const equalAgentCount = bullishCount === bearishCount;
  
  // Dynamic weight margin based on count split:
  // Equal counts: need 20% weight margin (was 25% - too restrictive)
  // 1-agent diff: need 10% weight margin (was 15%)
  // 2+ agent diff: need 5% weight margin (was 10%)
  const requiredWeightMargin = equalAgentCount ? 0.20 : (countDiff === 1 ? 0.10 : 0.05);

  // Diagnostic logging for consensus calculation
  try {
    const sym = scoredSignals[0]?.symbol || 'unknown';
    appendFileSync('/tmp/seer-consensus-debug.log', `${new Date().toISOString()} | ${sym} CONSENSUS_CALC: bullW=${bullishWeight.toFixed(2)} bearW=${bearishWeight.toFixed(2)} dar=${dar.toFixed(3)} bullFam=${bullishFamilies} bearFam=${bearishFamilies} wMargin=${weightMargin.toFixed(3)} reqMargin=${requiredWeightMargin.toFixed(3)} bullCount=${bullishCount} bearCount=${bearishCount} countDiff=${countDiff} equal=${equalAgentCount}\n`);
  } catch(e) {}

  // Phase 45: Weight-first consensus determination
  // Weight dominance + DAR + family agreement + weight margin = consensus
  // Agent count is NOT required to match — weight IS the vote.
  if (bullishWeight > bearishWeight && dar >= MIN_DIRECTION_RATIO && bullishFamilies >= MIN_FAMILY_AGREEMENT && weightMargin >= requiredWeightMargin) {
    direction = 'bullish';
    strength = dar * 0.6 + cws * 0.4;
  } else if (bearishWeight > bullishWeight && dar >= MIN_DIRECTION_RATIO && bearishFamilies >= MIN_FAMILY_AGREEMENT && weightMargin >= requiredWeightMargin) {
    direction = 'bearish';
    strength = dar * 0.6 + cws * 0.4;
  } else if (weightMargin >= 0.40 && (bullishFamilies >= 1 || bearishFamilies >= 1)) {
    // Phase 45: Strong weight margin override — if one side has 40%+ weight margin,
    // allow consensus even with only 1 family (e.g., 2 technical agents strongly agree)
    direction = bullishWeight > bearishWeight ? 'bullish' : 'bearish';
    strength = (dar * 0.6 + cws * 0.4) * 0.85; // 15% penalty for single-family consensus
  } else {
    // Phase 82.3 fix — was: direction = bullishWeight > bearishWeight ? 'bullish' : 'bearish';
    // That assigned a "winner" by tiny weight tie-break even when strength=0, producing
    // "dir=bullish conf=0.0%" output that downstream readers misinterpreted. When the
    // consensus genuinely doesn't pass any of the three approval branches, the honest
    // answer is 'neutral'. The bear/bull tie-break is reserved for the approved branches.
    direction = 'neutral';
    strength = 0;
  }

  // Step 7: Herding penalty (same as before but family-level)
  if (activeVoteWeight > 0 && familyVotes.length >= 4) {
    const dominanceRatio = dominantWeight / activeVoteWeight;
    if (dominanceRatio > 0.85) {
      const herdingPenalty = Math.max(0.80, 1.0 - (dominanceRatio - 0.85) * 1.33);
      strength *= herdingPenalty;
    }
  }

  // Step 8: Neutral dampening
  if (totalWeight > 0 && neutralWeight / totalWeight > 0.3) {
    const neutralDampening = Math.max(0.70, 1.0 - (neutralWeight / totalWeight - 0.3) * 0.5);
    strength *= neutralDampening;
  }

  // Step 9: Identify high conviction agents
  const highConvictionAgents = scoredSignals
    .filter(s => convictionTracker.isHighConviction(s.agentName, s.confidence))
    .map(s => s.agentName);

  // Step 10: High conviction bonus — if 2+ agents from different families show high conviction
  // in the same direction, boost strength
  if (highConvictionAgents.length >= 2) {
    const hcSignals = scoredSignals.filter(s => highConvictionAgents.includes(s.agentName));
    const hcFamilies = new Set(hcSignals.map(s => s.family));
    const hcDirectionMatch = hcSignals.every(s => s.signal === direction);
    
    if (hcFamilies.size >= 2 && hcDirectionMatch && strength > 0) {
      const convictionBonus = Math.min(0.10, 0.03 * hcFamilies.size);
      strength = Math.min(1.0, strength + convictionBonus);
    }
  }

  // Step 11: Identify dissenting agents
  const dissentingAgents: DissentInfo[] = scoredSignals
    .filter(s => s.signal !== direction && s.signal !== 'neutral' && s.confidence > 0.6)
    .map(s => ({
      agentName: s.agentName,
      signal: s.signal,
      confidence: s.confidence,
      reasoning: s.reasoning || '',
      family: s.family,
    }));

  // Step 12: Dissent penalty — strong dissent from different families reduces strength
  if (dissentingAgents.length > 0 && strength > 0) {
    const dissentFamilies = new Set(dissentingAgents.map(d => d.family));
    if (dissentFamilies.size >= 2) {
      // Multiple families disagree — significant warning
      const dissentPenalty = Math.max(0.75, 1.0 - dissentFamilies.size * 0.08);
      strength *= dissentPenalty;
    }
  }

  // Step 13: Calculate regime alignment score
  let regimeAlignment = 0.5; // Default neutral
  if (regime !== 'unknown' && regimeConfidence > 0.5) {
    // Check if the consensus direction aligns with what the regime suggests
    const trendAligned = (
      (regime === 'trending_up' && direction === 'bullish') ||
      (regime === 'trending_down' && direction === 'bearish')
    );
    const counterTrend = (
      (regime === 'trending_up' && direction === 'bearish') ||
      (regime === 'trending_down' && direction === 'bullish')
    );

    if (trendAligned) {
      regimeAlignment = 0.7 + regimeConfidence * 0.3; // 0.7-1.0
    } else if (counterTrend) {
      regimeAlignment = 0.3 - regimeConfidence * 0.2; // 0.1-0.3
      // Phase 40: Counter-trend trades need MUCH more conviction — heavy penalty
      // Previously 0.85 (15% penalty) was too weak — agents kept trading against the trend
      if (strength > 0) {
        strength *= 0.65; // 35% penalty for counter-trend trades
      }
    } else {
      regimeAlignment = 0.5;
    }
  }

  // Step 14: Calculate overall signal quality
  const avgQuality = scoredSignals.reduce((sum, s) => sum + s.qualityScore, 0) / scoredSignals.length;
  const familyAgreement = familyVotes.reduce((sum, v) => sum + v.agreement, 0) / familyVotes.length;
  const signalQuality = avgQuality * 0.6 + familyAgreement * 0.4;

  return {
    direction,
    strength,
    confidence: strength, // For backward compatibility
    bullishWeight,
    bearishWeight,
    totalWeight,
    correlationAdjusted: true,
    familyBreakdown: familyVotes,
    highConvictionAgents,
    dissentingAgents,
    signalQuality,
    regimeAlignment,
  };
}

/**
 * Calculate signal quality score based on freshness, data quality, and consistency.
 */
function calculateSignalQuality(signal: AgentSignal): number {
  let quality = 0.5; // Base quality

  // Freshness bonus (signals processed quickly are more reliable)
  const processingTime = signal.processingTime || 5000;
  if (processingTime < 1000) quality += 0.15;
  else if (processingTime < 3000) quality += 0.10;
  else if (processingTime < 5000) quality += 0.05;

  // Data freshness bonus
  const dataFreshness = signal.dataFreshness || 60;
  if (dataFreshness < 30) quality += 0.15;
  else if (dataFreshness < 120) quality += 0.10;
  else if (dataFreshness < 300) quality += 0.05;

  // Quality score from agent (if provided)
  if (signal.qualityScore && signal.qualityScore > 0) {
    quality += signal.qualityScore * 0.2;
  }

  // Execution score bonus
  if (signal.executionScore && signal.executionScore > 70) {
    quality += 0.10;
  }

  // Penalize synthetic/mock data
  if ((signal as any).isSyntheticData) {
    quality *= 0.5;
  }

  // Confidence contributes to quality (very low confidence = low quality)
  if (signal.confidence < 0.3) quality *= 0.7;

  return Math.min(1.0, Math.max(0.1, quality));
}

/**
 * Create an empty aggregation result.
 */
function createEmptyAggregation(): AggregatedSignal {
  return {
    direction: 'bullish',
    strength: 0,
    confidence: 0,
    bullishWeight: 0,
    bearishWeight: 0,
    totalWeight: 0,
    correlationAdjusted: false,
    familyBreakdown: [],
    highConvictionAgents: [],
    dissentingAgents: [],
    signalQuality: 0,
    regimeAlignment: 0.5,
  };
}
