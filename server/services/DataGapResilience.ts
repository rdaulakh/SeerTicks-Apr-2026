/**
 * Phase 13E: Data Gap Resilience Service
 *
 * Eliminates the ~1,865 data gaps/day identified in the audit by:
 *
 * 1. **WebSocket Reconnect Backfill** — After CoinbasePublicWS reconnects,
 *    immediately fetches missed ticks via Coinbase REST for the disconnect window.
 *
 * 2. **Fallback REST Poller** — When the WebSocket feed goes stale (>5s without
 *    a tick), starts polling Coinbase REST at 2-second intervals until the WS
 *    recovers. Seamlessly feeds prices into priceFeedService so all downstream
 *    consumers stay alive.
 *
 * 3. **Rapid Gap Scanner** — Scans the dataGapLogs table every 5 minutes
 *    (instead of the old 24-hour cycle) and recovers pending gaps immediately.
 *
 * 4. **Gap Detection at PriceFeedService level** — Monitors per-symbol tick
 *    intervals and logs gaps when the interval exceeds a configurable threshold.
 *
 * Architecture:
 *   CoinbasePublicWS → 'connected' event → backfillDisconnectWindow()
 *   TickStalenessMonitor → 'stale' event → startRESTPoller()
 *   Internal timer → every 5 min → rapidGapScan()
 *
 * All REST calls use FREE Coinbase Exchange + Binance APIs (no keys).
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { priceFeedService } from './priceFeedService';

// ─── Configuration ───────────────────────────────────────────────────────────

const COINBASE_REST = 'https://api.exchange.coinbase.com';
const BINANCE_REST = 'https://api.binance.com/api/v3';

const STALE_THRESHOLD_MS = 5_000;       // 5s without tick = stale
const REST_POLL_INTERVAL_MS = 2_000;    // Poll every 2s when WS is down
const RAPID_GAP_SCAN_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const GAP_DETECTION_THRESHOLD_MS = 10_000; // 10s without tick = log gap
const BACKFILL_MAX_WINDOW_MS = 5 * 60 * 1_000; // Max 5 min backfill window
const REST_TIMEOUT_MS = 8_000;

// Symbol mappings (Coinbase uses BTC-USD, Binance uses BTCUSDT)
const COINBASE_MAP: Record<string, string> = {
  'BTC-USD': 'BTC-USD', 'ETH-USD': 'ETH-USD', 'SOL-USD': 'SOL-USD',
  'BTC-USDT': 'BTC-USD', 'ETH-USDT': 'ETH-USD', 'SOL-USDT': 'SOL-USD',
};
const BINANCE_MAP: Record<string, string> = {
  'BTC-USD': 'BTCUSDT', 'ETH-USD': 'ETHUSDT', 'SOL-USD': 'SOLUSDT',
  'BTC-USDT': 'BTCUSDT', 'ETH-USDT': 'ETHUSDT', 'SOL-USDT': 'SOLUSDT',
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ResilienceStats {
  restPollCount: number;
  restPollErrors: number;
  backfillCount: number;
  backfillTicksRecovered: number;
  gapsDetected: number;
  gapsRecoveredRapid: number;
  isRESTPolling: boolean;
  lastRESTPrice: Record<string, { price: number; timestamp: number }>;
  lastBackfillAt: number;
  lastGapScanAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class DataGapResilienceService extends EventEmitter {
  private symbols: string[] = ['BTC-USD', 'ETH-USD'];
  private isRunning = false;

  // REST Poller state
  private restPollerTimer: NodeJS.Timeout | null = null;
  private isRESTPolling = false;

  // Gap detection state (per-symbol last tick time)
  private lastTickTime: Map<string, number> = new Map();
  private gapDetectionTimer: NodeJS.Timeout | null = null;

  // Rapid gap scanner
  private rapidScanTimer: NodeJS.Timeout | null = null;

  // Backfill state
  private lastDisconnectTime: number = 0;
  private isBackfilling = false;

  // Stats
  private stats: ResilienceStats = {
    restPollCount: 0,
    restPollErrors: 0,
    backfillCount: 0,
    backfillTicksRecovered: 0,
    gapsDetected: 0,
    gapsRecoveredRapid: 0,
    isRESTPolling: false,
    lastRESTPrice: {},
    lastBackfillAt: 0,
    lastGapScanAt: 0,
  };

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Start the resilience service.
   * Call after CoinbasePublicWS and priceFeedService are initialized.
   */
  start(symbols?: string[]): void {
    if (this.isRunning) return;

    if (symbols && symbols.length > 0) {
      this.symbols = symbols;
    }

    console.log(`[DataGapResilience] Starting for: ${this.symbols.join(', ')}`);
    this.isRunning = true;

    // 1. Subscribe to priceFeedService for gap detection
    this.startGapDetection();

    // 2. Listen for CoinbasePublicWS reconnect events
    this.attachWebSocketListeners();

    // 3. Start rapid gap scanner (every 5 min)
    this.startRapidGapScanner();

    console.log('[DataGapResilience] ✅ Service started');
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.stopRESTPoller();

    if (this.gapDetectionTimer) {
      clearInterval(this.gapDetectionTimer);
      this.gapDetectionTimer = null;
    }
    if (this.rapidScanTimer) {
      clearInterval(this.rapidScanTimer);
      this.rapidScanTimer = null;
    }

    console.log('[DataGapResilience] Stopped');
  }

  getStats(): ResilienceStats {
    return { ...this.stats, isRESTPolling: this.isRESTPolling };
  }

  // ─── 1. Gap Detection (PriceFeedService level) ──────────────────────────

  private startGapDetection(): void {
    // Initialize last tick times
    for (const symbol of this.symbols) {
      this.lastTickTime.set(symbol, getActiveClock().now());
    }

    // Listen for price updates
    priceFeedService.on('price_update', (data: { symbol: string; timestamp: number }) => {
      const sym = data.symbol;
      if (this.symbols.includes(sym)) {
        this.lastTickTime.set(sym, getActiveClock().now());

        // If we were REST polling and WS is back, stop polling
        if (this.isRESTPolling) {
          this.checkIfWSRecovered();
        }
      }
    });

    // Periodic check for staleness → trigger REST poller
    this.gapDetectionTimer = setInterval(() => {
      this.detectGaps();
    }, 2_000); // Check every 2s

    if (this.gapDetectionTimer.unref) {
      this.gapDetectionTimer.unref();
    }
  }

  private detectGaps(): void {
    const now = getActiveClock().now();
    let anyStale = false;

    for (const symbol of this.symbols) {
      const lastTick = this.lastTickTime.get(symbol) || 0;
      const gap = now - lastTick;

      // Log gap if threshold exceeded
      if (gap > GAP_DETECTION_THRESHOLD_MS) {
        this.logGapDetected(symbol, lastTick, now);
      }

      // Trigger REST poller if stale
      if (gap > STALE_THRESHOLD_MS) {
        anyStale = true;
      }
    }

    if (anyStale && !this.isRESTPolling) {
      console.warn('[DataGapResilience] ⚠️ WebSocket feed stale — starting REST fallback poller');
      this.startRESTPoller();
    }
  }

  private async logGapDetected(symbol: string, gapStartMs: number, gapEndMs: number): Promise<void> {
    this.stats.gapsDetected++;

    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { dataGapLogs } = await import('../../drizzle/schema');

      await db.insert(dataGapLogs).values({
        symbol,
        gapStartMs,
        gapEndMs,
        missedTicksEstimate: Math.floor((gapEndMs - gapStartMs) / 1000), // ~1 tick/sec estimate
        recoveryStatus: 'pending',
        detectedBy: 'data_gap_resilience',
      });
    } catch (err) {
      // Non-critical — don't crash the service
      console.error('[DataGapResilience] Failed to log gap:', (err as Error)?.message);
    }
  }

  // ─── 2. Fallback REST Poller ─────────────────────────────────────────────

  private startRESTPoller(): void {
    if (this.isRESTPolling) return;

    this.isRESTPolling = true;
    this.stats.isRESTPolling = true;
    this.lastDisconnectTime = getActiveClock().now();

    console.log('[DataGapResilience] 🔄 REST fallback poller started');
    this.emit('rest_poller_started');

    // Immediate first poll
    this.pollREST();

    // Then poll every REST_POLL_INTERVAL_MS
    this.restPollerTimer = setInterval(() => {
      this.pollREST();
    }, REST_POLL_INTERVAL_MS);

    if (this.restPollerTimer.unref) {
      this.restPollerTimer.unref();
    }
  }

  private stopRESTPoller(): void {
    if (!this.isRESTPolling) return;

    this.isRESTPolling = false;
    this.stats.isRESTPolling = false;

    if (this.restPollerTimer) {
      clearInterval(this.restPollerTimer);
      this.restPollerTimer = null;
    }

    console.log('[DataGapResilience] ✅ REST fallback poller stopped (WebSocket recovered)');
    this.emit('rest_poller_stopped');
  }

  private checkIfWSRecovered(): void {
    const now = getActiveClock().now();
    let allFresh = true;

    for (const symbol of this.symbols) {
      const lastTick = this.lastTickTime.get(symbol) || 0;
      if (now - lastTick > STALE_THRESHOLD_MS) {
        allFresh = false;
        break;
      }
    }

    if (allFresh) {
      this.stopRESTPoller();

      // Trigger backfill for the disconnect window
      const disconnectDuration = now - this.lastDisconnectTime;
      if (disconnectDuration > 3_000 && disconnectDuration < BACKFILL_MAX_WINDOW_MS) {
        this.backfillDisconnectWindow(this.lastDisconnectTime, now);
      }
    }
  }

  private async pollREST(): Promise<void> {
    for (const symbol of this.symbols) {
      try {
        const price = await this.fetchRESTPrice(symbol);
        if (price && price > 0) {
          // Feed into priceFeedService as 'rest' source
          priceFeedService.updatePrice(symbol, price, 'rest');
          this.stats.restPollCount++;
          this.stats.lastRESTPrice[symbol] = { price, timestamp: getActiveClock().now() };
          this.lastTickTime.set(symbol, getActiveClock().now());
        }
      } catch (err) {
        this.stats.restPollErrors++;
        // Silently continue — REST is fallback, errors are expected
      }
    }
  }

  /**
   * Fetch current price from Coinbase REST (free, no key).
   * Falls back to Binance if Coinbase fails.
   */
  private async fetchRESTPrice(symbol: string): Promise<number | null> {
    // Try Coinbase first
    const coinbaseSymbol = COINBASE_MAP[symbol];
    if (coinbaseSymbol) {
      try {
        const res = await fetch(`${COINBASE_REST}/products/${coinbaseSymbol}/ticker`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json() as { price: string };
          const price = parseFloat(data.price);
          if (price > 0) return price;
        }
      } catch {
        // Fall through to Binance
      }
    }

    // Fallback: Binance
    const binanceSymbol = BINANCE_MAP[symbol];
    if (binanceSymbol) {
      try {
        const res = await fetch(`${BINANCE_REST}/ticker/price?symbol=${binanceSymbol}`, {
          signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json() as { price: string };
          const price = parseFloat(data.price);
          if (price > 0) return price;
        }
      } catch {
        // Both failed
      }
    }

    return null;
  }

  // ─── 3. WebSocket Reconnect Backfill ─────────────────────────────────────

  private attachWebSocketListeners(): void {
    // Lazy import to avoid circular dependency
    import('./CoinbasePublicWebSocket').then(({ coinbasePublicWebSocket }) => {
      // Track disconnect time
      coinbasePublicWebSocket.on('disconnected', () => {
        this.lastDisconnectTime = getActiveClock().now();
        console.log('[DataGapResilience] WebSocket disconnected — tracking gap window');
      });

      // On reconnect, backfill the gap
      coinbasePublicWebSocket.on('connected', () => {
        const now = getActiveClock().now();
        const gapDuration = now - this.lastDisconnectTime;

        if (this.lastDisconnectTime > 0 && gapDuration > 3_000 && gapDuration < BACKFILL_MAX_WINDOW_MS) {
          console.log(`[DataGapResilience] WebSocket reconnected after ${Math.round(gapDuration / 1000)}s — backfilling...`);
          this.backfillDisconnectWindow(this.lastDisconnectTime, now);
        }
      });

      console.log('[DataGapResilience] ✅ Attached to CoinbasePublicWebSocket events');
    }).catch(err => {
      console.warn('[DataGapResilience] Could not attach to CoinbasePublicWS:', (err as Error)?.message);
    });
  }

  /**
   * Backfill missed ticks for the disconnect window using Coinbase REST trades API.
   */
  private async backfillDisconnectWindow(fromMs: number, toMs: number): Promise<void> {
    if (this.isBackfilling) return;
    this.isBackfilling = true;

    console.log(`[DataGapResilience] 🔄 Backfilling ${Math.round((toMs - fromMs) / 1000)}s disconnect window...`);

    let totalRecovered = 0;

    for (const symbol of this.symbols) {
      try {
        const trades = await this.fetchHistoricalTrades(symbol, fromMs, toMs);
        if (trades.length > 0) {
          // Persist to ticks table
          await this.persistBackfilledTicks(symbol, trades);
          totalRecovered += trades.length;
        }
      } catch (err) {
        console.error(`[DataGapResilience] Backfill failed for ${symbol}:`, (err as Error)?.message);
      }
    }

    this.stats.backfillCount++;
    this.stats.backfillTicksRecovered += totalRecovered;
    this.stats.lastBackfillAt = getActiveClock().now();
    this.isBackfilling = false;

    console.log(`[DataGapResilience] ✅ Backfill complete: ${totalRecovered} ticks recovered`);
    this.emit('backfill_complete', { ticksRecovered: totalRecovered, fromMs, toMs });
  }

  /**
   * Fetch historical trades from Coinbase REST (free).
   * Falls back to Binance.
   */
  private async fetchHistoricalTrades(
    symbol: string,
    fromMs: number,
    toMs: number
  ): Promise<Array<{ price: number; volume: number; timestampMs: number }>> {
    // Coinbase /products/{id}/trades returns most recent trades
    const coinbaseSymbol = COINBASE_MAP[symbol];
    if (coinbaseSymbol) {
      try {
        const res = await fetch(`${COINBASE_REST}/products/${coinbaseSymbol}/trades?limit=1000`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json() as Array<{ time: string; price: string; size: string }>;
          return data
            .filter(t => {
              const ts = new Date(t.time).getTime();
              return ts >= fromMs && ts <= toMs;
            })
            .map(t => ({
              price: parseFloat(t.price),
              volume: parseFloat(t.size),
              timestampMs: new Date(t.time).getTime(),
            }));
        }
      } catch {
        // Fall through to Binance
      }
    }

    // Binance fallback
    const binanceSymbol = BINANCE_MAP[symbol];
    if (binanceSymbol) {
      try {
        const res = await fetch(
          `${BINANCE_REST}/aggTrades?symbol=${binanceSymbol}&startTime=${fromMs}&endTime=${toMs}&limit=1000`,
          { signal: AbortSignal.timeout(REST_TIMEOUT_MS) }
        );
        if (res.ok) {
          const data = await res.json() as Array<{ p: string; q: string; T: number }>;
          return data.map(t => ({
            price: parseFloat(t.p),
            volume: parseFloat(t.q),
            timestampMs: t.T,
          }));
        }
      } catch {
        // Both failed
      }
    }

    return [];
  }

  private async persistBackfilledTicks(
    symbol: string,
    trades: Array<{ price: number; volume: number; timestampMs: number }>
  ): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db || trades.length === 0) return;

      const { ticks } = await import('../../drizzle/schema');

      // Batch insert in chunks of 100
      const CHUNK_SIZE = 100;
      for (let i = 0; i < trades.length; i += CHUNK_SIZE) {
        const chunk = trades.slice(i, i + CHUNK_SIZE);
        await db.insert(ticks).values(
          chunk.map(t => ({
            symbol,
            price: t.price.toString(),
            volume: t.volume.toString(),
            timestampMs: t.timestampMs,
            source: 'rest_backfill' as const,
          }))
        );
      }
    } catch (err) {
      console.error(`[DataGapResilience] Failed to persist backfilled ticks for ${symbol}:`, (err as Error)?.message);
    }
  }

  // ─── 4. Rapid Gap Scanner ────────────────────────────────────────────────

  private startRapidGapScanner(): void {
    // First scan after 60s to let other services initialize
    setTimeout(() => {
      this.runRapidGapScan();
    }, 60_000);

    // Then every 5 minutes
    this.rapidScanTimer = setInterval(() => {
      this.runRapidGapScan();
    }, RAPID_GAP_SCAN_INTERVAL_MS);

    if (this.rapidScanTimer.unref) {
      this.rapidScanTimer.unref();
    }
  }

  /**
   * Scan dataGapLogs for pending gaps and recover them immediately.
   * Runs every 5 minutes (vs the old 24-hour DataGapRecoveryService cycle).
   */
  private async runRapidGapScan(): Promise<void> {
    this.stats.lastGapScanAt = getActiveClock().now();

    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { dataGapLogs } = await import('../../drizzle/schema');
      const { eq, and, lt } = await import('drizzle-orm');

      // Find pending gaps with < 3 recovery attempts
      const pendingGaps = await db
        .select()
        .from(dataGapLogs)
        .where(
          and(
            eq(dataGapLogs.recoveryStatus, 'pending'),
            lt(dataGapLogs.recoveryAttempts, 3)
          )
        )
        .limit(50);

      if (pendingGaps.length === 0) return;

      console.log(`[DataGapResilience] Rapid scan: ${pendingGaps.length} pending gaps found`);

      for (const gap of pendingGaps) {
        try {
          // Mark as recovering
          await db.update(dataGapLogs).set({
            recoveryStatus: 'recovering',
            recoveryAttempts: gap.recoveryAttempts + 1,
          }).where(eq(dataGapLogs.id, gap.id));

          // Fetch trades for the gap window
          const trades = await this.fetchHistoricalTrades(
            gap.symbol,
            Number(gap.gapStartMs),
            Number(gap.gapEndMs)
          );

          if (trades.length > 0) {
            await this.persistBackfilledTicks(gap.symbol, trades);
          }

          // Mark as recovered
          await db.update(dataGapLogs).set({
            recoveryStatus: 'recovered',
            recoveredAt: new Date(),
          }).where(eq(dataGapLogs.id, gap.id));

          this.stats.gapsRecoveredRapid++;
        } catch (err) {
          console.error(`[DataGapResilience] Failed to recover gap ${gap.id}:`, (err as Error)?.message);

          // Mark as failed if max attempts reached
          if (gap.recoveryAttempts + 1 >= 3) {
            await db.update(dataGapLogs).set({
              recoveryStatus: 'failed',
            }).where(eq(dataGapLogs.id, gap.id)).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[DataGapResilience] Rapid gap scan error:', (err as Error)?.message);
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

export const dataGapResilience = new DataGapResilienceService();
