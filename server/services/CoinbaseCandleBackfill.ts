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
// by the Advanced Trade API).
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
  '1m': 600,   // 10 hours
  '5m': 576,   // 2 days
  '15m': 384,  // 4 days
  '1h': 720,   // 30 days
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
 * Backfill a single (symbol, interval) pair from Coinbase.
 *
 * Returns the number of candles saved. Idempotent-ish: the DB has no unique
 * constraint on (symbol, interval, timestamp) in the current schema, so
 * repeated calls will duplicate rows. We avoid that by only invoking this
 * when the count is below MIN_ACCEPTABLE_COUNT (see backfillIfEmpty).
 */
export async function backfillSymbolInterval(
  symbol: string,
  interval: string,
  targetCount?: number,
): Promise<number> {
  const granularitySec = GRANULARITY_SECONDS[interval];
  if (!granularitySec) {
    console.warn(`[CoinbaseBackfill] Unsupported interval: ${interval}`);
    return 0;
  }

  const productId = toCoinbaseProductId(symbol);
  const target = targetCount ?? DEFAULT_TARGET_COUNT[interval] ?? 200;
  const windowMs = granularitySec * 1000 * COINBASE_MAX_PER_REQUEST;

  const collected: Candle[] = [];
  const maxPages = Math.ceil(target / COINBASE_MAX_PER_REQUEST) + 2; // small safety margin
  let endMs = Date.now();

  for (let page = 0; page < maxPages && collected.length < target; page++) {
    const startMs = endMs - windowMs;
    try {
      const batch = await fetchCandlePage(productId, granularitySec, startMs, endMs);
      if (batch.length === 0) break;
      collected.push(...batch);
      // Page backwards — next request ends where this one started, minus 1ms
      // to avoid double-counting the boundary candle.
      endMs = startMs - 1;
    } catch (err: any) {
      console.warn(
        `[CoinbaseBackfill] ${symbol} ${interval} page ${page} failed: ${err.message}`,
      );
      break;
    }
    // Be polite to the public API (10 req/s shared limit).
    await new Promise((r) => setTimeout(r, 120));
  }

  if (collected.length === 0) {
    console.warn(`[CoinbaseBackfill] ${symbol} ${interval}: no candles fetched`);
    return 0;
  }

  // Coinbase returns newest-first within each page; we paged backwards, so
  // `collected` is roughly reverse-chronological. Sort ascending and dedupe
  // by timestamp before insert.
  const byTs = new Map<number, Candle>();
  for (const c of collected) byTs.set(c.timestamp, c);
  const sorted = [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);

  // Store under the canonical Coinbase product id (BTC-USD). getSymbolVariations
  // handles every other query format.
  const saved = await saveCandlesToDatabase(productId, interval, sorted);
  console.log(
    `[CoinbaseBackfill] ✅ ${productId} ${interval}: fetched ${collected.length}, deduped ${sorted.length}, saved ${saved}`,
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
  intervals: string[] = ['1d', '1h', '5m'],
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
