/**
 * Phase 35 — Net directional bias cap on correlated group.
 *
 * Pre-Phase-35 PortfolioRiskManager capped TOTAL group exposure (25% of
 * equity) but didn't cap NET DELTA. A user could go long BTC + long ETH
 * + long SOL — three correlated longs all at the symbol-cap, totaling
 * up to the group-cap — and that's a 3x compounded directional bet on
 * crypto-up. If the broad crypto market dips, all three lose
 * simultaneously and the user takes 3x the intended single-position hit.
 *
 * The 2026-04-25 audit surfaced this: the platform happily took BTC long
 * + ETH long + SOL long in quick succession, all 3 going slightly
 * negative together when price drifted the wrong way. The losses
 * compounded.
 *
 * Phase 35 fix: cap to 2 same-direction positions per correlated group.
 * Doesn't block hedges (1 long + 1 short on the same group is fine), only
 * the same-direction stacking. Skipped if `incomingDirection` is omitted
 * by the caller (back-compat).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PortfolioRiskManager, type OpenPositionInfo } from '../services/PortfolioRiskManager';

describe('Phase 35 — net directional bias cap', () => {
  let mgr: PortfolioRiskManager;

  beforeEach(() => {
    mgr = new PortfolioRiskManager('test-user-35');
  });

  function makePosition(symbol: string, side: 'long' | 'short'): OpenPositionInfo {
    return {
      symbol,
      side,
      notionalValue: 1000,
      unrealizedPnl: 0,
      entryPrice: 100,
      currentPrice: 100,
      quantity: 10,
    };
  }

  it('rejects a 3rd same-direction long in correlated crypto group', async () => {
    const existing: OpenPositionInfo[] = [
      makePosition('BTC-USD', 'long'),
      makePosition('ETH-USD', 'long'),
    ];
    const assessment = await mgr.assessTradeRisk(
      'SOL-USD',
      500,
      10000,
      existing,
      undefined,
      'long',
    );
    expect(assessment.canTrade).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/Net directional bias/);
    expect(assessment.reasons.join(' ')).toMatch(/2 long.*correlated group/);
  });

  it('rejects a 3rd same-direction short symmetrically', async () => {
    const existing: OpenPositionInfo[] = [
      makePosition('BTC-USD', 'short'),
      makePosition('ETH-USD', 'short'),
    ];
    const assessment = await mgr.assessTradeRisk(
      'SOL-USD',
      500,
      10000,
      existing,
      undefined,
      'short',
    );
    expect(assessment.canTrade).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/Net directional bias/);
  });

  it('ALLOWS 2 longs (under the cap)', async () => {
    const existing: OpenPositionInfo[] = [makePosition('BTC-USD', 'long')];
    const assessment = await mgr.assessTradeRisk(
      'ETH-USD',
      500,
      10000,
      existing,
      undefined,
      'long',
    );
    expect(assessment.canTrade).toBe(true);
  });

  it('ALLOWS a hedge (1 long + 1 short on same group is fine)', async () => {
    const existing: OpenPositionInfo[] = [
      makePosition('BTC-USD', 'long'),
      makePosition('ETH-USD', 'long'),
    ];
    // Already 2 longs. A short on SOL is the OPPOSITE direction → allowed.
    const assessment = await mgr.assessTradeRisk(
      'SOL-USD',
      500,
      10000,
      existing,
      undefined,
      'short',
    );
    expect(assessment.canTrade).toBe(true);
  });

  it('back-compat: skipping incomingDirection bypasses the gate', async () => {
    // 3 longs, but incomingDirection omitted → gate skipped, gate decision
    // up to other CHECKs (notional caps etc). At small sizes those pass.
    const existing: OpenPositionInfo[] = [
      makePosition('BTC-USD', 'long'),
      makePosition('ETH-USD', 'long'),
    ];
    const assessment = await mgr.assessTradeRisk(
      'SOL-USD',
      100,
      100000,
      existing,
      undefined,
      // incomingDirection intentionally omitted
    );
    // Without the bias-direction signal, the gate doesn't fire — the
    // existing exposure caps may still allow this trade.
    expect(assessment.reasons.join(' ')).not.toMatch(/Net directional bias/);
  });

  it('mixed group does NOT count toward same-direction cap', async () => {
    // 1 long + 1 short already in group → 1 same-side count for new long.
    // New long should be allowed (only 1 existing long < cap of 2).
    const existing: OpenPositionInfo[] = [
      makePosition('BTC-USD', 'long'),
      makePosition('ETH-USD', 'short'),
    ];
    const assessment = await mgr.assessTradeRisk(
      'SOL-USD',
      500,
      10000,
      existing,
      undefined,
      'long',
    );
    expect(assessment.canTrade).toBe(true);
  });
});
