// Phase 22: Cached AuditLogger import (ESM-compatible)
let _auditLoggerCache: any = null;
async function _getAuditLoggerModule() {
  if (!_auditLoggerCache) _auditLoggerCache = await import("./AuditLogger");
  return _auditLoggerCache;
}

import { EventEmitter } from 'events';
import { appendFileSync } from 'fs';
import type { AgentSignal } from "../agents/AgentBase";
import { tradeDecisionLogger, TradeDecisionInput, AgentScore } from './tradeDecisionLogger';
import { getAgentWeightManager } from './AgentWeightManager';
import { tradingLogger } from '../utils/logger';
import { logPipelineEvent } from './TradingPipelineLogger';
import { recordConsensus } from '../utils/ConsensusRecorder';
import { getTradingConfig } from '../config/TradingConfig';
import { aggregateSignals, AggregatedSignal } from './SignalAggregator';
import { getSmoothedTradeCooldownMs, getSmoothedConsensusThresholdMultiplier } from './RegimeCalibration';
import { loadCandlesFromDatabase } from '../db/candleStorage';
import { priceFeedService } from './priceFeedService';

// Phase 7: ML quality gate stats tracking
let mlGateStats = {
  totalChecked: 0,
  modelAvailable: 0,
  positionReduced: 0,
  fullSizePassed: 0,
  normalPassed: 0,
  totalSuccessProbability: 0,
};

export function getMLGateStats() {
  return {
    ...mlGateStats,
    avgSuccessProbability: mlGateStats.modelAvailable > 0
      ? mlGateStats.totalSuccessProbability / mlGateStats.modelAvailable
      : 0,
  };
}

/**
 * Phase 22 — pure helper for the R:R pre-validation gate.
 *
 * Walks a sorted S/R level array (`resistance` ascending for bullish,
 * `support` descending for bearish — both encode "first is nearest") and
 * returns the reward distance to use for the R:R check.
 *
 * Selection rule:
 *   1. First level whose distance ≥ riskDistance × minRR — that level
 *      offers adequate upside, take it.
 *   2. If no level clears the bar, return the FURTHEST distance — the
 *      caller's R:R check then catches it ("no structural target gives
 *      adequate upside"), which is the legitimate reject case.
 *   3. If the array is empty/undefined, return `atrFallback` so the gate
 *      still has a sensible reward when the agent didn't supply S/R.
 *
 * Why this exists: pre-Phase-22 the inline logic blindly used `array[0]`
 * (nearest level), which on SOL@$169.50 with `resistance[0]=$170.15`
 * (recent local high, 65 cents away) crushed reward to $0.65 against
 * 2×ATR risk of $1.54 → R:R = 0.42, blocking valid breakout trades on
 * every symbol approaching local highs. The walk lets the gate "look
 * past" microstructure obstacles to the next meaningful level.
 *
 * Pure function — no I/O, no globals — exported for direct unit testing.
 */
export function selectRewardDistance(
  srArray: number[] | undefined,
  currentPrice: number,
  riskDistance: number,
  minRR: number,
  atrFallback: number,
): number {
  if (!srArray || srArray.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return atrFallback;
  }
  let furthest = 0;
  for (const level of srArray) {
    if (!Number.isFinite(level)) continue;
    const dist = Math.abs(level - currentPrice);
    if (dist > furthest) furthest = dist;
    if (dist >= riskDistance * minRR) return dist;
  }
  // No level cleared the bar — return furthest. Caller's R:R check will
  // reject if even this is insufficient. Use atrFallback if every level
  // was non-finite.
  return furthest > 0 ? furthest : atrFallback;
}

/**
 * Phase 22 — pure helper to choose the regime-aware minimum R:R.
 *
 * Three regimes:
 *   - Trending + calm:  superTrend agrees with consensus AND atrRatio < trendingMax → minRrTrending
 *   - High volatility:  atrRatio > volatileMin                                       → minRrVolatile
 *   - Counter-trend:    superTrend disagrees with consensus                          → minRrCounterTrend
 *   - Otherwise (default normal-vol same-direction without atrRatio data) →           minRrDefault
 *
 * The order matters: trending+calm beats volatile (low atrRatio precludes
 * volatile classification anyway, but the early return keeps logic clear),
 * and counter-trend overrides default. Pure function for testability.
 */
export function selectMinRr(
  consensusDirection: 'bullish' | 'bearish' | 'neutral',
  superTrendDirection: string | undefined,
  atrRatio: number,
  cfg: {
    minRrTrending: number;
    minRrVolatile: number;
    minRrCounterTrend: number;
    minRrDefault: number;
    atrRatioTrendingMax: number;
    atrRatioVolatileMin: number;
  },
): number {
  if (superTrendDirection === consensusDirection && atrRatio < cfg.atrRatioTrendingMax) {
    return cfg.minRrTrending;
  }
  if (atrRatio > cfg.atrRatioVolatileMin) {
    return cfg.minRrVolatile;
  }
  if (superTrendDirection && superTrendDirection !== consensusDirection) {
    return cfg.minRrCounterTrend;
  }
  return cfg.minRrDefault;
}

/**
 * Automated Signal Processor
 *
 * Continuously processes agent signals and queues high-confidence signals for automated execution.
 * NO manual approval required - this is institutional-grade autonomous trading.
 * 
 * Features:
 * - Real-time signal aggregation from all agents
 * - Multi-agent consensus calculation (weighted voting)
 * - Confidence filtering (minimum 60%)
 * - Execution score ranking
 * - Automatic signal queuing for trade execution
 * 
 * @fires signal_approved - When a signal passes all filters and is ready for execution
 * @fires signal_rejected - When a signal fails filters
 */
export class AutomatedSignalProcessor extends EventEmitter {
  private userId: number;
  // Phase 18: Defaults from TradingConfig (single source of truth)
  private minConfidence: number = getTradingConfig().consensus.minConfidence;
  private minExecutionScore: number = getTradingConfig().consensus.minExecutionScore;
  private consensusThreshold: number = getTradingConfig().consensus.minConsensusStrength;
  
  // Agent weights for consensus calculation — loaded from AgentWeightManager (single source of truth)
  private agentWeights: Record<string, number> = {};

  // Phase 19: Store listener ref for cleanup
  private weightsRecalcHandler: (() => void) | null = null;

  // Phase 19: Per-symbol processing state to prevent cross-symbol blocking
  private processingSymbols: Map<string, number> = new Map(); // symbol → timestamp
  private readonly PROCESSING_DEBOUNCE_MS = 100; // Process every 100ms max per symbol
  private readonly PROCESSING_TIMEOUT_MS = 30000; // Auto-reset stuck symbols after 30 seconds

  // Phase 33: Per-symbol trade cooldown tracking (regime-based)
  // Tracks the last time a signal was APPROVED for each symbol
  private lastApprovalTime: Map<string, number> = new Map();

  // Phase 40 FIX: Direction flip cooldown tracking
  // Prevents whipsaw position flipping by requiring a cooldown when consensus direction changes
  private lastApprovedDirection: Map<string, 'bullish' | 'bearish'> = new Map();
  private lastDirectionFlipTime: Map<string, number> = new Map();
  private readonly DIRECTION_FLIP_COOLDOWN_MS = 120_000; // 2 minutes before allowing direction flip

  constructor(userId: number, config?: {
    minConfidence?: number;
    minExecutionScore?: number;
    consensusThreshold?: number;
    agentWeights?: Record<string, number>;
  }) {
    super();
    this.userId = userId;

    // Load weights from AgentWeightManager (single source of truth)
    this.agentWeights = getAgentWeightManager(userId).getConsensusWeights();

    if (config) {
      if (config.minConfidence !== undefined) this.minConfidence = config.minConfidence;
      if (config.minExecutionScore !== undefined) this.minExecutionScore = config.minExecutionScore;
      if (config.consensusThreshold !== undefined) this.consensusThreshold = config.consensusThreshold;
      if (config.agentWeights) this.agentWeights = { ...this.agentWeights, ...config.agentWeights };
    }

    // Re-sync weights when AgentWeightManager recalculates
    // Phase 19: Store handler reference for cleanup
    this.weightsRecalcHandler = () => {
      this.agentWeights = getAgentWeightManager(userId).getConsensusWeights();
      tradingLogger.info('Weights synced from AgentWeightManager');
    };
    getAgentWeightManager(userId).on('weights_recalculated', this.weightsRecalcHandler);

    tradingLogger.info('Initialized signal processor', { userId, minConfidencePct: (this.minConfidence * 100).toFixed(0), minExecutionScore: this.minExecutionScore, consensusThresholdPct: (this.consensusThreshold * 100).toFixed(0) });
  }

  /**
   * Phase 19: Cleanup listener references to prevent memory leaks on engine restart.
   * Call this before discarding the processor instance.
   */
  destroy(): void {
    if (this.weightsRecalcHandler) {
      try {
        getAgentWeightManager(this.userId).off('weights_recalculated', this.weightsRecalcHandler);
      } catch {
        // AgentWeightManager may already be destroyed
      }
      this.weightsRecalcHandler = null;
    }
    this.processingSymbols.clear();
    this.removeAllListeners();
    tradingLogger.info('Signal processor destroyed', { userId: this.userId });
  }

  /**
   * Process incoming agent signals and determine if they should trigger automated trades
   * 
   * @param signals Array of signals from all agents
   * @param symbol Trading symbol
   * @returns ProcessedSignal with decision and reasoning
   */
  /**
   * Phase 16 — persist the per-agent consensus snapshot so threshold-sweep
   * backtests have real data. Fire-and-forget: errors are swallowed inside
   * recordConsensus so a DB hiccup can never break the trade loop. Called
   * from BOTH the rejection path (with finalSignal=NEUTRAL) and the
   * approval path (with the computed direction + strength) so sweeps can
   * see every decision, not just successes.
   */
  private persistConsensusSnapshot(
    symbol: string,
    actionable: AgentSignal[],
    final: { finalSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; finalConfidence: number; consensusPercentage: number },
  ): void {
    const bullishVotes = actionable.filter((s) => s.signal === 'bullish').length;
    const bearishVotes = actionable.filter((s) => s.signal === 'bearish').length;
    const neutralVotes = actionable.filter((s) => s.signal === 'neutral').length;
    // recordConsensus handles its own errors — we don't await so the trade
    // loop isn't blocked on a write; if the DB is slow, this is OK to drop.
    void recordConsensus({
      symbol,
      timeframe: '5m',
      finalSignal: final.finalSignal,
      finalConfidence: final.finalConfidence,
      consensusPercentage: final.consensusPercentage,
      bullishVotes,
      bearishVotes,
      neutralVotes,
      agentVotes: actionable.map((s) => ({
        agentName: s.agentName,
        signal: s.signal,
        confidence: s.confidence,
        weight: this.agentWeights[s.agentName] ?? 0,
      })),
      userId: this.userId,
    });
  }

  async processSignals(signals: AgentSignal[], symbol: string, marketContext?: any): Promise<ProcessedSignal> {
    const now = Date.now();

    // FIX: drop stale signals — stale consensus is a leading cause of losing trades
    const MAX_SIGNAL_AGE_MS = 2000;
    const freshSignals = signals.filter(s => now - ((s as any).timestamp ?? (s as any).createdAt ?? 0) <= MAX_SIGNAL_AGE_MS);
    if (freshSignals.length === 0) {
      return {
        approved: false,
        reason: 'All signals stale (>2s old)',
        symbol,
        signals: [],
      };
    }
    signals = freshSignals;

    // Phase 19: Per-symbol debounce (was global boolean blocking all symbols)
    const lastProcessed = this.processingSymbols.get(symbol) || 0;
    const timeSinceLast = now - lastProcessed;

    // Auto-reset stuck symbols after timeout
    if (lastProcessed > 0 && timeSinceLast > this.PROCESSING_TIMEOUT_MS) {
      tradingLogger.warn('Auto-resetting stuck symbol processing', { symbol, stuckMs: timeSinceLast });
      this.processingSymbols.delete(symbol);
    }

    // Debounce per symbol — other symbols can still process concurrently
    if (this.processingSymbols.has(symbol) && timeSinceLast < this.PROCESSING_DEBOUNCE_MS) {
      return {
        approved: false,
        reason: 'Processing debounced',
        symbol,
        signals: [],
      };
    }

    this.processingSymbols.set(symbol, now);

    try {
      // Phase 33: Regime-based trade cooldown enforcement
      // Prevents overtrading by enforcing per-regime minimum intervals between approved signals
      const lastApproval = this.lastApprovalTime.get(symbol) || 0;
      const timeSinceLastApproval = now - lastApproval;
      const regime = marketContext?.regime as string || 'range_bound';
      // Phase 34: Use smoothed cooldown for transition blending
      const cooldownMs = getSmoothedTradeCooldownMs(regime, symbol);

      if (lastApproval > 0 && timeSinceLastApproval < cooldownMs) {
        const remainingMs = cooldownMs - timeSinceLastApproval;
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `Regime cooldown active: ${(remainingMs / 1000).toFixed(1)}s remaining (${regime}: ${(cooldownMs / 1000).toFixed(0)}s cooldown)`,
        });
        this.emit('signal_rejected', {
          symbol,
          reason: `Regime cooldown: ${(remainingMs / 1000).toFixed(1)}s remaining`,
          signals,
        });
        return {
          approved: false,
          reason: `Regime cooldown (${regime}): ${(remainingMs / 1000).toFixed(1)}s remaining of ${(cooldownMs / 1000).toFixed(0)}s`,
          symbol,
          signals: [],
        };
      }

      // Check macro veto — block ALL trades when macro conditions are dangerous
      const macroSignal = signals.find(s => s.agentName === 'MacroAnalyst');
      if (macroSignal?.evidence?.vetoActive) {
        const vetoReason = (macroSignal.evidence.vetoReason as string) || 'Macro conditions unfavorable';
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `MACRO VETO: ${vetoReason}`,
        });
        this.emit('signal_rejected', {
          symbol,
          reason: `MACRO VETO: ${vetoReason}`,
          signals,
        });

        tradingLogger.info('MACRO VETO ENFORCED', { symbol, vetoReason });

        return {
          approved: false,
          reason: `Macro veto: ${vetoReason}`,
          symbol,
          signals,
        };
      }

      // Filter out neutral signals
      const actionableSignals = signals.filter(s => s.signal !== 'neutral');

      // Phase 45 FIX: Lowered from 4 to 3 agents minimum.
      // ETH-USD consistently only gets 3 agents (some agents like MacroAnalyst don't report for ETH),
      // which was blocking ALL ETH trades. 3 agents from different families is sufficient for consensus.
      // The family agreement requirement (MIN_FAMILY_AGREEMENT=2) in SignalAggregator already ensures
      // we have diverse signal sources.
      const MIN_AGENTS_FOR_TRADE = 3;
      if (signals.length < MIN_AGENTS_FOR_TRADE) {
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `Insufficient agents: ${signals.length}/${MIN_AGENTS_FOR_TRADE} (need at least ${MIN_AGENTS_FOR_TRADE} agents to report)`,
        });
        return {
          approved: false,
          reason: `Insufficient agents: ${signals.length}/${MIN_AGENTS_FOR_TRADE}`,
          symbol,
          signals,
        };
      }

      // ── Entry-gate audit restoration: candle history availability ──
      // Signals from agents that can't reference enough historical context are
      // indistinguishable from guesses.  Require at least N 1h candles before
      // any entry is considered.
      const entryCfg = getTradingConfig().entry;
      const minCandles = entryCfg?.minHistoricalCandlesRequired ?? 50;
      try {
        const candles = await loadCandlesFromDatabase(symbol, '1h', minCandles);
        if (candles.length < minCandles) {
          logPipelineEvent('SIGNAL_REJECTED', {
            userId: this.userId,
            symbol,
            reason: `insufficient_candle_history: ${candles.length}/${minCandles} 1h candles`,
          });
          return {
            approved: false,
            reason: `insufficient_candle_history: ${candles.length}/${minCandles} 1h candles`,
            symbol,
            signals,
          };
        }
      } catch (err) {
        // Fail closed: if we cannot verify candle history, treat as insufficient.
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `insufficient_candle_history: lookup_failed (${err instanceof Error ? err.message : 'unknown'})`,
        });
        return {
          approved: false,
          reason: `insufficient_candle_history: lookup_failed`,
          symbol,
          signals,
        };
      }

      // ── Entry-gate audit restoration: price-feed staleness ──
      // Trading on a stale quote is a leading cause of slippage/stop-hunts.
      // Reject if the latest cached tick is missing or too old.
      // Sentinel: if `priceFeedMaxStalenessMs >= Number.MAX_SAFE_INTEGER`, the
      // gate is explicitly disabled (used by unit tests that don't run the
      // price feed service).
      const maxStaleMs = entryCfg?.priceFeedMaxStalenessMs ?? 5_000;
      if (maxStaleMs < Number.MAX_SAFE_INTEGER) {
        const latestPrice = priceFeedService.getLatestPrice(symbol);
        const priceAgeMs = latestPrice ? (Date.now() - latestPrice.timestamp) : Number.POSITIVE_INFINITY;
        if (!latestPrice || priceAgeMs > maxStaleMs) {
          logPipelineEvent('SIGNAL_REJECTED', {
            userId: this.userId,
            symbol,
            reason: latestPrice
              ? `price_feed_stale: ${priceAgeMs}ms > ${maxStaleMs}ms`
              : `price_feed_stale: no_price_available`,
          });
          return {
            approved: false,
            reason: latestPrice
              ? `price_feed_stale: ${priceAgeMs}ms > ${maxStaleMs}ms`
              : `price_feed_stale: no_price_available`,
            symbol,
            signals,
          };
        }
      }

      if (actionableSignals.length === 0) {
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: 'No actionable signals (all neutral)',
        });
        this.emit('signal_rejected', {
          symbol,
          reason: 'No actionable signals (all neutral)',
          signals,
        });

        return {
          approved: false,
          reason: 'No actionable signals',
          symbol,
          signals,
        };
      }

      // Phase 40 FIX: Pre-filter agents by minimum confidence BEFORE consensus calculation.
      // Previously, weak agents (e.g., OnChainFlowAnalyst@35.4%) were included in the consensus
      // calculation, influencing the direction decision even though they'd be filtered out later.
      // This caused false bullish consensus in 3B/3Be splits where one bullish agent was weak.
      const consensusEligibleSignals = actionableSignals.filter(s => s.confidence >= this.minConfidence);
      
      // Phase 45 FIX: Lowered from 3 to 2 eligible signals.
      // With only 3 agents for ETH-USD, requiring all 3 to be high-confidence was too strict.
      // 2 high-confidence agents from different families is sufficient for a valid consensus.
      if (consensusEligibleSignals.length < 2) {
        // Phase 13 fix: report the REAL denominator (actionableSignals.length)
        // not a hardcoded `/3`. Previously "0/3" in the log was misleading when
        // the symbol actually had 8 actionable agents and none hit the bar.
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason:
            `Not enough high-confidence agents for consensus: ` +
            `${consensusEligibleSignals.length}/${actionableSignals.length} eligible, ` +
            `need ≥2 (min confidence: ${(this.minConfidence * 100).toFixed(0)}%)`,
        });
        // Phase 16 — wire ConsensusRecorder into the rejection path so
        // historical analysis (`npm run backtest:consensus`) has real data
        // to sweep thresholds against. Previously this table sat empty
        // because recordConsensus had no call sites in production. Fire
        // & forget: errors are swallowed inside recordConsensus itself.
        this.persistConsensusSnapshot(symbol, actionableSignals, {
          finalSignal: 'NEUTRAL',
          finalConfidence: 0,
          consensusPercentage: 0,
        });
        return {
          approved: false,
          reason:
            `Not enough high-confidence agents: ` +
            `${consensusEligibleSignals.length}/${actionableSignals.length}`,
          symbol,
          signals: actionableSignals,
        };
      }

      // Phase 30: Correlation-aware intelligent signal aggregation
      // Replaces old calculateConsensus with family-based deduplication
      const consensus = aggregateSignals(consensusEligibleSignals, this.agentWeights, marketContext);
      
      // Update consensus cache for millisecond access by exit system
      updateConsensusCache(symbol, consensus);
      
      // Phase 15B: Enhanced consensus logging with directional breakdown for debugging
      const bullishCount = actionableSignals.filter(s => s.signal === 'bullish').length;
      const bearishCount = actionableSignals.filter(s => s.signal === 'bearish').length;
      const neutralCount = actionableSignals.filter(s => s.signal === 'neutral').length;
      logPipelineEvent('CONSENSUS', {
        userId: this.userId,
        symbol,
        direction: consensus.direction,
        confidence: consensus.strength,
        reason: `${bullishCount}B/${bearishCount}Be/${neutralCount}N of ${actionableSignals.length} agents`,
        metadata: { bullishCount, bearishCount, neutralCount, totalAgents: actionableSignals.length },
      });
      // Phase 16 — persist consensus snapshot for threshold-sweep backtests.
      // Fires on every APPROVED consensus so we build a historical record
      // of per-agent confidences at the moment of decision. Fire-and-forget.
      this.persistConsensusSnapshot(symbol, actionableSignals, {
        finalSignal:
          consensus.direction === 'bullish'
            ? 'BULLISH'
            : consensus.direction === 'bearish'
            ? 'BEARISH'
            : 'NEUTRAL',
        finalConfidence: consensus.strength,
        consensusPercentage: consensus.strength * 100,
      });
      tradingLogger.info('Consensus computed', {
        symbol,
        direction: consensus.direction,
        strengthPct: (consensus.strength * 100).toFixed(1),
        bullishCount,
        bearishCount,
        neutralCount,
        bullishWeight: consensus.bullishWeight.toFixed(3),
        bearishWeight: consensus.bearishWeight.toFixed(3),
        signals: actionableSignals.map(s => `${s.agentName}:${s.signal}(${(s.confidence * 100).toFixed(0)}%)`).join(', '),
      });

      // Phase 22: Log consensus flow to DB (regardless of whether threshold is met)
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        const totalWeight = consensus.totalWeight || 1;
        const bullishStrength = totalWeight > 0 ? consensus.bullishWeight / totalWeight : 0;
        const bearishStrength = totalWeight > 0 ? consensus.bearishWeight / totalWeight : 0;
        getAuditLogger().logConsensus({
          symbol,
          bullishCount,
          bearishCount,
          neutralCount,
          bullishStrength,
          bearishStrength,
          netDirection: consensus.direction,
          consensusConfidence: consensus.strength,
          threshold: this.consensusThreshold,
          meetsThreshold: consensus.strength >= this.consensusThreshold,
          fastAgentScore: bullishStrength - bearishStrength,
          agentBreakdown: Object.fromEntries(
            actionableSignals.map(s => [s.agentName, {
              signal: s.signal,
              confidence: s.confidence,
              weight: this.agentWeights[s.agentName] || 0.05,
            }])
          ),
        });
      } catch { /* audit logger not ready */ }

      // Phase 30: Regime-aware consensus threshold adjustment
      // In trending markets, lower threshold to catch moves early
      // In high volatility, raise threshold to avoid noise trades
      // In range-bound, raise threshold for higher quality entries
      let effectiveThreshold = this.consensusThreshold;
      if (marketContext?.regime) {
        // Phase 31: Use centralized RegimeCalibration (includes adaptive learning)
        // Phase 34: Use smoothed threshold for transition blending
        const multiplier = getSmoothedConsensusThresholdMultiplier(marketContext.regime, symbol);
        effectiveThreshold = this.consensusThreshold * multiplier;
        tradingLogger.info('Regime-aware threshold applied', {
          symbol,
          regime: marketContext.regime,
          regimeConfidence: marketContext.regimeConfidence?.toFixed(2),
          baseThreshold: (this.consensusThreshold * 100).toFixed(0) + '%',
          effectiveThreshold: (effectiveThreshold * 100).toFixed(0) + '%',
          multiplier,
        });
      }

      // DIAGNOSTIC: Write to file for debugging
      try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} consensus: strength=${(consensus.strength * 100).toFixed(1)}% dir=${consensus.direction} threshold=${(effectiveThreshold * 100).toFixed(0)}% signals=${actionableSignals.length} regime=${regime}\n`); } catch(e) {}

      // Check consensus threshold
      if (consensus.strength < effectiveThreshold) {
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          direction: consensus.direction,
          confidence: consensus.strength,
          reason: `Consensus too weak: ${(consensus.strength * 100).toFixed(1)}% < ${(effectiveThreshold * 100).toFixed(0)}% (regime: ${marketContext?.regime || 'unknown'})`,
        });
        this.emit('signal_rejected', {
          symbol,
          reason: `Consensus too weak: ${(consensus.strength * 100).toFixed(1)}% < ${(effectiveThreshold * 100).toFixed(0)}% (regime: ${marketContext?.regime || 'unknown'})`,
          consensus,
          signals: actionableSignals,
        });

        // Phase 22: Log rejected trade decision to DB (sample: every 12th rejection to avoid DB bloat)
        // Consensus rejections happen frequently — log periodically for audit without flooding
        if (Math.random() < 0.083) { // ~1 in 12
          try {
            const { getAuditLogger } = await import('./AuditLogger');
            getAuditLogger().logTradeDecision({
              symbol,
              decision: 'rejected',
              direction: consensus.direction === 'bullish' ? 'long' : 'short',
              consensusConfidence: consensus.strength,
              rejectReason: `Consensus ${(consensus.strength * 100).toFixed(1)}% < threshold ${(this.consensusThreshold * 100).toFixed(0)}%`,
              rejectStage: 'consensus_threshold',
              agentSignals: actionableSignals.map(s => ({
                agentName: s.agentName,
                signal: s.signal,
                confidence: s.confidence,
              })),
            });
          } catch { /* audit logger not ready */ }
        }

        return {
          approved: false,
          reason: `Weak consensus: ${(consensus.strength * 100).toFixed(1)}%`,
          symbol,
          signals: actionableSignals,
          consensus,
        };
      }

      // DIAG: Log that consensus passed + signal details
      try {
        appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} CONSENSUS PASSED: ${(consensus.strength * 100).toFixed(1)}% >= ${(effectiveThreshold * 100).toFixed(0)}%\n`);
        appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} ACTIONABLE SIGNALS: ${actionableSignals.map(s => `${s.agentName}=${s.signal}@${(s.confidence*100).toFixed(1)}%`).join(', ')}\n`);
      } catch(e) {}

      // Phase 40 + 21: PRICE TREND VALIDATION GATE.
      // Prevents trading AGAINST the actual price direction. If consensus
      // says bullish but price is dropping meaningfully, BLOCK.
      //
      // Phase 21 — moved both threshold (0.05% → 0.15% by default) and
      // lookback (120000 → config.entry.contraTrendLookbackMs) to config so
      // they're tunable without code edits, AND raised the magnitude floor
      // out of "1-tick noise" territory. The Phase 40 0.05% was below the
      // bid-ask spread on every traded symbol — it was rejecting real
      // signals on noise. Real "falling knife" moves clear 0.15% in 2 min
      // easily; trades below that magnitude are no-signal.
      try {
        const { priceFeedService: pfs } = await import('./priceFeedService');
        const tradingConfig = getTradingConfig();
        const lookbackMs = tradingConfig.entry?.contraTrendLookbackMs ?? 120_000;
        const noiseTolerance = tradingConfig.entry?.contraTrendNoiseTolerancePct ?? 0.15;
        const trend = pfs.getShortTermTrend(symbol, lookbackMs);
        try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} TREND CHECK: ${trend.direction} (${trend.trendPct >= 0 ? '+' : ''}${trend.trendPct.toFixed(3)}%) samples=${trend.sampleCount} tolerance=${noiseTolerance}%\n`); } catch(e) {}

        if (trend.sampleCount >= 3) {
          const consensusDir = consensus.direction; // 'bullish' or 'bearish'
          const priceDir = trend.direction; // 'up', 'down', or 'flat'

          const isContratrend = (
            (consensusDir === 'bullish' && priceDir === 'down' && trend.trendPct < -noiseTolerance) ||
            (consensusDir === 'bearish' && priceDir === 'up' && trend.trendPct > noiseTolerance)
          );

          if (isContratrend) {
            try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} TREND BLOCKED: consensus=${consensusDir} but price=${priceDir} (${trend.trendPct.toFixed(3)}%)\n`); } catch(e) {}
            logPipelineEvent('SIGNAL_REJECTED', {
              userId: this.userId,
              symbol,
              reason: `Contra-trend: consensus=${consensusDir} but price ${priceDir} ${trend.trendPct.toFixed(3)}%`,
            });
            return {
              approved: false,
              reason: `Contra-trend blocked: consensus ${consensusDir} but price ${priceDir} (${trend.trendPct.toFixed(3)}%)`,
              symbol,
              signals: actionableSignals,
              consensus,
            };
          }

          // Phase 40: No more "mild penalty" — all contra-trend is blocked above.
          // Only allow trades that ALIGN with price direction or are in flat markets.

          // Phase 40 FIX v2: UNCONDITIONAL REGIME-DIRECTION GATE
          // If the market regime says trending_down, block ALL bullish signals.
          // If the market regime says trending_up, block ALL bearish signals.
          // Previously this only blocked when price wasn't confirming consensus,
          // but a tiny bounce (+0.06%) in a downtrend would bypass the gate.
          // The regime is a higher-timeframe signal that should ALWAYS override
          // momentary price bounces.
          const isRegimeContratrend = (
            (consensusDir === 'bullish' && regime === 'trending_down') ||
            (consensusDir === 'bearish' && regime === 'trending_up')
          );
          if (isRegimeContratrend) {
            // Allow override ONLY when:
            // 1. Consensus is very strong (>85%)
            // 2. Price direction CONFIRMS the consensus (not just flat)
            // 3. At least 5 agents agree
            // This handles regime lag — when the trend has actually reversed but regime hasn't updated yet
            // Phase 45 FIX: Relaxed regime override from Phase 41's near-impossible requirements.
            // Phase 41 required 95% consensus + 0.1% price move + 6 agents — this was NEVER achievable
            // because ETH-USD only gets 5-7 agents and 95% consensus requires near-unanimity.
            // Root cause: The regime detector labels most periods as 'trending_down' or 'trending_up',
            // but the regime can lag actual price action by 5-15 minutes. A strong consensus (>80%)
            // with price confirmation should be allowed to override a potentially stale regime.
            // NEW: 80% consensus + 0.05% price confirm + 4 eligible agents
            const REGIME_OVERRIDE_THRESHOLD = 0.80;
            const REGIME_OVERRIDE_MIN_PRICE_MOVE = 0.05; // 0.05% price movement required
            const priceConfirmsConsensus = (
              (consensusDir === 'bullish' && priceDir === 'up' && trend.trendPct > REGIME_OVERRIDE_MIN_PRICE_MOVE) ||
              (consensusDir === 'bearish' && priceDir === 'down' && trend.trendPct < -REGIME_OVERRIDE_MIN_PRICE_MOVE)
            );
            const hasStrongAgentCount = consensusEligibleSignals.length >= 4; // Phase 45: lowered from 6 to 4
            
            if (consensus.strength >= REGIME_OVERRIDE_THRESHOLD && priceConfirmsConsensus && hasStrongAgentCount) {
              // Very strong consensus + strong price confirmation + many agents = regime may be lagging
              try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} REGIME OVERRIDE: consensus=${consensusDir}@${(consensus.strength*100).toFixed(1)}% overrides regime=${regime} (price=${priceDir} ${trend.trendPct.toFixed(3)}%, ${consensusEligibleSignals.length} eligible agents)\n`); } catch(e) {}
              // Continue to next checks — don't block
            } else {
              // Regime says one direction, consensus says the other — block
              try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} REGIME BLOCKED: consensus=${consensusDir}@${(consensus.strength*100).toFixed(1)}% but regime=${regime} (price=${priceDir} ${trend.trendPct.toFixed(3)}%, need >${(REGIME_OVERRIDE_THRESHOLD*100).toFixed(0)}% + >${REGIME_OVERRIDE_MIN_PRICE_MOVE}% price move + 4 eligible agents, have ${consensusEligibleSignals.length})\n`); } catch(e) {}
              logPipelineEvent('SIGNAL_REJECTED', {
                userId: this.userId,
                symbol,
                reason: `Regime contra-trend: consensus=${consensusDir} but regime=${regime} (unconditional)`,
              });
              return {
                approved: false,
                reason: `Regime contra-trend blocked: consensus ${consensusDir} but regime ${regime}`,
                symbol,
                signals: actionableSignals,
                consensus,
              };
            }
          }
        }
      } catch (trendErr) {
        // Non-blocking — if trend check fails, proceed without it
      }

      // Filter by minimum confidence
      const highConfidenceSignals = actionableSignals.filter(s => s.confidence >= this.minConfidence);
      try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} CONFIDENCE FILTER: ${highConfidenceSignals.length}/${actionableSignals.length} pass (min ${(this.minConfidence * 100).toFixed(0)}%)\n`); } catch(e) {}
      
      if (highConfidenceSignals.length === 0) {
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `No signals above ${(this.minConfidence * 100).toFixed(0)}% confidence`,
        });
        this.emit('signal_rejected', {
          symbol,
          reason: `No signals above ${(this.minConfidence * 100).toFixed(0)}% confidence`,
          signals: actionableSignals,
        });
        
        // DO NOT log low confidence - only log actionable opportunities
        
        return {
          approved: false,
          reason: `Low confidence signals`,
          symbol,
          signals: actionableSignals,
        };
      }

      // Calculate combined score for each signal
      // Combined Score = (Confidence * 0.6) + (ExecutionScore/100 * 0.4)
      // This ensures high-confidence signals aren't rejected just due to timing
      const signalsWithCombinedScore = highConfidenceSignals.map(s => ({
        ...s,
        combinedScore: (s.confidence * 0.6) + ((s.executionScore || 50) / 100 * 0.4)
      }));
      
      // Filter by combined score threshold
      // This allows high confidence to compensate for lower execution scores
      const minCombinedScore = getTradingConfig().consensus.minCombinedScore;
      const highQualitySignals = signalsWithCombinedScore.filter(s => 
        s.combinedScore >= minCombinedScore
      );
      
      // Log combined scores for debugging
      tradingLogger.debug('Combined scores', { symbol, scores: signalsWithCombinedScore.map(s => ({ agent: s.agentName, conf: (s.confidence*100).toFixed(1), exec: s.executionScore || 50, combined: (s.combinedScore*100).toFixed(1) })) });
      
      try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} COMBINED SCORE FILTER: ${highQualitySignals.length}/${signalsWithCombinedScore.length} pass (min ${(minCombinedScore * 100).toFixed(0)}%)\n`); } catch(e) {}

      if (highQualitySignals.length === 0) {
        logPipelineEvent('SIGNAL_REJECTED', {
          userId: this.userId,
          symbol,
          reason: `No signals above combined score ${(minCombinedScore*100).toFixed(0)}% (Conf*0.6 + Exec*0.4)`,
        });
        this.emit('signal_rejected', {
          symbol,
          reason: `No signals above combined score ${(minCombinedScore*100).toFixed(0)}% (Conf*0.6 + Exec*0.4)`,
          signals: highConfidenceSignals,
        });
        
        // DO NOT log low combined score - only log actionable opportunities
        
        return {
          approved: false,
          reason: `Low combined scores`,
          symbol,
          signals: highConfidenceSignals,
        };
      }

      // Phase 5B: Regime-Aware R:R Pre-Validation Gate
      // Phase 22: tunables extracted to TradingConfig.entry.rr; reward
      // distance uses `selectRewardDistance` to walk the S/R array past
      // microstructure-close levels rather than blindly taking [0]. Regime
      // selection lives in the `selectMinRr` helper. Both helpers are pure
      // and exported above for unit testing.
      const techSignal = signals.find(s => s.agentName === 'TechnicalAnalyst');
      const techEvidence = techSignal?.evidence as any;
      const atr = techEvidence?.atr as number || 0;
      if (atr > 0) {
        const currentPrice = this.getLatestPrice(highQualitySignals);
        if (currentPrice > 0) {
          const rrCfg = getTradingConfig().entry.rr;
          const riskDistance = atr * rrCfg.riskAtrMultiplier;
          const atrFallbackReward = atr * rrCfg.defaultRewardAtrMultiplier;

          // Determine minimum R:R from regime BEFORE selecting reward —
          // the reward selection uses minRR as the target floor when
          // walking the S/R array.
          const superTrend = techEvidence?.superTrend;
          const avgATR = techEvidence?.avgATR as number || 0;
          const atrRatio = avgATR > 0 ? atr / avgATR : 1.0;
          const minRR = selectMinRr(
            consensus.direction,
            superTrend?.direction,
            atrRatio,
            rrCfg,
          );

          // Walk S/R array nearest→furthest, take first level clearing minRR.
          // For bullish trades the agent's `resistance` array (sorted ascending)
          // is used; for bearish trades, `support` (sorted descending — closest
          // first by price, but distance comparison is absolute either way).
          let rewardDistance = atrFallbackReward;
          const resistance = techEvidence?.resistance as number[] | undefined;
          const support = techEvidence?.support as number[] | undefined;
          if (consensus.direction === 'bullish') {
            rewardDistance = selectRewardDistance(resistance, currentPrice, riskDistance, minRR, atrFallbackReward);
          } else if (consensus.direction === 'bearish') {
            rewardDistance = selectRewardDistance(support, currentPrice, riskDistance, minRR, atrFallbackReward);
          }

          const rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;

          try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} R:R CHECK: ratio=${rrRatio.toFixed(2)} minRR=${minRR} atr=${atr.toFixed(2)} reward=${rewardDistance.toFixed(2)} risk=${riskDistance.toFixed(2)}\n`); } catch(e) {}
          if (rrRatio < minRR) {
            try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} R:R BLOCKED: ${rrRatio.toFixed(2)} < ${minRR}\n`); } catch(e) {}
            tradingLogger.info('R:R too low', { symbol, rrRatio: rrRatio.toFixed(2), minRR, atr: atr.toFixed(2) });
            return {
              approved: false,
              reason: `R:R too low: ${rrRatio.toFixed(2)}:1 (need ${minRR}:1)`,
              symbol,
              signals: highQualitySignals,
              consensus,
            };
          }
          tradingLogger.info('R:R passed', { symbol, rrRatio: rrRatio.toFixed(2), minRR });
        }
      }

      // Phase 6: ML quality gate — check trade success prediction
      try {
        const { getTradeSuccessPredictor } = await import('../ml/MLSystem');
        const predictor = getTradeSuccessPredictor();
        const mlFeatures = this.buildMLFeaturesFromConsensus(consensus, signals);
        const prediction = await predictor.predictSuccess(mlFeatures);

        mlGateStats.totalChecked++;
        if (prediction.modelAvailable && prediction.confidence > 0.3) {
          mlGateStats.modelAvailable++;
          mlGateStats.totalSuccessProbability += prediction.successProbability;

          if (prediction.successProbability < 0.35) {
            mlGateStats.positionReduced++;
            tradingLogger.info('ML gate: reducing position', { successProbabilityPct: (prediction.successProbability * 100).toFixed(0) });
            consensus.positionSize = (consensus.positionSize || 0.05) * 0.5;
          } else if (prediction.successProbability > 0.7) {
            mlGateStats.fullSizePassed++;
            tradingLogger.info('ML boost', { successProbabilityPct: (prediction.successProbability * 100).toFixed(0) });
          } else {
            mlGateStats.normalPassed++;
          }
        }
      } catch (mlError) {
        // ML gate is non-blocking — don't prevent trade on ML failure
      }

      // Calculate aggregate metrics
      const avgConfidence = highQualitySignals.reduce((sum, s) => sum + s.confidence, 0) / highQualitySignals.length;
      const avgExecutionScore = highQualitySignals.reduce((sum, s) => sum + (s.executionScore || 0), 0) / highQualitySignals.length;
      const avgQualityScore = highQualitySignals.reduce((sum, s) => sum + (s.qualityScore || 0), 0) / highQualitySignals.length;

      // Phase 40 FIX: Direction flip cooldown
      // Prevents whipsaw position flipping by requiring a cooldown when consensus direction changes.
      // If the last approved signal was bearish and now it's bullish (or vice versa),
      // require at least 2 minutes before acting on the new direction.
      const lastDir = this.lastApprovedDirection.get(symbol);
      if (lastDir && lastDir !== consensus.direction) {
        const lastFlipTime = this.lastDirectionFlipTime.get(symbol) || 0;
        const timeSinceFlip = Date.now() - lastFlipTime;
        if (timeSinceFlip < this.DIRECTION_FLIP_COOLDOWN_MS) {
          const remaining = ((this.DIRECTION_FLIP_COOLDOWN_MS - timeSinceFlip) / 1000).toFixed(1);
          try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} DIRECTION FLIP BLOCKED: ${lastDir}→${consensus.direction}, cooldown ${remaining}s remaining\n`); } catch(e) {}
          logPipelineEvent('SIGNAL_REJECTED', {
            userId: this.userId,
            symbol,
            reason: `Direction flip cooldown: ${lastDir}→${consensus.direction}, ${remaining}s remaining`,
          });
          return {
            approved: false,
            reason: `Direction flip cooldown: ${remaining}s remaining`,
            symbol,
            signals: highQualitySignals,
            consensus,
          };
        }
      }
      // Track direction for flip detection
      if (lastDir !== consensus.direction) {
        this.lastDirectionFlipTime.set(symbol, Date.now());
      }
      this.lastApprovedDirection.set(symbol, consensus.direction);

      // Approve signal for automated execution
      const approvedSignal: ProcessedSignal = {
        approved: true,
        reason: `Strong ${consensus.direction} consensus with ${highQualitySignals.length} high-quality signals`,
        symbol,
        signals: highQualitySignals,
        consensus,
        metrics: {
          avgConfidence,
          avgExecutionScore,
          avgQualityScore,
          signalCount: highQualitySignals.length,
        },
        recommendation: {
          action: consensus.direction === 'bullish' ? 'buy' : 'sell',
          confidence: avgConfidence,
          executionScore: avgExecutionScore,
          reasoning: this.buildReasoning(highQualitySignals, consensus),
        },
      };

      try { appendFileSync('/tmp/seer-diag.log', `${new Date().toISOString()} | ${symbol} SIGNAL APPROVED: ${consensus.direction} conf=${(avgConfidence * 100).toFixed(1)}% agents=${highQualitySignals.length}\n`); } catch(e) {}
      logPipelineEvent('SIGNAL_APPROVED', {
        userId: this.userId,
        symbol,
        direction: consensus.direction,
        action: approvedSignal.recommendation?.action,
        confidence: avgConfidence,
        metadata: { executionScore: avgExecutionScore, combinedScore: avgQualityScore, agentCount: highQualitySignals.length },
      });
      tradingLogger.info('Signal APPROVED for automated execution', { symbol, action: approvedSignal.recommendation?.action.toUpperCase(), confidencePct: (avgConfidence * 100).toFixed(1), executionScore: avgExecutionScore.toFixed(0) });

      // Phase 60 — log the approved decision as PENDING, not EXECUTED.
      // This row is written when consensus approves the signal, but the
      // EnhancedTradeExecutor still has gates to run (R:R, duplicate, VaR,
      // regime cooldown). Most signals fail at least one of those, so
      // labeling them EXECUTED here was dishonest: 100% of "EXECUTED" rows
      // had positionId=null. The executor's success path
      // (`tradeDecisionLogger.updateExecution`) now promotes PENDING→EXECUTED;
      // its reject paths mark the row FAILED with the gate name as reason.
      const signalId = await this.logDecision({
        symbol,
        signals: highQualitySignals,
        consensus,
        decision: 'PENDING',
        reason: `Strong ${consensus.direction} consensus with ${highQualitySignals.length} high-quality signals — awaiting executor gates`,
        price: this.getLatestPrice(highQualitySignals),
        avgConfidence,
        avgExecutionScore,
      });
      
      // Attach signalId to the approved signal for tracking
      approvedSignal.signalId = signalId;

      // Phase 33: Record approval time for cooldown tracking
      this.lastApprovalTime.set(symbol, Date.now());

      this.emit('signal_approved', approvedSignal);

      // Phase 22: Log trade decision (approved) to DB with full agent snapshot
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logTradeDecision({
          symbol,
          decision: 'executed',
          direction: consensus.direction === 'bullish' ? 'long' : 'short',
          consensusConfidence: consensus.strength,
          entryPrice: this.getLatestPrice(highQualitySignals),
          agentSignals: highQualitySignals.map(s => ({
            agentName: s.agentName,
            signal: s.signal,
            confidence: s.confidence,
            executionScore: s.executionScore,
          })),
          pipelineStages: {
            macroVeto: 'passed',
            consensus: `${(consensus.strength * 100).toFixed(1)}% (threshold: ${(this.consensusThreshold * 100).toFixed(0)}%)`,
            confidence: `${highQualitySignals.length} above ${(this.minConfidence * 100).toFixed(0)}%`,
            combinedScore: 'passed',
          },
        });
      } catch { /* audit logger not ready */ }

      return approvedSignal;

    } finally {
      // Phase 19: Release per-symbol lock (was global boolean)
      this.processingSymbols.delete(symbol);
    }
  }

  /**
   * Calculate multi-agent consensus using institutional-grade weighted voting.
   *
   * Formula combines two metrics:
   *   1. Directional Agreement Ratio (DAR): What fraction of the total weighted
   *      vote points in the dominant direction? Range 0.5 (split) → 1.0 (unanimous).
   *      DAR = dominantWeight / (bullishWeight + bearishWeight)
   *
   *   2. Confidence-Weighted Strength (CWS): Average confidence in the dominant
   *      direction, weighted by agent importance.
   *      CWS = dominantWeight / totalWeight
   *
   *   Combined Strength = DAR * 0.6 + CWS * 0.4
   *
   * This produces realistic values (30-80%) that work with the consensus threshold.
   * A threshold of 40% requires meaningful directional agreement while still
   * allowing trades in mixed-signal markets where the dominant direction is clear.
   */
  // Phase 30: calculateConsensus has been replaced by aggregateSignals() from SignalAggregator.ts
  // The old method is removed — all consensus logic now lives in SignalAggregator
  // with correlation-aware family deduplication, conviction tracking, and dissent analysis.

  /**
   * Build reasoning string from signals
   */
  private buildReasoning(signals: AgentSignal[], consensus: Consensus): string {
    const reasons = signals.map(s => {
      const conf = (s.confidence * 100).toFixed(0);
      const exec = s.executionScore || 0;
      return `${s.agentName}: ${s.signal} (${conf}%, exec:${exec})`;
    });

    return `${consensus.direction.toUpperCase()} consensus (${(consensus.strength * 100).toFixed(1)}%) from ${signals.length} agents: ${reasons.join(', ')}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    minConfidence?: number;
    minExecutionScore?: number;
    consensusThreshold?: number;
    agentWeights?: Record<string, number>;
  }): void {
    if (config.minConfidence !== undefined) this.minConfidence = config.minConfidence;
    if (config.minExecutionScore !== undefined) this.minExecutionScore = config.minExecutionScore;
    if (config.consensusThreshold !== undefined) this.consensusThreshold = config.consensusThreshold;
    if (config.agentWeights) this.agentWeights = { ...this.agentWeights, ...config.agentWeights };
    
    tradingLogger.info('Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      minConfidence: this.minConfidence,
      minExecutionScore: this.minExecutionScore,
      consensusThreshold: this.consensusThreshold,
      agentWeights: { ...this.agentWeights },
    };
  }

  /**
   * Log trade decision to database
   */
  private async logDecision(params: {
    symbol: string;
    signals: AgentSignal[];
    consensus?: Consensus;
    decision: 'EXECUTED' | 'SKIPPED' | 'VETOED' | 'PENDING' | 'FAILED' | 'PARTIAL';
    reason: string;
    price: number;
    avgConfidence?: number;
    avgExecutionScore?: number;
  }): Promise<string | undefined> {
    try {
      // Convert signals to agent scores format
      const agentScores: Record<string, AgentScore> = {};
      for (const signal of params.signals) {
        const weight = this.agentWeights[signal.agentName] || 0.05;
        agentScores[signal.agentName] = {
          score: signal.confidence * 100,
          weight,
          signal: signal.signal === 'bullish' ? 'BUY' : signal.signal === 'bearish' ? 'SELL' : 'HOLD',
          confidence: signal.confidence * 100,
          reasoning: signal.reasoning || undefined,
        };
      }

      // Determine signal type from consensus
      let signalType: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      if (params.consensus) {
        signalType = params.consensus.direction === 'bullish' ? 'BUY' : 'SELL';
      } else if (params.signals.length > 0) {
        const firstSignal = params.signals[0];
        signalType = firstSignal.signal === 'bullish' ? 'BUY' : firstSignal.signal === 'bearish' ? 'SELL' : 'HOLD';
      }

      // Calculate total confidence
      const totalConfidence = params.avgConfidence 
        ? params.avgConfidence * 100 
        : (params.consensus?.strength || 0) * 100;

      const input: TradeDecisionInput = {
        userId: this.userId,
        symbol: params.symbol,
        exchange: 'coinbase', // Default exchange
        price: params.price,
        signalType,
        totalConfidence,
        threshold: this.consensusThreshold * 100,
        agentScores,
        decision: params.decision,
        decisionReason: params.reason,
      };

      const signalId = await tradeDecisionLogger.logDecision(input);
      return signalId;
    } catch (error) {
      tradingLogger.error('Failed to log decision', { error: (error as Error)?.message });
      return undefined;
    }
  }

  /**
   * Get latest price from signals
   */
  private getLatestPrice(signals: AgentSignal[]): number {
    // Try to get price from signal recommendation or evidence
    for (const signal of signals) {
      // Check recommendation targetPrice
      if (signal.recommendation?.targetPrice && signal.recommendation.targetPrice > 0) {
        return signal.recommendation.targetPrice;
      }
      // Check evidence for price data
      if (signal.evidence?.currentPrice && signal.evidence.currentPrice > 0) {
        return signal.evidence.currentPrice;
      }
      if (signal.evidence?.price && signal.evidence.price > 0) {
        return signal.evidence.price;
      }
    }
    return 0; // Default if no price available
  }

  /**
   * Phase 6: Build MLFeatures from consensus + agent signals
   *
   * Maps agent signal data, consensus metrics, and market conditions
   * into the MLFeatures interface used by TradeSuccessPredictor.
   * Missing values default to 0 (neutral) so the model always gets a full feature vector.
   */
  private buildMLFeaturesFromConsensus(consensus: Consensus, agentSignals: AgentSignal[]): import('../ml/MLSystem').MLFeatures {
    // Helper to find an agent signal by name prefix
    const findAgent = (prefix: string): AgentSignal | undefined =>
      agentSignals.find(s => s.agentName.toLowerCase().includes(prefix.toLowerCase()));

    // Helper to extract agent triplet (confidence, strength, quality)
    const agentTriplet = (prefix: string): { confidence: number; strength: number; quality: number } => {
      const agent = findAgent(prefix);
      if (!agent) return { confidence: 0, strength: 0, quality: 0 };
      return {
        confidence: agent.confidence || 0,
        strength: agent.signal === 'bullish' ? agent.confidence : agent.signal === 'bearish' ? -agent.confidence : 0,
        quality: agent.qualityScore || 0,
      };
    };

    const technical = agentTriplet('Technical');
    const pattern = agentTriplet('Pattern');
    const orderflow = agentTriplet('OrderFlow');
    const sentiment = agentTriplet('Sentiment');
    const news = agentTriplet('News');
    const macro = agentTriplet('Macro');

    // Extract TechnicalAnalyst evidence for market conditions
    const techSignal = findAgent('Technical');
    const techEvidence = techSignal?.evidence as Record<string, any> | undefined;

    const rsi = (techEvidence?.rsi as number) || 50;
    const macdValue = (techEvidence?.macd?.histogram as number) || (techEvidence?.macd as number) || 0;
    const atr = (techEvidence?.atr as number) || 0;
    const avgATR = (techEvidence?.avgATR as number) || atr;
    const volatility = avgATR > 0 ? atr / avgATR : 1.0;

    // Bollinger Band position: where price sits within the bands (0 = lower, 1 = upper)
    let bbPosition = 0.5;
    const bb = techEvidence?.bollingerBands;
    if (bb && bb.upper && bb.lower && bb.upper !== bb.lower) {
      const price = (techEvidence?.currentPrice as number) || (techEvidence?.price as number) || 0;
      if (price > 0) {
        bbPosition = Math.max(0, Math.min(1, (price - bb.lower) / (bb.upper - bb.lower)));
      }
    }

    // Volume ratio from evidence (default 1.0 = average)
    const volumeRatio = (techEvidence?.volumeRatio as number) || (techEvidence?.volume_ratio as number) || 1.0;

    // Trend strength from superTrend or ADX
    const superTrend = techEvidence?.superTrend;
    const adx = (techEvidence?.adx as number) || 0;
    const trendStrength = adx > 0 ? adx / 100 : (superTrend ? 0.6 : 0.3);

    // Pattern metrics from PatternMatcher evidence
    const patternSignal = findAgent('Pattern');
    const patternEvidence = patternSignal?.evidence as Record<string, any> | undefined;
    const patternAlpha = (patternEvidence?.alpha as number) || (patternEvidence?.patternAlpha as number) || 0;
    const patternSimilarity = (patternEvidence?.similarity as number) || (patternEvidence?.patternSimilarity as number) || 0;
    const patternTimesUsed = (patternEvidence?.timesUsed as number) || (patternEvidence?.patternTimesUsed as number) || 0;

    // Consensus metrics
    const agreeingCount = agentSignals.filter(s => {
      if (consensus.direction === 'bullish') return s.signal === 'bullish';
      if (consensus.direction === 'bearish') return s.signal === 'bearish';
      return false;
    }).length;

    // Risk metrics — R:R was already calculated upstream; approximate from evidence
    const resistance = techEvidence?.resistance as number[] | undefined;
    const support = techEvidence?.support as number[] | undefined;
    const currentPrice = this.getLatestPrice(agentSignals);
    let rrRatio = 1.5; // default
    if (atr > 0 && currentPrice > 0) {
      const riskDistance = atr * 2.0;
      let rewardDistance = atr * 3.0;
      if (consensus.direction === 'bullish' && resistance?.[0]) {
        rewardDistance = Math.abs(resistance[0] - currentPrice);
      } else if (consensus.direction === 'bearish' && support?.[0]) {
        rewardDistance = Math.abs(currentPrice - support[0]);
      }
      rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 1.5;
    }

    // Macro indicators from MacroAnalyst evidence
    const macroSignal = findAgent('Macro');
    const macroEvidence = macroSignal?.evidence as Record<string, any> | undefined;
    const vix = (macroEvidence?.vix as number) || 0;
    const dxy = (macroEvidence?.dxy as number) || 0;
    const sp500Change = (macroEvidence?.sp500Change as number) || (macroEvidence?.sp500_change as number) || 0;
    const stablecoinChange = (macroEvidence?.stablecoinChange as number) || (macroEvidence?.stablecoin_change as number) || 0;

    return {
      // Agent signals
      technical_confidence: technical.confidence,
      technical_strength: technical.strength,
      technical_quality: technical.quality,
      pattern_confidence: pattern.confidence,
      pattern_strength: pattern.strength,
      pattern_quality: pattern.quality,
      orderflow_confidence: orderflow.confidence,
      orderflow_strength: orderflow.strength,
      orderflow_quality: orderflow.quality,
      sentiment_confidence: sentiment.confidence,
      sentiment_strength: sentiment.strength,
      sentiment_quality: sentiment.quality,
      news_confidence: news.confidence,
      news_strength: news.strength,
      news_quality: news.quality,
      macro_confidence: macro.confidence,
      macro_strength: macro.strength,
      macro_quality: macro.quality,

      // Pattern metrics
      pattern_alpha: patternAlpha,
      pattern_similarity: patternSimilarity,
      pattern_times_used: patternTimesUsed,

      // Consensus metrics
      consensus_score: consensus.strength,
      consensus_confidence: consensus.strength, // strength doubles as confidence in this context
      agreeing_agents: agreeingCount,

      // Market conditions
      volatility,
      volume_ratio: volumeRatio,
      trend_strength: trendStrength,
      rsi,
      macd: macdValue,
      bb_position: bbPosition,

      // Risk metrics
      risk_reward_ratio: rrRatio,
      position_size: consensus.positionSize || 0.05,
      expected_return: rrRatio * (consensus.positionSize || 0.05),

      // Macro indicators
      vix,
      dxy,
      sp500_change: sp500Change,
      stablecoin_change: stablecoinChange,
    };
  }
}

/**
 * Processed signal result
 */
export interface ProcessedSignal {
  approved: boolean;
  reason: string;
  symbol: string;
  signals: AgentSignal[];
  signalId?: string;
  consensus?: Consensus;
  metrics?: {
    avgConfidence: number;
    avgExecutionScore: number;
    avgQualityScore: number;
    signalCount: number;
  };
  recommendation?: {
    action: 'buy' | 'sell';
    confidence: number;
    executionScore: number;
    reasoning: string;
  };
}

/**
 * Consensus calculation result
 * Phase 30: Now uses AggregatedSignal from SignalAggregator for correlation-aware merge.
 * Consensus is kept as a type alias for backward compatibility.
 */
export type Consensus = AggregatedSignal;

/**
 * Exit consensus calculation result (Phase 3 Enhancement)
 */
export interface ExitConsensus {
  action: 'hold' | 'partial_exit' | 'full_exit';
  confidence: number; // 0-1
  urgency: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  exitPercent?: number;
  votingAgents: number;
  exitVotes: number;
  holdVotes: number;
}

/**
 * Calculate exit consensus from agent signals (Phase 3 Enhancement)
 * 
 * This function aggregates exit recommendations from all agents
 * and determines whether to exit a position based on weighted voting.
 * 
 * @param signals Array of agent signals with exitRecommendation
 * @param agentWeights Weights for each agent (same as entry consensus)
 * @param exitConsensusThreshold Minimum consensus required for exit (default 0.6 = 60%)
 * @returns ExitConsensus with action, confidence, and reasoning
 */
export function calculateExitConsensus(
  signals: AgentSignal[],
  agentWeights: Record<string, number>,
  exitConsensusThreshold: number = 0.6
): ExitConsensus {
  // Filter signals that have exit recommendations
  const signalsWithExit = signals.filter(s => s.exitRecommendation);
  
  if (signalsWithExit.length === 0) {
    return {
      action: 'hold',
      confidence: 0,
      urgency: 'low',
      reason: 'No exit recommendations from agents',
      votingAgents: 0,
      exitVotes: 0,
      holdVotes: signals.length,
    };
  }
  
  // Calculate weighted votes
  let fullExitWeight = 0;
  let partialExitWeight = 0;
  let holdWeight = 0;
  let totalWeight = 0;
  let highestUrgency: 'low' | 'medium' | 'high' | 'critical' = 'low';
  const reasons: string[] = [];
  let totalExitPercent = 0;
  let exitPercentCount = 0;
  
  const urgencyOrder = { 'low': 0, 'medium': 1, 'high': 2, 'critical': 3 };
  
  for (const signal of signalsWithExit) {
    const weight = agentWeights[signal.agentName] || 0.05;
    const exit = signal.exitRecommendation!;
    const confidenceWeight = weight * exit.confidence;
    
    if (exit.action === 'full_exit') {
      fullExitWeight += confidenceWeight;
      reasons.push(`${signal.agentName}: FULL EXIT (${exit.reason})`);
    } else if (exit.action === 'partial_exit') {
      partialExitWeight += confidenceWeight;
      reasons.push(`${signal.agentName}: PARTIAL EXIT ${exit.exitPercent}% (${exit.reason})`);
      if (exit.exitPercent) {
        totalExitPercent += exit.exitPercent;
        exitPercentCount++;
      }
    } else {
      holdWeight += confidenceWeight;
    }
    
    totalWeight += weight;
    
    // Track highest urgency
    if (urgencyOrder[exit.urgency] > urgencyOrder[highestUrgency]) {
      highestUrgency = exit.urgency;
    }
  }
  
  // Calculate consensus strengths
  const fullExitStrength = totalWeight > 0 ? fullExitWeight / totalWeight : 0;
  const partialExitStrength = totalWeight > 0 ? partialExitWeight / totalWeight : 0;
  const totalExitStrength = fullExitStrength + partialExitStrength;
  
  // Determine action based on consensus
  let action: 'hold' | 'partial_exit' | 'full_exit' = 'hold';
  let confidence = 0;
  let exitPercent: number | undefined;
  
  if (totalExitStrength >= exitConsensusThreshold) {
    // Enough agents agree to exit
    if (fullExitStrength >= partialExitStrength) {
      action = 'full_exit';
      confidence = fullExitStrength;
    } else {
      action = 'partial_exit';
      confidence = partialExitStrength;
      exitPercent = exitPercentCount > 0 ? Math.round(totalExitPercent / exitPercentCount) : 50;
    }
  } else if (totalExitStrength >= exitConsensusThreshold * 0.7) {
    // Partial consensus - suggest partial exit
    action = 'partial_exit';
    confidence = totalExitStrength;
    exitPercent = 25; // Conservative partial exit
  }
  
  const exitVotes = signalsWithExit.filter(s => 
    s.exitRecommendation?.action === 'full_exit' || s.exitRecommendation?.action === 'partial_exit'
  ).length;
  
  return {
    action,
    confidence,
    urgency: highestUrgency,
    reason: reasons.length > 0 
      ? `Exit consensus: ${(totalExitStrength * 100).toFixed(0)}% (threshold: ${(exitConsensusThreshold * 100).toFixed(0)}%). ${reasons.slice(0, 3).join('; ')}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ''}`
      : 'No exit signals',
    exitPercent,
    votingAgents: signalsWithExit.length,
    exitVotes,
    holdVotes: signalsWithExit.filter(s => s.exitRecommendation?.action === 'hold').length,
  };
}


/**
 * Cached consensus for millisecond-level access
 * Used by IntelligentExitManager for confidence decay tracking
 */
const consensusCache: Map<string, { consensus: number; timestamp: number; direction: 'bullish' | 'bearish' }> = new Map();
const CONSENSUS_CACHE_TTL_MS = 5000; // Cache valid for 5 seconds

// Phase 19: Periodic eviction of stale consensus cache entries (prevents unbounded growth)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of consensusCache) {
    if (now - entry.timestamp > 60_000) { // Evict entries older than 60s
      consensusCache.delete(key);
    }
  }
}, 30_000); // Run every 30 seconds

/**
 * Update consensus cache (called by processSignals)
 */
export function updateConsensusCache(symbol: string, consensus: Consensus): void {
  consensusCache.set(symbol, {
    consensus: consensus.strength,
    timestamp: Date.now(),
    direction: consensus.direction,
  });
}

/**
 * Get latest consensus for a symbol (millisecond access)
 * 
 * This function provides O(1) access to the latest consensus value
 * for use in the confidence decay exit system.
 * 
 * @param symbol Trading symbol
 * @returns Consensus strength (0-1) or null if no recent data
 */
export function getLatestConsensus(symbol: string): number | null {
  const cached = consensusCache.get(symbol);
  if (!cached) return null;
  
  // Check if cache is still valid
  if (Date.now() - cached.timestamp > CONSENSUS_CACHE_TTL_MS) {
    return null; // Stale data
  }
  
  return cached.consensus;
}

/**
 * Get latest consensus direction for a symbol
 */
export function getLatestConsensusDirection(symbol: string): 'bullish' | 'bearish' | null {
  const cached = consensusCache.get(symbol);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CONSENSUS_CACHE_TTL_MS) {
    return null;
  }
  
  return cached.direction;
}

/**
 * Get all cached consensus values (for debugging/monitoring)
 */
export function getAllCachedConsensus(): Map<string, { consensus: number; timestamp: number; direction: 'bullish' | 'bearish' }> {
  return new Map(consensusCache);
}
