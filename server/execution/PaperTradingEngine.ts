/**
 * Paper Trading Engine
 * 
 * Simulates trade execution with virtual USD for risk-free testing.
 * Features:
 * - Virtual USD wallet with configurable starting balance
 * - Realistic slippage simulation (0.05-0.2% based on volatility)
 * - Commission simulation (Binance: 0.1%, Coinbase: 0.5%)
 * - Market impact simulation (large orders move price)
 * - Latency simulation (50-200ms execution delay)
 * - Real-time P&L tracking (unrealized + realized)
 */

import { EventEmitter } from 'events';
import { getDb } from '../db';
import { paperWallets } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import type { ITradingEngine, TradingMode } from './ITradingEngine';
import { executionLogger } from '../utils/logger';

export interface PaperTradingConfig {
  userId: number;
  initialBalance: number; // Starting virtual USD
  exchange: 'binance' | 'coinbase';
  enableSlippage: boolean;
  enableCommission: boolean;
  enableMarketImpact: boolean;
  enableLatency: boolean;
}

export interface PaperPosition {
  id: string;
  userId: number;
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  entryTime: Date;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  commission: number;
  strategy: string;
  dbPositionId?: number; // Database row ID for updating paperPositions table on close
}

export interface PaperOrder {
  id: string;
  userId: number;
  symbol: string;
  exchange: string;
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number; // For limit orders
  stopPrice?: number; // For stop orders
  stopLoss?: number; // Position stop loss
  takeProfit?: number; // Position take profit
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  filledPrice?: number;
  filledQuantity?: number;
  commission?: number;
  slippage?: number;
  latency?: number;
  createdAt: Date;
  filledAt?: Date;
  strategy: string;
}

export interface PaperWallet {
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

export class PaperTradingEngine extends EventEmitter implements ITradingEngine {
  readonly tradingMode: TradingMode = 'paper';
  private config: PaperTradingConfig;
  private wallet: PaperWallet;
  private positions: Map<string, PaperPosition> = new Map();
  private orders: Map<string, PaperOrder> = new Map();
  private orderHistory: PaperOrder[] = [];
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
  
  // ✅ FIX: Ready promise to ensure wallet is loaded before operations
  private readyPromise: Promise<void>;
  private isReady: boolean = false;

  // Commission rates by exchange
  private readonly COMMISSION_RATES = {
    binance: 0.001, // 0.1%
    coinbase: 0.005, // 0.5%
  };

  // Slippage parameters
  private readonly SLIPPAGE_BASE = 0.0005; // 0.05% base slippage
  private readonly SLIPPAGE_VOLATILITY_MULTIPLIER = 2; // 2x in high volatility

  // Market impact parameters
  private readonly MARKET_IMPACT_THRESHOLD = 0.01; // 1% of 24h volume
  private readonly MARKET_IMPACT_COEFFICIENT = 0.0001; // 0.01% per 1% of volume

  // Latency parameters (milliseconds)
  private readonly LATENCY_MIN = 50;
  private readonly LATENCY_MAX = 200;

  constructor(config: PaperTradingConfig) {
    super();
    this.config = config;
    
    // ✅ P1-2 FIX: Initialize wallet (will load from DB if exists)
    this.wallet = {
      userId: config.userId,
      balance: config.initialBalance,
      equity: config.initialBalance,
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

    // ✅ FIX: Store the initialization promise so we can await it
    this.readyPromise = this.initializeWallet();

    executionLogger.info('PaperTradingEngine initialized', { userId: config.userId });
  }

  /**
   * ✅ FIX: Ensure engine is ready before operations
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) return;
    await this.readyPromise;
  }

  /**
   * ✅ P1-2 FIX: Load wallet from database or create new
   * ✅ CRITICAL FIX: Also load open positions and recalculate margin
   */
  private async initializeWallet(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        executionLogger.warn('Database not available, using in-memory wallet');
        return;
      }

      const existing = await db.select()
        .from(paperWallets)
        .where(eq(paperWallets.userId, this.config.userId))
        .limit(1);

      if (existing.length > 0) {
        // Load existing wallet
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
        executionLogger.info('Loaded existing wallet', { balance: this.wallet.balance.toFixed(2), totalTrades: this.wallet.totalTrades, winRate: this.wallet.winRate.toFixed(1) });
        
        // ✅ CRITICAL: Load open positions from database and recalculate margin
        await this.loadOpenPositionsFromDatabase(db);
        
        this.isReady = true;
      } else {
        // Create new wallet in database
        await this.persistWalletToDatabase();
        executionLogger.info('Created new wallet', { balance: this.config.initialBalance });
        this.isReady = true;
      }
    } catch (error) {
      executionLogger.error('Failed to initialize wallet from database', { error: (error as Error)?.message });
      this.isReady = true; // Mark as ready even on error to prevent deadlock
    }
  }
  
  /**
   * ✅ CRITICAL FIX: Load open positions from database and recalculate margin
   * This ensures margin is always correct based on actual open positions
   */
  private async loadOpenPositionsFromDatabase(db: any): Promise<void> {
    try {
      const { paperPositions } = await import('../../drizzle/schema');
      const { and } = await import('drizzle-orm');
      
      const openPositions = await db.select()
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.userId, this.config.userId),
            eq(paperPositions.status, 'open')
          )
        );
      
      // Clear existing positions and reload from database
      this.positions.clear();
      let calculatedMargin = 0;
      let calculatedUnrealizedPnL = 0;
      
      for (const dbPos of openPositions) {
        const position: PaperPosition = {
          id: dbPos.id.toString(),
          // Phase 28 — set dbPositionId so closePosition's DB update path
          // (line ~710) hits the direct-by-id branch instead of falling
          // through to the fragile userId+symbol+open fallback.
          dbPositionId: dbPos.id,
          userId: dbPos.userId,
          symbol: dbPos.symbol,
          exchange: dbPos.exchange || 'coinbase',
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

        // Phase 28 — CRITICAL FIX: store DB-loaded positions under the same
        // map-key convention used by openPosition / closePosition / placeOrder
        // (`${symbol}_${exchange}`). Pre-Phase-28 we used `position.id` (the
        // DB ID like "4") which made placeOrder's symbol-keyed lookup miss
        // and route close orders into openPosition (creating new SHORT
        // positions instead of closing the LONG). Live evidence on
        // 2026-04-25: 5 BTC-USD shorts and 5 ETH-USD shorts stacked on top
        // of stuck longs — every "close" attempt opened a fresh short.
        const positionKey = `${position.symbol}_${position.exchange}`;
        this.positions.set(positionKey, position);
        calculatedMargin += position.entryPrice * position.quantity;
        calculatedUnrealizedPnL += position.unrealizedPnL;
      }
      
      // ✅ CRITICAL: Update wallet margin based on actual open positions
      const oldMargin = this.wallet.margin;
      this.wallet.margin = calculatedMargin;
      this.wallet.unrealizedPnL = calculatedUnrealizedPnL;
      this.wallet.equity = this.wallet.balance + calculatedUnrealizedPnL;
      this.wallet.marginLevel = calculatedMargin > 0 ? (this.wallet.equity / calculatedMargin) * 100 : 0;
      
      if (oldMargin !== calculatedMargin) {
        executionLogger.info('Margin corrected', { oldMargin: oldMargin.toFixed(2), newMargin: calculatedMargin.toFixed(2), openPositions: openPositions.length });
        // Persist corrected margin to database
        await this.persistWalletToDatabase();
      }
      
      executionLogger.info('Loaded open positions', { count: openPositions.length, margin: calculatedMargin.toFixed(2), available: (this.wallet.balance - calculatedMargin).toFixed(2) });
    } catch (error) {
      executionLogger.error('Failed to load open positions', { error: (error as Error)?.message });
    }
  }

  /**
   * Get current wallet status
   */
  getWallet(): PaperWallet {
    return { ...this.wallet };
  }

  /**
   * Update wallet state (used for syncing from database)
   */
  setWallet(wallet: Partial<PaperWallet>): void {
    Object.assign(this.wallet, wallet);
  }

  /**
   * Add virtual USD to wallet
   */
  async addFunds(amount: number): Promise<void> {
    await this.waitForReady();
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    this.wallet.balance += amount;
    this.wallet.equity += amount;
    executionLogger.info('Funds added to wallet', { amount, newBalance: this.wallet.balance.toFixed(2) });
    
    // Persist to database immediately
    await this.persistWalletToDatabase();
    
    this.emit('wallet_updated', this.wallet);
  }

  /**
   * Remove virtual USD from wallet
   */
  async removeFunds(amount: number): Promise<void> {
    await this.waitForReady();
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (amount > this.wallet.balance) {
      throw new Error(`Insufficient balance. Available: $${this.wallet.balance.toFixed(2)}`);
    }

    this.wallet.balance -= amount;
    this.wallet.equity -= amount;
    executionLogger.info('Funds removed from wallet', { amount, newBalance: this.wallet.balance.toFixed(2) });
    
    // Persist to database immediately
    await this.persistWalletToDatabase();
    
    this.emit('wallet_updated', this.wallet);
  }

  /**
   * Place a paper trade order
   */
  async placeOrder(params: {
    symbol: string;
    type: 'market' | 'limit' | 'stop_loss' | 'take_profit';
    side: 'buy' | 'sell';
    quantity: number;
    price?: number;
    stopPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    strategy: string;
  }): Promise<PaperOrder> {
    // ✅ FIX: Ensure wallet is loaded before placing orders
    await this.waitForReady();
    
    const orderId = `paper_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const order: PaperOrder = {
      id: orderId,
      userId: this.config.userId,
      symbol: params.symbol,
      exchange: this.config.exchange,
      type: params.type,
      side: params.side,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      status: 'pending',
      createdAt: new Date(),
      strategy: params.strategy,
    };

    this.orders.set(orderId, order);
    executionLogger.info('Order placed', { orderId, side: params.side, quantity: params.quantity, symbol: params.symbol, type: params.type });

    // Simulate latency if enabled
    if (this.config.enableLatency) {
      const latency = this.LATENCY_MIN + Math.random() * (this.LATENCY_MAX - this.LATENCY_MIN);
      order.latency = latency;
      await new Promise(resolve => setTimeout(resolve, latency));
    }

    // Execute order immediately for market orders
    if (params.type === 'market') {
      await this.executeOrder(orderId, params.price || 0);
    }

    return order;
  }

  /**
   * Execute a pending order
   */
  private async executeOrder(orderId: string, currentPrice: number): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== 'pending') {
      throw new Error(`Order ${orderId} is not pending (status: ${order.status})`);
    }

    // Phase 13A: CRITICAL — reject fills at price $0 or NaN
    // This was the root cause of -$326K phantom losses
    if (!currentPrice || currentPrice <= 0 || isNaN(currentPrice)) {
      throw new Error(`[PRICE_ZERO_BLOCKED] Refusing to fill order ${orderId} at price $${currentPrice} for ${order.symbol}`);
    }

    // Calculate execution price with slippage
    let executionPrice = currentPrice;
    let slippage = 0;

    if (this.config.enableSlippage) {
      const slippagePercent = this.calculateSlippage(order.quantity, currentPrice);
      slippage = slippagePercent;
      
      // Slippage is unfavorable: buy higher, sell lower
      if (order.side === 'buy') {
        executionPrice = currentPrice * (1 + slippagePercent);
      } else {
        executionPrice = currentPrice * (1 - slippagePercent);
      }
    }

    // Calculate commission
    const orderValue = executionPrice * order.quantity;
    const commission = this.config.enableCommission
      ? orderValue * this.COMMISSION_RATES[this.config.exchange]
      : 0;

    // ✅ CRITICAL FIX: Check available balance (balance - margin used)
    // Balance should NOT be deducted when opening positions
    // Balance only changes when positions are closed (realized P&L)
    if (order.side === 'buy') {
      const totalCost = orderValue + commission;
      // Phase 15C FIX: Include unrealized P&L in available balance calculation.
      // Previously: availableBalance = balance - margin (ignored unrealized losses)
      // This allowed opening new positions while existing ones were bleeding heavily.
      // Now: available = balance - margin + min(0, unrealizedPnL)
      // The min(0, ...) means: only DEDUCT unrealized losses, don't add unrealized gains.
      const unrealizedPnL = (this.wallet.equity || this.wallet.balance) - this.wallet.balance;
      const unrealizedDeduction = Math.min(0, unrealizedPnL); // Only deduct losses
      const availableBalance = this.wallet.balance - this.wallet.margin + unrealizedDeduction;

      if (totalCost > availableBalance) {
        order.status = 'rejected';
        executionLogger.error('Order rejected: insufficient available balance', { orderId, available: availableBalance.toFixed(2), required: totalCost.toFixed(2), unrealizedPnL: unrealizedPnL.toFixed(2) });
        this.emit('order_rejected', order);
        return;
      }

      // ✅ DO NOT deduct from balance - balance only changes on position close
      // Margin will be updated when position is created
      // Commission is deducted immediately
      this.wallet.balance -= commission;
      this.wallet.totalCommission += commission;
    } else {
      // For sell orders (closing positions), P&L is handled in closePosition()
      // Just deduct commission here
      this.wallet.balance -= commission;
      this.wallet.totalCommission += commission;
    }

    // Update order
    order.status = 'filled';
    order.filledPrice = executionPrice;
    order.filledQuantity = order.quantity;
    order.commission = commission;
    order.slippage = slippage;
    order.filledAt = new Date();

    // ✅ totalCommission already updated above when commission was deducted
    this.wallet.totalTrades++;

    // Phase 11 CRITICAL FIX: Support SHORT/sell trades
    // BEFORE: All sell orders were routed to closePosition(), which only closes existing longs.
    // If no long existed, the sell order silently failed. SHORT trades were IMPOSSIBLE.
    // AFTER: Buy can close a short OR open a long. Sell can close a long OR open a short.
    const positionKey = `${order.symbol}_${order.exchange}`;
    const existingPosition = this.positions.get(positionKey);

    if (order.side === 'buy') {
      if (existingPosition && existingPosition.side === 'short') {
        await this.closePosition(order); // Close existing short
      } else {
        await this.openPosition(order); // Open new long (or add to existing long)
      }
    } else {
      // order.side === 'sell'
      if (existingPosition && existingPosition.side === 'long') {
        await this.closePosition(order); // Close existing long
      } else {
        await this.openPosition(order); // Open new short (or add to existing short)
      }
    }
    
    // Persist wallet changes to database
    await this.persistWalletToDatabase();

    // Move to history
    this.orderHistory.push(order);
    this.orders.delete(orderId);

    executionLogger.info('Order filled', { orderId, price: executionPrice.toFixed(2), slippage: (slippage * 100).toFixed(3), commission: commission.toFixed(2) });

    // Phase 12 — drag-drift telemetry.
    // Compare the actual per-leg fee+slippage against the guard's configured
    // estimate for this exchange. When the observed reality diverges (sustained
    // WARN emissions for an exchange), `profitLock.exchangeFeeOverrides` is
    // miscalibrated and should be updated. Each leg is half of a round-trip,
    // so we double the single-leg cost to compare with the round-trip estimate.
    try {
      const { reportActualTradeDrag } = await import('../services/ProfitLockGuard');
      const feePercentThisLeg = orderValue > 0 ? (commission / orderValue) * 100 : 0;
      const slipPercentThisLeg = (slippage || 0) * 100;
      // Each fill is one leg of a round-trip. Double to match the round-trip
      // estimate `resolveDragPercent` returns. This tracks the symmetric case
      // where both entry and exit incur the same per-leg cost.
      reportActualTradeDrag(
        {
          side: order.side === 'buy' ? 'long' : 'short',
          entryPrice: executionPrice,
          exchange: order.exchange,
        },
        feePercentThisLeg * 2,
        slipPercentThisLeg * 2,
        { orderId, symbol: order.symbol, side: order.side },
      );
    } catch {
      // Telemetry is strictly best-effort — never throw from the fill path.
    }

    this.emit('order_filled', order);
    this.emit('wallet_updated', this.wallet);
  }

  /**
   * Open a new position
   */
  private async openPosition(order: PaperOrder): Promise<void> {
    const positionKey = `${order.symbol}_${order.exchange}`;
    const existingPosition = this.positions.get(positionKey);

    if (existingPosition) {
      // Average down/up
      const totalQuantity = existingPosition.quantity + order.filledQuantity!;
      const totalCost = (existingPosition.entryPrice * existingPosition.quantity) + (order.filledPrice! * order.filledQuantity!);
      existingPosition.entryPrice = totalCost / totalQuantity;
      existingPosition.quantity = totalQuantity;
      existingPosition.commission += order.commission!;
    } else {
      // New position
      const position: PaperPosition = {
        id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: this.config.userId,
        symbol: order.symbol,
        exchange: order.exchange,
        side: order.side === 'buy' ? 'long' : 'short', // Phase 11 FIX: Was hardcoded 'long' — now derives from order side
        entryPrice: order.filledPrice!,
        currentPrice: order.filledPrice!,
        quantity: order.filledQuantity!,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        entryTime: new Date(),
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        commission: order.commission!,
        strategy: order.strategy,
      };

      this.positions.set(positionKey, position);
      executionLogger.info('Position opened', { positionId: position.id, symbol: order.symbol, price: order.filledPrice!.toFixed(2) });
      
      // Save position to database and get the database ID
      let dbPositionId: number | undefined;
      try {
        const { insertPaperPosition, insertPaperTrade } = await import('../db');
        const insertedPosition = await insertPaperPosition({
          userId: position.userId,
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
        
        // ✅ CRITICAL: Capture database position ID for IntelligentExitManager and DB updates on close
        if (insertedPosition && insertedPosition.id) {
          dbPositionId = insertedPosition.id;
          position.dbPositionId = dbPositionId; // Store on position for closePosition DB update
          executionLogger.info('Position saved to database', { dbPositionId });
        }
        
        // ✅ CRITICAL FIX: Also record entry trade for complete audit trail
        await insertPaperTrade({
          userId: this.config.userId,
          orderId: order.id,
          symbol: order.symbol,
          side: order.side, // Phase 11 FIX: Was hardcoded 'buy' — now uses actual order side
          price: order.filledPrice!.toString(),
          quantity: order.filledQuantity!.toString(),
          pnl: '0', // Entry trade has no P&L yet
          commission: order.commission!.toString(),
          strategy: order.strategy,
        });
        executionLogger.info('Entry trade persisted to database', { orderId: order.id });
      } catch (error) {
        executionLogger.error('Failed to save position/trade to database', { error: (error as Error)?.message });
      }
      
      // ✅ CRITICAL: Emit position with database ID for IntelligentExitManager registration
      this.emit('position_opened', { ...position, dbPositionId });
    }

    await this.updateWalletMetrics();
  }

  /**
   * Close an existing position
   */
  private async closePosition(order: PaperOrder): Promise<void> {
    const positionKey = `${order.symbol}_${order.exchange}`;
    const position = this.positions.get(positionKey);

    if (!position) {
      throw new Error(`No position found for ${order.symbol} on ${order.exchange}`);
    }

    // Calculate P&L — Phase 11 FIX: Account for position side (long vs short)
    // Long: profit when price goes UP (exit - entry). Short: profit when price goes DOWN (entry - exit).
    const pnlMultiplier = position.side === 'long' ? 1 : -1;
    const pnl = pnlMultiplier * (order.filledPrice! - position.entryPrice) * order.filledQuantity!;
    const pnlPercent = pnlMultiplier * ((order.filledPrice! - position.entryPrice) / position.entryPrice) * 100;

    // ✅ FIX: Update balance with realized P&L when position closes
    this.wallet.balance += pnl;
    this.wallet.realizedPnL += pnl;
    this.wallet.totalPnL += pnl;

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

    // ✅ CRITICAL FIX: Persist trade to database for audit trail
    try {
      const { insertPaperTrade } = await import('../db');
      await insertPaperTrade({
        userId: this.config.userId,
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        price: order.filledPrice!.toString(),
        quantity: order.filledQuantity!.toString(),
        pnl: pnl.toString(),
        commission: order.commission!.toString(),
        strategy: order.strategy,
      });
      executionLogger.info('Trade persisted to database', { orderId: order.id });
    } catch (error) {
      executionLogger.error('Failed to persist trade to database', { error: (error as Error)?.message });
    }

    // Reduce or close position
    if (order.filledQuantity! >= position.quantity) {
      // Close entire position
      this.positions.delete(positionKey);
      executionLogger.info('Position closed', { positionId: position.id, pnl: pnl.toFixed(2), pnlPercent: pnlPercent.toFixed(2) });
      
      // ✅ CRITICAL FIX: Update paperPositions DB table with exit data and realized P&L
      try {
        const { getDb } = await import('../db');
        const { paperPositions } = await import('../../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        const db = await getDb();
        if (db) {
          const exitTime = new Date();
          const exitPrice = order.filledPrice!;
          
          if (position.dbPositionId) {
            // Direct update by DB row ID (most reliable)
            await db.update(paperPositions)
              .set({
                status: 'closed',
                exitPrice: exitPrice.toString(),
                exitTime,
                exitReason: order.strategy || 'exit',
                realizedPnl: pnl.toFixed(8),
                updatedAt: exitTime,
              })
              .where(eq(paperPositions.id, position.dbPositionId));
            executionLogger.info('DB position updated with exit data', { 
              dbPositionId: position.dbPositionId, exitPrice: exitPrice.toFixed(2), pnl: pnl.toFixed(2) 
            });
          } else {
            // Fallback: update by userId+symbol+status='open'
            await db.update(paperPositions)
              .set({
                status: 'closed',
                exitPrice: exitPrice.toString(),
                exitTime,
                exitReason: order.strategy || 'exit',
                realizedPnl: pnl.toFixed(8),
                updatedAt: exitTime,
              })
              .where(
                and(
                  eq(paperPositions.userId, position.userId),
                  eq(paperPositions.symbol, position.symbol),
                  eq(paperPositions.status, 'open')
                )
              );
            executionLogger.info('DB position updated (fallback) with exit data', { 
              symbol: position.symbol, exitPrice: exitPrice.toFixed(2), pnl: pnl.toFixed(2) 
            });
          }
        }
      } catch (dbErr) {
        executionLogger.error('Failed to update DB position on close', { error: (dbErr as Error)?.message });
      }
      
      this.emit('position_closed', { position, pnl, pnlPercent });
    } else {
      // Partial close
      position.quantity -= order.filledQuantity!;
      executionLogger.info('Position partially closed', { positionId: position.id, remaining: position.quantity });
    }

    await this.updateWalletMetrics();
  }

  /**
   * Update position prices and unrealized P&L
   * Also updates the database for real-time UI display
   */
  async updatePositionPrices(prices: Map<string, number>): Promise<void> {
    const { getDb } = await import('../db');
    const { paperPositions } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();

    for (const [key, position] of Array.from(this.positions.entries())) {
      const currentPrice = prices.get(position.symbol);
      if (currentPrice) {
        position.currentPrice = currentPrice;
        // Phase 11 FIX: Account for position side in unrealized P&L
        const pnlMultiplier = position.side === 'long' ? 1 : -1;
        position.unrealizedPnL = pnlMultiplier * (currentPrice - position.entryPrice) * position.quantity;
        position.unrealizedPnLPercent = pnlMultiplier * ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

        // Update database for real-time UI display
        // Use symbol+userId as identifier since in-memory positions use string IDs
        if (db) {
          try {
            const { and } = await import('drizzle-orm');
            await db
              .update(paperPositions)
              .set({
                currentPrice: currentPrice.toString(),
                unrealizedPnL: position.unrealizedPnL.toString(),
                unrealizedPnLPercent: position.unrealizedPnLPercent.toString(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(paperPositions.userId, position.userId),
                  eq(paperPositions.symbol, position.symbol),
                  eq(paperPositions.status, 'open')
                )
              );
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
   * Persist wallet state to database for UI display
   */
  private async persistWalletToDatabase(): Promise<void> {
    try {
      const { upsertPaperWallet } = await import('../db');
      
      await upsertPaperWallet({
        userId: this.wallet.userId,
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
   * Calculate slippage based on order size and market volatility
   */
  private calculateSlippage(quantity: number, price: number): number {
    let slippage = this.SLIPPAGE_BASE;

    // Increase slippage for large orders (market impact)
    if (this.config.enableMarketImpact) {
      const orderValue = quantity * price;
      // Assume 24h volume is 100x the order value for simplicity
      const volumeRatio = orderValue / (orderValue * 100);
      
      if (volumeRatio > this.MARKET_IMPACT_THRESHOLD) {
        slippage += volumeRatio * this.MARKET_IMPACT_COEFFICIENT;
      }
    }

    // Add random volatility component
    slippage += Math.random() * this.SLIPPAGE_BASE * this.SLIPPAGE_VOLATILITY_MULTIPLIER;

    return slippage;
  }

  /**
   * Get all open positions
   */
  getPositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get all pending orders
   */
  getOrders(): PaperOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get order history
   */
  getOrderHistory(): PaperOrder[] {
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

    // Phase 23 FIX: Use correct side to close position
    // Long positions close with 'sell', Short positions close with 'buy'
    const closeSide = position.side === 'long' ? 'sell' : 'buy';
    await this.placeOrder({
      symbol: position.symbol,
      type: 'market',
      side: closeSide,
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

  /**
   * Reset paper trading account
   */
  reset(): void {
    this.wallet = {
      userId: this.config.userId,
      balance: this.config.initialBalance,
      equity: this.config.initialBalance,
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

    this.positions.clear();
    this.orders.clear();
    this.orderHistory = [];
    this.tradeHistory = [];

    executionLogger.info('Account reset', { balance: this.config.initialBalance });
    this.emit('account_reset', this.wallet);
  }
}
