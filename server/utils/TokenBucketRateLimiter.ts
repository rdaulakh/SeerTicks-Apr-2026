/**
 * Token Bucket Rate Limiter for Exchange APIs
 * Implements industry-standard rate limiting to prevent API violations
 * 
 * Algorithm: Token bucket allows bursts while maintaining average rate
 * - Bucket starts with maxTokens
 * - Each request consumes 1 token
 * - Tokens refill at rate of refillRate per refillInterval
 * - If no tokens available, request waits until token is available
 */

interface TokenBucketConfig {
  maxTokens: number; // Maximum tokens in bucket
  refillRate: number; // Tokens to add per interval
  refillInterval: number; // Interval in milliseconds
  name?: string; // For logging
}

interface WaitingRequest {
  resolve: () => void;
  timestamp: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly refillInterval: number;
  private readonly name: string;
  private lastRefillTime: number;
  private waitingQueue: WaitingRequest[] = [];
  private refillTimer: NodeJS.Timeout | null = null;
  private requestCount = 0;
  private rejectedCount = 0;

  constructor(config: TokenBucketConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens; // Start with full bucket
    this.refillRate = config.refillRate;
    this.refillInterval = config.refillInterval;
    this.name = config.name || "TokenBucket";
    this.lastRefillTime = Date.now();

    // Start refill timer
    this.startRefillTimer();

    console.log(
      `[${this.name}] Initialized: ${this.maxTokens} tokens, refill ${this.refillRate} every ${this.refillInterval}ms`
    );
  }

  /**
   * Acquire a token to make a request
   * Waits if no tokens available
   */
  public async acquire(): Promise<void> {
    this.requestCount++;

    // Try to get token immediately
    if (this.tryAcquire()) {
      return;
    }

    // No tokens available, add to waiting queue
    return new Promise<void>((resolve) => {
      this.waitingQueue.push({
        resolve,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Try to acquire token without waiting
   * Returns true if successful, false if no tokens available
   */
  private tryAcquire(): boolean {
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Refill tokens at configured rate
   */
  private startRefillTimer(): void {
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.refillInterval);
  }

  /**
   * Add tokens to bucket and process waiting queue
   */
  private refill(): void {
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefillTime;

    // Calculate tokens to add based on time elapsed
    const tokensToAdd = Math.floor(
      (timeSinceLastRefill / this.refillInterval) * this.refillRate
    );

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.tokens + tokensToAdd, this.maxTokens);
      this.lastRefillTime = now;

      // Process waiting queue
      this.processWaitingQueue();
    }
  }

  /**
   * Process requests waiting for tokens
   */
  private processWaitingQueue(): void {
    while (this.waitingQueue.length > 0 && this.tokens >= 1) {
      const request = this.waitingQueue.shift();
      if (request) {
        this.tokens -= 1;
        request.resolve();
      }
    }
  }

  /**
   * Get current status for monitoring
   */
  public getStatus(): {
    name: string;
    availableTokens: number;
    maxTokens: number;
    waitingRequests: number;
    totalRequests: number;
    rejectedRequests: number;
    utilizationPercent: number;
  } {
    const utilizationPercent =
      ((this.maxTokens - this.tokens) / this.maxTokens) * 100;

    return {
      name: this.name,
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      waitingRequests: this.waitingQueue.length,
      totalRequests: this.requestCount,
      rejectedRequests: this.rejectedCount,
      utilizationPercent: Math.round(utilizationPercent),
    };
  }

  /**
   * Reset rate limiter state
   */
  public reset(): void {
    this.tokens = this.maxTokens;
    this.waitingQueue = [];
    this.requestCount = 0;
    this.rejectedCount = 0;
    this.lastRefillTime = Date.now();
    console.log(`[${this.name}] Reset to initial state`);
  }

  /**
   * Clean up resources
   */
  public shutdown(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }

    // Reject all waiting requests
    this.waitingQueue.forEach((request) => {
      this.rejectedCount++;
    });
    this.waitingQueue = [];

    console.log(`[${this.name}] Shutdown complete`);
  }
}

/**
 * Preset rate limiter configurations for popular exchanges
 */
export const ExchangeRateLimits = {
  // Binance: 1200 requests per minute (20 per second)
  BINANCE: {
    maxTokens: 20,
    refillRate: 20,
    refillInterval: 1000,
    name: "Binance",
  },

  // Coinbase: 10 requests per second (conservative)
  COINBASE: {
    maxTokens: 10,
    refillRate: 10,
    refillInterval: 1000,
    name: "Coinbase",
  },

  // Kraken: 15 requests per second (conservative)
  KRAKEN: {
    maxTokens: 15,
    refillRate: 15,
    refillInterval: 1000,
    name: "Kraken",
  },

  // Generic conservative limit
  DEFAULT: {
    maxTokens: 5,
    refillRate: 5,
    refillInterval: 1000,
    name: "Default",
  },
};
