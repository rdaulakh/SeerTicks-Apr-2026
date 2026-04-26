/**
 * Phase 37 Step 2 — Fetch 1 year of Binance perp funding rates (free public).
 *
 * Funding rate = the periodic payment longs make to shorts (or vice versa)
 * on perpetual futures, charged every 8 hours. Sign and magnitude indicate
 * leveraged-long crowding (positive funding = longs paying = overcrowded
 * long → mean-reversion-down bias, and vice versa).
 *
 * Documented predictive at the 4-8h horizon for reversion. This is the
 * single highest-leverage public-data alpha source for crypto and our
 * 4-agent stub is missing it entirely.
 *
 * Endpoint: GET /fapi/v1/fundingRate?symbol=BTCUSDT&startTime=...&endTime=...&limit=1000
 *   Returns: [{ symbol, fundingRate, fundingTime }, ...]
 *   Funding events fire every 8h → ~1095 events per symbol per year
 *   → 2 requests per symbol → 6 total. Trivially fast.
 *
 * Output: data/backtest-yearly/funding/{symbol}.json
 *   { symbol, count, events: [{ t, rate }, ...] }
 *
 * The replay harness binary-searches into this array on each candle to
 * find the latest funding rate at that point in time.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

interface FundingEvent { t: number; rate: number; }

const SYMBOLS: Array<{ display: string; binance: string }> = [
  { display: 'BTC-USD', binance: 'BTCUSDT' },
  { display: 'ETH-USD', binance: 'ETHUSDT' },
  { display: 'SOL-USD', binance: 'SOLUSDT' },
];
const NOW = Date.now();
const ONE_YEAR_MS = 365 * 24 * 60 * 60_000;
const START_MS = NOW - ONE_YEAR_MS;
const REQUEST_LIMIT = 1000;

async function fetchFundingPage(binance: string, startMs: number, endMs: number): Promise<FundingEvent[]> {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${binance}&startTime=${startMs}&endTime=${endMs}&limit=${REQUEST_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance fapi ${res.status}: ${await res.text()}`);
  const arr = (await res.json()) as Array<{ symbol: string; fundingRate: string; fundingTime: number }>;
  return arr.map((r) => ({ t: r.fundingTime, rate: parseFloat(r.fundingRate) }));
}

async function fetchYearForSymbol(display: string, binance: string): Promise<FundingEvent[]> {
  const events: FundingEvent[] = [];
  let cursor = START_MS;
  let page = 0;
  while (cursor < NOW) {
    process.stdout.write(`  ${display} page ${++page} ${new Date(cursor).toISOString().slice(0, 10)}…`);
    const batch = await fetchFundingPage(binance, cursor, NOW);
    if (batch.length === 0) break;
    events.push(...batch);
    process.stdout.write(` got ${batch.length}, total ${events.length}\n`);
    cursor = batch[batch.length - 1].t + 1;
    await new Promise((r) => setTimeout(r, 200));
    if (batch.length < REQUEST_LIMIT) break;
  }
  // Dedupe by `t`
  const seen = new Set<number>();
  const uniq: FundingEvent[] = [];
  for (const e of events) {
    if (seen.has(e.t)) continue;
    seen.add(e.t);
    uniq.push(e);
  }
  uniq.sort((a, b) => a.t - b.t);
  return uniq;
}

async function main() {
  const outDir = path.join(process.cwd(), 'data', 'backtest-yearly', 'funding');
  fs.mkdirSync(outDir, { recursive: true });

  for (const { display, binance } of SYMBOLS) {
    console.log(`\n[funding] ${display} (${binance})`);
    const events = await fetchYearForSymbol(display, binance);
    if (events.length === 0) {
      console.error(`[funding] ${display}: no events`);
      continue;
    }
    const out = {
      symbol: display,
      binance,
      start: events[0].t,
      end: events[events.length - 1].t,
      startISO: new Date(events[0].t).toISOString(),
      endISO: new Date(events[events.length - 1].t).toISOString(),
      count: events.length,
      fetchedAt: new Date().toISOString(),
      events,
    };
    const outPath = path.join(outDir, `${display}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out));
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`[funding] ${display}: ${events.length} events, ${outPath} (${sizeKb} KB)`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
