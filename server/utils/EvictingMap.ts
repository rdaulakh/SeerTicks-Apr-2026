/**
 * PHASE 10B: EvictingMap — A bounded Map with LRU eviction policy.
 * 
 * Drop-in replacement for `new Map()` in hot-path caches to prevent unbounded memory growth.
 * When the map exceeds `maxSize`, the oldest (least recently accessed) entries are evicted.
 * 
 * Uses composition (wraps a Map) to avoid TypeScript issues with extending built-in Map.
 * 
 * Usage:
 *   const cache = new EvictingMap<string, PriceData>(1000); // max 1000 entries
 *   cache.set('BTC-USD', data);
 *   cache.get('BTC-USD'); // refreshes LRU position
 */
export class EvictingMap<K, V> {
  private readonly _map: Map<K, V> = new Map();
  private readonly maxSize: number;
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this._map.size;
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  set(key: K, value: V): this {
    // If key already exists, delete first to refresh insertion order (LRU)
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this._map.size >= this.maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestValue = this._map.get(oldestKey);
        this._map.delete(oldestKey);
        if (this.onEvict && oldestValue !== undefined) {
          this.onEvict(oldestKey, oldestValue);
        }
      } else {
        break;
      }
    }

    this._map.set(key, value);
    return this;
  }

  get(key: K): V | undefined {
    if (!this._map.has(key)) return undefined;
    // Refresh LRU position: delete and re-insert
    const value = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  keys(): IterableIterator<K> {
    return this._map.keys();
  }

  values(): IterableIterator<V> {
    return this._map.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this._map.entries();
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void {
    this._map.forEach(callbackfn);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this._map[Symbol.iterator]();
  }
}

export default EvictingMap;
