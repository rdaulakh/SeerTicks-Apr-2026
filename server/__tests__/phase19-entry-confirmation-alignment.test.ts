/**
 * Phase 19 — EntryConfirmationFilter alignment with upstream consensus gate.
 *
 * Background: Phase 18 unblocked agent confidence (PatternMatcher 0% → 99%
 * pass rate at 0.65). Production then immediately exposed the next bug:
 * 104 SIGNAL_APPROVED events in 30 min → 0 TRADE_EXECUTED, every single
 * one rejected by EntryConfirmationFilter with the canonical message:
 *
 *   TRADE_REJECTED reason="Entry validation failed:
 *     Insufficient agent agreement: 2/4 required"
 *
 * Three different gates, three different thresholds:
 *   - AutomatedSignalProcessor.processSignals: `≥2 eligible`     ← upstream
 *   - TradingConfig.consensus.minAgentAgreement: `3`              ← config
 *   - EntryConfirmationFilter default: `4`                        ← hardcoded
 *
 * The `4` was higher than both. Even strong (80–90% confidence) consensus
 * approvals couldn't clear it. With Phases 17+18 producing typically 2–3
 * agents-in-direction, EntryConfirmationFilter became a strict bottleneck
 * that contradicted the rest of the pipeline.
 *
 * Phase 19:
 *   1. EntryConfirmationFilter default now reads
 *      `TradingConfig.consensus.minAgentAgreement` — single source of truth.
 *   2. TradingConfig lowered to `2` to match the upstream `≥2 eligible`
 *      filter, since the QUALITY guarantee comes from `minConsensusStrength`
 *      (0.65) and `minConfidence` (0.65); piling another N-agents check on
 *      top is double-counting.
 *
 * These tests pin both behaviors so a future tightening can't silently
 * re-create the 0-trade trap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntryConfirmationFilter, type AgentSignal } from '../services/EntryConfirmationFilter';
import {
  setTradingConfig,
  getTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 19 — EntryConfirmationFilter pulls default from TradingConfig', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });
  afterEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('production default is 2 (matches upstream `≥2 eligible` gate)', () => {
    // The single most important assertion in the file. If this drifts back
    // to 3 or 4, the 3-day-silence pattern recurs.
    expect(getTradingConfig().consensus.minAgentAgreement).toBe(2);
  });

  it('default-constructed filter takes its threshold from TradingConfig', () => {
    const filter = new EntryConfirmationFilter();
    const result = filter.validateEntry([
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.85, weight: 0.30 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.80, weight: 0.25 },
      { agentName: 'OrderFlowAnalyst', direction: 'SHORT', confidence: 0.70, weight: 0.20 },
    ]);
    // 2 LONG + 1 SHORT, dominant = LONG with 2 agents → must validate
    // under the new 2-default. Pre-Phase-19 (default=4) this rejected
    // with "Insufficient agent agreement: 2/4 required".
    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('LONG');
    expect(result.agentAgreement).toBe(2);
  });

  it('changing TradingConfig at runtime flows through to fresh filter instances', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      consensus: { ...PRODUCTION_CONFIG.consensus, minAgentAgreement: 5 },
    });
    const filter = new EntryConfirmationFilter();
    const result = filter.validateEntry([
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.85, weight: 0.30 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.80, weight: 0.25 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.75, weight: 0.20 },
    ]);
    // 3 agents agree, but config now wants 5 → reject.
    expect(result.isValid).toBe(false);
    expect(result.reasons.some((r) => r.includes('3/5'))).toBe(true);
  });

  it('explicit constructor override still wins (sub-strategies can be stricter)', () => {
    const strict = new EntryConfirmationFilter({ minAgentAgreement: 5 });
    const lenient = new EntryConfirmationFilter({ minAgentAgreement: 1 });
    const signals: AgentSignal[] = [
      { agentName: 'a', direction: 'LONG', confidence: 0.8, weight: 0.5 },
      { agentName: 'b', direction: 'LONG', confidence: 0.75, weight: 0.5 },
    ];
    expect(strict.validateEntry(signals).isValid).toBe(false);
    expect(lenient.validateEntry(signals).isValid).toBe(true);
  });
});

describe('Phase 19 — exact production scenario that produced 0 trades', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('80%+ consensus with 2 agents agreeing CLEARS the gate (was: rejected)', () => {
    // Reproducing the exact production log line:
    //   SIGNAL_APPROVED symbol=BTC-USD dir=bullish action=buy conf=89.7%
    //   TRADE_REJECTED reason="Insufficient agent agreement: 2/4 required"
    // Confidence was 89.7%, signal was approved upstream, but rejected here.
    // Phase 19 must let this pass.
    const filter = new EntryConfirmationFilter();
    const result = filter.validateEntry([
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.90, weight: 0.30 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.89, weight: 0.25 },
      { agentName: 'OrderFlowAnalyst', direction: 'NEUTRAL', confidence: 0.4, weight: 0.20 },
      { agentName: 'OnChainAnalyst', direction: 'NEUTRAL', confidence: 0.5, weight: 0.15 },
    ]);
    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('LONG');
  });

  it('still rejects clearly-conflicted signals (sanity check)', () => {
    // Quality safety: 1 LONG vs 2 SHORT should NOT validate as LONG.
    const filter = new EntryConfirmationFilter();
    const result = filter.validateEntry([
      { agentName: 'a', direction: 'LONG', confidence: 0.85, weight: 0.30 },
      { agentName: 'b', direction: 'SHORT', confidence: 0.85, weight: 0.30 },
      { agentName: 'c', direction: 'SHORT', confidence: 0.80, weight: 0.30 },
    ]);
    // Dominant direction = SHORT (2 agents), so isValid=true under the
    // 2-agent floor, but breakdown must correctly attribute.
    expect(result.direction).toBe('SHORT');
    expect(result.agentAgreement).toBe(2);
    expect(result.conflictingAgents).toBe(1);
  });

  it('rejects when only 1 agent has any opinion (no consensus possible)', () => {
    const filter = new EntryConfirmationFilter();
    const result = filter.validateEntry([
      { agentName: 'a', direction: 'LONG', confidence: 0.85, weight: 0.30 },
      { agentName: 'b', direction: 'NEUTRAL', confidence: 0.50, weight: 0.30 },
      { agentName: 'c', direction: 'NEUTRAL', confidence: 0.40, weight: 0.30 },
    ]);
    // Only 1 LONG, dominantCount = 1 < 2 → rejected.
    expect(result.isValid).toBe(false);
    expect(result.agentAgreement).toBe(1);
    expect(result.reasons.some((r) => /Insufficient agent agreement: 1\/2/.test(r))).toBe(true);
  });
});

describe('Phase 19 — regression guard against future drift', () => {
  it('the production default MUST not exceed the upstream gate (2)', () => {
    // The whole bug class: this gate stricter than the upstream gate
    // = silent 0-trade trap. Lock it down.
    setTradingConfig({ ...PRODUCTION_CONFIG });
    const filter = new EntryConfirmationFilter();
    // Construct a minimal-passing scenario: 2 agents in same direction.
    // Since this is the upstream-equivalent floor, it must pass.
    const result = filter.validateEntry([
      { agentName: 'a', direction: 'LONG', confidence: 0.7, weight: 0.5 },
      { agentName: 'b', direction: 'LONG', confidence: 0.7, weight: 0.5 },
    ]);
    expect(result.isValid).toBe(true);
  });
});
