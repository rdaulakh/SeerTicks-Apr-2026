import EventEmitter from "eventemitter3";
import { ExchangeInterface, NormalizedTick } from "../exchanges";
import { RedisHelpers } from "./redisClient";

/**
 * WebSocket Manager
 * Manages multiple WebSocket connections for real-time market data streaming
 */

export interface StreamConfig {
  userId: number;
  exchange: ExchangeInterface;
  symbol: string;
}

export interface TickEvent {
  userId: number;
  exchange: string;
  symbol: string;
  tick: NormalizedTick;
}

/**
 * WebSocket Manager Events
 */
export enum WSManagerEvents {
  TICK = "tick",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

/**
 * Manages WebSocket connections for multiple symbols across exchanges
 */
export class WebSocketManager extends EventEmitter {
  private activeStreams: Map<string, StreamConfig> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor() {
    super();
  }

  /**
   * Generate unique stream key
   */
  private getStreamKey(userId: number, exchange: string, symbol: string): string {
    return `${userId}:${exchange}:${symbol}`;
  }

  /**
   * Subscribe to a symbol's real-time data
   */
  async subscribe(config: StreamConfig): Promise<void> {
    const { userId, exchange, symbol } = config;
    const streamKey = this.getStreamKey(userId, exchange.getExchangeName(), symbol);

    // Check if already subscribed
    if (this.activeStreams.has(streamKey)) {
      console.log(`[WSManager] Already subscribed to ${streamKey}`);
      return;
    }

    try {
      console.log(`[WSManager] Subscribing to ${streamKey}`);

      // Connect to exchange WebSocket
      await exchange.connectWebSocket(symbol, (tick: NormalizedTick) => {
        this.handleTick(userId, exchange.getExchangeName(), symbol, tick);
      });

      // Store active stream
      this.activeStreams.set(streamKey, config);
      this.reconnectAttempts.set(streamKey, 0);

      // Emit connected event
      this.emit(WSManagerEvents.CONNECTED, { userId, exchange: exchange.getExchangeName(), symbol });

      console.log(`[WSManager] Successfully subscribed to ${streamKey}`);
    } catch (error) {
      console.error(`[WSManager] Failed to subscribe to ${streamKey}:`, error);
      this.emit(WSManagerEvents.ERROR, { userId, exchange: exchange.getExchangeName(), symbol, error });
      
      // Attempt to reconnect
      await this.attemptReconnect(streamKey, config);
    }
  }

  /**
   * Unsubscribe from a symbol's real-time data
   */
  async unsubscribe(userId: number, exchangeName: string, symbol: string): Promise<void> {
    const streamKey = this.getStreamKey(userId, exchangeName, symbol);
    const config = this.activeStreams.get(streamKey);

    if (!config) {
      console.log(`[WSManager] No active subscription for ${streamKey}`);
      return;
    }

    try {
      console.log(`[WSManager] Unsubscribing from ${streamKey}`);

      // Disconnect WebSocket
      await config.exchange.disconnectWebSocket();

      // Remove from active streams
      this.activeStreams.delete(streamKey);
      this.reconnectAttempts.delete(streamKey);

      // Emit disconnected event
      this.emit(WSManagerEvents.DISCONNECTED, { userId, exchange: exchangeName, symbol });

      console.log(`[WSManager] Successfully unsubscribed from ${streamKey}`);
    } catch (error) {
      console.error(`[WSManager] Failed to unsubscribe from ${streamKey}:`, error);
    }
  }

  /**
   * Handle incoming tick data
   */
  private async handleTick(
    userId: number,
    exchange: string,
    symbol: string,
    tick: NormalizedTick
  ): Promise<void> {
    try {
      // Store tick in Redis
      await RedisHelpers.storeTick(exchange, symbol, tick);
      await RedisHelpers.addToTickHistory(exchange, symbol, tick);

      // Emit tick event for downstream processing
      const tickEvent: TickEvent = {
        userId,
        exchange,
        symbol,
        tick,
      };

      this.emit(WSManagerEvents.TICK, tickEvent);
    } catch (error) {
      console.error(`[WSManager] Error handling tick for ${exchange}:${symbol}:`, error);
    }
  }

  /**
   * Attempt to reconnect to a failed stream
   */
  private async attemptReconnect(streamKey: string, config: StreamConfig): Promise<void> {
    const attempts = this.reconnectAttempts.get(streamKey) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WSManager] Max reconnect attempts reached for ${streamKey}`);
      this.activeStreams.delete(streamKey);
      this.reconnectAttempts.delete(streamKey);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempts), 30000); // Exponential backoff, max 30s
    console.log(`[WSManager] Reconnecting to ${streamKey} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(async () => {
      this.reconnectAttempts.set(streamKey, attempts + 1);
      await this.subscribe(config);
    }, delay);
  }

  /**
   * Get all active streams
   */
  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  /**
   * Check if a stream is active
   */
  isStreamActive(userId: number, exchangeName: string, symbol: string): boolean {
    const streamKey = this.getStreamKey(userId, exchangeName, symbol);
    return this.activeStreams.has(streamKey);
  }

  /**
   * Unsubscribe from all streams
   */
  async unsubscribeAll(): Promise<void> {
    console.log("[WSManager] Unsubscribing from all streams");

    const unsubscribePromises = Array.from(this.activeStreams.entries()).map(([key, config]) => {
      const [userId, exchangeName, symbol] = key.split(":");
      return this.unsubscribe(parseInt(userId), exchangeName, symbol);
    });

    await Promise.all(unsubscribePromises);
    console.log("[WSManager] All streams unsubscribed");
  }

  /**
   * Get stream statistics
   */
  getStats(): {
    activeStreams: number;
    streamKeys: string[];
  } {
    return {
      activeStreams: this.activeStreams.size,
      streamKeys: Array.from(this.activeStreams.keys()),
    };
  }
}

// Singleton instance
let wsManagerInstance: WebSocketManager | null = null;

/**
 * Get WebSocket Manager singleton instance
 */
export function getWSManager(): WebSocketManager {
  if (!wsManagerInstance) {
    wsManagerInstance = new WebSocketManager();
  }
  return wsManagerInstance;
}

/**
 * Close WebSocket Manager and all connections
 */
export async function closeWSManager(): Promise<void> {
  if (wsManagerInstance) {
    await wsManagerInstance.unsubscribeAll();
    wsManagerInstance.removeAllListeners();
    wsManagerInstance = null;
    console.log("[WSManager] Closed successfully");
  }
}
