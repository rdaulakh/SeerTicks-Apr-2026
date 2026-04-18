/**
 * CoinAPI WebSocket Adapter for Real-Time Price Feed
 * 
 * This adapter connects to CoinAPI's WebSocket API to receive real-time
 * trade and quote data for cryptocurrency pairs. It provides:
 * - Automatic reconnection with exponential backoff
 * - Symbol normalization (BTC-USD -> COINBASE_SPOT_BTC_USD)
 * - Heartbeat/ping-pong handling
 * - Integration with priceFeedService for unified price distribution
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ENV } from '../_core/env';
import { priceFeedService } from './priceFeedService';
import { getCandleCache } from '../WebSocketCandleCache';
import { saveCandlesToDatabase } from '../db/candleStorage';
import { getDb } from '../db';
import { ticks, dataGapLogs } from '../../drizzle/schema';
import { wsHealthMonitor } from '../monitoring/WebSocketHealthMonitor';
import { apiConnectionMonitor } from '../monitoring/APIConnectionMonitor';
import { alertLogger } from '../monitoring/AlertLogger';

interface CoinAPITradeMessage {
  type: 'trade';
  symbol_id: string;
  sequence: number;
  time_exchange: string;
  time_coinapi: string;
  uuid: string;
  price: number;
  size: number;
  taker_side: string;
}

interface CoinAPIQuoteMessage {
  type: 'quote';
  symbol_id: string;
  sequence: number;
  time_exchange: string;
  time_coinapi: string;
  ask_price: number;
  ask_size: number;
  bid_price: number;
  bid_size: number;
}

interface CoinAPIHeartbeat {
  type: 'heartbeat';
}

interface CoinAPIReconnect {
  type: 'reconnect';
  within_seconds: number;
  before_time: string;
}

type CoinAPIMessage = CoinAPITradeMessage | CoinAPIQuoteMessage | CoinAPIHeartbeat | CoinAPIReconnect;

interface ConnectionStats {
  connected: boolean;
  lastMessageTime: number;
  messagesReceived: number;
  reconnectCount: number;
  lastError: string | null;
  missedTicks: number;
  lastSequence: Map<string, number>;
  dataGaps: Array<{ symbol: string; expectedSeq: number; receivedSeq: number; timestamp: number }>;
}

export class CoinAPIWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private endpoint: string = 'wss://ws.coinapi.io/v1/';
  private subscribedSymbols: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private reconnectDelay: number = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private stats: ConnectionStats = {
    connected: false,
    lastMessageTime: 0,
    messagesReceived: 0,
    reconnectCount: 0,
    lastError: null,
    missedTicks: 0,
    lastSequence: new Map(),
    dataGaps: []
  };

  // OHLCV aggregation for database persistence
  private ohlcvAggregator: Map<string, {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
    trades: number;
  }> = new Map();
  private persistenceInterval: NodeJS.Timeout | null = null;
  private tickPersistenceInterval: NodeJS.Timeout | null = null;
  private readonly PERSISTENCE_INTERVAL_MS = 60000; // Save every 1 minute
  private readonly TICK_PERSISTENCE_INTERVAL_MS = 5000; // Save ticks every 5 seconds
  
  // Tick buffer for batch persistence (reduces DB writes)
  private tickBuffer: Array<{
    symbol: string;
    price: string;
    volume: string;
    bid?: string;
    ask?: string;
    timestampMs: number;
    source: 'coinapi' | 'coinbase' | 'binance';
    sequenceNumber?: number;
  }> = [];
  private readonly MAX_TICK_BUFFER_SIZE = 1000;

  // Symbol mapping: internal format -> CoinAPI format
  private symbolMap: Map<string, string> = new Map();
  private reverseSymbolMap: Map<string, string> = new Map();

  constructor() {
    super();
    this.apiKey = ENV.coinApiKey || '';
    
    if (!this.apiKey) {
      console.warn('[CoinAPIWebSocket] ❌ No API key configured - CoinAPI feed disabled');
    } else {
      console.log(`[CoinAPIWebSocket] ✅ API key configured (${this.apiKey.substring(0, 8)}...)`);
    }
  }

  /**
   * Convert internal symbol format to CoinAPI format
   * BTC-USD -> COINBASE_SPOT_BTC_USD
   * BTC/USD -> COINBASE_SPOT_BTC_USD
   * BTCUSD -> COINBASE_SPOT_BTC_USD
   */
  private toCoinAPISymbol(symbol: string, exchange: string = 'COINBASE'): string {
    // Normalize the symbol
    let normalized = symbol.toUpperCase()
      .replace(/[/-]/g, '_')
      .replace(/USDT$/, 'USD'); // CoinAPI uses USD not USDT for most pairs
    
    // Handle formats like BTCUSD -> BTC_USD
    if (!normalized.includes('_')) {
      // Try to split at common quote currencies
      const quoteCurrencies = ['USD', 'EUR', 'GBP', 'BTC', 'ETH'];
      for (const quote of quoteCurrencies) {
        if (normalized.endsWith(quote)) {
          const base = normalized.slice(0, -quote.length);
          normalized = `${base}_${quote}`;
          break;
        }
      }
    }
    
    return `${exchange}_SPOT_${normalized}`;
  }

  /**
   * Convert CoinAPI symbol format to internal format
   * COINBASE_SPOT_BTC_USD -> BTC-USD
   */
  private fromCoinAPISymbol(coinapiSymbol: string): string {
    // Check reverse map first
    if (this.reverseSymbolMap.has(coinapiSymbol)) {
      return this.reverseSymbolMap.get(coinapiSymbol)!;
    }
    
    // Parse: EXCHANGE_TYPE_BASE_QUOTE
    const parts = coinapiSymbol.split('_');
    if (parts.length >= 4) {
      const base = parts[2];
      const quote = parts[3];
      return `${base}-${quote}`;
    }
    
    return coinapiSymbol;
  }

  /**
   * Connect to CoinAPI WebSocket
   */
  async connect(): Promise<void> {
    if (!this.apiKey) {
      console.warn('[CoinAPIWebSocket] Cannot connect - no API key');
      return;
    }

    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        console.log('[CoinAPIWebSocket] Connecting to', this.endpoint);
        
        this.ws = new WebSocket(this.endpoint, {
          headers: {
            'X-CoinAPI-Key': this.apiKey
          }
        });

        this.ws.on('open', () => {
          console.log('[CoinAPIWebSocket] ✅✅✅ CONNECTED TO COINAPI - PRIMARY PRICE FEED ACTIVE');
          this.isConnecting = false;
          this.stats.connected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // === MONITORING: Log WebSocket connection ===
          try {
            wsHealthMonitor.registerWebSocket('coinapi_primary');
            wsHealthMonitor.updateStatus('coinapi_primary', 'connected');
            apiConnectionMonitor.logConnectionEvent('coinapi_ws', 'connected', {
              operation: 'websocket_connect',
            });
          } catch (e) { /* monitoring is non-critical */ }
          
          // Update health state using dynamic import (ESM compatible)
          import('../routers/healthRouter').then(({ updateHealthState }) => {
            updateHealthState('websocket', { connected: true, lastPing: Date.now(), provider: 'CoinAPI' });
            updateHealthState('priceFeed', { connected: true });
            console.log('[CoinAPIWebSocket] Health state updated successfully');
          }).catch((e: any) => {
            console.error('[CoinAPIWebSocket] Failed to update health state:', e.message);
          });
          
          // Send hello message with subscriptions
          this.sendHello();
          
          // Start ping interval (CoinAPI requires pong response to pings)
          this.startPingInterval();
          
          // Start OHLCV persistence interval
          this.startPersistenceInterval();
          
          // Start tick-level persistence interval
          this.startTickPersistenceInterval();
          
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          console.log(`[CoinAPIWebSocket] Disconnected: ${code} - ${reason.toString()}`);
          
          // === MONITORING: Log WebSocket disconnection ===
          try {
            wsHealthMonitor.updateStatus('coinapi_primary', 'disconnected');
            apiConnectionMonitor.logConnectionEvent('coinapi_ws', 'disconnected', {
              errorMessage: `Code: ${code}, Reason: ${reason.toString()}`,
            });
          } catch (e) { /* monitoring is non-critical */ }
          
          this.handleDisconnect();
        });

        this.ws.on('error', (error: Error) => {
          console.error('[CoinAPIWebSocket] ❌❌❌ CONNECTION ERROR:', error.message);
          this.stats.lastError = error.message;
          this.isConnecting = false;
          
          // === MONITORING: Log WebSocket error ===
          try {
            wsHealthMonitor.updateStatus('coinapi_primary', 'error');
            alertLogger.warning(
              'websocket_error',
              `CoinAPI WebSocket Error`,
              `Connection error: ${error.message}`,
              'connection',
              'coinapi_ws'
            );
          } catch (e) { /* monitoring is non-critical */ }
          
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });

        this.ws.on('ping', () => {
          // Respond to ping with pong (required by CoinAPI)
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.pong();
          }
        });

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Send hello message to subscribe to data
   */
  private sendHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const symbols = Array.from(this.subscribedSymbols);
    const coinapiSymbols = symbols.map(s => this.symbolMap.get(s) || this.toCoinAPISymbol(s));

    const hello = {
      type: 'hello',
      apikey: this.apiKey,
      heartbeat: true,
      subscribe_data_type: ['trade', 'quote'],
      subscribe_filter_symbol_id: coinapiSymbols.length > 0 ? coinapiSymbols : undefined
    };

    console.log('[CoinAPIWebSocket] Sending hello with symbols:', coinapiSymbols);
    this.ws.send(JSON.stringify(hello));
  }

  /**
   * Subscribe to a symbol
   */
  subscribe(symbol: string, exchange: string = 'COINBASE'): void {
    const normalizedSymbol = symbol.toUpperCase().replace(/[/-]/g, '-');
    const coinapiSymbol = this.toCoinAPISymbol(symbol, exchange);
    
    this.symbolMap.set(normalizedSymbol, coinapiSymbol);
    this.reverseSymbolMap.set(coinapiSymbol, normalizedSymbol);
    this.subscribedSymbols.add(normalizedSymbol);
    
    console.log(`[CoinAPIWebSocket] Subscribed to ${normalizedSymbol} -> ${coinapiSymbol}`);
    
    // If already connected, send updated hello
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendHello();
    }
  }

  /**
   * Unsubscribe from a symbol
   */
  unsubscribe(symbol: string): void {
    const normalizedSymbol = symbol.toUpperCase().replace(/[/-]/g, '-');
    const coinapiSymbol = this.symbolMap.get(normalizedSymbol);
    
    this.subscribedSymbols.delete(normalizedSymbol);
    if (coinapiSymbol) {
      this.symbolMap.delete(normalizedSymbol);
      this.reverseSymbolMap.delete(coinapiSymbol);
    }
    
    // Send updated hello
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendHello();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: CoinAPIMessage = JSON.parse(data.toString());
      this.stats.lastMessageTime = Date.now();
      this.stats.messagesReceived++;
      
      // === MONITORING: Record WS message for health tracking ===
      try { wsHealthMonitor.recordMessage('coinapi_primary'); } catch (e) { /* non-critical */ }
      
      // Update health state with tick count (every 100 messages to reduce overhead)
      if (this.stats.messagesReceived % 100 === 0) {
        try {
          const { updateHealthState } = require('../routers/healthRouter');
          updateHealthState('priceFeed', { 
            tickCount: this.stats.messagesReceived, 
            lastTick: Date.now() 
          });
        } catch (e) { /* Health router not loaded yet */ }
      }

      switch (message.type) {
        case 'trade':
          this.handleTrade(message);
          break;
        case 'quote':
          this.handleQuote(message);
          break;
        case 'heartbeat':
          // Heartbeat received, connection is alive
          break;
        case 'reconnect':
          console.log(`[CoinAPIWebSocket] Server requested reconnect within ${message.within_seconds}s`);
          this.scheduleReconnect(message.within_seconds * 1000);
          break;
        default:
          // Unknown message type
          break;
      }
    } catch (error) {
      console.error('[CoinAPIWebSocket] Failed to parse message:', error);
    }
  }

  /**
   * Handle trade message - update price feed immediately
   * CRITICAL: Also aggregate OHLCV data and check for sequence gaps
   */
  private handleTrade(trade: CoinAPITradeMessage): void {
    const symbol = this.fromCoinAPISymbol(trade.symbol_id);
    const timestamp = new Date(trade.time_exchange).getTime();
    
    // MISS-OUT LOGGING: Check for sequence gaps (data loss detection)
    const lastSeq = this.stats.lastSequence.get(trade.symbol_id);
    if (lastSeq !== undefined && trade.sequence !== lastSeq + 1) {
      const missedCount = trade.sequence - lastSeq - 1;
      this.stats.missedTicks += missedCount;
      this.stats.dataGaps.push({
        symbol: trade.symbol_id,
        expectedSeq: lastSeq + 1,
        receivedSeq: trade.sequence,
        timestamp: Date.now()
      });
      console.warn(`[CoinAPIWebSocket] ⚠️ DATA GAP DETECTED: ${symbol} - Expected seq ${lastSeq + 1}, got ${trade.sequence} (missed ${missedCount} ticks)`);
      
      // Keep only last 100 gaps for memory management
      if (this.stats.dataGaps.length > 100) {
        this.stats.dataGaps = this.stats.dataGaps.slice(-100);
      }
    }
    this.stats.lastSequence.set(trade.symbol_id, trade.sequence);
    
    // Phase 42: Reduced logging from every 50 to every 5000 to reduce memory pressure
    if (this.stats.messagesReceived % 5000 === 0) {
      console.log(`[CoinAPIWebSocket] 💹 COINAPI Trade #${this.stats.messagesReceived}: ${symbol} = $${trade.price.toFixed(5)} (size: ${trade.size}, missed: ${this.stats.missedTicks})`);
    }
    
    // Update price feed service immediately (no batching)
    priceFeedService.updatePrice(symbol, trade.price, 'websocket');
    
    // OHLCV AGGREGATION: Aggregate trade data for 1-minute candles
    this.aggregateOHLCV(symbol, trade.price, trade.size, timestamp);
    
    // Update WebSocket candle cache in real-time
    const candleCache = getCandleCache();
    const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
    const existing = this.ohlcvAggregator.get(`${symbol}_${minuteTimestamp}`);
    if (existing) {
      candleCache.addCandle(symbol, '1m', {
        timestamp: minuteTimestamp,
        open: existing.open,
        high: existing.high,
        low: existing.low,
        close: existing.close,
        volume: existing.volume,
      }, false); // Not closed yet
    }
    
    // TICK-LEVEL PERSISTENCE: Buffer tick for database storage
    this.tickBuffer.push({
      symbol,
      price: trade.price.toString(),
      volume: trade.size.toString(),
      timestampMs: timestamp,
      source: 'coinapi',
      sequenceNumber: trade.sequence
    });
    
    // Flush buffer if it gets too large (prevents memory issues)
    if (this.tickBuffer.length >= this.MAX_TICK_BUFFER_SIZE) {
      this.persistTicksToDatabase();
    }
    
    // Emit trade event for any listeners
    this.emit('trade', {
      symbol,
      price: trade.price,
      size: trade.size,
      side: trade.taker_side,
      timestamp,
      source: 'coinapi'
    });
  }

  /**
   * Aggregate trade data into OHLCV candles
   */
  private aggregateOHLCV(symbol: string, price: number, size: number, timestamp: number): void {
    const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
    const key = `${symbol}_${minuteTimestamp}`;
    
    const existing = this.ohlcvAggregator.get(key);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += size;
      existing.trades++;
    } else {
      this.ohlcvAggregator.set(key, {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: size,
        timestamp: minuteTimestamp,
        trades: 1
      });
    }
  }

  /**
   * Start periodic OHLCV persistence to database
   */
  private startPersistenceInterval(): void {
    if (this.persistenceInterval) return;
    
    this.persistenceInterval = setInterval(async () => {
      await this.persistOHLCVToDatabase();
    }, this.PERSISTENCE_INTERVAL_MS);
    
    console.log(`[CoinAPIWebSocket] 💾 OHLCV persistence started (interval: ${this.PERSISTENCE_INTERVAL_MS}ms)`);
  }

  /**
   * Stop OHLCV persistence interval
   */
  private stopPersistenceInterval(): void {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = null;
    }
  }

  /**
   * Persist completed OHLCV candles to database
   */
  private async persistOHLCVToDatabase(): Promise<void> {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000;
    const candlesBySymbol: Map<string, Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>> = new Map();
    
    // Collect completed candles (not the current minute)
    for (const [key, candle] of this.ohlcvAggregator.entries()) {
      if (candle.timestamp < currentMinute) {
        const symbol = key.split('_')[0];
        if (!candlesBySymbol.has(symbol)) {
          candlesBySymbol.set(symbol, []);
        }
        candlesBySymbol.get(symbol)!.push({
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        });
        
        // Mark candle as closed in cache
        const candleCache = getCandleCache();
        candleCache.addCandle(symbol, '1m', {
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }, true); // Closed
        
        // Remove from aggregator
        this.ohlcvAggregator.delete(key);
      }
    }
    
    // Persist to database
    for (const [symbol, candles] of candlesBySymbol.entries()) {
      if (candles.length > 0) {
        try {
          const saved = await saveCandlesToDatabase(symbol, '1m', candles);
          console.log(`[CoinAPIWebSocket] 💾 Persisted ${saved} candles for ${symbol} to database`);
        } catch (error) {
          console.error(`[CoinAPIWebSocket] ❌ Failed to persist candles for ${symbol}:`, error);
        }
      }
    }
  }

  /**
   * Handle quote message - update price feed with mid price
   */
  private handleQuote(quote: CoinAPIQuoteMessage): void {
    const symbol = this.fromCoinAPISymbol(quote.symbol_id);
    const timestamp = new Date(quote.time_exchange).getTime();
    
    // Calculate mid price from bid/ask
    const midPrice = (quote.bid_price + quote.ask_price) / 2;
    
    // Update price feed service immediately
    priceFeedService.updatePrice(symbol, midPrice, 'websocket');
    
    // Emit quote event for any listeners
    this.emit('quote', {
      symbol,
      bidPrice: quote.bid_price,
      bidSize: quote.bid_size,
      askPrice: quote.ask_price,
      askSize: quote.ask_size,
      midPrice,
      timestamp,
      source: 'coinapi'
    });
  }

  /**
   * Handle disconnect and schedule reconnect
   */
  private handleDisconnect(): void {
    this.stats.connected = false;
    this.stopPingInterval();
    
    // Update health state
    try {
      const { updateHealthState } = require('../routers/healthRouter');
      updateHealthState('websocket', { connected: false });
      updateHealthState('priceFeed', { connected: false });
    } catch (e) { /* Health router not loaded yet */ }
    
    if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[CoinAPIWebSocket] Max reconnect attempts reached');
      
      // === MONITORING: Log critical max reconnect alert ===
      try {
        alertLogger.critical(
          'websocket_max_reconnect',
          `CoinAPI WebSocket Max Reconnect Reached`,
          `WebSocket failed to reconnect after ${this.maxReconnectAttempts} attempts. Price feed is DOWN.`,
          'connection',
          'coinapi_ws'
        );
        wsHealthMonitor.updateStatus('coinapi_primary', 'failed');
      } catch (e) { /* monitoring is non-critical */ }
      
      this.emit('maxReconnectReached');
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(delay?: number): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const reconnectDelay = delay || Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    // Add jitter (0-20% of delay)
    const jitter = Math.random() * reconnectDelay * 0.2;
    const finalDelay = reconnectDelay + jitter;

    console.log(`[CoinAPIWebSocket] Reconnecting in ${Math.round(finalDelay)}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectAttempts++;
      this.stats.reconnectCount++;
      
      try {
        await this.connect();
      } catch (error) {
        console.error('[CoinAPIWebSocket] Reconnect failed:', error);
        this.handleDisconnect();
      }
    }, finalDelay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    
    // Send ping every 30 seconds
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Force reconnect - public method for external callers (e.g., TickStalenessMonitor)
   * This immediately closes the current connection and initiates a new one
   */
  async reconnect(): Promise<void> {
    console.log('[CoinAPIWebSocket] 🔄 Force reconnect requested');
    
    // Close existing connection if any
    if (this.ws) {
      this.shouldReconnect = true; // Ensure we want to reconnect
      this.ws.close();
      this.ws = null;
    }
    
    // Clear any pending reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Reset reconnect attempts for fresh start
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    
    // Attempt immediate reconnection
    try {
      await this.connect();
      console.log('[CoinAPIWebSocket] ✅ Force reconnect successful');
    } catch (error) {
      console.error('[CoinAPIWebSocket] ❌ Force reconnect failed:', error);
      // Schedule retry with backoff
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.stopPingInterval();
    this.stopPersistenceInterval();
    this.stopTickPersistenceInterval();
    
    // Persist any remaining data before disconnecting
    this.persistOHLCVToDatabase().catch(err => {
      console.error('[CoinAPIWebSocket] Failed to persist final OHLCV data:', err);
    });
    this.persistTicksToDatabase().catch(err => {
      console.error('[CoinAPIWebSocket] Failed to persist final ticks:', err);
    });
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.stats.connected = false;
    console.log('[CoinAPIWebSocket] Disconnected');
  }

  /**
   * Get connection statistics including miss-out metrics
   */
  getStats(): ConnectionStats & { ohlcvPendingCandles: number; dataIntegrity: number } {
    const totalExpected = this.stats.messagesReceived + this.stats.missedTicks;
    const dataIntegrity = totalExpected > 0 
      ? ((this.stats.messagesReceived / totalExpected) * 100).toFixed(2)
      : '100.00';
    
    return { 
      ...this.stats,
      lastSequence: new Map(this.stats.lastSequence), // Clone the map
      dataGaps: [...this.stats.dataGaps], // Clone the array
      ohlcvPendingCandles: this.ohlcvAggregator.size,
      dataIntegrity: parseFloat(dataIntegrity)
    };
  }

  /**
   * Get data gap report for monitoring
   */
  getDataGapReport(): {
    totalMissedTicks: number;
    recentGaps: Array<{ symbol: string; expectedSeq: number; receivedSeq: number; timestamp: number }>;
    dataIntegrityPercent: number;
  } {
    const totalExpected = this.stats.messagesReceived + this.stats.missedTicks;
    return {
      totalMissedTicks: this.stats.missedTicks,
      recentGaps: this.stats.dataGaps.slice(-20), // Last 20 gaps
      dataIntegrityPercent: totalExpected > 0 
        ? (this.stats.messagesReceived / totalExpected) * 100 
        : 100
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get subscribed symbols
   */
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  /**
   * Start tick persistence interval
   */
  private startTickPersistenceInterval(): void {
    this.stopTickPersistenceInterval();
    
    this.tickPersistenceInterval = setInterval(() => {
      this.persistTicksToDatabase();
    }, this.TICK_PERSISTENCE_INTERVAL_MS);
    
    console.log('[CoinAPIWebSocket] 📊 Tick persistence interval started (every 5s)');
  }

  /**
   * Stop tick persistence interval
   */
  private stopTickPersistenceInterval(): void {
    if (this.tickPersistenceInterval) {
      clearInterval(this.tickPersistenceInterval);
      this.tickPersistenceInterval = null;
    }
  }

  /**
   * Persist buffered ticks to database
   * CRITICAL: This stores EVERY tick for millisecond-level analysis
   */
  private async persistTicksToDatabase(): Promise<void> {
    if (this.tickBuffer.length === 0) return;
    
    const ticksToSave = [...this.tickBuffer];
    this.tickBuffer = []; // Clear buffer immediately to prevent duplicates
    
    try {
      const db = await getDb();
      if (!db) {
        console.warn('[CoinAPIWebSocket] Cannot persist ticks - database not available');
        return;
      }
      
      // Batch insert ticks
      await db.insert(ticks).values(ticksToSave);
      
      console.log(`[CoinAPIWebSocket] 💾 Persisted ${ticksToSave.length} ticks to database`);
    } catch (error) {
      console.error('[CoinAPIWebSocket] ❌ Failed to persist ticks:', error);
      // Re-add failed ticks to buffer (at the front) for retry
      this.tickBuffer = [...ticksToSave, ...this.tickBuffer].slice(0, this.MAX_TICK_BUFFER_SIZE * 2);
    }
  }

  /**
   * Log data gap to database for recovery
   */
  private async logDataGapToDatabase(gap: {
    symbol: string;
    expectedSeq: number;
    receivedSeq: number;
    timestamp: number;
  }): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      
      await db.insert(dataGapLogs).values({
        symbol: gap.symbol,
        gapStartMs: gap.timestamp - 60000, // Estimate gap start as 1 min before detection
        gapEndMs: gap.timestamp,
        expectedSequence: gap.expectedSeq,
        actualSequence: gap.receivedSeq,
        missedTicksEstimate: gap.receivedSeq - gap.expectedSeq - 1,
        recoveryStatus: 'pending',
        detectedBy: 'coinapi_websocket'
      });
      
      console.log(`[CoinAPIWebSocket] 📝 Logged data gap for recovery: ${gap.symbol}`);
    } catch (error) {
      console.error('[CoinAPIWebSocket] Failed to log data gap:', error);
    }
  }
}

// Singleton instance
let coinAPIWebSocket: CoinAPIWebSocket | null = null;

export function getCoinAPIWebSocket(): CoinAPIWebSocket {
  if (!coinAPIWebSocket) {
    coinAPIWebSocket = new CoinAPIWebSocket();
  }
  return coinAPIWebSocket;
}

export default getCoinAPIWebSocket;
