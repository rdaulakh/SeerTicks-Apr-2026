/**
 * Phase 11 — Pre-trade viability gate.
 *
 * "Don't open a trade whose first profit target cannot exit profitably."
 *
 * The exit-side guard (Phases 6–10) blocks losing closes. Necessary but not
 * sufficient: if an entry is opened with a TP that — when reached — would
 * net below the profit floor after exchange-aware fee drag, the guard will
 * correctly refuse to close there, and the position will loiter until the
 * hard SL fires. Net result: a real −1.45% loss the prime directive is
 * supposed to prevent.
 *
 * `canEnterProfitably` is the pure entry-time check. `EnhancedTradeExecutor`
 * calls it after computing TP/SL levels and before price confirmation —
 * rejecting trades whose planned TP can't clear `drag + floor` for the
 * target exchange.
 *
 * These tests:
 *   1. Verify the helper's math for long + short, Binance + Coinbase,
 *      known + unknown exchanges, invalid inputs.
 *   2. Sanity-check the reason strings for log + rejection surfacing.
 *   3. Lock down the canonical scenarios the gate is designed to catch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { canEnterProfitably } from '../services/ProfitLockGuard';
import {
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 11 — canEnterProfitably (pure logic)', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  describe('long positions', () => {
    it('BINANCE long at +0.50% gross TP (net +0.25%) → viable', () => {
      // Binance drag 0.25%, floor 0.15% → required ≥0.40% gross. 0.50% clears.
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        100.5,
      );
      expect(res.viable).toBe(true);
      expect(res.grossProfitPercent).toBeCloseTo(0.5, 4);
      expect(res.netProfitPercent).toBeCloseTo(0.25, 4);
      expect(res.requiredGrossPercent).toBeCloseTo(0.4, 4);
      expect(res.reason).toMatch(/entry_viable/);
      expect(res.reason).toMatch(/exchange:binance/);
    });

    it('BINANCE long at +0.30% gross TP (net +0.05% < 0.15% floor) → NOT viable', () => {
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        100.3,
      );
      expect(res.viable).toBe(false);
      expect(res.netProfitPercent).toBeCloseTo(0.05, 4);
      expect(res.reason).toMatch(/entry_not_viable/);
      expect(res.reason).toMatch(/requires grossTP≥0\.400%/);
    });

    it('COINBASE long at +0.50% gross TP (net −0.80%) → NOT viable (the canonical case)', () => {
      // Coinbase drag 1.30%, floor 0.15% → required ≥1.45% gross.
      // The default config profitTarget[0] = 0.5% would produce this exact
      // rejection. This is the bug Phase 11 exists to prevent.
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'coinbase' },
        100,
        100.5,
      );
      expect(res.viable).toBe(false);
      expect(res.grossProfitPercent).toBeCloseTo(0.5, 4);
      expect(res.netProfitPercent).toBeCloseTo(-0.8, 4);
      expect(res.requiredGrossPercent).toBeCloseTo(1.45, 4);
      expect(res.reason).toMatch(/entry_not_viable/);
      expect(res.reason).toMatch(/exchange:coinbase/);
      expect(res.reason).toMatch(/drag=1\.300%/);
    });

    it('COINBASE long at +1.50% gross TP (net +0.20%) → viable', () => {
      // Just above the floor. This is the threshold where Coinbase trades
      // become openable.
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'coinbase' },
        100,
        101.5,
      );
      expect(res.viable).toBe(true);
      expect(res.netProfitPercent).toBeCloseTo(0.2, 4);
      expect(res.reason).toMatch(/entry_viable/);
    });

    it('COINBASE long at EXACTLY required (grossTP=1.45%, net=0.15% = floor) → viable', () => {
      // Boundary condition — equality must be viable (>= floor).
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'coinbase' },
        100,
        101.45,
      );
      expect(res.viable).toBe(true);
      expect(res.netProfitPercent).toBeCloseTo(0.15, 4);
    });
  });

  describe('short positions', () => {
    it('BINANCE short at TP=99.50 (gross +0.50%, net +0.25%) → viable', () => {
      const res = canEnterProfitably(
        { side: 'short', entryPrice: 100, exchange: 'binance' },
        100,
        99.5,
      );
      expect(res.viable).toBe(true);
      expect(res.grossProfitPercent).toBeCloseTo(0.5, 4);
      expect(res.netProfitPercent).toBeCloseTo(0.25, 4);
    });

    it('COINBASE short at TP=99.50 (gross +0.50%, net −0.80%) → NOT viable', () => {
      const res = canEnterProfitably(
        { side: 'short', entryPrice: 100, exchange: 'coinbase' },
        100,
        99.5,
      );
      expect(res.viable).toBe(false);
      expect(res.netProfitPercent).toBeCloseTo(-0.8, 4);
    });

    it('COINBASE short at TP=98.50 (gross +1.50%, net +0.20%) → viable', () => {
      const res = canEnterProfitably(
        { side: 'short', entryPrice: 100, exchange: 'coinbase' },
        100,
        98.5,
      );
      expect(res.viable).toBe(true);
    });
  });

  describe('structural guards', () => {
    it('REJECTS TP on the wrong side of entry (long with TP < entry)', () => {
      // Someone passed a malformed level — SL-as-TP bug, off-by-sign, etc.
      // The gate must treat this as non-viable rather than computing a
      // negative "gross profit" and pretending the trade is fine.
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        99.5,
      );
      expect(res.viable).toBe(false);
      expect(res.grossProfitPercent).toBeLessThan(0);
      expect(res.reason).toMatch(/entry_viability_wrong_side/);
    });

    it('REJECTS TP on the wrong side of entry (short with TP > entry)', () => {
      const res = canEnterProfitably(
        { side: 'short', entryPrice: 100, exchange: 'binance' },
        100,
        100.5,
      );
      expect(res.viable).toBe(false);
      expect(res.reason).toMatch(/entry_viability_wrong_side/);
    });

    it('REJECTS invalid prices (zero entry or zero TP)', () => {
      const a = canEnterProfitably(
        { side: 'long', entryPrice: 0, exchange: 'binance' },
        0,
        100.5,
      );
      expect(a.viable).toBe(false);
      expect(a.reason).toMatch(/invalid_prices/);

      const b = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        0,
      );
      expect(b.viable).toBe(false);
      expect(b.reason).toMatch(/invalid_prices/);
    });
  });

  describe('exchange resolution', () => {
    it('unknown exchange falls back to default drag (Binance-equiv)', () => {
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'kraken' },
        100,
        100.5,
      );
      expect(res.viable).toBe(true);
      expect(res.netProfitPercent).toBeCloseTo(0.25, 4);
      expect(res.reason).toMatch(/default\(unknown:kraken\)/);
    });

    it('no exchange provided falls back to default drag', () => {
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100 },
        100,
        100.5,
      );
      expect(res.viable).toBe(true);
      expect(res.netProfitPercent).toBeCloseTo(0.25, 4);
      expect(res.reason).toMatch(/drag=0\.250% default\b/);
    });
  });

  describe('requiredGrossPercent is the decision-ready minimum', () => {
    it('BINANCE requiredGrossPercent = 0.40%', () => {
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        200, // arbitrary TP far above, just to read the required field
      );
      expect(res.requiredGrossPercent).toBeCloseTo(0.4, 4);
    });

    it('COINBASE requiredGrossPercent = 1.45%', () => {
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'coinbase' },
        100,
        200,
      );
      expect(res.requiredGrossPercent).toBeCloseTo(1.45, 4);
    });

    it('config change flows through immediately (no caching)', () => {
      setTradingConfig({
        ...PRODUCTION_CONFIG,
        profitLock: {
          ...PRODUCTION_CONFIG.profitLock,
          minNetProfitPercentToClose: 0.5, // tighter floor
        },
      });
      const res = canEnterProfitably(
        { side: 'long', entryPrice: 100, exchange: 'binance' },
        100,
        200,
      );
      expect(res.requiredGrossPercent).toBeCloseTo(0.75, 4); // 0.5 + 0.25 drag
    });
  });
});
