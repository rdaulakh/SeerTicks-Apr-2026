/**
 * Exchange Abstraction Layer
 * Provides a unified interface for interacting with different cryptocurrency exchanges
 */

/**
 * Standardized tick data structure
 * All exchange-specific data is normalized to this format
 */
export interface NormalizedTick {
  timestamp: number; // Unix timestamp in milliseconds
  price: number;
  volume: number;
  side: "buy" | "sell";
  exchange: "binance" | "coinbase";
}

/**
 * Order book entry
 */
export interface OrderBookEntry {
  price: number;
  quantity: number;
}

/**
 * Order book structure
 */
export interface OrderBook {
  bids: OrderBookEntry[]; // Buy orders, sorted by price descending
  asks: OrderBookEntry[]; // Sell orders, sorted by price ascending
  timestamp: number;
}

/**
 * Account balance information
 */
export interface Balance {
  asset: string;
  free: number; // Available balance
  locked: number; // Balance in open orders
  total: number; // free + locked
}

/**
 * Position information
 */
export interface Position {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage?: number;
}

/**
 * Order parameters
 */
export interface OrderParams {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "stop_loss" | "take_profit";
  quantity: number;
  price?: number; // Required for limit orders
  stopPrice?: number; // Required for stop orders
  timeInForce?: "GTC" | "IOC" | "FOK"; // Good Till Cancel, Immediate or Cancel, Fill or Kill
}

/**
 * Order result
 */
export interface OrderResult {
  orderId: string;
  symbol: string;
  status: "new" | "filled" | "partially_filled" | "cancelled" | "rejected";
  executedQty: number;
  executedPrice?: number;
  timestamp: number;
}

/**
 * Market data (OHLCV)
 */
export interface MarketData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * WebSocket subscription callback
 */
export type TickCallback = (tick: NormalizedTick) => void;

/**
 * Abstract base class for exchange adapters
 * All exchange implementations must extend this class
 */
export abstract class ExchangeInterface {
  protected apiKey: string;
  protected apiSecret: string;
  protected isConnected: boolean = false;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Get the exchange name
   */
  abstract getExchangeName(): "binance" | "coinbase";

  /**
   * Test the API key connection
   * Returns true if the credentials are valid
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Connect to the exchange's WebSocket for real-time tick data
   * @param symbol Trading pair (e.g., "BTC/USDT")
   * @param callback Function to call when new tick data arrives
   */
  abstract connectWebSocket(symbol: string, callback: TickCallback): Promise<void>;

  /**
   * Disconnect from the WebSocket
   */
  abstract disconnectWebSocket(): Promise<void>;

  /**
   * Get the current order book
   * @param symbol Trading pair (e.g., "BTC/USDT")
   * @param depth Number of price levels to retrieve (default: 20)
   */
  abstract getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;

  /**
   * Place a limit order
   * @param params Order parameters
   */
  abstract placeLimitOrder(params: OrderParams): Promise<OrderResult>;

  /**
   * Place a market order
   * @param params Order parameters
   */
  abstract placeMarketOrder(params: OrderParams): Promise<OrderResult>;

  /**
   * Cancel an order
   * @param orderId Order ID to cancel
   * @param symbol Trading pair
   */
  abstract cancelOrder(orderId: string, symbol: string): Promise<boolean>;

  /**
   * Get order status
   * @param orderId Order ID to check
   * @param symbol Trading pair
   */
  abstract getOrderStatus(orderId: string, symbol: string): Promise<OrderResult>;

  /**
   * Get current position (for futures/margin trading)
   * @param symbol Trading pair
   */
  abstract getPosition(symbol: string): Promise<Position | null>;

  /**
   * Get account balance
   * @param asset Asset symbol (e.g., "USDT", "BTC")
   */
  abstract getAccountBalance(asset?: string): Promise<Balance[]>;

  /**
   * Get historical market data (OHLCV)
   * @param symbol Trading pair
   * @param interval Candle interval (e.g., "1m", "5m", "1h")
   * @param limit Number of candles to retrieve
   */
  abstract getMarketData(
    symbol: string,
    interval: string,
    limit?: number
  ): Promise<MarketData[]>;

  /**
   * Get current market price
   * @param symbol Trading pair
   */
  abstract getCurrentPrice(symbol: string): Promise<number>;

  /**
   * Get ticker information (price, volume, etc.)
   * @param symbol Trading pair
   */
  abstract getTicker(symbol: string): Promise<{ last: number; volume: number; high: number; low: number }>;

  /**
   * Get trading fees for the account
   * @param symbol Trading pair
   */
  abstract getTradingFees(symbol: string): Promise<{ maker: number; taker: number }>;

  /**
   * Check if the adapter is connected
   */
  isAdapterConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Normalize a symbol to the exchange's format
   * e.g., "BTC/USDT" -> "BTCUSDT" for Binance, "BTC-USDT" for Coinbase
   */
  protected abstract normalizeSymbol(symbol: string): string;

  /**
   * Denormalize a symbol from the exchange's format to standard format
   * e.g., "BTCUSDT" -> "BTC/USDT"
   */
  protected abstract denormalizeSymbol(symbol: string): string;
}
