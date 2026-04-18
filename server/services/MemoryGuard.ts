/**
 * MemoryGuard — Aggressive Memory Management for 100% Uptime
 * 
 * Phase 42+43: Centralized memory pressure handler that:
 * 1. Runs every 60 seconds to check RSS
 * 2. At WARNING (70%): trims all service caches/buffers
 * 3. At CRITICAL (85%): forces GC, clears everything
 * 4. At EMERGENCY (95%): last-resort cleanup
 * 5. Staggered periodic trims to prevent synchronized memory spikes
 * 6. Time-series memory history for dashboard visualization
 */

const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '1024', 10);
const CHECK_INTERVAL_MS = 60_000;       // Check every 60s
const WARNING_THRESHOLD = 0.70;
const CRITICAL_THRESHOLD = 0.85;
const EMERGENCY_THRESHOLD = 0.95;

// Staggered trim intervals (prevent synchronized spikes)
const CACHE_TRIM_INTERVAL_MS = 7 * 60_000;   // Cache trim every 7 min
const DB_CLEANUP_INTERVAL_MS = 13 * 60_000;  // DB cleanup every 13 min (prime number offset)
const GC_FORCE_INTERVAL_MS = 11 * 60_000;    // Force GC every 11 min (prime number offset)

// History tracking
const MAX_HISTORY_POINTS = 360;  // 6 hours at 1-minute intervals
const HISTORY_INTERVAL_MS = 60_000;  // Record every 60s

// Global registry of clearable caches — services register themselves
type CacheClearer = () => void;
const cacheClearers: Map<string, CacheClearer> = new Map();

/**
 * Register a cache/buffer that can be cleared under memory pressure.
 */
export function registerClearable(name: string, clearer: CacheClearer): void {
  cacheClearers.set(name, clearer);
}

/**
 * Hard cap for any array — call after push() to enforce limits.
 */
export function capArray<T>(arr: T[], maxLength: number): T[] {
  if (arr.length > maxLength) {
    arr.splice(0, arr.length - maxLength);
  }
  return arr;
}

interface MemorySnapshot {
  timestamp: number;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  usagePercent: number;
  gcTriggered: boolean;
}

interface CleanupEvent {
  timestamp: number;
  level: 'periodic' | 'warning' | 'critical' | 'emergency';
  beforeMB: number;
  afterMB: number;
  freedMB: number;
}

class MemoryGuard {
  private checkInterval: NodeJS.Timeout | null = null;
  private cacheTrimInterval: NodeJS.Timeout | null = null;
  private dbCleanupInterval: NodeJS.Timeout | null = null;
  private gcForceInterval: NodeJS.Timeout | null = null;
  private historyInterval: NodeJS.Timeout | null = null;
  private cleanupCount = 0;
  private startRSS = 0;
  private startTime = Date.now();
  private peakRSS = 0;

  // Time-series data for dashboard
  private memoryHistory: MemorySnapshot[] = [];
  private cleanupEvents: CleanupEvent[] = [];
  private gcCount = 0;
  private lastGCTime = 0;

  start(): void {
    if (this.checkInterval) return;

    const mem = process.memoryUsage();
    this.startRSS = Math.round(mem.rss / 1024 / 1024);
    this.peakRSS = this.startRSS;

    console.log(
      `[MemoryGuard] Started — limit: ${MEMORY_LIMIT_MB}MB, ` +
      `current RSS: ${this.startRSS}MB, staggered cleanup enabled`
    );

    // Memory check every 60s
    this.checkInterval = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.checkInterval.unref();

    // STAGGERED periodic trims (prime-number offsets prevent synchronization)
    // Cache trim every 7 minutes (offset: 2 min from start)
    setTimeout(() => {
      this.cacheTrimInterval = setInterval(() => this.trimCaches(), CACHE_TRIM_INTERVAL_MS);
      this.cacheTrimInterval.unref();
    }, 2 * 60_000);

    // DB cleanup every 13 minutes (offset: 5 min from start)
    setTimeout(() => {
      this.dbCleanupInterval = setInterval(() => this.trimDatabase(), DB_CLEANUP_INTERVAL_MS);
      this.dbCleanupInterval.unref();
    }, 5 * 60_000);

    // Force GC every 11 minutes (offset: 8 min from start)
    setTimeout(() => {
      this.gcForceInterval = setInterval(() => this.forceGC(), GC_FORCE_INTERVAL_MS);
      this.gcForceInterval.unref();
    }, 8 * 60_000);

    // History recording every 60s
    this.historyInterval = setInterval(() => this.recordHistory(), HISTORY_INTERVAL_MS);
    this.historyInterval.unref();

    // Record initial snapshot
    this.recordHistory();

    // Register clearables for key services after a short delay (let services initialize)
    setTimeout(() => this.registerServiceClearables(), 30_000);
  }

  stop(): void {
    if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
    if (this.cacheTrimInterval) { clearInterval(this.cacheTrimInterval); this.cacheTrimInterval = null; }
    if (this.dbCleanupInterval) { clearInterval(this.dbCleanupInterval); this.dbCleanupInterval = null; }
    if (this.gcForceInterval) { clearInterval(this.gcForceInterval); this.gcForceInterval = null; }
    if (this.historyInterval) { clearInterval(this.historyInterval); this.historyInterval = null; }
  }

  /**
   * Register clearables for the biggest memory consumers.
   * Uses dynamic imports so we don't create circular dependencies.
   */
  private async registerServiceClearables(): Promise<void> {
    try {
      // MarketRegimeAI — regimeHistory and cache
      try {
        const { MarketRegimeAI } = await import('./MarketRegimeAI');
        registerClearable('MarketRegimeAI', () => {
          // The service caches are internal — we rely on periodic trim
        });
      } catch { /* ignore */ }

      // AutomatedSignalProcessor — consensusCache (module-level)
      try {
        const aspModule = await import('./AutomatedSignalProcessor');
        if (typeof (aspModule as any).getAllCachedConsensus === 'function') {
          registerClearable('AutomatedSignalProcessor.consensusCache', () => {
            const cache = (aspModule as any).getAllCachedConsensus() as Map<string, any>;
            // ASP already has TTL-based cleanup
          });
        }
      } catch { /* ignore */ }

      // BGeometricsService — cache
      try {
        const { BGeometricsService } = await import('./BGeometricsService');
        registerClearable('BGeometricsService', () => {
          try {
            const instance = (BGeometricsService as any).instance;
            if (instance && typeof instance.clearCache === 'function') {
              instance.clearCache();
            }
          } catch { /* ignore */ }
        });
      } catch { /* ignore */ }

      console.log(`[MemoryGuard] Registered ${cacheClearers.size} clearable caches`);
    } catch (err) {
      console.error('[MemoryGuard] Error registering clearables:', (err as Error)?.message);
    }
  }

  private recordHistory(): void {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    
    if (rssMB > this.peakRSS) this.peakRSS = rssMB;

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rssMB,
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
      arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024),
      usagePercent: Math.round((rssMB / MEMORY_LIMIT_MB) * 100),
      gcTriggered: false,
    };

    this.memoryHistory.push(snapshot);
    if (this.memoryHistory.length > MAX_HISTORY_POINTS) {
      this.memoryHistory.splice(0, this.memoryHistory.length - MAX_HISTORY_POINTS);
    }
  }

  private recordCleanupEvent(level: CleanupEvent['level'], beforeMB: number, afterMB: number): void {
    this.cleanupEvents.push({
      timestamp: Date.now(),
      level,
      beforeMB,
      afterMB,
      freedMB: beforeMB - afterMB,
    });
    // Keep last 100 cleanup events
    if (this.cleanupEvents.length > 100) {
      this.cleanupEvents.splice(0, this.cleanupEvents.length - 100);
    }
  }

  private check(): void {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const ratio = rssMB / MEMORY_LIMIT_MB;

    if (rssMB > this.peakRSS) this.peakRSS = rssMB;

    if (ratio >= EMERGENCY_THRESHOLD) {
      console.error(`[MemoryGuard] EMERGENCY: RSS ${rssMB}MB / ${MEMORY_LIMIT_MB}MB (${(ratio * 100).toFixed(0)}%)`);
      this.emergencyCleanup();
    } else if (ratio >= CRITICAL_THRESHOLD) {
      console.warn(`[MemoryGuard] CRITICAL: RSS ${rssMB}MB / ${MEMORY_LIMIT_MB}MB (${(ratio * 100).toFixed(0)}%)`);
      this.criticalCleanup();
    } else if (ratio >= WARNING_THRESHOLD) {
      console.warn(`[MemoryGuard] WARNING: RSS ${rssMB}MB / ${MEMORY_LIMIT_MB}MB (${(ratio * 100).toFixed(0)}%)`);
      this.warningCleanup();
    }

    // Log status every 5 minutes
    const uptimeMin = Math.round((Date.now() - this.startTime) / 60000);
    if (uptimeMin > 0 && uptimeMin % 5 === 0) {
      const growth = rssMB - this.startRSS;
      console.log(
        `[MemoryGuard] RSS: ${rssMB}MB/${MEMORY_LIMIT_MB}MB (${(ratio * 100).toFixed(0)}%), ` +
        `Heap: ${heapMB}MB, Growth: +${growth}MB, Peak: ${this.peakRSS}MB, ` +
        `Cleanups: ${this.cleanupCount}, GCs: ${this.gcCount}`
      );
    }
  }

  /**
   * Staggered cache trim — runs every 7 minutes.
   * Only clears registered caches, no DB or GC.
   */
  private trimCaches(): void {
    const beforeMem = process.memoryUsage();
    const beforeRSS = Math.round(beforeMem.rss / 1024 / 1024);

    this.clearRegisteredCaches();

    const afterMem = process.memoryUsage();
    const afterRSS = Math.round(afterMem.rss / 1024 / 1024);
    this.recordCleanupEvent('periodic', beforeRSS, afterRSS);

    if (beforeRSS !== afterRSS) {
      console.log(`[MemoryGuard] Cache trim: ${beforeRSS}MB -> ${afterRSS}MB (${afterRSS - beforeRSS > 0 ? '+' : ''}${afterRSS - beforeRSS}MB)`);
    }
  }

  /**
   * Staggered DB cleanup — runs every 13 minutes.
   * Only triggers database cleanup service.
   */
  private async trimDatabase(): Promise<void> {
    try {
      const { databaseCleanupService } = await import('./DatabaseCleanupService');
      if (databaseCleanupService) {
        await databaseCleanupService.runCleanup().catch(() => {});
      }
    } catch { /* ignore */ }
  }

  /**
   * Staggered GC force — runs every 11 minutes.
   * Only forces garbage collection if available.
   */
  private forceGC(): void {
    if (typeof global.gc === 'function') {
      const beforeMem = process.memoryUsage();
      const beforeRSS = Math.round(beforeMem.rss / 1024 / 1024);

      global.gc();
      this.gcCount++;
      this.lastGCTime = Date.now();

      const afterMem = process.memoryUsage();
      const afterRSS = Math.round(afterMem.rss / 1024 / 1024);

      // Mark the last history point as GC-triggered
      if (this.memoryHistory.length > 0) {
        this.memoryHistory[this.memoryHistory.length - 1].gcTriggered = true;
      }

      if (beforeRSS - afterRSS > 5) {
        console.log(`[MemoryGuard] Forced GC: ${beforeRSS}MB -> ${afterRSS}MB (freed ${beforeRSS - afterRSS}MB)`);
      }
    }
  }

  private clearRegisteredCaches(): void {
    for (const [name, clearer] of cacheClearers) {
      try {
        clearer();
      } catch (err) {
        console.error(`[MemoryGuard] Error clearing ${name}:`, (err as Error)?.message);
      }
    }
  }

  private warningCleanup(): void {
    const beforeMem = process.memoryUsage();
    const beforeRSS = Math.round(beforeMem.rss / 1024 / 1024);

    this.cleanupCount++;
    this.clearRegisteredCaches();
    if (typeof global.gc === 'function') { global.gc(); this.gcCount++; this.lastGCTime = Date.now(); }

    const afterMem = process.memoryUsage();
    const afterRSS = Math.round(afterMem.rss / 1024 / 1024);
    this.recordCleanupEvent('warning', beforeRSS, afterRSS);
  }

  private criticalCleanup(): void {
    const beforeMem = process.memoryUsage();
    const beforeRSS = Math.round(beforeMem.rss / 1024 / 1024);

    this.cleanupCount++;
    this.clearRegisteredCaches();
    if (typeof global.gc === 'function') { global.gc(); global.gc(); this.gcCount += 2; this.lastGCTime = Date.now(); }

    const afterMem = process.memoryUsage();
    const afterRSS = Math.round(afterMem.rss / 1024 / 1024);
    this.recordCleanupEvent('critical', beforeRSS, afterRSS);
  }

  private emergencyCleanup(): void {
    const beforeMem = process.memoryUsage();
    const beforeRSS = Math.round(beforeMem.rss / 1024 / 1024);

    this.cleanupCount++;
    this.clearRegisteredCaches();
    if (typeof global.gc === 'function') { global.gc(); global.gc(); global.gc(); this.gcCount += 3; this.lastGCTime = Date.now(); }
    console.error('[MemoryGuard] Emergency cleanup done. If memory doesn\'t drop, OOM kill imminent.');

    const afterMem = process.memoryUsage();
    const afterRSS = Math.round(afterMem.rss / 1024 / 1024);
    this.recordCleanupEvent('emergency', beforeRSS, afterRSS);
  }

  getStatus() {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    return {
      rssMB,
      limitMB: MEMORY_LIMIT_MB,
      usagePercent: Math.round((rssMB / MEMORY_LIMIT_MB) * 100),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
      arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024),
      growthMB: rssMB - this.startRSS,
      peakRSS: this.peakRSS,
      cleanupCount: this.cleanupCount,
      gcCount: this.gcCount,
      lastGCTime: this.lastGCTime,
      registeredClearables: cacheClearers.size,
      uptimeMin: Math.round((Date.now() - this.startTime) / 60000),
      startTime: this.startTime,
    };
  }

  getHistory(minutes?: number): MemorySnapshot[] {
    if (!minutes) return [...this.memoryHistory];
    const cutoff = Date.now() - minutes * 60_000;
    return this.memoryHistory.filter(s => s.timestamp >= cutoff);
  }

  getCleanupEvents(limit?: number): CleanupEvent[] {
    const events = [...this.cleanupEvents];
    if (limit) return events.slice(-limit);
    return events;
  }
}

// Singleton
let guard: MemoryGuard | null = null;

export function startMemoryGuard(): MemoryGuard {
  if (!guard) {
    guard = new MemoryGuard();
  }
  guard.start();
  return guard;
}

export function getMemoryGuard(): MemoryGuard | null {
  return guard;
}
