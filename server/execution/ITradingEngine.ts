/**
 * ITradingEngine - Unified Trading Engine Interface
 *
 * Both PaperTradingEngine and RealTradingEngine implement this interface,
 * allowing the execution pipeline to swap between paper and live trading
 * without changing any calling code.
 *
 * This is the ONLY contract that AutomatedTradeExecutor and EnhancedTradeExecutor
 * depend on — they never import a concrete engine class.
 */

export type TradingMode = 'paper' | 'live' | 'dry-run';

export interface ITradingEngineOrder {
  id: string;
  userId: number;
  symbol: string;
  exchange: string;
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  exchangeOrderId?: string;
  filledPrice?: number;
  filledQuantity?: number;
  commission?: number;
  slippage?: number;
  latency?: number;
  createdAt: Date;
  filledAt?: Date;
  strategy: string;
}

export interface ITradingEngineWallet {
  userId: number;
  balance: number;
  equity: number;
  margin: number;
  marginLevel: number;
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalCommission: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
}

export interface ITradingEnginePosition {
  id: string;
  userId: number;
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryTime: Date;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  strategy: string;
}

export interface PlaceOrderParams {
  symbol: string;
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategy: string;
}

/**
 * Unified interface for both Paper and Real trading engines.
 * Any class implementing this can be used as the execution backend.
 */
export interface ITradingEngine {
  /** What mode this engine operates in */
  readonly tradingMode: TradingMode;

  /** Place an order (market, limit, etc.) */
  placeOrder(params: PlaceOrderParams): Promise<ITradingEngineOrder>;

  /** Cancel a pending order */
  cancelOrder(orderId: string): Promise<void>;

  /** Close a specific position by ID */
  closePositionById(positionId: string, currentPrice: number, strategy: string): Promise<void>;

  /** Close all open positions */
  closeAllPositions(prices: Map<string, number>, strategy: string): Promise<void>;

  /** Get wallet/balance state */
  getWallet(): ITradingEngineWallet;

  /** Get all open positions */
  getPositions(): ITradingEnginePosition[];

  /** Get all pending orders */
  getOrders(): ITradingEngineOrder[];

  /** Get order history */
  getOrderHistory(): ITradingEngineOrder[];

  /** Get trade history */
  getTradeHistory(): Array<{
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    quantity: number;
    pnl: number;
    commission: number;
    timestamp: Date;
    strategy: string;
  }>;

  /** Update prices for all open positions */
  updatePositionPrices(prices: Map<string, number>): void;

  /** Wait until the engine is ready (wallet loaded, exchange connected, etc.) */
  waitForReady?(): Promise<void>;
}
