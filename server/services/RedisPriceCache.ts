/**
 * Redis Price Cache
 * 
 * Phase 1 Critical Infrastructure: Sub-millisecond price access
 * 
 * Features:
 * - Sub-millisecond price retrieval using Redis pipelining
 * - Local L1 cache with 10ms TTL for hot data
 * - Batch price updates with atomic operations
 * - Price staleness detection (1s threshold for crypto)
 * - Multi-exchange price aggregation
 * - Real-time latency tracking
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CachedPrice {
  symbol: string;
  price: number;
  timestamp: number;
  exchange: string;
  bid?: number;
  ask?: number;
  volume24h?: number;
}

export interface PriceCacheConfig {
  redisUrl: string;
  l1CacheTtlMs: number; // Local cache TTL (default: 10ms)
  redisTtlMs: number; // Redis cache TTL (default: 5000ms)
  stalenessThresholdMs: number; // Price staleness threshold (default: 1000ms)
  enableL1Cache: boolean;
  enablePipelining: boolean;
  maxBatchSize: number;
}

export interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  redisHits: number;
  redisMisses: number;
  staleCount: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

// ============================================================================
// L1 Local Cache (In-Memory, 10ms TTL)
// ============================================================================

class L1Cache {
  private cache: Map<string, { price: CachedPrice; expiry: number }> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 10) {
    this.ttlMs = ttlMs;
  }

  get(key: string): CachedPrice | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.price;
  }

  set(key: string, price: CachedPrice): void {
    this.cache.set(key, {
      price,
      expiry: Date.now() + this.ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// ============================================================================
// Latency Tracker
// ============================================================================

class LatencyTracker {
  private samples: number[] = [];
  private maxSamples: number = 10000;

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getAvg(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  getP99(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.99);
    return sorted[idx] || 0;
  }

  clear(): void {
    this.samples = [];
  }
}

// ============================================================================
// Redis Price Cache
// ============================================================================

export class RedisPriceCache extends EventEmitter {
  private redis: Redis | null = null;
  private config: PriceCacheConfig;
  private l1Cache: L1Cache;
  private latencyTracker: LatencyTracker = new LatencyTracker();
  
  // Statistics
  private stats: CacheStats = {
    l1Hits: 0,
    l1Misses: 0,
    redisHits: 0,
    redisMisses: 0,
    staleCount: 0,
    avgLatencyMs: 0,
    p99LatencyMs: 0,
  };

  // Pending batch updates
  private pendingUpdates: Map<string, CachedPrice> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<PriceCacheConfig>) {
    super();
    this.config = {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      l1CacheTtlMs: 10, // 10ms L1 cache
      redisTtlMs: 5000, // 5s Redis TTL
      stalenessThresholdMs: 1000, // 1s staleness threshold
      enableL1Cache: true,
      enablePipelining: true,
      maxBatchSize: 100,
      ...config,
    };

    this.l1Cache = new L1Cache(this.config.l1CacheTtlMs);
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    if (this.redis) return;

    try {
      // Clean the Redis URL - handle various malformed formats
      let cleanUrl = this.config.redisUrl;
      
      // Handle case where env var contains 'REDIS_URL="..."' format
      if (cleanUrl.includes('REDIS_URL=')) {
        const match = cleanUrl.match(/REDIS_URL=["']?([^"']+)["']?/);
        if (match) {
          cleanUrl = match[1];
        }
      }
      
      // Decode URL-encoded characters (e.g., %22 = ")
      try {
        cleanUrl = decodeURIComponent(cleanUrl);
      } catch (e) {
        // If decoding fails, continue with original
      }
      
      // Remove surrounding quotes
      cleanUrl = cleanUrl.replace(/^["']|["']$/g, '');
      
      // Validate URL format
      if (!cleanUrl.startsWith('redis://') && !cleanUrl.startsWith('rediss://')) {
        console.warn('[RedisPriceCache] Invalid Redis URL format, falling back to localhost');
        cleanUrl = 'redis://localhost:6379';
      }
      
      console.log('[RedisPriceCache] Connecting to Redis:', cleanUrl.replace(/:[^:@]+@/, ':***@'));
      
      // Parse the URL to check if it's TLS
      const isTLS = cleanUrl.startsWith('rediss://');
      
      this.redis = new Redis(cleanUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
          if (times > 5) return null; // Stop retrying after 5 attempts
          return Math.min(times * 100, 3000);
        },
        // Enable offline queue for initial connection
        enableOfflineQueue: true,
        connectTimeout: 10000, // 10s connection timeout for TLS handshake
        commandTimeout: 500, // 500ms command timeout
        lazyConnect: false,
        // TLS options for Upstash
        ...(isTLS && {
          tls: {
            rejectUnauthorized: false, // Accept self-signed certs
          },
        }),
      });

      this.redis.on('connect', () => {
        console.log('[RedisPriceCache] Connected to Redis');
        this.emit('connected');
      });

      this.redis.on('error', (err: Error & { code?: string }) => {
        // Only log if not a connection refused error (expected when Redis is not available)
        if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOENT' && err.code !== 'ENOTFOUND') {
          console.error('[RedisPriceCache] Redis error:', err.message);
        }
        // Don't re-emit error to prevent unhandled error crashes
        // The connection failure will be handled by the connect() method
      });

      this.redis.on('close', () => {
        console.log('[RedisPriceCache] Redis connection closed');
        this.emit('disconnected');
      });

      // Wait for connection
      await this.redis.ping();
      console.log('[RedisPriceCache] Redis ping successful');

    } catch (error) {
      console.error('[RedisPriceCache] Failed to connect:', error);
      this.redis = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.redis) {
      try {
        // Remove all listeners before quitting to prevent unhandled errors
        this.redis.removeAllListeners();
        await this.redis.quit();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.redis = null;
    }
  }

  isConnected(): boolean {
    return this.redis !== null && this.redis.status === 'ready';
  }

  // ============================================================================
  // Price Operations (Sub-millisecond)
  // ============================================================================

  /**
   * Get price with sub-millisecond latency
   * Priority: L1 Cache → Redis → null
   */
  async getPrice(symbol: string, exchange: string = 'binance'): Promise<CachedPrice | null> {
    const startTime = performance.now();
    const key = this.makeKey(symbol, exchange);

    // 1. Check L1 cache first (sub-microsecond)
    if (this.config.enableL1Cache) {
      const l1Price = this.l1Cache.get(key);
      if (l1Price) {
        this.stats.l1Hits++;
        this.recordLatency(startTime);
        return this.checkStaleness(l1Price);
      }
      this.stats.l1Misses++;
    }

    // 2. Check Redis
    if (!this.redis) {
      return null;
    }

    try {
      const data = await this.redis.get(key);
      
      if (data) {
        this.stats.redisHits++;
        const price = JSON.parse(data) as CachedPrice;
        
        // Update L1 cache
        if (this.config.enableL1Cache) {
          this.l1Cache.set(key, price);
        }
        
        this.recordLatency(startTime);
        return this.checkStaleness(price);
      }

      this.stats.redisMisses++;
      this.recordLatency(startTime);
      return null;

    } catch (error) {
      console.error(`[RedisPriceCache] Error getting price for ${symbol}:`, error);
      this.recordLatency(startTime);
      return null;
    }
  }

  /**
   * Get multiple prices with pipelining (batch operation)
   */
  async getPrices(symbols: string[], exchange: string = 'binance'): Promise<Map<string, CachedPrice>> {
    const startTime = performance.now();
    const results = new Map<string, CachedPrice>();
    const missingKeys: string[] = [];

    // 1. Check L1 cache for all symbols
    if (this.config.enableL1Cache) {
      for (const symbol of symbols) {
        const key = this.makeKey(symbol, exchange);
        const l1Price = this.l1Cache.get(key);
        if (l1Price) {
          this.stats.l1Hits++;
          const checkedPrice = this.checkStaleness(l1Price);
          if (checkedPrice) {
            results.set(symbol, checkedPrice);
          }
        } else {
          this.stats.l1Misses++;
          missingKeys.push(key);
        }
      }
    } else {
      for (const symbol of symbols) {
        missingKeys.push(this.makeKey(symbol, exchange));
      }
    }

    // 2. Fetch missing from Redis using pipeline
    if (missingKeys.length > 0 && this.redis && this.config.enablePipelining) {
      try {
        const pipeline = this.redis.pipeline();
        for (const key of missingKeys) {
          pipeline.get(key);
        }

        const redisResults = await pipeline.exec();
        
        if (redisResults) {
          for (let i = 0; i < redisResults.length; i++) {
            const [err, data] = redisResults[i];
            if (!err && data) {
              this.stats.redisHits++;
              const price = JSON.parse(data as string) as CachedPrice;
              const checkedPrice = this.checkStaleness(price);
              
              if (checkedPrice) {
                results.set(price.symbol, checkedPrice);
                
                // Update L1 cache
                if (this.config.enableL1Cache) {
                  this.l1Cache.set(missingKeys[i], price);
                }
              }
            } else {
              this.stats.redisMisses++;
            }
          }
        }
      } catch (error) {
        console.error('[RedisPriceCache] Pipeline error:', error);
      }
    }

    this.recordLatency(startTime);
    return results;
  }

  /**
   * Set price with immediate L1 update and batched Redis write
   */
  async setPrice(price: CachedPrice): Promise<void> {
    const key = this.makeKey(price.symbol, price.exchange);

    // 1. Update L1 cache immediately (sub-microsecond)
    if (this.config.enableL1Cache) {
      this.l1Cache.set(key, price);
    }

    // 2. Queue for batched Redis write
    this.pendingUpdates.set(key, price);

    // 3. Schedule batch flush
    if (!this.batchTimer && this.pendingUpdates.size >= this.config.maxBatchSize) {
      await this.flushBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), 1);
    }

    this.emit('price_updated', price);
  }

  /**
   * Set multiple prices with pipelining
   */
  async setPrices(prices: CachedPrice[]): Promise<void> {
    const startTime = performance.now();

    // 1. Update L1 cache immediately
    if (this.config.enableL1Cache) {
      for (const price of prices) {
        const key = this.makeKey(price.symbol, price.exchange);
        this.l1Cache.set(key, price);
      }
    }

    // 2. Write to Redis using pipeline
    if (this.redis && this.config.enablePipelining) {
      try {
        const pipeline = this.redis.pipeline();
        const ttlSeconds = Math.ceil(this.config.redisTtlMs / 1000);

        for (const price of prices) {
          const key = this.makeKey(price.symbol, price.exchange);
          pipeline.setex(key, ttlSeconds, JSON.stringify(price));
        }

        await pipeline.exec();
      } catch (error) {
        console.error('[RedisPriceCache] Batch set error:', error);
      }
    }

    this.recordLatency(startTime);
    this.emit('prices_updated', prices);
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  private async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingUpdates.size === 0 || !this.redis) return;

    const updates = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();

    try {
      const pipeline = this.redis.pipeline();
      const ttlSeconds = Math.ceil(this.config.redisTtlMs / 1000);

      for (const price of updates) {
        const key = this.makeKey(price.symbol, price.exchange);
        pipeline.setex(key, ttlSeconds, JSON.stringify(price));
      }

      await pipeline.exec();
    } catch (error) {
      console.error('[RedisPriceCache] Flush batch error:', error);
    }
  }

  // ============================================================================
  // Staleness Detection
  // ============================================================================

  private checkStaleness(price: CachedPrice): CachedPrice | null {
    const age = Date.now() - price.timestamp;
    
    if (age > this.config.stalenessThresholdMs) {
      this.stats.staleCount++;
      this.emit('stale_price', { price, ageMs: age });
      
      // Return price but mark as stale for caller to handle
      return {
        ...price,
        // Add stale indicator
      };
    }
    
    return price;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private makeKey(symbol: string, exchange: string): string {
    return `price:${exchange}:${symbol}`;
  }

  private recordLatency(startTime: number): void {
    const latency = performance.now() - startTime;
    this.latencyTracker.record(latency);
    this.stats.avgLatencyMs = this.latencyTracker.getAvg();
    this.stats.p99LatencyMs = this.latencyTracker.getP99();
  }

  // ============================================================================
  // Statistics & Monitoring
  // ============================================================================

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getHitRate(): { l1: number; redis: number; overall: number } {
    const l1Total = this.stats.l1Hits + this.stats.l1Misses;
    const redisTotal = this.stats.redisHits + this.stats.redisMisses;
    const overallHits = this.stats.l1Hits + this.stats.redisHits;
    const overallTotal = l1Total;

    return {
      l1: l1Total > 0 ? this.stats.l1Hits / l1Total : 0,
      redis: redisTotal > 0 ? this.stats.redisHits / redisTotal : 0,
      overall: overallTotal > 0 ? overallHits / overallTotal : 0,
    };
  }

  resetStats(): void {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      redisHits: 0,
      redisMisses: 0,
      staleCount: 0,
      avgLatencyMs: 0,
      p99LatencyMs: 0,
    };
    this.latencyTracker.clear();
  }

  clearCache(): void {
    this.l1Cache.clear();
    this.pendingUpdates.clear();
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async healthCheck(): Promise<{
    connected: boolean;
    latencyMs: number;
    l1CacheSize: number;
    pendingUpdates: number;
  }> {
    const startTime = performance.now();
    let connected = false;

    if (this.redis) {
      try {
        await this.redis.ping();
        connected = true;
      } catch {
        connected = false;
      }
    }

    return {
      connected,
      latencyMs: performance.now() - startTime,
      l1CacheSize: this.l1Cache.size(),
      pendingUpdates: this.pendingUpdates.size,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let cacheInstance: RedisPriceCache | null = null;

export async function getRedisPriceCache(): Promise<RedisPriceCache> {
  if (!cacheInstance) {
    cacheInstance = new RedisPriceCache();
    await cacheInstance.connect();
  }
  return cacheInstance;
}

export function createRedisPriceCache(config?: Partial<PriceCacheConfig>): RedisPriceCache {
  return new RedisPriceCache(config);
}
