/**
 * Phase 37a — Fetch 1 year of real 15-min OHLCV candles from Binance.
 *
 * Why Binance and not Coinbase: Binance's klines endpoint is auth-free,
 * generous on rate limits, and supports up to 1000 candles per request.
 * Symbol mapping: BTC-USD → BTCUSDT, ETH-USD → ETHUSDT, SOL-USD → SOLUSDT.
 *
 * 1 year of 15-min candles ≈ 35,040 per symbol → ~36 requests per symbol
 * → ~108 requests total → ~3 minutes with conservative throttling.
 *
 * Output: data/backtest-yearly/candles/{symbol}.json
 *   { symbol, interval, start, end, candles: [{ t, o, h, l, c, v }, ...] }
 *
 * The format is intentionally minimal so the replay harness can iterate
 * without conversion. Timestamps are ms epoch UTC.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

interface Candle {
  t: number;  // open time, ms
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

const SYMBOLS: Array<{ display: string; binance: string }> = [
  { display: 'BTC-USD', binance: 'BTCUSDT' },
  { display: 'ETH-USD', binance: 'ETHUSDT' },
  { display: 'SOL-USD', binance: 'SOLUSDT' },
];

// Phase 38 — make INTERVAL CLI-controllable so we can fetch 1h and 4h too.
function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
const INTERVAL = getArg('interval', '15m');
const INTERVAL_MS_BY = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 } as const;
const INTERVAL_MS = (INTERVAL_MS_BY as any)[INTERVAL] ?? 900_000;
const NOW = Date.now();
const ONE_YEAR_MS = 365 * 24 * 60 * 60_000;
const START_TIME = NOW - ONE_YEAR_MS;
const REQUEST_LIMIT = 1000;
const BINANCE_BASE = 'https://api.binance.com';

async function fetchKlines(
  binanceSymbol: string,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${binanceSymbol}&interval=${INTERVAL}&startTime=${startMs}&endTime=${endMs}&limit=${REQUEST_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance ${res.status}: ${await res.text()}`);
  }
  const raw = (await res.json()) as Array<[number, string, string, string, string, string, ...any[]]>;
  return raw.map((row) => ({
    t: row[0],
    o: parseFloat(row[1]),
    h: parseFloat(row[2]),
    l: parseFloat(row[3]),
    c: parseFloat(row[4]),
    v: parseFloat(row[5]),
  }));
}

async function fetchYearForSymbol(displaySymbol: string, binanceSymbol: string): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = START_TIME;
  let pages = 0;
  while (cursor < NOW) {
    const pageEnd = Math.min(cursor + REQUEST_LIMIT * INTERVAL_MS, NOW);
    process.stdout.write(`  ${displaySymbol} page ${++pages} ${new Date(cursor).toISOString().slice(0, 10)}…`);
    const batch = await fetchKlines(binanceSymbol, cursor, pageEnd);
    if (batch.length === 0) break;
    candles.push(...batch);
    process.stdout.write(` got ${batch.length}, total ${candles.length}\n`);
    // Move cursor past the LAST candle we received (avoids overlap dedup).
    cursor = batch[batch.length - 1].t + INTERVAL_MS;
    // Conservative throttle — Binance allows ~1200 req/min, we send ~1 req/sec.
    await new Promise((r) => setTimeout(r, 250));
  }
  // De-duplicate by `t` (defensive against any cursor wobble).
  const seen = new Set<number>();
  const deduped: Candle[] = [];
  for (const c of candles) {
    if (seen.has(c.t)) continue;
    seen.add(c.t);
    deduped.push(c);
  }
  deduped.sort((a, b) => a.t - b.t);
  return deduped;
}

async function main() {
  const outDir = path.join(process.cwd(), 'data', 'backtest-yearly', 'candles');
  fs.mkdirSync(outDir, { recursive: true });

  for (const { display, binance } of SYMBOLS) {
    console.log(`\n[fetch-yearly] ${display} (${binance}) ${INTERVAL}`);
    const t0 = Date.now();
    const candles = await fetchYearForSymbol(display, binance);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[fetch-yearly] ${display}: ${candles.length} candles in ${dt}s`);
    if (candles.length === 0) {
      console.error(`[fetch-yearly] ${display}: no candles fetched, skipping`);
      continue;
    }

    const out = {
      symbol: display,
      binance: binance,
      interval: INTERVAL,
      start: candles[0].t,
      end: candles[candles.length - 1].t,
      startISO: new Date(candles[0].t).toISOString(),
      endISO: new Date(candles[candles.length - 1].t).toISOString(),
      count: candles.length,
      fetchedAt: new Date().toISOString(),
      candles,
    };
    // Filename includes the interval so 15m / 1h / 4h coexist.
    const outPath = path.join(outDir, `${display}-${INTERVAL}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out));
    const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`[fetch-yearly] ${display}: wrote ${outPath} (${sizeMb} MB)`);
  }

  console.log('\n[fetch-yearly] done');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
