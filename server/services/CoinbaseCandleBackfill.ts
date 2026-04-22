/**
 * Coinbase Historical Candle Backfill
 *
 * Phase 4: fixes the empty `historicalCandles` table that was starving every
 * agent and risk calculation of OHLCV context (MacroAnalyst, TechnicalAnalyst,
 * VaRRiskGate returns buffer, entry gates requiring minHistoricalCandlesRequired).
 *
 * Design:
 *   - Uses the PUBLIC Coinbase Exchange API (api.exchange.coinbase.com/products/
 *     {sym}/candles). Public = no auth, no key, same rate limits regardless of
 *     account tier. Important: this endpoint is NOT geo-blocked the way the
 *     Binance WS is — it works from US-East.
 *   - Exchange API returns candles as raw tuples [time, low, high, open, close,
 *     volume], newest first. Max 300 candles per request. We page backwards
 *     from now until we've collected `targetCount` candles (or hit the provided
 *     `maxPages` safety cap).
 *   - Stores via saveCandlesToDatabase() in canonical Coinbase symbol format
 *     (BTC-USD), which getSymbolVariations() already maps to every query shape
 *     used by loaders.
 *
 * Call sites:
 *   - On-demand from boot if the cache is empty (backfillIfEmpty, below).
 *   - Can be run manually via a script for deep backfills (e.g. 365d × 1d).
 *
 * NOT called:
 *   - On every boot unconditionally — that would hammer the API for no reason
 *     once the DB is populated. We check DB count first and only backfill the
 *     symbol/timeframe pairs that are actually empty (or below a min threshold).
 */

import { saveCandlesToDatabase, getCandleCount } from '../db/candleStorage';
import type { Candle } from '../WebSocketCandleCache';

// Coinbase Exchange API granularity is specified in SECONDS (not the enum used
// by the Advanced Trade API). NOTE: 4h is NOT a native Coinbase granularity
// — we aggregate from 1h below (see fetchAndAggregate4h).
const GRANULARITY_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
};

// Coinbase returns at most 300 candles per call.
const COINBASE_MAX_PER_REQUEST = 300;

// How many candles to target per (symbol, interval) pair when backfilling a
// fresh DB. Tuned so risk/entry gates and agents have enough runway without
// making the initial backfill take minutes.
const DEFAULT_TARGET_COUNT: Record<string, number> = {
  '1m': 600,   // 10 hours — enough for micro-entry timing + cache warm-up
  '5m': 576,   // 2 days
  '15m': 384,  // 4 days
  '1h': 720,   // 30 days
  '4h': 180,   // 30 days (aggregated from 1h)
  '6h': 360,   // 90 days
  '1d': 365,   // 1 year
};

// Minimum acceptable count — if the DB has fewer than this for a pair, we
// backfill; otherwise we assume it's populated and skip.
const MIN_ACCEPTABLE_COUNT = 50;

interface ExchangeCandleTuple {
  0: number; // time (seconds)
  1: number; // low
  2: number; // high
  3: number; // open
  4: number; // close
  5: number; // volume
}

function toCoinbaseProductId(symbol: string): string {
  // Accept BTC-USD (passthrough), BTCUSDT (strip T, insert dash), BTCUSD (insert dash).
  if (symbol.includes('-')) return symbol;
  const m = symbol.replace(/T$/, '').match(/^(.+?)(USD|EUR|GBP)$/);
  if (m) return `${m[1]}-${m[2]}`;
  return symbol;
}

async function fetchCandlePage(
  productId: string,
  granularitySec: number,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const url =
    `https://api.exchange.coinbase.com/products/${productId}/candles` +
    `?granularity=${granularitySec}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'seerticks-backfill/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Coinbase candles ${productId} ${granularitySec}s: HTTP ${res.status}`);
  }
  const raw = (await res.json()) as ExchangeCandleTuple[];
  if (!Array.isArray(raw)) {
    throw new Error(`Coinbase candles ${productId} ${granularitySec}s: non-array response`);
  }
  return raw.map((t) => ({
    timestamp: t[0] * 1000,
    low: t[1],
    high: t[2],
    open: t[3],
    close: t[4],
    volume: t[5],
  }));
}

/**
 * Fetch `targetCount` contiguous candles by paging the Coinbase Exchange
 * candles endpoint backwards from now. Returns ascending, deduped candles.
 *
 * Extracted from backfillSymbolInterval so the synthetic-4h path can reuse
 * the pager without having to first save 1h into the DB.
 */
async function fetchContiguousCandles(
  productId: string,
  granularitySec: number,
  targetCount: number,
): Promise<Candle[]> {
  const windowMs = granularitySec * 1000 * COINBASE_MAX_PER_REQUEST;
  const collected: Candle[] = [];
  const maxPages = Math.ceil(targetCount / COINBASE_MAX_PER_REQUEST) + 2;
  let endMs = Date.now();

  for (let page = 0; page < maxPages && collected.length < targetCount; page++) {
    const startMs = endMs - windowMs;
    try {
      const batch = await fetchCandlePage(productId, granularitySec, startMs, endMs);
      if (batch.length === 0) break;
      collected.push(...batch);
      endMs = startMs - 1;
    } catch (err: any) {
      console.warn(
        `[CoinbaseBackfill] ${productId} ${granularitySec}s page ${page} failed: ${err.message}`,
      );
      break;
    }
    // Be polite to the public API (10 req/s shared limit).
    await new Promise((r) => setTimeout(r, 120));
  }

  const byTs = new Map<number, Candle>();
  for (const c of collected) byTs.set(c.timestamp, c);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Aggregate N×1h candles into buckets of `bucketHours` hours each
 * (e.g. 4h = 4 × 1h). Bucket alignment is by floor(timestampMs /
 * bucketMs) — so buckets are wall-clock aligned (00:00, 04:00, 08:00…)
 * regardless of when this backfill runs.
 *
 * Within each bucket:
 *   open  = first 1h candle's open
 *   close = last 1h candle's close
 *   high  = max of 1h highs
 *   low   = min of 1h lows
 *   volume = sum of 1h volumes
 *
 * Only buckets with ALL expected 1h candles are emitted — partial
 * buckets would give agents misleading high/low ranges.
 */
function aggregate1hToNh(candles1h: Candle[], bucketHours: number): Candle[] {
  const bucketMs = bucketHours * 3600 * 1000;
  const byBucket = new Map<number, Candle[]>();
  for (const c of candles1h) {
    const bucketStart = Math.floor(c.timestamp / bucketMs) * bucketMs;
    const arr = byBucket.get(bucketStart) ?? [];
    arr.push(c);
    byBucket.set(bucketStart, arr);
  }
  const out: Candle[] = [];
  for (const [bucketStart, members] of byBucket.entries()) {
    if (members.length < bucketHours) continue; // skip partial buckets
    members.sort((a, b) => a.timestamp - b.timestamp);
    out.push({
      timestamp: bucketStart,
      open: members[0].open,
      close: members[members.length - 1].close,
      high: Math.max(...members.map((m) => m.high)),
      low: Math.min(...members.map((m) => m.low)),
      volume: members.reduce((s, m) => s + m.volume, 0),
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Backfill a single (symbol, interval) pair from Coinbase.
 *
 * Returns the number of candles saved. Idempotent-ish: the DB has no unique
 * constraint on (symbol, interval, timestamp) in the current schema, so
 * repeated calls will duplicate rows. We avoid that by only invoking this
 * when the count is below MIN_ACCEPTABLE_COUNT (see backfillIfEmpty).
 *
 * Special case: '4h' is synthesized by aggregating 1h candles (Coinbase
 * Exchange API doesn't expose a native 4h granularity).
 */
export async function backfillSymbolInterval(
  symbol: string,
  interval: string,
  targetCount?: number,
): Promise<number> {
  // --- Synthetic 4h: aggregate from 1h ---
  if (interval === '4h') {
    const productId = toCoinbaseProductId(symbol);
    const target4h = targetCount ?? DEFAULT_TARGET_COUNT['4h'] ?? 180;
    // Need ~4× 1h candles + a small buffer for partial-bucket trimming.
    const needed1h = target4h * 4 + 8;
    const hourly = await fetchContiguousCandles(productId, 3600, needed1h);
    if (hourly.length === 0) {
      console.warn(`[CoinbaseBackfill] ${productId} 4h: no 1h source candles`);
      return 0;
    }
    const fourHour = aggregate1hToNh(hourly, 4);
    if (fourHour.length === 0) {
      console.warn(`[CoinbaseBackfill] ${productId} 4h: aggregation produced 0 buckets`);
      return 0;
    }
    const saved = await saveCandlesToDatabase(productId, '4h', fourHour);
    console.log(
      `[CoinbaseBackfill] ✅ ${productId} 4h: aggregated ${fourHour.length} from ${hourly.length}×1h, saved ${saved}`,
    );
    return saved;
  }

  const granularitySec = GRANULARITY_SECONDS[interval];
  if (!granularitySec) {
    console.warn(`[CoinbaseBackfill] Unsupported interval: ${interval}`);
    return 0;
  }

  const productId = toCoinbaseProductId(symbol);
  const target = targetCount ?? DEFAULT_TARGET_COUNT[interval] ?? 200;

  const sorted = await fetchContiguousCandles(productId, granularitySec, target);

  if (sorted.length === 0) {
    console.warn(`[CoinbaseBackfill] ${symbol} ${interval}: no candles fetched`);
    return 0;
  }

  // Store under the canonical Coinbase product id (BTC-USD). getSymbolVariations
  // handles every other query format.
  const saved = await saveCandlesToDatabase(productId, interval, sorted);
  console.log(
    `[CoinbaseBackfill] ✅ ${productId} ${interval}: fetched ${sorted.length}, saved ${saved}`,
  );
  return saved;
}

/**
 * Boot-time helper: backfill only the (symbol, interval) pairs whose DB count
 * is below MIN_ACCEPTABLE_COUNT. Safe to call on every start — it's fast and
 * idempotent when the DB is already warm.
 *
 * Run in background; never block boot on this.
 */
export async function backfillIfEmpty(
  symbols: string[],
  // Default covers every timeframe the orchestrator stack needs:
  //   1d / 4h / 1h  → MacroAnalyst, StrategyOrchestrator, MultiTimeframeAlignment
  //   5m            → TechnicalAnalyst, 5m confirmation leg
  //   1m            → micro-entry timing + TickToCandleAggregator cache warm-up
  // 4h is synthesized from 1h inside backfillSymbolInterval.
  intervals: string[] = ['1d', '4h', '1h', '5m', '1m'],
): Promise<void> {
  const startedAt = Date.now();
  let filled = 0;
  let skipped = 0;

  for (const rawSymbol of symbols) {
    const productId = toCoinbaseProductId(rawSymbol);
    for (const interval of intervals) {
      try {
        const existing = await getCandleCount(productId, interval);
        if (existing >= MIN_ACCEPTABLE_COUNT) {
          skipped++;
          continue;
        }
        console.log(
          `[CoinbaseBackfill] ${productId} ${interval} has ${existing} candles (< ${MIN_ACCEPTABLE_COUNT}), backfilling...`,
        );
        await backfillSymbolInterval(productId, interval);
        filled++;
      } catch (err: any) {
        console.warn(
          `[CoinbaseBackfill] backfillIfEmpty ${productId} ${interval} failed: ${err.message}`,
        );
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[CoinbaseBackfill] backfillIfEmpty complete: filled ${filled}, skipped ${skipped} (${elapsedMs}ms)`,
  );
}
