/**
 * Tick-to-Candle Aggregator
 * 
 * Builds OHLCV candles from WebSocket tick data in real-time.
 * Essential for Coinbase which doesn't provide kline/candle streams.
 * 
 * Architecture:
 * - Receives price ticks from WebSocket
 * - Aggregates into candles for multiple timeframes (1m, 5m, 1h, 4h, 1d)
 * - Automatically closes candles at interval boundaries
 * - Persists closed candles to database for historical data
 * - Updates WebSocket candle cache for agent consumption
 */

import { EventEmitter } from 'events';
import { getCandleCache, type Candle } from '../WebSocketCandleCache';

interface ActiveCandle {
  timestamp: number;  // Start of candle period (aligned to interval)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
}

interface TimeframeConfig {
  interval: string;
  durationMs: number;
}

const TIMEFRAMES: TimeframeConfig[] = [
  { interval: '1m', durationMs: 60 * 1000 },
  { interval: '5m', durationMs: 5 * 60 * 1000 },
  { interval: '1h', durationMs: 60 * 60 * 1000 },
  { interval: '4h', durationMs: 4 * 60 * 60 * 1000 },
  { interval: '1d', durationMs: 24 * 60 * 60 * 1000 },
];

export class TickToCandleAggregator extends EventEmitter {
  private activeCandles: Map<string, Map<string, ActiveCandle>> = new Map(); // symbol -> interval -> candle
  private lastTickTime: Map<string, number> = new Map();
  private candleCloseTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private candleCache = getCandleCache();
  
  constructor() {
    super();
  }

  /**
   * Start the aggregator
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[TickToCandleAggregator] Started');
  }

  /**
   * Stop the aggregator
   */
  stop(): void {
    this.isRunning = false;
    // Clear all timers
    for (const timer of this.candleCloseTimers.values()) {
      clearTimeout(timer);
    }
    this.candleCloseTimers.clear();
    console.log('[TickToCandleAggregator] Stopped');
  }

  /**
   * Process a price tick from WebSocket
   */
  processTick(symbol: string, price: number, volume: number = 0, timestamp: number = Date.now()): void {
    if (!this.isRunning) return;
    
    // Update last tick time
    this.lastTickTime.set(symbol, timestamp);
    
    // Initialize symbol candles if needed
    if (!this.activeCandles.has(symbol)) {
      this.activeCandles.set(symbol, new Map());
      this.initializeSymbolCandles(symbol, price, timestamp);
    }
    
    const symbolCandles = this.activeCandles.get(symbol)!;
    
    // Update each timeframe
    for (const tf of TIMEFRAMES) {
      const candleStart = this.alignTimestamp(timestamp, tf.durationMs);
      let candle = symbolCandles.get(tf.interval);
      
      // Check if we need to close the current candle and start a new one
      if (candle && candle.timestamp < candleStart) {
        // Close the old candle
        this.closeCandle(symbol, tf.interval, candle);
        candle = undefined;
      }
      
      if (!candle) {
        // Start a new candle
        candle = {
          timestamp: candleStart,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
          tickCount: 1,
        };
        symbolCandles.set(tf.interval, candle);
        
        // Schedule candle close
        this.scheduleCandelClose(symbol, tf.interval, candleStart + tf.durationMs);
      } else {
        // Update existing candle
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.volume += volume;
        candle.tickCount++;
      }
      
      // Update the WebSocket candle cache with the current (forming) candle
      this.candleCache.addCandle(symbol, tf.interval, {
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }, false); // false = candle is still forming
    }
  }

  /**
   * Initialize candles for a new symbol
   */
  private initializeSymbolCandles(symbol: string, price: number, timestamp: number): void {
    const symbolCandles = this.activeCandles.get(symbol)!;
    
    for (const tf of TIMEFRAMES) {
      const candleStart = this.alignTimestamp(timestamp, tf.durationMs);
      symbolCandles.set(tf.interval, {
        timestamp: candleStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        tickCount: 1,
      });
      
      // Initialize cache buffer
      this.candleCache.initializeBuffer(symbol, tf.interval, 500);
      
      // Schedule candle close
      this.scheduleCandelClose(symbol, tf.interval, candleStart + tf.durationMs);
    }
    
    console.log(`[TickToCandleAggregator] Initialized candles for ${symbol}`);
  }

  /**
   * Align timestamp to interval boundary
   */
  private alignTimestamp(timestamp: number, durationMs: number): number {
    return Math.floor(timestamp / durationMs) * durationMs;
  }

  /**
   * Schedule a candle to close at a specific time
   */
  private scheduleCandelClose(symbol: string, interval: string, closeTime: number): void {
    const key = `${symbol}_${interval}`;
    
    // Clear existing timer
    const existingTimer = this.candleCloseTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const delay = Math.max(0, closeTime - Date.now());
    
    const timer = setTimeout(() => {
      this.forceCloseCandle(symbol, interval);
    }, delay);
    
    this.candleCloseTimers.set(key, timer);
  }

  /**
   * Force close a candle (called by timer)
   */
  private forceCloseCandle(symbol: string, interval: string): void {
    const symbolCandles = this.activeCandles.get(symbol);
    if (!symbolCandles) return;
    
    const candle = symbolCandles.get(interval);
    if (!candle) return;
    
    this.closeCandle(symbol, interval, candle);
    
    // Start a new candle with the last known price
    const lastPrice = candle.close;
    const tf = TIMEFRAMES.find(t => t.interval === interval)!;
    const newCandleStart = this.alignTimestamp(Date.now(), tf.durationMs);
    
    symbolCandles.set(interval, {
      timestamp: newCandleStart,
      open: lastPrice,
      high: lastPrice,
      low: lastPrice,
      close: lastPrice,
      volume: 0,
      tickCount: 0,
    });
    
    // Schedule next close
    this.scheduleCandelClose(symbol, interval, newCandleStart + tf.durationMs);
  }

  /**
   * Close a candle and persist it
   */
  private closeCandle(symbol: string, interval: string, candle: ActiveCandle): void {
    // Add closed candle to cache
    this.candleCache.addCandle(symbol, interval, {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }, true); // true = candle is closed
    
    // Emit event for persistence
    this.emit('candle_closed', {
      symbol,
      interval,
      candle: {
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
      tickCount: candle.tickCount,
    });
    
    // Log only for 1m candles to avoid spam
    if (interval === '1m') {
      console.log(`[TickToCandleAggregator] 📊 Closed ${symbol} ${interval} candle: O=${candle.open.toFixed(2)} H=${candle.high.toFixed(2)} L=${candle.low.toFixed(2)} C=${candle.close.toFixed(2)} (${candle.tickCount} ticks)`);
    }
  }

  /**
   * Get current candle for a symbol/interval
   */
  getCurrentCandle(symbol: string, interval: string): ActiveCandle | undefined {
    return this.activeCandles.get(symbol)?.get(interval);
  }

  /**
   * Get aggregator statistics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      isRunning: this.isRunning,
      symbols: [],
    };
    
    for (const [symbol, candles] of this.activeCandles.entries()) {
      const symbolStats: Record<string, any> = {
        symbol,
        lastTick: this.lastTickTime.get(symbol),
        timeframes: {},
      };
      
      for (const [interval, candle] of candles.entries()) {
        symbolStats.timeframes[interval] = {
          timestamp: new Date(candle.timestamp).toISOString(),
          tickCount: candle.tickCount,
          ohlc: `O=${candle.open.toFixed(2)} H=${candle.high.toFixed(2)} L=${candle.low.toFixed(2)} C=${candle.close.toFixed(2)}`,
        };
      }
      
      stats.symbols.push(symbolStats);
    }
    
    return stats;
  }
}

// Singleton instance
let aggregatorInstance: TickToCandleAggregator | null = null;

export function getTickToCandleAggregator(): TickToCandleAggregator {
  if (!aggregatorInstance) {
    aggregatorInstance = new TickToCandleAggregator();
  }
  return aggregatorInstance;
}
