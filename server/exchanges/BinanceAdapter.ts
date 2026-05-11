import { getActiveClock } from '../_core/clock';
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
import { MainClient } from "binance";
import WebSocket from "ws";
import { priceFeedService } from '../services/priceFeedService';

/**
 * Binance Exchange Adapter
 * Implements the ExchangeInterface for Binance Spot and Futures trading
 */
export class BinanceAdapter extends ExchangeInterface {
  private client: any; // Binance client instance
  private ws: WebSocket | null = null;
  private wsReconnectAttempts = 0;
  private wsReconnectTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  // Phase B-2.4 — symbol-specific LOT_SIZE / PRICE_FILTER cache. Binance Spot
  // rejects orders whose `quantity` doesn't match the symbol's `stepSize`
  // (-1111 "Parameter 'quantity' has too much precision."). We fetch
  // exchangeInfo once and cache stepSize / minQty / tickSize / minNotional
  // per symbol so every order can be rounded compliantly.
  private symbolFilters: Map<string, { stepSize: number; minQty: number; tickSize: number; minNotional: number }> = new Map();
  private filtersLoadedAt = 0;
  private readonly FILTERS_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(apiKey: string, apiSecret: string, opts: { testnet?: boolean } = {}) {
    super(apiKey, apiSecret);
    // Phase 51 — Testnet support. When BINANCE_USE_TESTNET=1 (or opts.testnet),
    // route REST + WS to testnet.binance.vision so the engine trades against
    // a real order book with fake balance. Same auth flow (HMAC), separate
    // testnet API key from testnet.binance.vision.
    const useTestnet = opts.testnet ?? process.env.BINANCE_USE_TESTNET === '1';
    this.client = new MainClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      testnet: useTestnet,
    });
    if (useTestnet) {
      console.log('[BinanceAdapter] 🧪 TESTNET mode — https://testnet.binance.vision');
    }
  }

  /**
   * Load LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL filters for all symbols.
   * Cached for FILTERS_TTL_MS so we don't pay the weight cost on every order.
   */
  private async ensureSymbolFilters(): Promise<void> {
    if (this.symbolFilters.size > 0 && getActiveClock().now() - this.filtersLoadedAt < this.FILTERS_TTL_MS) return;
    try {
      const info = await this.client.getExchangeInfo();
      for (const sym of info.symbols || []) {
        const stepFilter = sym.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = sym.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        const notionalFilter = sym.filters?.find((f: any) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
        if (stepFilter && priceFilter) {
          this.symbolFilters.set(sym.symbol, {
            stepSize: parseFloat(stepFilter.stepSize),
            minQty: parseFloat(stepFilter.minQty),
            tickSize: parseFloat(priceFilter.tickSize),
            minNotional: notionalFilter ? parseFloat(notionalFilter.minNotional || notionalFilter.notional || '0') : 0,
          });
        }
      }
      this.filtersLoadedAt = getActiveClock().now();
      console.log(`[BinanceAdapter] Loaded LOT_SIZE/PRICE_FILTER for ${this.symbolFilters.size} symbols`);
    } catch (e: any) {
      console.warn('[BinanceAdapter] Failed to load symbol filters:', e?.message);
    }
  }

  /**
   * Round a quantity DOWN to the symbol's stepSize. Floor (not round) so we
   * never request more than the user can afford. Returns a string with the
   * appropriate fixed-decimal precision (Binance rejects scientific notation).
   */
  private quantizeQuantity(symbol: string, qty: number): string {
    const f = this.symbolFilters.get(symbol);
    if (!f || !f.stepSize) return qty.toString();
    const step = f.stepSize;
    const floored = Math.floor(qty / step) * step;
    // Compute decimals from step (e.g. 0.00001 → 5, 0.01 → 2)
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return floored.toFixed(decimals);
  }

  private quantizePrice(symbol: string, price: number): string {
    const f = this.symbolFilters.get(symbol);
    if (!f || !f.tickSize) return price.toString();
    const tick = f.tickSize;
    const floored = Math.floor(price / tick) * tick;
    const decimals = Math.max(0, -Math.floor(Math.log10(tick)));
    return floored.toFixed(decimals);
  }

  getExchangeName(): "binance" {
    return "binance";
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('[BinanceAdapter] Testing connection...');
      
      // Add 10-second timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection test timeout after 10 seconds')), 10000);
      });
      
      const testPromise = this.client.getAccountInformation();
      
      // Race between the API call and timeout
      await Promise.race([testPromise, timeoutPromise]);
      
      console.log('[BinanceAdapter] Connection test successful');
      this.isConnected = true;
      return true;
    } catch (error: any) {
      console.error("[BinanceAdapter] Connection test failed:", error?.message || error);
      if (error?.code) {
        console.error("[BinanceAdapter] Error code:", error.code);
      }
      this.isConnected = false;
      return false;
    }
  }

  async connectWebSocket(symbol: string, callback: TickCallback): Promise<void> {
    const normalizedSymbol = this.normalizeSymbol(symbol).toLowerCase();
    // Phase 14 — honor BINANCE_WS_BASE_URL so prod can use Binance.US (not geo-blocked).
    const { resolveBinanceWsBaseUrl } = await import('./BinanceWebSocketManager');
    const wsUrl = `${resolveBinanceWsBaseUrl()}/ws/${normalizedSymbol}@trade`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.on("open", () => {
          console.log(`[BinanceAdapter] WebSocket connected for ${symbol}`);
          this.isConnected = true;
          this.wsReconnectAttempts = 0;
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            
            // Binance trade stream format
            if (message.e === "trade") {
              const tick: NormalizedTick = {
                timestamp: message.T,
                price: parseFloat(message.p),
                volume: parseFloat(message.q),
                side: message.m ? "sell" : "buy", // m = true means buyer is market maker (sell)
                exchange: "binance",
              };
              
              callback(tick);
            }
          } catch (error) {
            console.error("[BinanceAdapter] Error parsing WebSocket message:", error);
          }
        });

        this.ws.on("error", (error: Error) => {
          console.error("[BinanceAdapter] WebSocket error:", error);
          reject(error);
        });

        this.ws.on("close", () => {
          console.log("[BinanceAdapter] WebSocket disconnected");
          this.isConnected = false;
          
          // Attempt to reconnect
          if (this.wsReconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.wsReconnectAttempts++;
            console.log(`[BinanceAdapter] Reconnecting... Attempt ${this.wsReconnectAttempts}`);
            this.wsReconnectTimeout = setTimeout(() => {
              this.wsReconnectTimeout = null;
              this.connectWebSocket(symbol, callback);
            }, 5000 * this.wsReconnectAttempts); // Exponential backoff
          }
        });
      } catch (error) {
        console.error("[BinanceAdapter] Failed to create WebSocket:", error);
        reject(error);
      }
    });
  }

  async disconnectWebSocket(): Promise<void> {
    // Clear any pending reconnect timer to prevent reconnection after disconnect
    if (this.wsReconnectTimeout) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    try {
      const response = await this.client.getOrderBook({
        symbol: normalizedSymbol,
        limit: depth,
      });

      return {
        bids: response.bids.map((bid: [string, string]) => ({
          price: parseFloat(bid[0]),
          quantity: parseFloat(bid[1]),
        })),
        asks: response.asks.map((ask: [string, string]) => ({
          price: parseFloat(ask[0]),
          quantity: parseFloat(ask[1]),
        })),
        timestamp: getActiveClock().now(),
      };
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get order book:", error);
      throw error;
    }
  }

  async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
    const normalizedSymbol = this.normalizeSymbol(params.symbol);
    await this.ensureSymbolFilters();
    const qtyStr = this.quantizeQuantity(normalizedSymbol, params.quantity);
    const priceStr = params.price !== undefined ? this.quantizePrice(normalizedSymbol, params.price) : undefined;

    try {
      const response = await this.client.submitNewOrder({
        symbol: normalizedSymbol,
        side: params.side.toUpperCase(),
        type: "LIMIT",
        quantity: qtyStr as any,
        price: priceStr as any,
        timeInForce: params.timeInForce || "GTC",
      });

      return {
        orderId: response.orderId.toString(),
        symbol: params.symbol,
        status: this.mapOrderStatus(response.status),
        executedQty: parseFloat(response.executedQty),
        executedPrice: parseFloat(response.price),
        timestamp: response.transactTime,
      };
    } catch (error) {
      console.error("[BinanceAdapter] Failed to place limit order:", error);
      throw error;
    }
  }

  async placeMarketOrder(params: OrderParams): Promise<OrderResult> {
    const normalizedSymbol = this.normalizeSymbol(params.symbol);
    await this.ensureSymbolFilters();
    const qtyStr = this.quantizeQuantity(normalizedSymbol, params.quantity);

    try {
      const response = await this.client.submitNewOrder({
        symbol: normalizedSymbol,
        side: params.side.toUpperCase(),
        type: "MARKET",
        quantity: qtyStr as any,
      });

      return {
        orderId: response.orderId.toString(),
        symbol: params.symbol,
        status: this.mapOrderStatus(response.status),
        executedQty: parseFloat(response.executedQty),
        executedPrice: parseFloat(response.price || "0"),
        timestamp: response.transactTime,
      };
    } catch (error) {
      console.error("[BinanceAdapter] Failed to place market order:", error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      await this.client.cancelOrder({
        symbol: normalizedSymbol,
        orderId: parseInt(orderId),
      });
      return true;
    } catch (error) {
      console.error("[BinanceAdapter] Failed to cancel order:", error);
      return false;
    }
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<OrderResult> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      const response = await this.client.getOrder({
        symbol: normalizedSymbol,
        orderId: parseInt(orderId),
      });

      return {
        orderId: response.orderId.toString(),
        symbol: symbol,
        status: this.mapOrderStatus(response.status),
        executedQty: parseFloat(response.executedQty),
        executedPrice: parseFloat(response.price),
        timestamp: response.time,
      };
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get order status:", error);
      throw error;
    }
  }

  async getPosition(symbol: string): Promise<Position | null> {
    // Note: This is for Binance Futures. For spot trading, positions don't exist.
    // This is a placeholder implementation
    console.warn("[BinanceAdapter] Position tracking not implemented for spot trading");
    return null;
  }

  async getAccountBalance(asset?: string): Promise<Balance[]> {
    try {
      const response = await this.client.getAccountInformation();
      
      const balances: Balance[] = response.balances
        .filter((b: any) => {
          const total = parseFloat(b.free) + parseFloat(b.locked);
          return asset ? b.asset === asset && total > 0 : total > 0;
        })
        .map((b: any) => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked),
        }));

      return balances;
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get account balance:", error);
      throw error;
    }
  }

  async getMarketData(
    symbol: string,
    interval: string,
    limit: number = 100
  ): Promise<MarketData[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      const response = await this.client.getKlines({
        symbol: normalizedSymbol,
        interval: interval,
        limit: limit,
      });

      return response.map((candle: any) => ({
        timestamp: candle.openTime,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
      }));
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get market data:", error);
      throw error;
    }
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    // ✅ PRIORITY 1: Check priceFeedService cache (WebSocket-fed, no rate limits)
    const cachedPrice = priceFeedService.getLatestPrice(normalizedSymbol);
    if (cachedPrice) {
      console.log(`[BinanceAdapter] ✅ Using cached price for ${symbol}: $${cachedPrice.price} (source: ${cachedPrice.source})`);
      return cachedPrice.price;
    }

    // ⚠️ PRIORITY 2: REST API fallback (only when cache miss)
    console.warn(`[BinanceAdapter] ⚠️ Cache miss for ${symbol}, falling back to REST API`);
    try {
      const response = await this.client.getSymbolPriceTicker({ symbol: normalizedSymbol });
      const price = parseFloat(response.price);
      
      // Update cache for future use
      priceFeedService.updatePrice(normalizedSymbol, price, 'rest');
      
      return price;
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get current price:", error);
      throw error;
    }
  }

  async getTicker(symbol: string): Promise<{ last: number; volume: number; high: number; low: number }> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      const response = await this.client.get24hrChangeStatistics({ symbol: normalizedSymbol });
      return {
        last: parseFloat(response.lastPrice),
        volume: parseFloat(response.volume),
        high: parseFloat(response.highPrice),
        low: parseFloat(response.lowPrice),
      };
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get ticker:", error);
      throw error;
    }
  }

  async getTradingFees(symbol: string): Promise<{ maker: number; taker: number }> {
    try {
      const response = await this.client.tradeFee({ symbol: this.normalizeSymbol(symbol) });
      
      if (response && response.length > 0) {
        return {
          maker: parseFloat(response[0].makerCommission),
          taker: parseFloat(response[0].takerCommission),
        };
      }
      
      // Default fees if not available
      return { maker: 0.001, taker: 0.001 }; // 0.1%
    } catch (error) {
      console.error("[BinanceAdapter] Failed to get trading fees:", error);
      return { maker: 0.001, taker: 0.001 };
    }
  }

  protected normalizeSymbol(symbol: string): string {
    // Phase B-2.3 — Seer's canonical format is "BTC-USD" (dash + USD).
    // Binance Spot only quotes against USDT, USDC, BUSD, FDUSD, BTC, ETH.
    // Map: "BTC-USD" → "BTCUSDT", "ETH-USD" → "ETHUSDT", "SOL-USD" → "SOLUSDT".
    // Also accept legacy "BTC/USDT" form (strip slash).
    const upper = symbol.toUpperCase();
    if (upper.includes("-")) {
      const [base, quote] = upper.split("-");
      // Bridge USD → USDT (Binance Spot doesn't have native USD pairs)
      const binanceQuote = quote === "USD" ? "USDT" : quote;
      return `${base}${binanceQuote}`;
    }
    return upper.replace("/", "");
  }

  protected denormalizeSymbol(symbol: string): string {
    // Convert "BTCUSDT" to "BTC/USDT"
    // This is a simple implementation; may need refinement for all pairs
    if (symbol.endsWith("USDT")) {
      return symbol.replace("USDT", "/USDT");
    }
    if (symbol.endsWith("BTC")) {
      return symbol.replace("BTC", "/BTC");
    }
    return symbol;
  }

  private mapOrderStatus(binanceStatus: string): OrderResult["status"] {
    const statusMap: Record<string, OrderResult["status"]> = {
      NEW: "new",
      FILLED: "filled",
      PARTIALLY_FILLED: "partially_filled",
      CANCELED: "cancelled",
      REJECTED: "rejected",
      EXPIRED: "cancelled",
    };

    return statusMap[binanceStatus] || "new";
  }
}
