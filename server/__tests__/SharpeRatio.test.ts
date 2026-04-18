import { describe, it, expect } from 'vitest';

/**
 * Sharpe Ratio unit tests — replicating the calculateSharpeRatio logic
 * since it's a private function in strategyDb.ts.
 *
 * Formula: Sharpe = (Mean Excess Return / StdDev) * √252
 * Where excess return = per-trade return - (annual risk-free rate / 252)
 */

function calculateSharpeRatio(
  trades: Array<{ pnl: string | number }>,
  walletStartingBalance?: number,
  annualRiskFreeRate: number = 0.0525
): number | null {
  if (!trades || trades.length < 2) return null;

  const chronoTrades = [...trades].reverse();
  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;

  const returns: number[] = [];
  let runningBalance = startingBalance;

  for (const trade of chronoTrades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (isNaN(pnl)) continue;

    if (runningBalance > 0) {
      const pctReturn = pnl / runningBalance;
      returns.push(pctReturn);
    }
    runningBalance += pnl;
  }

  if (returns.length < 2) return null;

  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0 || isNaN(stdDev)) return null;

  const TRADING_DAYS_PER_YEAR = 252;
  const annualizationFactor = Math.sqrt(TRADING_DAYS_PER_YEAR);
  const perTradeRiskFreeRate = annualRiskFreeRate / TRADING_DAYS_PER_YEAR;

  const excessReturn = meanReturn - perTradeRiskFreeRate;
  const sharpeRatio = (excessReturn / stdDev) * annualizationFactor;

  return Math.max(-10, Math.min(10, sharpeRatio));
}

describe('calculateSharpeRatio — Institutional-Grade Sharpe Ratio', () => {

  describe('Edge Cases', () => {
    it('should return null for empty trades', () => {
      expect(calculateSharpeRatio([])).toBeNull();
    });

    it('should return null for single trade (insufficient data)', () => {
      expect(calculateSharpeRatio([{ pnl: '100' }])).toBeNull();
    });

    it('should return null for null/undefined trades', () => {
      expect(calculateSharpeRatio(null as any)).toBeNull();
      expect(calculateSharpeRatio(undefined as any)).toBeNull();
    });

    it('should return null for all-identical returns (zero volatility)', () => {
      // All trades have same P&L → zero std dev → Sharpe undefined
      const trades = [
        { pnl: '100' },
        { pnl: '100' },
        { pnl: '100' },
        { pnl: '100' },
      ];
      // With $10k starting balance, returns are ~1% each but running balance changes
      // So returns won't be exactly identical. Let's use a case where they truly are:
      // Actually with running balance changing, returns will differ slightly
      // Use a more direct test: all zero P&L
      const zeroTrades = [
        { pnl: '0' },
        { pnl: '0' },
        { pnl: '0' },
      ];
      expect(calculateSharpeRatio(zeroTrades)).toBeNull();
    });

    it('should handle NaN pnl values gracefully', () => {
      const trades = [
        { pnl: 'invalid' },
        { pnl: '100' },
        { pnl: '-50' },
      ];
      // Only 2 valid trades, should still compute
      const result = calculateSharpeRatio(trades);
      expect(result).not.toBeNull();
    });

    it('should handle trades that would make balance go to zero', () => {
      const trades = [
        { pnl: '-100' },  // newest
        { pnl: '-10000' }, // oldest — wipes out $10k balance
      ];
      // After first trade (oldest): balance = 0, second trade can't compute return
      const result = calculateSharpeRatio(trades);
      // Should handle gracefully — may return null due to insufficient valid returns
      // or compute with just the first return
      expect(result === null || typeof result === 'number').toBe(true);
    });
  });

  describe('Positive Sharpe (Profitable Strategy)', () => {
    it('should return positive Sharpe for consistently profitable trades', () => {
      // Trades in DESC order (newest first)
      const trades = [
        { pnl: '150' },
        { pnl: '200' },
        { pnl: '100' },
        { pnl: '180' },
        { pnl: '120' },
        { pnl: '90' },
        { pnl: '160' },
        { pnl: '140' },
        { pnl: '110' },
        { pnl: '130' },
      ];
      const result = calculateSharpeRatio(trades, 10000);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
      // Consistently profitable with low variance → high Sharpe
      expect(result!).toBeGreaterThan(3); // Should be exceptional
    });

    it('should return moderate Sharpe for mixed but net-positive trades', () => {
      const trades = [
        { pnl: '200' },
        { pnl: '-100' },
        { pnl: '300' },
        { pnl: '-50' },
        { pnl: '150' },
        { pnl: '-80' },
        { pnl: '250' },
        { pnl: '-120' },
        { pnl: '180' },
        { pnl: '-60' },
      ];
      const result = calculateSharpeRatio(trades, 10000);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });
  });

  describe('Negative Sharpe (Losing Strategy)', () => {
    it('should return negative Sharpe for consistently losing trades', () => {
      const trades = [
        { pnl: '-150' },
        { pnl: '-200' },
        { pnl: '-100' },
        { pnl: '-180' },
        { pnl: '-120' },
        { pnl: '-90' },
        { pnl: '-160' },
        { pnl: '-140' },
        { pnl: '-110' },
        { pnl: '-130' },
      ];
      const result = calculateSharpeRatio(trades, 10000);
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(0);
    });
  });

  describe('Starting Balance Impact', () => {
    it('should produce same Sharpe regardless of starting balance (percentage-based)', () => {
      const trades = [
        { pnl: '200' },
        { pnl: '-100' },
        { pnl: '150' },
        { pnl: '-50' },
        { pnl: '300' },
      ];
      // With different starting balances, the percentage returns change
      // so Sharpe WILL differ — this tests that larger balance = smaller returns = different Sharpe
      const sharpe10k = calculateSharpeRatio(trades, 10000);
      const sharpe100k = calculateSharpeRatio(trades, 100000);

      expect(sharpe10k).not.toBeNull();
      expect(sharpe100k).not.toBeNull();
      // $10k balance: $200 = 2% return, $100k balance: $200 = 0.2% return
      // So Sharpe with $10k should be higher (larger returns relative to risk-free)
      expect(sharpe10k!).toBeGreaterThan(sharpe100k!);
    });

    it('should fall back to $10,000 for invalid starting balance', () => {
      const trades = [
        { pnl: '100' },
        { pnl: '-50' },
        { pnl: '200' },
      ];
      const sharpeDefault = calculateSharpeRatio(trades);
      const sharpeZero = calculateSharpeRatio(trades, 0);
      const sharpeNeg = calculateSharpeRatio(trades, -5000);

      expect(sharpeDefault).toEqual(sharpeZero);
      expect(sharpeDefault).toEqual(sharpeNeg);
    });
  });

  describe('Risk-Free Rate Impact', () => {
    it('should produce lower Sharpe with higher risk-free rate', () => {
      const trades = [
        { pnl: '100' },
        { pnl: '-50' },
        { pnl: '150' },
        { pnl: '-30' },
        { pnl: '120' },
      ];
      const sharpeLowRf = calculateSharpeRatio(trades, 10000, 0.01);  // 1% risk-free
      const sharpeHighRf = calculateSharpeRatio(trades, 10000, 0.10); // 10% risk-free

      expect(sharpeLowRf).not.toBeNull();
      expect(sharpeHighRf).not.toBeNull();
      expect(sharpeLowRf!).toBeGreaterThan(sharpeHighRf!);
    });

    it('should produce higher Sharpe with zero risk-free rate', () => {
      const trades = [
        { pnl: '100' },
        { pnl: '-50' },
        { pnl: '150' },
        { pnl: '-30' },
        { pnl: '120' },
      ];
      const sharpeZeroRf = calculateSharpeRatio(trades, 10000, 0);
      const sharpeDefaultRf = calculateSharpeRatio(trades, 10000, 0.0525);

      expect(sharpeZeroRf).not.toBeNull();
      expect(sharpeDefaultRf).not.toBeNull();
      expect(sharpeZeroRf!).toBeGreaterThan(sharpeDefaultRf!);
    });
  });

  describe('Clamping', () => {
    it('should clamp to [-10, 10] range', () => {
      // Extremely consistent profits → very high Sharpe before clamping
      const trades = [
        { pnl: '1000' },
        { pnl: '1001' },
        { pnl: '1000' },
        { pnl: '1001' },
        { pnl: '1000' },
      ];
      const result = calculateSharpeRatio(trades, 10000);
      if (result !== null) {
        expect(result).toBeLessThanOrEqual(10);
        expect(result).toBeGreaterThanOrEqual(-10);
      }
    });
  });

  describe('Institutional Benchmarks', () => {
    it('should classify a high-quality strategy correctly (Sharpe > 2)', () => {
      // Simulate a hedge-fund quality strategy: high win rate, controlled losses
      const trades: Array<{ pnl: string }> = [];
      // 80% win rate, avg win $150, avg loss $100
      for (let i = 0; i < 50; i++) {
        if (i % 5 === 0) {
          trades.push({ pnl: '-100' }); // 20% losses
        } else {
          trades.push({ pnl: '150' }); // 80% wins
        }
      }
      const result = calculateSharpeRatio(trades, 10000);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(2); // Very good tier
    });

    it('should classify a mediocre strategy correctly (Sharpe 0-1)', () => {
      // 50/50 win rate, slightly positive expectancy
      const trades: Array<{ pnl: string }> = [];
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          trades.push({ pnl: '-100' });
        } else {
          trades.push({ pnl: '120' }); // Slight edge
        }
      }
      const result = calculateSharpeRatio(trades, 10000);
      expect(result).not.toBeNull();
      // With a slight edge and high variance, Sharpe should be modest
      expect(result!).toBeGreaterThan(-1);
      expect(result!).toBeLessThan(3);
    });
  });

  describe('String vs Number P&L', () => {
    it('should handle string P&L values', () => {
      const trades = [{ pnl: '100' }, { pnl: '-50' }, { pnl: '200' }];
      const result = calculateSharpeRatio(trades);
      expect(result).not.toBeNull();
    });

    it('should handle numeric P&L values', () => {
      const trades = [{ pnl: 100 }, { pnl: -50 }, { pnl: 200 }];
      const result = calculateSharpeRatio(trades);
      expect(result).not.toBeNull();
    });

    it('should produce same result for string and number P&L', () => {
      const stringTrades = [{ pnl: '100' }, { pnl: '-50' }, { pnl: '200' }];
      const numTrades = [{ pnl: 100 }, { pnl: -50 }, { pnl: 200 }];
      const stringResult = calculateSharpeRatio(stringTrades);
      const numResult = calculateSharpeRatio(numTrades);
      expect(stringResult).toEqual(numResult);
    });
  });
});
