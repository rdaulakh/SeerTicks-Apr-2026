import { describe, it, expect, beforeEach } from 'vitest';
import { externalAPIRateLimiter, RateLimitError, sleep } from '../services/ExternalAPIRateLimiter';

describe('ExternalAPIRateLimiter', () => {
  beforeEach(() => {
    // Reset all rate limit states before each test
    externalAPIRateLimiter.reset();
  });

  describe('canMakeRequest', () => {
    it('should allow requests when under limit', () => {
      const result = externalAPIRateLimiter.canMakeRequest('whaleAlert');
      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
    });

    it('should return allowed true for unknown API', () => {
      const result = externalAPIRateLimiter.canMakeRequest('unknownApi');
      expect(result.allowed).toBe(true);
    });

    it('should block requests when limit exceeded', () => {
      // Record 80 successful requests (whaleAlert limit is 80/hour)
      for (let i = 0; i < 80; i++) {
        externalAPIRateLimiter.recordSuccess('whaleAlert');
      }
      
      const result = externalAPIRateLimiter.canMakeRequest('whaleAlert');
      expect(result.allowed).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
      expect(result.reason).toContain('Rate limit reached');
    });
  });

  describe('recordSuccess', () => {
    it('should increment request count', () => {
      externalAPIRateLimiter.recordSuccess('whaleAlert');
      externalAPIRateLimiter.recordSuccess('whaleAlert');
      
      const status = externalAPIRateLimiter.getStatus();
      expect(status.whaleAlert.requestCount).toBe(2);
    });

    it('should reset consecutive errors on success', () => {
      // First record an error
      externalAPIRateLimiter.recordError('whaleAlert', 429);
      
      // Then record a success
      externalAPIRateLimiter.recordSuccess('whaleAlert');
      
      const status = externalAPIRateLimiter.getStatus();
      expect(status.whaleAlert.consecutiveErrors).toBe(0);
    });
  });

  describe('recordError', () => {
    it('should set backoff on 429 error', () => {
      const backoffMs = externalAPIRateLimiter.recordError('whaleAlert', 429, 'Rate limited');
      
      expect(backoffMs).toBeGreaterThan(0);
      
      const status = externalAPIRateLimiter.getStatus();
      expect(status.whaleAlert.inBackoff).toBe(true);
      expect(status.whaleAlert.consecutiveErrors).toBe(1);
      expect(status.whaleAlert.lastError).toBe('Rate limited');
    });

    it('should increase backoff exponentially on consecutive 429s', () => {
      const backoff1 = externalAPIRateLimiter.recordError('whaleAlert', 429);
      
      // Reset backoff to allow next error recording
      externalAPIRateLimiter.reset('whaleAlert');
      externalAPIRateLimiter.recordError('whaleAlert', 429); // First error
      const backoff2 = externalAPIRateLimiter.recordError('whaleAlert', 429); // Second error
      
      // Second backoff should be larger than first (exponential)
      expect(backoff2).toBeGreaterThan(backoff1);
    });

    it('should set shorter backoff on 500 errors', () => {
      const backoff429 = externalAPIRateLimiter.recordError('whaleAlert', 429);
      externalAPIRateLimiter.reset('whaleAlert');
      const backoff500 = externalAPIRateLimiter.recordError('whaleAlert', 500);
      
      // 500 errors should have shorter backoff than 429
      expect(backoff500).toBeLessThan(backoff429);
    });
  });

  describe('getStatus', () => {
    it('should return status for all configured APIs', () => {
      const status = externalAPIRateLimiter.getStatus();
      
      expect(status).toHaveProperty('whaleAlert');
      expect(status).toHaveProperty('coinGecko');
      expect(status).toHaveProperty('mempool');
      expect(status).toHaveProperty('dune');
      expect(status).toHaveProperty('blockchain');
    });

    it('should return correct structure for each API', () => {
      const status = externalAPIRateLimiter.getStatus();
      
      expect(status.whaleAlert).toHaveProperty('requestCount');
      expect(status.whaleAlert).toHaveProperty('maxRequests');
      expect(status.whaleAlert).toHaveProperty('inBackoff');
      expect(status.whaleAlert).toHaveProperty('backoffRemainingMs');
      expect(status.whaleAlert).toHaveProperty('consecutiveErrors');
    });
  });

  describe('reset', () => {
    it('should reset specific API state', () => {
      externalAPIRateLimiter.recordSuccess('whaleAlert');
      externalAPIRateLimiter.recordSuccess('coinGecko');
      
      externalAPIRateLimiter.reset('whaleAlert');
      
      const status = externalAPIRateLimiter.getStatus();
      expect(status.whaleAlert.requestCount).toBe(0);
      expect(status.coinGecko.requestCount).toBe(1);
    });

    it('should reset all API states when no argument provided', () => {
      externalAPIRateLimiter.recordSuccess('whaleAlert');
      externalAPIRateLimiter.recordSuccess('coinGecko');
      
      externalAPIRateLimiter.reset();
      
      const status = externalAPIRateLimiter.getStatus();
      expect(status.whaleAlert.requestCount).toBe(0);
      expect(status.coinGecko.requestCount).toBe(0);
    });
  });

  describe('RateLimitError', () => {
    it('should create error with correct properties', () => {
      const error = new RateLimitError('whaleAlert', 30000, 'Rate limited');
      
      expect(error.name).toBe('RateLimitError');
      expect(error.apiName).toBe('whaleAlert');
      expect(error.waitMs).toBe(30000);
      expect(error.message).toBe('Rate limited');
    });
  });

  describe('sleep', () => {
    it('should wait for specified duration', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;
      
      // Allow some tolerance for timing
      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(200);
    });
  });
});
