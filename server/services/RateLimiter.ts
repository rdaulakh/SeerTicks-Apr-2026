/**
 * Rate Limiter Service
 * Redis-based rate limiting for API endpoints
 */

import { rateLimit, ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { getActiveClock } from '../_core/clock';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import { ENV } from '../_core/env';

// Rate limit configurations for different endpoint types
export const RATE_LIMITS = {
  // Trading endpoints: 10 requests/minute per user
  trading: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many trading requests, please try again later.',
  },
  // Market data endpoints: 60 requests/minute per user
  marketData: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: 'Too many market data requests, please try again later.',
  },
  // Authentication endpoints: 5 requests/minute per IP
  auth: {
    // Phase 53 — bumped from 5/min to 30/min. Cognito OAuth flow can hit
    // 3-5 endpoints per login (callback, refresh, /me) and a normal SPA
    // mount triggers /me twice + a refresh on top of any retry. 5/min was
    // tripping legitimate users on page reload. Brute-force protection
    // is Cognito's job (it locks accounts after wrong-password streak),
    // not ours. Also: response is now JSON so the client doesn't choke on
    // 'Unexpected token T' when parsing rate-limit text as JSON.
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { success: false, error: 'Too many authentication attempts, please try again later.' },
  },
  // Admin endpoints: 100 requests/minute per admin
  admin: {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: 'Too many admin requests, please try again later.',
  },
  // General API endpoints: 200 requests/minute per user
  // Dashboard makes ~15 tRPC queries with 5s refetch = ~180 req/min
  general: {
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    message: 'Too many requests, please try again later.',
  },
};

// Redis client for rate limiting
let redisClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Redis client for rate limiting
 */
async function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  if (!ENV.redisUrl) {
    console.warn('[RateLimiter] Redis URL not configured, rate limiting will use memory store');
    return null;
  }

  try {
    redisClient = createClient({
      url: ENV.redisUrl,
    });

    redisClient.on('error', (err: Error) => {
      console.error('[RateLimiter] Redis client error:', err);
    });

    redisClient.on('connect', () => {
      console.log('[RateLimiter] Redis client connected');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error('[RateLimiter] Failed to connect to Redis:', error);
    return null;
  }
}

/**
 * Create rate limiter middleware
 */
export async function createRateLimiter(
  type: keyof typeof RATE_LIMITS,
  options?: {
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    keyGenerator?: (req: any) => string;
    skip?: (req: any) => boolean;
  }
): Promise<RateLimitRequestHandler> {
  const config = RATE_LIMITS[type];
  const redis = await getRedisClient();

  const limiter = rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: config.message,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Use Redis store if available, otherwise use memory store
    store: redis
      ? new RedisStore({
          sendCommand: (...args: string[]) => redis.sendCommand(args),
        })
      : undefined,
    // Key generator: use user ID for authenticated requests, IPv6-safe IP for unauthenticated.
    // Phase 82 hotfix — express-rate-limit v8 throws ERR_ERL_KEY_GEN_IPV6 at startup
    // if `req.ip` is returned raw without ipKeyGenerator normalisation.
    keyGenerator: options?.keyGenerator || ((req: any) => {
      const user = req.user;
      if (user?.id) {
        return `user:${user.id}`;
      }
      return ipKeyGenerator(req.ip || req.connection?.remoteAddress || 'unknown');
    }),
    // Skip function: allow admins to bypass rate limits
    skip: options?.skip || ((req: any) => {
      const user = req.user;
      return user?.role === 'admin';
    }),
    skipSuccessfulRequests: options?.skipSuccessfulRequests || false,
    skipFailedRequests: options?.skipFailedRequests || false,
  });

  return limiter;
}

/**
 * Rate limiter metrics
 */
export interface RateLimitMetrics {
  type: string;
  key: string;
  current: number;
  limit: number;
  remaining: number;
  resetTime: Date;
}

/**
 * Get rate limit status for a key
 */
export async function getRateLimitStatus(
  type: keyof typeof RATE_LIMITS,
  key: string
): Promise<RateLimitMetrics | null> {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const config = RATE_LIMITS[type];
  const redisKey = `rl:${type}:${key}`;

  try {
    const current = await redis.get(redisKey);
    const ttl = await redis.ttl(redisKey);

    const currentCount = current ? parseInt(current, 10) : 0;
    const remaining = Math.max(0, config.max - currentCount);
    const resetTime = new Date(getActiveClock().now() + ttl * 1000);

    return {
      type,
      key,
      current: currentCount,
      limit: config.max,
      remaining,
      resetTime,
    };
  } catch (error) {
    console.error('[RateLimiter] Failed to get rate limit status:', error);
    return null;
  }
}

/**
 * Reset rate limit for a key
 */
export async function resetRateLimit(
  type: keyof typeof RATE_LIMITS,
  key: string
): Promise<boolean> {
  const redis = await getRedisClient();
  if (!redis) {
    return false;
  }

  const redisKey = `rl:${type}:${key}`;

  try {
    await redis.del(redisKey);
    return true;
  } catch (error) {
    console.error('[RateLimiter] Failed to reset rate limit:', error);
    return false;
  }
}

/**
 * Get all rate limit metrics
 */
export async function getAllRateLimitMetrics(): Promise<RateLimitMetrics[]> {
  const redis = await getRedisClient();
  if (!redis) {
    return [];
  }

  try {
    const keys = await redis.keys('rl:*');
    const metrics: RateLimitMetrics[] = [];

    for (const redisKey of keys) {
      const [, type, ...keyParts] = redisKey.split(':');
      const key = keyParts.join(':');
      const status = await getRateLimitStatus(type as keyof typeof RATE_LIMITS, key);
      if (status) {
        metrics.push(status);
      }
    }

    return metrics;
  } catch (error) {
    console.error('[RateLimiter] Failed to get all rate limit metrics:', error);
    return [];
  }
}

/**
 * Cleanup: close Redis connection
 */
export async function closeRateLimiter() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
