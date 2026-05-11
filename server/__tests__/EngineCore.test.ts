/**
 * Tests for EngineCore — Phase 68
 *
 * Verifies the abstraction: a simple decision function plugged into
 * EngineCore + MockClock + MockExchange produces sensible backtest results.
 */

import { describe, it, expect } from 'vitest';
import { MockClock } from '../_core/clock';
import { MockExchange } from '../exchanges/MockExchange';
import { EngineCore } from '../_core/engineCore';
import type { MarketData } from '../exchanges/ExchangeInterface';

function makeUptrendCandles(start: number, count: number, startPrice: number, perCandleBps: number): MarketData[] {
  const candles: MarketData[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    candles.push({
      timestamp: start + i * 60_000,
      open: price,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1000,
    });
    price = price * (1 + perCandleBps / 10_000);
  }
  return candles;
}

describe('EngineCore', () => {
  it('buy-and-hold on uptrend produces positive PnL', async () => {
    const startTime = 1_000_000_000_000;
    const clock = new MockClock(startTime);
    const exchange = new MockExchange(clock, { startingBalanceUsdt: 10_000 });

    // 60 candles uptrending 10bps each = +0.6% total
    const candles = makeUptrendCandles(startTime, 60, 100, 10);
    exchange.loadCandles('BTC-USD', candles);

    // Decision: buy 50 units on cycle 1, hold rest of the run
    const engine = new EngineCore(clock, exchange, {
      symbols: ['BTC-USD'],
      decisionFn: async (ctx) => {
        if (ctx.cycleIndex === 1) {
          return { symbol: 'BTC-USD', side: 'buy', quantity: 50, type: 'market' };
        }
        return null;
      },
    });

    const result = await engine.runBacktest(startTime, startTime + 60 * 60_000, 60_000);

    // Bought ~50 BTC at ~100, ended at ~106 → unrealized ~+300, minus fees
    expect(result.trades).toBe(1);
    expect(result.finalEquity).toBeGreaterThan(result.startingEquity);
    expect(result.snapshots.length).toBeGreaterThan(50);
  });

  it('losing trade produces drawdown', async () => {
    const startTime = 1_000_000_000_000;
    const clock = new MockClock(startTime);
    const exchange = new MockExchange(clock, { startingBalanceUsdt: 10_000 });

    // Downtrend: -20bps per candle for 30 candles = ~-6%
    const candles = makeUptrendCandles(startTime, 30, 100, -20);
    exchange.loadCandles('BTC-USD', candles);

    const engine = new EngineCore(clock, exchange, {
      symbols: ['BTC-USD'],
      decisionFn: async (ctx) => {
        if (ctx.cycleIndex === 1) {
          return { symbol: 'BTC-USD', side: 'buy', quantity: 50, type: 'market' };
        }
        return null;
      },
    });

    const result = await engine.runBacktest(startTime, startTime + 30 * 60_000, 60_000);
    expect(result.finalEquity).toBeLessThan(result.startingEquity);
    expect(result.maxDrawdownPercent).toBeGreaterThan(0);
  });

  it('engine without decision fn just snapshots equity over time', async () => {
    const startTime = 1_000_000_000_000;
    const clock = new MockClock(startTime);
    const exchange = new MockExchange(clock, { startingBalanceUsdt: 10_000 });
    exchange.loadCandles('BTC-USD', makeUptrendCandles(startTime, 10, 100, 0));

    const engine = new EngineCore(clock, exchange, { symbols: ['BTC-USD'] });
    const result = await engine.runBacktest(startTime, startTime + 10 * 60_000, 60_000);
    expect(result.trades).toBe(0);
    expect(result.finalEquity).toBe(10_000); // No trades, no PnL
  });
});
