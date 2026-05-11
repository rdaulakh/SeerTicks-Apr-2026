/**
 * scripts/backfill_candles.ts — Phase 80
 *
 * Pulls historical OHLCV from Binance public API and persists to the
 * historicalCandles table so parity_validate.ts can replay current-window
 * trades through the backtest engine.
 *
 * Before this, historicalCandles only held a 3-week-old training window
 * (2026-04-20 → 2026-04-22). Parity tests against live trades produced
 * "Loaded 0 candles".
 *
 * Usage:
 *   npx tsx scripts/backfill_candles.ts                      # last 30d, 1m
 *   npx tsx scripts/backfill_candles.ts --days 7 --interval 1m
 *   npx tsx scripts/backfill_candles.ts --symbols BTC-USD,ETH-USD
 *
 * Sources Binance Futures mainnet (fapi.binance.com) since that's the
 * venue the platform actually trades on. Endpoint is public — no auth.
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import { historicalCandles } from '../drizzle/schema';
import { and, eq, gte, lte } from 'drizzle-orm';

interface BinanceKline {
  // Binance futures kline format:
  // [ openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore ]
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: number;
  [k: number]: any;
}

const SYMBOL_MAP: Record<string, string> = {
  'BTC-USD': 'BTCUSDT',
  'ETH-USD': 'ETHUSDT',
  'SOL-USD': 'SOLUSDT',
};

interface Args {
  symbols: string[];
  days: number;
  interval: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], days: 30, interval: '1m' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--interval') args.interval = argv[++i];
    else if (argv[i] === '--symbols') args.symbols = argv[++i].split(',');
  }
  return args;
}

async function fetchKlines(binanceSymbol: string, interval: string, startMs: number, endMs: number): Promise<BinanceKline[]> {
  // Binance futures public endpoint (mainnet has the data; testnet has only recent days)
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as BinanceKline[];
}

async function backfillSymbol(canonicalSymbol: string, interval: string, days: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  const binanceSymbol = SYMBOL_MAP[canonicalSymbol];
  if (!binanceSymbol) {
    console.warn(`No Binance mapping for ${canonicalSymbol}, skipping`);
    return;
  }

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\n=== ${canonicalSymbol} (${binanceSymbol}) — ${interval} ===`);
  console.log(`Window: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);

  // Find existing range to avoid duplicate inserts
  const existing = await db
    .select({ ts: historicalCandles.timestamp })
    .from(historicalCandles)
    .where(and(
      eq(historicalCandles.symbol, canonicalSymbol),
      eq(historicalCandles.interval, interval),
      gte(historicalCandles.timestamp, new Date(startMs)),
      lte(historicalCandles.timestamp, new Date(endMs)),
    ));
  const existingSet = new Set(existing.map((r: any) => new Date(r.ts).getTime()));
  console.log(`Already in DB: ${existingSet.size} candles in window`);

  // Binance returns max 1500 per request; paginate by time cursor
  let cursor = startMs;
  let totalInserted = 0;
  let totalFetched = 0;
  const intervalMs = intervalToMs(interval);

  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + 1500 * intervalMs, endMs);
    try {
      const klines = await fetchKlines(binanceSymbol, interval, cursor, chunkEnd);
      if (klines.length === 0) break;
      totalFetched += klines.length;

      // Insert candles that aren't already in DB
      const rowsToInsert = klines
        .filter(k => !existingSet.has(k[0]))
        .map(k => ({
          symbol: canonicalSymbol,
          interval,
          timestamp: new Date(k[0]),
          open: k[1],
          high: k[2],
          low: k[3],
          close: k[4],
          volume: k[5],
          source: 'binance-futures',
        }));

      if (rowsToInsert.length > 0) {
        // Insert in chunks to stay under MySQL max_packet
        const CHUNK = 500;
        for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
          await db.insert(historicalCandles).values(rowsToInsert.slice(i, i + CHUNK));
        }
        totalInserted += rowsToInsert.length;
      }

      // Advance cursor past last fetched candle
      const lastTs = klines[klines.length - 1][0];
      cursor = lastTs + intervalMs;

      // Small breathing room — Binance has rate limits (typically 1200/min)
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.error(`  Chunk ${new Date(cursor).toISOString()} failed:`, (e as Error).message);
      cursor += 1500 * intervalMs; // skip and continue
    }
  }

  console.log(`Fetched: ${totalFetched} | Inserted (new): ${totalInserted} | Already existed: ${totalFetched - totalInserted}`);
}

function intervalToMs(interval: string): number {
  const m: Record<string, number> = {
    '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000,
    '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1d': 24 * 60 * 60_000,
  };
  return m[interval] ?? 60_000;
}

async function main() {
  const args = parseArgs();
  console.log(`Phase 80 — historical candle backfill`);
  console.log(`Symbols: ${args.symbols.join(', ')} | Interval: ${args.interval} | Days back: ${args.days}`);

  for (const sym of args.symbols) {
    try {
      await backfillSymbol(sym, args.interval, args.days);
    } catch (e) {
      console.error(`${sym} backfill failed:`, (e as Error).message);
    }
  }

  // Verify
  const db = await getDb();
  if (db) {
    const verify = await db
      .select({ symbol: historicalCandles.symbol, interval: historicalCandles.interval })
      .from(historicalCandles)
      .where(eq(historicalCandles.interval, args.interval));
    const counts = new Map<string, number>();
    for (const row of verify) {
      counts.set(row.symbol, (counts.get(row.symbol) ?? 0) + 1);
    }
    console.log('\n=== Final counts ===');
    for (const [sym, cnt] of counts) {
      console.log(`  ${sym} ${args.interval}: ${cnt} candles`);
    }
  }

  console.log('\n✓ Backfill complete');
  process.exit(0);
}

main().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
