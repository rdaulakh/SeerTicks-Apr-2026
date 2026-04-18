import Redis from "ioredis";

/**
 * Redis Client for Hot Path Data
 * Manages real-time tick data, order book snapshots, and deviation scores
 */

let redisClient: Redis | null = null;

/**
 * Clean and normalize Redis URL from environment variable
 * Handles various malformed formats including URL encoding and quotes
 */
function cleanRedisUrl(rawUrl: string): string {
  let cleanUrl = rawUrl;
  
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
    console.warn('[Redis] Invalid URL format, falling back to localhost');
    return 'redis://localhost:6379';
  }
  
  return cleanUrl;
}

/**
 * Get or create Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const rawUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const redisUrl = cleanRedisUrl(rawUrl);
    const isTLS = redisUrl.startsWith('rediss://');
    
    console.log('[Redis] Connecting to:', redisUrl.replace(/:[^:@]+@/, ':***@'));
    console.log('[Redis] TLS enabled:', isTLS);
    
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 5000,
      retryStrategy(times) {
        if (times > 5) return null; // Stop retrying after 5 attempts
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY errors
          return true;
        }
        return false;
      },
      // TLS options for Upstash
      ...(isTLS && {
        tls: {
          rejectUnauthorized: false, // Accept self-signed certs
        },
      }),
    });

    redisClient.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });

    redisClient.on("error", (err: Error & { code?: string }) => {
      // Only log if not a connection refused error (expected when Redis is not available)
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOENT' && err.code !== 'ENOTFOUND') {
        console.error("[Redis] Connection error:", err.message);
      }
    });

    redisClient.on("close", () => {
      console.log("[Redis] Connection closed");
    });
  }

  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      redisClient.removeAllListeners();
      await redisClient.quit();
    } catch (e) {
      // Ignore quit errors
    }
    redisClient = null;
    console.log("[Redis] Connection closed gracefully");
  }
}

/**
 * Redis key patterns for organized data storage
 */
export const RedisKeys = {
  // Tick data: tick:{exchange}:{symbol}
  tick: (exchange: string, symbol: string) => `tick:${exchange}:${symbol}`,
  
  // Recent ticks (list): ticks:{exchange}:{symbol}
  ticks: (exchange: string, symbol: string) => `ticks:${exchange}:${symbol}`,
  
  // Order book snapshot: orderbook:{exchange}:{symbol}
  orderBook: (exchange: string, symbol: string) => `orderbook:${exchange}:${symbol}`,
  
  // Deviation score: deviation:{exchange}:{symbol}
  deviation: (exchange: string, symbol: string) => `deviation:${exchange}:${symbol}`,
  
  // Expected path: path:{userId}:{symbol}
  expectedPath: (userId: number, symbol: string) => `path:${userId}:${symbol}`,
  
  // Active positions: position:{userId}:{symbol}
  activePosition: (userId: number, symbol: string) => `position:${userId}:${symbol}`,
  
  // Agent signals: signal:{agentName}:{symbol}
  agentSignal: (agentName: string, symbol: string) => `signal:${agentName}:${symbol}`,
};

/**
 * Helper functions for common Redis operations
 */
export const RedisHelpers = {
  /**
   * Store latest tick data with expiration
   */
  async storeTick(exchange: string, symbol: string, tick: any): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.tick(exchange, symbol);
    
    await redis.setex(key, 60, JSON.stringify(tick)); // 60 second TTL
  },

  /**
   * Add tick to recent ticks list (keep last 1000)
   */
  async addToTickHistory(exchange: string, symbol: string, tick: any): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.ticks(exchange, symbol);
    
    await redis.lpush(key, JSON.stringify(tick));
    await redis.ltrim(key, 0, 999); // Keep only last 1000 ticks
    await redis.expire(key, 3600); // 1 hour TTL
  },

  /**
   * Get recent ticks
   */
  async getRecentTicks(exchange: string, symbol: string, count: number = 100): Promise<any[]> {
    const redis = getRedisClient();
    const key = RedisKeys.ticks(exchange, symbol);
    
    const ticks = await redis.lrange(key, 0, count - 1);
    return ticks.map(tick => JSON.parse(tick));
  },

  /**
   * Store order book snapshot
   */
  async storeOrderBook(exchange: string, symbol: string, orderBook: any): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.orderBook(exchange, symbol);
    
    await redis.setex(key, 30, JSON.stringify(orderBook)); // 30 second TTL
  },

  /**
   * Get order book snapshot
   */
  async getOrderBook(exchange: string, symbol: string): Promise<any | null> {
    const redis = getRedisClient();
    const key = RedisKeys.orderBook(exchange, symbol);
    
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Store deviation score
   */
  async storeDeviation(exchange: string, symbol: string, deviation: number): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.deviation(exchange, symbol);
    
    await redis.setex(key, 60, deviation.toString());
  },

  /**
   * Get deviation score
   */
  async getDeviation(exchange: string, symbol: string): Promise<number | null> {
    const redis = getRedisClient();
    const key = RedisKeys.deviation(exchange, symbol);
    
    const data = await redis.get(key);
    return data ? parseFloat(data) : null;
  },

  /**
   * Store expected path for a user
   */
  async storeExpectedPath(userId: number, symbol: string, path: any): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.expectedPath(userId, symbol);
    
    await redis.setex(key, 3600, JSON.stringify(path)); // 1 hour TTL
  },

  /**
   * Get expected path
   */
  async getExpectedPath(userId: number, symbol: string): Promise<any | null> {
    const redis = getRedisClient();
    const key = RedisKeys.expectedPath(userId, symbol);
    
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Store agent signal
   */
  async storeAgentSignal(agentName: string, symbol: string, signal: any): Promise<void> {
    const redis = getRedisClient();
    const key = RedisKeys.agentSignal(agentName, symbol);
    
    await redis.setex(key, 300, JSON.stringify(signal)); // 5 minute TTL
  },

  /**
   * Get agent signal
   */
  async getAgentSignal(agentName: string, symbol: string): Promise<any | null> {
    const redis = getRedisClient();
    const key = RedisKeys.agentSignal(agentName, symbol);
    
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Check Redis health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const redis = getRedisClient();
      await redis.ping();
      return true;
    } catch (error) {
      console.error("[Redis] Health check failed:", error);
      return false;
    }
  },
};
