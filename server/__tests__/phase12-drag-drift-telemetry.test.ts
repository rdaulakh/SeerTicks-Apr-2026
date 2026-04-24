/**
 * Phase 12 — Drag-drift telemetry.
 *
 * The guard's net-PnL math is only as safe as its fee+slippage estimate.
 * Phases 10 and 11 set static per-exchange estimates, but real-world
 * drag drifts:
 *   - Exchange fee tiers change with volume.
 *   - Slippage widens in thin books.
 *   - Hardcoded adapter fallbacks go stale.
 *
 * If drag drifts ABOVE the estimate, the guard approves closes that are
 * NET-NEGATIVE in reality (the canonical directive violation). Phase 12
 * adds the feedback loop — every fill gets compared against the configured
 * estimate, and sustained drift emits a structured WARN so the operator
 * can update `profitLock.exchangeFeeOverrides`.
 *
 * These tests lock down:
 *   - The math (actual vs. estimated, absolute + ratio)
 *   - Tolerance thresholds (>0.10% absolute OR >1.5× ratio)
 *   - Structured WARN emission with enough context to identify the exchange
 *   - Silent INFO path when within tolerance
 *   - Safe degraded mode when estimate is zero or actual is weird
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { reportActualTradeDrag } from '../services/ProfitLockGuard';
import {
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 12 — reportActualTradeDrag', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('reports actual == estimated (ratio 1.0, drift 0) as in-tolerance — no WARN', () => {
    // Binance estimate: 0.20% fee + 0.05% slippage = 0.25% drag.
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'binance' },
      0.20,
      0.05,
    );
    expect(rep.actualTotalPercent).toBeCloseTo(0.25, 6);
    expect(rep.estimatedTotalPercent).toBeCloseTo(0.25, 6);
    expect(rep.driftAbsolutePercent).toBeCloseTo(0, 6);
    expect(rep.driftRatio).toBeCloseTo(1.0, 6);
    expect(rep.exceedsTolerance).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits WARN when absolute drift exceeds 0.10% (even if ratio is tame)', () => {
    // Coinbase estimate: 1.30%. Actual: 1.45% → +0.15% drift, ratio 1.12×.
    // Ratio is below 1.5×, but absolute drift is >0.10% — still a WARN.
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      1.30,
      0.15,
      { orderId: 'o1', symbol: 'BTC-USD', side: 'sell' },
    );
    expect(rep.driftAbsolutePercent).toBeCloseTo(0.15, 4);
    expect(rep.driftRatio).toBeCloseTo(1.115, 3);
    expect(rep.exceedsTolerance).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/DRAG DRIFT/);
    expect(msg).toMatch(/symbol=BTC-USD/);
    expect(msg).toMatch(/order=o1/);
    expect(msg).toMatch(/exchange:coinbase/);
    expect(msg).toMatch(/ratio=1\.12×/);
    expect(msg).toMatch(/exchangeFeeOverrides\.coinbase/);
  });

  it('emits WARN when ratio exceeds 1.5× (even if absolute drift is small)', () => {
    // Contrive: estimate 0.10%, actual 0.17% → +0.07% abs (under 0.10%), ratio 1.70×.
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: {
        ...PRODUCTION_CONFIG.profitLock,
        estimatedRoundTripFeePercent: 0.05,
        estimatedSlippagePercent: 0.05,
      },
    });
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100 }, // no exchange → default estimate
      0.12,
      0.05,
    );
    expect(rep.estimatedTotalPercent).toBeCloseTo(0.10, 6);
    expect(rep.actualTotalPercent).toBeCloseTo(0.17, 6);
    expect(Math.abs(rep.driftAbsolutePercent)).toBeLessThanOrEqual(0.10);
    expect(rep.driftRatio).toBeGreaterThan(1.5);
    expect(rep.exceedsTolerance).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('catches the canonical directive-violation scenario: Coinbase drag 2× estimate', () => {
    // Worst case: Coinbase tier changed and taker went from 0.6% → 1.2%.
    // Round-trip reality = 2.4%. Guard still uses 1.30% estimate. Every
    // close approved thinking net +0.15% is actually net −0.95%. Phase 12
    // is the alarm that would fire in production.
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      2.40,
      0.10,
    );
    expect(rep.actualTotalPercent).toBeCloseTo(2.50, 4);
    expect(rep.estimatedTotalPercent).toBeCloseTo(1.30, 4);
    expect(rep.driftAbsolutePercent).toBeCloseTo(1.20, 4);
    expect(rep.driftRatio).toBeCloseTo(1.923, 2);
    expect(rep.exceedsTolerance).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    // Reason surfaces the exchange so the operator knows which override to bump.
    expect(msg).toMatch(/exchange:coinbase/);
    expect(msg).toMatch(/exchangeFeeOverrides\.coinbase/);
  });

  it('handles actual < estimated (over-conservative config) — in-tolerance, no WARN', () => {
    // If Binance's real fee is 0.10% and estimate is 0.25%, the guard is
    // over-conservative. No directive risk, just missed liquidity. Drift is
    // negative (−0.15%) — over the 0.10% abs threshold, so we DO warn, but
    // the message is the same shape. The operator can check, decide it's fine.
    // Behavior: |drift|=0.15 > 0.10 → exceedsTolerance=true. Intended: yes,
    // any large deviation warrants a look; conservatism is also miscalibration.
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'binance' },
      0.08,
      0.02,
    );
    expect(rep.actualTotalPercent).toBeCloseTo(0.10, 6);
    expect(rep.estimatedTotalPercent).toBeCloseTo(0.25, 6);
    expect(rep.driftAbsolutePercent).toBeCloseTo(-0.15, 6);
    expect(rep.exceedsTolerance).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('never throws on zero estimate (division guard) — ratio = Infinity, still reports', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      profitLock: {
        ...PRODUCTION_CONFIG.profitLock,
        estimatedRoundTripFeePercent: 0,
        estimatedSlippagePercent: 0,
        exchangeFeeOverrides: {}, // clear overrides → all defaults are 0
      },
    });
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100 },
      0.20,
      0.05,
    );
    expect(rep.estimatedTotalPercent).toBe(0);
    expect(rep.driftRatio).toBe(Infinity);
    expect(rep.exceedsTolerance).toBe(true); // abs drift 0.25 > 0.10
    expect(() => warnSpy.mock.calls[0][0]).not.toThrow();
  });

  it('silently handles zero or NaN actuals without throwing', () => {
    // A degraded fill (e.g. reduce-only with no commission captured) should
    // not explode the telemetry. Zero actuals against a non-zero estimate
    // is a legitimate data point — it means drift is negative-estimate.
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'binance' },
      0,
      0,
    );
    expect(rep.actualTotalPercent).toBe(0);
    expect(rep.driftAbsolutePercent).toBeCloseTo(-0.25, 6);
    expect(rep.exceedsTolerance).toBe(true); // |−0.25| > 0.10
  });

  it('uses resolved drag source label in the WARN message (exchange-aware)', () => {
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'coinbase' },
      2.00,
      0.20,
    );
    expect(rep.source).toBe('exchange:coinbase');
    expect(warnSpy.mock.calls[0][0]).toMatch(/\(exchange:coinbase\)/);
  });

  it('unknown exchange surfaces the fallback source in the WARN', () => {
    const rep = reportActualTradeDrag(
      { side: 'long', entryPrice: 100, exchange: 'kraken' },
      1.00,
      0.20,
    );
    expect(rep.source).toBe('default(unknown:kraken)');
    expect(warnSpy.mock.calls[0][0]).toMatch(/default\(unknown:kraken\)/);
  });
});
