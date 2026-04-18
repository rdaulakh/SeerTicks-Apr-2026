/**
 * PriceFabric — Multi-Source Millisecond Price Data Fabric
 *
 * PHILOSOPHY: A trading platform with a single price source is a blindfolded driver
 * on a highway. PriceFabric runs multiple independent WebSocket feeds in PARALLEL
 * so that if any single source dies, ticks keep flowing from the others. The dead
 * man's switch should NEVER fire in normal operation.
 *
 * Architecture:
 *   Coinbase WS ─┐
 *   Binance WS  ─┼─→ PriceFabric → priceFeedService → all consumers (unchanged)
 *   CoinGecko   ─┘        │
 *                     ticks table (batched, non-blocking)
 *
 * Features:
 * 1. MULTI-SOURCE INGESTION: Coinbase WS + Binance WS + CoinGecko REST
 * 2. DEDUPLICATION: Same source + same price within 50ms → skip
 * 3. CONSENSUS PRICE: Single source → use it. 2+ sources → median.
 * 4. GAP DETECTION: >500ms without any tick for a symbol → log gap
 * 5. SOURCE HEALTH: Per-source reliability EMA, ticks/sec, latency
 * 6. BATCH PERSISTENCE: Ticks buffered and flushed to DB every 1s or 100 ticks
 * 7. DIVERGENCE ALERTS: CoinGecko cross-validates WebSocket prices every 30s
 *
 * This service sits BETWEEN raw sources and priceFeedService.
 * priceFeedService API and all downstream consumers are UNCHANGED.
 */

import { EventEmitter } from 'events';
import { priceFeedService } from './priceFeedService';

// =========================================================================
// INTERFACES
// =========================================================================

export interface RawTick {
  symbol: string;              // Canonical format: BTC-USD
  price: number;
  volume: number;
  bid?: number;
  ask?: number;
  timestampMs: number;         // Exchange timestamp in milliseconds
  receivedAtMs: number;        // Local receipt time in milliseconds
  source: 'coinbase' | 'binance' | 'coingecko';
  sequenceNumber?: number;
}

export interface SourceHealth {
  name: string;
  isAlive: boolean;
  lastTickMs: number;
  tickCount: number;
  ticksPerSecond: number;      // 10s rolling window
  avgLatencyMs: number;        // Exchange→local time diff EMA
  reliability: number;         // 0-100 EMA score (100 = perfect)
  reconnectCount: number;
  staleSince: number | null;   // Timestamp when source went stale, null if alive
}

export interface TickBucket {
  timestampMs: number;         // Bucket start time (1ms resolution)
  symbol: string;
  ticks: RawTick[];            // All ticks in this millisecond
  consensusPrice: number;      // Median or single-source price
  sources: string[];           // Which sources contributed
}

export interface PriceFabricStatus {
  isRunning: boolean;
  sources: SourceHealth[];
  combinedTicksPerSecond: number;
  totalTicksIngested: number;
  totalTicksPersisted: number;
  totalTicksDeduped: number;
  totalGapsDetected: number;
  pendingDbWrites: number;
  symbols: string[];
  uptimeMs: number;
}

interface DedupKey {
  source: string;
  symbol: string;
  price: number;
  timestampMs: number;
}

// =========================================================================
// CONSTANTS
// =========================================================================

const DEDUP_WINDOW_MS = 50;           // Same source + same price within 50ms = duplicate
const GAP_THRESHOLD_MS = 500;         // No tick for 500ms = gap (per symbol)
const SOURCE_STALE_MS = 5_000;        // Source considered stale after 5s no ticks
const SOURCE_DEAD_MS = 15_000;        // Source considered dead after 15s no ticks
const RELIABILITY_EMA_ALPHA = 0.05;   // Slow EMA for reliability scoring
const LATENCY_EMA_ALPHA = 0.1;        // Moderate EMA for latency tracking
const TICKS_PER_SEC_WINDOW = 10_000;  // 10s rolling window for tick rate
const FLUSH_INTERVAL_MS = 1_000;      // Flush to DB every 1 second
const FLUSH_BATCH_SIZE = 100;         // Or every 100 ticks, whichever comes first
const HEALTH_CHECK_INTERVAL_MS = 1_000; // Check source health every 1s
const DIVERGENCE_THRESHOLD_PCT = 1.0; // Alert if CoinGecko diverges >1% from WS

// =========================================================================
// PRICE FABRIC SERVICE
// =========================================================================

class PriceFabricService extends EventEmitter {
  private isRunning = false;
  private startedAt = 0;

  // Source health tracking
  private sourceHealth: Map<string, SourceHealth> = new Map();
  private sourceTickWindows: Map<string, number[]> = new Map(); // timestamps for ticks/sec calc

  // Dedup tracking: Map<"source:symbol" → { price, timestampMs }>
  private lastTicks: Map<string, DedupKey> = new Map();

  // Gap detection: Map<symbol → lastTickMs>
  private lastTickPerSymbol: Map<string, number> = new Map();

  // Tick persistence buffer
  private tickWriteBuffer: RawTick[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Metrics
  private totalTicksIngested = 0;
  private totalTicksPersisted = 0;
  private totalTicksDeduped = 0;
  private totalGapsDetected = 0;
  private trackedSymbols: Set<string> = new Set();

  // Consensus: Map<symbol → last consensus price> for divergence detection
  private lastConsensusPrice: Map<string, number> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);

    // Initialize known sources
    for (const source of ['coinbase', 'binance', 'coingecko']) {
      this.sourceHealth.set(source, {
        name: source,
        isAlive: false,
        lastTickMs: 0,
        tickCount: 0,
        ticksPerSecond: 0,
        avgLatencyMs: 0,
        reliability: 50, // Start neutral
        reconnectCount: 0,
        staleSince: null,
      });
      this.sourceTickWindows.set(source, []);
    }
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = Date.now();

    console.log('[PriceFabric] 🏭 Starting multi-source price fabric');
    console.log(`[PriceFabric] Dedup window: ${DEDUP_WINDOW_MS}ms | Gap threshold: ${GAP_THRESHOLD_MS}ms`);
    console.log(`[PriceFabric] DB flush: every ${FLUSH_INTERVAL_MS}ms or ${FLUSH_BATCH_SIZE} ticks`);
    console.log(`[PriceFabric] Source stale: ${SOURCE_STALE_MS}ms | Source dead: ${SOURCE_DEAD_MS}ms`);

    // Start periodic DB flush
    this.flushTimer = setInterval(() => {
      this.flushTicksToDb().catch(err => {
        console.warn('[PriceFabric] Flush timer error:', (err as Error).message);
      });
    }, FLUSH_INTERVAL_MS);

    // Start health check loop
    this.healthCheckTimer = setInterval(() => this.checkSourceHealth(), HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log('[PriceFabric] Stopping price fabric...');

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Final flush of any remaining ticks
    this.flushTicksToDb().catch(() => {});

    console.log(`[PriceFabric] Stopped. Total ingested: ${this.totalTicksIngested}, persisted: ${this.totalTicksPersisted}, deduped: ${this.totalTicksDeduped}`);
  }

  // =========================================================================
  // CORE: TICK INGESTION
  // =========================================================================

  /**
   * Ingest a raw tick from any source.
   * This is the ONLY entry point for price data into the system.
   *
   * Flow:
   * 1. Validate
   * 2. Deduplicate (same source + same price within 50ms)
   * 3. Update source health
   * 4. Detect gaps
   * 5. Compute consensus price
   * 6. Forward to priceFeedService
   * 7. Buffer for DB persistence
   */
  ingestTick(tick: RawTick): void {
    if (!this.isRunning) return;

    // 1. Validate
    if (!tick.symbol || !tick.price || tick.price <= 0 || isNaN(tick.price)) {
      return;
    }
    if (!tick.timestampMs) tick.timestampMs = Date.now();
    if (!tick.receivedAtMs) tick.receivedAtMs = Date.now();

    // Track symbol
    this.trackedSymbols.add(tick.symbol);

    // 2. Deduplicate
    if (this.isDuplicate(tick)) {
      this.totalTicksDeduped++;
      return;
    }

    // 3. Update source health
    this.updateSourceHealth(tick);

    // 4. Detect gaps
    this.detectGap(tick);

    // 5. Update last tick per symbol (for gap detection next time)
    this.lastTickPerSymbol.set(tick.symbol, tick.receivedAtMs);

    // Count ingested
    this.totalTicksIngested++;

    // 6. Compute consensus and forward to priceFeedService
    this.forwardToPriceFeed(tick);

    // 7. Buffer for DB persistence (skip CoinGecko — too low frequency)
    if (tick.source !== 'coingecko') {
      this.bufferTick(tick);
    }

    // 8. Log periodically
    // Phase 42: Reduced logging from every 1000 to every 10000 ticks
    if (this.totalTicksIngested % 10000 === 0) {
      const sources = Array.from(this.sourceHealth.values())
        .filter(s => s.isAlive)
        .map(s => `${s.name}: ${s.ticksPerSecond.toFixed(0)}/s`)
        .join(', ');
      console.log(`[PriceFabric] 📊 Ingested: ${this.totalTicksIngested} | Deduped: ${this.totalTicksDeduped} | Sources: ${sources}`);
    }
  }

  // =========================================================================
  // DEDUPLICATION
  // =========================================================================

  private isDuplicate(tick: RawTick): boolean {
    const key = `${tick.source}:${tick.symbol}`;
    const last = this.lastTicks.get(key);

    if (last) {
      const timeDiff = tick.receivedAtMs - last.timestampMs;
      // Same source, same price, within dedup window → duplicate
      if (timeDiff < DEDUP_WINDOW_MS && tick.price === last.price) {
        return true;
      }
    }

    // Update last tick for this source:symbol
    this.lastTicks.set(key, {
      source: tick.source,
      symbol: tick.symbol,
      price: tick.price,
      timestampMs: tick.receivedAtMs,
    });

    return false;
  }

  // =========================================================================
  // SOURCE HEALTH
  // =========================================================================

  private updateSourceHealth(tick: RawTick): void {
    const health = this.sourceHealth.get(tick.source);
    if (!health) return;

    const now = tick.receivedAtMs;

    // Update basic metrics
    health.lastTickMs = now;
    health.tickCount++;

    // Mark alive
    if (!health.isAlive) {
      console.log(`[PriceFabric] ✅ Source ${tick.source} is ALIVE`);
      health.staleSince = null;
    }
    health.isAlive = true;
    health.staleSince = null;

    // Update latency EMA (exchange timestamp vs local receipt)
    if (tick.timestampMs > 0 && tick.timestampMs < now + 60_000) {
      // Sanity check: timestamp should be within 60s of now
      const latency = Math.abs(now - tick.timestampMs);
      health.avgLatencyMs = health.avgLatencyMs === 0
        ? latency
        : health.avgLatencyMs * (1 - LATENCY_EMA_ALPHA) + latency * LATENCY_EMA_ALPHA;
    }

    // Update reliability EMA (receiving ticks = good)
    health.reliability = Math.min(100,
      health.reliability * (1 - RELIABILITY_EMA_ALPHA) + 100 * RELIABILITY_EMA_ALPHA
    );

    // Update ticks/sec rolling window
    const window = this.sourceTickWindows.get(tick.source) || [];
    window.push(now);
    // Remove ticks older than the window
    while (window.length > 0 && window[0] < now - TICKS_PER_SEC_WINDOW) {
      window.shift();
    }
    this.sourceTickWindows.set(tick.source, window);
    health.ticksPerSecond = window.length / (TICKS_PER_SEC_WINDOW / 1000);
  }

  private checkSourceHealth(): void {
    const now = Date.now();

    for (const [name, health] of this.sourceHealth) {
      if (health.lastTickMs === 0) continue; // Never received a tick

      const staleness = now - health.lastTickMs;

      if (staleness > SOURCE_DEAD_MS && health.isAlive) {
        health.isAlive = false;
        if (!health.staleSince) health.staleSince = now;
        health.reliability = Math.max(0,
          health.reliability * (1 - RELIABILITY_EMA_ALPHA)
        );
        console.error(`[PriceFabric] 🔴 Source ${name} is DEAD (no ticks for ${(staleness / 1000).toFixed(1)}s)`);
        this.emit('source_dead', { source: name, stalenessMs: staleness });
      } else if (staleness > SOURCE_STALE_MS && health.isAlive) {
        if (!health.staleSince) {
          health.staleSince = now;
          console.warn(`[PriceFabric] ⚠️ Source ${name} is STALE (no ticks for ${(staleness / 1000).toFixed(1)}s)`);
          this.emit('source_stale', { source: name, stalenessMs: staleness });
        }
      }

      // Decay ticks/sec when no ticks flowing
      if (staleness > 2000) {
        health.ticksPerSecond = 0;
        const window = this.sourceTickWindows.get(name);
        if (window) {
          while (window.length > 0 && window[0] < now - TICKS_PER_SEC_WINDOW) {
            window.shift();
          }
          health.ticksPerSecond = window.length / (TICKS_PER_SEC_WINDOW / 1000);
        }
      }
    }

    // Check if ALL sources are dead
    const aliveSources = Array.from(this.sourceHealth.values()).filter(s => s.isAlive && s.lastTickMs > 0);
    if (aliveSources.length === 0 && this.totalTicksIngested > 0) {
      console.error('[PriceFabric] 🚨🚨🚨 ALL SOURCES DEAD — PositionGuardian should trigger');
      this.emit('all_sources_dead', { timestamp: now });
    }
  }

  // =========================================================================
  // GAP DETECTION
  // =========================================================================

  private detectGap(tick: RawTick): void {
    const lastTickMs = this.lastTickPerSymbol.get(tick.symbol);
    if (!lastTickMs) return; // First tick for this symbol

    const gap = tick.receivedAtMs - lastTickMs;
    if (gap > GAP_THRESHOLD_MS) {
      this.totalGapsDetected++;

      // Only log significant gaps (>2s) to reduce noise
      if (gap > 2000) {
        console.warn(`[PriceFabric] ⚠️ Gap detected: ${tick.symbol} — ${(gap / 1000).toFixed(1)}s without ticks`);
      }

      // Log to dataGapLogs table (non-blocking)
      this.logGapToDb(tick.symbol, lastTickMs, tick.receivedAtMs).catch(() => {});

      this.emit('gap_detected', {
        symbol: tick.symbol,
        gapMs: gap,
        gapStartMs: lastTickMs,
        gapEndMs: tick.receivedAtMs,
      });
    }
  }

  private async logGapToDb(symbol: string, startMs: number, endMs: number): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const { dataGapLogs } = await import('../../drizzle/schema');
      const db = await getDb();
      if (!db) return;

      await db.insert(dataGapLogs).values({
        symbol,
        gapStartMs: startMs,
        gapEndMs: endMs,
      });
    } catch {
      // Non-critical — gap logging is informational
    }
  }

  // =========================================================================
  // CONSENSUS PRICE & FORWARDING
  // =========================================================================

  private forwardToPriceFeed(tick: RawTick): void {
    // For CoinGecko, only use for divergence detection — don't forward as primary price
    if (tick.source === 'coingecko') {
      this.checkDivergence(tick);
      return;
    }

    // Compute consensus: check if we have recent ticks from multiple sources for this symbol
    const consensusPrice = this.computeConsensusPrice(tick);

    // Store for divergence detection
    this.lastConsensusPrice.set(tick.symbol, consensusPrice);

    // Forward to priceFeedService — the single source of truth for all consumers
    priceFeedService.updatePrice(tick.symbol, consensusPrice, 'websocket', {
      volume24h: undefined,   // Volume comes from individual exchange tickers
      change24h: undefined,
    });
  }

  private computeConsensusPrice(tick: RawTick): number {
    // Gather recent prices from all sources for this symbol
    const recentPrices: { price: number; source: string; age: number }[] = [];
    const now = tick.receivedAtMs;

    for (const [sourceSymbolKey, lastTick] of this.lastTicks) {
      const [source, symbol] = sourceSymbolKey.split(':');
      if (symbol !== tick.symbol) continue;
      if (source === 'coingecko') continue; // Don't include CoinGecko in consensus

      const age = now - lastTick.timestampMs;
      if (age < 2000) { // Only include ticks from the last 2 seconds
        recentPrices.push({ price: lastTick.price, source, age });
      }
    }

    // If only one source, use it directly
    if (recentPrices.length <= 1) {
      return tick.price;
    }

    // Multiple sources: use median for robustness against outliers
    const sorted = recentPrices.map(p => p.price).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private checkDivergence(tick: RawTick): void {
    const wsPrice = this.lastConsensusPrice.get(tick.symbol);
    if (!wsPrice || wsPrice <= 0) return;

    const divergencePct = Math.abs((tick.price - wsPrice) / wsPrice) * 100;
    if (divergencePct > DIVERGENCE_THRESHOLD_PCT) {
      console.warn(
        `[PriceFabric] ⚠️ PRICE DIVERGENCE: ${tick.symbol} — ` +
        `WS: $${wsPrice.toFixed(2)} vs CoinGecko: $${tick.price.toFixed(2)} ` +
        `(${divergencePct.toFixed(2)}% diff)`
      );
      this.emit('price_divergence', {
        symbol: tick.symbol,
        wsPrice,
        coingeckoPrice: tick.price,
        divergencePct,
      });
    }
  }

  // =========================================================================
  // BATCH TICK PERSISTENCE
  // =========================================================================

  private bufferTick(tick: RawTick): void {
    this.tickWriteBuffer.push(tick);

    // Flush if buffer is full
    if (this.tickWriteBuffer.length >= FLUSH_BATCH_SIZE) {
      this.flushTicksToDb().catch(err => {
        console.warn('[PriceFabric] Flush error:', (err as Error).message);
      });
    }
  }

  private async flushTicksToDb(): Promise<void> {
    if (this.tickWriteBuffer.length === 0) return;

    // Take the current buffer and reset
    const batch = this.tickWriteBuffer.splice(0);

    try {
      const { getDb } = await import('../db');
      const { ticks } = await import('../../drizzle/schema');
      const db = await getDb();
      if (!db) return;

      // Batch INSERT — single query for all ticks
      await db.insert(ticks).values(batch.map(t => ({
        symbol: t.symbol,
        price: String(t.price),
        volume: t.volume ? String(t.volume) : null,
        bid: t.bid ? String(t.bid) : null,
        ask: t.ask ? String(t.ask) : null,
        timestampMs: t.timestampMs,
        // Map source to schema enum values (coinapi/coinbase/binance)
        // CoinGecko is filtered out before buffering, but handle defensively
        source: t.source === 'coingecko' ? 'coinbase' as const : t.source as 'coinbase' | 'binance',
        sequenceNumber: t.sequenceNumber || null,
      })));

      this.totalTicksPersisted += batch.length;
    } catch (err) {
      // Non-blocking — ticks are in PriceBuffer in memory for real-time use.
      // DB persistence is for historical analysis, not real-time trading.
      if (this.totalTicksPersisted === 0) {
        // Only log the first failure to reduce noise
        console.warn('[PriceFabric] Tick persistence failed (will retry next batch):', (err as Error).message);
      }
    }
  }

  // =========================================================================
  // STATUS API
  // =========================================================================

  getStatus(): PriceFabricStatus {
    const sources = Array.from(this.sourceHealth.values());
    const combinedTps = sources.reduce((sum, s) => sum + s.ticksPerSecond, 0);

    return {
      isRunning: this.isRunning,
      sources,
      combinedTicksPerSecond: Math.round(combinedTps * 10) / 10,
      totalTicksIngested: this.totalTicksIngested,
      totalTicksPersisted: this.totalTicksPersisted,
      totalTicksDeduped: this.totalTicksDeduped,
      totalGapsDetected: this.totalGapsDetected,
      pendingDbWrites: this.tickWriteBuffer.length,
      symbols: Array.from(this.trackedSymbols),
      uptimeMs: this.isRunning ? Date.now() - this.startedAt : 0,
    };
  }

  getSourceHealthMap(): Map<string, SourceHealth> {
    return new Map(this.sourceHealth);
  }

  getAliveSources(): string[] {
    return Array.from(this.sourceHealth.values())
      .filter(s => s.isAlive)
      .map(s => s.name);
  }

  recordReconnect(source: string): void {
    const health = this.sourceHealth.get(source);
    if (health) {
      health.reconnectCount++;
    }
  }
}

// =========================================================================
// SINGLETON
// =========================================================================

let fabricInstance: PriceFabricService | null = null;

export function getPriceFabric(): PriceFabricService {
  if (!fabricInstance) {
    fabricInstance = new PriceFabricService();
  }
  return fabricInstance;
}

export { PriceFabricService };
