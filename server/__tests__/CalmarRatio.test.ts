import { describe, it, expect } from 'vitest';

/**
 * Calmar Ratio Tests
 * 
 * Calmar = Annualized Return / Max Drawdown
 * 
 * Tests the standalone calculateCalmarRatio function extracted from strategyDb.ts.
 * We replicate the function here to test it in isolation without DB dependencies.
 */

// Replicate the calculateCalmarRatio function for isolated testing
function calculateCalmarRatio(
  trades: Array<{ pnl: string | number; timestamp?: Date | string | null }>,
  maxDrawdownPct: number,
  walletStartingBalance?: number
): number | null {
  if (!trades || trades.length < 5) return null;
  if (maxDrawdownPct <= 0 || isNaN(maxDrawdownPct)) return null;

  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;

  let totalPnl = 0;
  for (const trade of trades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (!isNaN(pnl)) totalPnl += pnl;
  }

  const totalReturnPct = (totalPnl / startingBalance) * 100;

  const timestamps: number[] = [];
  for (const trade of trades) {
    if (trade.timestamp) {
      const ts = trade.timestamp instanceof Date
        ? trade.timestamp.getTime()
        : new Date(trade.timestamp).getTime();
      if (!isNaN(ts)) timestamps.push(ts);
    }
  }

  let annualizationFactor = 1;
  if (timestamps.length >= 2) {
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    const tradingDays = (latest - earliest) / (1000 * 60 * 60 * 24);

    if (tradingDays < 7) return null;

    annualizationFactor = 365 / tradingDays;
  } else {
    return null;
  }

  const annualizedReturnPct = totalReturnPct * annualizationFactor;
  const calmarRatio = annualizedReturnPct / maxDrawdownPct;

  return Math.max(-10, Math.min(10, calmarRatio));
}

// Helper: generate trades spread over a date range
function generateTrades(
  pnls: number[],
  startDate: Date,
  daysBetween: number = 1
): Array<{ pnl: number; timestamp: Date }> {
  return pnls.map((pnl, i) => ({
    pnl,
    timestamp: new Date(startDate.getTime() + i * daysBetween * 24 * 60 * 60 * 1000),
  }));
}

describe('Calmar Ratio Calculation', () => {
  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should return null for empty trades', () => {
      expect(calculateCalmarRatio([], 5)).toBeNull();
    });

    it('should return null for fewer than 5 trades', () => {
      const trades = generateTrades([100, -50, 200, -30], new Date('2025-01-01'), 3);
      expect(calculateCalmarRatio(trades, 5)).toBeNull();
    });

    it('should return null for null/undefined trades', () => {
      expect(calculateCalmarRatio(null as any, 5)).toBeNull();
      expect(calculateCalmarRatio(undefined as any, 5)).toBeNull();
    });

    it('should return null when max drawdown is zero', () => {
      const trades = generateTrades([100, 200, 150, 300, 250], new Date('2025-01-01'), 3);
      expect(calculateCalmarRatio(trades, 0)).toBeNull();
    });

    it('should return null when max drawdown is negative', () => {
      const trades = generateTrades([100, 200, 150, 300, 250], new Date('2025-01-01'), 3);
      expect(calculateCalmarRatio(trades, -5)).toBeNull();
    });

    it('should return null when max drawdown is NaN', () => {
      const trades = generateTrades([100, 200, 150, 300, 250], new Date('2025-01-01'), 3);
      expect(calculateCalmarRatio(trades, NaN)).toBeNull();
    });

    it('should return null when trading period is less than 7 days', () => {
      // 5 trades over 5 days (1 day apart)
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 1);
      expect(calculateCalmarRatio(trades, 5)).toBeNull();
    });

    it('should return null when trades have no timestamps', () => {
      const trades = [
        { pnl: 100 },
        { pnl: -50 },
        { pnl: 200 },
        { pnl: -30 },
        { pnl: 150 },
      ];
      expect(calculateCalmarRatio(trades, 5)).toBeNull();
    });

    it('should handle string pnl values', () => {
      const start = new Date('2025-01-01');
      const trades = [
        { pnl: '100', timestamp: new Date(start.getTime() + 0) },
        { pnl: '-50', timestamp: new Date(start.getTime() + 3 * 86400000) },
        { pnl: '200', timestamp: new Date(start.getTime() + 6 * 86400000) },
        { pnl: '-30', timestamp: new Date(start.getTime() + 9 * 86400000) },
        { pnl: '150', timestamp: new Date(start.getTime() + 12 * 86400000) },
      ];
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('should handle NaN pnl values gracefully', () => {
      const start = new Date('2025-01-01');
      const trades = [
        { pnl: NaN, timestamp: new Date(start.getTime() + 0) },
        { pnl: 100, timestamp: new Date(start.getTime() + 3 * 86400000) },
        { pnl: -50, timestamp: new Date(start.getTime() + 6 * 86400000) },
        { pnl: 200, timestamp: new Date(start.getTime() + 9 * 86400000) },
        { pnl: -30, timestamp: new Date(start.getTime() + 12 * 86400000) },
      ];
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
    });
  });

  // ============================================================================
  // Core Calculation
  // ============================================================================
  describe('Core Calculation', () => {
    it('should calculate positive Calmar for profitable strategy', () => {
      // $10,000 starting balance, 5 trades over 30 days, total P&L = +$370
      // Total return = 3.7%, annualized = 3.7% * (365/30) = 45.02%
      // Max drawdown = 5%, Calmar = 45.02 / 5 = 9.0
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 8);
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it('should calculate negative Calmar for losing strategy', () => {
      // Total P&L = -$350, negative return
      const trades = generateTrades([-100, -50, -100, -50, -50], new Date('2025-01-01'), 8);
      const result = calculateCalmarRatio(trades, 10);
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(0);
    });

    it('should scale with annualization correctly', () => {
      // Same P&L over different time periods should produce different Calmar ratios
      const pnls = [100, -50, 200, -30, 150]; // Total = +$370

      // 30 days → higher annualized return → higher Calmar
      const trades30d = generateTrades(pnls, new Date('2025-01-01'), 8); // ~32 days
      const calmar30d = calculateCalmarRatio(trades30d, 5);

      // 180 days → lower annualized return → lower Calmar
      const trades180d = generateTrades(pnls, new Date('2025-01-01'), 45); // ~180 days
      const calmar180d = calculateCalmarRatio(trades180d, 5);

      expect(calmar30d).not.toBeNull();
      expect(calmar180d).not.toBeNull();
      // Shorter period should have higher annualized return → higher Calmar
      expect(calmar30d!).toBeGreaterThan(calmar180d!);
    });

    it('should be inversely proportional to max drawdown', () => {
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 8);

      const calmarSmallDD = calculateCalmarRatio(trades, 2);  // Small drawdown
      const calmarLargeDD = calculateCalmarRatio(trades, 20); // Large drawdown

      expect(calmarSmallDD).not.toBeNull();
      expect(calmarLargeDD).not.toBeNull();
      // Smaller drawdown → higher Calmar (same return, less risk)
      expect(calmarSmallDD!).toBeGreaterThan(calmarLargeDD!);
    });

    it('should be clamped to [-10, 10] range', () => {
      // Extremely profitable over short period with tiny drawdown
      const trades = generateTrades([5000, 3000, 2000, 1000, 500], new Date('2025-01-01'), 3);
      const result = calculateCalmarRatio(trades, 0.1); // 0.1% drawdown
      expect(result).toBe(10); // Capped at 10

      // Extremely losing strategy
      const losingTrades = generateTrades([-5000, -3000, -2000, -1000, -500], new Date('2025-01-01'), 3);
      const losingResult = calculateCalmarRatio(losingTrades, 0.1);
      expect(losingResult).toBe(-10); // Capped at -10
    });
  });

  // ============================================================================
  // Wallet Starting Balance
  // ============================================================================
  describe('Wallet Starting Balance', () => {
    it('should use provided wallet balance', () => {
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 8);

      // $100,000 balance → 0.37% return → lower Calmar
      const calmarLargeBalance = calculateCalmarRatio(trades, 5, 100000);
      // $1,000 balance → 37% return → higher Calmar
      const calmarSmallBalance = calculateCalmarRatio(trades, 5, 1000);

      expect(calmarLargeBalance).not.toBeNull();
      expect(calmarSmallBalance).not.toBeNull();
      expect(calmarSmallBalance!).toBeGreaterThan(calmarLargeBalance!);
    });

    it('should fall back to $10,000 for invalid starting balance', () => {
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 8);

      const calmarDefault = calculateCalmarRatio(trades, 5);
      const calmarZero = calculateCalmarRatio(trades, 5, 0);
      const calmarNegative = calculateCalmarRatio(trades, 5, -5000);

      expect(calmarDefault).toEqual(calmarZero);
      expect(calmarDefault).toEqual(calmarNegative);
    });
  });

  // ============================================================================
  // Timestamp Handling
  // ============================================================================
  describe('Timestamp Handling', () => {
    it('should handle string timestamps', () => {
      const trades = [
        { pnl: 100, timestamp: '2025-01-01T00:00:00Z' },
        { pnl: -50, timestamp: '2025-01-05T00:00:00Z' },
        { pnl: 200, timestamp: '2025-01-10T00:00:00Z' },
        { pnl: -30, timestamp: '2025-01-15T00:00:00Z' },
        { pnl: 150, timestamp: '2025-01-20T00:00:00Z' },
      ];
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('should handle Date object timestamps', () => {
      const trades = generateTrades([100, -50, 200, -30, 150], new Date('2025-01-01'), 5);
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
    });

    it('should handle mixed valid and null timestamps', () => {
      const start = new Date('2025-01-01');
      const trades = [
        { pnl: 100, timestamp: new Date(start.getTime() + 0) },
        { pnl: -50, timestamp: null },
        { pnl: 200, timestamp: new Date(start.getTime() + 10 * 86400000) },
        { pnl: -30, timestamp: null },
        { pnl: 150, timestamp: new Date(start.getTime() + 20 * 86400000) },
      ];
      const result = calculateCalmarRatio(trades, 5);
      // Should still work with at least 2 valid timestamps spanning > 7 days
      expect(result).not.toBeNull();
    });
  });

  // ============================================================================
  // Institutional Benchmarks
  // ============================================================================
  describe('Institutional Benchmarks', () => {
    it('should identify exceptional strategy (Calmar > 3)', () => {
      // High return, low drawdown over a reasonable period
      // $10,000 balance, +$2,000 over 90 days = 20% return
      // Annualized: 20% * (365/90) = 81.1%
      // Max drawdown: 5% → Calmar = 81.1 / 5 = 16.2 → capped at 10
      const trades = generateTrades(
        [500, -100, 600, -50, 400, -80, 300, 200, -70, 300],
        new Date('2025-01-01'),
        10
      );
      const result = calculateCalmarRatio(trades, 5);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(3);
    });

    it('should identify poor strategy (Calmar < 1)', () => {
      // Low return relative to drawdown
      // $10,000 balance, +$50 over 365 days = 0.5% annualized
      // Max drawdown: 15% → Calmar = 0.5 / 15 = 0.033
      const trades = generateTrades(
        [20, -10, 15, -5, 10, -8, 12, -6, 15, 7],
        new Date('2025-01-01'),
        40
      );
      const result = calculateCalmarRatio(trades, 15);
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(1);
    });

    it('should identify losing strategy (Calmar < 0)', () => {
      const trades = generateTrades(
        [-100, -200, 50, -150, -100, 30, -80, -50, 20, -100],
        new Date('2025-01-01'),
        10
      );
      const result = calculateCalmarRatio(trades, 20);
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(0);
    });
  });

  // ============================================================================
  // Relationship with Sharpe/Sortino
  // ============================================================================
  describe('Calmar vs Sharpe/Sortino Conceptual', () => {
    it('should be independent of return volatility (only cares about drawdown)', () => {
      // Two strategies with same total return and drawdown but different volatility
      // Strategy A: smooth returns
      const smoothTrades = generateTrades(
        [74, 74, 74, 74, 74],
        new Date('2025-01-01'),
        10
      );
      // Strategy B: volatile returns (same total = 370)
      const volatileTrades = generateTrades(
        [500, -300, 400, -280, 50],
        new Date('2025-01-01'),
        10
      );

      const calmarSmooth = calculateCalmarRatio(smoothTrades, 5);
      const calmarVolatile = calculateCalmarRatio(volatileTrades, 5);

      expect(calmarSmooth).not.toBeNull();
      expect(calmarVolatile).not.toBeNull();
      // Same total P&L, same drawdown, same period → same Calmar
      expect(calmarSmooth!).toBeCloseTo(calmarVolatile!, 1);
    });
  });

  // ============================================================================
  // Performance
  // ============================================================================
  describe('Performance', () => {
    it('should handle 1000 trades efficiently', () => {
      const pnls = Array.from({ length: 1000 }, (_, i) =>
        i % 3 === 0 ? -(Math.random() * 100) : Math.random() * 200
      );
      const trades = generateTrades(pnls, new Date('2024-01-01'), 1);

      const start = performance.now();
      const result = calculateCalmarRatio(trades, 10);
      const elapsed = performance.now() - start;

      expect(result).not.toBeNull();
      expect(elapsed).toBeLessThan(50); // Should complete in under 50ms
    });
  });
});
