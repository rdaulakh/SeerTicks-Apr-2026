/**
 * Phase 10 — Exchange-aware fee drag.
 *
 * Pre-Phase-10 the guard applied a single flat fee+slippage estimate
 * (0.20% + 0.05% = 0.25% round-trip drag) to every close. The comment
 * on `estimatedRoundTripFeePercent` claimed this was "Coinbase Advanced
 * taker ≈0.10% × 2 legs" — factually wrong:
 *
 *   CoinbaseAdapter.getTradingFees() hardcodes taker = 0.6% (line 598)
 *                                    → 1.2% round-trip
 *   PaperTradingEngine.COMMISSION_RATES.coinbase = 0.005 (line 115)
 *                                    → 1.0% round-trip (paper sim)
 *   BinanceAdapter fallback = 0.001 taker           → 0.2% round-trip
 *
 * The effect: for any Coinbase position, the guard approved closes at
 * gross +0.25% thinking net = 0% ≥ 0.15% floor — when reality was
 * net = gross − 1.2% = −0.95%. Every "profitable" Coinbase exit below
 * +1.35% gross was actually a net loss. Direct violation of the prime
 * directive ("only exit profit").
 *
 * Phase 10 adds `config.profitLock.exchangeFeeOverrides` — a per-exchange
 * map the guard consults first, falling back to the flat defaults when
 * the exchange is missing or unconfigured. Coinbase positions now use
 * 1.20% fee + 0.10% slip = 1.30% drag, which means they can only close
 * above gross +1.45% (net +0.15% floor). Binance stays at the previous
 * 0.25% drag (unchanged behavior — Binance was always fine).
 *
 * These tests guard the correctness of that mapping AND the back-compat
 * invariant that Phases 7–9 still pass (they implicitly assume the
 * Binance-like default drag of 0.25%).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAllowClose,
  resolveDragPercent,
} from '../services/ProfitLockGuard';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 10 — resolveDragPercent (pure mapping)', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('returns the flat default when no exchange supplied', () => {
    const drag = resolveDragPercent({ side: 'long', entryPrice: 100 });
    expect(drag.roundTripFeePercent).toBe(0.20);
    expect(drag.slippagePercent).toBe(0.05);
    expect(drag.totalCostPercent).toBeCloseTo(0.25, 10);
    expect(drag.source).toBe('default');
  });

  it('applies Binance override when exchange="binance"', () => {
    const drag = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
    });
    expect(drag.roundTripFeePercent).toBe(0.20);
    expect(drag.slippagePercent).toBe(0.05);
    expect(drag.totalCostPercent).toBeCloseTo(0.25, 10);
    expect(drag.source).toBe('exchange:binance');
  });

  it('applies Coinbase override when exchange="coinbase"', () => {
    const drag = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'coinbase',
    });
    expect(drag.roundTripFeePercent).toBe(1.20);
    expect(drag.slippagePercent).toBe(0.10);
    expect(drag.totalCostPercent).toBeCloseTo(1.30, 10);
    expect(drag.source).toBe('exchange:coinbase');
  });

  it.each([
    ['COINBASE'],
    ['Coinbase'],
    ['CoinBase'],
    ['coinBASE'],
  ])('lookup is case-insensitive (exchange=%p)', (exchange) => {
    const drag = resolveDragPercent({ side: 'long', entryPrice: 100, exchange });
    expect(drag.source).toBe('exchange:coinbase');
    expect(drag.totalCostPercent).toBeCloseTo(1.30, 10);
  });

  it('unknown exchange falls back to default drag AND annotates source', () => {
    const drag = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'kraken',
    });
    expect(drag.totalCostPercent).toBeCloseTo(0.25, 10);
    expect(drag.source).toBe('default(unknown:kraken)');
  });

  it('adapts to runtime config changes', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: {
        ...PRODUCTION_CONFIG.profitLock,
        exchangeFeeOverrides: {
          ...PRODUCTION_CONFIG.profitLock.exchangeFeeOverrides,
          coinbase: { roundTripFeePercent: 0.50, slippagePercent: 0.05 },
        },
      },
    });
    const drag = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'coinbase',
    });
    expect(drag.totalCostPercent).toBeCloseTo(0.55, 10);
  });
});

describe('Phase 10 — shouldAllowClose on Coinbase tightens the floor', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('BLOCKS Coinbase close at gross +0.50% (would have been ALLOWED pre-Phase-10)', () => {
    // Pre-Phase-10: drag was 0.25% → net +0.25% → ALLOWED (net_profit_ok).
    // Real-world Coinbase drag: 1.30% → net −0.80% → BLOCKED.
    // That false-positive allowance was exactly the directive violation
    // this phase closes.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      100.5,
      'take_profit',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(0.5, 4);
    expect(res.netPnlPercent).toBeCloseTo(-0.8, 4);
    expect(res.reason).toMatch(/profit_lock_block/);
    expect(res.reason).toMatch(/exchange:coinbase/);
    expect(res.reason).toMatch(/1\.300%/); // drag echoed in reason
  });

  it('ALLOWS Coinbase close at gross +1.50% (net +0.20% clears the 0.15% floor)', () => {
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      101.5,
      'take_profit',
    );
    expect(res.allow).toBe(true);
    expect(res.grossPnlPercent).toBeCloseTo(1.5, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.2, 4);
    expect(res.reason).toMatch(/net_profit_ok/);
    expect(res.reason).toMatch(/exchange:coinbase/);
  });

  it('ALLOWS Coinbase close at gross −2.0% via catastrophic_grossPnl (floor is same −1.2%)', () => {
    // Exchange-aware drag does NOT change the catastrophic floor — that's
    // a hard blow-up protection independent of fees. A Coinbase position
    // at gross −2.0% still exits via catastrophic_grossPnl. Reason is
    // deliberately neutral (`time_exit`) — not a substring match of any
    // CATASTROPHIC_REASON_PATTERNS entry, so it can't hit the reason
    // branch and must route through the gross-PnL floor.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      98,
      'time_exit',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_grossPnl/);
  });

  it('ALLOWS Coinbase emergency exit via catastrophic_reason regardless of gross PnL', () => {
    // `emergency exit` is a catastrophic pattern → bypass the floor entirely.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      100.1, // gross +0.1%, net −1.20% under Coinbase drag — would be BLOCKED by floor
      'Emergency exit: dead mans switch',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/catastrophic_reason/);
  });
});

describe('Phase 10 — shouldAllowClose on Binance preserves prior behavior', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('ALLOWS Binance close at gross +0.50% (net +0.25% with 0.25% drag — unchanged from Phase 9)', () => {
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'binance' },
      100.5,
      'take_profit',
    );
    expect(res.allow).toBe(true);
    expect(res.grossPnlPercent).toBeCloseTo(0.5, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.25, 4);
    expect(res.reason).toMatch(/net_profit_ok/);
    expect(res.reason).toMatch(/exchange:binance/);
  });

  it('BLOCKS Binance close at gross +0.30% (net +0.05% below 0.15% floor — unchanged)', () => {
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100, exchange: 'binance' },
      100.3,
      'time_exit',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(0.3, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.05, 4);
    expect(res.reason).toMatch(/profit_lock_block/);
  });
});

describe('Phase 10 — back-compat: positions without exchange use default drag', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('unknown-exchange position closes identically to pre-Phase-10 behavior at gross +0.50%', () => {
    // This is the scenario Phases 7–9 tests implicitly cover (they never
    // supplied `exchange`). We verify the back-compat path: no exchange →
    // default drag (0.25%) → same allow/block as before.
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.5,
      'take_profit',
    );
    expect(res.allow).toBe(true);
    expect(res.reason).toMatch(/net_profit_ok/);
    expect(res.reason).toMatch(/drag=0\.250%/);
    expect(res.reason).toMatch(/default/);
  });

  it('unknown-exchange position is blocked identically at gross +0.20%', () => {
    const res = shouldAllowClose(
      { side: 'long', entryPrice: 100 },
      100.2,
      'trailing_stop',
    );
    expect(res.allow).toBe(false);
    expect(res.grossPnlPercent).toBeCloseTo(0.2, 4);
    expect(res.netPnlPercent).toBeCloseTo(-0.05, 4);
  });
});

describe('Phase 10 — config invariants', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('PRODUCTION_CONFIG ships with Binance + Coinbase overrides', () => {
    const cfg = getTradingConfig();
    const overrides = cfg.profitLock.exchangeFeeOverrides;
    expect(overrides).toBeDefined();
    expect(overrides!.binance).toEqual({
      roundTripFeePercent: 0.20,
      slippagePercent: 0.05,
    });
    expect(overrides!.coinbase).toEqual({
      roundTripFeePercent: 1.20,
      slippagePercent: 0.10,
    });
  });

  it('Coinbase drag > Binance drag (the whole point of this phase)', () => {
    const binance = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'binance',
    });
    const coinbase = resolveDragPercent({
      side: 'long',
      entryPrice: 100,
      exchange: 'coinbase',
    });
    expect(coinbase.totalCostPercent).toBeGreaterThan(
      binance.totalCostPercent,
    );
    // Specifically: Coinbase drag is at least 5× Binance.
    expect(coinbase.totalCostPercent).toBeGreaterThanOrEqual(
      binance.totalCostPercent * 5,
    );
  });
});
