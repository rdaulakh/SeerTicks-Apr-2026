/**
 * MockExchange — Phase 68
 *
 * Implements ExchangeInterface for backtests. Same shape the live trading
 * engine sees from BinanceFuturesAdapter / BinanceAdapter / CoinbaseAdapter,
 * but powered by replayed historical candles instead of a real venue.
 *
 * Fill model:
 *   - Market orders fill at the NEXT tick's open (configurable slippage in bps).
 *   - Limit orders queue against the order book; filled when intra-bar
 *     low/high crosses the limit price.
 *
 * Loading data:
 *   - The harness pushes candles via `pushCandle(symbol, candle)` ahead of
 *     advancing the clock. The exchange resolves prices/fills from those.
 *
 * Account model:
 *   - Single USDT-denominated balance. Positions tracked per-symbol with
 *     side + qty + entryPrice (weighted-average). Realized/unrealized
 *     PnL surfaced via getAccountBalance / getPosition.
 */

import {
  ExchangeInterface,
  type Balance,
  type MarketData,
  type OrderBook,
  type OrderParams,
  type OrderResult,
  type Position,
  type TickCallback,
} from './ExchangeInterface';
import type { Clock } from '../_core/clock';

export interface MockExchangeConfig {
  startingBalanceUsdt: number;     // default 10000
  slippageBpsPerSide: number;      // default 5 (= 5bps each side)
  takerFeeBps: number;             // default 4 (= 0.04%)
  exchangeName?: 'binance' | 'coinbase';
}

const DEFAULT_CONFIG: MockExchangeConfig = {
  startingBalanceUsdt: 10000,
  slippageBpsPerSide: 5,
  takerFeeBps: 4,
  exchangeName: 'binance',
};

interface CandleStore {
  candles: MarketData[];       // chronological
  cursor: number;              // index of "current" candle
}

interface MockPosition {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
}

interface PendingLimit {
  orderId: string;
  params: OrderParams;
  placedAt: number;
}

export class MockExchange extends ExchangeInterface {
  private cfg: MockExchangeConfig;
  private clock: Clock;
  private candles = new Map<string, CandleStore>();
  private positions = new Map<string, MockPosition>();
  private balanceUsdt: number;
  private realizedPnl = 0;
  private pendingLimits: PendingLimit[] = [];
  private orderSeq = 0;
  private filledOrders = new Map<string, OrderResult>();

  constructor(clock: Clock, config: Partial<MockExchangeConfig> = {}) {
    super('mock-api-key', 'mock-api-secret');
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.clock = clock;
    this.balanceUsdt = this.cfg.startingBalanceUsdt;
    this.isConnected = true;
  }

  // ── Harness API ──────────────────────────────────────────────────────────

  /** Bulk-load historical candles for a symbol (chronological). */
  loadCandles(symbol: string, candles: MarketData[]): void {
    const normalized = symbol.toUpperCase();
    this.candles.set(normalized, {
      candles: [...candles].sort((a, b) => a.timestamp - b.timestamp),
      cursor: 0,
    });
  }

  /** Advance the candle cursor for a symbol to whatever's now at clock.now(). */
  syncCursor(symbol: string): MarketData | undefined {
    const store = this.candles.get(symbol.toUpperCase());
    if (!store) return undefined;
    const t = this.clock.now();
    while (store.cursor < store.candles.length - 1 && store.candles[store.cursor + 1].timestamp <= t) {
      store.cursor++;
    }
    return store.candles[store.cursor];
  }

  /**
   * Called by the harness on every tick advance — fills any pending limit orders
   * that intra-bar would have triggered.
   */
  tick(): void {
    if (this.pendingLimits.length === 0) return;
    const remaining: PendingLimit[] = [];
    for (const pl of this.pendingLimits) {
      const candle = this.syncCursor(pl.params.symbol);
      if (!candle || pl.params.price === undefined) {
        remaining.push(pl);
        continue;
      }
      const wouldFill = pl.params.side === 'buy'
        ? candle.low <= pl.params.price
        : candle.high >= pl.params.price;
      if (wouldFill) {
        const fill = this.executeFillInternal(pl.params, pl.params.price);
        this.filledOrders.set(pl.orderId, fill);
      } else {
        remaining.push(pl);
      }
    }
    this.pendingLimits = remaining;
  }

  // ── ExchangeInterface implementation ──────────────────────────────────────

  getExchangeName(): 'binance' | 'coinbase' {
    return this.cfg.exchangeName ?? 'binance';
  }

  async testConnection(): Promise<boolean> { return true; }

  async connectWebSocket(_symbol: string, _callback: TickCallback): Promise<void> {
    // No-op — the backtest harness drives ticks via clock.advance().
  }

  async disconnectWebSocket(): Promise<void> {
    // No-op.
  }

  async getOrderBook(symbol: string, _depth?: number): Promise<OrderBook> {
    const candle = this.syncCursor(symbol);
    if (!candle) return { bids: [], asks: [], timestamp: this.clock.now() };
    // Synthesize a thin book around close price using configured spread.
    const spread = (this.cfg.slippageBpsPerSide * 2) / 10_000;
    const mid = candle.close;
    return {
      bids: [
        { price: mid * (1 - spread / 2), quantity: candle.volume * 0.01 },
        { price: mid * (1 - spread), quantity: candle.volume * 0.01 },
      ],
      asks: [
        { price: mid * (1 + spread / 2), quantity: candle.volume * 0.01 },
        { price: mid * (1 + spread), quantity: candle.volume * 0.01 },
      ],
      timestamp: this.clock.now(),
    };
  }

  async placeMarketOrder(params: OrderParams): Promise<OrderResult> {
    const candle = this.syncCursor(params.symbol);
    if (!candle) {
      return {
        orderId: this.nextOrderId(),
        symbol: params.symbol,
        status: 'rejected',
        executedQty: 0,
        timestamp: this.clock.now(),
      };
    }
    // Market: fill at this candle's close with slippage
    const slip = this.cfg.slippageBpsPerSide / 10_000;
    const fillPrice = params.side === 'buy' ? candle.close * (1 + slip) : candle.close * (1 - slip);
    return this.executeFillInternal(params, fillPrice);
  }

  async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
    const orderId = this.nextOrderId();
    this.pendingLimits.push({ orderId, params, placedAt: this.clock.now() });
    return {
      orderId,
      symbol: params.symbol,
      status: 'new',
      executedQty: 0,
      timestamp: this.clock.now(),
    };
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<boolean> {
    const idx = this.pendingLimits.findIndex(p => p.orderId === orderId);
    if (idx >= 0) {
      this.pendingLimits.splice(idx, 1);
      return true;
    }
    return false;
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<OrderResult> {
    const filled = this.filledOrders.get(orderId);
    if (filled) return filled;
    const pending = this.pendingLimits.find(p => p.orderId === orderId);
    if (pending) {
      return {
        orderId,
        symbol,
        status: 'new',
        executedQty: 0,
        timestamp: pending.placedAt,
      };
    }
    return {
      orderId,
      symbol,
      status: 'rejected',
      executedQty: 0,
      timestamp: this.clock.now(),
    };
  }

  async getPosition(symbol: string): Promise<Position | null> {
    const key = symbol.toUpperCase();
    const pos = this.positions.get(key);
    if (!pos) return null;
    const candle = this.syncCursor(symbol);
    const currentPrice = candle?.close ?? pos.entryPrice;
    const unrealizedPnl = pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - currentPrice) * pos.quantity;
    return {
      symbol: key,
      side: pos.side,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      currentPrice,
      unrealizedPnl,
    };
  }

  async getAccountBalance(_asset?: string): Promise<Balance[]> {
    // Sum unrealized PnL across positions
    let unrealized = 0;
    for (const [sym, pos] of this.positions) {
      const candle = this.syncCursor(sym);
      const px = candle?.close ?? pos.entryPrice;
      unrealized += pos.side === 'long'
        ? (px - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - px) * pos.quantity;
    }
    const equity = this.balanceUsdt + unrealized;
    return [{ asset: 'USDT', free: this.balanceUsdt, locked: 0, total: equity }];
  }

  async getMarketData(symbol: string, _interval: string, limit: number): Promise<MarketData[]> {
    const store = this.candles.get(symbol.toUpperCase());
    if (!store) return [];
    const end = store.cursor + 1;
    return store.candles.slice(Math.max(0, end - limit), end);
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const candle = this.syncCursor(symbol);
    return candle?.close ?? 0;
  }

  async getTicker(symbol: string): Promise<{ last: number; volume: number; high: number; low: number }> {
    const candle = this.syncCursor(symbol);
    if (!candle) return { last: 0, volume: 0, high: 0, low: 0 };
    return { last: candle.close, volume: candle.volume, high: candle.high, low: candle.low };
  }

  async getTradingFees(_symbol: string): Promise<{ maker: number; taker: number }> {
    const feePct = this.cfg.takerFeeBps / 10_000;
    return { maker: feePct * 0.5, taker: feePct };
  }

  protected normalizeSymbol(symbol: string): string {
    return symbol.toUpperCase().replace('-', '');
  }

  protected denormalizeSymbol(symbol: string): string {
    return symbol;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private nextOrderId(): string {
    return `mock_${++this.orderSeq}_${this.clock.now()}`;
  }

  private executeFillInternal(params: OrderParams, fillPrice: number): OrderResult {
    const key = params.symbol.toUpperCase();
    const fee = (fillPrice * params.quantity) * (this.cfg.takerFeeBps / 10_000);
    const existing = this.positions.get(key);

    if (params.side === 'buy') {
      if (!existing || existing.quantity === 0) {
        // Open new long
        this.positions.set(key, { symbol: key, side: 'long', quantity: params.quantity, entryPrice: fillPrice });
      } else if (existing.side === 'long') {
        // Add to long (weighted avg)
        const totalQty = existing.quantity + params.quantity;
        const avgPrice = (existing.entryPrice * existing.quantity + fillPrice * params.quantity) / totalQty;
        existing.quantity = totalQty;
        existing.entryPrice = avgPrice;
      } else {
        // Reducing/flipping short → long
        const closing = Math.min(existing.quantity, params.quantity);
        const realized = (existing.entryPrice - fillPrice) * closing;
        this.realizedPnl += realized;
        this.balanceUsdt += realized;
        existing.quantity -= closing;
        const remaining = params.quantity - closing;
        if (existing.quantity === 0) this.positions.delete(key);
        if (remaining > 0) {
          this.positions.set(key, { symbol: key, side: 'long', quantity: remaining, entryPrice: fillPrice });
        }
      }
    } else { // sell
      if (!existing || existing.quantity === 0) {
        // Open new short
        this.positions.set(key, { symbol: key, side: 'short', quantity: params.quantity, entryPrice: fillPrice });
      } else if (existing.side === 'short') {
        // Add to short
        const totalQty = existing.quantity + params.quantity;
        const avgPrice = (existing.entryPrice * existing.quantity + fillPrice * params.quantity) / totalQty;
        existing.quantity = totalQty;
        existing.entryPrice = avgPrice;
      } else {
        // Reducing/flipping long → short
        const closing = Math.min(existing.quantity, params.quantity);
        const realized = (fillPrice - existing.entryPrice) * closing;
        this.realizedPnl += realized;
        this.balanceUsdt += realized;
        existing.quantity -= closing;
        const remaining = params.quantity - closing;
        if (existing.quantity === 0) this.positions.delete(key);
        if (remaining > 0) {
          this.positions.set(key, { symbol: key, side: 'short', quantity: remaining, entryPrice: fillPrice });
        }
      }
    }

    this.balanceUsdt -= fee;
    const orderId = this.nextOrderId();
    const result: OrderResult = {
      orderId,
      symbol: key,
      status: 'filled',
      executedQty: params.quantity,
      executedPrice: fillPrice,
      timestamp: this.clock.now(),
    };
    this.filledOrders.set(orderId, result);
    return result;
  }

  // ── Backtest reporting helpers ───────────────────────────────────────────

  getRealizedPnl(): number { return this.realizedPnl; }
  getEquityUsdt(): number {
    let unrealized = 0;
    for (const [sym, pos] of this.positions) {
      const candle = this.syncCursor(sym);
      const px = candle?.close ?? pos.entryPrice;
      unrealized += pos.side === 'long'
        ? (px - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - px) * pos.quantity;
    }
    return this.balanceUsdt + unrealized;
  }
  getOpenPositions(): MockPosition[] {
    return Array.from(this.positions.values());
  }
}
