/**
 * LRU (Least Recently Used) Cache with optional TTL expiration.
 * 
 * Drop-in replacement for Map<K, V> with bounded memory.
 * When the cache exceeds maxSize, the least recently accessed entry is evicted.
 * Entries older than ttlMs (if set) are lazily evicted on access.
 * 
 * @example
 * const cache = new LRUCache<string, number>({ maxSize: 100, ttlMs: 60_000 });
 * cache.set('key', 42);
 * cache.get('key'); // 42 — also promotes 'key' to most-recently-used
 */

export interface LRUCacheConfig {
  /** Maximum number of entries before eviction. Default: 1000 */
  maxSize: number;
  /** Time-to-live in milliseconds. 0 = no expiry. Default: 0 */
  ttlMs?: number;
  /** Optional name for logging. */
  name?: string;
}

interface CacheEntry<V> {
  value: V;
  createdAt: number;
}

export class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly name: string;
  private readonly store: Map<K, CacheEntry<V>> = new Map();
  private evictionCount: number = 0;
  private expiredCount: number = 0;

  constructor(config: LRUCacheConfig) {
    this.maxSize = Math.max(1, config.maxSize);
    this.ttlMs = config.ttlMs ?? 0;
    this.name = config.name ?? 'LRUCache';
  }

  /**
   * Get a value by key. Returns undefined if not found or expired.
   * Promotes the entry to most-recently-used on access.
   */
  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (this.ttlMs > 0 && (Date.now() - entry.createdAt) > this.ttlMs) {
      this.store.delete(key);
      this.expiredCount++;
      return undefined;
    }

    // Promote to most-recently-used by re-inserting (Map preserves insertion order)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /**
   * Set a key-value pair. Evicts LRU entry if cache is full.
   */
  set(key: K, value: V): this {
    // If key already exists, delete it first (to update insertion order)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict LRU entries if at capacity
    while (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictionCount++;
      } else {
        break;
      }
    }

    this.store.set(key, { value, createdAt: Date.now() });
    return this;
  }

  /**
   * Check if a key exists (and is not expired).
   */
  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (this.ttlMs > 0 && (Date.now() - entry.createdAt) > this.ttlMs) {
      this.store.delete(key);
      this.expiredCount++;
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the current number of entries (including potentially expired ones).
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Iterate over all non-expired entries.
   */
  *entries(): IterableIterator<[K, V]> {
    const now = Date.now();
    const expiredKeys: K[] = [];

    for (const [key, entry] of this.store) {
      if (this.ttlMs > 0 && (now - entry.createdAt) > this.ttlMs) {
        expiredKeys.push(key);
        continue;
      }
      yield [key, entry.value];
    }

    // Clean up expired entries
    for (const key of expiredKeys) {
      this.store.delete(key);
      this.expiredCount++;
    }
  }

  /**
   * Iterate over all non-expired keys.
   */
  *keys(): IterableIterator<K> {
    for (const [key] of this.entries()) {
      yield key;
    }
  }

  /**
   * Iterate over all non-expired values.
   */
  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) {
      yield value;
    }
  }

  /**
   * Make LRUCache iterable with for...of (same as Map).
   * Yields [key, value] tuples for non-expired entries.
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /**
   * Execute a callback for each non-expired entry.
   */
  forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
    for (const [key, value] of this.entries()) {
      callback(value, key, this);
    }
  }

  /**
   * Purge all expired entries. Call periodically for proactive cleanup.
   * Returns the number of entries purged.
   */
  purgeExpired(): number {
    if (this.ttlMs <= 0) return 0;

    const now = Date.now();
    let purged = 0;

    for (const [key, entry] of this.store) {
      if ((now - entry.createdAt) > this.ttlMs) {
        this.store.delete(key);
        this.expiredCount++;
        purged++;
      }
    }

    return purged;
  }

  /**
   * Get cache statistics for monitoring.
   */
  getStats(): {
    name: string;
    size: number;
    maxSize: number;
    ttlMs: number;
    evictionCount: number;
    expiredCount: number;
    fillPercent: number;
  } {
    return {
      name: this.name,
      size: this.store.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      evictionCount: this.evictionCount,
      expiredCount: this.expiredCount,
      fillPercent: (this.store.size / this.maxSize) * 100,
    };
  }
}
