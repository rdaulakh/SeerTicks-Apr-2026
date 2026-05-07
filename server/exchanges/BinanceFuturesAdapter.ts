/**
 * BinanceFuturesAdapter — Phase 55
 *
 * Execution adapter for Binance USDT-M perpetual futures (USDM).
 *
 * Why this exists: BinanceAdapter routes orders to Binance Spot. Spot only
 * allows long-side trading — selling without ownership is rejected by the
 * exchange. SEER's consensus engine emits both bullish and bearish signals,
 * so on a spot-only execution venue every bearish signal either:
 *   - became a synthetic "short" by selling existing inventory (works
 *     mathematically, but the local engine accounting drifts from reality
 *     and short positions never persist to DB), OR
 *   - was rejected with no good failure path
 *
 * USDT-M perps natively support both directions, lower fees (~0.05% taker
 * vs spot 0.10%), and are the standard market for crypto algo trading.
 * This adapter routes signed REST calls to the Binance Futures testnet
 * (testnet.binancefuture.com — separate from spot testnet) when
 * BINANCE_FUTURES_USE_TESTNET=1.
 *
 * Default leverage = 1× — risk profile matches spot (no margin amplification),
 * we just gain access to native shorts. Bump via setLeverage() if needed.
 *
 * One-way position mode: each symbol has at most one open position (long OR
 * short, not both simultaneously). Simpler state model — closing a position
 * means submitting an order on the opposite side with the same quantity, and
 * the exchange nets it down to zero. Hedge mode (separate long/short slots)
 * is supported by the API but adds complexity SEER doesn't need yet.
 */

import {
  ExchangeInterface,
  NormalizedTick,
  OrderBook,
  Balance,
  Position,
  OrderParams,
  OrderResult,
  MarketData,
  TickCallback,
} from "./ExchangeInterface";
import { USDMClient } from "binance";

interface FuturesSymbolFilter {
  stepSize: number;
  minQty: number;
  tickSize: number;
  minNotional: number;
}

export class BinanceFuturesAdapter extends ExchangeInterface {
  private client: any; // USDMClient instance
  private testnet: boolean;
  private symbolFilters: Map<string, FuturesSymbolFilter> = new Map();
  private filtersLoadedAt = 0;
  private readonly FILTERS_TTL_MS = 60 * 60 * 1000;
  private leverageSetFor: Set<string> = new Set();
  private readonly DEFAULT_LEVERAGE: number;

  constructor(
    apiKey: string,
    apiSecret: string,
    opts: { testnet?: boolean; defaultLeverage?: number } = {},
  ) {
    super(apiKey, apiSecret);
    this.testnet = opts.testnet ?? process.env.BINANCE_FUTURES_USE_TESTNET === '1';
    this.DEFAULT_LEVERAGE = opts.defaultLeverage ?? 1;
    this.client = new USDMClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      testnet: this.testnet,
    });
    if (this.testnet) {
      console.log('[BinanceFuturesAdapter] 🧪 USDM TESTNET — https://testnet.binancefuture.com');
    } else {
      console.log('[BinanceFuturesAdapter] LIVE — https://fapi.binance.com');
    }
  }

  getExchangeName(): "binance" | "coinbase" { return "binance"; }

  /**
   * "BTC-USD" / "BTC/USD" / "BTCUSDT" → Binance perp native "BTCUSDT".
   * Same shape as BinanceAdapter for spot — USD bridges to USDT for perps.
   */
  protected normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
      const [base, quote] = upper.split('-');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    if (upper.includes('/')) {
      const [base, quote] = upper.split('/');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    return upper.replace('/', '');
  }

  /** "BTCUSDT" → "BTC-USD" — inverse of normalizeSymbol for SEER-canonical output. */
  protected denormalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.endsWith('USDT')) {
      return `${upper.slice(0, -4)}-USD`;
    }
    if (upper.endsWith('USD')) {
      return `${upper.slice(0, -3)}-USD`;
    }
    return upper;
  }

  /**
   * Fetch and cache LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL per symbol on the
   * USDM exchange. Filter values can differ from spot — perps often have
   * coarser stepSize and a higher minNotional ($5 typical vs spot $10).
   */
  private async ensureSymbolFilters(): Promise<void> {
    if (this.symbolFilters.size > 0 && Date.now() - this.filtersLoadedAt < this.FILTERS_TTL_MS) return;
    try {
      const info = await this.client.getExchangeInfo();
      for (const sym of info.symbols || []) {
        const stepFilter = sym.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = sym.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        const notionalFilter = sym.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
        if (stepFilter && priceFilter) {
          this.symbolFilters.set(sym.symbol, {
            stepSize: parseFloat(stepFilter.stepSize),
            minQty: parseFloat(stepFilter.minQty),
            tickSize: parseFloat(priceFilter.tickSize),
            minNotional: notionalFilter ? parseFloat(notionalFilter.notional || notionalFilter.minNotional || '0') : 0,
          });
        }
      }
      this.filtersLoadedAt = Date.now();
      console.log(`[BinanceFuturesAdapter] Loaded LOT_SIZE/PRICE_FILTER for ${this.symbolFilters.size} perp symbols`);
    } catch (e: any) {
      console.warn('[BinanceFuturesAdapter] Failed to load symbol filters:', e?.message);
    }
  }

  private quantizeQuantity(symbol: string, qty: number): string {
    const f = this.symbolFilters.get(symbol);
    if (!f || !f.stepSize) return qty.toString();
    const floored = Math.floor(qty / f.stepSize) * f.stepSize;
    const decimals = Math.max(0, -Math.floor(Math.log10(f.stepSize)));
    return floored.toFixed(decimals);
  }

  private quantizePrice(symbol: string, price: number): string {
    const f = this.symbolFilters.get(symbol);
    if (!f || !f.tickSize) return price.toString();
    const rounded = Math.round(price / f.tickSize) * f.tickSize;
    const decimals = Math.max(0, -Math.floor(Math.log10(f.tickSize)));
    return rounded.toFixed(decimals);
  }

  /**
   * Set leverage once per symbol. Idempotent — Binance returns the existing
   * leverage on duplicate calls. Cached so we don't pay the round-trip on
   * every order. Default = 1× (no margin amplification).
   */
  private async ensureLeverage(symbol: string): Promise<void> {
    if (this.leverageSetFor.has(symbol)) return;
    try {
      await this.client.setLeverage({ symbol, leverage: this.DEFAULT_LEVERAGE });
      this.leverageSetFor.add(symbol);
      console.log(`[BinanceFuturesAdapter] Leverage set ${symbol} → ${this.DEFAULT_LEVERAGE}×`);
    } catch (e: any) {
      // Some symbols may already be at the requested leverage; binance returns success but
      // any setLeverage call can fail if the position is already non-zero. Don't block trades.
      console.warn(`[BinanceFuturesAdapter] setLeverage(${symbol}, ${this.DEFAULT_LEVERAGE}) warning:`, e?.message);
      this.leverageSetFor.add(symbol); // mark as attempted; don't retry every call
    }
  }

  /**
   * Phase 55 — enforce ONE-WAY position mode (dualSidePosition=false).
   *
   * Hedge mode lets long and short positions for the same symbol coexist as
   * separate slots, which breaks SEER's one-position-per-symbol invariant.
   * In hedge mode, opening a "long" leaves any existing short untouched, and
   * a "close" order has to specify positionSide; getPositions() returns two
   * rows per symbol (one LONG, one SHORT). All of that breaks our state model.
   *
   * One-way mode is what we want: each symbol has at most one open position
   * (long OR short, not both). Opening on the opposite side nets the existing
   * position down to zero before flipping. This call is idempotent — if the
   * account is already in one-way mode, Binance returns -4059 "No need to
   * change position side" which we swallow.
   *
   * Called once during adapter initialization on the first signed call. Cached
   * so we don't repeat the round-trip on every order.
   */
  private positionModeEnsured = false;
  private async ensureOneWayPositionMode(): Promise<void> {
    if (this.positionModeEnsured) return;
    try {
      await this.client.setPositionMode({ dualSidePosition: 'false' });
      console.log('[BinanceFuturesAdapter] One-way position mode confirmed');
    } catch (e: any) {
      // -4059 = "No need to change position side" → already one-way. That's success.
      const msg = e?.message || '';
      if (/-4059/.test(msg) || /no need/i.test(msg)) {
        console.log('[BinanceFuturesAdapter] Already in one-way position mode');
      } else {
        // Other failure — log and continue. If account ends up in hedge mode,
        // orders will fail with explicit errors that surface upstream.
        console.warn('[BinanceFuturesAdapter] setPositionMode(one-way) warning:', msg);
      }
    }
    this.positionModeEnsured = true;
  }

  async testConnection(): Promise<boolean> {
    // Phase 57.1 — let the real Binance error surface so addExchange /
    // refreshExchangeConnection can show the user what actually failed
    // (e.g. -2015 "Invalid API-key, IP, or permissions" → which of the
    // three is wrong) instead of a generic "rejected" message. The caller
    // is already wrapped in try/catch so a thrown error is correctly
    // converted into probeMessage in the response.
    const t = await Promise.race([
      this.client.getAccountInformation(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout after 10s contacting testnet.binancefuture.com')), 10_000)),
    ]);
    return !!t;
  }

  // WebSocket streaming is handled by the global futures WS in _core/index.ts
  // (Phase 52 wiring). Adapter doesn't manage its own WS — fills are observed
  // via getOrder() polling after submitNewOrder() returns the orderId.
  async connectWebSocket(_symbol: string, _callback: TickCallback): Promise<void> {
    // No-op — global futures WS already streams bookTicker / aggTrade / forceOrder.
  }

  async disconnectWebSocket(): Promise<void> {
    // No-op — see above.
  }

  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    const sym = this.normalizeSymbol(symbol);
    const r = await this.client.getOrderBook({ symbol: sym, limit: depth });
    return {
      bids: r.bids.map((b: [string, string]) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) })),
      asks: r.asks.map((a: [string, string]) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) })),
      timestamp: Date.now(),
    };
  }

  async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
    const sym = this.normalizeSymbol(params.symbol);
    await this.ensureOneWayPositionMode();
    await this.ensureSymbolFilters();
    await this.ensureLeverage(sym);
    const qtyStr = this.quantizeQuantity(sym, params.quantity);
    const priceStr = params.price !== undefined ? this.quantizePrice(sym, params.price) : undefined;
    const r = await this.client.submitNewOrder({
      symbol: sym,
      side: params.side.toUpperCase() as 'BUY' | 'SELL',
      type: 'LIMIT',
      quantity: qtyStr,
      price: priceStr,
      timeInForce: params.timeInForce || 'GTC',
    });
    return this.toOrderResult(r, params.symbol);
  }

  async placeMarketOrder(params: OrderParams): Promise<OrderResult> {
    const sym = this.normalizeSymbol(params.symbol);
    await this.ensureOneWayPositionMode();
    await this.ensureSymbolFilters();
    await this.ensureLeverage(sym);
    const qtyStr = this.quantizeQuantity(sym, params.quantity);
    const r = await this.client.submitNewOrder({
      symbol: sym,
      side: params.side.toUpperCase() as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity: qtyStr,
    });
    return this.toOrderResult(r, params.symbol);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const sym = this.normalizeSymbol(symbol);
    try {
      await this.client.cancelOrder({ symbol: sym, orderId: parseInt(orderId) });
      return true;
    } catch (e) {
      console.error('[BinanceFuturesAdapter] cancelOrder failed:', (e as Error)?.message);
      return false;
    }
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<OrderResult> {
    const sym = this.normalizeSymbol(symbol);
    const r = await this.client.getOrder({ symbol: sym, orderId: parseInt(orderId) });
    return this.toOrderResult(r, symbol);
  }

  /**
   * Futures positions: read from positionRisk-equivalent endpoint. positionAmt
   * is signed (+ long, − short); we map to SEER's Position type. Returns null
   * when the symbol has no open position (positionAmt === 0).
   */
  async getPosition(symbol: string): Promise<Position | null> {
    const sym = this.normalizeSymbol(symbol);
    try {
      const positions = await this.client.getPositions({ symbol: sym });
      const pos = positions.find((p: any) => p.symbol === sym && parseFloat(p.positionAmt) !== 0);
      if (!pos) return null;
      const amt = parseFloat(pos.positionAmt);
      return {
        symbol,
        side: amt > 0 ? 'long' : 'short',
        quantity: Math.abs(amt),
        entryPrice: parseFloat(pos.entryPrice),
        currentPrice: parseFloat(pos.markPrice),
        unrealizedPnl: parseFloat(pos.unRealizedProfit ?? pos.unrealizedProfit ?? '0'),
        leverage: parseFloat(pos.leverage ?? '1'),
      };
    } catch (e) {
      console.error('[BinanceFuturesAdapter] getPosition failed:', (e as Error)?.message);
      return null;
    }
  }

  /**
   * All open futures positions across the account. Used by RealTradingEngine
   * for periodic reconciliation against local DB state.
   */
  async getAllOpenPositions(): Promise<Position[]> {
    try {
      const positions = await this.client.getPositions();
      const out: Position[] = [];
      for (const p of positions) {
        const amt = parseFloat(p.positionAmt);
        if (amt === 0) continue;
        out.push({
          symbol: p.symbol,
          side: amt > 0 ? 'long' : 'short',
          quantity: Math.abs(amt),
          entryPrice: parseFloat(p.entryPrice),
          currentPrice: parseFloat(p.markPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit ?? p.unrealizedProfit ?? '0'),
          leverage: parseFloat(p.leverage ?? '1'),
        });
      }
      return out;
    } catch (e) {
      console.error('[BinanceFuturesAdapter] getAllOpenPositions failed:', (e as Error)?.message);
      return [];
    }
  }

  /**
   * Futures account balance. The futures account is wallet-scoped (a single
   * USDT balance funds all symbol positions via cross-margin) — we surface
   * the USDT row but also include non-zero asset rows for completeness.
   */
  async getAccountBalance(asset?: string): Promise<Balance[]> {
    try {
      const acct = await this.client.getAccountInformation();
      const assets: any[] = acct.assets || [];
      const out: Balance[] = [];
      for (const a of assets) {
        const free = parseFloat(a.availableBalance ?? a.maxWithdrawAmount ?? '0');
        const total = parseFloat(a.walletBalance ?? '0');
        const locked = Math.max(0, total - free);
        if (asset && a.asset !== asset) continue;
        if (!asset && total <= 0) continue;
        out.push({ asset: a.asset, free, locked, total });
      }
      return out;
    } catch (e) {
      console.error('[BinanceFuturesAdapter] getAccountBalance failed:', (e as Error)?.message);
      throw e;
    }
  }

  async getMarketData(_symbol: string, _interval: string, _limit?: number): Promise<MarketData[]> {
    // Klines via getKlines — same shape as spot, but USDM endpoint. SEER's
    // candle data path doesn't currently consume from adapter.getMarketData —
    // PriceFabric handles the WS-driven historical and live feed separately —
    // so a thin pass-through is sufficient.
    const sym = this.normalizeSymbol(_symbol);
    const candles = await this.client.getKlines({ symbol: sym, interval: _interval as any, limit: _limit ?? 200 });
    return candles.map((c: any[]) => ({
      timestamp: Number(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const sym = this.normalizeSymbol(symbol);
    const r = await this.client.getSymbolPriceTicker({ symbol: sym });
    return parseFloat((Array.isArray(r) ? r[0]?.price : r?.price) ?? '0');
  }

  async getTicker(symbol: string): Promise<{ last: number; volume: number; high: number; low: number }> {
    const sym = this.normalizeSymbol(symbol);
    const r = await this.client.get24hrChangeStatistics({ symbol: sym });
    return {
      last: parseFloat(r.lastPrice),
      volume: parseFloat(r.volume),
      high: parseFloat(r.highPrice),
      low: parseFloat(r.lowPrice),
    };
  }

  async getTradingFees(_symbol: string): Promise<{ maker: number; taker: number }> {
    // Default VIP0 USDM fees: maker 0.02%, taker 0.05%. Per-symbol override
    // via getCommissionRate() if needed. Returning defaults avoids extra
    // round-trips and is the right value for testnet anyway.
    return { maker: 0.0002, taker: 0.0005 };
  }

  /** Map USDM order response → SEER's OrderResult. */
  private toOrderResult(r: any, originalSymbol: string): OrderResult {
    return {
      orderId: r.orderId.toString(),
      symbol: originalSymbol,
      status: this.mapOrderStatus(r.status),
      executedQty: parseFloat(r.executedQty ?? '0'),
      executedPrice: parseFloat(r.avgPrice ?? r.price ?? '0'),
      timestamp: Number(r.updateTime ?? r.transactTime ?? Date.now()),
    };
  }

  private mapOrderStatus(s: string): OrderResult['status'] {
    switch ((s || '').toUpperCase()) {
      case 'NEW': return 'new';
      case 'FILLED': return 'filled';
      case 'PARTIALLY_FILLED': return 'partially_filled';
      case 'CANCELED':
      case 'CANCELLED':
      case 'EXPIRED': return 'cancelled';
      case 'REJECTED': return 'rejected';
      default: return 'new';
    }
  }
}
