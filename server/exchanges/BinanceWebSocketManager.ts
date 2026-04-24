import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Phase 14 — WebSocket base URL is configurable so prod can use Binance.US
 * (wss://stream.binance.us:9443) where stream.binance.com is geo-blocked
 * (HTTP 451) on US-East hosts. The two services speak the IDENTICAL Binance
 * spot websocket protocol — same stream names, same message shape — so
 * nothing else needs to change.
 *
 * Default remains stream.binance.com for back-compat (dev + non-US).
 * Prod sets BINANCE_WS_BASE_URL=wss://stream.binance.us:9443 via env.
 */
export const DEFAULT_BINANCE_WS_BASE_URL = 'wss://stream.binance.com:9443';
export function resolveBinanceWsBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const v = env.BINANCE_WS_BASE_URL?.trim();
  if (!v) return DEFAULT_BINANCE_WS_BASE_URL;
  // Strip any trailing slash so callers can append `/stream?...` or `/ws/...`
  return v.replace(/\/+$/, '');
}

interface TradeEvent {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
}

interface TickerEvent {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  lastPrice: number;
  volume: number;
  quoteVolume: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  timestamp: number;
}

interface WebSocketConfig {
  symbol: string;
  streams: ('trade' | 'ticker' | 'kline_1m' | 'kline_5m' | 'kline_1h' | 'kline_4h' | 'kline_1d' | 'depth' | 'depth@100ms')[];
}

/**
 * Binance WebSocket Manager for real-time market data streaming
 * 
 * Provides low-latency price updates (10-50ms) via WebSocket instead of REST polling
 * Supports automatic reconnection and multiple stream types per symbol
 */
export class BinanceWebSocketManager extends EventEmitter {
  private connections: Map<string, WebSocket> = new Map();
  
  // Missing tick detection — log gaps, not every tick
  private lastTickTime: Map<string, number> = new Map();
  private tickCount: Map<string, number> = new Map();
  private gapCount: Map<string, number> = new Map();
  private readonly TICK_GAP_THRESHOLD_MS = 5000; // 5s without tick = gap
  private gapDetectionTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    
    // Increase max listeners to prevent warnings (we have many symbols)
    this.setMaxListeners(100);
    
    // CRITICAL: Prevent unhandled error events from crashing the process
    // This listener MUST exist before any error is emitted
    this.on('error', (errorData) => {
      // Error is already logged in the ws.on('error') handler below
      // This listener just prevents Node.js from treating it as unhandled
      // DO NOT remove this - it prevents server crashes
    });
    
    console.log('[BinanceWebSocketManager] Initialized with error handler and missing tick detection');
    
    // Start gap detection scanner — checks every 5s for missing ticks
    this.gapDetectionTimer = setInterval(() => this.detectMissingTicks(), 5000);
  }
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000; // 1 second
  private latencyTracking: Map<string, number[]> = new Map();

  /**
   * Subscribe to WebSocket streams for a symbol
   * @param config Symbol and stream types to subscribe to
   */
  subscribe(config: WebSocketConfig): void {
    const { symbol, streams } = config;
    const streamNames = streams.map(s => `${symbol.toLowerCase()}@${s}`).join('/');
    const baseUrl = resolveBinanceWsBaseUrl();
    const url = `${baseUrl}/stream?streams=${streamNames}`;

    console.log(`[WebSocket] Subscribing to ${symbol}: ${streams.join(', ')} via ${baseUrl}`);

    const ws = new WebSocket(url);
    const connectionKey = symbol.toLowerCase();

    ws.on('open', () => {
      console.log(`[WebSocket] Connected to ${symbol}`);
      this.reconnectAttempts.set(connectionKey, 0);
      this.emit('connected', { symbol });
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(symbol, message);
      } catch (error) {
        console.error(`[WebSocket] Error parsing message for ${symbol}:`, error);
      }
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error for ${symbol}:`, error.message);
      this.emit('error', { symbol, error });
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Disconnected from ${symbol}`);
      this.connections.delete(connectionKey);
      this.emit('disconnected', { symbol });
      this.attemptReconnect(config);
    });

    this.connections.set(connectionKey, ws);
  }

  /**
   * Unsubscribe from a symbol's WebSocket streams
   */
  unsubscribe(symbol: string): void {
    const connectionKey = symbol.toLowerCase();
    const ws = this.connections.get(connectionKey);
    
    if (ws) {
      console.log(`[WebSocket] Unsubscribing from ${symbol}`);
      ws.close();
      this.connections.delete(connectionKey);
      this.reconnectAttempts.delete(connectionKey);
    }
  }

  /**
   * Unsubscribe from all symbols
   */
  unsubscribeAll(): void {
    console.log('[WebSocket] Closing all connections');
    this.connections.forEach((ws, symbol) => {
      ws.close();
    });
    this.connections.clear();
    this.reconnectAttempts.clear();
  }

  /**
   * Get connection status for a symbol
   */
  isConnected(symbol: string): boolean {
    const connectionKey = symbol.toLowerCase();
    const ws = this.connections.get(connectionKey);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get average latency for a symbol (in milliseconds)
   */
  getAverageLatency(symbol: string): number {
    const latencies = this.latencyTracking.get(symbol.toLowerCase());
    if (!latencies || latencies.length === 0) return 0;
    
    const sum = latencies.reduce((a, b) => a + b, 0);
    return sum / latencies.length;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(symbol: string, message: any): void {
    const receiveTime = Date.now();
    
    if (!message.data) return;

    const data = message.data;
    const stream = message.stream;

    // Track latency (difference between event time and receive time)
    if (data.E) {
      const latency = receiveTime - data.E;
      this.trackLatency(symbol, latency);
    }

    // Handle trade stream
    if (stream && stream.includes('@trade')) {
      const tradeEvent: TradeEvent = {
        symbol,
        price: parseFloat(data.p),
        quantity: parseFloat(data.q),
        timestamp: data.T,
        isBuyerMaker: data.m,
      };
      // Missing tick detection: log gaps, not every tick
      const now = Date.now();
      const lastTick = this.lastTickTime.get(symbol) || 0;
      const count = (this.tickCount.get(symbol) || 0) + 1;
      this.tickCount.set(symbol, count);
      this.lastTickTime.set(symbol, now);
      
      // Log gap recovery when ticks resume after a gap
      if (lastTick > 0 && (now - lastTick) > this.TICK_GAP_THRESHOLD_MS) {
        const gapDuration = ((now - lastTick) / 1000).toFixed(1);
        const gaps = (this.gapCount.get(symbol) || 0) + 1;
        this.gapCount.set(symbol, gaps);
        console.warn(`[WebSocket] ⚠️ TICK GAP RECOVERED: ${symbol} — ${gapDuration}s gap (gap #${gaps}), resumed @ $${tradeEvent.price}`);
      }
      
      // Log summary every 10,000 ticks per symbol (roughly every few minutes)
      if (count % 10000 === 0) {
        const gaps = this.gapCount.get(symbol) || 0;
        console.log(`[WebSocket] 📊 ${symbol} tick summary: ${count.toLocaleString()} ticks processed, ${gaps} gaps detected, latest @ $${tradeEvent.price}`);
      }
      
      this.emit('trade', tradeEvent);
    }

    // Handle ticker stream
    if (stream && stream.includes('@ticker')) {
      const tickerEvent: TickerEvent = {
        symbol,
        priceChange: parseFloat(data.p),
        priceChangePercent: parseFloat(data.P),
        lastPrice: parseFloat(data.c),
        volume: parseFloat(data.v),
        quoteVolume: parseFloat(data.q),
        openPrice: parseFloat(data.o),
        highPrice: parseFloat(data.h),
        lowPrice: parseFloat(data.l),
        timestamp: data.E,
      };
      this.emit('ticker', tickerEvent);
    }

    // Handle kline stream
    if (stream && stream.includes('@kline')) {
      const kline = data.k;
      this.emit('kline', {
        symbol,
        interval: kline.i,
        openTime: kline.t,
        closeTime: kline.T,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
        isClosed: kline.x,
      });
    }

    // Handle depth stream
    if (stream && stream.includes('@depth')) {
      this.emit('depth', {
        symbol,
        bids: data.b?.map(([price, qty]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        })) || [],
        asks: data.a?.map(([price, qty]: [string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        })) || [],
        timestamp: receiveTime,
      });
    }
  }

  /**
   * Detect missing ticks — runs every 5s to check for symbols with no recent ticks
   */
  private detectMissingTicks(): void {
    const now = Date.now();
    for (const [symbol, lastTick] of this.lastTickTime.entries()) {
      const elapsed = now - lastTick;
      if (elapsed > this.TICK_GAP_THRESHOLD_MS && this.isConnected(symbol)) {
        const gapDuration = (elapsed / 1000).toFixed(1);
        console.warn(`[WebSocket] ⚠️ MISSING TICKS: ${symbol} — no tick for ${gapDuration}s (connected: ${this.isConnected(symbol)})`);
      }
    }
  }

  /**
   * Get tick statistics for monitoring
   */
  getTickStats(): Record<string, { totalTicks: number; gapCount: number; lastTickAge: string }> {
    const now = Date.now();
    const stats: Record<string, { totalTicks: number; gapCount: number; lastTickAge: string }> = {};
    for (const [symbol, count] of this.tickCount.entries()) {
      const lastTick = this.lastTickTime.get(symbol) || 0;
      const age = lastTick > 0 ? `${((now - lastTick) / 1000).toFixed(1)}s ago` : 'never';
      stats[symbol] = {
        totalTicks: count,
        gapCount: this.gapCount.get(symbol) || 0,
        lastTickAge: age,
      };
    }
    return stats;
  }

  /**
   * Track latency for performance monitoring
   */
  private trackLatency(symbol: string, latency: number): void {
    const key = symbol.toLowerCase();
    if (!this.latencyTracking.has(key)) {
      this.latencyTracking.set(key, []);
    }
    
    const latencies = this.latencyTracking.get(key)!;
    latencies.push(latency);
    
    // Keep only last 100 latency measurements
    if (latencies.length > 100) {
      latencies.shift();
    }
  }

  /**
   * Clean up gap detection timer
   */
  destroy(): void {
    if (this.gapDetectionTimer) {
      clearInterval(this.gapDetectionTimer);
      this.gapDetectionTimer = null;
    }
    this.unsubscribeAll();
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(config: WebSocketConfig): void {
    const connectionKey = config.symbol.toLowerCase();
    const attempts = this.reconnectAttempts.get(connectionKey) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      // NEVER give up — reset counter and retry in 5s
      // A dead WebSocket feed means blind trading. We MUST keep trying.
      console.warn(`[WebSocket] Max reconnects for ${config.symbol}, resetting in 5s`);
      this.reconnectAttempts.set(connectionKey, 0);
      this.emit('maxReconnectAttemptsReached', { symbol: config.symbol });
      setTimeout(() => {
        if (!this.isConnected(config.symbol)) {
          this.subscribe(config);
        }
      }, 5000);
      return;
    }

    const delay = this.BASE_RECONNECT_DELAY * Math.pow(2, attempts);
    console.log(`[WebSocket] Reconnecting to ${config.symbol} in ${delay}ms (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectAttempts.set(connectionKey, attempts + 1);

    setTimeout(() => {
      if (!this.isConnected(config.symbol)) {
        this.subscribe(config);
      }
    }, delay);
  }
}

// Singleton instance
let wsManager: BinanceWebSocketManager | null = null;

export function getBinanceWebSocketManager(): BinanceWebSocketManager {
  if (!wsManager) {
    wsManager = new BinanceWebSocketManager();
  }
  return wsManager;
}
