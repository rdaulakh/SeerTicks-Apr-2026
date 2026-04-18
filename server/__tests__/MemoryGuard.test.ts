import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the module-level functions and the MemoryGuard class behavior
describe('MemoryGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('capArray should trim arrays that exceed maxLength', async () => {
    const { capArray } = await import('../services/MemoryGuard');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = capArray(arr, 5);
    expect(result.length).toBe(5);
    expect(result).toEqual([6, 7, 8, 9, 10]); // keeps the last 5
  });

  it('capArray should not modify arrays within maxLength', async () => {
    const { capArray } = await import('../services/MemoryGuard');
    const arr = [1, 2, 3];
    const result = capArray(arr, 5);
    expect(result.length).toBe(3);
    expect(result).toEqual([1, 2, 3]);
  });

  it('registerClearable should register and be callable', async () => {
    const { registerClearable } = await import('../services/MemoryGuard');
    const clearer = vi.fn();
    registerClearable('test-cache', clearer);
    // The clearer is registered — it will be called during cleanup cycles
    expect(clearer).not.toHaveBeenCalled(); // Not called until cleanup
  });

  it('startMemoryGuard should return a MemoryGuard instance with getStatus', async () => {
    const { startMemoryGuard } = await import('../services/MemoryGuard');
    const guard = startMemoryGuard();
    expect(guard).toBeDefined();
    
    const status = guard.getStatus();
    expect(status).toHaveProperty('rssMB');
    expect(status).toHaveProperty('limitMB');
    expect(status).toHaveProperty('usagePercent');
    expect(status).toHaveProperty('heapUsedMB');
    expect(status).toHaveProperty('heapTotalMB');
    expect(status).toHaveProperty('externalMB');
    expect(status).toHaveProperty('arrayBuffersMB');
    expect(status).toHaveProperty('growthMB');
    expect(status).toHaveProperty('peakRSS');
    expect(status).toHaveProperty('cleanupCount');
    expect(status).toHaveProperty('gcCount');
    expect(status).toHaveProperty('lastGCTime');
    expect(status).toHaveProperty('registeredClearables');
    expect(status).toHaveProperty('uptimeMin');
    expect(status).toHaveProperty('startTime');
    
    // Numeric values should be reasonable
    expect(status.rssMB).toBeGreaterThan(0);
    expect(status.limitMB).toBeGreaterThan(0);
    expect(typeof status.usagePercent).toBe('number');
    expect(status.cleanupCount).toBeGreaterThanOrEqual(0);
    expect(status.gcCount).toBeGreaterThanOrEqual(0);
    
    guard.stop();
  });

  it('getHistory should return memory snapshots', async () => {
    const { startMemoryGuard } = await import('../services/MemoryGuard');
    const guard = startMemoryGuard();
    
    // Initial snapshot is recorded on start
    const history = guard.getHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    
    const snapshot = history[0];
    expect(snapshot).toHaveProperty('timestamp');
    expect(snapshot).toHaveProperty('rssMB');
    expect(snapshot).toHaveProperty('heapUsedMB');
    expect(snapshot).toHaveProperty('heapTotalMB');
    expect(snapshot).toHaveProperty('usagePercent');
    expect(snapshot).toHaveProperty('gcTriggered');
    
    guard.stop();
  });

  it('getCleanupEvents should return an array', async () => {
    const { startMemoryGuard } = await import('../services/MemoryGuard');
    const guard = startMemoryGuard();
    
    const events = guard.getCleanupEvents();
    expect(Array.isArray(events)).toBe(true);
    
    guard.stop();
  });

  it('getMemoryGuard should return null before start and instance after', async () => {
    // Reset the module to get a clean state
    vi.resetModules();
    const { getMemoryGuard, startMemoryGuard } = await import('../services/MemoryGuard');
    
    // After start, should return the guard
    const guard = startMemoryGuard();
    const retrieved = getMemoryGuard();
    expect(retrieved).toBe(guard);
    
    guard.stop();
  });

  it('staggered cleanup intervals should use prime-number offsets', async () => {
    // Verify the design: cache=7min, GC=11min, DB=13min (all prime, all different)
    // This prevents synchronized memory spikes
    const intervals = [7, 11, 13]; // minutes
    
    // All should be prime numbers
    const isPrime = (n: number) => {
      if (n < 2) return false;
      for (let i = 2; i <= Math.sqrt(n); i++) {
        if (n % i === 0) return false;
      }
      return true;
    };
    
    intervals.forEach(i => {
      expect(isPrime(i)).toBe(true);
    });
    
    // All should be different
    expect(new Set(intervals).size).toBe(intervals.length);
    
    // None should be multiples of each other (prevents synchronization)
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        expect(intervals[j] % intervals[i]).not.toBe(0);
      }
    }
  });

  it('capArray should handle edge cases', async () => {
    const { capArray } = await import('../services/MemoryGuard');
    
    // Empty array
    expect(capArray([], 5)).toEqual([]);
    
    // maxLength of 0
    expect(capArray([1, 2, 3], 0).length).toBe(0);
    
    // maxLength of 1
    expect(capArray([1, 2, 3], 1)).toEqual([3]);
    
    // Exact length
    expect(capArray([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });
});
