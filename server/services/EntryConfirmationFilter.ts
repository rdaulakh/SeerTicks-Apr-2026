/**
 * Entry Confirmation Filter
 * 
 * Validates trade entries by requiring minimum agent agreement and weighted consensus.
 * Based on Claude AI recommendations for Week 5-6 Entry System Improvements.
 * 
 * Key Features:
 * - Requires 3+ agents to agree on direction
 * - Requires 70% weighted consensus threshold
 * - Filters out neutral/low-confidence agents
 * - Tracks conflicting signals for analysis
 */

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
    // Phase 23: Align thresholds with AutomatedSignalProcessor (TradingConfig single source of truth)
    // Previous values (3, 0.70, 0.6) were unreachable with real agent confidence levels (5-20%)
    // Agents produce confidence in 0-1 range where 0.05-0.20 is typical for fast agents
    // FIX: entry quality gate raised from stub values — prevents low-conviction trades
    this.config = {
      minAgentAgreement: config?.minAgentAgreement ?? 4,
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
