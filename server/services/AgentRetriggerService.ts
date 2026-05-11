/**
 * AgentRetriggerService — Phase 35: Agent Re-trigger on Rejection
 * 
 * When DecisionEvaluator rejects a signal, this service:
 * 1. Analyzes the rejection reasons to identify weak factors
 * 2. Generates refined questions targeting those weaknesses
 * 3. Re-runs the most relevant agents with the refined context
 * 4. Re-evaluates the updated signal set
 * 
 * This creates a "second opinion" loop that can recover valid trades
 * that were initially rejected due to incomplete analysis.
 * 
 * Constraints:
 * - Maximum 1 re-trigger per symbol per rejection (no infinite loops)
 * - Only re-runs 2-3 most relevant agents (not all 14)
 * - Total re-trigger budget: 5 seconds max
 * - Tracks re-trigger success rate for monitoring
 */

import type { AgentSignal } from '../agents/AgentBase';
import { getActiveClock } from '../_core/clock';
import type { AggregatedSignal } from './SignalAggregator';
import type { EvaluationResult } from './DecisionEvaluator';

export interface RetriggerResult {
  retriggered: boolean;
  agentsRerun: string[];
  refinedQuestions: Record<string, string[]>;
  updatedSignals: AgentSignal[];
  reEvaluation: EvaluationResult | null;
  reason: string;
  durationMs: number;
}

interface RetriggerStats {
  totalRejections: number;
  totalRetriggers: number;
  successfulRetriggers: number;  // Re-evaluation approved after re-trigger
  failedRetriggers: number;      // Re-evaluation still rejected
  skippedRetriggers: number;     // Score too low to bother
  avgRetriggerDurationMs: number;
  lastRetriggerTime: number;
}

/**
 * Maps rejection factors to the agents most capable of providing additional clarity.
 */
const FACTOR_TO_AGENTS: Record<string, string[]> = {
  regime_alignment: ['TechnicalAnalyst', 'MacroAnalyst'],
  family_consensus: ['SentimentAnalyst', 'OrderFlowAnalyst', 'TechnicalAnalyst'],
  signal_quality: ['TechnicalAnalyst', 'PatternMatcher'],
  recent_performance: ['MacroAnalyst', 'SentimentAnalyst'],
  dissent: ['SentimentAnalyst', 'OrderFlowAnalyst'],
};

/**
 * Generates refined questions based on the weak factor.
 */
function generateRefinedQuestions(
  weakFactor: string,
  symbol: string,
  direction: string,
  regime: string
): Record<string, string[]> {
  const questions: Record<string, string[]> = {};

  switch (weakFactor) {
    case 'regime_alignment':
      questions['TechnicalAnalyst'] = [
        `Is the ${direction} signal for ${symbol} truly misaligned with the ${regime} regime, or is there a regime transition underway?`,
        `What specific technical evidence supports or contradicts a ${direction} position in the current ${regime} environment?`,
      ];
      questions['MacroAnalyst'] = [
        `Are macro conditions shifting in a way that could support ${direction} despite the ${regime} regime classification?`,
      ];
      break;

    case 'family_consensus':
      questions['SentimentAnalyst'] = [
        `What is the current sentiment balance for ${symbol}? Are there hidden bullish/bearish signals that other agents might be missing?`,
      ];
      questions['OrderFlowAnalyst'] = [
        `Does the order flow for ${symbol} show institutional accumulation or distribution that could tip the consensus ${direction}?`,
      ];
      questions['TechnicalAnalyst'] = [
        `Are there any technical patterns forming for ${symbol} that strongly support the ${direction} thesis despite mixed consensus?`,
      ];
      break;

    case 'signal_quality':
      questions['TechnicalAnalyst'] = [
        `Re-analyze ${symbol} with focus on data freshness — are the key indicators (RSI, MACD, volume) based on the latest candles?`,
        `What is the current ATR and how does it compare to the 14-period average? Is volatility expanding or contracting?`,
      ];
      questions['PatternMatcher'] = [
        `Are there any newly forming patterns for ${symbol} in the last 30 minutes that weren't captured in the initial scan?`,
      ];
      break;

    case 'recent_performance':
      questions['MacroAnalyst'] = [
        `Have macro conditions changed since the recent losing streak? Is the current setup fundamentally different from recent losses?`,
      ];
      questions['SentimentAnalyst'] = [
        `Has market sentiment for ${symbol} shifted recently in a way that makes this ${direction} setup different from recent failed trades?`,
      ];
      break;

    case 'dissent':
      questions['SentimentAnalyst'] = [
        `What specific concerns are driving bearish/contrarian sentiment for ${symbol}? Are these concerns based on current data or stale information?`,
      ];
      questions['OrderFlowAnalyst'] = [
        `Is the order flow dissent for ${symbol} based on actual large sell/buy orders, or is it noise from small retail activity?`,
      ];
      break;

    default:
      // Generic refinement
      questions['TechnicalAnalyst'] = [
        `Re-analyze ${symbol} with fresh data — has anything changed in the last 2 minutes that could affect the ${direction} thesis?`,
      ];
      break;
  }

  return questions;
}

/**
 * Identifies the weakest evaluation factor from the rejection.
 */
function identifyWeakestFactor(evaluation: EvaluationResult): string {
  // Parse warnings and reasons to identify the weakest factor
  const allMessages = [...evaluation.warnings, ...evaluation.reasons].join(' ').toLowerCase();

  if (allMessages.includes('regime alignment') || allMessages.includes('regime')) {
    return 'regime_alignment';
  }
  if (allMessages.includes('family consensus') || allMessages.includes('family')) {
    return 'family_consensus';
  }
  if (allMessages.includes('signal quality') || allMessages.includes('stale')) {
    return 'signal_quality';
  }
  if (allMessages.includes('recent performance') || allMessages.includes('win rate')) {
    return 'recent_performance';
  }
  if (allMessages.includes('dissent') || allMessages.includes('dissenting')) {
    return 'dissent';
  }

  // Default: signal quality (most common recoverable issue)
  return 'signal_quality';
}

export class AgentRetriggerService {
  private stats: RetriggerStats = {
    totalRejections: 0,
    totalRetriggers: 0,
    successfulRetriggers: 0,
    failedRetriggers: 0,
    skippedRetriggers: 0,
    avgRetriggerDurationMs: 0,
    lastRetriggerTime: 0,
  };

  // Prevent re-trigger storms: track recent re-triggers per symbol
  private recentRetriggers: Map<string, number> = new Map(); // symbol -> timestamp
  private readonly RETRIGGER_COOLDOWN_MS = 30_000; // 30s cooldown per symbol
  private readonly RETRIGGER_TIMEOUT_MS = 5_000;   // 5s max for re-trigger
  private readonly MIN_SCORE_FOR_RETRIGGER = 0.20;  // Don't re-trigger if score is abysmal
  private readonly MAX_SCORE_FOR_RETRIGGER = 0.34;  // Don't re-trigger if score is close to threshold (would pass anyway)

  /**
   * Attempt to re-trigger agents after a DecisionEvaluator rejection.
   * 
   * @param symbol Trading symbol
   * @param originalSignals The original agent signals that were rejected
   * @param consensus The original aggregated consensus
   * @param evaluation The DecisionEvaluator result that rejected the signal
   * @param marketContext Current market context (regime, etc.)
   * @param userId User ID for the evaluator
   * @returns RetriggerResult with updated signals and re-evaluation
   */
  async attemptRetrigger(
    symbol: string,
    originalSignals: AgentSignal[],
    consensus: AggregatedSignal,
    evaluation: EvaluationResult,
    marketContext: any,
    userId: number
  ): Promise<RetriggerResult> {
    const startMs = getActiveClock().now();
    this.stats.totalRejections++;

    // Guard 1: Score too low — not worth re-triggering
    if (evaluation.score < this.MIN_SCORE_FOR_RETRIGGER) {
      this.stats.skippedRetriggers++;
      return {
        retriggered: false,
        agentsRerun: [],
        refinedQuestions: {},
        updatedSignals: originalSignals,
        reEvaluation: null,
        reason: `Score too low for re-trigger (${(evaluation.score * 100).toFixed(1)}% < ${(this.MIN_SCORE_FOR_RETRIGGER * 100).toFixed(0)}%)`,
        durationMs: getActiveClock().now() - startMs,
      };
    }

    // Guard 2: Score too close to threshold — marginal, let it go
    if (evaluation.score > this.MAX_SCORE_FOR_RETRIGGER) {
      this.stats.skippedRetriggers++;
      return {
        retriggered: false,
        agentsRerun: [],
        refinedQuestions: {},
        updatedSignals: originalSignals,
        reEvaluation: null,
        reason: `Score too close to threshold for re-trigger (${(evaluation.score * 100).toFixed(1)}% > ${(this.MAX_SCORE_FOR_RETRIGGER * 100).toFixed(0)}%)`,
        durationMs: getActiveClock().now() - startMs,
      };
    }

    // Guard 3: Cooldown — prevent re-trigger storms
    const lastRetrigger = this.recentRetriggers.get(symbol) || 0;
    if (getActiveClock().now() - lastRetrigger < this.RETRIGGER_COOLDOWN_MS) {
      this.stats.skippedRetriggers++;
      return {
        retriggered: false,
        agentsRerun: [],
        refinedQuestions: {},
        updatedSignals: originalSignals,
        reEvaluation: null,
        reason: `Re-trigger cooldown active for ${symbol} (${((this.RETRIGGER_COOLDOWN_MS - (getActiveClock().now() - lastRetrigger)) / 1000).toFixed(0)}s remaining)`,
        durationMs: getActiveClock().now() - startMs,
      };
    }

    // Identify the weakest factor and determine which agents to re-run
    const weakFactor = identifyWeakestFactor(evaluation);
    const direction = consensus.direction || 'bullish';
    const regime = marketContext?.regime || 'range_bound';
    const refinedQuestions = generateRefinedQuestions(weakFactor, symbol, direction, regime);

    // Get the agent names to re-run (max 3)
    const agentsToRerun = (FACTOR_TO_AGENTS[weakFactor] || ['TechnicalAnalyst']).slice(0, 3);

    console.log(`[AgentRetriggerService] Re-triggering ${agentsToRerun.join(', ')} for ${symbol} | Weak factor: ${weakFactor} | Score: ${(evaluation.score * 100).toFixed(1)}%`);

    this.stats.totalRetriggers++;
    this.recentRetriggers.set(symbol, getActiveClock().now());

    try {
      // Re-run agents with refined context (with timeout)
      const { getAgentManager } = await import('../agents/AgentBase');
      const agentManager = getAgentManager();

      // Build enriched context with refined questions
      const enrichedContext = {
        ...marketContext,
        retriggerMode: true,
        retriggerReason: weakFactor,
        retriggerQuestions: refinedQuestions,
        // Override agentGuidance with refined questions
        agentGuidance: {
          ...(marketContext?.agentGuidance || {}),
          ...Object.fromEntries(
            Object.entries(refinedQuestions).map(([agentName, questions]) => [
              agentName,
              {
                focus: `RE-ANALYSIS: Address rejection factor "${weakFactor}" with refined analysis`,
                questions,
                priority: 'critical',
                weightMultiplier: 1.2,
              },
            ])
          ),
        },
      };

      // Re-run selected agents with timeout
      const rerunSignals = await Promise.race([
        agentManager.getSignalsFromAgents(symbol, agentsToRerun, enrichedContext),
        new Promise<AgentSignal[]>((_, reject) =>
          setTimeout(() => reject(new Error('Re-trigger timeout')), this.RETRIGGER_TIMEOUT_MS)
        ),
      ]);

      // Merge: replace original signals from re-run agents with new ones
      const rerunAgentNames = new Set(rerunSignals.map(s => s.agentName));
      const mergedSignals = [
        ...originalSignals.filter(s => !rerunAgentNames.has(s.agentName)),
        ...rerunSignals,
      ];

      // Re-evaluate with merged signals
      const { getDecisionEvaluator } = await import('./DecisionEvaluator');
      const evaluator = getDecisionEvaluator(userId);
      const { aggregateSignals } = await import('./SignalAggregator');
      const { getAgentWeightManager } = await import('./AgentWeightManager');
      const weights = getAgentWeightManager(userId).getConsensusWeights();

      const newConsensus = aggregateSignals(
        mergedSignals.filter(s => s.signal !== 'neutral'),
        weights,
        marketContext
      );

      const reEvaluation = evaluator.evaluate(
        newConsensus,
        mergedSignals,
        symbol,
        marketContext
      );

      const durationMs = getActiveClock().now() - startMs;

      if (reEvaluation.approved) {
        this.stats.successfulRetriggers++;
        console.log(`[AgentRetriggerService] ✅ Re-trigger SUCCESS for ${symbol} | New score: ${(reEvaluation.score * 100).toFixed(1)}% | Duration: ${durationMs}ms`);
      } else {
        this.stats.failedRetriggers++;
        console.log(`[AgentRetriggerService] ❌ Re-trigger FAILED for ${symbol} | New score: ${(reEvaluation.score * 100).toFixed(1)}% (still below threshold) | Duration: ${durationMs}ms`);
      }

      // Update average duration
      const totalRetriggers = this.stats.successfulRetriggers + this.stats.failedRetriggers;
      this.stats.avgRetriggerDurationMs = (this.stats.avgRetriggerDurationMs * (totalRetriggers - 1) + durationMs) / totalRetriggers;
      this.stats.lastRetriggerTime = getActiveClock().now();

      return {
        retriggered: true,
        agentsRerun: agentsToRerun,
        refinedQuestions,
        updatedSignals: mergedSignals,
        reEvaluation,
        reason: reEvaluation.approved
          ? `Re-trigger recovered signal (${weakFactor} addressed)`
          : `Re-trigger failed to recover (${weakFactor} still weak)`,
        durationMs,
      };
    } catch (err) {
      this.stats.failedRetriggers++;
      const durationMs = getActiveClock().now() - startMs;
      console.warn(`[AgentRetriggerService] Re-trigger error for ${symbol}:`, (err as Error)?.message);

      return {
        retriggered: false,
        agentsRerun: agentsToRerun,
        refinedQuestions,
        updatedSignals: originalSignals,
        reEvaluation: null,
        reason: `Re-trigger error: ${(err as Error)?.message}`,
        durationMs,
      };
    }
  }

  /**
   * Get re-trigger statistics for monitoring.
   */
  getStats(): RetriggerStats & { successRate: number } {
    const total = this.stats.successfulRetriggers + this.stats.failedRetriggers;
    return {
      ...this.stats,
      successRate: total > 0 ? this.stats.successfulRetriggers / total : 0,
    };
  }

  /**
   * Reset statistics (for testing).
   */
  resetStats(): void {
    this.stats = {
      totalRejections: 0,
      totalRetriggers: 0,
      successfulRetriggers: 0,
      failedRetriggers: 0,
      skippedRetriggers: 0,
      avgRetriggerDurationMs: 0,
      lastRetriggerTime: 0,
    };
    this.recentRetriggers.clear();
  }
}

// Singleton
let retriggerService: AgentRetriggerService | null = null;

export function getAgentRetriggerService(): AgentRetriggerService {
  if (!retriggerService) {
    retriggerService = new AgentRetriggerService();
  }
  return retriggerService;
}
