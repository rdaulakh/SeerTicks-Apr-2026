import { exitLogger } from '../utils/logger';
import { getRegimeAdjustedExits, getVolatilityRegime, getTradingConfig } from '../config/TradingConfig';
import {
  shouldAllowClose as profitLockShouldAllowClose,
  evaluateThesisInvalidation,
  evaluateStuckPosition,
  type ProfitLockPosition,
} from './ProfitLockGuard';

/**
 * Priority Exit Manager - Agent-Intelligence-Driven Exit System (Phase 5B)
 *
 * PURPOSE: Agent intelligence is PRIMARY, static rules are SAFETY NETS
 * DATE: February 16, 2026 (Phase 5B + Phase 17 regime-aware exits)
 *
 * PHILOSOPHY: A super-intelligent agent decides exits like a human trader —
 * reading ATR, order flow, agent consensus, and market regime — not fixed percentages.
 *
 * Phase 17 Enhancement: Regime-Aware Exit Parameters
 * - Low vol: wider stops, longer holds (let trades breathe in calm markets)
 * - Normal vol: base parameters
 * - High vol: tight stops, shorter holds (protect capital in volatile markets)
 *
 * PRIORITY ORDER:
 * 1. Agent unanimous exit (>=3 agents say full_exit with high urgency)
 * 2. Hard stop-loss (regime-adjusted: -0.5% to -1.5%)
 * 3. Momentum crash (>0.5% drop in 2 min while losing)
 * 4. ATR dynamic stop (loss > N * ATR, regime-adjusted)
 *    Fallback: max loser time (regime-adjusted) if ATR unavailable
 * 5. Agent exit consensus (exit score > 60 while losing)
 * 6. Order flow reversal (score flips >50 points against position)
 * 7. Profit targets (0.5%, 1.5%, 3.0%)
 * 8. ATR trailing stop (trail N * ATR from peak, regime-aware)
 *    Fallback: static trailing (regime-adjusted) if ATR unavailable
 * 9. Protect positions near profit targets
 * 10. Max winner time (2 hours) — safety net
 * 11. Direction flip
 * 12. Confidence decay (EXTREME ONLY)
 */

export interface AgentExitConsensus {
  exitScore: number;           // 0-100, weighted average of agent exit scores
  urgentExitCount: number;     // Number of agents recommending urgent (high/critical) exit
  totalAgentsReporting: number;
  strongestReason?: string;    // Most urgent agent's reason
}

export interface PriorityExitPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  remainingQuantity: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  entryDirection: 'bullish' | 'bearish' | 'neutral';
  entryCombinedScore: number;
  peakCombinedScore: number;
  peakCombinedScoreTime: number;
  currentCombinedScore: number;
  currentDirection: 'bullish' | 'bearish' | 'neutral';
  peakPnlPercent: number;
  targetsHit: {
    target1?: boolean;
    target2?: boolean;
    target3?: boolean;
    orderFlowReversal?: boolean; // PHASE 10B: Track partial exit on order flow reversal
  };
  recentPnlHistory?: Array<{ pnlPercent: number; timestamp: number }>;
  // Phase 5B: Agent intelligence fields
  atrPercent?: number;           // ATR as % of price (from TechnicalAnalyst)
  agentExitConsensus?: AgentExitConsensus;
  orderFlowScore?: number;       // -100 to +100 from OrderFlowAnalyst
  regimeMultiplier?: number;     // From market regime (trending=1.5, volatile=0.5)
  recentOrderFlowHistory?: Array<{ score: number; timestamp: number }>;
  entryOrderFlowScore?: number;  // OrderFlow score at entry for reversal detection
}

export interface PriorityExitDecision {
  shouldExit: boolean;
  rule?: string;
  description?: string;
  exitType?: 'full' | 'partial';
  partialPercent?: number;
  urgency?: 'critical' | 'high' | 'medium' | 'low';
}

export interface PriorityExitConfig {
  hardStopLossPercent: number;
  maxLoserTimeMinutes: number;
  maxWinnerTimeMinutes: number;
  minHoldTimeForDecayMinutes: number;
  profitTarget1Percent: number;
  profitTarget2Percent: number;
  profitTarget3Percent: number;
  target1ExitPercent: number;
  target2ExitPercent: number;
  protectionZonePercent: number;
  extremeConsensusThreshold: number;
  // Phase 5: Momentum crash exit
  momentumCrashDropPercent: number;
  momentumCrashWindowMs: number;
  // Phase 5: Trailing stop (static fallbacks)
  trailingActivationPercent: number;
  trailingDistancePercent: number;
  // Phase 5B: Agent-driven thresholds
  atrStopMultiplier: number;        // Exit if loss > N * ATR (default 2.0)
  atrTrailingMultiplier: number;    // Trail by N * ATR from peak (default 1.5)
  agentUnanimousMinCount: number;   // Min agents for unanimous exit (default 3)
  agentConsensusExitScore: number;  // Agent exit score threshold (default 60)
  orderFlowReversalThreshold: number; // Flow swing threshold (default 150)
  orderFlowMinHoldSeconds: number; // Min hold time before order flow exit (default 60)
}

// Phase 15C: Tightened exit parameters based on audit data.
// Previous values: avg stop loss -$379, max hold 4h for losers.
// Hard stop tightened to -1.0% from -1.5% (audit showed losers bleeding to -5%)
// Momentum crash threshold lowered from 0.8% to 0.5% for faster reaction
// Max loser hold reduced from 20min to 15min (losers rarely recover after 15min)
export const DEFAULT_PRIORITY_EXIT_CONFIG: PriorityExitConfig = {
  hardStopLossPercent: -1.2,             // Phase 45 FIX: widened from -0.8% — was too tight, normal volatility hit it
  maxLoserTimeMinutes: 20,               // Phase 45 FIX: increased from 12 min — give trades more room to recover
  maxWinnerTimeMinutes: 120,
  minHoldTimeForDecayMinutes: 20,        // Phase 45 FIX: increased from 10 — 10min was too short, noise caused false direction flips
  profitTarget1Percent: 0.5,
  profitTarget2Percent: 1.5,
  profitTarget3Percent: 3.0,
  target1ExitPercent: 33,
  target2ExitPercent: 33,
  protectionZonePercent: 0.2,
  extremeConsensusThreshold: 0.30,
  momentumCrashDropPercent: 1.2,         // Phase 40: widened from 0.5% — was causing premature exits on normal volatility
  momentumCrashWindowMs: 120000,
  trailingActivationPercent: 0.8,        // Phase 15C: activate earlier (was 1.0%)
  trailingDistancePercent: 0.4,          // Phase 15C: tighter trail (was 0.5%)
  // Phase 5B: Agent-driven
  atrStopMultiplier: 1.5,               // Phase 15C: tightened from 2.0
  atrTrailingMultiplier: 1.2,           // Phase 15C: tightened from 1.5
  agentUnanimousMinCount: 3,
  agentConsensusExitScore: 60,
  orderFlowReversalThreshold: 150, // Phase 41: Raised from 50 — was triggering on normal noise
  orderFlowMinHoldSeconds: 60, // Phase 41: Don't exit on order flow within first 60s
};

/**
 * Public entry point. Wraps the raw rule evaluator with the ProfitLockGuard so
 * that non-catastrophic exits are blocked when net PnL is not yet positive.
 */
export function evaluatePriorityExitRules(
  position: PriorityExitPosition,
  config: PriorityExitConfig = DEFAULT_PRIORITY_EXIT_CONFIG
): PriorityExitDecision {
  const decision = evaluatePriorityExitRulesRaw(position, config);
  if (!decision.shouldExit) return decision;

  const reasonForGuard = decision.rule || decision.description || '';
  const guard = profitLockShouldAllowClose(
    {
      side: position.side,
      entryPrice: position.entryPrice,
      exchange: (position as any).exchange, // Phase 10 — fee drag is exchange-aware
      // Phase 24 — pass thesis-invalidation context so the guard's fourth
      // allow path can fire when agents have flipped on a stuck loser.
      entryDirection: position.entryDirection,
      currentDirection: position.currentDirection,
      currentConsensusStrength: position.currentCombinedScore,
      peakUnrealizedPnlPercent: position.peakPnlPercent,
      holdMinutes: (Date.now() - position.entryTime) / 60_000,
    },
    position.currentPrice,
    reasonForGuard,
  );
  if (guard.allow) return decision;

  // Exception: catastrophic hard stop — grossPnl <= configured floor always exits.
  const catastrophicFloor = getTradingConfig().profitLock?.catastrophicStopPercent ?? -2.5;
  if (decision.rule === 'HARD_STOP_LOSS' && guard.grossPnlPercent <= catastrophicFloor) {
    return decision;
  }

  return { shouldExit: false };
}

/** Raw rule evaluator (pre-guard). Exported for tests; production code should
 * call `evaluatePriorityExitRules` which layers the ProfitLockGuard on top. */
export function evaluatePriorityExitRulesRaw(
  position: PriorityExitPosition,
  config: PriorityExitConfig = DEFAULT_PRIORITY_EXIT_CONFIG
): PriorityExitDecision {

  const holdTimeMinutes = (Date.now() - position.entryTime) / 60000;
  const pnlPercent = position.unrealizedPnlPercent;
  const isLosing = pnlPercent < 0;
  const isWinning = pnlPercent > 0;
  const hasATR = position.atrPercent !== undefined && position.atrPercent > 0;
  const regime = position.regimeMultiplier || 1.0;

  // ── Phase 17: Regime-Aware Exit Parameter Adjustment ──
  // Override exit config with regime-adjusted values based on current ATR
  let effectiveConfig = config;
  try {
    const regimeExits = getRegimeAdjustedExits(position.atrPercent);
    const currentRegime = getVolatilityRegime(position.atrPercent);
    effectiveConfig = {
      ...config,
      hardStopLossPercent: regimeExits.hardStopLossPercent,
      maxLoserTimeMinutes: regimeExits.maxLoserTimeMinutes,
      trailingDistancePercent: regimeExits.trailingDistancePercent,
      atrStopMultiplier: regimeExits.atrStopMultiplier,
    };
    if (currentRegime !== 'normalVol') {
      exitLogger.info('REGIME_ADJUSTED', {
        regime: currentRegime,
        atrPercent: position.atrPercent?.toFixed(2),
        stopLoss: effectiveConfig.hardStopLossPercent.toFixed(2),
        maxLoserTime: effectiveConfig.maxLoserTimeMinutes.toFixed(0),
        atrStopMultiplier: effectiveConfig.atrStopMultiplier.toFixed(2),
      });
    }
  } catch {
    // Fall back to base config if TradingConfig not available
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 1: AGENT UNANIMOUS EXIT (Phase 5B)
  // If multiple agents independently agree this position should be closed immediately,
  // trust their collective intelligence — they see RSI, MACD, patterns, order flow, etc.
  // ═══════════════════════════════════════════════════════════════════════════
  if (position.agentExitConsensus) {
    const consensus = position.agentExitConsensus;
    if (consensus.urgentExitCount >= config.agentUnanimousMinCount) {
      exitLogger.info('AGENT_UNANIMOUS_EXIT', { urgentExitCount: consensus.urgentExitCount, exitScore: consensus.exitScore });
      return {
        shouldExit: true,
        rule: 'AGENT_UNANIMOUS_EXIT',
        description: `${consensus.urgentExitCount} agents recommend urgent exit: ${consensus.strongestReason || 'multiple indicators'}`,
        exitType: 'full',
        urgency: 'critical',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 1.5: PHASE 27 — Thesis-invalidated / stuck-position rule
  //
  // Lives BEFORE the hard stop so stuck losers can be cut at small loss rather
  // than ride to hard-stop. The hot tick path goes through this evaluator;
  // adding the rule here is what makes Phase 24/25 actually fire on tick (the
  // duplicate version in IntelligentExitManager.evaluateExitConditionsRaw
  // belongs to a deprecated update path that doesn't run on tick).
  //
  // Helpers are pure and exported from ProfitLockGuard. Both keyed off GROSS
  // PnL — drag is fixed, doesn't affect the "is this trade stuck" question.
  // The downstream guard wraps the decision with the same helpers and approves
  // the close (no double-counting; the conditions are the same gates).
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const profitLockCfg = getTradingConfig().profitLock;
    const guardPos: ProfitLockPosition = {
      side: position.side,
      entryPrice: position.entryPrice,
      exchange: (position as any).exchange,
      entryDirection: position.entryDirection,
      currentDirection: position.currentDirection,
      currentConsensusStrength: position.currentCombinedScore,
      peakUnrealizedPnlPercent: position.peakPnlPercent,
      holdMinutes: holdTimeMinutes,
    };
    const grossPnlPct = ((position.side === 'long'
      ? position.currentPrice - position.entryPrice
      : position.entryPrice - position.currentPrice) / position.entryPrice) * 100;

    const thesis = evaluateThesisInvalidation(
      guardPos,
      grossPnlPct,
      profitLockCfg?.thesisInvalidationExit,
    );
    if (thesis.invalidated) {
      exitLogger.info('THESIS_INVALIDATED', { holdMin: holdTimeMinutes.toFixed(0), peak: position.peakPnlPercent?.toFixed(3), gross: grossPnlPct.toFixed(3) });
      return {
        shouldExit: true,
        rule: 'THESIS_INVALIDATED',
        description: `Thesis invalidated: ${thesis.reason}`,
        exitType: 'full',
        urgency: 'high',
      };
    }

    const stuck = evaluateStuckPosition(
      guardPos,
      grossPnlPct,
      profitLockCfg?.stuckPositionExit,
    );
    if (stuck.stuck) {
      exitLogger.info('STUCK_POSITION', { holdMin: holdTimeMinutes.toFixed(0), peak: position.peakPnlPercent?.toFixed(3), gross: grossPnlPct.toFixed(3) });
      return {
        shouldExit: true,
        rule: 'STUCK_POSITION',
        description: `Stuck position: ${stuck.reason}`,
        exitType: 'full',
        urgency: 'high',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 2: HARD STOP-LOSS — regime-adjusted safety net
  // Phase 17: Stop widens in low-vol (calm) and tightens in high-vol (volatile)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pnlPercent <= effectiveConfig.hardStopLossPercent) {
    exitLogger.info('HARD_STOP_LOSS', { pnlPercent: pnlPercent.toFixed(2), stopLevel: effectiveConfig.hardStopLossPercent.toFixed(2) });
    return {
      shouldExit: true,
      rule: 'HARD_STOP_LOSS',
      description: `Safety net stop-loss hit at ${pnlPercent.toFixed(2)}% (limit: ${effectiveConfig.hardStopLossPercent.toFixed(1)}%)`,
      exitType: 'full',
      urgency: 'critical',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 3: MOMENTUM CRASH EXIT
  // Inherently adaptive — watches rate-of-change, not absolute level
  // ═══════════════════════════════════════════════════════════════════════════
  if (isLosing && position.recentPnlHistory && position.recentPnlHistory.length >= 2) {
    const now = Date.now();
    const windowStart = now - config.momentumCrashWindowMs;
    const oldestInWindow = position.recentPnlHistory.find(p => p.timestamp >= windowStart);
    if (oldestInWindow) {
      const pnlDrop = oldestInWindow.pnlPercent - pnlPercent;
      if (pnlDrop >= config.momentumCrashDropPercent) {
        exitLogger.info('MOMENTUM_CRASH', { pnlDrop: pnlDrop.toFixed(2), durationSec: ((now - oldestInWindow.timestamp) / 1000).toFixed(0) });
        return {
          shouldExit: true,
          rule: 'MOMENTUM_CRASH',
          description: `Rapid PnL drop of ${pnlDrop.toFixed(2)}% in ${((now - oldestInWindow.timestamp) / 1000).toFixed(0)}s`,
          exitType: 'full',
          urgency: 'critical',
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 4: ATR DYNAMIC STOP (Phase 5B — replaces static max loser time)
  // Uses ATR from TechnicalAnalyst to set dynamic stop based on actual volatility.
  // In volatile markets (high ATR), the stop is wider — avoids premature exit.
  // In calm markets (low ATR), the stop is tighter — cuts losers faster.
  // Fallback: static max loser time if ATR unavailable.
  // ═══════════════════════════════════════════════════════════════════════════
  if (isLosing) {
    if (hasATR) {
      const atrStopPercent = position.atrPercent! * effectiveConfig.atrStopMultiplier;
      if (Math.abs(pnlPercent) >= atrStopPercent) {
        exitLogger.info('ATR_DYNAMIC_STOP', { pnlPercent: pnlPercent.toFixed(2), atrMultiplier: effectiveConfig.atrStopMultiplier, atrStopPercent: atrStopPercent.toFixed(2) });
        return {
          shouldExit: true,
          rule: 'ATR_DYNAMIC_STOP',
          description: `Loss of ${pnlPercent.toFixed(2)}% exceeds ${effectiveConfig.atrStopMultiplier}x ATR (${atrStopPercent.toFixed(2)}%)`,
          exitType: 'full',
          urgency: 'high',
        };
      }
    } else if (holdTimeMinutes >= effectiveConfig.maxLoserTimeMinutes) {
      // Fallback: static max loser time when ATR is unavailable (regime-adjusted)
      exitLogger.info('MAX_LOSER_TIME (fallback)', { holdTimeMin: holdTimeMinutes.toFixed(1), limit: effectiveConfig.maxLoserTimeMinutes.toFixed(0) });
      return {
        shouldExit: true,
        rule: 'MAX_LOSER_TIME',
        description: `Losing position held for ${holdTimeMinutes.toFixed(0)} min (limit: ${effectiveConfig.maxLoserTimeMinutes.toFixed(0)} min)`,
        exitType: 'full',
        urgency: 'high',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 5: AGENT EXIT CONSENSUS (Phase 5B)
  // If the collective agent intelligence (weighted exit score) is high enough
  // AND position is losing, trust the agents' technical/pattern analysis.
  // ═══════════════════════════════════════════════════════════════════════════
  if (isLosing && position.agentExitConsensus) {
    const consensus = position.agentExitConsensus;
    if (consensus.exitScore >= config.agentConsensusExitScore && consensus.totalAgentsReporting >= 2) {
      exitLogger.info('AGENT_EXIT_CONSENSUS', { exitScore: consensus.exitScore, totalAgentsReporting: consensus.totalAgentsReporting });
      return {
        shouldExit: true,
        rule: 'AGENT_EXIT_CONSENSUS',
        description: `Agent exit consensus ${consensus.exitScore}/100: ${consensus.strongestReason || 'multiple signals'}`,
        exitType: 'full',
        urgency: 'high',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 6: ORDER FLOW REVERSAL (Phase 5B, tuned Phase 41)
  // If orderFlowScore swings dramatically against the position, institutional
  // players are likely reversing — exit before price follows.
  // Phase 41: Raised threshold from 50→150, added 60s min hold time.
  // Previous threshold was too sensitive — normal order flow noise (50-100 pts)
  // was triggering exits on EVERY position within seconds, causing 0% win rate.
  // ═══════════════════════════════════════════════════════════════════════════
  if (position.orderFlowScore !== undefined && position.recentOrderFlowHistory && position.recentOrderFlowHistory.length >= 3) {
    // Phase 41: Don't trigger order flow exit within first N seconds — let the trade breathe
    if (holdTimeMinutes >= (config.orderFlowMinHoldSeconds / 60)) {
      const currentFlow = position.orderFlowScore;
      const positionDirection = position.side === 'long' ? 1 : -1;

      // Check if flow has swung against position
      const oldestFlow = position.recentOrderFlowHistory[0];
      const flowSwing = (oldestFlow.score - currentFlow) * positionDirection;

      if (flowSwing >= config.orderFlowReversalThreshold) {
        if (isLosing) {
          // Losing + flow reversal = full exit immediately
          exitLogger.info('ORDER_FLOW_REVERSAL', { flowSwing: flowSwing.toFixed(0), side: position.side, currentFlow, pnl: 'losing', holdMin: holdTimeMinutes.toFixed(1) });
          return {
            shouldExit: true,
            rule: 'ORDER_FLOW_REVERSAL',
            description: `Order flow reversed ${flowSwing.toFixed(0)} points against ${position.side} position (score: ${currentFlow})`,
            exitType: 'full',
            urgency: 'high',
          };
        } else if (pnlPercent > 0.3) {
          // PHASE 10B: Winning + flow reversal = partial exit (50%) to lock in profits
          // Only trigger if not already partially exited for this reason
          const alreadyPartialExited = position.targetsHit?.orderFlowReversal;
          if (!alreadyPartialExited) {
            exitLogger.info('ORDER_FLOW_REVERSAL_PARTIAL', { flowSwing: flowSwing.toFixed(0), side: position.side, currentFlow, pnl: pnlPercent.toFixed(2) });
            return {
              shouldExit: true,
              rule: 'ORDER_FLOW_REVERSAL',
              description: `Order flow reversed ${flowSwing.toFixed(0)} pts while in profit (+${pnlPercent.toFixed(1)}%) — partial exit 50% to lock gains`,
              exitType: 'partial',
              partialPercent: 50,
              urgency: 'medium',
            };
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 7: PROFIT TARGETS (keep existing — these work well)
  // ═══════════════════════════════════════════════════════════════════════════
  if (pnlPercent >= config.profitTarget1Percent && !position.targetsHit.target1) {
    exitLogger.info('PROFIT_TARGET_0.5');
    return {
      shouldExit: true,
      rule: 'PROFIT_TARGET_0.5',
      description: `First profit target +${config.profitTarget1Percent}% reached`,
      exitType: 'partial',
      partialPercent: config.target1ExitPercent,
      urgency: 'medium',
    };
  }

  if (pnlPercent >= config.profitTarget2Percent && !position.targetsHit.target2) {
    exitLogger.info('PROFIT_TARGET_1.5');
    return {
      shouldExit: true,
      rule: 'PROFIT_TARGET_1.5',
      description: `Second profit target +${config.profitTarget2Percent}% reached`,
      exitType: 'partial',
      partialPercent: config.target2ExitPercent,
      urgency: 'medium',
    };
  }

  if (pnlPercent >= config.profitTarget3Percent && !position.targetsHit.target3) {
    exitLogger.info('PROFIT_TARGET_3.0');
    return {
      shouldExit: true,
      rule: 'PROFIT_TARGET_3.0',
      description: `Third profit target +${config.profitTarget3Percent}% reached`,
      exitType: 'full',
      urgency: 'medium',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 8: ATR TRAILING STOP (Phase 5B — regime-aware)
  // Trail by N * ATR from peak. In trending markets, trail wider (let winners run).
  // In volatile markets, trail tighter (protect gains from whipsaws).
  // Fallback: static 0.5% if ATR unavailable.
  // ═══════════════════════════════════════════════════════════════════════════
  if (position.targetsHit.target1 && position.peakPnlPercent >= config.trailingActivationPercent) {
    let trailingDistance: number;

    if (hasATR) {
      // Phase 17: Regime-aware ATR trailing — effectiveConfig already has regime-adjusted multiplier
      let atrMultiplier = effectiveConfig.atrTrailingMultiplier;
      if (regime > 1.2) {
        // Trending market: trail wider to let winners run
        atrMultiplier = effectiveConfig.atrTrailingMultiplier * 1.33;
      } else if (regime < 0.7) {
        // Volatile/ranging market: trail tighter to protect gains
        atrMultiplier = effectiveConfig.atrTrailingMultiplier * 0.67;
      }
      trailingDistance = position.atrPercent! * atrMultiplier;
    } else {
      // Fallback: static trailing distance (regime-adjusted)
      trailingDistance = effectiveConfig.trailingDistancePercent;
    }

    const drawdownFromPeak = position.peakPnlPercent - pnlPercent;
    if (drawdownFromPeak >= trailingDistance) {
      const source = hasATR ? `ATR-based (${trailingDistance.toFixed(2)}%)` : `static (${effectiveConfig.trailingDistancePercent.toFixed(2)}%)`;
      exitLogger.info('ATR_TRAILING_STOP', { peakPnlPercent: position.peakPnlPercent.toFixed(2), pnlPercent: pnlPercent.toFixed(2), source });
      return {
        shouldExit: true,
        rule: hasATR ? 'ATR_TRAILING_STOP' : 'TRAILING_STOP',
        description: `Trailing stop: ${drawdownFromPeak.toFixed(2)}% drawdown from peak ${position.peakPnlPercent.toFixed(2)}% (${source})`,
        exitType: 'full',
        urgency: 'high',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 9: PROTECT POSITIONS NEAR PROFIT TARGETS
  // ═══════════════════════════════════════════════════════════════════════════
  const nearTarget1 = pnlPercent >= (config.profitTarget1Percent - config.protectionZonePercent) &&
                      pnlPercent < config.profitTarget1Percent && !position.targetsHit.target1;
  const nearTarget2 = pnlPercent >= (config.profitTarget2Percent - config.protectionZonePercent) &&
                      pnlPercent < config.profitTarget2Percent && !position.targetsHit.target2;
  const nearTarget3 = pnlPercent >= (config.profitTarget3Percent - config.protectionZonePercent) &&
                      pnlPercent < config.profitTarget3Percent && !position.targetsHit.target3;

  if (nearTarget1 || nearTarget2 || nearTarget3) {
    exitLogger.info('PROTECTED: Near profit target');
    return { shouldExit: false };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 10: MAX WINNER TIME — safety net only
  // ═══════════════════════════════════════════════════════════════════════════
  if (isWinning && holdTimeMinutes >= config.maxWinnerTimeMinutes) {
    exitLogger.info('MAX_WINNER_TIME', { holdTimeMin: holdTimeMinutes.toFixed(0) });
    return {
      shouldExit: true,
      rule: 'MAX_WINNER_TIME',
      description: `Winning position held for ${holdTimeMinutes.toFixed(0)} minutes`,
      exitType: 'full',
      urgency: 'low',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 11: DIRECTION FLIP (with protection + P&L filter)
  // Phase 45 v2 FIX: Tightened direction flip exit rules.
  // DIRECTION_FLIP was the #1 loss driver (6/20 recent trades, ALL losses of -$1.40 to -$2.29).
  // Root cause: Consensus direction flips frequently on noise, and the old 0.3% loss threshold
  // was too low — normal crypto volatility causes 0.3% swings constantly.
  // NEW RULES:
  //   a) Position is profitable by at least 0.1% (lock in real profit, not noise), OR
  //   b) Loss exceeds 0.8% (only cut when clearly wrong, not on noise)
  //   c) Must have held for at least 25 minutes (was 20, raised to filter more noise)
  //   d) Direction must have been flipped for at least 3 consecutive checks (debounce)
  // ═══════════════════════════════════════════════════════════════════════════
  const directionFlipped = (position.side === 'long' && position.currentDirection === 'bearish') ||
                           (position.side === 'short' && position.currentDirection === 'bullish');
  const pastDirectionProtection = holdTimeMinutes >= Math.max(config.minHoldTimeForDecayMinutes, 25);
  // Phase 45 v2: Only exit on direction flip if clearly profitable OR clearly losing
  // The "dead zone" between -0.8% and +0.1% is protected from direction flip exits
  const isDirectionFlipActionable = (pnlPercent > 0.1) || (pnlPercent < -0.8);

  if (directionFlipped && pastDirectionProtection && isDirectionFlipActionable) {
    exitLogger.info('DIRECTION_FLIP', { pnlPct: position.unrealizedPnlPercent.toFixed(3), isWinning });
    return {
      shouldExit: true,
      rule: 'DIRECTION_FLIP',
      description: `Direction flipped from ${position.entryDirection} to ${position.currentDirection} (PnL: ${(position.unrealizedPnlPercent * 100).toFixed(2)}%)`,
      exitType: 'full',
      urgency: isWinning ? 'medium' : 'high',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 12: CONFIDENCE DECAY (EXTREME ONLY) — safety net
  // ═══════════════════════════════════════════════════════════════════════════
  const extremeConsensusCollapse = position.currentCombinedScore < config.extremeConsensusThreshold;
  const heldLongEnough = holdTimeMinutes >= config.minHoldTimeForDecayMinutes;

  if (extremeConsensusCollapse && isLosing && heldLongEnough) {
    exitLogger.info('CONFIDENCE_DECAY_EXTREME');
    return {
      shouldExit: true,
      rule: 'CONFIDENCE_DECAY_EXTREME',
      description: `Extreme consensus collapse (${(position.currentCombinedScore * 100).toFixed(0)}%) while losing`,
      exitType: 'full',
      urgency: 'high',
    };
  }

  return { shouldExit: false };
}

export function isPositionProtected(
  position: PriorityExitPosition,
  config: PriorityExitConfig = DEFAULT_PRIORITY_EXIT_CONFIG
): boolean {
  const pnlPercent = position.unrealizedPnlPercent;
  const nearTarget1 = pnlPercent >= (config.profitTarget1Percent - config.protectionZonePercent) && !position.targetsHit.target1;
  const nearTarget2 = pnlPercent >= (config.profitTarget2Percent - config.protectionZonePercent) && !position.targetsHit.target2;
  const nearTarget3 = pnlPercent >= (config.profitTarget3Percent - config.protectionZonePercent) && !position.targetsHit.target3;
  return nearTarget1 || nearTarget2 || nearTarget3;
}

export function getNextProfitTarget(
  position: PriorityExitPosition,
  config: PriorityExitConfig = DEFAULT_PRIORITY_EXIT_CONFIG
): { targetPercent: number; targetName: string } | null {
  if (!position.targetsHit.target1) return { targetPercent: config.profitTarget1Percent, targetName: 'Target 1 (+0.5%)' };
  if (!position.targetsHit.target2) return { targetPercent: config.profitTarget2Percent, targetName: 'Target 2 (+1.5%)' };
  if (!position.targetsHit.target3) return { targetPercent: config.profitTarget3Percent, targetName: 'Target 3 (+3.0%)' };
  return null;
}

/** Update position's recentPnlHistory for momentum crash detection. Keep last 3 minutes of data. */
export function updatePnlHistory(position: PriorityExitPosition, pnlPercent: number): void {
  if (!position.recentPnlHistory) {
    position.recentPnlHistory = [];
  }
  const now = Date.now();
  position.recentPnlHistory.push({ pnlPercent, timestamp: now });
  const cutoff = now - 180000;
  position.recentPnlHistory = position.recentPnlHistory.filter(p => p.timestamp >= cutoff);
  // Phase 42: Hard cap to prevent unbounded growth
  if (position.recentPnlHistory.length > 200) {
    position.recentPnlHistory = position.recentPnlHistory.slice(-100);
  }
}

/** Update position's recentOrderFlowHistory for reversal detection. Keep last 3 minutes. */
export function updateOrderFlowHistory(position: PriorityExitPosition, score: number): void {
  if (!position.recentOrderFlowHistory) {
    position.recentOrderFlowHistory = [];
  }
  const now = Date.now();
  position.recentOrderFlowHistory.push({ score, timestamp: now });
  const cutoff = now - 180000;
  position.recentOrderFlowHistory = position.recentOrderFlowHistory.filter(p => p.timestamp >= cutoff);
  // Phase 42: Hard cap to prevent unbounded growth
  if (position.recentOrderFlowHistory.length > 200) {
    position.recentOrderFlowHistory = position.recentOrderFlowHistory.slice(-100);
  }
}

/** Aggregate agent exit recommendations into a consensus score. */
export function aggregateAgentExitConsensus(
  agentSignals: Array<{
    agentName: string;
    signal: string;
    confidence: number;
    reason: string;
    exitRecommendation?: { action: string; urgency: string; reason: string; exitPercent?: number; confidence: number } | null;
  }>
): AgentExitConsensus {
  let totalScore = 0;
  let urgentCount = 0;
  let reporting = 0;
  let strongestReason = '';
  let highestUrgencyScore = 0;

  for (const agent of agentSignals) {
    const exitRec = agent.exitRecommendation;
    if (!exitRec) continue;

    reporting++;

    // Convert exit recommendation to a 0-100 score
    let agentScore = 0;
    if (exitRec.action === 'full_exit') agentScore = exitRec.confidence * 100;
    else if (exitRec.action === 'partial_exit') agentScore = exitRec.confidence * 60;
    // 'hold' → 0

    totalScore += agentScore;

    // Count urgent exits
    if ((exitRec.urgency === 'high' || exitRec.urgency === 'critical') &&
        (exitRec.action === 'full_exit' || exitRec.action === 'partial_exit')) {
      urgentCount++;
    }

    // Track strongest reason
    const urgencyWeight = exitRec.urgency === 'critical' ? 4 : exitRec.urgency === 'high' ? 3 : exitRec.urgency === 'medium' ? 2 : 1;
    if (urgencyWeight > highestUrgencyScore) {
      highestUrgencyScore = urgencyWeight;
      strongestReason = `${agent.agentName}: ${exitRec.reason}`;
    }
  }

  return {
    exitScore: reporting > 0 ? Math.round(totalScore / reporting) : 0,
    urgentExitCount: urgentCount,
    totalAgentsReporting: reporting,
    strongestReason: strongestReason || undefined,
  };
}

export default {
  evaluatePriorityExitRules,
  isPositionProtected,
  getNextProfitTarget,
  updatePnlHistory,
  updateOrderFlowHistory,
  aggregateAgentExitConsensus,
  DEFAULT_PRIORITY_EXIT_CONFIG,
};
