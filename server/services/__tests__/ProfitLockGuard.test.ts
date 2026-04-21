import { describe, it, expect, beforeEach } from 'vitest';
import { shouldAllowClose, computeGrossPnlPercent, isCatastrophicReason } from '../ProfitLockGuard';
import { getTradingConfig, setTradingConfig, PRODUCTION_CONFIG } from '../../config/TradingConfig';

/**
 * PRIME DIRECTIVE: only pick and exit profit in trades.
 * This suite verifies the net-positive exit floor is enforced and that
 * catastrophic / emergency exits still bypass it.
 */

// Round-trip cost = estimatedRoundTripFeePercent (0.20) + estimatedSlippagePercent (0.05) = 0.25%
// minNetProfitPercentToClose = 0.15%
// → need grossPnlPercent >= 0.40% to pass the net-positive floor

describe('ProfitLockGuard', () => {
  beforeEach(() => {
    // Always start from the production defaults so tests are deterministic.
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  describe('computeGrossPnlPercent', () => {
    it('handles long positions', () => {
      expect(computeGrossPnlPercent({ side: 'long', entryPrice: 100 }, 101)).toBeCloseTo(1.0);
      expect(computeGrossPnlPercent({ side: 'long', entryPrice: 100 }, 99)).toBeCloseTo(-1.0);
    });

    it('handles short positions', () => {
      expect(computeGrossPnlPercent({ side: 'short', entryPrice: 100 }, 99)).toBeCloseTo(1.0);
      expect(computeGrossPnlPercent({ side: 'short', entryPrice: 100 }, 101)).toBeCloseTo(-1.0);
    });

    it('returns 0 for invalid entry price', () => {
      expect(computeGrossPnlPercent({ side: 'long', entryPrice: 0 }, 101)).toBe(0);
    });
  });

  describe('isCatastrophicReason', () => {
    it('matches all whitelisted patterns', () => {
      expect(isCatastrophicReason('emergency_exit')).toBe(true);
      expect(isCatastrophicReason('catastrophic_loss')).toBe(true);
      expect(isCatastrophicReason('hard_stop_loss:-1.5%')).toBe(true);
      expect(isCatastrophicReason('circuit_breaker_tripped')).toBe(true);
      expect(isCatastrophicReason('manual_override_close')).toBe(true);
      expect(isCatastrophicReason('regime_kill_switch')).toBe(true);
      expect(isCatastrophicReason('liquidation_imminent')).toBe(true);
    });

    it('rejects non-catastrophic reasons', () => {
      expect(isCatastrophicReason('time_exit')).toBe(false);
      expect(isCatastrophicReason('trailing_stop')).toBe(false);
      expect(isCatastrophicReason('take_profit')).toBe(false);
      expect(isCatastrophicReason('')).toBe(false);
      expect(isCatastrophicReason(null)).toBe(false);
      expect(isCatastrophicReason(undefined)).toBe(false);
    });
  });

  describe('net-positive floor — blocks', () => {
    it('BLOCKS close at grossPnl=0% (fees unpaid)', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 100, 'trailing_stop');
      expect(res.allow).toBe(false);
      expect(res.grossPnlPercent).toBeCloseTo(0);
      expect(res.netPnlPercent).toBeCloseTo(-0.25);
    });

    it('BLOCKS close at grossPnl=0.1% (fees eat it)', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 100.1, 'take_profit');
      expect(res.allow).toBe(false);
      expect(res.grossPnlPercent).toBeCloseTo(0.1);
      expect(res.netPnlPercent).toBeCloseTo(-0.15);
    });

    it('BLOCKS non-catastrophic close at grossPnl=-1%', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 99, 'time_exit');
      expect(res.allow).toBe(false);
      expect(res.grossPnlPercent).toBeCloseTo(-1);
    });

    it('BLOCKS short at grossPnl=0.3% (net 0.05%, still below 0.15% floor)', () => {
      const res = shouldAllowClose({ side: 'short', entryPrice: 100 }, 99.7, 'trailing_stop');
      expect(res.allow).toBe(false);
      expect(res.grossPnlPercent).toBeCloseTo(0.3);
      expect(res.netPnlPercent).toBeCloseTo(0.05);
    });
  });

  describe('net-positive floor — allows', () => {
    it('ALLOWS close at grossPnl=0.5% (net ~0.25% > 0.15% floor)', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 100.5, 'take_profit');
      expect(res.allow).toBe(true);
      expect(res.grossPnlPercent).toBeCloseTo(0.5);
      expect(res.netPnlPercent).toBeCloseTo(0.25);
    });

    it('ALLOWS short at grossPnl=0.5% (mirror of long)', () => {
      const res = shouldAllowClose({ side: 'short', entryPrice: 100 }, 99.5, 'take_profit');
      expect(res.allow).toBe(true);
      expect(res.grossPnlPercent).toBeCloseTo(0.5);
      expect(res.netPnlPercent).toBeCloseTo(0.25);
    });
  });

  describe('catastrophic bypass', () => {
    it('ALLOWS catastrophic close at grossPnl=-3% with reason=hard_stop_loss', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 97, 'hard_stop_loss:-3%');
      expect(res.allow).toBe(true);
      expect(res.grossPnlPercent).toBeCloseTo(-3);
      expect(res.reason).toMatch(/catastrophic/);
    });

    it('ALLOWS close at emergency_exit reason even when gross slightly negative', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 99.5, 'emergency_exit:circuit_tripped');
      expect(res.allow).toBe(true);
      expect(res.reason).toMatch(/catastrophic_reason/);
    });

    it('ALLOWS close at grossPnl<=-2.5% even with non-catastrophic reason', () => {
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 97.4, 'time_exit');
      // grossPnl = -2.6% <= -2.5% (catastrophicStopPercent)
      expect(res.allow).toBe(true);
      expect(res.grossPnlPercent).toBeCloseTo(-2.6, 1);
      expect(res.reason).toMatch(/catastrophic_grossPnl/);
    });

    it('ALLOWS liquidation_ reason regardless of PnL', () => {
      const res = shouldAllowClose({ side: 'short', entryPrice: 100 }, 101, 'liquidation_margin_call');
      expect(res.allow).toBe(true);
    });
  });

  describe('disabled flag', () => {
    it('ALWAYS allows when profitLock.enabled=false', () => {
      const cfg = { ...PRODUCTION_CONFIG, profitLock: { ...PRODUCTION_CONFIG.profitLock, enabled: false } };
      setTradingConfig(cfg);

      // Even at flat price / bad reason — should pass.
      const r1 = shouldAllowClose({ side: 'long', entryPrice: 100 }, 100, 'time_exit');
      const r2 = shouldAllowClose({ side: 'long', entryPrice: 100 }, 99.9, 'trailing_stop');
      const r3 = shouldAllowClose({ side: 'short', entryPrice: 100 }, 100.05, 'take_profit');

      expect(r1.allow).toBe(true);
      expect(r1.reason).toBe('profit_lock_disabled');
      expect(r2.allow).toBe(true);
      expect(r3.allow).toBe(true);
    });
  });

  describe('edge case — catastrophic reason takes precedence over floor', () => {
    it('catastrophic reason allows even when grossPnl is positive but below net floor', () => {
      // gross +0.1%, reason hard_stop_ — should still allow (catastrophic branch)
      const res = shouldAllowClose({ side: 'long', entryPrice: 100 }, 100.1, 'hard_stop_trailing_breach');
      expect(res.allow).toBe(true);
      expect(res.reason).toMatch(/catastrophic_reason/);
    });
  });
});
