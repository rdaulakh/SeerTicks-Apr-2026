import WebSocket from 'ws';
import { getActiveClock } from '../_core/clock';
import EventEmitter from 'eventemitter3';
import { generateCoinbaseWebSocketJWT } from '../utils/coinbaseJWT.js';
import { wsHealthMonitor } from '../monitoring/WebSocketHealthMonitor';

/**
 * Coinbase Advanced Trade WebSocket Manager
 * 
 * Implements real-time market data streaming via Coinbase Advanced Trade WebSocket API
 * 
 * Channels:
 * - ticker: Real-time price, volume, and 24h stats
 * - level2: Order book snapshots and updates
 * - user: Order updates, fills, and account events
 * - heartbeats: Connection health monitoring
 * 
 * Authentication: JWT token in subscribe message
 * 
 * Performance: 10-50ms latency (vs 100-500ms REST API)
 * 
 * References:
 * - https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview
 * - https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels
 */

export interface CoinbaseTickerEvent {
  type: 'ticker';
  product_id: string;
  price: string;
  volume_24_h: string;
  low_24_h: string;
  high_24_h: string;
  low_52_w: string;
  high_52_w: string;
  price_percent_chg_24_h: string;
  best_bid: string;
  best_ask: string;
  timestamp: string;
}

export interface CoinbaseLevel2Event {
  type: 'snapshot' | 'update';
  product_id: string;
  updates: Array<{
    side: 'bid' | 'offer';
    event_time: string;
    price_level: string;
    new_quantity: string;
  }>;
}

export interface CoinbaseOrderUpdate {
  order_id: string;
  client_order_id: string;
  cumulative_quantity: string;
  leaves_quantity: string;
  avg_price: string;
  total_fees: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'UNKNOWN';
  product_id: string;
  creation_time: string;
  order_type: string;
  side: 'BUY' | 'SELL';
  order_placement_source: string;
  order_configuration?: any;
}

export interface CoinbaseFillEvent {
  order_id: string;
  client_order_id: string;
  trade_id: string;
  product_id: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  commission: string;
  liquidity_indicator: 'MAKER' | 'TAKER';
  trade_time: string;
}

export interface CoinbaseUserEvent {
  type: 'user';
  orders?: CoinbaseOrderUpdate[];
  fills?: CoinbaseFillEvent[];
}

export interface CoinbaseWebSocketConfig {
  apiKey: string;
  apiSecret: string; // PEM-encoded private key
  symbols: string[]; // e.g., ['BTC-USDT', 'ETH-USDT']
  channels?: ('ticker' | 'level2' | 'user' | 'heartbeats')[];
}

export class CoinbaseWebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: CoinbaseWebSocketConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 15; // Increased from 10 for better resilience
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 60000; // Max 60 seconds between attempts
  private isConnecting = false;
  private shouldReconnect = true;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: Date | null = null;
  private connectionStartTime: Date | null = null;
  private lastMessageTime: Date | null = null; // Track last message for health monitoring
  private messageCount: number = 0; // Track total messages received
  private reconnectTimer: NodeJS.Timeout | null = null; // Track reconnect timer for cleanup

  // Coinbase WebSocket URL
  private readonly WS_URL = 'wss://advanced-trade-ws.coinbase.com';

  constructor(config: CoinbaseWebSocketConfig) {
    super();
    this.config = {
      ...config,
      channels: config.channels || ['ticker', 'level2', 'heartbeats'],
    };
  }

  /**
   * Connect to Coinbase Advanced Trade WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      console.log('[CoinbaseWebSocket] Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.connectionStartTime = new Date();

    try {
      console.log(`[CoinbaseWebSocket] Connecting to ${this.WS_URL}...`);
      this.ws = new WebSocket(this.WS_URL);

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on('error', (error: Error) => this.handleError(error));
      this.ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason));
    } catch (error) {
      console.error('[CoinbaseWebSocket] Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket connection open
   */
  private async handleOpen(): Promise<void> {
    console.log('[CoinbaseWebSocket] ✅ Connected successfully');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.lastMessageTime = new Date();

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Subscribe to channels with JWT authentication
    await this.subscribe();

    // Start heartbeat monitoring
    this.startHeartbeatMonitor();

    // Report to wsHealthMonitor (INFRASTRUCTURE FIX Feb 6, 2026)
    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'connected'); } catch (e) { /* non-critical */ }

    this.emit('connected');
  }

  /**
   * Subscribe to channels with JWT authentication
   */
  private async subscribe(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[CoinbaseWebSocket] Cannot subscribe: WebSocket not open');
      return;
    }

    try {
      // Generate JWT token for authentication
      const jwt = generateCoinbaseWebSocketJWT(this.config.apiKey, this.config.apiSecret);

      // Subscribe to each channel
      for (const channel of this.config.channels!) {
        const subscribeMessage = {
          type: 'subscribe',
          product_ids: this.config.symbols,
          channel,
          jwt, // JWT authentication
        };

        console.log(`[CoinbaseWebSocket] Subscribing to ${channel} for ${this.config.symbols.join(', ')}`);
        this.ws.send(JSON.stringify(subscribeMessage));
      }
    } catch (error) {
      console.error('[CoinbaseWebSocket] Subscription error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      // Track message receipt for health monitoring
      this.lastMessageTime = new Date();
      this.messageCount++;

      // Report to wsHealthMonitor (INFRASTRUCTURE FIX Feb 6, 2026)
      try { wsHealthMonitor.recordMessage('CoinbaseWS'); } catch (e) { /* non-critical */ }

      const message = JSON.parse(data.toString());
      console.log(`[CoinbaseWebSocket] 📨 Received message - Channel: ${message.channel}, Type: ${message.events?.[0]?.type || 'N/A'}`);

      // Handle different message types
      switch (message.channel) {
        case 'ticker':
          this.handleTickerMessage(message);
          break;
        case 'level2':
          this.handleLevel2Message(message);
          break;
        case 'user':
          this.handleUserMessage(message);
          break;
        case 'heartbeats':
          this.handleHeartbeat(message);
          break;
        case 'subscriptions':
          console.log('[CoinbaseWebSocket] Subscription confirmed:', message);
          break;
        default:
          // Unknown message type
          if (message.type === 'error') {
            console.error('[CoinbaseWebSocket] Error message:', message);
            this.emit('error', new Error(message.message || 'Unknown error'));
          }
      }
    } catch (error) {
      console.error('[CoinbaseWebSocket] Message parsing error:', error);
    }
  }

  /**
   * Handle ticker channel messages (real-time price updates)
   */
  private handleTickerMessage(message: any): void {
    if (!message.events || message.events.length === 0) return;

    for (const event of message.events) {
      // Handle both 'snapshot' (initial) and 'update' (ongoing) event types
      if ((event.type === 'snapshot' || event.type === 'update') && event.tickers && event.tickers.length > 0) {
        const tickerData: CoinbaseTickerEvent = {
          type: 'ticker',
          product_id: event.tickers[0].product_id,
          price: event.tickers[0].price,
          volume_24_h: event.tickers[0].volume_24_h,
          low_24_h: event.tickers[0].low_24_h,
          high_24_h: event.tickers[0].high_24_h,
          low_52_w: event.tickers[0].low_52_w,
          high_52_w: event.tickers[0].high_52_w,
          price_percent_chg_24_h: event.tickers[0].price_percent_chg_24_h,
          best_bid: event.tickers[0].best_bid,
          best_ask: event.tickers[0].best_ask,
          timestamp: event.tickers[0].timestamp,
        };

        console.log(`[CoinbaseWebSocket] 📊 Emitting ticker event for ${tickerData.product_id} @ $${tickerData.price}`);
        this.emit('ticker', tickerData);
      }
    }
  }

  /**
   * Handle level2 channel messages (order book updates)
   */
  private handleLevel2Message(message: any): void {
    if (!message.events || message.events.length === 0) return;

    for (const event of message.events) {
      const level2Data: CoinbaseLevel2Event = {
        type: event.type, // 'snapshot' or 'update'
        product_id: event.product_id,
        updates: event.updates || [],
      };

      this.emit('level2', level2Data);
    }
  }

  /**
   * Handle user channel messages (order updates, fills)
   */
  private handleUserMessage(message: any): void {
    if (!message.events || message.events.length === 0) return;

    for (const event of message.events) {
      if (event.type === 'user') {
        const userData: CoinbaseUserEvent = {
          type: 'user',
          orders: event.orders || [],
          fills: event.fills || [],
        };

        // Emit user event with both orders and fills
        this.emit('user', userData);

        // Emit specific events for easier handling
        if (userData.orders && userData.orders.length > 0) {
          for (const order of userData.orders) {
            this.emit('orderUpdate', order);
            console.log(`[CoinbaseWebSocket] Order update: ${order.order_id} - ${order.status}`);
          }
        }

        if (userData.fills && userData.fills.length > 0) {
          for (const fill of userData.fills) {
            this.emit('fill', fill);
            console.log(`[CoinbaseWebSocket] Fill: ${fill.trade_id} - ${fill.size} @ ${fill.price}`);
          }
        }
      }
    }
  }

  /**
   * Handle heartbeat messages (connection health)
   */
  private handleHeartbeat(message: any): void {
    this.lastHeartbeat = new Date();
    this.emit('heartbeat', {
      timestamp: message.timestamp,
      latency: this.getLatency(),
    });
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(error: Error): void {
    console.error('[CoinbaseWebSocket] Error:', error);
    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'error'); } catch (e) { /* non-critical */ }
    this.emit('error', error);
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: Buffer): void {
    console.log(`[CoinbaseWebSocket] Connection closed: ${code} - ${reason.toString()}`);
    this.isConnecting = false;
    this.stopHeartbeatMonitor();
    try { wsHealthMonitor.updateStatus('CoinbaseWS', 'disconnected'); } catch (e) { /* non-critical */ }
    this.emit('disconnected', { code, reason: reason.toString() });

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[CoinbaseWebSocket] Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      // Reset attempts after max reached to allow manual reconnect
      this.reconnectAttempts = 0;
      return;
    }

    this.reconnectAttempts++;
    try { wsHealthMonitor.recordReconnect('CoinbaseWS'); } catch (e) { /* non-critical */ }
    // Exponential backoff with jitter to prevent thundering herd
    const baseDelay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    const delay = baseDelay + jitter;

    console.log(`[CoinbaseWebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Force immediate reconnection (resets attempt counter)
   */
  forceReconnect(): void {
    console.log('[CoinbaseWebSocket] Force reconnect requested');
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Disconnect if connected
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Connect immediately
    this.connect();
  }

  /**
   * Get detailed health status for monitoring
   */
  getHealthStatus(): {
    connected: boolean;
    lastMessageTime: Date | null;
    lastHeartbeat: Date | null;
    messageCount: number;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    connectionUptime: number;
    isHealthy: boolean;
  } {
    const now = getActiveClock().now();
    const connected = this.isConnected();
    const lastMsgAge = this.lastMessageTime ? now - this.lastMessageTime.getTime() : Infinity;
    const lastHbAge = this.lastHeartbeat ? now - this.lastHeartbeat.getTime() : Infinity;
    
    // Consider healthy if connected and received a message in the last 30 seconds
    const isHealthy = connected && lastMsgAge < 30000;

    return {
      connected,
      lastMessageTime: this.lastMessageTime,
      lastHeartbeat: this.lastHeartbeat,
      messageCount: this.messageCount,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      connectionUptime: this.connectionStartTime ? now - this.connectionStartTime.getTime() : 0,
      isHealthy,
    };
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor();

    this.heartbeatInterval = setInterval(() => {
      if (!this.lastHeartbeat) return;

      const timeSinceLastHeartbeat = getActiveClock().now() - this.lastHeartbeat.getTime();
      if (timeSinceLastHeartbeat > 30000) {
        // No heartbeat for 30 seconds
        console.warn('[CoinbaseWebSocket] No heartbeat received for 30 seconds, reconnecting...');
        this.disconnect();
        this.connect();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeatMonitor(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get connection latency
   */
  getLatency(): number {
    if (!this.connectionStartTime) return 0;
    return getActiveClock().now() - this.connectionStartTime.getTime();
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeatMonitor();

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Add symbol to existing subscriptions
   */
  async addSymbol(symbol: string): Promise<void> {
    if (!this.config.symbols.includes(symbol)) {
      this.config.symbols.push(symbol);

      // Re-subscribe with updated symbols
      if (this.isConnected()) {
        await this.subscribe();
      }
    }
  }

  /**
   * Remove symbol from subscriptions
   */
  async removeSymbol(symbol: string): Promise<void> {
    const index = this.config.symbols.indexOf(symbol);
    if (index > -1) {
      this.config.symbols.splice(index, 1);

      // Unsubscribe from removed symbol
      if (this.isConnected() && this.ws) {
        for (const channel of this.config.channels!) {
          const unsubscribeMessage = {
            type: 'unsubscribe',
            product_ids: [symbol],
            channel,
          };
          this.ws.send(JSON.stringify(unsubscribeMessage));
        }
      }
    }
  }
}
