/**
 * Rate Limit Management Router
 * Admin endpoints for managing and monitoring rate limits
 */

import { z } from 'zod';
import { adminProcedure, router } from '../_core/trpc';
import {
  getAllRateLimitMetrics,
  getRateLimitStatus,
  resetRateLimit,
  RATE_LIMITS,
} from '../services/RateLimiter';

export const rateLimitManagementRouter = router({
  /**
   * Get all rate limit configurations
   */
  getConfigurations: adminProcedure.query(() => {
    return Object.entries(RATE_LIMITS).map(([type, config]) => ({
      type,
      windowMs: config.windowMs,
      max: config.max,
      message: config.message,
    }));
  }),

  /**
   * Get rate limit status for a specific key
   */
  getStatus: adminProcedure
    .input(
      z.object({
        type: z.enum(['trading', 'marketData', 'auth', 'admin', 'general']),
        key: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await getRateLimitStatus(input.type, input.key);
    }),

  /**
   * Get all rate limit metrics
   */
  getAllMetrics: adminProcedure.query(async () => {
    return await getAllRateLimitMetrics();
  }),

  /**
   * Reset rate limit for a specific key
   */
  reset: adminProcedure
    .input(
      z.object({
        type: z.enum(['trading', 'marketData', 'auth', 'admin', 'general']),
        key: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const success = await resetRateLimit(input.type, input.key);
      return {
        success,
        message: success
          ? `Rate limit reset for ${input.type}:${input.key}`
          : 'Failed to reset rate limit',
      };
    }),
});
