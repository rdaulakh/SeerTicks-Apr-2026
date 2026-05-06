/**
 * CrossExchangeSpreadAgent — Phase 53.12
 *
 * Watches the static price gap between Binance spot and Coinbase. Different
 * from LeadLagAgent (which measures TIMING of moves): this measures the
 * persistent spread itself.
 *
 *   spread_bps = (binance_mid - coinbase_mid) / coinbase_mid * 10000
 *
 * Mechanism:
 *   - Liquid majors (BTC/ETH/SOL) typically trade within ±2bps cross-venue.
 *     Larger gaps trigger arb desks to close them within seconds.
 *   - When binance trades RICHER (positive bps): coinbase will move up.
 *   - When binance trades CHEAPER (negative bps): coinbase will move down.
 *   - Direction signal points at the LAGGING exchange's expected move,
 *     which (since SEER trades on coinbase via real engine) is the trading
 *     direction we want.
 *
 *   Note: SEER currently uses Binance as primary on Tokyo testnet. Either
 *   way, the spread direction is informationally correct — large gaps signal
 *   imminent reversion, and the direction tells which way the slow side moves.
 *
 * Data:
 *   global.__binanceSpotBook[BTCUSDT] = { midPrice, ... }
 *   global.__coinbaseTopOfBook[BTC-USD] = { midPrice, ... }
 *
 * Algorithm:
 *   1. Sample current spread_bps each analyze tick
 *   2. Maintain ring of last 60 samples (~30-60s at 1Hz)
 *   3. Robust baseline = median of ring
 *   4. Delta = current - median
 *   5. If |delta| > THRESHOLD AND |current_spread| > MIN_ABS_BPS → signal
 *   6. Direction: positive spread (binance > coinbase) → bullish
 *      (coinbase will catch up by rising)
 *      negative spread → bearish (coinbase catches down)
 *
 * Calibration:
 *   THRESHOLD     = 2.0 bps (delta from baseline)
 *   MIN_ABS_BPS   = 1.5 bps (don't trade noise around zero)
 *   STALE_MS      = 2000
 *   RING_SIZE     = 60
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";

interface BookSnapshot {
  midPrice: number;
  receivedAt?: number;
  eventTime?: number;
  tradeTime?: number;
}

const THRESHOLD = 2.0;
const MIN_ABS_BPS = 1.5;
const SATURATE_BPS = 8.0;
const STALE_MS = 2_000;
const RING_SIZE = 60;

export class CrossExchangeSpreadAgent extends AgentBase {
  private spreadRings: Map<string, number[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'CrossExchangeSpreadAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[CrossExchangeSpreadAgent] initialized (reads __binanceSpotBook + __coinbaseTopOfBook)');
  }

  protected async cleanup(): Promise<void> {
    this.spreadRings.clear();
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze().
  }

  /** "BTC-USD" → "BTCUSDT" for the binance side. */
  private toBinanceSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
      const [base, quote] = upper.split('-');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    if (upper.includes('/')) {
      const [base, quote] = upper.split('/');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    return upper;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = Date.now();
    const binSym = this.toBinanceSymbol(symbol);

    const bin = ((global as any).__binanceSpotBook || {})[binSym] as BookSnapshot | undefined;
    const cb = ((global as any).__coinbaseTopOfBook || {})[symbol] as BookSnapshot | undefined;

    if (!bin || !cb) {
      return this.neutralSignal(symbol, startTime, `Missing book (binance=${!!bin}, coinbase=${!!cb})`);
    }

    const now = Date.now();
    const binAge = now - (bin.eventTime || (bin as any).receivedAt || 0);
    const cbAge = now - (cb.receivedAt || 0);
    if (binAge > STALE_MS || cbAge > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Stale book(s): binance=${binAge}ms coinbase=${cbAge}ms`);
    }
    if (!isFinite(bin.midPrice) || !isFinite(cb.midPrice) || cb.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid mid prices`);
    }

    const spreadBps = (bin.midPrice - cb.midPrice) / cb.midPrice * 10_000;

    // Update ring
    let ring = this.spreadRings.get(symbol);
    if (!ring) {
      ring = [];
      this.spreadRings.set(symbol, ring);
    }
    ring.push(spreadBps);
    if (ring.length > RING_SIZE) ring.shift();

    if (ring.length < 10) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Building baseline (${ring.length}/10), current spread ${spreadBps.toFixed(2)}bps`,
      );
    }

    const sorted = [...ring].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const delta = spreadBps - median;

    if (Math.abs(delta) < THRESHOLD || Math.abs(spreadBps) < MIN_ABS_BPS) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Spread tight: now ${spreadBps.toFixed(2)}bps, median ${median.toFixed(2)}bps, delta ${delta.toFixed(2)}bps (need delta ≥${THRESHOLD}, |spread|≥${MIN_ABS_BPS})`,
      );
    }

    // Direction: lagging exchange (coinbase here) will move toward parity.
    // If binance is RICHER (spreadBps > 0), coinbase mid is lower → expected
    // to rise → bullish. Inverse for negative spread.
    const signal = spreadBps > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.40, +up to 0.30 from |spread| magnitude (saturating),
    // +up to 0.15 from the delta-from-baseline magnitude.
    const magFactor = Math.min(Math.abs(spreadBps) / SATURATE_BPS, 1);
    const deltaFactor = Math.min((Math.abs(delta) - THRESHOLD) / THRESHOLD, 1);
    const confidence = Math.min(0.40 + magFactor * 0.30 + deltaFactor * 0.15, 0.85);

    const reasoning =
      `Cross-exchange spread on ${symbol}: binance ${bin.midPrice.toFixed(2)} vs coinbase ${cb.midPrice.toFixed(2)} ` +
      `= ${spreadBps >= 0 ? '+' : ''}${spreadBps.toFixed(2)}bps (median ${median.toFixed(2)}bps, delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}bps) ` +
      `→ coinbase expected to ${signal === 'bullish' ? 'rise' : 'fall'} toward parity`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(spreadBps) / SATURATE_BPS, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        binanceMid: bin.midPrice,
        coinbaseMid: cb.midPrice,
        spreadBps,
        baselineMedianBps: median,
        deltaBps: delta,
        ringSize: ring.length,
        binanceAgeMs: binAge,
        coinbaseAgeMs: cbAge,
        magnitudeFactor: magFactor,
        deltaFactor,
        source: 'binance-spot-bookTicker + coinbase-ticker',
      },
      qualityScore: 0.74,
      processingTime: Date.now() - startTime,
      dataFreshness: Math.max(binAge, cbAge),
      executionScore: Math.round(45 + magFactor * 25 + deltaFactor * 15),
    };
  }

  private neutralSignal(symbol: string, startTime: number, reason: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal: 'neutral',
      confidence: 0.5,
      strength: 0,
      reasoning: reason,
      evidence: { ringSize: this.spreadRings.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: Date.now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
