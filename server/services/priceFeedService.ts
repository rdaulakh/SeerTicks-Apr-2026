// Phase 22: Cached AuditLogger import (ESM-compatible)
let _auditLoggerCache: any = null;
async function _getAuditLoggerModule() {
  if (!_auditLoggerCache) _auditLoggerCache = await import("./AuditLogger");
  return _auditLoggerCache;
}

/**
 * Price Feed Service - SINGLE SOURCE OF TRUTH
 * Real-time price feed management with WebSocket integration
 * 
 * Architecture:
 * 1. Exchange WebSocket → priceFeedService.updatePrice() → cache + emit 'price_update'
 * 2. All services subscribe to 'price_update' event (NO REST API calls for prices)
 * 3. Frontend receives prices via WebSocket broadcast (every tick)
 * 
 * This is the ONLY place prices should be fetched from.
 * Services should NEVER call exchange APIs directly for current price.
 */

import { EventEmitter } from 'events';
import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  source: 'websocket' | 'rest' | 'cache';
  volume24h?: number;
  change24h?: number;
}

export interface PriceFeedConfig {
  updateInterval: number; // milliseconds
  cacheExpiry: number; // milliseconds
  enableWebSocket: boolean;
}

class PriceFeedService extends EventEmitter {
  private priceCache: Map<string, PriceData> = new Map();
  // Phase 40: Price history buffer for trend validation (last 5 minutes, sampled every 5s)
  private priceHistory: Map<string, { price: number; time: number }[]> = new Map();
  private lastHistorySample: Map<string, number> = new Map();
  private static readonly HISTORY_SAMPLE_INTERVAL = 5000; // 5 seconds
  private static readonly HISTORY_MAX_AGE = 300000; // 5 minutes
  private config: PriceFeedConfig;
  // Phase 19: Allow up to 25 listeners — multiple services subscribe to price_update
  
  // Symbol normalization mapping for cross-exchange compatibility
  // Maps various formats to canonical format (e.g., BTC-USD)
  private symbolAliases: Map<string, string> = new Map([
    // BTC aliases
    ['BTCUSDT', 'BTC-USD'],
    ['BTC/USDT', 'BTC-USD'],
    ['BTC/USD', 'BTC-USD'],
    ['BTCUSD', 'BTC-USD'],
    // ETH aliases
    ['ETHUSDT', 'ETH-USD'],
    ['ETH/USDT', 'ETH-USD'],
    ['ETH/USD', 'ETH-USD'],
    ['ETHUSD', 'ETH-USD'],
    // SOL aliases
    ['SOLUSDT', 'SOL-USD'],
    ['SOL/USDT', 'SOL-USD'],
    ['SOL/USD', 'SOL-USD'],
    ['SOLUSD', 'SOL-USD'],
    // XRP aliases
    ['XRPUSDT', 'XRP-USD'],
    ['XRP/USDT', 'XRP-USD'],
    ['XRP/USD', 'XRP-USD'],
    ['XRPUSD', 'XRP-USD'],
    // BNB aliases
    ['BNBUSDT', 'BNB-USD'],
    ['BNB/USDT', 'BNB-USD'],
    ['BNB/USD', 'BNB-USD'],
    ['BNBUSD', 'BNB-USD'],
    // DOGE aliases
    ['DOGEUSDT', 'DOGE-USD'],
    ['DOGE/USDT', 'DOGE-USD'],
    ['DOGE/USD', 'DOGE-USD'],
    ['DOGEUSD', 'DOGE-USD'],
    // ADA aliases
    ['ADAUSDT', 'ADA-USD'],
    ['ADA/USDT', 'ADA-USD'],
    ['ADA/USD', 'ADA-USD'],
    ['ADAUSD', 'ADA-USD'],
  ]);

  /**
   * Normalize symbol to canonical format (e.g., BTC-USD)
   * Handles various exchange formats: BTCUSDT, BTC/USDT, BTC/USD, etc.
   */
  private normalizeSymbol(symbol: string): string {
    // Check if we have a direct alias mapping
    const alias = this.symbolAliases.get(symbol.toUpperCase());
    if (alias) {
      return alias;
    }
    
    // If already in canonical format (XXX-USD), return as-is
    if (symbol.includes('-USD')) {
      return symbol;
    }
    
    // Return original if no normalization needed
    return symbol;
  }
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private io: SocketIOServer | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<PriceFeedConfig>) {
    super();
    this.setMaxListeners(25); // Phase 19: Multiple services subscribe to price_update
    this.config = {
      updateInterval: 1000, // 1 second
      cacheExpiry: 30000, // 30 seconds - increased to prevent stale price issues during position queries
      enableWebSocket: true,
      ...config,
    };
  }

  /**
   * Start the price feed service
   */
  start(): void {
    if (this.isRunning) {
      console.log('[PriceFeedService] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[PriceFeedService] Starting price feed service');

    // Start periodic cache cleanup
    this.updateInterval = setInterval(() => {
      this.cleanStaleCache();
    }, this.config.updateInterval);
  }

  /**
   * Stop the price feed service
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    console.log('[PriceFeedService] Stopped');
  }

  /**
   * Update price from external source (WebSocket, REST API, etc.)
   * This is the ONLY entry point for price updates in the entire system.
   * 
   * Flow:
   * 1. Exchange WebSocket receives tick → calls updatePrice()
   * 2. Price is cached and 'price_update' event is emitted
   * 3. All subscribed services receive the update immediately (0ms latency)
   * 4. Frontend WebSocket clients receive the update (if broadcasting enabled)
   */
  updatePrice(
    symbol: string,
    price: number,
    source: 'websocket' | 'rest' | 'cache' = 'websocket',
    metadata?: { volume24h?: number; change24h?: number }
  ): void {
    // Skip invalid prices
    if (!price || price <= 0 || isNaN(price)) {
      return;
    }

    const now = Date.now();
    // Preserve existing 24h metadata if new update doesn't provide it
    // (PriceFabric consensus ticks don't carry 24h stats — only exchange tickers do)
    const existing = this.priceCache.get(symbol);
    const priceData: PriceData = {
      symbol,
      price,
      timestamp: now,
      source,
      volume24h: metadata?.volume24h ?? existing?.volume24h,
      change24h: metadata?.change24h ?? existing?.change24h,
    };

    // Update cache
    this.priceCache.set(symbol, priceData);

    // Phase 40: Sample price history for trend validation (every 5s to avoid memory bloat)
    const lastSample = this.lastHistorySample.get(symbol) || 0;
    if (now - lastSample >= PriceFeedService.HISTORY_SAMPLE_INTERVAL) {
      let history = this.priceHistory.get(symbol);
      if (!history) { history = []; this.priceHistory.set(symbol, history); }
      history.push({ price, time: now });
      // Trim entries older than 5 minutes
      const cutoff = now - PriceFeedService.HISTORY_MAX_AGE;
      while (history.length > 0 && history[0].time < cutoff) history.shift();
      this.lastHistorySample.set(symbol, now);
    }

    // Emit price update event IMMEDIATELY for all subscribers
    // This is the core of the real-time price feed - NO BATCHING
    this.emit('price_update', priceData);
    
    // Phase 42: Reduced logging from every 100 to every 5000 ticks to reduce memory pressure
    if (this.tickCount % 5000 === 0) {
      console.log(`[PriceFeedService] 💰 Price tick #${this.tickCount}: ${symbol} = $${price.toFixed(5)} (source: ${source})`);
    }

    // Broadcast to frontend WebSocket clients IMMEDIATELY (no interval batching)
    if (this.io && source === 'websocket') {
      // Broadcast to all clients
      this.io.emit('price_tick', priceData);
      // Also broadcast to symbol-specific room
      this.io.to(symbol).emit('price_tick', priceData);
    }

    // Track metrics
    this.tickCount++;
    this.lastTickTime = now;

    // Phase 22: Record tick for audit heartbeat (proves WebSocket is flowing 24/7)
    try {
      _getAuditLoggerModule().then(m => m.getAuditLogger().recordTick(symbol, price, source)).catch(() => {});
    } catch { /* AuditLogger may not be initialized yet */ }

    // Phase 11B: Notify PositionGuardian that price data is flowing
    // This feeds the dead man's switch — if this stops, guardian emergency-exits positions
    if (this.tickCount % 10 === 0) { // Every 10th tick to avoid overhead
      import('./PositionGuardian').then(({ getPositionGuardian }) => {
        getPositionGuardian().onPriceTick();
      }).catch(() => {});
    }

    // FIX: Update health state so health endpoint shows real tick count
    // Only update every 100 ticks to avoid overhead
    if (this.tickCount % 100 === 0) {
      import('../routers/healthRouter').then(({ updateHealthState }) => {
        updateHealthState('priceFeed', {
          connected: true,
          lastTick: now,
          tickCount: this.tickCount,
        });
        // Phase 11 Fix 11: Also update WebSocket health — was showing "down"
        // while receiving 47 ticks/sec because CoinbasePublicWebSocket never called updateHealthState.
        // priceFeedService is the single funnel for ALL price data regardless of provider.
        updateHealthState('websocket', {
          connected: true,
          lastPing: now,
          provider: source || 'unknown',
        });
      }).catch(() => {}); // Silent fail — health reporting is non-critical
    }
  }

  // Metrics for monitoring
  private tickCount: number = 0;
  private lastTickTime: number = 0;

  /**
   * Get tick metrics for monitoring
   */
  getTickMetrics(): { tickCount: number; lastTickTime: number; ticksPerSecond: number } {
    const now = Date.now();
    const elapsed = (now - this.lastTickTime) / 1000;
    return {
      tickCount: this.tickCount,
      lastTickTime: this.lastTickTime,
      ticksPerSecond: elapsed > 0 ? Math.round(this.tickCount / elapsed) : 0,
    };
  }

  /**
   * Get latest price for a symbol
   * Automatically normalizes symbol format for cross-exchange compatibility
   */
  getLatestPrice(symbol: string): PriceData | undefined {
    // Try original symbol first
    let cached = this.priceCache.get(symbol);
    
    // If not found, try normalized symbol
    if (!cached) {
      const normalized = this.normalizeSymbol(symbol);
      if (normalized !== symbol) {
        cached = this.priceCache.get(normalized);
      }
    }
    
    if (!cached) {
      return undefined;
    }

    // Check if price is stale
    const age = Date.now() - cached.timestamp;
    if (age > this.config.cacheExpiry) {
      console.warn(`[PriceFeedService] Price for ${symbol} is stale (${age}ms old)`);
      return undefined;
    }

    return cached;
  }

  /**
   * Get all cached prices
   */
  getAllPrices(): PriceData[] {
    const now = Date.now();
    return Array.from(this.priceCache.values()).filter(
      (price) => now - price.timestamp < this.config.cacheExpiry
    );
  }

  /**
   * Get prices for multiple symbols
   */
  getPrices(symbols: string[]): Map<string, PriceData> {
    const result = new Map<string, PriceData>();
    
    for (const symbol of symbols) {
      const price = this.getLatestPrice(symbol);
      if (price) {
        result.set(symbol, price);
      }
    }

    return result;
  }

  /**
   * Check if price is available and fresh
   */
  isPriceAvailable(symbol: string): boolean {
    const price = this.getLatestPrice(symbol);
    return price !== undefined;
  }

  /**
   * Phase 40: Get short-term price trend for signal validation.
   * Returns the percentage change over the specified lookback period.
   * Positive = price going UP, Negative = price going DOWN.
   */
  getShortTermTrend(symbol: string, lookbackMs: number = 120000): { trendPct: number; sampleCount: number; direction: 'up' | 'down' | 'flat' } {
    const canonical = this.normalizeSymbol(symbol);
    const history = this.priceHistory.get(canonical);
    if (!history || history.length < 2) {
      return { trendPct: 0, sampleCount: 0, direction: 'flat' };
    }

    const now = Date.now();
    const cutoff = now - lookbackMs;
    const relevant = history.filter(h => h.time >= cutoff);
    if (relevant.length < 2) {
      return { trendPct: 0, sampleCount: relevant.length, direction: 'flat' };
    }

    const firstPrice = relevant[0].price;
    const lastPrice = relevant[relevant.length - 1].price;
    const trendPct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    const direction = trendPct > 0.05 ? 'up' : trendPct < -0.05 ? 'down' : 'flat';

    return { trendPct, sampleCount: relevant.length, direction };
  }

  /**
   * Clean stale prices from cache
   */
  private cleanStaleCache(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [symbol, price] of this.priceCache.entries()) {
      if (now - price.timestamp > this.config.cacheExpiry) {
        this.priceCache.delete(symbol);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[PriceFeedService] Cleaned ${removedCount} stale prices from cache`);
    }
  }

  /**
   * Subscribe to price updates for specific symbols
   */
  subscribeToPrices(symbols: string[], callback: (price: PriceData) => void): () => void {
    const handler = (price: PriceData) => {
      if (symbols.includes(price.symbol)) {
        callback(price);
      }
    };

    this.on('price_update', handler);

    // Return unsubscribe function
    return () => {
      this.off('price_update', handler);
    };
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    cachedSymbols: number;
    config: PriceFeedConfig;
  } {
    return {
      isRunning: this.isRunning,
      cachedSymbols: this.priceCache.size,
      config: this.config,
    };
  }

  /**
   * Clear all cached prices
   */
  clearCache(): void {
    this.priceCache.clear();
    console.log('[PriceFeedService] Cache cleared');
  }

  /**
   * Initialize Socket.IO server for real-time price broadcasting
   */
  initialize(httpServer: HTTPServer): void {
    if (this.io) {
      console.log('[PriceFeedService] Already initialized');
      return;
    }

    console.log('[PriceFeedService] Initializing Socket.IO server');
    
    // Build Socket.IO CORS origin list from env (same as Express CORS)
    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    if (process.env.NODE_ENV !== 'production') {
      corsOrigins.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000');
    }

    this.io = new SocketIOServer(httpServer, {
      path: '/api/socket.io',
      cors: {
        // Use whitelist when configured, fall back to allow-all for backward compat
        origin: corsOrigins.length > 0 ? corsOrigins : true,
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false,
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
      // CRITICAL: Use polling first for better proxy compatibility
      // WebSocket upgrades often fail behind reverse proxies
      transports: ['polling', 'websocket'],
      // Allow upgrade from polling to websocket
      allowUpgrades: true,
      // Increase timeouts for slow proxy connections
      pingTimeout: 120000, // 2 minutes
      pingInterval: 30000, // 30 seconds
      // Increase upgrade timeout
      upgradeTimeout: 45000, // 45 seconds
      // Allow EIO3 and EIO4 protocols for compatibility
      allowEIO3: true,
      // CRITICAL FIX: Set connection state timeout
      connectTimeout: 45000,
      // Allow request without origin header (for proxied requests)
      allowRequest: (req, callback) => {
        // Always allow connections - the proxy handles authentication
        callback(null, true);
      },
    });

    // Handle client connections
    this.io.on('connection', (socket) => {
      console.log(`[PriceFeedService] Client connected: ${socket.id}`);

      // Send current prices on connection
      const allPrices = this.getAllPrices();
      socket.emit('initial_prices', allPrices);

      // Handle subscription requests
      socket.on('subscribe', (symbols: string[]) => {
        console.log(`[PriceFeedService] Client ${socket.id} subscribed to:`, symbols);
        socket.join(symbols);
      });

      socket.on('unsubscribe', (symbols: string[]) => {
        console.log(`[PriceFeedService] Client ${socket.id} unsubscribed from:`, symbols);
        symbols.forEach(symbol => socket.leave(symbol));
      });

      // Handle auth for multi-engine data
      socket.on('auth', async (data: { userId: number }) => {
        console.log(`[PriceFeedService] Client ${socket.id} authenticated as user:`, data.userId);
        // Join user-specific room for targeted updates
        socket.join(`user:${data.userId}`);
        
        // CRITICAL FIX: Set up engine listeners to forward events to Socket.IO clients
        // This was missing - engine events were never being forwarded to the frontend
        try {
          // Phase 14D: Use EngineAdapter instead of legacy SEERMultiEngine
          const { getEngineAdapter } = await import('./EngineAdapter');
          const adapter = await getEngineAdapter(data.userId);
          
          // Check if we already have listeners for this user (avoid duplicates)
          const listenerKey = `socketio_listener_${data.userId}`;
          if (!(this as any)[listenerKey]) {
            (this as any)[listenerKey] = true;
            console.log(`[PriceFeedService] ✅ Setting up adapter listeners for userId: ${data.userId}`);
            
            // Forward agent_signals to Socket.IO clients
            adapter.on('agent_signals', (signals: any) => {
              console.log(`[PriceFeedService] 📡 Broadcasting agent_signals for user ${data.userId}`);
              this.broadcastMultiEvent('agent_signals', signals, data.userId);
            });
            
            // Forward consensus updates
            adapter.on('consensus', (consensus: any) => {
              this.broadcastMultiEvent('consensus', consensus, data.userId);
            });
            
            // Forward status updates
            adapter.on('status', (status: any) => {
              this.broadcastMultiEvent('status', status, data.userId);
            });
            
            // Forward trading stats
            adapter.on('trading_stats', (stats: any) => {
              this.broadcastMultiEvent('trading_stats', stats, data.userId);
            });
            
            // Forward activity feed
            adapter.on('activity', (activity: any) => {
              this.broadcastMultiEvent('activity', activity, data.userId);
            });
            
            // Forward position updates
            adapter.on('trade_executed', (trade: any) => {
              this.broadcastMultiEvent('position', { action: 'opened', ...trade }, data.userId);
            });
            
            adapter.on('position_closed', (position: any) => {
              this.broadcastMultiEvent('position', { action: 'closed', ...position }, data.userId);
            });
            
            // Forward multi-tick updates
            adapter.on('tick', (tick: any) => {
              this.broadcastMultiEvent('multi_tick', tick, data.userId);
            });

            // Forward position price updates for live P&L tracking
            adapter.on('position_prices', (prices: any) => {
              this.broadcastMultiEvent('position_prices', prices, data.userId);
            });

            // Forward signal_approved/rejected for real-time signal tracking
            adapter.on('signal_approved', (signal: any) => {
              this.broadcastMultiEvent('signal_approved', signal, data.userId);
            });
            adapter.on('signal_rejected', (signal: any) => {
              this.broadcastMultiEvent('signal_rejected', signal, data.userId);
            });
          }
          
          // Send initial status to the newly authenticated client
          // Use getSymbolStates() for rich SymbolTickData[] (not string[])
          const adapterStatus = adapter.getStatus();
          const positions = await adapter.getAllPositions();
          const symbolStatesObj = adapter.getSymbolStates();
          const richSymbols = Object.values(symbolStatesObj);
          socket.emit('status', {
            running: adapterStatus.isRunning,
            symbols: richSymbols, // SymbolTickData[] with exchangeId, symbol, currentPrice
            positions,
            engine: { running: adapterStatus.isRunning },
          });
          console.log(`[PriceFeedService] ✅ Sent initial status to user ${data.userId} (${richSymbols.length} symbols with prices)`);
        } catch (error) {
          console.error(`[PriceFeedService] Failed to setup engine listeners for user ${data.userId}:`, error);
        }
      });

      // Handle request for symbol state
      socket.on('request_symbol_state', (data: { exchangeId: number; symbol: string }) => {
        console.log(`[PriceFeedService] Client ${socket.id} requested symbol state:`, data);
        // This will be handled by the engine via broadcastMultiEvent
      });

      // Handle request for positions
      socket.on('request_positions', () => {
        console.log(`[PriceFeedService] Client ${socket.id} requested positions`);
        // This will be handled by the engine via broadcastMultiEvent
      });

      socket.on('disconnect', () => {
        console.log(`[PriceFeedService] Client disconnected: ${socket.id}`);
      });
    });

    // Start broadcasting price updates
    this.startBroadcasting();
    
    console.log('[PriceFeedService] Socket.IO server initialized on /api/socket.io');
  }

  /**
   * Start broadcasting price updates to connected clients
   * Note: Individual ticks are now broadcast immediately in updatePrice()
   * This interval is for periodic full state sync only
   */
  private startBroadcasting(): void {
    if (this.broadcastInterval) {
      return;
    }

    // Periodic full state sync every 5 seconds (for reconnected clients)
    // Individual ticks are broadcast immediately in updatePrice()
    this.broadcastInterval = setInterval(() => {
      if (!this.io) return;

      const prices = this.getAllPrices();
      if (prices.length > 0) {
        // Full state sync for all connected clients
        this.io.emit('price_sync', prices);
      }
    }, 5000); // 5 seconds for full sync
  }

  /**
   * Broadcast multi-engine events to all connected Socket.IO clients
   * This is used by the WebSocketServerMulti to forward events through Socket.IO
   * for better proxy compatibility in production
   */
  broadcastMultiEvent(eventType: string, data: any, userId?: number): void {
    if (!this.io) {
      return;
    }

    if (userId) {
      // Send to specific user's room
      this.io.to(`user:${userId}`).emit(eventType, data);
    } else {
      // Broadcast to all clients
      this.io.emit(eventType, data);
    }
  }

  /**
   * Get the Socket.IO server instance for direct access
   */
  getIO(): import('socket.io').Server | null {
    return this.io;
  }

  /**
   * Shutdown the price feed service and Socket.IO server
   */
  shutdown(): void {
    console.log('[PriceFeedService] Shutting down...');

    // Stop broadcasting
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    // Close Socket.IO server
    if (this.io) {
      this.io.close();
      this.io = null;
    }

    // Stop the service
    this.stop();

    console.log('[PriceFeedService] Shutdown complete');
  }
}

// Singleton instance
const priceFeedService = new PriceFeedService();

// Auto-start the service
priceFeedService.start();

export { priceFeedService, PriceFeedService };
