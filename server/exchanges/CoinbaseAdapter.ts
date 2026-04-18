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
import crypto from "crypto";
import { buildCoinbaseAuthHeader } from "../utils/coinbaseJWT";
import { CoinbaseWebSocketManager, CoinbaseTickerEvent, CoinbaseLevel2Event, CoinbaseOrderUpdate, CoinbaseFillEvent } from "./CoinbaseWebSocketManager.js";
import { positionManager } from '../PositionManager';
import { TokenBucketRateLimiter, ExchangeRateLimits } from '../utils/TokenBucketRateLimiter';
import { priceFeedService } from '../services/priceFeedService';

/**
 * Coinbase Advanced Trade Adapter
 * Implements the ExchangeInterface using JWT authentication for Coinbase Advanced Trade API (CDP)
 * 
 * API Documentation: https://docs.cdp.coinbase.com/advanced-trade-api/docs/welcome
 * Authentication: https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication
 * 
 * IMPORTANT: Requires CDP API keys (not Legacy Coinbase API keys)
 * - API Key format: organizations/{org_id}/apiKeys/{key_id}
 * - API Secret: PEM-encoded EC private key (ECDSA ES256)
 * 
 * RATE LIMITS (Coinbase Advanced Trade API):
 * - Public endpoints: 10 requests/second
 * - Private endpoints: 15 requests/second
 * - WebSocket: No rate limits on subscriptions
 * 
 * WEBSOCKET-FIRST STRATEGY (to avoid rate limits):
 * ✅ Price updates: Use WebSocket ticker channel (connectWebSocket)
 * ✅ Order book: Use WebSocket level2 channel (future implementation)
 * ⚠️ Historical candles: REST only (getMarketData) - use sparingly
 * ⚠️ Account balance: REST only (getAccountBalance) - cache results
 * ⚠️ Order placement: REST only (placeOrder) - unavoidable
 * 
 * CRITICAL: getCurrentPrice() and getTicker() use REST fallback.
 * For real-time prices, always use WebSocket (connectWebSocket) instead.
 */
export class CoinbaseAdapter extends ExchangeInterface {
  private readonly baseUrl = "https://api.coinbase.com/api/v3/brokerage";
  private wsManager: CoinbaseWebSocketManager | null = null;
  private tickCallbacks: Map<string, TickCallback> = new Map();
  private orderBookCache: Map<string, OrderBook> = new Map();
  private rateLimiter: TokenBucketRateLimiter;

  constructor(apiKey: string, apiSecret: string) {
    super(apiKey, apiSecret);
    // Initialize rate limiter: 10 requests per second (conservative)
    this.rateLimiter = new TokenBucketRateLimiter(ExchangeRateLimits.COINBASE);
  }

  getExchangeName(): "coinbase" {
    return "coinbase";
  }

  /**
   * Make authenticated request to Coinbase API using JWT
   * Includes rate limiting to prevent 429 errors
   */
  private async makeRequest(method: string, endpoint: string, body?: any): Promise<any> {
    // Acquire rate limit token before making request
    await this.rateLimiter.acquire();

    const path = `/api/v3/brokerage${endpoint}`;
    
    // Strip query parameters from path for JWT generation (Coinbase requirement)
    const pathForJWT = path.split('?')[0];
    
    // Generate JWT token for this request
    const authHeader = buildCoinbaseAuthHeader(this.apiKey, this.apiSecret, method, pathForJWT);

    const headers: Record<string, string> = {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Coinbase API error: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by fetching accounts
      const response = await this.makeRequest("GET", "/accounts");
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error("[CoinbaseAdapter] Connection test failed:", error);
      this.isConnected = false;
      return false;
    }
  }

  async connectWebSocket(symbol: string, callback: TickCallback): Promise<void> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    // Store callback for this symbol
    this.tickCallbacks.set(normalizedSymbol, callback);

    // Create WebSocket manager if not exists
    if (!this.wsManager) {
      this.wsManager = new CoinbaseWebSocketManager({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        symbols: [normalizedSymbol],
        channels: ['ticker', 'level2', 'user', 'heartbeats'],
      });

      // Handle ticker events
      this.wsManager.on('ticker', (data: CoinbaseTickerEvent) => {
        const price = parseFloat(data.price);
        const volume = parseFloat(data.volume_24_h || "0");
        
        // ✅ CRITICAL: Feed price into priceFeedService immediately on every tick
        // This is the SINGLE SOURCE OF TRUTH for all price data in the system
        priceFeedService.updatePrice(data.product_id, price, 'websocket', {
          volume24h: volume,
          change24h: parseFloat(data.price_percent_chg_24_h || "0"),
        });
        
        // Also call the registered callback for backward compatibility
        const callback = this.tickCallbacks.get(data.product_id);
        if (callback) {
          const tick: NormalizedTick = {
            timestamp: new Date(data.timestamp).getTime(),
            price,
            volume,
            side: "buy", // Coinbase ticker doesn't specify side
            exchange: "coinbase",
          };
          callback(tick);
        }
      });

      // Handle level2 events (order book)
      this.wsManager.on('level2', (data: CoinbaseLevel2Event) => {
        this.updateOrderBookCache(data);
      });

      // Handle connection events
      this.wsManager.on('connected', () => {
        console.log('[CoinbaseAdapter] ✅ WebSocket connected');
        this.isConnected = true;
      });

      this.wsManager.on('disconnected', (info: any) => {
        console.log(`[CoinbaseAdapter] WebSocket disconnected: ${info.code} - ${info.reason}`);
        this.isConnected = false;
      });

      this.wsManager.on('error', (error: Error) => {
        console.error('[CoinbaseAdapter] WebSocket error:', error);
      });

      this.wsManager.on('heartbeat', (data: any) => {
        // Optional: Log heartbeat for monitoring
        // console.log(`[CoinbaseAdapter] Heartbeat - Latency: ${data.latency}ms`);
      });

      // Handle order updates (real-time order status changes)
      this.wsManager.on('orderUpdate', (orderUpdate: CoinbaseOrderUpdate) => {
        console.log(`[CoinbaseAdapter] Order update: ${orderUpdate.order_id} - ${orderUpdate.status}`);
        positionManager.handleOrderUpdate(orderUpdate);
      });

      // Handle fill events (real-time trade executions)
      this.wsManager.on('fill', (fillEvent: CoinbaseFillEvent) => {
        console.log(`[CoinbaseAdapter] Fill: ${fillEvent.trade_id} - ${fillEvent.size} @ ${fillEvent.price}`);
        positionManager.handleFill(fillEvent);
      });

      // Connect
      await this.wsManager.connect();
    } else {
      // Add symbol to existing connection
      await this.wsManager.addSymbol(normalizedSymbol);
    }
  }

  async disconnectWebSocket(): Promise<void> {
    if (this.wsManager) {
      this.wsManager.disconnect();
      this.wsManager = null;
      this.tickCallbacks.clear();
      this.orderBookCache.clear();
      this.isConnected = false;
    }
  }

  /**
   * Update order book cache from WebSocket level2 events
   */
  private updateOrderBookCache(data: CoinbaseLevel2Event): void {
    const { product_id, type, updates } = data;

    if (type === 'snapshot') {
      // Initialize order book from snapshot
      const bids: Array<{ price: number; quantity: number }> = [];
      const asks: Array<{ price: number; quantity: number }> = [];

      for (const update of updates) {
        const entry = {
          price: parseFloat(update.price_level),
          quantity: parseFloat(update.new_quantity),
        };

        if (update.side === 'bid') {
          bids.push(entry);
        } else {
          asks.push(entry);
        }
      }

      this.orderBookCache.set(product_id, {
        bids: bids.sort((a, b) => b.price - a.price), // Descending
        asks: asks.sort((a, b) => a.price - b.price), // Ascending
        timestamp: Date.now(),
      });
    } else if (type === 'update') {
      // Update existing order book
      const orderBook = this.orderBookCache.get(product_id);
      if (!orderBook) return;

      for (const update of updates) {
        const price = parseFloat(update.price_level);
        const quantity = parseFloat(update.new_quantity);
        const list = update.side === 'bid' ? orderBook.bids : orderBook.asks;

        // Find existing price level
        const index = list.findIndex((entry) => entry.price === price);

        if (quantity === 0) {
          // Remove price level
          if (index > -1) {
            list.splice(index, 1);
          }
        } else {
          // Update or add price level
          if (index > -1) {
            list[index].quantity = quantity;
          } else {
            list.push({ price, quantity });
            // Re-sort
            if (update.side === 'bid') {
              list.sort((a, b) => b.price - a.price);
            } else {
              list.sort((a, b) => a.price - b.price);
            }
          }
        }
      }

      orderBook.timestamp = Date.now();
    }
  }

  /**
   * Get order book snapshot
   * ✅ Uses WebSocket cache (real-time updates from level2 channel)
   * ⚠️ Falls back to REST API if WebSocket not connected
   */
  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    // Try WebSocket cache first (real-time data)
    const cachedOrderBook = this.orderBookCache.get(normalizedSymbol);
    if (cachedOrderBook) {
      // Return cached order book (limited to requested depth)
      return {
        bids: cachedOrderBook.bids.slice(0, depth),
        asks: cachedOrderBook.asks.slice(0, depth),
        timestamp: cachedOrderBook.timestamp,
      };
    }

    // Fallback to REST API if WebSocket not connected
    console.warn(`[CoinbaseAdapter] Order book cache miss for ${symbol}, using REST API fallback`);
    try {
      const response = await this.makeRequest("GET", `/product_book?product_id=${normalizedSymbol}&limit=${depth}`);

      return {
        bids: (response.pricebook?.bids || []).map((bid: any) => ({
          price: parseFloat(bid.price),
          quantity: parseFloat(bid.size),
        })),
        asks: (response.pricebook?.asks || []).map((ask: any) => ({
          price: parseFloat(ask.price),
          quantity: parseFloat(ask.size),
        })),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get order book:", error);
      throw error;
    }
  }

  /**
   * Place an order with custom client order ID
   * Supports market, limit, and stop-loss orders
   * @param params Order parameters
   * @param clientOrderId Optional custom client order ID for tracking
   */
  async placeOrder(params: OrderParams, clientOrderId?: string): Promise<OrderResult> {
    const normalizedSymbol = this.normalizeSymbol(params.symbol);
    const orderClientId = clientOrderId || crypto.randomUUID();

    try {
      let orderConfiguration: any;

      // Build order configuration based on order type
      if (params.type === 'market') {
        orderConfiguration = {
          market_market_ioc: {
            base_size: params.quantity.toString(),
          },
        };
      } else if (params.type === 'limit') {
        if (!params.price) {
          throw new Error('Limit orders require a price');
        }
        orderConfiguration = {
          limit_limit_gtc: {
            base_size: params.quantity.toString(),
            limit_price: params.price.toString(),
            post_only: false,
          },
        };
      } else if (params.type === 'stop_loss') {
        if (!params.stopPrice || !params.price) {
          throw new Error('Stop-loss orders require both stopPrice and limitPrice');
        }
        // Determine stop direction based on side
        const stopDirection = params.side === 'sell' ? 'STOP_DIRECTION_STOP_DOWN' : 'STOP_DIRECTION_STOP_UP';
        orderConfiguration = {
          stop_limit_stop_limit_gtc: {
            base_size: params.quantity.toString(),
            limit_price: params.price.toString(),
            stop_price: params.stopPrice.toString(),
            stop_direction: stopDirection,
          },
        };
      } else if (params.type === 'take_profit') {
        if (!params.stopPrice || !params.price) {
          throw new Error('Take-profit orders require both stopPrice and limitPrice');
        }
        // Take-profit is opposite direction of stop-loss
        const stopDirection = params.side === 'sell' ? 'STOP_DIRECTION_STOP_UP' : 'STOP_DIRECTION_STOP_DOWN';
        orderConfiguration = {
          stop_limit_stop_limit_gtc: {
            base_size: params.quantity.toString(),
            limit_price: params.price.toString(),
            stop_price: params.stopPrice.toString(),
            stop_direction: stopDirection,
          },
        };
      } else {
        throw new Error(`Unsupported order type: ${params.type}`);
      }

      const requestBody = {
        client_order_id: orderClientId,
        product_id: normalizedSymbol,
        side: params.side.toUpperCase(),
        order_configuration: orderConfiguration,
      };

      console.log(`[CoinbaseAdapter] Placing ${params.type} order:`, JSON.stringify(requestBody, null, 2));

      const response = await this.makeRequest('POST', '/orders', requestBody);

      if (!response.success) {
        const errorMsg = response.error_response?.message || response.error_response?.error_details || 'Unknown error';
        throw new Error(`Order placement failed: ${errorMsg}`);
      }

      const orderId = response.success_response?.order_id || response.order_id || '';
      console.log(`[CoinbaseAdapter] Order placed successfully: ${orderId} (client: ${orderClientId})`);

      return {
        orderId,
        symbol: params.symbol,
        status: 'new',
        executedQty: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[CoinbaseAdapter] Failed to place order:', error);
      throw error;
    }
  }

  async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
    return this.placeOrder({ ...params, type: 'limit' });
  }

  async placeMarketOrder(params: OrderParams): Promise<OrderResult> {
    return this.placeOrder({ ...params, type: 'market' });
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      await this.makeRequest("POST", "/orders/batch_cancel", {
        order_ids: [orderId],
      });
      return true;
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to cancel order:", error);
      return false;
    }
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<OrderResult> {
    try {
      const response = await this.makeRequest("GET", `/orders/historical/${orderId}`);
      const order = response.order;

      return {
        orderId: order.order_id,
        symbol: symbol,
        status: this.mapOrderStatus(order.status),
        executedQty: parseFloat(order.filled_size || "0"),
        executedPrice: parseFloat(order.average_filled_price || "0"),
        timestamp: new Date(order.created_time).getTime(),
      };
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get order status:", error);
      throw error;
    }
  }

  async getPosition(symbol: string): Promise<Position | null> {
    // Coinbase Advanced Trade doesn't support futures/margin positions
    console.warn("[CoinbaseAdapter] Position tracking not supported");
    return null;
  }

  async getAccountBalance(asset?: string): Promise<Balance[]> {
    try {
      const response = await this.makeRequest("GET", "/accounts");

      const balances: Balance[] = (response.accounts || [])
        .filter((account: any) => {
          const available = parseFloat(account.available_balance?.value || "0");
          const total = available + parseFloat(account.hold?.value || "0");
          return asset ? account.currency === asset && total > 0 : total > 0;
        })
        .map((account: any) => {
          const free = parseFloat(account.available_balance?.value || "0");
          const locked = parseFloat(account.hold?.value || "0");
          return {
            asset: account.currency,
            free,
            locked,
            total: free + locked,
          };
        });

      return balances;
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get account balance:", error);
      throw error;
    }
  }

  async getMarketData(
    symbol: string,
    interval: string,
    limit: number = 100
  ): Promise<MarketData[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    const granularityMap: Record<string, string> = {
      "1m": "ONE_MINUTE",
      "5m": "FIVE_MINUTE",
      "15m": "FIFTEEN_MINUTE",
      "1h": "ONE_HOUR",
      "4h": "FOUR_HOUR",
      "1d": "ONE_DAY",
    };

    const granularity = granularityMap[interval] || "ONE_HOUR";

    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - limit * this.getIntervalSeconds(interval);

      const response = await this.makeRequest(
        "GET",
        `/products/${normalizedSymbol}/candles?start=${start}&end=${end}&granularity=${granularity}`
      );

      return (response.candles || []).map((candle: any) => ({
        timestamp: parseInt(candle.start) * 1000,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
      }));
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get market data:", error);
      throw error;
    }
  }

  /**
   * Get current market price (WebSocket-first with REST fallback)
   * ✅ PRIORITY 1: Check priceFeedService cache (0ms latency, WebSocket-fed)
   * ⚠️ PRIORITY 2: REST API fallback (500ms latency, rate-limited)
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    // ✅ PRIORITY 1: Check priceFeedService cache (WebSocket-fed, no rate limits)
    const cachedPrice = priceFeedService.getLatestPrice(normalizedSymbol);
    if (cachedPrice) {
      console.log(`[CoinbaseAdapter] ✅ Using cached price for ${symbol}: $${cachedPrice.price} (source: ${cachedPrice.source})`);
      return cachedPrice.price;
    }

    // ⚠️ PRIORITY 2: REST API fallback (only when cache miss)
    // Use Coinbase Exchange API (public) instead of Advanced Trade API (requires auth)
    console.warn(`[CoinbaseAdapter] ⚠️ Cache miss for ${symbol}, falling back to Coinbase Exchange API`);
    try {
      const exchangeUrl = `https://api.exchange.coinbase.com/products/${normalizedSymbol}/ticker`;
      const response = await fetch(exchangeUrl);
      
      if (!response.ok) {
        throw new Error(`Coinbase Exchange API error: ${response.status}`);
      }
      
      const data = await response.json();
      const price = parseFloat(data.price || "0");
      
      // Update cache for future use
      priceFeedService.updatePrice(normalizedSymbol, price, 'rest');
      
      return price;
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get current price:", error);
      throw error;
    }
  }

  /**
   * Get ticker information (REST fallback)
   * ⚠️ WARNING: This makes a REST API call. For real-time ticker data, use WebSocket instead.
   * Only use this for one-time ticker checks, not for continuous monitoring.
   */
  async getTicker(symbol: string): Promise<{ last: number; volume: number; high: number; low: number }> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      // Use Coinbase Exchange API (public) for 24h stats
      const exchangeUrl = `https://api.exchange.coinbase.com/products/${normalizedSymbol}/stats`;
      const response = await fetch(exchangeUrl);
      
      if (!response.ok) {
        throw new Error(`Coinbase Exchange API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        last: parseFloat(data.last || "0"),
        volume: parseFloat(data.volume || "0"),
        high: parseFloat(data.high || "0"),
        low: parseFloat(data.low || "0"),
      };
    } catch (error) {
      console.error("[CoinbaseAdapter] Failed to get ticker:", error);
      throw error;
    }
  }

  async getTradingFees(symbol: string): Promise<{ maker: number; taker: number }> {
    // Coinbase Advanced Trade fees (default tier)
    // See: https://help.coinbase.com/en/exchange/trading-and-funding/exchange-fees
    return {
      maker: 0.004, // 0.4% maker fee
      taker: 0.006, // 0.6% taker fee
    };
  }

  /**
   * Normalize symbol format (BTCUSDT -> BTC-USD for Coinbase)
   * IMPORTANT: Coinbase Exchange API only supports USD pairs, not USDT
   */
  protected normalizeSymbol(symbol: string): string {
    // If already in Coinbase format (contains hyphen), check for USDT
    if (symbol.includes("-")) {
      // Convert USDT to USD for Coinbase compatibility
      if (symbol.endsWith('-USDT')) {
        return symbol.replace('-USDT', '-USD');
      }
      return symbol;
    }
    
    // Convert Binance format (BTCUSDT) to Coinbase format (BTC-USD)
    // Match base currency and quote currency
    const match = symbol.match(/^([A-Z]+?)(USDT|USD|BTC|ETH|USDC|EUR|GBP)$/);
    if (match) {
      // Convert USDT to USD for Coinbase compatibility
      const quote = match[2] === 'USDT' ? 'USD' : match[2];
      return `${match[1]}-${quote}`;
    }
    
    // Handle slash format (BTC/USDT -> BTC-USD)
    if (symbol.includes('/')) {
      const parts = symbol.split('/');
      const quote = parts[1] === 'USDT' ? 'USD' : parts[1];
      return `${parts[0]}-${quote}`;
    }
    
    // Fallback: return as-is if pattern doesn't match
    return symbol;
  }

  /**
   * Denormalize symbol from Coinbase format to standard format
   * BTC-USDT -> BTC/USDT
   */
  protected denormalizeSymbol(symbol: string): string {
    return symbol.replace("-", "/");
  }

  /**
   * Map Coinbase order status to our normalized status
   */
  private mapOrderStatus(status: string): "new" | "filled" | "cancelled" | "rejected" | "partially_filled" {
    const statusMap: Record<string, "new" | "filled" | "cancelled" | "rejected" | "partially_filled"> = {
      OPEN: "new",
      PENDING: "new",
      FILLED: "filled",
      CANCELLED: "cancelled",
      EXPIRED: "cancelled",
      FAILED: "rejected",
      UNKNOWN: "rejected",
      PARTIALLY_FILLED: "partially_filled",
    };

    return statusMap[status] || "new";
  }

  /**
   * Convert interval string to seconds
   */
  private getIntervalSeconds(interval: string): number {
    const map: Record<string, number> = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "1h": 3600,
      "4h": 14400,
      "1d": 86400,
    };

    return map[interval] || 3600;
  }
}
