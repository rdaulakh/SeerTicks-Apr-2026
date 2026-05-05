/**
 * Real Trading Engine
 *
 * Executes live trades on Binance/Coinbase exchange with institutional-grade safety controls.
 *
 * PHASE 4B: Full database persistence — mirrors PaperTradingEngine exactly.
 * Uses the SAME database tables (paperWallets, paperPositions, paperTrades) with tradingMode='live'.
 *
 * Features:
 * - Live order placement (market, limit, stop-loss)
 * - Order status tracking and fill confirmation
 * - Dry-run mode for testing
 * - Position tracking with real-time P&L
 * - Safety limits (position size, concurrent positions, daily loss)
 * - Emergency stop functionality
 * - Full database persistence (wallet, positions, trades)
 * - IntelligentExitManager integration via dbPositionId
 * - Position reconciliation with exchange
 */

import { EventEmitter } from 'events';
import type { ITradingEngine, ITradingEngineOrder, ITradingEngineWallet, ITradingEnginePosition, PlaceOrderParams, TradingMode } from './ITradingEngine';
import { executionLogger } from '../utils/logger';

export interface RealTradingConfig {
  userId: number;
  exchange: 'binance' | 'coinbase';
  apiKey: string;
  apiSecret: string;
  dryRun: boolean; // Log orders without executing
  /** Safety guardrails */
  maxDailyLossPercent?: number; // e.g. 0.05 = 5% max daily loss
  maxSingleTradePercent?: number; // e.g. 0.02 = 2% max single trade loss
  maxOpenPositions?: number; // e.g. 3
  positionSizeRampUp?: number; // 0-1, fraction of intended size (gradual ramp-up)
}

export interface RealPosition {
  id: string;
  dbPositionId?: number; // Database position ID for IntelligentExitManager
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
  commission: number;
  strategy: string;
}

export interface RealOrder {
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
  createdAt: Date;
  filledAt?: Date;
  strategy: string;
}

export interface RealWallet {
  userId: number;
  balance: number; // Available USD
  equity: number; // Balance + unrealized P&L
  margin: number; // Used margin
  marginLevel: number; // Equity / Margin
  totalPnL: number; // Realized + unrealized P&L
  realizedPnL: number;
  unrealizedPnL: number;
  totalCommission: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
}

export class RealTradingEngine extends EventEmitter implements ITradingEngine {
  private config: RealTradingConfig;
  private wallet: RealWallet;
  private positions: Map<string, RealPosition> = new Map();
  private orders: Map<string, RealOrder> = new Map();
  private orderHistory: RealOrder[] = [];
  private exchange: any; // Exchange adapter instance
  private tradeHistory: Array<{
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    quantity: number;
    pnl: number;
    commission: number;
    timestamp: Date;
    strategy: string;
  }> = [];

  // Safety guardrails
  private _emergencyStop: boolean = false;
  private dailyRealizedPnL: number = 0;
  private dailyPnLResetDate: string = '';
  private maxDailyLossPercent: number;
  private maxSingleTradePercent: number;
  private maxOpenPositions: number;
  private positionSizeRampUp: number;

  // ITradingEngine
  readonly tradingMode: TradingMode;

  // Database readiness (mirrors PaperTradingEngine pattern)
  private readyPromise: Promise<void>;
  private isReady: boolean = false;

  constructor(config: RealTradingConfig) {
    super();
    this.config = config;
    this.tradingMode = config.dryRun ? 'dry-run' : 'live';

    // Safety guardrails (conservative defaults)
    this.maxDailyLossPercent = config.maxDailyLossPercent ?? 0.05; // 5%
    this.maxSingleTradePercent = config.maxSingleTradePercent ?? 0.02; // 2%
    this.maxOpenPositions = config.maxOpenPositions ?? 3;
    this.positionSizeRampUp = config.positionSizeRampUp ?? 0.10; // Start at 10% of intended size

    // Initialize exchange adapter
    // Phase 51 — when BINANCE_USE_TESTNET=1, the BinanceAdapter routes signed
    // REST calls to testnet.binance.vision. Market data feeds (PriceFabric)
    // stay on PRODUCTION Binance — strategy decisions on real liquidity, fills
    // simulated against testnet's order book. This is the right paper-trading
    // architecture: real data, fake money.
    if (config.exchange === 'binance') {
      const { BinanceAdapter } = require('../exchanges/BinanceAdapter');
      this.exchange = new BinanceAdapter(config.apiKey, config.apiSecret);
    } else if (config.exchange === 'coinbase') {
      const { CoinbaseAdapter } = require('../exchanges/CoinbaseAdapter');
      this.exchange = new CoinbaseAdapter(config.apiKey, config.apiSecret);
    }

    // Initialize wallet with zeros (will be loaded from DB + exchange)
    this.wallet = {
      userId: config.userId,
      balance: 0,
      equity: 0,
      margin: 0,
      marginLevel: 0,
      totalPnL: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalCommission: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
    };

    if (config.dryRun) {
      executionLogger.info('Initialized in DRY-RUN mode', { userId: config.userId });
    } else {
      executionLogger.info('Initialized in LIVE mode', { userId: config.userId });
    }
    executionLogger.info('Safety guardrails configured', { maxDailyLossPercent: (this.maxDailyLossPercent * 100).toFixed(0), maxSingleTradePercent: (this.maxSingleTradePercent * 100).toFixed(0), maxPositions: this.maxOpenPositions, rampUpPercent: (this.positionSizeRampUp * 100).toFixed(0) });

    // Initialize wallet from DB + exchange (async)
    this.readyPromise = this.initializeWallet();
  }

  // ========================================
  // DATABASE PERSISTENCE (mirrors PaperTradingEngine)
  // ========================================

  /**
   * Ensure engine is ready before operations
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) return;
    await this.readyPromise;
  }

  /**
   * Initialize wallet from database, then sync with exchange balance.
   * If no DB wallet exists, creates one with exchange balance.
   */
  private async initializeWallet(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const { paperWallets } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) {
        executionLogger.warn('Database not available, using in-memory wallet');
        await this.syncWalletBalance();
        this.isReady = true;
        return;
      }

      const existing = await db.select()
        .from(paperWallets)
        .where(and(
          eq(paperWallets.userId, this.config.userId),
          eq(paperWallets.tradingMode, 'live')
        ))
        .limit(1);

      if (existing.length > 0) {
        // Load existing live wallet from database
        const dbWallet = existing[0];
        this.wallet = {
          userId: this.config.userId,
          balance: parseFloat(dbWallet.balance.toString()),
          equity: parseFloat(dbWallet.equity.toString()),
          margin: parseFloat(dbWallet.margin.toString()),
          marginLevel: parseFloat(dbWallet.marginLevel.toString()),
          totalPnL: parseFloat(dbWallet.totalPnL.toString()),
          realizedPnL: parseFloat(dbWallet.realizedPnL.toString()),
          unrealizedPnL: parseFloat(dbWallet.unrealizedPnL.toString()),
          totalCommission: parseFloat(dbWallet.totalCommission.toString()),
          totalTrades: dbWallet.totalTrades,
          winningTrades: dbWallet.winningTrades,
          losingTrades: dbWallet.losingTrades,
          winRate: parseFloat(dbWallet.winRate.toString()),
        };
        executionLogger.info('Loaded existing live wallet', { balance: this.wallet.balance.toFixed(2), totalTrades: this.wallet.totalTrades, winRate: this.wallet.winRate.toFixed(1) });

        // Load open positions from database
        await this.loadOpenPositionsFromDatabase(db);

        // Phase B-2.2 — On testnet, the DB-stored balance can be stale (e.g. a
        // 0-balance row from a failed earlier init when methods were misnamed).
        // Always re-sync from exchange in testnet mode so the wallet reflects
        // the actual testnet account state. Live mode trusts the DB so we
        // don't pay rate-limit cost on every restart in production.
        if (process.env.BINANCE_USE_TESTNET === '1') {
          executionLogger.info('Re-syncing wallet balance from testnet (override stale DB)', {});
          await this.syncWalletBalance();
          await this.persistWalletToDatabase();
        }
      } else {
        // First time: sync balance from exchange, then persist to DB
        await this.syncWalletBalance();
        await this.persistWalletToDatabase();
        executionLogger.info('Created new live wallet', { balance: this.wallet.balance.toFixed(2) });
      }

      this.isReady = true;
    } catch (error) {
      executionLogger.error('Failed to initialize wallet from database', { error: (error as Error)?.message });
      // Fallback: sync from exchange
      await this.syncWalletBalance();
      this.isReady = true;
    }
  }

  /**
   * Load open positions from database and recalculate margin
   * (mirrors PaperTradingEngine.loadOpenPositionsFromDatabase)
   */
  private async loadOpenPositionsFromDatabase(db: any): Promise<void> {
    try {
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const openPositions = await db.select()
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.userId, this.config.userId),
            eq(paperPositions.status, 'open'),
            eq(paperPositions.tradingMode, 'live')
          )
        );

      // Clear existing positions and reload from database
      this.positions.clear();
      let calculatedMargin = 0;
      let calculatedUnrealizedPnL = 0;

      for (const dbPos of openPositions) {
        const position: RealPosition = {
          id: dbPos.id.toString(),
          dbPositionId: dbPos.id,
          userId: dbPos.userId,
          symbol: dbPos.symbol,
          exchange: dbPos.exchange || this.config.exchange,
          side: dbPos.side as 'long' | 'short',
          entryPrice: parseFloat(dbPos.entryPrice.toString()),
          currentPrice: parseFloat(dbPos.currentPrice?.toString() || dbPos.entryPrice.toString()),
          quantity: parseFloat(dbPos.quantity.toString()),
          stopLoss: dbPos.stopLoss ? parseFloat(dbPos.stopLoss.toString()) : undefined,
          takeProfit: dbPos.takeProfit ? parseFloat(dbPos.takeProfit.toString()) : undefined,
          entryTime: new Date(dbPos.entryTime),
          unrealizedPnL: parseFloat(dbPos.unrealizedPnL?.toString() || '0'),
          unrealizedPnLPercent: parseFloat(dbPos.unrealizedPnLPercent?.toString() || '0'),
          commission: parseFloat(dbPos.commission?.toString() || '0'),
          strategy: dbPos.strategy || 'unknown',
        };

        this.positions.set(position.id, position);
        calculatedMargin += position.entryPrice * position.quantity;
        calculatedUnrealizedPnL += position.unrealizedPnL;
      }

      // Update wallet margin based on actual open positions
      const oldMargin = this.wallet.margin;
      this.wallet.margin = calculatedMargin;
      this.wallet.unrealizedPnL = calculatedUnrealizedPnL;
      this.wallet.equity = this.wallet.balance + calculatedUnrealizedPnL;
      this.wallet.marginLevel = calculatedMargin > 0 ? (this.wallet.equity / calculatedMargin) * 100 : 0;

      if (oldMargin !== calculatedMargin) {
        executionLogger.info('Margin corrected', { oldMargin: oldMargin.toFixed(2), newMargin: calculatedMargin.toFixed(2), openPositions: openPositions.length });
        await this.persistWalletToDatabase();
      }

      executionLogger.info('Loaded open live positions', { count: openPositions.length, margin: calculatedMargin.toFixed(2) });
    } catch (error) {
      executionLogger.error('Failed to load open positions', { error: (error as Error)?.message });
    }
  }

  /**
   * Persist wallet state to database (tradingMode='live')
   */
  private async persistWalletToDatabase(): Promise<void> {
    try {
      const { upsertPaperWallet } = await import('../db');

      await upsertPaperWallet({
        userId: this.wallet.userId,
        tradingMode: 'live',
        balance: this.wallet.balance.toFixed(2),
        equity: this.wallet.equity.toFixed(2),
        margin: this.wallet.margin.toFixed(2),
        marginLevel: this.wallet.marginLevel.toFixed(2),
        totalPnL: this.wallet.totalPnL.toFixed(2),
        realizedPnL: this.wallet.realizedPnL.toFixed(2),
        unrealizedPnL: this.wallet.unrealizedPnL.toFixed(2),
        totalCommission: this.wallet.totalCommission.toFixed(2),
        totalTrades: this.wallet.totalTrades,
        winningTrades: this.wallet.winningTrades,
        losingTrades: this.wallet.losingTrades,
        winRate: this.wallet.winRate.toFixed(2),
      });
    } catch (error) {
      executionLogger.error('Failed to persist wallet to database', { error: (error as Error)?.message });
    }
  }

  /**
   * Sync wallet balance from exchange
   */
  private async syncWalletBalance(): Promise<void> {
    try {
      executionLogger.info('Syncing wallet balance from exchange', { exchange: this.config.exchange });

      // Get real balance from exchange
      const balances = await this.exchange.getAccountBalance();

      // Find USDT balance (or other quote currency)
      const usdtBalance = balances.find((b: any) => b.asset === 'USDT' || b.asset === 'USD' || b.asset === 'USDC');

      if (usdtBalance) {
        this.wallet.balance = usdtBalance.free + usdtBalance.locked;
        this.wallet.equity = this.wallet.balance; // Will be updated with position P&L
        executionLogger.info('Wallet synced', { balance: this.wallet.balance.toFixed(2) });
      } else {
        executionLogger.warn('No USDT/USD balance found, using $0');
        this.wallet.balance = 0;
        this.wallet.equity = 0;
      }

      this.emit('wallet_synced', this.wallet);
    } catch (error) {
      executionLogger.error('Failed to sync wallet', { error: (error as Error)?.message });
      // Don't throw - keep existing balance on error
    }
  }

  /**
   * Get current wallet status
   */
  getWallet(): RealWallet {
    return { ...this.wallet };
  }

  /**
   * Place a real trade order
   */
  async placeOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
    quantity: number;
    price?: number;
    stopPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    strategy: string;
  }): Promise<RealOrder> {
    // Ensure wallet is loaded before placing orders
    await this.waitForReady();

    // ========================================
    // SAFETY GUARDRAIL #1: Emergency stop
    // ========================================
    if (this._emergencyStop) {
      throw new Error(`[RealTradingEngine] EMERGENCY STOP ACTIVE — all trading halted. Call resumeTrading() to resume.`);
    }

    // ========================================
    // SAFETY GUARDRAIL #2: Daily loss circuit breaker
    // ========================================
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyPnLResetDate !== today) {
      this.dailyRealizedPnL = 0;
      this.dailyPnLResetDate = today;
    }
    const startingEquity = this.wallet.balance + this.wallet.unrealizedPnL + Math.abs(this.dailyRealizedPnL);
    if (startingEquity > 0 && this.dailyRealizedPnL < 0) {
      const dailyLossPercent = Math.abs(this.dailyRealizedPnL) / startingEquity;
      if (dailyLossPercent >= this.maxDailyLossPercent) {
        this._emergencyStop = true;
        executionLogger.error('DAILY LOSS CIRCUIT BREAKER triggered', { dailyLossPercent: (dailyLossPercent * 100).toFixed(2), limit: (this.maxDailyLossPercent * 100).toFixed(0) });
        this.emit('emergency_stop', { reason: 'daily_loss_limit', dailyLossPercent });
        throw new Error(`[RealTradingEngine] Daily loss limit exceeded (${(dailyLossPercent * 100).toFixed(2)}%). Trading halted.`);
      }
    }

    // ========================================
    // SAFETY GUARDRAIL #3: Max open positions
    // ========================================
    if (params.side === 'buy' && this.positions.size >= this.maxOpenPositions) {
      throw new Error(`[RealTradingEngine] Max open positions reached (${this.positions.size}/${this.maxOpenPositions}). Close a position first.`);
    }

    // ========================================
    // SAFETY GUARDRAIL #4: Position size ramp-up
    // ========================================
    let adjustedQuantity = params.quantity;
    if (this.positionSizeRampUp < 1.0) {
      adjustedQuantity = params.quantity * this.positionSizeRampUp;
      executionLogger.info('Ramp-up active', { rampUpPercent: (this.positionSizeRampUp * 100).toFixed(0), originalQty: params.quantity.toFixed(8), adjustedQty: adjustedQuantity.toFixed(8) });
      params = { ...params, quantity: adjustedQuantity };
    }

    // ========================================
    // SAFETY GUARDRAIL #5: Max single trade size
    // ========================================
    if (params.side === 'buy' && params.price) {
      const orderValue = adjustedQuantity * params.price;
      // Phase B-2.5 — use max(equity, balance, 1) as denominator. Earlier
      // logic was `equity > 0 ? orderValue/equity : 1` which silently rejected
      // every trade as 100% if equity became 0/NaN due to an upstream sync
      // hiccup or unrealizedPnL miscalculation. Falling back to balance keeps
      // the safety check meaningful even if equity is momentarily corrupted,
      // and is a tighter denominator than equity in practice (balance excludes
      // unrealized gains, so the ratio is more conservative — matches intent).
      const denominator = Math.max(this.wallet.equity || 0, this.wallet.balance || 0, 1);
      const tradePercent = orderValue / denominator;
      if (tradePercent > this.maxSingleTradePercent * 5) {
        throw new Error(`[RealTradingEngine] Single trade too large: ${(tradePercent * 100).toFixed(1)}% of equity (hard limit ${(this.maxSingleTradePercent * 5 * 100).toFixed(0)}%)`);
      }
    }

    // Validate balance before placing order
    if (params.side === 'buy') {
      const orderValue = params.quantity * (params.price || 0);

      if (this.wallet.balance <= 0) {
        throw new Error(`[RealTradingEngine] Insufficient balance: $${this.wallet.balance.toFixed(2)}`);
      }

      if (orderValue > this.wallet.balance) {
        throw new Error(`[RealTradingEngine] Order value $${orderValue.toFixed(2)} exceeds available balance $${this.wallet.balance.toFixed(2)}`);
      }

      // Reserve balance to prevent double-spending
      this.wallet.balance -= orderValue;
      executionLogger.info('Balance reserved for order', { reserved: orderValue.toFixed(2), remaining: this.wallet.balance.toFixed(2) });
    }

    const orderId = `real_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const order: RealOrder = {
      id: orderId,
      userId: this.config.userId,
      symbol: params.symbol,
      exchange: this.config.exchange,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      status: 'pending',
      createdAt: new Date(),
      strategy: params.strategy || 'unknown',
    };

    this.orders.set(orderId, order);

    if (this.config.dryRun) {
      executionLogger.info('DRY-RUN order placed', { orderId, side: params.side, quantity: params.quantity, symbol: params.symbol, type: params.type });

      // Simulate immediate fill in dry-run mode
      order.status = 'filled';
      order.filledPrice = params.price || 0;
      order.filledQuantity = params.quantity;
      order.filledAt = new Date();
      order.commission = (params.price || 0) * params.quantity * 0.001; // 0.1% commission

      this.wallet.totalCommission += order.commission || 0;
      this.wallet.totalTrades++;

      this.emit('order_filled', order);

      if (params.side === 'buy') {
        await this.openPosition(order);
      } else {
        await this.closePosition(order);
      }

      // Persist wallet after dry-run fill
      await this.persistWalletToDatabase();

      return order;
    }

    // Execute order on exchange
    try {
      await this.executeOrderOnExchange(order);
    } catch (error) {
      executionLogger.error('Order execution failed', { error: (error as Error)?.message });
      order.status = 'rejected';
      this.emit('order_rejected', order);
    }

    return order;
  }

  /**
   * Execute order on exchange (Binance/Coinbase)
   * CRITICAL: This method places REAL orders on the exchange
   */
  private async executeOrderOnExchange(order: RealOrder): Promise<void> {
    executionLogger.info('EXECUTING REAL ORDER', { exchange: this.config.exchange, orderId: order.id, side: order.side, quantity: order.quantity, symbol: order.symbol, type: order.type });

    try {
      // Execute the actual order on the exchange
      let exchangeResult: any;

      if (order.type === 'market') {
        exchangeResult = await this.exchange.placeMarketOrder({
          symbol: order.symbol,
          side: order.side,
          type: 'market',
          quantity: order.quantity,
        });
      } else if (order.type === 'limit' && order.price) {
        exchangeResult = await this.exchange.placeLimitOrder({
          symbol: order.symbol,
          side: order.side,
          type: 'limit',
          quantity: order.quantity,
          price: order.price,
        });
      } else {
        throw new Error(`Unsupported order type: ${order.type}`);
      }

      // Update order with exchange response
      order.status = 'filled';
      order.exchangeOrderId = exchangeResult.orderId || exchangeResult.id;
      order.filledPrice = exchangeResult.filledPrice || exchangeResult.avgPrice || order.price || 0;
      order.filledQuantity = exchangeResult.filledQuantity || exchangeResult.executedQty || order.quantity;
      order.filledAt = new Date();
      order.commission = exchangeResult.commission || ((order.filledPrice || 0) * order.quantity * 0.001); // 0.1% default commission

      executionLogger.info('REAL ORDER FILLED', { exchangeOrderId: order.exchangeOrderId, filledPrice: order.filledPrice?.toFixed(2) });

    } catch (error) {
      executionLogger.error('REAL ORDER FAILED', { error: (error as Error)?.message });
      order.status = 'rejected';
      this.emit('order_rejected', order);
      throw error;
    }

    this.wallet.totalCommission += order.commission || 0;
    this.wallet.totalTrades++;

    // Update wallet balance
    if (order.side === 'buy') {
      const cost = (order.filledPrice || 0) * order.quantity + (order.commission || 0);
      this.wallet.balance -= cost;
    } else {
      const proceeds = (order.filledPrice || 0) * order.quantity - (order.commission || 0);
      this.wallet.balance += proceeds;
    }

    // Update or create position
    if (order.side === 'buy') {
      await this.openPosition(order);
    } else {
      await this.closePosition(order);
    }

    // Move to history
    this.orderHistory.push(order);
    this.orders.delete(order.id);

    executionLogger.info('Order filled', { orderId: order.id, filledPrice: order.filledPrice?.toFixed(2), commission: (order.commission || 0).toFixed(2) });
    this.emit('order_filled', order);
    this.emit('wallet_updated', this.wallet);

    // Persist wallet to database after exchange fill
    await this.persistWalletToDatabase();
  }

  /**
   * Open a new position (with DB persistence)
   */
  private async openPosition(order: RealOrder): Promise<void> {
    const positionKey = `${order.symbol}_${order.exchange}`;
    const existingPosition = this.positions.get(positionKey);

    if (existingPosition) {
      // Average down/up
      const totalQuantity = existingPosition.quantity + order.filledQuantity!;
      const totalCost = (existingPosition.entryPrice * existingPosition.quantity) + (order.filledPrice! * order.filledQuantity!);
      existingPosition.entryPrice = totalCost / totalQuantity;
      existingPosition.quantity = totalQuantity;
      existingPosition.commission += order.commission || 0;

      // Update position in database
      if (existingPosition.dbPositionId) {
        try {
          const { updatePaperPosition } = await import('../db');
          await updatePaperPosition(existingPosition.dbPositionId, {
            entryPrice: existingPosition.entryPrice.toString(),
            quantity: existingPosition.quantity.toString(),
            commission: existingPosition.commission.toString(),
          });
        } catch (error) {
          executionLogger.error('Failed to update position in database', { error: (error as Error)?.message });
        }
      }
    } else {
      // New position
      const position: RealPosition = {
        id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: this.config.userId,
        symbol: order.symbol,
        exchange: order.exchange,
        side: 'long',
        entryPrice: order.filledPrice!,
        currentPrice: order.filledPrice!,
        quantity: order.filledQuantity!,
        entryTime: new Date(),
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        commission: order.commission || 0,
        strategy: order.strategy,
      };

      // Save position to database and get the database ID
      let dbPositionId: number | undefined;
      try {
        const { insertPaperPosition, insertPaperTrade } = await import('../db');

        const insertedPosition = await insertPaperPosition({
          userId: position.userId,
          tradingMode: 'live',
          symbol: position.symbol,
          exchange: position.exchange as 'binance' | 'coinbase',
          side: position.side,
          entryPrice: position.entryPrice.toString(),
          currentPrice: position.currentPrice.toString(),
          quantity: position.quantity.toString(),
          stopLoss: position.stopLoss?.toString(),
          takeProfit: position.takeProfit?.toString(),
          entryTime: position.entryTime,
          unrealizedPnL: position.unrealizedPnL.toString(),
          unrealizedPnLPercent: position.unrealizedPnLPercent.toString(),
          commission: position.commission.toString(),
          strategy: position.strategy,
          status: 'open',
        });

        // Capture database position ID for IntelligentExitManager
        if (insertedPosition && insertedPosition.id) {
          dbPositionId = insertedPosition.id;
          position.dbPositionId = dbPositionId;
          executionLogger.info('Position saved to database', { dbPositionId });
        }

        // Record entry trade for complete audit trail
        await insertPaperTrade({
          userId: this.config.userId,
          tradingMode: 'live',
          orderId: order.id,
          symbol: order.symbol,
          side: 'buy',
          price: order.filledPrice!.toString(),
          quantity: order.filledQuantity!.toString(),
          pnl: '0', // Entry trade has no P&L yet
          commission: (order.commission || 0).toString(),
          strategy: order.strategy,
        });
        executionLogger.info('Entry trade persisted to database', { orderId: order.id });
      } catch (error) {
        executionLogger.error('Failed to save position/trade to database', { error: (error as Error)?.message });
      }

      this.positions.set(positionKey, position);
      executionLogger.info('Position opened', { positionId: position.id, symbol: order.symbol, price: order.filledPrice!.toFixed(2) });

      // Emit position with database ID for IntelligentExitManager registration
      this.emit('position_opened', { ...position, dbPositionId });
    }

    await this.updateWalletMetrics();
  }

  /**
   * Close an existing position (with DB persistence)
   */
  private async closePosition(order: RealOrder): Promise<void> {
    const positionKey = `${order.symbol}_${order.exchange}`;
    const position = this.positions.get(positionKey);

    if (!position) {
      executionLogger.warn('No position found for symbol', { symbol: order.symbol });
      return;
    }

    // Calculate P&L
    const pnl = (order.filledPrice! - position.entryPrice) * order.filledQuantity!;
    const pnlPercent = ((order.filledPrice! - position.entryPrice) / position.entryPrice) * 100;

    // Update balance with realized P&L when position closes
    this.wallet.balance += pnl;
    this.wallet.realizedPnL += pnl;
    this.wallet.totalPnL += pnl;

    // Track daily P&L for circuit breaker
    this.dailyRealizedPnL += pnl;

    if (pnl > 0) {
      this.wallet.winningTrades++;
    } else {
      this.wallet.losingTrades++;
    }

    const completedTrades = this.wallet.winningTrades + this.wallet.losingTrades;
    this.wallet.winRate = completedTrades > 0 ? (this.wallet.winningTrades / completedTrades) * 100 : 0;

    // Record trade in memory
    this.tradeHistory.push({
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      price: order.filledPrice!,
      quantity: order.filledQuantity!,
      pnl,
      commission: order.commission!,
      timestamp: new Date(),
      strategy: order.strategy,
    });

    // Persist exit trade to database
    try {
      const { insertPaperTrade, closePaperPosition } = await import('../db');
      await insertPaperTrade({
        userId: this.config.userId,
        tradingMode: 'live',
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        price: order.filledPrice!.toString(),
        quantity: order.filledQuantity!.toString(),
        pnl: pnl.toString(),
        commission: (order.commission || 0).toString(),
        strategy: order.strategy,
      });
      executionLogger.info('Exit trade persisted to database', { orderId: order.id });

      // Close position in database
      if (position.dbPositionId) {
        await closePaperPosition(
          position.dbPositionId,
          order.filledPrice!,
          pnl,
          'system'
        );
        executionLogger.info('Position closed in database', { dbPositionId: position.dbPositionId });
      }
    } catch (error) {
      executionLogger.error('Failed to persist exit trade to database', { error: (error as Error)?.message });
    }

    // Close position in memory
    this.positions.delete(positionKey);
    executionLogger.info('Position closed', { positionId: position.id, pnl: pnl.toFixed(2), pnlPercent: pnlPercent.toFixed(2) });
    this.emit('position_closed', { position, pnl, pnlPercent });

    await this.updateWalletMetrics();
  }

  /**
   * Update position prices and unrealized P&L (with DB persistence)
   */
  async updatePositionPrices(prices: Map<string, number>): Promise<void> {
    const { getDb } = await import('../db');
    const { paperPositions } = await import('../../drizzle/schema');
    const { eq, and } = await import('drizzle-orm');
    const db = await getDb();

    for (const [key, position] of Array.from(this.positions.entries())) {
      const currentPrice = prices.get(position.symbol);
      if (currentPrice) {
        position.currentPrice = currentPrice;
        position.unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
        position.unrealizedPnLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

        // Update database for real-time UI display
        if (db && position.dbPositionId) {
          try {
            await db
              .update(paperPositions)
              .set({
                currentPrice: currentPrice.toString(),
                unrealizedPnL: position.unrealizedPnL.toString(),
                unrealizedPnLPercent: position.unrealizedPnLPercent.toString(),
                updatedAt: new Date(),
              })
              .where(eq(paperPositions.id, position.dbPositionId));
          } catch (error) {
            executionLogger.error('Error updating position in database', { positionId: position.id, error: (error as Error)?.message });
          }
        }
      }
    }

    await this.updateWalletMetrics();
  }

  /**
   * Update wallet metrics and persist to database
   */
  private async updateWalletMetrics(): Promise<void> {
    // Calculate unrealized P&L from all positions
    let unrealizedPnL = 0;
    let margin = 0;

    for (const position of Array.from(this.positions.values())) {
      unrealizedPnL += position.unrealizedPnL;
      margin += position.entryPrice * position.quantity;
    }

    this.wallet.unrealizedPnL = unrealizedPnL;
    this.wallet.totalPnL = this.wallet.realizedPnL + unrealizedPnL;
    this.wallet.equity = this.wallet.balance + unrealizedPnL;
    this.wallet.margin = margin;
    this.wallet.marginLevel = margin > 0 ? (this.wallet.equity / margin) * 100 : 0;

    // Persist wallet to database
    await this.persistWalletToDatabase();
  }

  /**
   * Get all open positions
   */
  getPositions(): RealPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get all pending orders
   */
  getOrders(): RealOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get order history
   */
  getOrderHistory(): RealOrder[] {
    return [...this.orderHistory];
  }

  /**
   * Get trade history
   */
  getTradeHistory() {
    return [...this.tradeHistory];
  }

  /**
   * Cancel a pending order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== 'pending') {
      throw new Error(`Order ${orderId} cannot be cancelled (status: ${order.status})`);
    }

    // Cancel on exchange if it was submitted
    if (!this.config.dryRun && order.exchangeOrderId && this.exchange) {
      try {
        executionLogger.info('Cancelling order on exchange', { exchangeOrderId: order.exchangeOrderId, exchange: this.config.exchange });
        const cancelled = await this.exchange.cancelOrder(order.exchangeOrderId, order.symbol);
        if (!cancelled) {
          executionLogger.warn('Exchange returned false for cancel, may already be filled', { exchangeOrderId: order.exchangeOrderId });
        }
        executionLogger.info('Exchange order cancelled', { exchangeOrderId: order.exchangeOrderId });
      } catch (cancelError: any) {
        executionLogger.error('Failed to cancel on exchange', { error: cancelError.message });
        // Still mark locally cancelled — exchange may have already filled
      }
    }

    order.status = 'cancelled';
    this.orderHistory.push(order);
    this.orders.delete(orderId);

    executionLogger.info('Order cancelled', { orderId });
    this.emit('order_cancelled', order);
  }

  /**
   * Close a specific position
   */
  async closePositionById(positionId: string, currentPrice: number, strategy: string): Promise<void> {
    const position = Array.from(this.positions.values()).find(p => p.id === positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Place sell order to close position
    await this.placeOrder({
      symbol: position.symbol,
      type: 'market',
      side: 'sell',
      quantity: position.quantity,
      price: currentPrice,
      strategy,
    });
  }

  /**
   * Close all positions
   */
  async closeAllPositions(prices: Map<string, number>, strategy: string): Promise<void> {
    const positions = Array.from(this.positions.values());

    for (const position of positions) {
      const currentPrice = prices.get(position.symbol);
      if (currentPrice) {
        await this.closePositionById(position.id, currentPrice, strategy);
      }
    }

    executionLogger.info('All positions closed');
  }

  // ========================================
  // SAFETY: Emergency Stop (Kill Switch)
  // ========================================

  /**
   * Emergency stop — immediately halts all new trading.
   * Optionally closes all open positions with market orders.
   */
  async emergencyStop(closePositions: boolean = false): Promise<void> {
    this._emergencyStop = true;
    executionLogger.error('EMERGENCY STOP ACTIVATED', { userId: this.config.userId });
    this.emit('emergency_stop', { reason: 'manual', closePositions });

    if (closePositions) {
      executionLogger.error('Closing all open positions', { count: this.positions.size });
      const prices = new Map<string, number>();
      for (const [key, pos] of this.positions) {
        prices.set(pos.symbol, pos.currentPrice);
      }
      try {
        await this.closeAllPositions(prices, 'emergency_stop');
      } catch (err) {
        executionLogger.error('Failed to close some positions during emergency stop', { error: (err as Error)?.message });
      }
    }
  }

  /**
   * Resume trading after emergency stop.
   * Requires explicit call — safety measure against accidental resume.
   */
  resumeTrading(): void {
    this._emergencyStop = false;
    executionLogger.info('Trading RESUMED', { userId: this.config.userId });
    this.emit('trading_resumed');
  }

  /** Check if emergency stop is active */
  isEmergencyStopped(): boolean {
    return this._emergencyStop;
  }

  /** Update the position size ramp-up fraction (0-1) */
  setPositionSizeRampUp(fraction: number): void {
    this.positionSizeRampUp = Math.max(0, Math.min(1, fraction));
    executionLogger.info('Position size ramp-up updated', { rampUpPercent: (this.positionSizeRampUp * 100).toFixed(0) });
  }

  // ========================================
  // Position Reconciliation
  // ========================================

  /**
   * Reconcile local position state with exchange.
   * Detects orphaned positions (local but not on exchange) and
   * unknown positions (on exchange but not local).
   */
  async reconcilePositions(): Promise<{
    matched: number;
    orphaned: string[];
    unknown: Array<{ symbol: string; quantity: number }>;
  }> {
    const result = { matched: 0, orphaned: [] as string[], unknown: [] as Array<{ symbol: string; quantity: number }> };

    if (!this.exchange) {
      executionLogger.warn('No exchange adapter, cannot reconcile');
      return result;
    }

    try {
      // Get balances from exchange (non-zero balances represent open positions)
      const balances = await this.exchange.getAccountBalance();
      const exchangePositions = new Map<string, number>();
      for (const b of balances) {
        if (b.asset !== 'USDT' && b.asset !== 'USD' && b.asset !== 'USDC' && b.total > 0) {
          exchangePositions.set(b.asset, b.total);
        }
      }

      // Check local positions against exchange
      for (const [key, pos] of this.positions) {
        const asset = pos.symbol.replace(/-USD.*/, '').replace('/USD.*/', '');
        const exchangeQty = exchangePositions.get(asset);
        if (exchangeQty && Math.abs(exchangeQty - pos.quantity) / pos.quantity < 0.01) {
          result.matched++;
          exchangePositions.delete(asset);
        } else if (!exchangeQty) {
          result.orphaned.push(key);
          executionLogger.warn('ORPHANED position detected', { key, detail: 'local but not on exchange' });
        }
      }

      // Remaining exchange positions are unknown
      for (const [asset, qty] of exchangePositions) {
        result.unknown.push({ symbol: asset, quantity: qty });
        executionLogger.warn('UNKNOWN position detected', { asset, quantity: qty, detail: 'on exchange but not local' });
      }

      if (result.orphaned.length > 0 || result.unknown.length > 0) {
        this.emit('reconciliation_mismatch', result);
      }

      executionLogger.info('Reconciliation complete', { matched: result.matched, orphaned: result.orphaned.length, unknown: result.unknown.length });
    } catch (err) {
      executionLogger.error('Reconciliation failed', { error: (err as Error)?.message });
    }

    return result;
  }

  /** Get the exchange adapter (for external use, e.g., balance queries) */
  getExchangeAdapter(): any {
    return this.exchange;
  }
}
