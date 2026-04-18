import { describe, it, expect } from 'vitest';
import Redis from 'ioredis';

describe('Redis Connection Validation', () => {
  it('should connect to the new Upstash Redis instance and perform PING', async () => {
    const redisUrl = process.env.REDIS_URL;
    expect(redisUrl).toBeDefined();
    expect(redisUrl).toContain('talented-sheepdog-24737.upstash.io');

    const redis = new Redis(redisUrl!, {
      tls: {},
      connectTimeout: 10000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      expect(pong).toBe('PONG');

      // Test basic SET/GET
      const testKey = `seer:connection-test:${Date.now()}`;
      await redis.set(testKey, 'ok', 'EX', 10);
      const value = await redis.get(testKey);
      expect(value).toBe('ok');

      // Cleanup
      await redis.del(testKey);
    } finally {
      await redis.quit();
    }
  }, 15000);
});
