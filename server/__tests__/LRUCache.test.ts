import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../utils/LRUCache';

describe('LRUCache', () => {
  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should report correct size', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
    });

    it('should overwrite existing keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      cache.set('a', 99);
      expect(cache.get('a')).toBe(99);
      expect(cache.size).toBe(1);
    });

    it('should delete keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should clear all entries', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should check key existence with has()', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when maxSize exceeded', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Cache is full: [a, b, c]
      cache.set('d', 4);
      // 'a' should be evicted (LRU): [b, c, d]
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
      expect(cache.size).toBe(3);
    });

    it('should promote accessed entries to most-recently-used', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Access 'a' to promote it
      cache.get('a');
      // Now order is [b, c, a] — 'b' is LRU
      cache.set('d', 4);
      // 'b' should be evicted: [c, a, d]
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should promote on set() of existing key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Update 'a' to promote it
      cache.set('a', 100);
      // Now order is [b, c, a] — 'b' is LRU
      cache.set('d', 4);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(100);
    });

    it('should handle maxSize of 1', () => {
      const cache = new LRUCache<string, number>({ maxSize: 1, name: 'test' });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      cache.set('b', 2);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should track eviction count in stats', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      cache.set('d', 4); // evicts 'b'
      const stats = cache.getStats();
      expect(stats.evictionCount).toBe(2);
    });
  });

  describe('TTL Expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire entries after TTL', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 1000, name: 'test' });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(1001);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should not expire entries before TTL', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 1000, name: 'test' });
      cache.set('a', 1);

      vi.advanceTimersByTime(999);
      expect(cache.get('a')).toBe(1);
    });

    it('should expire entries in has() check', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 500, name: 'test' });
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);

      vi.advanceTimersByTime(501);
      expect(cache.has('a')).toBe(false);
    });

    it('should purge all expired entries', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 1000, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);

      vi.advanceTimersByTime(500);
      cache.set('c', 3); // Added later, not expired yet

      vi.advanceTimersByTime(501); // Total: 1001ms for a,b; 501ms for c
      const purged = cache.purgeExpired();
      expect(purged).toBe(2); // a and b expired
      expect(cache.size).toBe(1);
      expect(cache.get('c')).toBe(3);
    });

    it('should track expired count in stats', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 100, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);

      vi.advanceTimersByTime(101);
      cache.get('a'); // triggers expiry
      cache.get('b'); // triggers expiry

      const stats = cache.getStats();
      expect(stats.expiredCount).toBe(2);
    });

    it('should not expire when ttlMs is 0', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 0, name: 'test' });
      cache.set('a', 1);

      vi.advanceTimersByTime(999999);
      expect(cache.get('a')).toBe(1);
    });
  });

  describe('Iteration', () => {
    it('should iterate over entries', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const entries = [...cache.entries()];
      expect(entries).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    });

    it('should iterate over keys', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('x', 10);
      cache.set('y', 20);

      const keys = [...cache.keys()];
      expect(keys).toEqual(['x', 'y']);
    });

    it('should iterate over values', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('x', 10);
      cache.set('y', 20);

      const values = [...cache.values()];
      expect(values).toEqual([10, 20]);
    });

    it('should skip expired entries during iteration', () => {
      vi.useFakeTimers();
      const cache = new LRUCache<string, number>({ maxSize: 10, ttlMs: 100, name: 'test' });
      cache.set('a', 1);

      vi.advanceTimersByTime(50);
      cache.set('b', 2);

      vi.advanceTimersByTime(51); // 'a' expired (101ms), 'b' still valid (51ms)
      const entries = [...cache.entries()];
      expect(entries).toEqual([['b', 2]]);
      vi.useRealTimers();
    });

    it('should support forEach', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, name: 'test' });
      cache.set('a', 1);
      cache.set('b', 2);

      const collected: [string, number][] = [];
      cache.forEach((value, key) => {
        collected.push([key, value]);
      });
      expect(collected).toEqual([['a', 1], ['b', 2]]);
    });
  });

  describe('Stats', () => {
    it('should report accurate stats', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5, ttlMs: 1000, name: 'myCache' });
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();
      expect(stats.name).toBe('myCache');
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(5);
      expect(stats.ttlMs).toBe(1000);
      expect(stats.evictionCount).toBe(0);
      expect(stats.expiredCount).toBe(0);
      expect(stats.fillPercent).toBe(40);
    });
  });

  describe('Type Safety', () => {
    it('should work with complex value types', () => {
      interface Signal {
        agentName: string;
        confidence: number;
      }
      const cache = new LRUCache<string, Signal[]>({ maxSize: 10, name: 'signals' });
      cache.set('BTCUSDT', [{ agentName: 'TechnicalAnalyst', confidence: 0.85 }]);

      const result = cache.get('BTCUSDT');
      expect(result).toBeDefined();
      expect(result![0].agentName).toBe('TechnicalAnalyst');
    });

    it('should work with nested Map values (like correlationMatrix)', () => {
      const cache = new LRUCache<string, Map<string, number>>({ maxSize: 10, name: 'correlation' });
      const innerMap = new Map([['ETHUSDT', 0.85], ['SOLUSDT', 0.72]]);
      cache.set('BTCUSDT', innerMap);

      const result = cache.get('BTCUSDT');
      expect(result).toBeDefined();
      expect(result!.get('ETHUSDT')).toBe(0.85);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid set/get cycles without memory leak', () => {
      const cache = new LRUCache<number, string>({ maxSize: 100, name: 'stress' });
      for (let i = 0; i < 10000; i++) {
        cache.set(i, `value-${i}`);
      }
      // Only the last 100 should remain
      expect(cache.size).toBe(100);
      expect(cache.get(9999)).toBe('value-9999');
      expect(cache.get(9900)).toBe('value-9900');
      expect(cache.get(9899)).toBeUndefined(); // Evicted

      const stats = cache.getStats();
      expect(stats.evictionCount).toBe(9900);
    });

    it('should handle concurrent-like access patterns', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5, name: 'concurrent' });
      // Simulate multiple symbols being updated rapidly
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT'];
      for (let tick = 0; tick < 100; tick++) {
        for (const sym of symbols) {
          cache.set(sym, tick);
        }
      }
      // Only 5 should remain (maxSize)
      expect(cache.size).toBe(5);
    });
  });
});
