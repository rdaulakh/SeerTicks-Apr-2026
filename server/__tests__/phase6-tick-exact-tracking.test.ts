/**
 * Phase 6 — "Tick-exact tracking" behavioral tests
 *
 * Guard the change that moves the O(1) synchronous price/P&L/peak/breakeven
 * update OUT from under the 200ms async-eval debounce in
 * IntelligentExitManager.onPriceTick.
 *
 * Pre-Phase-6 behavior (the hole this phase plugs):
 *   - At 40–50 Hz websocket tick rates, the 200ms debounce gated the ENTIRE
 *     tick handler. So on 7 out of every 8 ticks, position.currentPrice,
 *     unrealizedPnlPercent, peakPnlPercent, and breakeven activation were
 *     all skipped.
 *   - A price spike to +0.7% that fully reverses to +0.1% inside 200ms
 *     would leave position.breakevenActivated = false. The Phase 5
 *     invariant "breakeven flips the SL inward" never fires, and the
 *     winner can become a loser when price drifts back through entry.
 *
 * Post-Phase-6 behavior guarded here:
 *   1. updatePositionPriceSync runs on every tick — P&L and peak track
 *      the true intra-debounce extremum.
 *   2. activateBreakeven fires on the FIRST tick whose PnL crosses the
 *      activation threshold, regardless of whether that tick would have
 *      been debounced before.
 *   3. The sync path mutates position.stopLoss (the Phase 5 invariant)
 *      at tick precision, not eval precision.
 *
 * The tests call onPriceTick() directly (not the deprecated updatePrice
 * path used in phase5-winner-protection) — this is the exact code path
 * the live CoinbasePublicWebSocket → priceFeedService → UserTradingSession
 * chain invokes in production.
 *
 * NOTE: IntelligentExitManager.addPosition() spreads the input into a new
 * internal Position object stored in its Map, so mutations to the input
 * reference don't reflect. All assertions look up the internal position
 * via getStatus() after addPosition().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligentExitManager, type Position } from '../services/IntelligentExitManager';

function makeLongPosition(overrides: Partial<Position> = {}): Position {
  const entryPrice = 100;
  return {
    id: 'phase6-pos',
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
    stopLoss: entryPrice * (1 - 0.012), // wide -1.2% stop
    takeProfit: entryPrice * 1.03,
    ...overrides,
  };
}

function getInternal(manager: IntelligentExitManager, id: string): Position {
  const p = manager.getStatus().positions.find((x) => x.id === id);
  if (!p) throw new Error(`position ${id} not in manager`);
  return p;
}

describe('Phase 6 — tick-exact P&L + breakeven tracking (onPriceTick)', () => {
  let manager: IntelligentExitManager;

  beforeEach(() => {
    manager = new IntelligentExitManager({
      breakevenActivationPercent: 0.5, // +0.5% triggers breakeven
      breakevenBuffer: 0.1,             // 0.1% above entry
      // Turn off hard exit rules so we can test pure price-tick tracking
      // without the async priority-exit path firing async fetches.
      useHardExitRules: false,
    });
    manager.setCallbacks({
      getAgentSignals: async () => [],
      getCurrentPrice: async () => 100,
      executeExit: async () => {},
      getMarketRegime: async () => 'trending',
      getCurrentConsensus: async () => 0.75,
    });
  });

  it('activates breakeven on a debounced tick (the bug pre-Phase-6)', async () => {
    const pos = makeLongPosition({ entryPrice: 100 });
    manager.addPosition(pos);

    // t=0  — +0.3% (below 0.5% activation), full processing
    // t=50 — +0.7% (ABOVE activation) BUT within 200ms debounce.
    //        Pre-Phase-6 this tick was fully skipped → breakeven never fires.
    //        Post-Phase-6 the sync path still runs → breakeven fires here.
    const baseTs = 10_000_000; // deterministic timestamps (not real time)

    await manager.onPriceTick('BTC-USD', 100.3, baseTs);
    expect(getInternal(manager, pos.id).breakevenActivated).toBe(false); // below threshold

    await manager.onPriceTick('BTC-USD', 100.7, baseTs + 50);
    const after = getInternal(manager, pos.id);
    // Pre-Phase-6: this assertion failed — debounce swallowed the tick.
    // Post-Phase-6: sync pass ran, breakeven fired.
    expect(after.breakevenActivated).toBe(true);
    expect(after.stopLoss).toBeCloseTo(100.1, 4); // entry + 0.1% buffer
    expect(after.unrealizedPnlPercent).toBeCloseTo(0.7, 4);
  });

  it('tracks peakPnlPercent at the intra-debounce true peak', async () => {
    const pos = makeLongPosition({ entryPrice: 100 });
    manager.addPosition(pos);

    const baseTs = 20_000_000;

    // Four ticks rapid-fire, all within the 200ms debounce window except the first.
    // Peak is at t=50 (+0.9%). Pre-Phase-6: ticks 2–4 skipped, peak recorded
    // only for tick 1 (+0.3%). Post-Phase-6: peak updates on every tick.
    await manager.onPriceTick('BTC-USD', 100.3, baseTs);        // peak so far: 0.3%
    await manager.onPriceTick('BTC-USD', 100.9, baseTs + 50);   // peak now: 0.9%
    await manager.onPriceTick('BTC-USD', 100.4, baseTs + 100);  // peak unchanged
    await manager.onPriceTick('BTC-USD', 100.1, baseTs + 150);  // peak unchanged

    const after = getInternal(manager, pos.id);
    expect(after.peakPnlPercent).toBeCloseTo(0.9, 4);
    // Also: highestPrice must reflect true high
    expect(after.highestPrice).toBeCloseTo(100.9, 4);
  });

  it('keeps currentPrice and unrealizedPnlPercent fresh on debounced ticks', async () => {
    const pos = makeLongPosition({ entryPrice: 100 });
    manager.addPosition(pos);

    const baseTs = 30_000_000;

    await manager.onPriceTick('BTC-USD', 100.2, baseTs);
    await manager.onPriceTick('BTC-USD', 100.4, baseTs + 30);   // within debounce
    await manager.onPriceTick('BTC-USD', 100.45, baseTs + 60);  // within debounce

    const after = getInternal(manager, pos.id);
    // Pre-Phase-6: pos.currentPrice would stay at 100.2 (last processed tick).
    // Post-Phase-6: currentPrice follows every tick.
    expect(after.currentPrice).toBeCloseTo(100.45, 4);
    expect(after.unrealizedPnlPercent).toBeCloseTo(0.45, 4);
  });

  it('idempotent — debounced ticks never re-fire breakeven activation', async () => {
    const pos = makeLongPosition({ entryPrice: 100 });
    let fireCount = 0;
    manager.on('breakeven_activated', () => {
      fireCount++;
    });

    manager.addPosition(pos);

    const baseTs = 40_000_000;
    // Three ticks all above activation, all within debounce — only the first
    // should emit the event even though the sync pass runs every time.
    await manager.onPriceTick('BTC-USD', 100.6, baseTs);
    await manager.onPriceTick('BTC-USD', 100.8, baseTs + 50);
    await manager.onPriceTick('BTC-USD', 101.0, baseTs + 100);

    expect(fireCount).toBe(1);
    expect(getInternal(manager, pos.id).breakevenActivated).toBe(true);
  });

  it('handles shorts symmetrically — breakeven on a debounced drop', async () => {
    // Short at 100; price drops to 99.4 (profit of 0.6%) on a debounced tick.
    const pos: Position = {
      ...makeLongPosition(),
      id: 'phase6-pos-short',
      side: 'short',
      stopLoss: 100 * (1 + 0.012), // wide short SL is ABOVE entry
    };
    manager.addPosition(pos);

    const baseTs = 50_000_000;

    await manager.onPriceTick('BTC-USD', 99.8, baseTs);         // +0.2% — below threshold
    expect(getInternal(manager, pos.id).breakevenActivated).toBe(false);

    await manager.onPriceTick('BTC-USD', 99.4, baseTs + 40);    // +0.6% — debounced tick
    const after = getInternal(manager, pos.id);
    expect(after.breakevenActivated).toBe(true);
    expect(after.stopLoss).toBeCloseTo(99.9, 4); // entry - 0.1% buffer
  });
});
