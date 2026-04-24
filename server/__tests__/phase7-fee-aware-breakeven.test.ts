/**
 * Phase 7 — "Fee-Aware Breakeven" behavioral tests
 *
 * Guards the two coupled changes that close the Phase 5 winner-protection
 * gap at the ProfitLockGuard boundary:
 *
 *   1. Fee-aware breakeven buffer
 *      Prior state: breakevenActivationPercent=0.5, breakevenBuffer=0.1.
 *      When the breakeven stop triggered, gross PnL was +0.1% →
 *        net = 0.1% − 0.25% (fees+slip) = −0.15%.
 *      ProfitLockGuard correctly BLOCKED the exit (net < 0.15% floor), so
 *      the position bled through to the catastrophic floor and Phase 5's
 *      "iron-clad breakeven floor" claim was silently wrong.
 *
 *      Phase 7 raises buffer from 0.1 → 0.5 and activation from 0.5 → 0.8,
 *      so the breakeven-stop lands at gross +0.5% = net +0.25% — clearing
 *      the net-profit floor so the exit ACTUALLY fires.
 *
 *   2. catastrophicStopPercent aligned to hardStopLossPercent
 *      Prior state: hardStopLossPercent=-1.2, catastrophicStopPercent=-2.5.
 *      A "Stop-Loss hit" at the configured -1.2% level got blocked by
 *      ProfitLockGuard, and the IntelligentExitManager fallback bypass
 *      (requires gross ≤ catastrophicStopPercent) didn't fire until the
 *      position had bled another 1.3% to -2.5%. Effective hard stop was
 *      -2.5%, not -1.2%.
 *
 *      Phase 7 tightens catastrophicStopPercent to -1.2 so the bypass
 *      fires at the configured hard-stop level, capping loss at the
 *      intended -1.2% gross (-1.45% net).
 *
 * Together these make the Phase 5 invariant "a winner never becomes a
 * loser past -0.15% net" actually hold in live prod, not just in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligentExitManager, type Position } from '../services/IntelligentExitManager';
import { shouldAllowClose } from '../services/ProfitLockGuard';
import { getTradingConfig, setTradingConfig, PRODUCTION_CONFIG } from '../config/TradingConfig';

// ── Fixture (Phase-6 style, relies on manager.getStatus for internal state) ──

function makeLongPosition(overrides: Partial<Position> = {}): Position {
  const entryPrice = 100;
  return {
    id: 'phase7-pos',
    symbol: 'BTC-USD',
    side: 'long',
    entryPrice,
    currentPrice: entryPrice,
    quantity: 1,
    remainingQuantity: 1,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    entryTime: Date.now(),
    highestPrice: entryPrice,
    lowestPrice: entryPrice,
    breakevenActivated: false,
    partialExits: [],
    agentSignals: [],
    marketRegime: 'trending',
    originalConsensus: 0.75,
    lastAgentCheck: Date.now(),
    stopLoss: entryPrice * (1 - 0.012),
    takeProfit: entryPrice * 1.03,
    ...overrides,
  };
}

function getInternal(manager: IntelligentExitManager, id: string): Position {
  const p = manager.getStatus().positions.find((x) => x.id === id);
  if (!p) throw new Error(`position ${id} not in manager`);
  return p;
}

describe('Phase 7 — fee-aware breakeven (DEFAULT_CONFIG)', () => {
  let manager: IntelligentExitManager;

  beforeEach(() => {
    // No config override — use the new DEFAULT_CONFIG (activation 0.8 / buffer 0.5).
    manager = new IntelligentExitManager();
  });

  it('activates breakeven at +0.8% and moves stopLoss to entry + 0.5%', () => {
    const pos = makeLongPosition({ entryPrice: 100 });
    manager.addPosition(pos);

    // +0.6% — below the new 0.8% activation threshold. Must NOT activate.
    manager.updatePrice(pos.id, 100.6);
    expect(getInternal(manager, pos.id).breakevenActivated).toBe(false);

    // +0.9% — crosses activation. Breakeven fires, stopLoss moves to entry + 0.5%.
    manager.updatePrice(pos.id, 100.9);
    const after = getInternal(manager, pos.id);
    expect(after.breakevenActivated).toBe(true);
    expect(after.stopLoss).toBeCloseTo(100.5, 4); // 100 + 100 * (0.5 / 100)
  });

  it('short at entry 100 moves stopLoss to entry − 0.5% on activation', () => {
    const pos: Position = {
      ...makeLongPosition(),
      id: 'phase7-short',
      side: 'short',
      stopLoss: 100 * (1 + 0.012), // wide short SL above entry
    };
    manager.addPosition(pos);

    // Price drop 100 → 99.1 = +0.9% for a short. Crosses activation (0.8%).
    manager.updatePrice(pos.id, 99.1);
    const after = getInternal(manager, pos.id);
    expect(after.breakevenActivated).toBe(true);
    expect(after.stopLoss).toBeCloseTo(99.5, 4); // 100 − 100 * (0.5 / 100)
  });

  it('ratchet guard — does not widen a pre-existing tighter stop', () => {
    // Simulate a trailing stop that's already tightened to entry + 0.7%
    // (tighter than the new breakeven target of entry + 0.5%).
    const pos = makeLongPosition({ entryPrice: 100, stopLoss: 100.7 });
    manager.addPosition(pos);

    manager.updatePrice(pos.id, 100.9);
    const after = getInternal(manager, pos.id);

    expect(after.breakevenActivated).toBe(true);
    // Must NOT widen the stop back out to 100.5 — tighter existing stop wins.
    expect(after.stopLoss).toBe(100.7);
  });
});

describe('Phase 7 — breakeven-stop exit clears the ProfitLockGuard floor', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('ProfitLockGuard ALLOWS a close at the new breakeven stop level (gross +0.5%, net +0.25%)', () => {
    // Price at 100.5 for a long entry at 100 → gross +0.5%.
    // After 0.25% fees+slip → net +0.25%, clearing the 0.15% floor.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.5,
      'Stop-Loss hit: Price $100.50 breached SL $100.50 (+0.50%)',
    );
    expect(res.allow).toBe(true);
    expect(res.grossPnlPercent).toBeCloseTo(0.5, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.25, 4);
    // Must be via the net-profit-ok path (NOT the catastrophic bypass —
    // a breakeven-stop exit is a legit profitable close, not a blow-up).
    expect(res.reason).toMatch(/net_profit_ok/);
  });

  it('regression anchor — the OLD 0.1% breakeven buffer would have been BLOCKED', () => {
    // At gross +0.1% (old buffer) with a non-catastrophic-underscore reason,
    // the guard correctly blocked the close because net PnL = −0.15%.
    // This test documents the pre-Phase-7 bug that Phase 7 closes structurally.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.1,
      'Stop-Loss hit: Price $100.10 breached SL $100.10 (+0.10%)',
    );
    expect(res.allow).toBe(false);
    expect(res.netPnlPercent).toBeCloseTo(-0.15, 4);
  });
});

describe('Phase 7 — catastrophicStopPercent aligned to hardStopLossPercent', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('production config: catastrophicStopPercent matches hardStopLossPercent', () => {
    const cfg = getTradingConfig();
    expect(cfg.profitLock.catastrophicStopPercent).toBe(-1.2);
    expect(cfg.exits.hardStopLossPercent).toBe(-1.2);
    // They must stay in lockstep — the guard / exit-manager hand-off relies
    // on the catastrophic floor being at least as tight as the hard stop.
    expect(cfg.profitLock.catastrophicStopPercent).toBeGreaterThanOrEqual(
      cfg.exits.hardStopLossPercent,
    );
  });

  it('ALLOWS close at gross −1.2% via catastrophic_grossPnl (the real hard stop)', () => {
    // A long that's hit its -1.2% hard-SL level. Non-underscore reason
    // string "Stop-Loss hit" does NOT match isCatastrophicReason patterns.
    // Prior config (-2.5%) left this BLOCKED; Phase 7 allows it because
    // gross −1.2% ≤ catastrophicStopPercent (−1.2%).
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      98.8,
      'Stop-Loss hit: Price $98.80 breached SL $98.80 (-1.20%)',
    );
    expect(res.allow).toBe(true);
    expect(res.grossPnlPercent).toBeCloseTo(-1.2, 4);
    expect(res.reason).toMatch(/catastrophic_grossPnl/);
  });

  it('still BLOCKS a non-catastrophic close at −1.0% (above the hard-stop floor)', () => {
    // Gross -1.0% is NOT past the hard-stop floor yet. Discretionary exits
    // (e.g. time-exit, consensus flip) at this level must still be blocked
    // — the whole point of the profit lock is to hold losers that haven't
    // yet reached the committed stop.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      99,
      'time_exit',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(-1, 4);
  });
});
