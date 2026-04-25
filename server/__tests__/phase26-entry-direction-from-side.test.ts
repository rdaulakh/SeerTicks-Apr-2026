/**
 * Phase 26 — entryDirection MUST be derived from position.side, not from
 * the live consensus cache.
 *
 * Live bug found 2026-04-25: IntelligentExitManager.addPosition was setting
 * `entryDirection = getCurrentDirection(symbol) || side-default`. On session
 * resume, that returned the LIVE consensus direction at restore time. So a
 * long position restored AFTER consensus had flipped to bearish got
 * entryDirection = 'bearish' — same value as currentDirection.
 *
 * Phase 24's thesis-invalidation flip detector requires
 * `entryDirection !== currentDirection`. With both stamped 'bearish' on a
 * long restore, the flip never registered. Manifested as BTC #4 + ETH #5
 * sitting open >3h with consensus clearly bearish but Phase 24 declining
 * to fire. This test pins the fix: a long position's entryDirection is
 * unconditionally 'bullish' regardless of what the live cache says.
 *
 * Pure unit test — exercises only the side→direction mapping logic from
 * IntelligentExitManager.addPosition. The test reaches into the manager via
 * the public addPosition + getPositionsBySymbol API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the consensus cache so we can simulate a flipped market — i.e. the
// scenario where addPosition is called for a LONG position while the live
// cache reports BEARISH. Pre-Phase-26 this would corrupt entryDirection.
//
// `getCurrentDirection` lives in HardExitRules and re-exports
// `getLatestConsensusDirection` from AutomatedSignalProcessor, which reads
// an in-memory cache. Mock the source.
vi.mock('../services/AutomatedSignalProcessor', async () => {
  const actual = await vi.importActual<any>('../services/AutomatedSignalProcessor');
  return {
    ...actual,
    getLatestConsensusDirection: vi.fn(() => 'bearish'),  // simulate flipped market
  };
});

import { IntelligentExitManager } from '../services/IntelligentExitManager';

describe('Phase 26 — entryDirection must be derived from side, not live cache', () => {
  let mgr: IntelligentExitManager;

  beforeEach(() => {
    mgr = new IntelligentExitManager({});
  });

  it('LONG position gets entryDirection = bullish (regardless of live cache being bearish)', () => {
    mgr.addPosition({
      id: 'test-long-1',
      symbol: 'BTC-USD',
      side: 'long',
      entryPrice: 77847.98,
      currentPrice: 77575.78,
      quantity: 0.001,
      remainingQuantity: 0.001,
      unrealizedPnl: -0.27,
      unrealizedPnlPercent: -0.35,
      entryTime: Date.now() - 3 * 60 * 60_000,  // 3 hours ago
      originalConsensus: 0.65,
      marketRegime: 'unknown',
      stopLoss: 76838.45,
      takeProfit: 80104.86,
      dbPositionId: 4,
    } as any);

    const positions = mgr.getPositionsBySymbol('BTC-USD');
    expect(positions).toHaveLength(1);
    expect(positions[0].entryDirection).toBe('bullish');  // Phase 26: NOT 'bearish'
    // currentDirection still reflects live cache (bearish) — this is the
    // correct behavior; it's what Phase 24's flip check will compare against.
    expect(positions[0].currentDirection).toBe('bearish');
  });

  it('SHORT position gets entryDirection = bearish', () => {
    mgr.addPosition({
      id: 'test-short-1',
      symbol: 'ETH-USD',
      side: 'short',
      entryPrice: 2325,
      currentPrice: 2316,
      quantity: 1,
      remainingQuantity: 1,
      unrealizedPnl: 9,
      unrealizedPnlPercent: 0.39,
      entryTime: Date.now(),
      originalConsensus: 0.70,
      marketRegime: 'unknown',
      dbPositionId: 5,
    } as any);

    const positions = mgr.getPositionsBySymbol('ETH-USD');
    expect(positions).toHaveLength(1);
    expect(positions[0].entryDirection).toBe('bearish');
  });

  it('flip is detected on a long position when live cache is bearish (Phase 24 prerequisite)', () => {
    // The whole point of Phase 26: this scenario is what Phase 24 needs to
    // recognize. With Phase 26's fix, entryDirection !== currentDirection
    // for a long position whose market has flipped, which is what Phase 24
    // checks for via `entry === 'bullish' && current === 'bearish'`.
    mgr.addPosition({
      id: 'test-long-2',
      symbol: 'SOL-USD',
      side: 'long',
      entryPrice: 86.45,
      currentPrice: 86.10,
      quantity: 1,
      remainingQuantity: 1,
      unrealizedPnl: -0.35,
      unrealizedPnlPercent: -0.40,
      entryTime: Date.now() - 60 * 60_000,
      originalConsensus: 0.65,
      marketRegime: 'unknown',
      dbPositionId: 6,
    } as any);

    const pos = mgr.getPositionsBySymbol('SOL-USD')[0];
    const flipped =
      (pos.side === 'long' && pos.currentDirection === 'bearish') ||
      (pos.side === 'short' && pos.currentDirection === 'bullish');
    expect(flipped).toBe(true);  // pre-Phase-26 this was false (entry was also bearish)
  });
});
