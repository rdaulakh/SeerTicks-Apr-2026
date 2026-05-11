import { getActiveClock } from '../_core/clock';
/**
 * Coinbase API Rate Limiter
 * Prevents 429 errors by limiting requests to Coinbase API
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  timestamp: number;
  count: number;
}

class CoinbaseRateLimiter {
  private requests: Map<string, RequestRecord[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxRequests: 10, windowMs: 1000 }) {
    this.config = config;
    
    // Clean up old records every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request is allowed
   */
  async checkLimit(key: string): Promise<boolean> {
    const now = getActiveClock().now();
    const windowStart = now - this.config.windowMs;

    // Get existing records for this key
    let records = this.requests.get(key) || [];

    // Remove expired records
    records = records.filter(r => r.timestamp > windowStart);

    // Count total requests in window
    const totalRequests = records.reduce((sum, r) => sum + r.count, 0);

    if (totalRequests >= this.config.maxRequests) {
      return false;
    }

    // Add new record
    records.push({ timestamp: now, count: 1 });
    this.requests.set(key, records);

    return true;
  }

  /**
   * Wait until a request is allowed
   */
  async waitForSlot(key: string, maxWaitMs: number = 5000): Promise<boolean> {
    const startTime = getActiveClock().now();

    while (getActiveClock().now() - startTime < maxWaitMs) {
      if (await this.checkLimit(key)) {
        return true;
      }

      // Wait a bit before trying again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    options?: { maxWaitMs?: number; retries?: number }
  ): Promise<T> {
    const maxWaitMs = options?.maxWaitMs || 5000;
    const retries = options?.retries || 3;

    for (let attempt = 0; attempt < retries; attempt++) {
      // Wait for a slot
      const allowed = await this.waitForSlot(key, maxWaitMs);

      if (!allowed) {
        if (attempt === retries - 1) {
          throw new Error('Rate limit exceeded, max retries reached');
        }
        continue;
      }

      try {
        return await fn();
      } catch (error: any) {
        // If we get a 429, wait longer and retry
        if (error.message?.includes('429')) {
          if (attempt === retries - 1) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }

    throw new Error('Rate limit exceeded');
  }

  /**
   * Get current rate limit status
   */
  getStatus(key: string): { current: number; limit: number; resetIn: number } {
    const now = getActiveClock().now();
    const windowStart = now - this.config.windowMs;

    const records = this.requests.get(key) || [];
    const activeRecords = records.filter(r => r.timestamp > windowStart);
    const current = activeRecords.reduce((sum, r) => sum + r.count, 0);

    const oldestRecord = activeRecords[0];
    const resetIn = oldestRecord
      ? Math.max(0, oldestRecord.timestamp + this.config.windowMs - now)
      : 0;

    return {
      current,
      limit: this.config.maxRequests,
      resetIn,
    };
  }

  /**
   * Clean up old records
   */
  private cleanup() {
    const now = getActiveClock().now();
    const windowStart = now - this.config.windowMs;

    for (const [key, records] of this.requests.entries()) {
      const activeRecords = records.filter(r => r.timestamp > windowStart);
      if (activeRecords.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, activeRecords);
      }
    }
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string) {
    this.requests.delete(key);
  }

  /**
   * Reset all rate limits
   */
  resetAll() {
    this.requests.clear();
  }
}

// Singleton instance for Coinbase API
// Limit: 10 requests per second per symbol
const coinbaseRateLimiter = new CoinbaseRateLimiter({
  maxRequests: 10,
  windowMs: 1000,
});

export { coinbaseRateLimiter, CoinbaseRateLimiter };
