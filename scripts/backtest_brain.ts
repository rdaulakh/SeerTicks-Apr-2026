/**
 * scripts/backtest_brain.ts — TraderBrain v1 backtest harness
 *
 * Replays historicalCandles through TraderBrain.decide() in a SIMULATED
 * portfolio. Records per-step P&L attribution so we can see which pipeline
 * step (hard_stop / profit_ratchet / consensus_flip / momentum_crash /
 * profit_target_adaptive / stale_no_progress / hold) is responsible for
 * winning or losing the most $ over a given window.
 *
 * Usage:
 *   npx tsx scripts/backtest_brain.ts --symbol BTC-USD --startDate 2026-04-01 --endDate 2026-04-30
 *   npx tsx scripts/backtest_brain.ts --symbol ETH-USD --startDate 2026-04-15 --endDate 2026-04-22 --timeframe 5m
 *
 * Output:
 *   - stdout: summary table (trades, win rate, total PnL, per-step attribution)
 *   - CSV: backtest-brain-<symbol>-<start>-<end>.csv (one row per closed trade)
 *
 * HONEST LIMITATIONS (see report at end of this file for full notes):
 *   - No real flow / whale / deriv / sentiment data is in history. The mock
 *     Sensorium populates technical + market + position + a synthetic stance.
 *     Brain steps that depend on those sensors (consensus_flip,
 *     momentum_crash partial dependency, stale_no_progress drift) will use
 *     synthetic or null inputs.
 *   - Entries are mechanically generated (MA-cross stub) — this is NOT an
 *     entry backtest, it's an EXIT pipeline backtest. The point is to see
 *     which exit rule wins/loses over a representative sample of trades.
 *   - No slippage / fees modeled (gross PnL only).
 *   - Brain singleton is used READ-ONLY via decide(); we never call
 *     start()/tick() and never invoke BrainExecutor.
 */

import 'dotenv/config';
import * as fs from 'fs';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '../server/db';
import { historicalCandles } from '../drizzle/schema';
import { getSensorium, type PositionSensation, type StanceSensation, type MarketSensation, type TechnicalSensation } from '../server/brain/Sensorium';
import { getTraderBrain, type BrainAction } from '../server/brain/TraderBrain';
import { setActiveClock, MockClock } from '../server/_core/clock';

// ─── CLI ──────────────────────────────────────────────────────────────────
interface Args {
  symbol: string;
  startDate: string;
  endDate: string;
  timeframe: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string, def?: string): string => {
    const i = argv.indexOf(`--${k}`);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    if (def !== undefined) return def;
    throw new Error(`Missing required arg: --${k}`);
  };
  return {
    symbol: get('symbol'),
    startDate: get('startDate'),
    endDate: get('endDate'),
    timeframe: get('timeframe', '1m'),
  };
}

// ─── Candle types ─────────────────────────────────────────────────────────
interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SYMBOL_MAP: Record<string, string[]> = {
  'BTC-USD': ['BTC-USD', 'BTCUSDT', 'BTC'],
  'ETH-USD': ['ETH-USD', 'ETHUSDT', 'ETH'],
  'SOL-USD': ['SOL-USD', 'SOLUSDT', 'SOL'],
};

async function loadCandles(symbol: string, startMs: number, endMs: number, interval: string): Promise<Candle[]> {
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');
  const candidates = SYMBOL_MAP[symbol] ?? [symbol];

  for (const sym of candidates) {
    const rows = await db
      .select()
      .from(historicalCandles)
      .where(and(
        eq(historicalCandles.symbol, sym),
        eq(historicalCandles.interval, interval),
        gte(historicalCandles.timestamp, new Date(startMs)),
        lte(historicalCandles.timestamp, new Date(endMs)),
      ))
      .orderBy(asc(historicalCandles.timestamp));
    if (rows.length > 0) {
      return rows.map((r: any) => ({
        ts: new Date(r.timestamp).getTime(),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: parseFloat(r.volume ?? '0'),
      }));
    }
  }
  return [];
}

// ─── Indicator math (windowed; cheap) ─────────────────────────────────────
function sma(arr: number[], n: number): number {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function ema(arr: number[], n: number): number {
  if (arr.length === 0) return 0;
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], n = 14): number {
  if (closes.length < n + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], n = 14): number {
  if (candles.length < n + 1) return 0;
  let sum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return sum / n;
}

function regimeFromAtr(atrAbs: number, price: number): MarketSensation['regime'] {
  const atrPct = price > 0 ? (atrAbs / price) * 100 : 0;
  if (atrPct < 1.5) return 'lowVol';
  if (atrPct < 4) return 'normalVol';
  return 'highVol';
}

// ─── Simulated portfolio ──────────────────────────────────────────────────
interface SimPosition {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  entryTs: number;
  qty: number;
  stopLoss: number | null;
  takeProfit: number | null;
  peakPnlPercent: number;
  ratchetStep: number;
  // entry-time stance snapshot for consensus drift simulation
  entryConsensusDir: 'bullish' | 'bearish';
  entryConsensusStr: number;
}

interface ClosedTrade {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnlPct: number;
  pnlUsd: number;
  exitStep: string;
  exitReason: string;
  holdMinutes: number;
  peakPnlPct: number;
}

// ─── Entry stub: simple EMA-cross to generate sample trades ───────────────
// (NOT trying to be a real entry strategy. Just produces trades the EXIT
// pipeline can chew on.)
function shouldEnter(closes: number[]): 'long' | 'short' | null {
  if (closes.length < 50) return null;
  const fast = ema(closes.slice(-20), 9);
  const slow = ema(closes.slice(-50), 21);
  const prevFast = ema(closes.slice(-21, -1), 9);
  const prevSlow = ema(closes.slice(-51, -1), 21);
  if (prevFast <= prevSlow && fast > slow) return 'long';
  if (prevFast >= prevSlow && fast < slow) return 'short';
  return null;
}

// ─── Mock Sensorium populator ─────────────────────────────────────────────
function pushMarket(symbol: string, candle: Candle, atrAbs: number, prevCloses: number[]) {
  const sens = getSensorium();
  // 5s and 30s momentum: approximate from last 1-min and last 5-min close drift
  // (No sub-minute data available; this is a coarse proxy.)
  const close = candle.close;
  const closeLag5 = prevCloses[prevCloses.length - 6] ?? close;
  const closeLag1 = prevCloses[prevCloses.length - 2] ?? close;
  // bps per second over the lagged window
  const mom5sBpsPerS = ((close - closeLag1) / closeLag1) * 10_000 / 60; // proxy
  const mom30sBpsPerS = ((close - closeLag5) / closeLag5) * 10_000 / 300; // proxy
  const m: MarketSensation = {
    symbol,
    midPrice: close,
    bestBid: close * 0.9999,
    bestAsk: close * 1.0001,
    spreadBps: 2,
    atr14h: atrAbs,
    regime: regimeFromAtr(atrAbs, close),
    momentum_5s_bpsPerS: mom5sBpsPerS,
    momentum_30s_bpsPerS: mom30sBpsPerS,
    lastTickMs: candle.ts,
  };
  sens.updateMarket(m);
}

function pushTechnical(symbol: string, candles: Candle[]) {
  const sens = getSensorium();
  const closes = candles.map(c => c.close);
  const r = rsi(closes, 14);
  const macd = ema(closes, 12) - ema(closes, 26);
  const macdSignal = ema(closes.slice(-9), 9);
  const macdHist = macd - macdSignal;
  const last = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const sd = Math.sqrt(closes.slice(-20).reduce((s, x) => s + (x - ma20) ** 2, 0) / 20);
  const upper = ma20 + 2 * sd;
  const lower = ma20 - 2 * sd;
  const bbPctB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const t: TechnicalSensation = {
    symbol,
    rsi: r,
    macdHist,
    bbPctB: Math.max(0, Math.min(1, bbPctB)),
    emaTrend: ema9 > ema21 * 1.001 ? 'up' : ema9 < ema21 * 0.999 ? 'down' : 'flat',
    superTrend: ema9 > ema21 ? 'bullish' : ema9 < ema21 ? 'bearish' : 'neutral',
    vwapDevPct: 0, // no intraday volume profile
  };
  sens.updateTechnical(t);
}

function pushStance(symbol: string, entryDir: 'bullish' | 'bearish', entryStr: number, currCloses: number[]) {
  // Synthetic stance: derive current consensus direction from short-term EMA slope
  // and strength from |macdHist| scaled. This is a PROXY — real stance comes from
  // 29-agent consensus, which we don't have replayed here.
  const sens = getSensorium();
  const ema9 = ema(currCloses, 9);
  const ema21 = ema(currCloses, 21);
  const slope = ema9 - ema21;
  const currentDir: StanceSensation['currentDirection'] =
    slope > 0 ? 'bullish' : slope < 0 ? 'bearish' : 'neutral';
  // Strength normalized 0..1 from slope as fraction of price
  const last = currCloses[currCloses.length - 1] ?? 1;
  const currentStr = Math.min(1, Math.abs(slope) / last * 100);
  const drift = (currentDir === entryDir ? 1 : -1) * (currentStr - entryStr);
  const stance: StanceSensation = {
    symbol,
    entryDirection: entryDir,
    entryConsensus: entryStr,
    currentDirection: currentDir,
    currentConsensus: currentStr,
    driftFromEntry: drift,
    driftVelocityPerMin: drift, // approximation — single tick velocity
  };
  sens.updateStance(stance);
}

function pushPosition(p: SimPosition, currentPrice: number, nowMs: number) {
  const sens = getSensorium();
  const pnlSign = p.side === 'long' ? 1 : -1;
  const pnlPct = ((currentPrice - p.entryPrice) / p.entryPrice) * 100 * pnlSign;
  p.peakPnlPercent = Math.max(p.peakPnlPercent, pnlPct);
  const ps: PositionSensation = {
    positionId: p.id,
    symbol: p.symbol,
    side: p.side,
    entryPrice: p.entryPrice,
    currentPrice,
    unrealizedPnlPercent: pnlPct,
    peakPnlPercent: p.peakPnlPercent,
    holdMinutes: (nowMs - p.entryTs) / 60_000,
    currentStopLoss: p.stopLoss,
    currentTakeProfit: p.takeProfit,
    ratchetStep: p.ratchetStep,
  };
  sens.updatePosition(ps);
}

// ─── Main backtest loop ───────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs();
  const startMs = new Date(args.startDate).getTime();
  const endMs = new Date(args.endDate).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    console.error('Invalid --startDate / --endDate');
    process.exit(1);
  }

  console.log(`[backtest_brain] symbol=${args.symbol} window=${args.startDate}→${args.endDate} tf=${args.timeframe}`);
  console.log(`[backtest_brain] loading candles…`);
  const candles = await loadCandles(args.symbol, startMs, endMs, args.timeframe);
  console.log(`[backtest_brain] loaded ${candles.length} ${args.timeframe} candles`);
  if (candles.length < 60) {
    console.error('Not enough candles (<60) — aborting.');
    process.exit(1);
  }

  // Swap in MockClock so Sensorium staleness math uses simulated time.
  const clock = new MockClock(candles[0].ts);
  setActiveClock(clock);

  const brain = getTraderBrain();
  const sens = getSensorium();

  const positions: SimPosition[] = [];
  const closed: ClosedTrade[] = [];
  const stepAttribution: Map<string, { trades: number; pnlUsd: number; pnlPct: number }> = new Map();
  const TRADE_USD = 1000; // notional per simulated trade
  let nextPosId = 1;

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.ts > clock.now()) clock.jumpTo(candle.ts);
    const window = candles.slice(0, i + 1);
    const closes = window.map(c => c.close);
    const atrAbs = atr(window.slice(-15), 14);

    // 1. Update market + technical sensations
    pushMarket(args.symbol, candle, atrAbs, closes);
    pushTechnical(args.symbol, window.slice(-50));

    // 2. For each open position: refresh sensation, refresh stance, run brain.decide()
    for (let pIdx = positions.length - 1; pIdx >= 0; pIdx--) {
      const p = positions[pIdx];
      const px = candle.close;
      pushPosition(p, px, candle.ts);
      pushStance(args.symbol, p.entryConsensusDir, p.entryConsensusStr, closes);

      const action: BrainAction | null = brain.decide(p.id);
      if (!action || action.kind === 'hold') continue;

      if (action.kind === 'tighten_stop') {
        p.stopLoss = action.newStopLoss;
        // Find which rung we just hit (record but don't close)
        const a = stepAttribution.get(action.pipelineStep) ?? { trades: 0, pnlUsd: 0, pnlPct: 0 };
        // tighten doesn't realize PnL — we don't bump trades counter, just record activation
        stepAttribution.set(action.pipelineStep, a);
        // Advance the ratchet step counter so applyRatchet sees progress
        // (TraderBrain ratchet checks position.ratchetStep)
        const ladderRungs = [0.30, 0.60, 1.00, 1.50, 2.00, 3.00];
        const nextStep = ladderRungs.findIndex(r => r > (p.peakPnlPercent / 1));
        p.ratchetStep = nextStep === -1 ? ladderRungs.length - 1 : Math.max(p.ratchetStep, nextStep - 1);
        continue;
      }

      // exit_full or take_partial → close (we don't model partial fills granularly)
      const exitQty = action.kind === 'take_partial' ? p.qty * (action.exitQuantityPercent / 100) : p.qty;
      const pnlSign = p.side === 'long' ? 1 : -1;
      const pnlPct = ((px - p.entryPrice) / p.entryPrice) * 100 * pnlSign;
      const pnlUsd = (exitQty * p.entryPrice) * (pnlPct / 100);

      closed.push({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        entryTs: p.entryTs,
        exitTs: candle.ts,
        entryPrice: p.entryPrice,
        exitPrice: px,
        qty: exitQty,
        pnlPct,
        pnlUsd,
        exitStep: action.pipelineStep,
        exitReason: action.reason,
        holdMinutes: (candle.ts - p.entryTs) / 60_000,
        peakPnlPct: p.peakPnlPercent,
      });

      const a = stepAttribution.get(action.pipelineStep) ?? { trades: 0, pnlUsd: 0, pnlPct: 0 };
      a.trades += 1;
      a.pnlUsd += pnlUsd;
      a.pnlPct += pnlPct;
      stepAttribution.set(action.pipelineStep, a);

      if (action.kind === 'exit_full') {
        sens.removePosition(p.id);
        positions.splice(pIdx, 1);
      } else {
        // take_partial: shrink the position but keep it open
        p.qty -= exitQty;
      }
    }

    // 3. Generate a new entry if we have no open position (1 at a time per symbol)
    if (positions.length === 0) {
      const dir = shouldEnter(closes);
      if (dir) {
        const entryPrice = candle.close;
        const stopPct = 1.2; // matches TradingConfig stopLoss
        const stopLoss = dir === 'long'
          ? entryPrice * (1 - stopPct / 100)
          : entryPrice * (1 + stopPct / 100);
        const tp = dir === 'long'
          ? entryPrice * 1.01
          : entryPrice * 0.99;
        const qty = TRADE_USD / entryPrice;
        const p: SimPosition = {
          id: nextPosId++,
          symbol: args.symbol,
          side: dir,
          entryPrice,
          entryTs: candle.ts,
          qty,
          stopLoss,
          takeProfit: tp,
          peakPnlPercent: 0,
          ratchetStep: -1,
          entryConsensusDir: dir === 'long' ? 'bullish' : 'bearish',
          entryConsensusStr: 0.5, // mock entry consensus strength
        };
        positions.push(p);
      }
    }
  }

  // Close any still-open positions at final candle (mark-to-market — attribute to 'forced_close')
  const finalCandle = candles[candles.length - 1];
  for (const p of positions) {
    const px = finalCandle.close;
    const pnlSign = p.side === 'long' ? 1 : -1;
    const pnlPct = ((px - p.entryPrice) / p.entryPrice) * 100 * pnlSign;
    const pnlUsd = (p.qty * p.entryPrice) * (pnlPct / 100);
    closed.push({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      entryTs: p.entryTs,
      exitTs: finalCandle.ts,
      entryPrice: p.entryPrice,
      exitPrice: px,
      qty: p.qty,
      pnlPct,
      pnlUsd,
      exitStep: 'forced_close_eob',
      exitReason: 'Window ended with position open — marked to market',
      holdMinutes: (finalCandle.ts - p.entryTs) / 60_000,
      peakPnlPct: p.peakPnlPercent,
    });
    const a = stepAttribution.get('forced_close_eob') ?? { trades: 0, pnlUsd: 0, pnlPct: 0 };
    a.trades += 1;
    a.pnlUsd += pnlUsd;
    a.pnlPct += pnlPct;
    stepAttribution.set('forced_close_eob', a);
  }

  // ─── Report ─────────────────────────────────────────────────────────
  const totalTrades = closed.length;
  const wins = closed.filter(t => t.pnlUsd > 0).length;
  const totalPnl = closed.reduce((s, t) => s + t.pnlUsd, 0);
  const avgHold = closed.reduce((s, t) => s + t.holdMinutes, 0) / Math.max(1, totalTrades);

  console.log('\n=== Backtest Brain Report ===');
  console.log(`Symbol:       ${args.symbol}`);
  console.log(`Window:       ${args.startDate} → ${args.endDate} (${args.timeframe})`);
  console.log(`Candles:      ${candles.length}`);
  console.log(`Trades:       ${totalTrades}`);
  console.log(`Win rate:     ${totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '0'}%`);
  console.log(`Total PnL:    $${totalPnl.toFixed(2)} (notional $${TRADE_USD}/trade)`);
  console.log(`Avg hold:     ${avgHold.toFixed(1)} min`);

  console.log('\n=== Per-Step P&L Attribution ===');
  const rows = Array.from(stepAttribution.entries())
    .sort((a, b) => b[1].pnlUsd - a[1].pnlUsd);
  console.log('step                          trades   pnl_usd     avg_pnl_pct');
  console.log('────────────────────────────────────────────────────────────────');
  for (const [step, agg] of rows) {
    const avgPct = agg.trades > 0 ? agg.pnlPct / agg.trades : 0;
    console.log(
      `${step.padEnd(28)}  ${String(agg.trades).padStart(5)}   ${agg.pnlUsd.toFixed(2).padStart(10)}   ${avgPct.toFixed(3).padStart(8)}%`,
    );
  }

  // ─── Tuning recommendation ──────────────────────────────────────────
  console.log('\n=== Tuning Recommendation ===');
  if (rows.length === 0) {
    console.log('No trades fired — entry stub did not trigger. Widen window or check candle data.');
  } else {
    const worst = rows[rows.length - 1];
    const best = rows[0];
    if (worst[1].pnlUsd < 0) {
      console.log(`⚠  ${worst[0]} is the BIGGEST LOSER (-$${Math.abs(worst[1].pnlUsd).toFixed(2)} over ${worst[1].trades} trades).`);
      switch (worst[0]) {
        case 'hard_stop':
          console.log('   → stop is too tight; consider widening stopLoss or letting profit_ratchet engage earlier.');
          break;
        case 'consensus_flip':
          console.log('   → consensusFlipThreshold (0.30) may be triggering too eagerly in chop. Try 0.40.');
          break;
        case 'momentum_crash':
          console.log('   → momentumCrashBpsPerS (0.5) may be sensitive to candle-derived proxy noise. Validate with real WS data.');
          break;
        case 'stale_no_progress':
          console.log('   → staleHoldMinutes (30) may be too short — winners need more time. Try 45.');
          break;
        case 'profit_target_adaptive':
          console.log('   → 50% partial is taking off too much; consider 30% or wider giveback threshold.');
          break;
        case 'forced_close_eob':
          console.log('   → positions left open at window end skew results; lengthen window for cleaner stats.');
          break;
        default:
          console.log(`   → review ${worst[0]} thresholds.`);
      }
    }
    if (best[1].pnlUsd > 0) {
      console.log(`✓  ${best[0]} is the biggest winner (+$${best[1].pnlUsd.toFixed(2)} over ${best[1].trades} trades) — leave it alone.`);
    }
  }

  // ─── CSV output ─────────────────────────────────────────────────────
  const csvPath = `backtest-brain-${args.symbol}-${args.startDate}-${args.endDate}.csv`;
  const header = 'id,symbol,side,entryTs,exitTs,entryPrice,exitPrice,qty,pnlPct,pnlUsd,exitStep,holdMinutes,peakPnlPct,exitReason\n';
  const lines = closed.map(t =>
    `${t.id},${t.symbol},${t.side},${new Date(t.entryTs).toISOString()},${new Date(t.exitTs).toISOString()},` +
    `${t.entryPrice},${t.exitPrice},${t.qty.toFixed(6)},${t.pnlPct.toFixed(3)},${t.pnlUsd.toFixed(2)},` +
    `${t.exitStep},${t.holdMinutes.toFixed(1)},${t.peakPnlPct.toFixed(3)},"${t.exitReason.replace(/"/g, '""')}"`,
  );
  fs.writeFileSync(csvPath, header + lines.join('\n') + '\n');
  console.log(`\nCSV: ${csvPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('[backtest_brain] failed:', e);
  process.exit(1);
});
