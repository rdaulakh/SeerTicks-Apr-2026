/**
 * Rate Limiter with Exponential Backoff and Caching
 * 
 * Prevents rate limit errors (412) for LLM-dependent agents
 */

export interface RateLimitConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  cacheTTL: number; // Cache time-to-live in milliseconds
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * RateLimiter
 * Handles rate limiting with exponential backoff and caching
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private requestQueue: Map<string, Promise<any>> = new Map();
  private lastRequestTime: Map<string, number> = new Map();
  private minRequestInterval = 1000; // Minimum 1 second between requests

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      cacheTTL: 300000, // 5 minutes default
      ...config,
    };
  }

  /**
   * Execute function with rate limiting and caching
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    options: {
      cacheable?: boolean;
      cacheTTL?: number;
    } = {}
  ): Promise<T> {
    const cacheable = options.cacheable !== false;
    const cacheTTL = options.cacheTTL || this.config.cacheTTL;

    // Check cache first
    if (cacheable) {
      const cached = this.getFromCache<T>(key);
      if (cached !== null) {
        console.log(`[RateLimiter] Cache hit for key: ${key}`);
        return cached;
      }
    }

    // Check if there's already a pending request for this key
    const pending = this.requestQueue.get(key);
    if (pending) {
      console.log(`[RateLimiter] Reusing pending request for key: ${key}`);
      return pending;
    }

    // Enforce minimum interval between requests
    await this.enforceMinInterval(key);

    // Execute with retry logic
    const promise = this.executeWithRetry(fn, key);
    this.requestQueue.set(key, promise);

    try {
      const result = await promise;

      // Cache the result
      if (cacheable) {
        this.setCache(key, result, cacheTTL);
      }

      return result;
    } finally {
      this.requestQueue.delete(key);
    }
  }

  /**
   * Execute function with exponential backoff retry
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    key: string,
    attempt: number = 1
  ): Promise<T> {
    try {
      const result = await fn();
      this.lastRequestTime.set(key, Date.now());
      return result;
    } catch (error: any) {
      // Check if it's a rate limit error
      const isRateLimitError = 
        error.message?.includes('rate limit') ||
        error.message?.includes('412') ||
        error.status === 412;

      if (!isRateLimitError || attempt >= this.config.maxRetries) {
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        this.config.initialDelayMs * Math.pow(2, attempt - 1),
        this.config.maxDelayMs
      );

      console.log(
        `[RateLimiter] Rate limit hit for ${key}, retrying in ${delay}ms (attempt ${attempt}/${this.config.maxRetries})`
      );

      // Wait before retrying
      await this.sleep(delay);

      // Retry
      return this.executeWithRetry(fn, key, attempt + 1);
    }
  }

  /**
   * Enforce minimum interval between requests
   */
  private async enforceMinInterval(key: string): Promise<void> {
    const lastRequest = this.lastRequestTime.get(key);
    if (!lastRequest) return;

    const elapsed = Date.now() - lastRequest;
    if (elapsed < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - elapsed;
      console.log(`[RateLimiter] Enforcing ${waitTime}ms delay for ${key}`);
      await this.sleep(waitTime);
    }
  }

  /**
   * Get value from cache
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set value in cache
   */
  private setCache<T>(key: string, data: T, ttl: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Clear cache for a specific key
   */
  clearCache(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.values());
    const validEntries = entries.filter(e => e.expiresAt > now);

    return {
      totalEntries: this.cache.size,
      validEntries: validEntries.length,
      expiredEntries: entries.length - validEntries.length,
      cacheHitRate: this.cache.size > 0 ? (validEntries.length / this.cache.size) * 100 : 0,
    };
  }

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global rate limiter instance for LLM calls
let globalRateLimiter: RateLimiter | null = null;
let globalRateLimiterCleanupInterval: NodeJS.Timeout | null = null;

export function getLLMRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter({
      maxRetries: 3,
      initialDelayMs: 2000, // Start with 2 seconds
      maxDelayMs: 60000, // Max 1 minute
      cacheTTL: 300000, // Cache for 5 minutes
    });

    // Clean up expired cache every 5 minutes
    globalRateLimiterCleanupInterval = setInterval(() => {
      globalRateLimiter?.cleanupExpiredCache();
    }, 300000);
  }

  return globalRateLimiter;
}

/**
 * Destroy the global LLM rate limiter and clean up its interval timer.
 * Call this on process shutdown to prevent timer leaks.
 */
export function destroyLLMRateLimiter(): void {
  if (globalRateLimiterCleanupInterval) {
    clearInterval(globalRateLimiterCleanupInterval);
    globalRateLimiterCleanupInterval = null;
  }
  if (globalRateLimiter) {
    globalRateLimiter.clearAllCache();
    globalRateLimiter = null;
  }
}
