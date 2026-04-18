/**
 * CoinbasePublicWebSocket - FREE Real-Time Price Feed (No API Keys Required)
 * 
 * Uses the Coinbase Exchange public WebSocket feed (wss://ws-feed.exchange.coinbase.com)
 * which provides real-time ticker data WITHOUT authentication.
 * 
 * This is the PRIMARY price feed for the SEER platform.
 * The Coinbase Advanced Trade WebSocket (wss://advanced-trade-ws.coinbase.com) requires
 * JWT authentication with API keys, but the public Exchange feed does not.
 * 
 * Architecture:
 * - Connects to wss://ws-feed.exchange.coinbase.com (FREE, no auth)
 * - Subscribes to 'ticker' channel for real-time price updates
 * - Feeds ticks into priceFeedService (single source of truth)
 * - Emits events for SymbolOrchestrator to consume
 * - Auto-reconnects with exponential backoff
 * 
 * Data provided per tick:
 * - price, best_bid, best_ask, volume_24h, high_24h, low_24h, open_24h
 * - Latency: ~50-200ms (real-time WebSocket)
 * 
 * Cost: $0 (public endpoint, no API key, no rate limit for WebSocket)
 * 
 * References:
 * - https://docs.cloud.coinbase.com/exchange/docs/websocket-overview
 */

import WebSocket from 'ws';
import EventEmitter from 'eventemitter3';
import { priceFeedService } from './priceFeedService';
import { wsHealthMonitor } from '../monitoring/WebSocketHealthMonitor';

export interface CoinbaseL2UpdateEvent {
  type: 'l2update';
  product_id: string;
  time: string;
  changes: Array<['buy' | 'sell', string, string]>; // [side, price, size]
}

export interface CoinbaseL2SnapshotEvent {
  type: 'snapshot';
  product_id: string;
  bids: Array<[string, string]>; // [price, size]
  asks: Array<[string, string]>; // [price, size]
}

export interface CoinbasePublicTickerEvent {
  type: 'ticker';
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_ask: string;
  side: 'buy' | 'sell';
  time: string;
  trade_id: number;
  last_size: string;
  sequence: number;
}

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 50; // Very generous - this is our primary feed
const HEARTBEAT_TIMEOUT = 15000; // 15s without data = stale

class CoinbasePublicWebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbols: string[] = [];
  private isRunning = false;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectDelay = RECONNECT_BASE_DELAY;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastMessageTime: number = 0;
  private messageCount: number = 0;
  private tickCount: number = 0;
  private connectionStartTime: number = 0;
  // Level 2 order book cache (top 25 levels per symbol)
  private orderBooks: Map<string, { bids: Map<string, number>; asks: Map<string, number> }> = new Map();
  private static readonly MAX_OB_LEVELS = 25;

  // Phase 11C: PriceFabric lazy reference (avoids circular import issues)
  private _priceFabric: any = null;
  private _priceFabricLoading = false;
  private _loadPriceFabric(): void {
    if (this._priceFabricLoading) return;
    this._priceFabricLoading = true;
    import('./PriceFabric').then(({ getPriceFabric }) => {
      this._priceFabric = getPriceFabric();
      console.log('[CoinbasePublicWS] ✅ PriceFabric loaded — ticks now routed through fabric');
    }).catch(() => {
      this._priceFabricLoading = false;
      // Will retry on next tick
    });
  }

  /**
   * Start the public WebSocket connection.
   * @param symbols Array of symbols in SEER format (e.g., ['BTC-USD', 'ETH-USD'])
   */
  async start(symbols: string[]): Promise<void> {
    if (this.isRunning) {
      console.log('[CoinbasePublicWS] Already running');
      return;
    }

    this.symbols = symbols;
    this.isRunning = true;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    console.log(`[CoinbasePublicWS] Starting for: ${symbols.join(', ')}`);
    await this.connect();
  }

  /**
   * Connect to the Coinbase public WebSocket.
   */
  private async connect(): Promise<void> {
    if (this.isConnecting || (this.ws?.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.connectionStartTime = Date.now();

    try {
      console.log(`[CoinbasePublicWS] Connecting to ${WS_URL}...`);
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on('error', (error: Error) => this.handleError(error));
      this.ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason));
    } catch (error) {
      console.error('[CoinbasePublicWS] Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open event.
   */
  private handleOpen(): void {
    console.log('[CoinbasePublicWS] ✅ Connected to Coinbase public WebSocket');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = RECONNECT_BASE_DELAY;
    this.lastMessageTime = Date.now();

    // Phase 11C: Eagerly load PriceFabric so it's ready before first tick
    if (!this._priceFabric) this._loadPriceFabric();

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Subscribe to ticker channel
    this.subscribe();

    // Start heartbeat monitoring
    this.startHeartbeatMonitor();

    // Report health
    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'connected'); } catch (e) { /* non-critical */ }

    this.emit('connected', { timestamp: Date.now() });
  }

  /**
   * Subscribe to ticker channel for all symbols.
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[CoinbasePublicWS] Cannot subscribe: WebSocket not open');
      return;
    }

    // The public feed uses product_ids directly (BTC-USD format)
    const subscribeMessage = {
      type: 'subscribe',
      product_ids: this.symbols,
      channels: ['ticker', 'level2_batch'],
    };

    console.log(`[CoinbasePublicWS] Subscribing to ticker for: ${this.symbols.join(', ')}`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      this.lastMessageTime = Date.now();
      this.messageCount++;

      // Report to wsHealthMonitor
      try { wsHealthMonitor.recordMessage('CoinbaseWS'); } catch (e) { /* non-critical */ }

      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ticker':
          this.handleTicker(message as CoinbasePublicTickerEvent);
          break;
        case 'subscriptions':
          console.log('[CoinbasePublicWS] Subscription confirmed:', 
            message.channels?.map((c: any) => `${c.name}: ${c.product_ids?.join(', ')}`).join('; '));
          break;
        case 'error':
          console.error('[CoinbasePublicWS] Error message:', message.message || message.reason);
          break;
        case 'snapshot':
          this.handleL2Snapshot(message as CoinbaseL2SnapshotEvent);
          break;
        case 'l2update':
          this.handleL2Update(message as CoinbaseL2UpdateEvent);
          break;
        case 'heartbeat':
          // Heartbeat received - connection is alive
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('[CoinbasePublicWS] Message parsing error:', error);
    }
  }

  /**
   * Handle L2 snapshot — initial full order book.
   */
  private handleL2Snapshot(snapshot: CoinbaseL2SnapshotEvent): void {
    const bids = new Map<string, number>();
    const asks = new Map<string, number>();

    for (const [price, size] of snapshot.bids.slice(0, CoinbasePublicWebSocketService.MAX_OB_LEVELS)) {
      const s = parseFloat(size);
      if (s > 0) bids.set(price, s);
    }
    for (const [price, size] of snapshot.asks.slice(0, CoinbasePublicWebSocketService.MAX_OB_LEVELS)) {
      const s = parseFloat(size);
      if (s > 0) asks.set(price, s);
    }

    this.orderBooks.set(snapshot.product_id, { bids, asks });
    this.emitOrderBook(snapshot.product_id);
  }

  /**
   * Handle L2 update — incremental order book changes.
   */
  private handleL2Update(update: CoinbaseL2UpdateEvent): void {
    let ob = this.orderBooks.get(update.product_id);
    if (!ob) {
      ob = { bids: new Map(), asks: new Map() };
      this.orderBooks.set(update.product_id, ob);
    }

    for (const [side, price, size] of update.changes) {
      const s = parseFloat(size);
      const book = side === 'buy' ? ob.bids : ob.asks;
      if (s === 0) {
        book.delete(price);
      } else {
        book.set(price, s);
      }
    }

    this.emitOrderBook(update.product_id);
  }

  /**
   * Emit the current order book snapshot as sorted arrays (top N levels).
   */
  private emitOrderBook(symbol: string): void {
    const ob = this.orderBooks.get(symbol);
    if (!ob) return;

    const N = CoinbasePublicWebSocketService.MAX_OB_LEVELS;
    const bids: Array<[number, number]> = Array.from(ob.bids.entries())
      .map(([p, s]) => [parseFloat(p), s] as [number, number])
      .sort((a, b) => b[0] - a[0])
      .slice(0, N);
    const asks: Array<[number, number]> = Array.from(ob.asks.entries())
      .map(([p, s]) => [parseFloat(p), s] as [number, number])
      .sort((a, b) => a[0] - b[0])
      .slice(0, N);

    this.emit('orderbook', {
      product_id: symbol,
      bids,
      asks,
      timestamp: Date.now(),
    });

  }

  private handleTicker(ticker: CoinbasePublicTickerEvent): void {
    const price = parseFloat(ticker.price);
    if (!price || price <= 0 || isNaN(price)) return;

    this.tickCount++;

    const volume24h = parseFloat(ticker.volume_24h) || 0;
    const high24h = parseFloat(ticker.high_24h) || 0;
    const low24h = parseFloat(ticker.low_24h) || 0;
    const open24h = parseFloat(ticker.open_24h) || 0;
    const bestBid = parseFloat(ticker.best_bid) || 0;
    const bestAsk = parseFloat(ticker.best_ask) || 0;
    const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;

    // Always update priceFeedService with 24h metadata (volume, change, high, low)
    // PriceFabric handles dedup/consensus but doesn't pass through 24h stats
    priceFeedService.updatePrice(ticker.product_id, price, 'websocket', {
      volume24h,
      change24h,
    });

    // Also feed through PriceFabric for multi-source dedup and consensus
    if (this._priceFabric) {
      this._priceFabric.ingestTick({
        symbol: ticker.product_id,    // Already in BTC-USD format
        price,
        volume: parseFloat(ticker.last_size) || 0,
        bid: bestBid,
        ask: bestAsk,
        timestampMs: new Date(ticker.time).getTime() || Date.now(),
        receivedAtMs: Date.now(),
        source: 'coinbase' as const,
        sequenceNumber: ticker.sequence,
      });
    } else {
      // PriceFabric not yet loaded — try lazy loading
      this._loadPriceFabric();
    }

    // Emit ticker event for SymbolOrchestrator to consume
    this.emit('ticker', {
      product_id: ticker.product_id,
      price: ticker.price,
      volume_24_h: ticker.volume_24h,
      low_24_h: ticker.low_24h,
      high_24_h: ticker.high_24h,
      best_bid: ticker.best_bid,
      best_ask: ticker.best_ask,
      price_percent_chg_24_h: change24h.toFixed(4),
      timestamp: ticker.time,
      // Additional fields for depth analysis
      side: ticker.side,
      last_size: ticker.last_size,
      trade_id: ticker.trade_id,
    });

    // Phase 42: Reduced logging from every 100 to every 5000 to reduce memory pressure
    if (this.tickCount % 5000 === 0) {
      console.log(`[CoinbasePublicWS] 📊 Tick #${this.tickCount}: ${ticker.product_id} @ $${price.toFixed(2)} (vol: ${volume24h.toFixed(0)}, 24h: ${change24h.toFixed(2)}%)`);
    }
  }

  /**
   * Handle WebSocket error.
   */
  private handleError(error: Error): void {
    console.error('[CoinbasePublicWS] WebSocket error:', error.message);
    this.isConnecting = false;
    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'error'); } catch (e) { /* non-critical */ }
    this.emit('error', error);
  }

  /**
   * Handle WebSocket close.
   */
  private handleClose(code: number, reason: Buffer): void {
    const reasonStr = reason?.toString() || 'unknown';
    console.warn(`[CoinbasePublicWS] WebSocket closed: code=${code}, reason=${reasonStr}`);
    this.isConnecting = false;
    this.ws = null;

    // Stop heartbeat monitor
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'disconnected'); } catch (e) { /* non-critical */ }

    this.emit('disconnected', { code, reason: reasonStr });

    // Auto-reconnect if we should
    if (this.shouldReconnect && this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect || !this.isRunning) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[CoinbasePublicWS] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
      this.emit('maxReconnectAttemptsReached');
      // Phase 11B: NEVER give up on price data. With real money positions open,
      // even 30 seconds without price feed is dangerous. Reset and retry immediately.
      console.error('[CoinbasePublicWS] 🚨 CRITICAL: Price feed is life support for open positions — retrying in 5s');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 5000;
      if (this.isRunning) {
        setTimeout(() => this.connect(), 5000);
      }
      return;
    }

    // Exponential backoff with jitter
    const jitter = Math.random() * 1000;
    this.reconnectDelay = Math.min(
      RECONNECT_MAX_DELAY,
      this.reconnectDelay * 1.5 + jitter
    );

    console.log(`[CoinbasePublicWS] Reconnecting in ${Math.round(this.reconnectDelay)}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  /**
   * Start heartbeat monitoring to detect stale connections.
   */
  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTime;
      if (timeSinceLastMessage > HEARTBEAT_TIMEOUT) {
        console.warn(`[CoinbasePublicWS] No data for ${Math.round(timeSinceLastMessage / 1000)}s, reconnecting...`);
        this.forceReconnect();
      }
    }, 5000);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Force a reconnection (close current connection and reconnect).
   */
  private forceReconnect(): void {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this.isConnecting = false;
    this.connect();
  }

  /**
   * Stop the WebSocket connection.
   */
  stop(): void {
    console.log('[CoinbasePublicWS] Stopping...');
    this.isRunning = false;
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Service stopped');
      } catch (e) {
        try { this.ws.terminate(); } catch (e2) { /* ignore */ }
      }
      this.ws = null;
    }

    console.log('[CoinbasePublicWS] Stopped');
  }

  /**
   * Get service status for health dashboard.
   */
  getStatus(): {
    isRunning: boolean;
    isConnected: boolean;
    symbols: string[];
    lastMessageTime: number;
    messageCount: number;
    tickCount: number;
    reconnectAttempts: number;
    uptimeMs: number;
  } {
    return {
      isRunning: this.isRunning,
      isConnected: this.ws?.readyState === WebSocket.OPEN,
      symbols: this.symbols,
      lastMessageTime: this.lastMessageTime,
      messageCount: this.messageCount,
      tickCount: this.tickCount,
      reconnectAttempts: this.reconnectAttempts,
      uptimeMs: this.connectionStartTime > 0 ? Date.now() - this.connectionStartTime : 0,
    };
  }

  /**
   * Check if the WebSocket is currently connected and healthy.
   */
  isHealthy(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    return timeSinceLastMessage < HEARTBEAT_TIMEOUT;
  }
}

// Singleton instance
export const coinbasePublicWebSocket = new CoinbasePublicWebSocketService();
