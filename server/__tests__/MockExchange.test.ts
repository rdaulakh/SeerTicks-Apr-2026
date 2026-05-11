/**
 * Tests for MockExchange — Phase 68
 *
 * Verifies the backtest exchange behaves like a real exchange would:
 *  - Market orders fill at next-candle close (with slippage)
 *  - Limit orders queue and fill when intra-bar low/high crosses
 *  - Long/short tracking, weighted-avg entry, PnL realization on close
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockClock } from '../_core/clock';
import { MockExchange } from '../exchanges/MockExchange';
import type { MarketData } from '../exchanges/ExchangeInterface';

function makeCandles(start: number, prices: number[]): MarketData[] {
  return prices.map((p, i) => ({
    timestamp: start + i * 60000,
    open: p,
    high: p * 1.01,
    low: p * 0.99,
    close: p,
    volume: 1000,
  }));
}

describe('MockExchange', () => {
  let clock: MockClock;
  let exchange: MockExchange;

  beforeEach(() => {
    clock = new MockClock(1_000_000_000_000);
    exchange = new MockExchange(clock, {
      startingBalanceUsdt: 10000,
      slippageBpsPerSide: 5,
      takerFeeBps: 4,
    });
    exchange.loadCandles('BTC-USD', makeCandles(1_000_000_000_000, [100, 101, 102, 103, 102, 101]));
  });

  it('starts with the configured USDT balance', async () => {
    const balances = await exchange.getAccountBalance();
    expect(balances[0].asset).toBe('USDT');
    expect(balances[0].free).toBe(10000);
  });

  it('market BUY opens a long at slipped price', async () => {
    const result = await exchange.placeMarketOrder({
      symbol: 'BTC-USD',
      side: 'buy',
      type: 'market',
      quantity: 1,
    });
    expect(result.status).toBe('filled');
    expect(result.executedQty).toBe(1);
    // First candle close=100, +5bps slippage → ~100.05
    expect(result.executedPrice).toBeCloseTo(100.05, 2);

    const pos = await exchange.getPosition('BTC-USD');
    expect(pos).not.toBeNull();
    expect(pos!.side).toBe('long');
    expect(pos!.quantity).toBe(1);
  });

  it('closing a long realizes PnL', async () => {
    await exchange.placeMarketOrder({
      symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 1,
    });
    // Move forward 3 candles → close should be 103
    clock.advance(3 * 60 * 1000);
    exchange.syncCursor('BTC-USD');
    // Close the long
    const closeResult = await exchange.placeMarketOrder({
      symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 1,
    });
    expect(closeResult.status).toBe('filled');
    // Sold at 103 - 5bps = ~102.95, bought at ~100.05
    // Realized PnL ≈ 102.95 - 100.05 = 2.90 per unit
    const pos = await exchange.getPosition('BTC-USD');
    expect(pos).toBeNull();
    expect(exchange.getRealizedPnl()).toBeGreaterThan(2.5);
    expect(exchange.getRealizedPnl()).toBeLessThan(3.5);
  });

  it('shorting + closing realizes inverse PnL', async () => {
    // Sell at 100 (open short)
    await exchange.placeMarketOrder({
      symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 1,
    });
    const pos = await exchange.getPosition('BTC-USD');
    expect(pos!.side).toBe('short');
    // Move forward to a candle where close=101 (price moves AGAINST short)
    clock.advance(60 * 1000);
    exchange.syncCursor('BTC-USD');
    // Buy to close
    await exchange.placeMarketOrder({
      symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 1,
    });
    // Should be small loss (price moved up while short)
    expect(exchange.getRealizedPnl()).toBeLessThan(0);
  });

  it('limit order fills when intra-bar low crosses the price', async () => {
    // Place a buy limit at 95 (below current close=100)
    const order = await exchange.placeLimitOrder({
      symbol: 'BTC-USD', side: 'buy', type: 'limit', quantity: 1, price: 95,
    });
    expect(order.status).toBe('new');

    // Advance — none of the candles' lows touch 95 (lows are 99,100,101,102,101,100)
    clock.advance(5 * 60 * 1000);
    exchange.tick();
    let status = await exchange.getOrderStatus(order.orderId, 'BTC-USD');
    expect(status.status).toBe('new');  // Still pending

    // Drop price by loading a new candle with low=94
    exchange.loadCandles('BTC-USD', [
      ...makeCandles(1_000_000_000_000, [100, 101, 102, 103, 102, 101]),
      { timestamp: 1_000_000_000_000 + 6 * 60000, open: 96, high: 97, low: 94, close: 95.5, volume: 1000 },
    ]);
    clock.advance(60 * 1000); // total now at the new candle
    exchange.tick();
    status = await exchange.getOrderStatus(order.orderId, 'BTC-USD');
    expect(status.status).toBe('filled');
    expect(status.executedPrice).toBe(95);  // Filled at limit price
  });

  it('cancelOrder removes a pending limit', async () => {
    const order = await exchange.placeLimitOrder({
      symbol: 'BTC-USD', side: 'buy', type: 'limit', quantity: 1, price: 50,
    });
    const cancelled = await exchange.cancelOrder(order.orderId, 'BTC-USD');
    expect(cancelled).toBe(true);
    const status = await exchange.getOrderStatus(order.orderId, 'BTC-USD');
    expect(status.status).toBe('rejected');
  });

  it('getMarketData returns historical candles up to cursor', async () => {
    clock.advance(2 * 60 * 1000);
    exchange.syncCursor('BTC-USD');  // explicit sync (price/order operations would auto-sync)
    const candles = await exchange.getMarketData('BTC-USD', '1m', 10);
    expect(candles.length).toBe(3); // candles 0, 1, 2
    expect(candles[candles.length - 1].close).toBe(102);
  });
});
