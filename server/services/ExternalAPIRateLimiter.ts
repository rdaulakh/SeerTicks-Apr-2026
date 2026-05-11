// Phase 22: Cached AuditLogger import (ESM-compatible)
let _auditLoggerCache: any = null;
async function _getAuditLoggerModule() {
  if (!_auditLoggerCache) _auditLoggerCache = await import("./AuditLogger");
  return _auditLoggerCache;
}

/**
 * External API Rate Limiter
 * 
 * Centralized rate limiting and exponential backoff for all external API calls.
 * Prevents 429 errors by tracking request counts and implementing proper backoff.
 * Integrates with CircuitBreakerManager for cascade failure prevention.
 * 
 * Supported APIs:
 * - WhaleAlert (10 req/min on free tier)
 * - CoinGecko (10-50 req/min on free tier)
 * - Mempool.space (no strict limit, but be respectful)
 * - Dune Analytics (varies by plan)
 */

import { circuitBreakerManager, recordAPISuccess, recordAPIFailure, isServiceAvailable } from './CircuitBreakerManager';
import { getActiveClock } from '../_core/clock';

interface RateLimitConfig {
  maxRequests: number;      // Max requests per window
  windowMs: number;         // Time window in milliseconds
  minBackoffMs: number;     // Minimum backoff on 429
  maxBackoffMs: number;     // Maximum backoff on 429
  backoffMultiplier: number; // Multiplier for exponential backoff
}

interface RateLimitState {
  requestCount: number;
  windowStart: number;
  backoffUntil: number;
  consecutiveErrors: number;
  lastError?: string;
}

// API-specific rate limit configurations
const API_CONFIGS: Record<string, RateLimitConfig> = {
  whaleAlert: {
    // User's plan: 100 alerts/hour
    // Using 80 req/hour with safety margin = ~1.33 req/min
    // Window: 1 hour for accurate tracking
    maxRequests: 80,         // 80 req/hour (100/hour plan with 20% safety margin)
    windowMs: 3600000,       // 1 hour window for accurate hourly tracking
    minBackoffMs: 60000,     // 1 minute minimum backoff
    maxBackoffMs: 600000,    // 10 minutes maximum backoff
    backoffMultiplier: 2,
  },
  coinGecko: {
    maxRequests: 8,          // Conservative: 8 req/min (free tier is 10-50)
    windowMs: 60000,         // 1 minute
    minBackoffMs: 60000,     // 1 minute minimum backoff
    maxBackoffMs: 600000,    // 10 minutes maximum backoff
    backoffMultiplier: 2,
  },
  mempool: {
    maxRequests: 30,         // 30 req/min (no strict limit)
    windowMs: 60000,         // 1 minute
    minBackoffMs: 10000,     // 10 seconds minimum backoff
    maxBackoffMs: 120000,    // 2 minutes maximum backoff
    backoffMultiplier: 1.5,
  },
  dune: {
    maxRequests: 10,         // 10 req/min (varies by plan)
    windowMs: 60000,         // 1 minute
    minBackoffMs: 60000,     // 1 minute minimum backoff
    maxBackoffMs: 600000,    // 10 minutes maximum backoff
    backoffMultiplier: 2,
  },
  blockchain: {
    maxRequests: 20,         // 20 req/min
    windowMs: 60000,         // 1 minute
    minBackoffMs: 15000,     // 15 seconds minimum backoff
    maxBackoffMs: 180000,    // 3 minutes maximum backoff
    backoffMultiplier: 2,
  },
};

class ExternalAPIRateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private static instance: ExternalAPIRateLimiter;

  private constructor() {}

  static getInstance(): ExternalAPIRateLimiter {
    if (!ExternalAPIRateLimiter.instance) {
      ExternalAPIRateLimiter.instance = new ExternalAPIRateLimiter();
    }
    return ExternalAPIRateLimiter.instance;
  }

  /**
   * Check if we can make a request to the specified API
   */
  canMakeRequest(apiName: string): { allowed: boolean; waitMs: number; reason?: string } {
    const config = API_CONFIGS[apiName];
    if (!config) {
      console.warn(`[ExternalAPIRateLimiter] Unknown API: ${apiName}, allowing request`);
      return { allowed: true, waitMs: 0 };
    }

    const state = this.getState(apiName);
    const now = getActiveClock().now();

    // Check if we're in backoff period
    if (state.backoffUntil > now) {
      const waitMs = state.backoffUntil - now;
      return {
        allowed: false,
        waitMs,
        reason: `In backoff period (${Math.ceil(waitMs / 1000)}s remaining) after ${state.consecutiveErrors} consecutive errors`,
      };
    }

    // Reset window if expired
    if (now - state.windowStart >= config.windowMs) {
      state.requestCount = 0;
      state.windowStart = now;
    }

    // Check if we've exceeded the rate limit
    if (state.requestCount >= config.maxRequests) {
      const waitMs = config.windowMs - (now - state.windowStart);
      return {
        allowed: false,
        waitMs,
        reason: `Rate limit reached (${state.requestCount}/${config.maxRequests} requests), wait ${Math.ceil(waitMs / 1000)}s`,
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  /**
   * Record a successful request
   */
  recordSuccess(apiName: string): void {
    const state = this.getState(apiName);
    state.requestCount++;
    state.consecutiveErrors = 0;
    state.lastError = undefined;
    
    // Also record success with circuit breaker
    recordAPISuccess(apiName);
    
    console.log(`[ExternalAPIRateLimiter] ${apiName}: Request successful (${state.requestCount}/${API_CONFIGS[apiName]?.maxRequests || '?'} in window)`);
  }

  /**
   * Record a failed request and calculate backoff
   */
  recordError(apiName: string, statusCode: number, errorMessage?: string): number {
    const config = API_CONFIGS[apiName];
    if (!config) return 0;

    const state = this.getState(apiName);
    state.requestCount++;
    state.consecutiveErrors++;
    state.lastError = errorMessage;

    // Calculate exponential backoff
    let backoffMs = config.minBackoffMs;
    
    if (statusCode === 429) {
      // Rate limit hit - use exponential backoff
      backoffMs = Math.min(
        config.minBackoffMs * Math.pow(config.backoffMultiplier, state.consecutiveErrors - 1),
        config.maxBackoffMs
      );
      console.warn(`[ExternalAPIRateLimiter] ${apiName}: 429 Rate Limited! Backing off for ${Math.ceil(backoffMs / 1000)}s (attempt ${state.consecutiveErrors})`);
    } else if (statusCode >= 500) {
      // Server error - shorter backoff
      backoffMs = Math.min(config.minBackoffMs / 2, 15000);
      console.warn(`[ExternalAPIRateLimiter] ${apiName}: Server error ${statusCode}, backing off for ${Math.ceil(backoffMs / 1000)}s`);
    } else if (statusCode === 403) {
      // Forbidden - likely API key issue, longer backoff
      backoffMs = config.maxBackoffMs;
      console.error(`[ExternalAPIRateLimiter] ${apiName}: 403 Forbidden - check API key! Backing off for ${Math.ceil(backoffMs / 1000)}s`);
    }

    state.backoffUntil = getActiveClock().now() + backoffMs;
    
    // Also record failure with circuit breaker
    recordAPIFailure(apiName, errorMessage || `HTTP ${statusCode}`);
    
    return backoffMs;
  }
  
  /**
   * Check if service is available (rate limit + circuit breaker)
   */
  isServiceAvailable(apiName: string): boolean {
    const rateLimitCheck = this.canMakeRequest(apiName);
    const circuitBreakerCheck = isServiceAvailable(apiName);
    return rateLimitCheck.allowed && circuitBreakerCheck;
  }

  /**
   * Get current state for an API
   */
  private getState(apiName: string): RateLimitState {
    let state = this.states.get(apiName);
    if (!state) {
      state = {
        requestCount: 0,
        windowStart: getActiveClock().now(),
        backoffUntil: 0,
        consecutiveErrors: 0,
      };
      this.states.set(apiName, state);
    }
    return state;
  }

  /**
   * Get status of all APIs
   */
  getStatus(): Record<string, {
    requestCount: number;
    maxRequests: number;
    inBackoff: boolean;
    backoffRemainingMs: number;
    consecutiveErrors: number;
    lastError?: string;
  }> {
    const status: Record<string, any> = {};
    const now = getActiveClock().now();

    for (const [apiName, config] of Object.entries(API_CONFIGS)) {
      const state = this.states.get(apiName);
      if (state) {
        status[apiName] = {
          requestCount: state.requestCount,
          maxRequests: config.maxRequests,
          inBackoff: state.backoffUntil > now,
          backoffRemainingMs: Math.max(0, state.backoffUntil - now),
          consecutiveErrors: state.consecutiveErrors,
          lastError: state.lastError,
        };
      } else {
        status[apiName] = {
          requestCount: 0,
          maxRequests: config.maxRequests,
          inBackoff: false,
          backoffRemainingMs: 0,
          consecutiveErrors: 0,
        };
      }
    }

    return status;
  }

  /**
   * Reset state for an API (for testing)
   */
  reset(apiName?: string): void {
    if (apiName) {
      this.states.delete(apiName);
    } else {
      this.states.clear();
    }
  }
}

// Export singleton instance
export const externalAPIRateLimiter = ExternalAPIRateLimiter.getInstance();

/**
 * Wrapper function for making rate-limited API requests
 */
export async function rateLimitedFetch(
  apiName: string,
  url: string,
  options?: RequestInit,
  callerAgent?: string
): Promise<Response> {
  const limiter = externalAPIRateLimiter;

  // Check if we can make the request
  const check = limiter.canMakeRequest(apiName);
  if (!check.allowed) {
    console.warn(`[rateLimitedFetch] ${apiName}: ${check.reason}`);
    // Phase 22: Log rate-limited API call
    try {
      const { getAuditLogger } = await import('./AuditLogger');
      getAuditLogger().logApiCall({
        apiName,
        endpoint: url.substring(0, 255),
        method: options?.method || 'GET',
        status: 'rate_limited',
        errorMessage: check.reason || 'Rate limited',
        callerAgent,
      });
    } catch { /* audit logger not ready */ }
    throw new RateLimitError(apiName, check.waitMs, check.reason || 'Rate limited');
  }

  const startMs = getActiveClock().now();
  try {
    // Add per-request timeout (30s) to prevent hanging API calls from blocking agents
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const fetchOptions = { ...options, signal: controller.signal };
    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } finally {
      clearTimeout(timeoutId);
    }
    const responseTimeMs = getActiveClock().now() - startMs;

    if (response.ok) {
      limiter.recordSuccess(apiName);
      // Phase 22: Log successful API call
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logApiCall({
          apiName,
          endpoint: url.substring(0, 255),
          method: options?.method || 'GET',
          status: 'success',
          httpStatusCode: response.status,
          responseTimeMs,
          callerAgent,
        });
      } catch { /* audit logger not ready */ }
    } else {
      const backoffMs = limiter.recordError(apiName, response.status, response.statusText);
      // Phase 22: Log failed API call
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logApiCall({
          apiName,
          endpoint: url.substring(0, 255),
          method: options?.method || 'GET',
          status: response.status === 429 ? 'rate_limited' : 'error',
          httpStatusCode: response.status,
          responseTimeMs,
          errorMessage: response.statusText,
          callerAgent,
        });
      } catch { /* audit logger not ready */ }
      if (response.status === 429) {
        throw new RateLimitError(apiName, backoffMs, `Rate limit exceeded for ${apiName}`);
      }
    }

    return response;
  } catch (error) {
    const responseTimeMs = getActiveClock().now() - startMs;
    if (error instanceof RateLimitError) {
      throw error;
    }
    // Handle AbortError from timeout
    if (error instanceof Error && error.name === 'AbortError') {
      limiter.recordError(apiName, 0, `Request timeout after 30s`);
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logApiCall({
          apiName,
          endpoint: url.substring(0, 255),
          method: options?.method || 'GET',
          status: 'error',
          responseTimeMs,
          errorMessage: `Request timeout after 30s`,
          callerAgent,
        });
      } catch { /* audit logger not ready */ }
      throw new Error(`[${apiName}] Request timed out after 30s: ${url.substring(0, 100)}`);
    }
    // Network error
    limiter.recordError(apiName, 0, error instanceof Error ? error.message : 'Network error');
    // Phase 22: Log network error API call
    try {
      const { getAuditLogger } = await import('./AuditLogger');
      getAuditLogger().logApiCall({
        apiName,
        endpoint: url.substring(0, 255),
        method: options?.method || 'GET',
        status: 'error',
        responseTimeMs,
        errorMessage: error instanceof Error ? error.message : 'Network error',
        callerAgent,
      });
    } catch { /* audit logger not ready */ }
    throw error;
  }
}

/**
 * Custom error for rate limiting
 */
export class RateLimitError extends Error {
  constructor(
    public readonly apiName: string,
    public readonly waitMs: number,
    message: string
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Sleep utility for backoff
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
export async function retryWithBackoff<T>(
  apiName: string,
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check rate limit before attempting
      const check = externalAPIRateLimiter.canMakeRequest(apiName);
      if (!check.allowed) {
        console.log(`[retryWithBackoff] ${apiName}: Waiting ${Math.ceil(check.waitMs / 1000)}s before attempt ${attempt}`);
        await sleep(check.waitMs);
      }
      
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (error instanceof RateLimitError) {
        if (attempt < maxRetries) {
          console.log(`[retryWithBackoff] ${apiName}: Rate limited, waiting ${Math.ceil(error.waitMs / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
          await sleep(error.waitMs);
        }
      } else {
        // For other errors, use shorter backoff
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        if (attempt < maxRetries) {
          console.log(`[retryWithBackoff] ${apiName}: Error on attempt ${attempt}, retrying in ${backoffMs}ms`);
          await sleep(backoffMs);
        }
      }
    }
  }
  
  throw lastError || new Error(`Failed after ${maxRetries} attempts`);
}
