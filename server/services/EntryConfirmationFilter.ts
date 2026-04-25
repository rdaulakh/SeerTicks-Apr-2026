/**
 * Entry Confirmation Filter
 *
 * Validates trade entries by requiring minimum agent agreement and weighted consensus.
 * Based on Claude AI recommendations for Week 5-6 Entry System Improvements.
 *
 * Phase 19 — Aligned defaults with `TradingConfig.consensus` so this filter
 * stops contradicting the upstream `AutomatedSignalProcessor` gate. Pre-
 * Phase-19, the upstream gate let signals through at ≥2 eligible agents
 * AND consensus.strength ≥ 0.65, but THIS filter then rejected them with
 * "Insufficient agent agreement: 2/4 required" — turning every approved
 * signal into a TRADE_REJECTED event. The mismatched threshold (4 here vs
 * 2-3 upstream) silently killed 100% of trades after Phase 18 unblocked
 * agent confidence. Verified in prod logs over 30 min: 104 SIGNAL_APPROVED
 * → 0 TRADE_EXECUTED, every single one rejected here.
 *
 * Key features (post-Phase-19):
 * - Default `minAgentAgreement` = `TradingConfig.consensus.minAgentAgreement`
 *   (currently 3) — single source of truth, no more silent drift
 * - Default `weightedThreshold` and `minConfidenceScore` stay loose enough
 *   that real agent confidences (post-Phase-17/18) clear the bar
 * - Caller can still override per-instance if a stricter sub-strategy needs it
 */
import { getTradingConfig } from '../config/TradingConfig';

export interface AgentSignal {
  agentName: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number; // 0-1
  weight: number; // Agent weight in consensus
  executionScore?: number;
}

export interface EntryConfirmationConfig {
  minAgentAgreement: number; // Minimum agents that must agree (default: 3)
  weightedThreshold: number; // Minimum weighted consensus (default: 0.70)
  minConfidenceScore: number; // Minimum confidence to count agent (default: 0.6)
  excludeNeutralAgents: boolean; // Whether to exclude neutral signals (default: true)
}

export interface EntryValidation {
  isValid: boolean;
  direction: 'LONG' | 'SHORT' | null;
  confidence: number;
  agentAgreement: number;
  conflictingAgents: number;
  weightedScore: number;
  reasons: string[];
  breakdown: {
    bullishAgents: string[];
    bearishAgents: string[];
    neutralAgents: string[];
  };
}

export class EntryConfirmationFilter {
  private config: EntryConfirmationConfig;

  constructor(config?: Partial<EntryConfirmationConfig>) {
    // Phase 19 — defaults pulled from TradingConfig.consensus so this gate
    // can't silently drift away from the upstream AutomatedSignalProcessor
    // again. The hardcoded `4` was strictly tighter than the central config
    // value (3) and tighter than the upstream `≥2 eligible` filter — every
    // signal approved upstream got killed here. After Phase 17/18 unblocked
    // agent confidence, that mismatch became the sole reason 0 trades fired
    // despite 104 SIGNAL_APPROVED events in 30 min.
    //
    // Caller override still wins (some sub-strategies may want stricter
    // gates) — but the default tracks the single source of truth.
    const consensusDefaults = getTradingConfig().consensus;
    this.config = {
      minAgentAgreement: config?.minAgentAgreement ?? consensusDefaults.minAgentAgreement,
      weightedThreshold: config?.weightedThreshold ?? 0.08,
      minConfidenceScore: config?.minConfidenceScore ?? 0.08,
      excludeNeutralAgents: config?.excludeNeutralAgents ?? true,
    };
  }

  /**
   * Validate entry based on agent signals
   */
  validateEntry(signals: AgentSignal[]): EntryValidation {
    const reasons: string[] = [];
    
    // Filter out low-confidence and neutral agents if configured
    const activeSignals = signals.filter(s => {
      if (s.confidence < this.config.minConfidenceScore) {
        return false;
      }
      if (this.config.excludeNeutralAgents && s.direction === 'NEUTRAL') {
        return false;
      }
      return true;
    });

    // Categorize agents by direction
    const bullishAgents = activeSignals.filter(s => s.direction === 'LONG');
    const bearishAgents = activeSignals.filter(s => s.direction === 'SHORT');
    const neutralAgents = signals.filter(s => s.direction === 'NEUTRAL' || s.confidence < this.config.minConfidenceScore);

    const bullishCount = bullishAgents.length;
    const bearishCount = bearishAgents.length;

    // Calculate weighted consensus score
    const totalWeight = activeSignals.reduce((sum, s) => sum + s.weight, 0);
    
    let weightedScore = 0;
    if (totalWeight > 0) {
      weightedScore = activeSignals.reduce((sum, s) => {
        const directionMultiplier = s.direction === 'LONG' ? 1 : s.direction === 'SHORT' ? -1 : 0;
        return sum + (s.confidence * s.weight * directionMultiplier);
      }, 0) / totalWeight;
    }

    // Determine dominant direction
    const dominantDirection = weightedScore > 0 ? 'LONG' : weightedScore < 0 ? 'SHORT' : null;
    const dominantCount = dominantDirection === 'LONG' ? bullishCount : bearishCount;
    const conflictingCount = dominantDirection === 'LONG' ? bearishCount : bullishCount;

    // Validate entry conditions
    const hasMinAgentAgreement = dominantCount >= this.config.minAgentAgreement;
    const hasWeightedThreshold = Math.abs(weightedScore) >= this.config.weightedThreshold;

    if (!hasMinAgentAgreement) {
      reasons.push(`Insufficient agent agreement: ${dominantCount}/${this.config.minAgentAgreement} required`);
    }
    if (!hasWeightedThreshold) {
      reasons.push(`Weighted consensus too low: ${(Math.abs(weightedScore) * 100).toFixed(1)}% < ${(this.config.weightedThreshold * 100).toFixed(1)}% required`);
    }
    if (conflictingCount > 0) {
      reasons.push(`${conflictingCount} conflicting agent(s) detected`);
    }

    const isValid = hasMinAgentAgreement && hasWeightedThreshold;

    if (isValid) {
      reasons.push(`Entry confirmed: ${dominantCount} agents agree on ${dominantDirection} with ${(Math.abs(weightedScore) * 100).toFixed(1)}% weighted consensus`);
    }

    return {
      isValid,
      direction: isValid ? dominantDirection : null,
      confidence: Math.abs(weightedScore),
      agentAgreement: dominantCount,
      conflictingAgents: conflictingCount,
      weightedScore,
      reasons,
      breakdown: {
        bullishAgents: bullishAgents.map(a => a.agentName),
        bearishAgents: bearishAgents.map(a => a.agentName),
        neutralAgents: neutralAgents.map(a => a.agentName),
      },
    };
  }

  /**
   * Get configuration
   */
  getConfig(): EntryConfirmationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EntryConfirmationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default EntryConfirmationFilter;
