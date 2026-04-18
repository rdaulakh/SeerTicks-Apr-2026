/**
 * DecisionEvaluator — Quality Gate + Feedback Loop
 * 
 * Phase 30: The missing "evaluator layer" from the ThinkTank architecture.
 * 
 * Two responsibilities:
 * 1. PRE-EXECUTION GATE: Evaluates approved signals before they reach the trade executor.
 *    Checks for regime-signal alignment, family consensus quality, dissent warnings,
 *    and recent performance of the contributing agents.
 * 
 * 2. POST-EXECUTION FEEDBACK: When positions close, records outcomes back to
 *    AgentWeightManager (which was never wired up — the feedback loop was broken).
 *    This enables adaptive weight adjustment based on actual trade results.
 */

import { EventEmitter } from 'events';
import type { AggregatedSignal } from './SignalAggregator';
import type { AgentSignal } from '../agents/AgentBase';

export interface EvaluationResult {
  approved: boolean;
  score: number;           // 0-1, overall decision quality score
  reasons: string[];       // Why approved or rejected
  warnings: string[];      // Non-blocking concerns
  adjustments: {
    positionSizeMultiplier: number;  // 0.5-1.5, adjust position size based on quality
    confidenceAdjustment: number;    // -0.2 to +0.1, adjust reported confidence
  };
}

interface TradeRecord {
  symbol: string;
  direction: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  consensus: AggregatedSignal;
  agentSignals: Array<{ agentName: string; signal: string; confidence: number }>;
  regime: string;
  evaluationScore: number;
  signalId?: string;
}

interface PerformanceWindow {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  winRate: number;
  profitFactor: number;
  lastUpdated: number;
}

/**
 * DecisionEvaluator — the quality gate and feedback loop.
 */
export class DecisionEvaluator extends EventEmitter {
  private pendingTrades: Map<string, TradeRecord> = new Map(); // symbol -> trade record
  private performanceWindow: PerformanceWindow;
  private recentDecisions: Array<{ score: number; outcome?: 'win' | 'loss'; timestamp: number }> = [];
  private readonly MAX_RECENT_DECISIONS = 100;
  
  // Configurable thresholds
  private readonly MIN_QUALITY_SCORE = 0.35;         // Minimum score to approve
  private readonly HIGH_QUALITY_THRESHOLD = 0.70;     // Score for full position size
  private readonly REGIME_ALIGNMENT_WEIGHT = 0.25;    // How much regime alignment matters
  private readonly FAMILY_CONSENSUS_WEIGHT = 0.25;    // How much family agreement matters
  private readonly SIGNAL_QUALITY_WEIGHT = 0.20;      // How much signal quality matters
  private readonly RECENT_PERFORMANCE_WEIGHT = 0.15;  // How much recent performance matters
  private readonly DISSENT_WEIGHT = 0.15;             // How much dissent analysis matters

  constructor() {
    super();
    this.performanceWindow = this.createEmptyWindow();
  }

  /**
   * PRE-EXECUTION GATE
   * Evaluates an approved signal before it reaches the trade executor.
   * Returns an EvaluationResult with approval decision and adjustments.
   */
  evaluate(
    consensus: AggregatedSignal,
    signals: AgentSignal[],
    symbol: string,
    marketContext?: any
  ): EvaluationResult {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 0;

    // ========================================
    // Factor 1: Regime Alignment (25%)
    // ========================================
    const regimeScore = this.evaluateRegimeAlignment(consensus, marketContext);
    score += regimeScore * this.REGIME_ALIGNMENT_WEIGHT;
    
    if (regimeScore < 0.3) {
      warnings.push(`Low regime alignment (${(regimeScore * 100).toFixed(0)}%) — signal conflicts with detected market regime`);
    }
    if (regimeScore > 0.7) {
      reasons.push(`Strong regime alignment (${(regimeScore * 100).toFixed(0)}%)`);
    }

    // ========================================
    // Factor 2: Family Consensus Quality (25%)
    // ========================================
    const familyScore = this.evaluateFamilyConsensus(consensus);
    score += familyScore * this.FAMILY_CONSENSUS_WEIGHT;

    if (familyScore < 0.3) {
      warnings.push(`Weak family consensus (${(familyScore * 100).toFixed(0)}%) — few agent families agree`);
    }
    if (familyScore > 0.7) {
      reasons.push(`Strong multi-family agreement (${(familyScore * 100).toFixed(0)}%)`);
    }

    // ========================================
    // Factor 3: Signal Quality (20%)
    // ========================================
    const qualityScore = consensus.signalQuality || 0.5;
    score += qualityScore * this.SIGNAL_QUALITY_WEIGHT;

    if (qualityScore < 0.3) {
      warnings.push(`Low signal quality (${(qualityScore * 100).toFixed(0)}%) — stale or low-confidence data`);
    }

    // ========================================
    // Factor 4: Recent Performance (15%)
    // ========================================
    const perfScore = this.evaluateRecentPerformance();
    score += perfScore * this.RECENT_PERFORMANCE_WEIGHT;

    if (perfScore < 0.3) {
      warnings.push(`Poor recent performance (win rate: ${(this.performanceWindow.winRate * 100).toFixed(0)}%) — reducing position size`);
    }

    // ========================================
    // Factor 5: Dissent Analysis (15%)
    // ========================================
    const dissentScore = this.evaluateDissent(consensus);
    score += dissentScore * this.DISSENT_WEIGHT;

    if (dissentScore < 0.3) {
      warnings.push(`Significant dissent from ${consensus.dissentingAgents?.length || 0} agents — proceed with caution`);
    }

    // ========================================
    // High Conviction Bonus
    // ========================================
    if (consensus.highConvictionAgents && consensus.highConvictionAgents.length >= 2) {
      const bonus = Math.min(0.08, consensus.highConvictionAgents.length * 0.025);
      score = Math.min(1.0, score + bonus);
      reasons.push(`${consensus.highConvictionAgents.length} agents showing high conviction: ${consensus.highConvictionAgents.join(', ')}`);
    }

    // ========================================
    // Decision
    // ========================================
    const approved = score >= this.MIN_QUALITY_SCORE && consensus.strength > 0;

    if (approved) {
      reasons.push(`Decision quality score: ${(score * 100).toFixed(1)}% (threshold: ${(this.MIN_QUALITY_SCORE * 100).toFixed(0)}%)`);
    } else {
      reasons.push(`Decision quality too low: ${(score * 100).toFixed(1)}% < ${(this.MIN_QUALITY_SCORE * 100).toFixed(0)}% threshold`);
    }

    // ========================================
    // Position Size Adjustment
    // ========================================
    let positionSizeMultiplier = 1.0;
    
    if (score >= this.HIGH_QUALITY_THRESHOLD) {
      // High quality — allow full or slightly boosted position
      positionSizeMultiplier = 1.0 + (score - this.HIGH_QUALITY_THRESHOLD) * 0.5;
      positionSizeMultiplier = Math.min(1.3, positionSizeMultiplier);
    } else if (score >= this.MIN_QUALITY_SCORE) {
      // Acceptable quality — scale position size linearly
      const range = this.HIGH_QUALITY_THRESHOLD - this.MIN_QUALITY_SCORE;
      positionSizeMultiplier = 0.5 + ((score - this.MIN_QUALITY_SCORE) / range) * 0.5;
    } else {
      positionSizeMultiplier = 0; // Rejected
    }

    // Recent drawdown penalty
    if (this.performanceWindow.totalPnl < 0 && this.performanceWindow.totalTrades >= 5) {
      positionSizeMultiplier *= Math.max(0.5, 1.0 - Math.abs(this.performanceWindow.totalPnl) * 0.001);
    }

    // Confidence adjustment based on evaluation
    const confidenceAdjustment = (score - 0.5) * 0.2; // -0.1 to +0.1

    // Record this decision
    this.recentDecisions.push({ score, timestamp: Date.now() });
    if (this.recentDecisions.length > this.MAX_RECENT_DECISIONS) {
      this.recentDecisions.shift();
    }

    return {
      approved,
      score,
      reasons,
      warnings,
      adjustments: {
        positionSizeMultiplier: Math.max(0, Math.min(1.5, positionSizeMultiplier)),
        confidenceAdjustment: Math.max(-0.2, Math.min(0.1, confidenceAdjustment)),
      },
    };
  }

  /**
   * Record a trade entry for later outcome tracking.
   * Called when a trade is actually executed.
   */
  recordTradeEntry(
    symbol: string,
    direction: 'long' | 'short',
    entryPrice: number,
    consensus: AggregatedSignal,
    agentSignals: AgentSignal[],
    regime: string,
    evaluationScore: number,
    signalId?: string
  ): void {
    this.pendingTrades.set(symbol, {
      symbol,
      direction,
      entryTime: Date.now(),
      entryPrice,
      consensus,
      agentSignals: agentSignals.map(s => ({
        agentName: s.agentName,
        signal: s.signal,
        confidence: s.confidence,
      })),
      regime,
      evaluationScore,
      signalId,
    });
  }

  /**
   * POST-EXECUTION FEEDBACK
   * Called when a position closes. Records the outcome and feeds it back
   * to AgentWeightManager for adaptive weight adjustment.
   */
  async recordTradeOutcome(
    symbol: string,
    pnl: number,
    exitPrice: number,
    exitReason: string
  ): Promise<void> {
    const trade = this.pendingTrades.get(symbol);
    if (!trade) {
      // No pending trade for this symbol — might be a manual close
      return;
    }

    this.pendingTrades.delete(symbol);

    const wasProfit = pnl > 0;
    const outcome: 'win' | 'loss' = wasProfit ? 'win' : 'loss';

    // Update performance window
    this.performanceWindow.totalTrades++;
    if (wasProfit) {
      this.performanceWindow.winningTrades++;
      this.performanceWindow.avgWin = (this.performanceWindow.avgWin * (this.performanceWindow.winningTrades - 1) + pnl) / this.performanceWindow.winningTrades;
    } else {
      this.performanceWindow.losingTrades++;
      this.performanceWindow.avgLoss = (this.performanceWindow.avgLoss * (this.performanceWindow.losingTrades - 1) + Math.abs(pnl)) / this.performanceWindow.losingTrades;
    }
    this.performanceWindow.totalPnl += pnl;
    this.performanceWindow.winRate = this.performanceWindow.totalTrades > 0
      ? this.performanceWindow.winningTrades / this.performanceWindow.totalTrades
      : 0.5;
    this.performanceWindow.profitFactor = this.performanceWindow.avgLoss > 0
      ? (this.performanceWindow.avgWin * this.performanceWindow.winningTrades) / (this.performanceWindow.avgLoss * this.performanceWindow.losingTrades)
      : 1.0;
    this.performanceWindow.lastUpdated = Date.now();

    // Update recent decisions with outcome
    const recentDecision = this.recentDecisions.find(d => !d.outcome && d.timestamp >= trade.entryTime - 5000);
    if (recentDecision) {
      recentDecision.outcome = outcome;
    }

    // CRITICAL: Feed outcome back to AgentWeightManager
    // This was the MISSING feedback loop — agents never learned from their mistakes
    try {
      const { getAgentWeightManager } = await import('./AgentWeightManager');
      const weightManager = getAgentWeightManager();
      
      weightManager.recordTradeOutcome(
        trade.agentSignals.map(s => ({
          agentName: s.agentName,
          signal: s.signal as 'bullish' | 'bearish' | 'neutral',
          confidence: s.confidence,
        })),
        trade.direction,
        wasProfit,
        pnl // Pass actual PnL for cost-aware evaluation
      );
    } catch (err) {
      console.warn('[DecisionEvaluator] Failed to record outcome to AgentWeightManager:', (err as Error)?.message);
    }

    // Emit outcome event for monitoring
    this.emit('trade_outcome', {
      symbol,
      direction: trade.direction,
      pnl,
      exitPrice,
      exitReason,
      entryPrice: trade.entryPrice,
      holdTime: Date.now() - trade.entryTime,
      regime: trade.regime,
      evaluationScore: trade.evaluationScore,
      agentSignals: trade.agentSignals,
      outcome,
    });

    // Log for debugging
    console.log(`[DecisionEvaluator] Trade outcome: ${symbol} ${trade.direction} → ${outcome} ($${pnl.toFixed(2)}) | Eval score: ${(trade.evaluationScore * 100).toFixed(0)}% | Regime: ${trade.regime} | Exit: ${exitReason}`);
  }

  /**
   * Get current performance metrics.
   */
  getPerformanceMetrics(): PerformanceWindow & { avgDecisionScore: number; recentDecisionCount: number } {
    const avgScore = this.recentDecisions.length > 0
      ? this.recentDecisions.reduce((sum, d) => sum + d.score, 0) / this.recentDecisions.length
      : 0.5;

    return {
      ...this.performanceWindow,
      avgDecisionScore: avgScore,
      recentDecisionCount: this.recentDecisions.length,
    };
  }

  /**
   * Get pending trade count (positions waiting for outcome).
   */
  getPendingTradeCount(): number {
    return this.pendingTrades.size;
  }

  // ========================================
  // Private evaluation methods
  // ========================================

  private evaluateRegimeAlignment(consensus: AggregatedSignal, marketContext?: any): number {
    if (!marketContext?.regime || !consensus.regimeAlignment) {
      return 0.5; // No regime data — neutral score
    }

    return consensus.regimeAlignment;
  }

  private evaluateFamilyConsensus(consensus: AggregatedSignal): number {
    if (!consensus.familyBreakdown || consensus.familyBreakdown.length === 0) {
      return 0.5; // No family data — neutral score
    }

    const families = consensus.familyBreakdown;
    const directionalFamilies = families.filter(f => f.direction !== 'neutral');
    
    if (directionalFamilies.length === 0) return 0.2;

    // Count how many families agree with the consensus direction
    const agreeingFamilies = directionalFamilies.filter(f => f.direction === consensus.direction);
    const agreementRatio = agreeingFamilies.length / directionalFamilies.length;

    // Also factor in internal family agreement
    const avgInternalAgreement = families.reduce((sum, f) => sum + f.agreement, 0) / families.length;

    // Combined: 60% cross-family agreement + 40% internal agreement
    return agreementRatio * 0.6 + avgInternalAgreement * 0.4;
  }

  private evaluateRecentPerformance(): number {
    if (this.performanceWindow.totalTrades < 3) {
      return 0.5; // Not enough data — neutral score
    }

    // Win rate contribution (0-1)
    const winRateScore = this.performanceWindow.winRate;

    // Profit factor contribution (capped at 2.0 for scoring)
    const pfScore = Math.min(1.0, this.performanceWindow.profitFactor / 2.0);

    // Recent streak detection
    const recentOutcomes = this.recentDecisions
      .filter(d => d.outcome)
      .slice(-10);
    
    let streakScore = 0.5;
    if (recentOutcomes.length >= 3) {
      const recentWins = recentOutcomes.filter(d => d.outcome === 'win').length;
      streakScore = recentWins / recentOutcomes.length;
    }

    // Combined: 40% win rate + 30% profit factor + 30% recent streak
    return winRateScore * 0.4 + pfScore * 0.3 + streakScore * 0.3;
  }

  private evaluateDissent(consensus: AggregatedSignal): number {
    if (!consensus.dissentingAgents || consensus.dissentingAgents.length === 0) {
      return 1.0; // No dissent — perfect score
    }

    const dissentCount = consensus.dissentingAgents.length;
    const totalAgents = (consensus.familyBreakdown || []).reduce((sum, f) => sum + f.agents.length, 0) || 14;

    // Dissent ratio (0 = no dissent, 1 = all dissent)
    const dissentRatio = dissentCount / totalAgents;

    // High confidence dissent is more concerning
    const avgDissentConfidence = consensus.dissentingAgents.reduce((sum, d) => sum + d.confidence, 0) / dissentCount;
    const confidencePenalty = avgDissentConfidence > 0.7 ? 0.15 : 0;

    // Score: 1.0 (no dissent) → 0.0 (heavy dissent)
    return Math.max(0, 1.0 - dissentRatio * 2.0 - confidencePenalty);
  }

  /**
   * Get metrics for the dashboard.
   */
  getMetrics() {
    const total = this.recentDecisions.length;
    const approved = this.recentDecisions.filter(d => d.score >= this.MIN_QUALITY_SCORE).length;
    const rejected = total - approved;
    return {
      totalEvaluated: total,
      totalApproved: approved,
      totalRejected: rejected,
      approvalRate: total > 0 ? (approved / total) * 100 : 0,
      avgScore: total > 0 ? this.recentDecisions.reduce((s, d) => s + d.score, 0) / total : 0,
      recentDecisions: this.recentDecisions.slice(-20).reverse().map(d => ({
        symbol: 'signal',
        approved: d.score >= this.MIN_QUALITY_SCORE,
        score: d.score,
        timestamp: d.timestamp,
      })),
      performance: this.performanceWindow,
    };
  }

  private createEmptyWindow(): PerformanceWindow {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      winRate: 0.5,
      profitFactor: 1.0,
      lastUpdated: Date.now(),
    };
  }
}

// Singleton per user
const evaluators = new Map<number, DecisionEvaluator>();

export function getDecisionEvaluator(userId?: number): DecisionEvaluator {
  const id = userId || 0;
  if (!evaluators.has(id)) {
    evaluators.set(id, new DecisionEvaluator());
  }
  return evaluators.get(id)!;
}
