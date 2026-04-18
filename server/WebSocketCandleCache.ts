/**
 * WebSocket Candle Cache
 * 
 * Aggregates WebSocket kline events into historical candle buffers
 * for agent analysis, eliminating the need for REST API calls.
 * 
 * Complies with Binance API rules by using WebSocket streams only.
 */

import { EventEmitter } from 'events';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleBuffer {
  candles: Candle[];
  maxSize: number;
  lastUpdate: number;
}

/**
 * Centralized cache for WebSocket candle data
 * Maintains historical buffers for multiple symbols and timeframes
 */
export class WebSocketCandleCache extends EventEmitter {
  private cache: Map<string, Map<string, CandleBuffer>> = new Map();
  private readonly DEFAULT_BUFFER_SIZE = 500; // Keep 500 candles per timeframe

  constructor() {
    super();
  }

  /**
   * Get cache key for symbol + timeframe
   */
  private getCacheKey(symbol: string, interval: string): string {
    return `${symbol}_${interval}`;
  }

  /**
   * Initialize buffer for a symbol/timeframe pair
   */
  initializeBuffer(symbol: string, interval: string, maxSize: number = this.DEFAULT_BUFFER_SIZE): void {
    if (!this.cache.has(symbol)) {
      this.cache.set(symbol, new Map());
    }

    const symbolCache = this.cache.get(symbol)!;
    if (!symbolCache.has(interval)) {
      symbolCache.set(interval, {
        candles: [],
        maxSize,
        lastUpdate: 0,
      });
      console.log(`[WebSocketCandleCache] Initialized buffer for ${symbol} ${interval} (max: ${maxSize})`);
    }
  }

  /**
   * Add a candle from WebSocket kline event
   */
  addCandle(symbol: string, interval: string, candle: Candle, isClosed: boolean = false): void {
    this.initializeBuffer(symbol, interval);

    const symbolCache = this.cache.get(symbol)!;
    const buffer = symbolCache.get(interval)!;

    // If candle is closed, add to buffer
    if (isClosed) {
      buffer.candles.push(candle);

      // Trim buffer if exceeds max size
      if (buffer.candles.length > buffer.maxSize) {
        buffer.candles.shift();
      }

      buffer.lastUpdate = Date.now();

      // Emit event for new closed candle
      this.emit('candle_closed', { symbol, interval, candle });
    } else {
      // Update the last candle (current forming candle)
      if (buffer.candles.length > 0) {
        const lastCandle = buffer.candles[buffer.candles.length - 1];
        
        // Only update if this is the same timestamp (same candle period)
        if (lastCandle.timestamp === candle.timestamp) {
          lastCandle.high = Math.max(lastCandle.high, candle.high);
          lastCandle.low = Math.min(lastCandle.low, candle.low);
          lastCandle.close = candle.close;
          lastCandle.volume = candle.volume;
        } else {
          // New candle period started
          buffer.candles.push(candle);
          if (buffer.candles.length > buffer.maxSize) {
            buffer.candles.shift();
          }
        }
      } else {
        // First candle
        buffer.candles.push(candle);
      }

      buffer.lastUpdate = Date.now();
    }
  }

  /**
   * Get historical candles for a symbol/timeframe
   * Returns the most recent N candles
   */
  getCandles(symbol: string, interval: string, limit: number = 200): Candle[] {
    const symbolCache = this.cache.get(symbol);
    if (!symbolCache) {
      console.warn(`[WebSocketCandleCache] No data for symbol: ${symbol}`);
      return [];
    }

    const buffer = symbolCache.get(interval);
    if (!buffer) {
      console.warn(`[WebSocketCandleCache] No data for ${symbol} ${interval}`);
      return [];
    }

    // Return the last N candles
    const candles = buffer.candles.slice(-limit);
    
    if (candles.length < limit) {
      console.warn(`[WebSocketCandleCache] Requested ${limit} candles for ${symbol} ${interval}, only ${candles.length} available`);
    }

    return candles;
  }

  /**
   * Get the latest (current) candle
   */
  getLatestCandle(symbol: string, interval: string): Candle | null {
    const candles = this.getCandles(symbol, interval, 1);
    return candles.length > 0 ? candles[0] : null;
  }

  /**
   * Check if we have enough data for analysis
   */
  hasEnoughData(symbol: string, interval: string, requiredCandles: number): boolean {
    const symbolCache = this.cache.get(symbol);
    if (!symbolCache) return false;

    const buffer = symbolCache.get(interval);
    if (!buffer) return false;

    return buffer.candles.length >= requiredCandles;
  }

  /**
   * Get cache statistics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalCandles: 0,
      isAggregatorRunning: false,
      ticksProcessed: 0,
      lastTickTime: null,
      symbols: {},
    };

    for (const [symbol, symbolCache] of Array.from(this.cache.entries())) {
      stats.symbols[symbol] = {};
      for (const [interval, buffer] of Array.from(symbolCache.entries())) {
        stats.symbols[symbol][interval] = {
          candleCount: buffer.candles.length,
          maxSize: buffer.maxSize,
          lastUpdate: buffer.lastUpdate,
          oldestCandle: buffer.candles.length > 0 ? new Date(buffer.candles[0].timestamp) : null,
          newestCandle: buffer.candles.length > 0 ? new Date(buffer.candles[buffer.candles.length - 1].timestamp) : null,
        };
        stats.totalCandles += buffer.candles.length;
      }
    }

    return stats;
  }

  /**
   * Seed historical candles from database (primary) or external source (fallback)
   * Used on startup to populate cache before WebSocket takes over
   */
  async seedHistoricalCandles(symbol: string, interval: string, candles?: Candle[]): Promise<void> {
    this.initializeBuffer(symbol, interval);

    const symbolCache = this.cache.get(symbol)!;
    const buffer = symbolCache.get(interval)!;

    let candlesToSeed: Candle[] = [];

    // Try loading from database first (super fast!)
    if (!candles || candles.length === 0) {
      try {
        const { loadCandlesFromDatabase } = await import('./db/candleStorage');
        candlesToSeed = await loadCandlesFromDatabase(symbol, interval, buffer.maxSize);
        
        if (candlesToSeed.length > 0) {
          console.log(`[WebSocketCandleCache] ⚡ Loaded ${candlesToSeed.length} candles from database for ${symbol} ${interval}`);
        }
      } catch (error) {
        console.error(`[WebSocketCandleCache] Error loading from database:`, error);
      }
    }

    // Fallback to provided candles (from API)
    if (candlesToSeed.length === 0 && candles && candles.length > 0) {
      candlesToSeed = candles;
      console.log(`[WebSocketCandleCache] Using ${candlesToSeed.length} candles from external source for ${symbol} ${interval}`);
    }

    if (candlesToSeed.length === 0) {
      console.warn(`[WebSocketCandleCache] ⚠️  No historical candles available for ${symbol} ${interval}`);
      return;
    }

    // Sort candles by timestamp (oldest first)
    const sortedCandles = candlesToSeed.sort((a, b) => a.timestamp - b.timestamp);

    // Add all candles to buffer
    buffer.candles = sortedCandles.slice(-buffer.maxSize);
    buffer.lastUpdate = Date.now();

    console.log(`[WebSocketCandleCache] ✅ Seeded ${buffer.candles.length} historical candles for ${symbol} ${interval}`);
    this.emit('cache_seeded', { symbol, interval, count: buffer.candles.length });
  }

  /**
   * Clear cache for a symbol
   */
  clearSymbol(symbol: string): void {
    this.cache.delete(symbol);
    console.log(`[WebSocketCandleCache] Cleared cache for ${symbol}`);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
    console.log(`[WebSocketCandleCache] Cleared all cache`);
  }
}

// Singleton instance
let candleCacheInstance: WebSocketCandleCache | null = null;

export function getCandleCache(): WebSocketCandleCache {
  if (!candleCacheInstance) {
    candleCacheInstance = new WebSocketCandleCache();
  }
  return candleCacheInstance;
}

/**
 * Seed candle cache for multiple symbols from database
 * Called on engine startup to populate cache before WebSocket takes over
 */
export async function seedCandleCache(symbols: string[]): Promise<void> {
  const cache = getCandleCache();
  const timeframes = ['1d', '4h', '1h', '5m', '1m'];
  
  console.log(`[seedCandleCache] Seeding cache for ${symbols.length} symbols across ${timeframes.length} timeframes...`);
  
  let totalSeeded = 0;
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      try {
        await cache.seedHistoricalCandles(symbol, timeframe);
        totalSeeded++;
      } catch (error) {
        console.error(`[seedCandleCache] Failed to seed ${symbol} ${timeframe}:`, error);
      }
    }
  }
  
  console.log(`[seedCandleCache] ✅ Successfully seeded ${totalSeeded}/${symbols.length * timeframes.length} symbol-timeframe pairs`);
  
  // Log cache stats
  const stats = cache.getStats();
  for (const [symbol, timeframes] of Object.entries(stats)) {
    console.log(`[seedCandleCache] ${symbol}:`, Object.entries(timeframes as Record<string, any>).map(([tf, data]: [string, any]) => `${tf}=${data.candleCount}`).join(', '));
  }
}
