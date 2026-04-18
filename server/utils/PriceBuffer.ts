/**
 * Memory-Optimized Price Buffer for HFT-Grade Trading
 * 
 * Uses typed arrays (Float64Array, BigInt64Array) for:
 * - Minimal memory footprint (~16 bytes per tick vs ~100+ bytes for objects)
 * - Cache-friendly contiguous memory layout
 * - O(1) push operations with circular buffer
 * - Zero garbage collection pressure
 * 
 * Performance target: < 0.01ms per operation
 * Memory target: 160KB for 10,000 ticks (vs 1MB+ for object arrays)
 */

export interface PriceBufferStats {
  count: number;
  capacity: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  vwap: number;
  sma: number;
  volatility: number;
  high: number;
  low: number;
  memoryUsageBytes: number;
}

export interface PriceTick {
  price: number;
  timestamp: number;
  volume?: number;
}

export class PriceBuffer {
  // Typed arrays for memory efficiency
  private prices: Float64Array;
  private timestamps: BigInt64Array;
  private volumes: Float64Array;
  
  // Circular buffer state
  private head: number = 0;  // Next write position
  private count: number = 0; // Number of valid entries
  private readonly capacity: number;
  
  // Pre-computed statistics (updated incrementally)
  private _sum: number = 0;
  private _volumeSum: number = 0;
  private _priceVolumeSum: number = 0;
  private _high: number = -Infinity;
  private _low: number = Infinity;
  private _sumSquares: number = 0;
  
  // Symbol identifier
  public readonly symbol: string;
  
  /**
   * Create a new PriceBuffer
   * @param symbol Trading symbol (e.g., "BTC-USD")
   * @param capacity Maximum number of ticks to store (default 10,000)
   */
  constructor(symbol: string, capacity: number = 10000) {
    this.symbol = symbol;
    this.capacity = capacity;
    
    // Allocate typed arrays
    this.prices = new Float64Array(capacity);
    this.timestamps = new BigInt64Array(capacity);
    this.volumes = new Float64Array(capacity);
    
    console.log(`[PriceBuffer] Created buffer for ${symbol} with capacity ${capacity} (${this.getMemoryUsage()} bytes)`);
  }
  
  /**
   * Push a new price tick into the buffer
   * O(1) operation with circular buffer
   */
  push(price: number, timestamp: number = Date.now(), volume: number = 0): void {
    // If buffer is full, we need to remove the oldest value from statistics
    if (this.count === this.capacity) {
      const oldIndex = this.head;
      const oldPrice = this.prices[oldIndex];
      const oldVolume = this.volumes[oldIndex];
      
      // Remove old values from running statistics
      this._sum -= oldPrice;
      this._volumeSum -= oldVolume;
      this._priceVolumeSum -= oldPrice * oldVolume;
      this._sumSquares -= oldPrice * oldPrice;
    }
    
    // Write new values
    this.prices[this.head] = price;
    this.timestamps[this.head] = BigInt(timestamp);
    this.volumes[this.head] = volume;
    
    // Update running statistics
    this._sum += price;
    this._volumeSum += volume;
    this._priceVolumeSum += price * volume;
    this._sumSquares += price * price;
    
    // Update high/low (need to recalculate if we overwrote the old high/low)
    if (price > this._high) this._high = price;
    if (price < this._low) this._low = price;
    
    // Advance head pointer (circular)
    this.head = (this.head + 1) % this.capacity;
    
    // Increment count (up to capacity)
    if (this.count < this.capacity) {
      this.count++;
    }
  }
  
  /**
   * Push multiple ticks at once (batch operation)
   */
  pushBatch(ticks: PriceTick[]): void {
    for (const tick of ticks) {
      this.push(tick.price, tick.timestamp, tick.volume || 0);
    }
  }
  
  /**
   * Get the most recent price
   */
  getLatestPrice(): number | null {
    if (this.count === 0) return null;
    const index = (this.head - 1 + this.capacity) % this.capacity;
    return this.prices[index];
  }
  
  /**
   * Get the most recent timestamp
   */
  getLatestTimestamp(): number | null {
    if (this.count === 0) return null;
    const index = (this.head - 1 + this.capacity) % this.capacity;
    return Number(this.timestamps[index]);
  }
  
  /**
   * Get the oldest timestamp in the buffer
   */
  getOldestTimestamp(): number | null {
    if (this.count === 0) return null;
    const index = this.count < this.capacity 
      ? 0 
      : this.head;
    return Number(this.timestamps[index]);
  }
  
  /**
   * Get price at a specific index (0 = oldest, count-1 = newest)
   */
  getPriceAt(index: number): number | null {
    if (index < 0 || index >= this.count) return null;
    const actualIndex = this.count < this.capacity
      ? index
      : (this.head + index) % this.capacity;
    return this.prices[actualIndex];
  }
  
  /**
   * Get the last N prices as a regular array
   * Useful for technical indicator calculations
   */
  getLastNPrices(n: number): number[] {
    const count = Math.min(n, this.count);
    const result: number[] = new Array(count);
    
    for (let i = 0; i < count; i++) {
      const index = (this.head - count + i + this.capacity) % this.capacity;
      result[i] = this.prices[index];
    }
    
    return result;
  }
  
  /**
   * Calculate Simple Moving Average
   * Uses pre-computed sum for O(1) calculation
   */
  getSMA(): number {
    if (this.count === 0) return 0;
    return this._sum / this.count;
  }
  
  /**
   * Calculate SMA for last N periods
   */
  getSMAForPeriod(periods: number): number {
    const prices = this.getLastNPrices(periods);
    if (prices.length === 0) return 0;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }
  
  /**
   * Calculate Volume-Weighted Average Price (VWAP)
   * Uses pre-computed sums for O(1) calculation
   */
  getVWAP(): number {
    if (this._volumeSum === 0) {
      // If no volume data, return simple average
      return this.getSMA();
    }
    return this._priceVolumeSum / this._volumeSum;
  }
  
  /**
   * Calculate price volatility (standard deviation)
   * Uses pre-computed sum of squares for O(1) calculation
   */
  getVolatility(): number {
    if (this.count < 2) return 0;
    
    const mean = this._sum / this.count;
    const variance = (this._sumSquares / this.count) - (mean * mean);
    
    return Math.sqrt(Math.max(0, variance));
  }
  
  /**
   * Calculate volatility as percentage of current price
   */
  getVolatilityPercent(): number {
    const latestPrice = this.getLatestPrice();
    if (!latestPrice || latestPrice === 0) return 0;
    return (this.getVolatility() / latestPrice) * 100;
  }
  
  /**
   * Get the high price in the buffer
   * Note: May need recalculation after buffer wraps
   */
  getHigh(): number {
    if (this.count === 0) return 0;
    
    // Recalculate if buffer has wrapped (high might have been overwritten)
    if (this.count === this.capacity) {
      this._high = -Infinity;
      for (let i = 0; i < this.count; i++) {
        if (this.prices[i] > this._high) this._high = this.prices[i];
      }
    }
    
    return this._high;
  }
  
  /**
   * Get the low price in the buffer
   * Note: May need recalculation after buffer wraps
   */
  getLow(): number {
    if (this.count === 0) return 0;
    
    // Recalculate if buffer has wrapped (low might have been overwritten)
    if (this.count === this.capacity) {
      this._low = Infinity;
      for (let i = 0; i < this.count; i++) {
        if (this.prices[i] < this._low) this._low = this.prices[i];
      }
    }
    
    return this._low;
  }
  
  /**
   * Get price range (high - low)
   */
  getRange(): number {
    return this.getHigh() - this.getLow();
  }
  
  /**
   * Get price change from oldest to newest
   */
  getPriceChange(): number {
    if (this.count < 2) return 0;
    
    const oldest = this.getPriceAt(0);
    const newest = this.getLatestPrice();
    
    if (oldest === null || newest === null) return 0;
    return newest - oldest;
  }
  
  /**
   * Get price change as percentage
   */
  getPriceChangePercent(): number {
    if (this.count < 2) return 0;
    
    const oldest = this.getPriceAt(0);
    const newest = this.getLatestPrice();
    
    if (oldest === null || newest === null || oldest === 0) return 0;
    return ((newest - oldest) / oldest) * 100;
  }
  
  /**
   * Calculate Exponential Moving Average
   */
  getEMA(periods: number): number {
    const prices = this.getLastNPrices(periods);
    if (prices.length === 0) return 0;
    
    const multiplier = 2 / (periods + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  /**
   * Calculate momentum (rate of change)
   */
  getMomentum(periods: number = 10): number {
    if (this.count < periods) return 0;
    
    const current = this.getLatestPrice();
    const past = this.getPriceAt(this.count - periods);
    
    if (current === null || past === null || past === 0) return 0;
    return ((current - past) / past) * 100;
  }
  
  /**
   * Get buffer statistics
   */
  getStats(): PriceBufferStats {
    return {
      count: this.count,
      capacity: this.capacity,
      oldestTimestamp: this.getOldestTimestamp() || 0,
      newestTimestamp: this.getLatestTimestamp() || 0,
      vwap: this.getVWAP(),
      sma: this.getSMA(),
      volatility: this.getVolatility(),
      high: this.getHigh(),
      low: this.getLow(),
      memoryUsageBytes: this.getMemoryUsage(),
    };
  }
  
  /**
   * Get memory usage in bytes
   */
  getMemoryUsage(): number {
    // Float64Array: 8 bytes per element
    // BigInt64Array: 8 bytes per element
    return (this.capacity * 8) + (this.capacity * 8) + (this.capacity * 8);
  }
  
  /**
   * Get fill percentage
   */
  getFillPercent(): number {
    return (this.count / this.capacity) * 100;
  }
  
  /**
   * Clear the buffer
   */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this._sum = 0;
    this._volumeSum = 0;
    this._priceVolumeSum = 0;
    this._high = -Infinity;
    this._low = Infinity;
    this._sumSquares = 0;
    
    // Zero out arrays (optional, for security)
    this.prices.fill(0);
    this.timestamps.fill(BigInt(0));
    this.volumes.fill(0);
  }
  
  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.count === 0;
  }
  
  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.count === this.capacity;
  }
  
  /**
   * Get the number of ticks in the buffer
   */
  getCount(): number {
    return this.count;
  }
  
  /**
   * Get the capacity of the buffer
   */
  getCapacity(): number {
    return this.capacity;
  }
}

/**
 * Multi-symbol price buffer manager
 * Manages multiple PriceBuffers for different trading symbols
 */
export class PriceBufferManager {
  private buffers: Map<string, PriceBuffer> = new Map();
  private readonly defaultCapacity: number;
  
  constructor(defaultCapacity: number = 10000) {
    this.defaultCapacity = defaultCapacity;
  }
  
  /**
   * Get or create a buffer for a symbol
   */
  getBuffer(symbol: string): PriceBuffer {
    let buffer = this.buffers.get(symbol);
    if (!buffer) {
      buffer = new PriceBuffer(symbol, this.defaultCapacity);
      this.buffers.set(symbol, buffer);
    }
    return buffer;
  }
  
  /**
   * Push a price tick for a symbol
   */
  push(symbol: string, price: number, timestamp?: number, volume?: number): void {
    this.getBuffer(symbol).push(price, timestamp, volume);
  }
  
  /**
   * Get latest price for a symbol
   */
  getLatestPrice(symbol: string): number | null {
    const buffer = this.buffers.get(symbol);
    return buffer?.getLatestPrice() ?? null;
  }
  
  /**
   * Get VWAP for a symbol
   */
  getVWAP(symbol: string): number {
    const buffer = this.buffers.get(symbol);
    return buffer?.getVWAP() ?? 0;
  }
  
  /**
   * Get volatility for a symbol
   */
  getVolatility(symbol: string): number {
    const buffer = this.buffers.get(symbol);
    return buffer?.getVolatility() ?? 0;
  }
  
  /**
   * Get all managed symbols
   */
  getSymbols(): string[] {
    return Array.from(this.buffers.keys());
  }
  
  /**
   * Get total memory usage across all buffers
   */
  getTotalMemoryUsage(): number {
    let total = 0;
    for (const buffer of this.buffers.values()) {
      total += buffer.getMemoryUsage();
    }
    return total;
  }
  
  /**
   * Get stats for all buffers
   */
  getAllStats(): Record<string, PriceBufferStats> {
    const stats: Record<string, PriceBufferStats> = {};
    for (const [symbol, buffer] of this.buffers) {
      stats[symbol] = buffer.getStats();
    }
    return stats;
  }
  
  /**
   * Clear all buffers
   */
  clearAll(): void {
    for (const buffer of this.buffers.values()) {
      buffer.clear();
    }
  }
  
  /**
   * Remove a buffer for a symbol
   */
  removeBuffer(symbol: string): boolean {
    return this.buffers.delete(symbol);
  }
}

// Singleton instance for global access
let globalPriceBufferManager: PriceBufferManager | null = null;

export function getPriceBufferManager(capacity?: number): PriceBufferManager {
  if (!globalPriceBufferManager) {
    globalPriceBufferManager = new PriceBufferManager(capacity);
  }
  return globalPriceBufferManager;
}
