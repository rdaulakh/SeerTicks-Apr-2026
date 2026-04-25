/**
 * Phase 30 — Post-trade feedback loop must use REAL realized PnL.
 *
 * Pre-Phase-30 audit on 2026-04-25 revealed:
 *   1. /home/seer/app/data/agent-performance.json never created on prod
 *      (the path persistPerformanceToFile writes to). AgentWeightManager
 *      flushes every 10 records — zero file means zero records ever
 *      reached recordPerformance.
 *   2. The IEM-driven exit path emits `exit_executed` from
 *      UserTradingSession line ~329 WITHOUT pnl in the payload:
 *        this.emit('exit_executed', { positionId, reason, price, symbol });
 *      The recordTradeOutcome listener at line 619 read
 *      `data.pnl || data.realizedPnl || 0` → always 0 → wasProfit=false.
 *   3. AgentWeightManager.recordTradeOutcome's correctness rule:
 *        Long + actuallyProfit  → bullish=correct, bearish=wrong
 *        Long + !actuallyProfit → bullish=wrong, bearish=correct
 *      With pnl always 0, every trade was treated as a LOSS — agents
 *      voting WITH the trade direction were repeatedly marked WRONG and
 *      dissenters marked CORRECT. The system was actively MIS-training.
 *
 * Phase 30 fix:
 *   - Wire UserTradingSession to PaperTradingEngine's `position_closed`
 *     event (which carries the real realized pnl from closePosition's
 *     pnlMultiplier × (exit-entry) × qty calculation).
 *   - Remove the exit_executed-side recordTradeOutcome to avoid double-
 *     counting once position_closed is the canonical trigger.
 *   - Add observability logs in DecisionEvaluator's record* methods so
 *     the loop is visible in pm2 logs going forward.
 *
 * This test verifies the correctness rule directly against
 * AgentWeightManager: a winning long with bullish-voting agents must
 * score those agents as correct. Pre-Phase-30 the bug surfaced as a
 * pnl=0 path; post-Phase-30 the real pnl flows through.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentWeightManager } from '../services/AgentWeightManager';

describe('Phase 30 — feedback loop attribution semantics', () => {
  let mgr: AgentWeightManager;

  beforeEach(() => {
    // skipHydration prevents test cross-contamination from any leftover
    // agent-performance.json on disk (see Phase 15 hydration policy).
    mgr = new AgentWeightManager(99999, { skipHydration: true });
  });

  it('winning long: bullish-voting agents are marked CORRECT', () => {
    mgr.recordTradeOutcome(
      [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85 },
        { agentName: 'PatternMatcher', signal: 'bullish', confidence: 0.80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bearish', confidence: 0.50 },
      ],
      'long',
      true,   // wasProfit (legacy positional arg)
      +0.50,  // pnlAfterCosts — POSITIVE → bullish-correct
    );

    const tech = mgr.getAgentMetrics('TechnicalAnalyst');
    const pattern = mgr.getAgentMetrics('PatternMatcher');
    const flow = mgr.getAgentMetrics('OrderFlowAnalyst');

    expect(tech.accuracy).toBe(1);     // 1/1 correct
    expect(pattern.accuracy).toBe(1);  // 1/1 correct
    expect(flow.accuracy).toBe(0);     // bearish on a winning long → wrong
  });

  it('losing long: bullish-voting agents are marked WRONG', () => {
    mgr.recordTradeOutcome(
      [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85 },
        { agentName: 'OrderFlowAnalyst', signal: 'bearish', confidence: 0.50 },
      ],
      'long',
      false,
      -0.30,  // pnlAfterCosts — NEGATIVE → bearish-correct
    );

    expect(mgr.getAgentMetrics('TechnicalAnalyst').accuracy).toBe(0);
    expect(mgr.getAgentMetrics('OrderFlowAnalyst').accuracy).toBe(1);
  });

  it('THE BUG: pnl=0 with wasProfit=true is now overridden by pnlAfterCosts', () => {
    // Reproduces the pre-Phase-30 bug class: caller said "wasProfit=true"
    // but pnl in the call was 0. Phase 5's cost-aware logic at
    // AgentWeightManager:558 makes pnlAfterCosts the source of truth when
    // provided. With pnlAfterCosts=0, `actuallyProfit = 0 > 0 = false`.
    // So even with wasProfit=true, agents get attributed as if the trade
    // lost. This is exactly what was happening on prod.
    //
    // The Phase 30 fix is at the CALL SITE — the position_closed listener
    // passes the REAL pnl (not 0), so this bug-class disappears upstream.
    // This test pins the semantic so any future regression is caught.
    mgr.recordTradeOutcome(
      [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85 }],
      'long',
      true,
      0,  // BUG: pnlAfterCosts=0 → actuallyProfit=false → bullish marked wrong
    );
    expect(mgr.getAgentMetrics('TechnicalAnalyst').accuracy).toBe(0);
  });

  it('winning short: bearish-voting agents are marked CORRECT', () => {
    mgr.recordTradeOutcome(
      [
        { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.80 },
        { agentName: 'PatternMatcher', signal: 'bullish', confidence: 0.60 },
      ],
      'short',
      true,
      +0.40,
    );

    expect(mgr.getAgentMetrics('TechnicalAnalyst').accuracy).toBe(1);
    expect(mgr.getAgentMetrics('PatternMatcher').accuracy).toBe(0);
  });

  it('neutral signals are SKIPPED (not counted as right or wrong)', () => {
    mgr.recordTradeOutcome(
      [{ agentName: 'TechnicalAnalyst', signal: 'neutral', confidence: 0.5 }],
      'long',
      true,
      +0.20,
    );
    // Neutral skipped → 0 samples for this agent
    expect(mgr.getAgentMetrics('TechnicalAnalyst').samples).toBe(0);
  });

  it('repeated trades accumulate accuracy over the rolling window', () => {
    // 5 wins, 5 losses on bullish-vote, all longs
    for (let i = 0; i < 5; i++) {
      mgr.recordTradeOutcome(
        [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85 }],
        'long',
        true,
        +0.20,
      );
    }
    for (let i = 0; i < 5; i++) {
      mgr.recordTradeOutcome(
        [{ agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85 }],
        'long',
        false,
        -0.30,
      );
    }
    const m = mgr.getAgentMetrics('TechnicalAnalyst');
    expect(m.samples).toBe(10);
    expect(m.accuracy).toBe(0.5);
  });
});
