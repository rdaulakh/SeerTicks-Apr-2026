/**
 * Position Manager
 * 
 * Continuously monitors all open positions and manages complete trade lifecycle:
 * - Monitors stop-loss and take-profit levels every second
 * - Executes automatic exits when conditions are met
 * - Updates trailing stops as price moves favorably
 * - Handles partial profit taking (scale out)
 * - Tracks position health and thesis validation
 * 
 * This is the execution layer that bridges agent intelligence with market execution.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { getLatencyTracker } from './utils/LatencyTracker';
import { positions, trades, type Position, type InsertPosition } from "../drizzle/schema";
import Binance from "binance-api-node";
import type { CoinbaseOrderUpdate, CoinbaseFillEvent } from './exchanges/CoinbaseWebSocketManager';
import { ExchangeInterface } from "./exchanges";
import { LRUCache } from './utils/LRUCache';
import { OrderPlacementSafety } from './utils/OrderPlacementSafety';
import { EventEmitter } from 'events';
import { getPriceFeedManager } from './services/PriceFeedManager';
import { priceFeedService } from './services/priceFeedService';

interface PositionMonitoringState {
  trailingStopDistance: number;
  highestPrice: number; // For long positions
  lowestPrice: number; // For short positions
  partialExitStages: {
    stage1: boolean; // 33% at +1.5%
    stage2: boolean; // 33% at +3.0%
    stage3: boolean; // 34% at +5.0%
  };
  entryTime: number;
  orderId?: string; // Exchange order ID for tracking
  clientOrderId?: string; // Client-side order ID
}

export class PositionManager extends EventEmitter {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private positionStates: Map<number, PositionMonitoringState> = new Map();
  private binanceClient: ReturnType<typeof Binance> | null = null;
  private exchangeAdapter: ExchangeInterface | null = null;
  private isRunning: boolean = false;
  private paperTradingMode: boolean = true; // Default to paper trading for safety
  
  // Track order ID to position ID mapping for real-time updates (LRU-bounded)
  private orderToPositionMap: LRUCache<string, number> = new LRUCache({ maxSize: 500, ttlMs: 86400_000, name: 'orderToPositionMap' }); // 24h TTL

  // ✅ P0-2 FIX: Price cache for WebSocket integration (CRITICAL, LRU-bounded)
  private priceCache: LRUCache<string, { price: number; timestamp: number }> = new LRUCache({ maxSize: 100, ttlMs: 300_000, name: 'priceCache' }); // 5min TTL
  private priceStalenessCheckInterval: NodeJS.Timeout | null = null;

  // Phase 19: Store listener reference for cleanup on stop()
  private priceFeedHandler: ((priceData: { symbol: string; price: number; timestamp: number }) => void) | null = null;

  constructor() {
    super();
    console.log("[PositionManager] Initialized (paper trading mode)");
    
    // Start price staleness monitoring
    this.startPriceStalenessMonitoring();
    
    // ✅ Subscribe to real-time price updates from priceFeedService
    // This ensures PositionManager always has the latest prices without REST API calls
    this.subscribeToPriceFeed();
  }

  /**
   * Subscribe to priceFeedService for real-time price updates
   * This is the ONLY way PositionManager should receive price updates
   */
  private subscribeToPriceFeed(): void {
    // Phase 19: Store handler reference so we can remove it in stop()
    this.priceFeedHandler = (priceData) => {
      this.priceCache.set(priceData.symbol, {
        price: priceData.price,
        timestamp: priceData.timestamp,
      });
    };
    priceFeedService.on('price_update', this.priceFeedHandler);
    console.log('[PositionManager] Subscribed to priceFeedService for real-time price updates');
  }

  /**
   * Set the exchange adapter for real order placement
   * @param adapter Exchange adapter (BinanceAdapter or CoinbaseAdapter)
   */
  setExchangeAdapter(adapter: ExchangeInterface) {
    this.exchangeAdapter = adapter;
    console.log(`[PositionManager] Exchange adapter set: ${adapter.getExchangeName()}`);
  }

  /**
   * Enable or disable paper trading mode
   * @param enabled True for paper trading (no real orders), false for live trading
   */
  setPaperTradingMode(enabled: boolean) {
    this.paperTradingMode = enabled;
    console.log(`[PositionManager] Paper trading mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    if (!enabled) {
      console.warn('[PositionManager] ⚠️  LIVE TRADING MODE ENABLED - Real orders will be placed!');
    }
  }

  /**
   * Initialize Binance client with user's API credentials
   */
  async initializeBinanceClient(apiKey: string, apiSecret: string) {
    this.binanceClient = Binance({
      apiKey,
      apiSecret,
    });
    console.log("[PositionManager] Binance client initialized");
  }

  /**
   * Start monitoring all open positions
   * Checks every 1 second as per institutional standards
   */
  async start() {
    if (this.isRunning) {
      console.log("[PositionManager] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[PositionManager] Starting position monitoring (1-second interval)");

    // Initial load of all open positions
    await this.loadOpenPositions();

    // ✅ P1-1 FIX: Monitor every 100ms for rapid price movements (institutional standard)
    // Reduced from 1000ms to catch flash crashes and rapid volatility
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.monitorAllPositions();
      } catch (error) {
        console.error("[PositionManager] Error in monitoring loop:", error);
      }
    }, 100); // ✅ 100ms interval (10x faster than before)
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.priceStalenessCheckInterval) {
      clearInterval(this.priceStalenessCheckInterval);
      this.priceStalenessCheckInterval = null;
    }
    // Phase 19: Remove priceFeedService listener to prevent memory leak on engine restart
    if (this.priceFeedHandler) {
      priceFeedService.off('price_update', this.priceFeedHandler);
      this.priceFeedHandler = null;
    }
    this.isRunning = false;
    console.log("[PositionManager] Stopped position monitoring");
  }

  /**
   * ✅ P0-2 FIX: Update price cache from WebSocket feed
   * This method should be called by priceFeedService when new prices arrive
   */
  updatePriceFromFeed(symbol: string, price: number): void {
    this.priceCache.set(symbol, {
      price,
      timestamp: Date.now()
    });
  }

  /**
   * ✅ P0-2 FIX: Start monitoring for stale prices
   */
  private startPriceStalenessMonitoring(): void {
    this.priceStalenessCheckInterval = setInterval(() => {
      this.checkPriceFreshness();
    }, 10000); // Check every 10 seconds
  }

  /**
   * ✅ P0-2 FIX: Check if any cached prices are stale
   */
  private checkPriceFreshness(): void {
    const now = Date.now();
    for (const [symbol, data] of this.priceCache) {
      const age = now - data.timestamp;
      if (age > 10000) { // 10 seconds
        console.error(`[PositionManager] Price feed stale for ${symbol}: ${age}ms old`);
        this.emit('price_feed_stale', { symbol, age });
      }
    }
  }

  /**
   * Get all open positions from database
   * Returns positions with thesisValid=true (actively monitored)
   * @param userId Optional user ID to filter positions by user
   */
  async getOpenPositions(userId?: number): Promise<Position[]> {
    const db = await getDb();
    if (!db) {
      console.error("[PositionManager] Database not available");
      return [];
    }

    let query = db
      .select()
      .from(positions)
      .where(eq(positions.thesisValid, true));

    // Filter by user if userId is provided
    if (userId !== undefined) {
      const { and } = await import('drizzle-orm');
      query = db
        .select()
        .from(positions)
        .where(and(eq(positions.thesisValid, true), eq(positions.userId, userId)));
    }

    const openPositions = await query;
    return openPositions;
  }

  /**
   * Update a position in the database
   * @param positionId Position ID to update
   * @param updates Partial position data to update
   */
  async updatePosition(positionId: number, updates: Partial<Position>): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.error("[PositionManager] Database not available");
      return;
    }

    try {
      await db
        .update(positions)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(positions.id, positionId));

      console.log(`[PositionManager] Updated position ${positionId}`);
      
      // Emit position update event for real-time broadcasting
      this.emit('position_updated', { positionId, updates });
    } catch (error) {
      console.error(`[PositionManager] Error updating position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Load all open positions from database and initialize monitoring state
   * Restores position state after server restart for seamless recovery
   */
  async loadOpenPositions() {
    const db = await getDb();
    if (!db) {
      console.error("[PositionManager] Database not available");
      return;
    }

    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.thesisValid, true));

    console.log(`[PositionManager] 🔄 Position Recovery: Loading ${openPositions.length} open positions`);

    for (const position of openPositions) {
      if (!this.positionStates.has(position.id)) {
        const entryPrice = parseFloat(position.entryPrice.toString());
        const currentPrice = parseFloat(position.currentPrice?.toString() || position.entryPrice.toString());
        const stopLoss = parseFloat(position.stopLoss.toString());
        
        // Calculate profit percentage to restore partial exit stages
        const profitPct = position.side === 'long'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;

        // Restore partial exit stages based on current profit
        const partialExitStages = {
          stage1: profitPct >= 1.5, // 33% at +1.5%
          stage2: profitPct >= 3.0, // 33% at +3.0%
          stage3: profitPct >= 5.0, // 34% at +5.0%
        };

        this.positionStates.set(position.id, {
          trailingStopDistance: this.calculateTrailingDistance(entryPrice, stopLoss),
          highestPrice: position.side === 'long' ? Math.max(currentPrice, entryPrice) : entryPrice,
          lowestPrice: position.side === 'short' ? Math.min(currentPrice, entryPrice) : entryPrice,
          partialExitStages,
          entryTime: position.createdAt.getTime(),
        });

        console.log(
          `[PositionManager] ✅ Recovered position ${position.id}: ${position.symbol} ${position.side} ` +
          `(Entry: $${entryPrice}, Current: $${currentPrice}, P&L: ${profitPct.toFixed(2)}%, ` +
          `Stages: ${partialExitStages.stage1 ? '1' : ''}${partialExitStages.stage2 ? '2' : ''}${partialExitStages.stage3 ? '3' : ''})`
        );
      }
    }

    if (openPositions.length > 0) {
      console.log(`[PositionManager] 🎯 Recovery complete: ${openPositions.length} positions now being monitored`);
    }

    // FIX: Orphan detection — identify positions that may be stale from previous crashes
    const MAX_UNMONITORED_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    let orphanCount = 0;

    for (const position of openPositions) {
      const ageMs = now - position.createdAt.getTime();
      const lastUpdated = position.updatedAt ? now - new Date(position.updatedAt).getTime() : ageMs;

      // A position is "orphaned" if it's been open >24h and hasn't been updated recently
      // This catches positions that survived a server crash with no agent monitoring
      if (ageMs > MAX_UNMONITORED_AGE_MS && lastUpdated > MAX_UNMONITORED_AGE_MS) {
        orphanCount++;
        const entryPrice = parseFloat(position.entryPrice.toString());
        const currentPrice = parseFloat(position.currentPrice?.toString() || position.entryPrice.toString());
        const pnlPct = position.side === 'long'
          ? ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2)
          : ((entryPrice - currentPrice) / entryPrice * 100).toFixed(2);

        console.warn(
          `[PositionManager] ⚠️ ORPHAN DETECTED: Position ${position.id} — ${position.symbol} ${position.side} ` +
          `(age: ${(ageMs / 3600000).toFixed(1)}h, P&L: ${pnlPct}%, entry: $${entryPrice.toFixed(2)}) ` +
          `— this position survived a restart and may need manual review`
        );
      }
    }

    if (orphanCount > 0) {
      console.error(
        `[PositionManager] 🔴 ${orphanCount} ORPHANED POSITION(S) detected! ` +
        `These positions have been open >24h without updates. Review and close manually if needed.`
      );
      // Emit event so other systems (e.g., alert service) can act on it
      if (this instanceof EventEmitter) {
        this.emit('orphaned_positions_detected', { count: orphanCount });
      }
    }
  }

  /**
   * Monitor all open positions and execute exits when conditions are met
   * Uses batch price fetching for optimal performance
   */
  private async monitorAllPositions() {
    const db = await getDb();
    if (!db) return;

    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.thesisValid, true));

    if (openPositions.length === 0) return;

    // Batch fetch all prices at once for performance
    const symbols = Array.from(new Set(openPositions.map(p => p.symbol)));
    const priceMap = await this.getBatchPrices(symbols);

    // Collect position price updates for broadcasting
    const priceUpdates: any[] = [];

    // Monitor each position with pre-fetched prices
    for (const position of openPositions) {
      const currentPrice = priceMap.get(position.symbol);
      if (currentPrice) {
        await this.monitorPosition(position, currentPrice);
        
        // Calculate P&L for broadcasting
        const entryPrice = parseFloat(position.entryPrice.toString());
        const quantity = parseFloat(position.quantity.toString());
        const unrealizedPnl = this.calculateUnrealizedPnl(
          position.side,
          entryPrice,
          currentPrice,
          quantity
        );
        const unrealizedPnlPercent = ((unrealizedPnl / (entryPrice * quantity)) * 100);

        priceUpdates.push({
          positionId: position.id,
          symbol: position.symbol,
          side: position.side,
          entryPrice,
          currentPrice,
          quantity,
          unrealizedPnl,
          unrealizedPnlPercent,
          stopLoss: parseFloat(position.stopLoss.toString()),
          takeProfit: parseFloat(position.takeProfit.toString()),
          timestamp: Date.now(),
        });
      }
    }

    // Broadcast position price updates to WebSocket clients
    if (priceUpdates.length > 0) {
      this.emit('position_prices', priceUpdates);
    }
  }

  /**
   * Monitor a single position and check exit conditions
   * @param position Position to monitor
   * @param currentPrice Pre-fetched current price (from batch fetch)
   */
  private async monitorPosition(position: Position, currentPrice: number) {
    const db = await getDb();
    if (!db) return;

    const state = this.positionStates.get(position.id);
    if (!state) {
      console.warn(`[PositionManager] No state found for position ${position.id}`);
      return;
    }

    // Calculate position health metrics
    const entryPrice = parseFloat(position.entryPrice.toString());
    const deviation = this.calculatePriceDeviation(position, currentPrice);
    const unrealizedPnl = this.calculateUnrealizedPnl(
      position.side,
      entryPrice,
      currentPrice,
      parseFloat(position.quantity.toString())
    );

    // Update position current price and health metrics in database
    await db
      .update(positions)
      .set({
        currentPrice: currentPrice.toString(),
        unrealizedPnl: unrealizedPnl.toString(),
        currentDeviation: deviation.toString(),
        lastRevalidation: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, position.id));

    // Check exit conditions
    const stopLoss = parseFloat(position.stopLoss.toString());
    const takeProfit = parseFloat(position.takeProfit.toString());
    const quantity = parseFloat(position.quantity.toString());

    // 0. Check thesis invalidation based on price path deviation (early exit)
    if (deviation > 0.15) { // 15% deviation from expected path
      console.log(`[PositionManager] Thesis invalidated for position ${position.id} (deviation: ${(deviation * 100).toFixed(1)}%)`);
      await this.executeExit(position, currentPrice, quantity, "thesis_invalidated");
      return;
    }

    // 1. Check stop-loss
    if (this.isStopLossHit(position.side, currentPrice, stopLoss)) {
      console.log(`[PositionManager] Stop-loss hit for position ${position.id}`);
      await this.executeExit(position, currentPrice, quantity, "stop_loss");
      return;
    }

    // 2. Check take-profit
    if (this.isTakeProfitHit(position.side, currentPrice, takeProfit)) {
      console.log(`[PositionManager] Take-profit hit for position ${position.id}`);
      await this.executeExit(position, currentPrice, quantity, "take_profit");
      return;
    }

    // 3. Update trailing stop if in profit
    if (this.isInProfit(position.side, currentPrice, entryPrice)) {
      await this.updateTrailingStop(position, currentPrice, state);
    }

    // 4. Check partial profit taking stages
    await this.checkPartialProfitTaking(position, currentPrice, entryPrice, quantity, state);

    // 5. Check time-based exit rule (if held >4 hours and PnL ≤ 0%)
    const holdTime = Date.now() - state.entryTime;
    const fourHours = 4 * 60 * 60 * 1000;
    if (holdTime > fourHours) {
      const pnlPercent = this.calculatePnlPercent(position.side, entryPrice, currentPrice);
      if (pnlPercent <= 0) {
        console.log(`[PositionManager] Time-based exit for position ${position.id} (held >4h, PnL ≤ 0%)`);
        await this.executeExit(position, currentPrice, quantity, "time_based_exit");
        return;
      }
    }
  }

  /**
   * Execute position exit (full or partial)
   */
  private async executeExit(
    position: Position,
    exitPrice: number,
    quantity: number,
    exitReason: string
  ) {
    const db = await getDb();
    if (!db) return;

    // Skip real order execution in paper trading mode
    if (this.paperTradingMode) {
      console.log(`[PositionManager] Paper trading mode - simulating exit for position ${position.id}`);
      await this.recordExitInDatabase(db, position, exitPrice, quantity, exitReason);
      return;
    }

    // Check if exchange adapter is available for live trading
    if (!this.exchangeAdapter) {
      console.error(`[PositionManager] Cannot execute exit - no exchange adapter configured`);
      return;
    }

    try {
      // Execute market order via exchange adapter
      const side = position.side === "long" ? "sell" : "buy";
      const order = await this.exchangeAdapter.placeMarketOrder({
        symbol: position.symbol,
        side,
        type: "market",
        quantity,
      });

      console.log(`[PositionManager] Executed ${side} order via ${this.exchangeAdapter.getExchangeName()}:`, order);

      await this.recordExitInDatabase(db, position, exitPrice, quantity, exitReason);
    } catch (error) {
      console.error(`[PositionManager] Error executing exit for position ${position.id}:`, error);
    }
  }

  /**
   * Record exit in database (shared by paper and live trading)
   */
  private async recordExitInDatabase(
    db: any,
    position: Position,
    exitPrice: number,
    quantity: number,
    exitReason: string
  ) {
    // Calculate final PnL
    const entryPrice = parseFloat(position.entryPrice.toString());
    const pnl = this.calculateUnrealizedPnl(position.side, entryPrice, exitPrice, quantity);

    // Update position as closed with full exit data
    await db
      .update(positions)
      .set({
        status: 'closed',
        exitPrice: exitPrice.toString(),
        exitTime: new Date(),
        realizedPnl: pnl.toString(),
        exitReason,
        thesisValid: false,
        currentPrice: exitPrice.toString(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, position.id));

    // Update trade record
    await db
      .update(trades)
      .set({
        exitPrice: exitPrice.toString(),
        exitTime: new Date(),
        status: "closed",
        pnl: pnl.toString(),
        exitReason,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, position.tradeId));

    // Remove from monitoring
    this.positionStates.delete(position.id);

    console.log(`[PositionManager] Position ${position.id} closed. PnL: ${pnl.toFixed(2)} USDT`);
  }

  /**
   * Record partial exit in database (shared by paper and live trading)
   */
  private async recordPartialExitInDatabase(
    db: any,
    position: Position,
    exitQuantity: number,
    stage: string
  ) {
    const totalQuantity = parseFloat(position.quantity.toString());
    const remainingQuantity = totalQuantity - exitQuantity;

    // Update position quantity
    await db
      .update(positions)
      .set({
        quantity: remainingQuantity.toString(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, position.id));

    console.log(
      `[PositionManager] Partial exit ${stage}: ${exitQuantity.toFixed(8)} (${((exitQuantity / totalQuantity) * 100).toFixed(0)}%)`
    );
  }

  /**
   * Execute partial exit (scale out)
   */
  private async executePartialExit(
    position: Position,
    exitPrice: number,
    exitPercent: number,
    stage: string
  ) {
    const db = await getDb();
    if (!db) return;

    const totalQuantity = parseFloat(position.quantity.toString());
    const exitQuantity = totalQuantity * exitPercent;

    // ✅ P2-2 FIX: Validate partial exit quantity against exchange minimum order size
    const minOrderSize = this.getMinimumOrderSize(position.symbol);
    const orderValue = exitQuantity * exitPrice;
    
    if (orderValue < minOrderSize) {
      console.warn(
        `[PositionManager] Partial exit ${stage} skipped for position ${position.id}: ` +
        `Order value $${orderValue.toFixed(2)} below minimum $${minOrderSize} ` +
        `(quantity: ${exitQuantity}, price: $${exitPrice})`
      );
      return;
    }

    // Validate remaining position will also meet minimum size
    const remainingQuantity = totalQuantity - exitQuantity;
    const remainingValue = remainingQuantity * exitPrice;
    
    if (remainingValue < minOrderSize && remainingValue > 0) {
      console.warn(
        `[PositionManager] Partial exit ${stage} skipped for position ${position.id}: ` +
        `Remaining position value $${remainingValue.toFixed(2)} would be below minimum $${minOrderSize}`
      );
      return;
    }

    // Skip real order execution in paper trading mode
    if (this.paperTradingMode) {
      console.log(`[PositionManager] Paper trading mode - simulating partial exit ${stage} for position ${position.id}`);
      await this.recordPartialExitInDatabase(db, position, exitQuantity, stage);
      return;
    }

    // Check if exchange adapter is available for live trading
    if (!this.exchangeAdapter) {
      console.error(`[PositionManager] Cannot execute partial exit - no exchange adapter configured`);
      return;
    }

    try {
      // Execute market order via exchange adapter
      const side = position.side === "long" ? "sell" : "buy";
      const order = await this.exchangeAdapter.placeMarketOrder({
        symbol: position.symbol,
        side,
        type: "market",
        quantity: exitQuantity,
      });

      console.log(`[PositionManager] Executed partial ${side} (${(exitPercent * 100).toFixed(0)}%) via ${this.exchangeAdapter.getExchangeName()}:`, order);

      await this.recordPartialExitInDatabase(db, position, exitQuantity, stage);
    } catch (error) {
      console.error(`[PositionManager] Error executing partial exit:`, error);
    }
  }

  /**
   * Get minimum order size for a symbol (in USD value)
   * Different exchanges have different minimums
   */
  private getMinimumOrderSize(symbol: string): number {
    // Common exchange minimums:
    // Binance: $10 USD
    // Coinbase: $10 USD
    // Most exchanges: $5-$10 USD
    
    // Use conservative $10 minimum for all symbols
    return 10;
  }

  /**
   * Update trailing stop as price moves favorably
   */
  private async updateTrailingStop(position: Position, currentPrice: number, state: PositionMonitoringState) {
    const db = await getDb();
    if (!db) return;

    const currentStop = parseFloat(position.stopLoss.toString());

    if (position.side === "long") {
      // Update highest price seen
      if (currentPrice > state.highestPrice) {
        state.highestPrice = currentPrice;

        // Calculate new trailing stop
        const newStop = currentPrice - state.trailingStopDistance;

        // Only move stop up, never down
        if (newStop > currentStop) {
          await db
            .update(positions)
            .set({
              stopLoss: newStop.toString(),
              updatedAt: new Date(),
            })
            .where(eq(positions.id, position.id));

          console.log(
            `[PositionManager] Trailing stop updated for position ${position.id}: ${currentStop.toFixed(2)} → ${newStop.toFixed(2)}`
          );
        }
      }
    } else {
      // Short position
      if (currentPrice < state.lowestPrice) {
        state.lowestPrice = currentPrice;

        const newStop = currentPrice + state.trailingStopDistance;

        // Only move stop down, never up
        if (newStop < currentStop) {
          await db
            .update(positions)
            .set({
              stopLoss: newStop.toString(),
              updatedAt: new Date(),
            })
            .where(eq(positions.id, position.id));

          console.log(
            `[PositionManager] Trailing stop updated for position ${position.id}: ${currentStop.toFixed(2)} → ${newStop.toFixed(2)}`
          );
        }
      }
    }
  }

  /**
   * Check and execute partial profit taking stages
   */
  private async checkPartialProfitTaking(
    position: Position,
    currentPrice: number,
    entryPrice: number,
    quantity: number,
    state: PositionMonitoringState
  ) {
    const pnlPercent = this.calculatePnlPercent(position.side, entryPrice, currentPrice);

    // Stage 1: +1.5% profit → sell 33%
    if (pnlPercent >= 1.5 && !state.partialExitStages.stage1) {
      await this.executePartialExit(position, currentPrice, 0.33, "stage1");
      state.partialExitStages.stage1 = true;
    }

    // Stage 2: +3.0% profit → sell 33%
    if (pnlPercent >= 3.0 && !state.partialExitStages.stage2) {
      await this.executePartialExit(position, currentPrice, 0.33, "stage2");
      state.partialExitStages.stage2 = true;
    }

    // Stage 3: +5.0% profit → sell remaining 34%
    if (pnlPercent >= 5.0 && !state.partialExitStages.stage3) {
      await this.executePartialExit(position, currentPrice, 0.34, "stage3");
      state.partialExitStages.stage3 = true;
      // This will close the position completely
      await this.executeExit(position, currentPrice, 0, "partial_exit_complete");
    }
  }

  /**
   * ✅ FIXED: Get current market price from priceFeedService cache ONLY
   * NO REST API calls - all prices come from WebSocket feed via priceFeedService
   * 
   * Architecture:
   * 1. Exchange WebSocket → priceFeedService.updatePrice()
   * 2. priceFeedService emits 'price_update' event
   * 3. PositionManager subscribes and updates local cache
   * 4. This method reads from local cache (0ms latency)
   */
  private async getCurrentPrice(symbol: string): Promise<number | null> {
    // ✅ ONLY source: Local price cache (fed by priceFeedService subscription)
    const cached = this.priceCache.get(symbol);
    if (cached) {
      // Check if price is fresh (< 30 seconds old - increased tolerance)
      const age = Date.now() - cached.timestamp;
      if (age < 30000) {
        return cached.price;
      } else {
        console.warn(`[PositionManager] Cached price for ${symbol} is stale (${age}ms old)`);
      }
    }

    // ✅ Fallback: Check priceFeedService directly (in case subscription missed it)
    const priceFeedCached = priceFeedService.getLatestPrice(symbol);
    if (priceFeedCached && priceFeedCached.price > 0) {
      // Update local cache
      this.priceCache.set(symbol, {
        price: priceFeedCached.price,
        timestamp: priceFeedCached.timestamp,
      });
      return priceFeedCached.price;
    }

    // NO REST API fallback - return null if no cached price
    console.warn(`[PositionManager] No cached price available for ${symbol}`);
    return null;
  }

  /**
   * ✅ P1-2 FIX: Batch fetch prices with multi-source failover
   * Priority: Binance → Kraken → CoinGecko
   * Parallel fetching: 500ms for 10 symbols (vs 5000ms sequential)
   */
  private async getBatchPrices(symbols: string[]): Promise<Map<string, number>> {
    const priceFeedManager = getPriceFeedManager();
    
    // ✅ P2-3 FIX: Parallel price fetching using Promise.all()
    // Reduces fetch time from 5000ms to 500ms for 10 symbols
    const priceResults = await priceFeedManager.getBatchPrices(symbols);
    
    const priceMap = new Map<string, number>();
    for (const [symbol, result] of priceResults.entries()) {
      priceMap.set(symbol, result.price);
    }
    
    return priceMap;
  }

  /**
   * Fallback method for single symbol price fetch (legacy, now handled by PriceFeedManager)
   */
  private async getFallbackPrice(symbol: string): Promise<number | null> {
    try {
      const price = await this.getCoinGeckoPrice(symbol);
      return price;
    } catch (error) {
      console.error(`[PositionManager] Fallback price fetch failed for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch price from CoinGecko API (fallback source)
   */
  private async getCoinGeckoPrice(symbol: string): Promise<number | null> {
    try {
      // Map common symbols to CoinGecko IDs
      const coinGeckoMap: Record<string, string> = {
        'BTC/USDT': 'bitcoin',
        'ETH/USDT': 'ethereum',
        'BNB/USDT': 'binancecoin',
        'SOL/USDT': 'solana',
        'XRP/USDT': 'ripple',
        'ADA/USDT': 'cardano',
        'DOGE/USDT': 'dogecoin',
        'MATIC/USDT': 'matic-network',
        'DOT/USDT': 'polkadot',
        'AVAX/USDT': 'avalanche-2',
      };

      const coinId = coinGeckoMap[symbol];
      if (!coinId) {
        console.warn(`[PositionManager] No CoinGecko mapping for ${symbol}`);
        return null;
      }

      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      const price = data[coinId]?.usd;
      
      if (price) {
        console.log(`[PositionManager] CoinGecko price for ${symbol}: $${price}`);
        return price;
      }
      
      return null;
    } catch (error) {
      console.error(`[PositionManager] CoinGecko price fetch failed for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Helper: Calculate trailing stop distance (1.5x ATR or 1.5% of price)
   */
  private calculateTrailingDistance(entryPrice: number, initialStopLoss: number): number {
    // Use initial stop distance as trailing distance
    return Math.abs(entryPrice - initialStopLoss);
  }

  /**
   * Helper: Check if stop-loss is hit
   */
  private isStopLossHit(side: string, currentPrice: number, stopLoss: number): boolean {
    if (side === "long") {
      return currentPrice <= stopLoss;
    } else {
      return currentPrice >= stopLoss;
    }
  }

  /**
   * Helper: Check if take-profit is hit
   */
  private isTakeProfitHit(side: string, currentPrice: number, takeProfit: number): boolean {
    if (side === "long") {
      return currentPrice >= takeProfit;
    } else {
      return currentPrice <= takeProfit;
    }
  }

  /**
   * Helper: Check if position is in profit
   */
  private isInProfit(side: string, currentPrice: number, entryPrice: number): boolean {
    if (side === "long") {
      return currentPrice > entryPrice;
    } else {
      return currentPrice < entryPrice;
    }
  }

  /**
   * Helper: Calculate unrealized PnL
   */
  private calculateUnrealizedPnl(
    side: string,
    entryPrice: number,
    currentPrice: number,
    quantity: number
  ): number {
    if (side === "long") {
      return (currentPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - currentPrice) * quantity;
    }
  }

  /**
   * Helper: Calculate PnL percentage
   */
  private calculatePnlPercent(side: string, entryPrice: number, currentPrice: number): number {
    if (side === "long") {
      return ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - currentPrice) / entryPrice) * 100;
    }
  }

  /**
   * Helper: Calculate price deviation from expected path
   * Returns 0-1 value representing how far price has deviated from the expected trajectory
   */
  private calculatePriceDeviation(position: Position, currentPrice: number): number {
    try {
      const expectedPath = position.expectedPath as any;
      if (!expectedPath || !Array.isArray(expectedPath.path)) {
        return 0; // No expected path, can't calculate deviation
      }

      const entryPrice = parseFloat(position.entryPrice.toString());
      const holdTime = Date.now() - position.createdAt.getTime();
      const holdMinutes = holdTime / (60 * 1000);

      // Find the expected price at current hold time
      let expectedPrice = entryPrice;
      for (const point of expectedPath.path) {
        if (point.minutes <= holdMinutes) {
          expectedPrice = point.price;
        } else {
          break;
        }
      }

      // Calculate deviation as percentage difference from expected price
      const deviation = Math.abs(currentPrice - expectedPrice) / expectedPrice;
      
      return Math.min(deviation, 1.0); // Cap at 100% deviation
    } catch (error) {
      console.error(`[PositionManager] Error calculating price deviation:`, error);
      return 0;
    }
  }

  /**
   * Create a new position from agent signal with latency tracking
   */
  async createPosition(
    userId: number,
    tradeId: number,
    symbol: string,
    side: "long" | "short",
    entryPrice: number,
    quantity: number,
    stopLoss: number,
    takeProfit: number,
    expectedPath: any,
    latencyTraceId?: string
  ): Promise<number | null> {
    const db = await getDb();
    if (!db) return null;

    // Get latency tracker
    const latencyTracker = getLatencyTracker();

    try {
      // Track position sizing stage
      if (latencyTraceId) {
        latencyTracker.startStage(latencyTraceId, 'positionSizing');
      }

      // Calculate position size (already done, but track it)
      const positionValue = entryPrice * quantity;

      if (latencyTraceId) {
        latencyTracker.endStage(latencyTraceId, 'positionSizing');
        latencyTracker.startStage(latencyTraceId, 'orderPreparation');
      }

      // Generate client order ID for tracking
      const clientOrderId = `SEER-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Prepare order (database insert)
      const [result] = await db.insert(positions).values({
        userId,
        tradeId,
        symbol,
        side,
        entryPrice: entryPrice.toString(),
        currentPrice: entryPrice.toString(),
        quantity: quantity.toString(),
        stopLoss: stopLoss.toString(),
        takeProfit: takeProfit.toString(),
        expectedPath,
        thesisValid: true,
        unrealizedPnl: "0",
        clientOrderId,
        orderStatus: "PENDING",
      });

      const positionId = result.insertId;

      if (latencyTraceId) {
        latencyTracker.endStage(latencyTraceId, 'orderPreparation');
      }

      let exchangeOrderId: string | undefined;

      // Place real order if not in paper trading mode
      if (!this.paperTradingMode && this.exchangeAdapter) {
        try {
          // Safety check before placing order
          const safetyCheck = await OrderPlacementSafety.canPlaceOrder(
            symbol,
            quantity,
            entryPrice,
            userId
          );

          if (!safetyCheck.allowed) {
            const errorMsg = `Order placement blocked: ${safetyCheck.reason}`;
            console.error(`[PositionManager] ${errorMsg}`);
            
            // Mark position as failed
            await db.update(positions)
              .set({ 
                orderStatus: 'FAILED',
                thesisValid: false,
              })
              .where(eq(positions.id, positionId));

            if (latencyTraceId) {
              latencyTracker.failTrace(latencyTraceId, errorMsg);
            }

            throw new Error(errorMsg);
          }

          if (latencyTraceId) {
            latencyTracker.startStage(latencyTraceId, 'networkTransmission');
          }

          console.log(`[PositionManager] Placing REAL ${side} order for ${symbol}: ${quantity} @ ${entryPrice}`);

          // Place market order with retry logic
          const orderResult = await OrderPlacementSafety.executeWithRetry(async () => {
            return await this.exchangeAdapter!.placeMarketOrder({
              symbol,
              side: side === 'long' ? 'buy' : 'sell',
              type: 'market',
              quantity,
            });
          });

          exchangeOrderId = orderResult.orderId;
          console.log(`[PositionManager] Order placed successfully: ${exchangeOrderId}`);

          if (latencyTraceId) {
            latencyTracker.endStage(latencyTraceId, 'networkTransmission');
            latencyTracker.startStage(latencyTraceId, 'exchangeProcessing');
            latencyTracker.endStage(latencyTraceId, 'exchangeProcessing');
            latencyTracker.startStage(latencyTraceId, 'confirmation');
            latencyTracker.endStage(latencyTraceId, 'confirmation');
            latencyTracker.completeTrace(latencyTraceId, {
              orderId: exchangeOrderId,
              price: entryPrice,
              quantity,
            });
          }

          // Update position with exchange order ID
          await db.update(positions)
            .set({ 
              orderId: exchangeOrderId,
              orderStatus: 'OPEN',
            })
            .where(eq(positions.id, positionId));

        } catch (error) {
          console.error('[PositionManager] Failed to place real order:', error);
          // Mark position as failed
          await db.update(positions)
            .set({ 
              orderStatus: 'FAILED',
              thesisValid: false,
            })
            .where(eq(positions.id, positionId));

          if (latencyTraceId) {
            latencyTracker.failTrace(latencyTraceId, error instanceof Error ? error.message : 'Order placement failed');
          }

          throw error;
        }
      } else {
        // Paper trading mode - simulate exchange execution
        console.log(`[PositionManager] PAPER TRADING: Simulating ${side} order for ${symbol}: ${quantity} @ ${entryPrice}`);

        if (latencyTraceId) {
          latencyTracker.startStage(latencyTraceId, 'networkTransmission');
          // Simulate network delay (0-2ms)
          await new Promise(resolve => setTimeout(resolve, Math.random() * 2));
          latencyTracker.endStage(latencyTraceId, 'networkTransmission');

          latencyTracker.startStage(latencyTraceId, 'exchangeProcessing');
          // Simulate exchange processing (1-5ms)
          await new Promise(resolve => setTimeout(resolve, 1 + Math.random() * 4));
          latencyTracker.endStage(latencyTraceId, 'exchangeProcessing');

          latencyTracker.startStage(latencyTraceId, 'confirmation');
          // Confirmation is instant in paper trading
          latencyTracker.endStage(latencyTraceId, 'confirmation');

          // Complete the trace
          latencyTracker.completeTrace(latencyTraceId, {
            orderId: positionId.toString(),
            price: entryPrice,
            quantity,
          });
        }
      }

      // Initialize monitoring state
      this.positionStates.set(positionId, {
        trailingStopDistance: this.calculateTrailingDistance(entryPrice, stopLoss),
        highestPrice: entryPrice,
        lowestPrice: entryPrice,
        partialExitStages: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
        entryTime: Date.now(),
        clientOrderId,
      });

      // Register client order ID for WebSocket tracking
      this.orderToPositionMap.set(clientOrderId, positionId);

      console.log(`[PositionManager] Created position ${positionId} for ${symbol}`);
      return positionId;
    } catch (error) {
      if (latencyTraceId) {
        latencyTracker.failTrace(latencyTraceId, error instanceof Error ? error.message : 'Unknown error');
      }
      console.error("[PositionManager] Error creating position:", error);
      return null;
    }
  }

  /**
   * Register order ID for a position (for real-time tracking)
   */
  registerOrderForPosition(positionId: number, orderId: string, clientOrderId?: string) {
    this.orderToPositionMap.set(orderId, positionId);
    if (clientOrderId) {
      this.orderToPositionMap.set(clientOrderId, positionId);
    }

    // Update position state with order IDs
    const state = this.positionStates.get(positionId);
    if (state) {
      state.orderId = orderId;
      state.clientOrderId = clientOrderId;
    }

    console.log(`[PositionManager] Registered order ${orderId} for position ${positionId}`);
  }

  /**
   * Handle real-time order update from WebSocket
   * Updates position status based on order status changes
   */
  async handleOrderUpdate(orderUpdate: CoinbaseOrderUpdate) {
    const db = await getDb();
    if (!db) return;

    // Find position by order ID or client order ID
    const positionId = this.orderToPositionMap.get(orderUpdate.order_id) || 
                       this.orderToPositionMap.get(orderUpdate.client_order_id);

    if (!positionId) {
      console.log(`[PositionManager] No position found for order ${orderUpdate.order_id}`);
      return;
    }

    console.log(`[PositionManager] Order update for position ${positionId}: ${orderUpdate.status}`);

    // Update position based on order status
    switch (orderUpdate.status) {
      case 'FILLED':
        // Order fully filled - position is now active
        const avgPrice = parseFloat(orderUpdate.avg_price);
        const totalFees = parseFloat(orderUpdate.total_fees);
        
        await db
          .update(positions)
          .set({
            entryPrice: avgPrice.toString(),
            currentPrice: avgPrice.toString(),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, positionId));

        console.log(`[PositionManager] Position ${positionId} filled at ${avgPrice} (fees: ${totalFees})`);
        break;

      case 'CANCELLED':
      case 'EXPIRED':
      case 'FAILED':
        // Order failed - invalidate position
        await db
          .update(positions)
          .set({
            thesisValid: false,
            updatedAt: new Date(),
          })
          .where(eq(positions.id, positionId));

        // Remove from monitoring
        this.positionStates.delete(positionId);
        this.orderToPositionMap.delete(orderUpdate.order_id);
        if (orderUpdate.client_order_id) {
          this.orderToPositionMap.delete(orderUpdate.client_order_id);
        }

        console.log(`[PositionManager] Position ${positionId} invalidated due to order ${orderUpdate.status}`);
        break;

      case 'OPEN':
        // Order is open, waiting for fill
        console.log(`[PositionManager] Position ${positionId} order is OPEN`);
        break;

      default:
        console.log(`[PositionManager] Unknown order status: ${orderUpdate.status}`);
    }
  }

  /**
   * Handle real-time fill event from WebSocket
   * Updates position with actual fill price and tracks partial fills
   */
  async handleFill(fillEvent: CoinbaseFillEvent) {
    const db = await getDb();
    if (!db) return;

    // Find position by order ID
    const positionId = this.orderToPositionMap.get(fillEvent.order_id) || 
                       this.orderToPositionMap.get(fillEvent.client_order_id);

    if (!positionId) {
      console.log(`[PositionManager] No position found for fill ${fillEvent.trade_id}`);
      return;
    }

    const fillPrice = parseFloat(fillEvent.price);
    const fillSize = parseFloat(fillEvent.size);
    const commission = parseFloat(fillEvent.commission);

    console.log(
      `[PositionManager] Fill for position ${positionId}: ${fillSize} @ ${fillPrice} (${fillEvent.liquidity_indicator}, fee: ${commission})`
    );

    // Get current position
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position) {
      console.error(`[PositionManager] Position ${positionId} not found in database`);
      return;
    }

    // Update position with fill information
    // For partial fills, we might want to track cumulative average price
    await db
      .update(positions)
      .set({
        entryPrice: fillPrice.toString(),
        currentPrice: fillPrice.toString(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, positionId));

    // Update position state with actual entry price
    const state = this.positionStates.get(positionId);
    if (state) {
      state.highestPrice = fillPrice;
      state.lowestPrice = fillPrice;
    }

    console.log(`[PositionManager] Position ${positionId} updated with fill price ${fillPrice}`);
  }
}

// Singleton instance
export const positionManager = new PositionManager();
