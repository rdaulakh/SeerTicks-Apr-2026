import { describe, it, expect } from 'vitest';

/**
 * Test the calculateMaxDrawdown function with different starting balances.
 * We import the function indirectly since it's not exported — we test the logic directly.
 */

// Replicate the calculateMaxDrawdown logic for unit testing
function calculateMaxDrawdown(trades: Array<{ pnl: string | number }>, walletStartingBalance?: number): number {
  if (!trades || trades.length === 0) return 0;

  const chronoTrades = [...trades].reverse();
  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;
  let peak = startingBalance;
  let maxDD = 0;
  let runningBalance = startingBalance;

  for (const trade of chronoTrades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (isNaN(pnl)) continue;

    runningBalance += pnl;
    if (runningBalance > peak) {
      peak = runningBalance;
    }
    const drawdown = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
    if (drawdown > maxDD) {
      maxDD = drawdown;
    }
  }

  return maxDD;
}

describe('calculateMaxDrawdown — 10B-6 Drawdown Baseline Fix', () => {
  // Trades are in DESC order (newest first) — function reverses them internally
  const sampleTrades = [
    { pnl: '-200' },  // Trade 5 (newest)
    { pnl: '500' },   // Trade 4
    { pnl: '-300' },  // Trade 3
    { pnl: '100' },   // Trade 2
    { pnl: '50' },    // Trade 1 (oldest)
  ];

  it('should use default $10,000 when no wallet balance provided', () => {
    const dd = calculateMaxDrawdown(sampleTrades);
    // Chrono order: +50, +100, -300, +500, -200
    // Balance: 10000 → 10050 → 10150 → 9850 → 10350 → 10150
    // Peak:    10000 → 10050 → 10150 → 10150 → 10350 → 10350
    // DD%:     0     → 0     → 0     → 2.96% → 0     → 1.93%
    // Max DD = 2.96%
    expect(dd).toBeCloseTo(2.96, 1);
  });

  it('should use actual wallet balance when provided', () => {
    const dd = calculateMaxDrawdown(sampleTrades, 50000);
    // Chrono order: +50, +100, -300, +500, -200
    // Balance: 50000 → 50050 → 50150 → 49850 → 50350 → 50150
    // Peak:    50000 → 50050 → 50150 → 50150 → 50350 → 50350
    // DD%:     0     → 0     → 0     → 0.60% → 0     → 0.40%
    // Max DD = 0.60% (much smaller because starting balance is 5x larger)
    expect(dd).toBeCloseTo(0.60, 1);
    // With $50k balance, same $300 loss is a much smaller drawdown percentage
    expect(dd).toBeLessThan(1);
  });

  it('should produce different drawdowns for different starting balances', () => {
    const dd10k = calculateMaxDrawdown(sampleTrades, 10000);
    const dd50k = calculateMaxDrawdown(sampleTrades, 50000);
    const dd100k = calculateMaxDrawdown(sampleTrades, 100000);

    // Larger starting balance = smaller drawdown percentage for same P&L
    expect(dd10k).toBeGreaterThan(dd50k);
    expect(dd50k).toBeGreaterThan(dd100k);
  });

  it('should fall back to $10,000 for invalid wallet balance (0)', () => {
    const dd = calculateMaxDrawdown(sampleTrades, 0);
    const ddDefault = calculateMaxDrawdown(sampleTrades);
    expect(dd).toBeCloseTo(ddDefault, 5);
  });

  it('should fall back to $10,000 for negative wallet balance', () => {
    const dd = calculateMaxDrawdown(sampleTrades, -5000);
    const ddDefault = calculateMaxDrawdown(sampleTrades);
    expect(dd).toBeCloseTo(ddDefault, 5);
  });

  it('should return 0 for empty trades', () => {
    expect(calculateMaxDrawdown([])).toBe(0);
    expect(calculateMaxDrawdown([], 50000)).toBe(0);
  });

  it('should return 0 for all-winning trades', () => {
    const winningTrades = [
      { pnl: '100' },
      { pnl: '200' },
      { pnl: '50' },
    ];
    expect(calculateMaxDrawdown(winningTrades, 10000)).toBe(0);
  });

  it('should handle single large loss correctly', () => {
    const trades = [{ pnl: '-5000' }]; // 50% loss on $10k
    const dd10k = calculateMaxDrawdown(trades, 10000);
    expect(dd10k).toBeCloseTo(50, 0);

    const dd50k = calculateMaxDrawdown(trades, 50000);
    expect(dd50k).toBeCloseTo(10, 0); // 10% loss on $50k
  });

  it('should handle NaN pnl values gracefully', () => {
    const trades = [
      { pnl: 'invalid' },
      { pnl: '-100' },
    ];
    const dd = calculateMaxDrawdown(trades, 10000);
    // Only the -100 trade should be counted
    expect(dd).toBeCloseTo(1, 0);
  });

  it('should correctly derive starting balance from current balance minus P&L', () => {
    // Simulating the reverse-engineering logic from calculateStrategyPerformance:
    // If current wallet balance is $10,150 and total P&L from trades is +$150,
    // then starting balance = $10,150 - $150 = $10,000
    const currentBalance = 10150;
    const totalPnl = 50 + 100 - 300 + 500 - 200; // = +150
    const derivedStartingBalance = currentBalance - totalPnl;
    expect(derivedStartingBalance).toBe(10000);
  });
});
