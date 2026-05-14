/**
 * SpreadCompressionAgent — Phase 53.16
 *
 * Watches the bid-ask spread on Binance perp top-of-book. Sustained spread
 * compression (spread tightening below baseline) is a leading indicator of
 * pending volatility:
 *
 *   - Market makers tighten quotes when they're confident in their inventory
 *     and want to compete for fills → typically signals pending move
 *   - Spread expansion (widening) signals MM uncertainty / risk-off → often
 *     follows or precedes large moves
 *
 * The agent's directional output uses concurrent depth imbalance to pick
 * direction — a tight spread alone is direction-neutral (signals SOMETHING
 * is about to happen, not what). When tight spread coincides with bid-heavy
 * book, expect upward break; ask-heavy → downward.
 *
 * Data:
 *   global.__binanceFuturesBook[BTCUSDT] = { bidPrice, askPrice, midPrice, ... }
 *   global.__binancePerpDepth5[BTCUSDT] = { bids, asks, ... }    (for direction)
 *
 * Algorithm per analyze():
 *   1. Compute current spread_bps = (ask - bid) / mid * 10_000
 *   2. Maintain ring of 60 samples (~30-60s baseline)
 *   3. Compare current spread to ring median; need significant compression
 *      (current ≤ median × COMPRESSION_FACTOR)
 *   4. Use depth5 imbalance to pick direction
 *   5. Confidence scales with compression amount × directional cleanliness
 *
 * Calibration:
 *   COMPRESSION_FACTOR = 0.60   (current ≤ 60% of baseline median)
 *   MIN_BASELINE_BPS   = 0.30   (don't fire when book is already razor-thin)
 *   STALE_MS           = 1500
 *   RING_SIZE          = 60
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { engineLogger } from '../utils/logger';

interface BookSnapshot {
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  bidQty: number;
  askQty: number;
  eventTime: number;
  tradeTime: number;
}

interface DepthLevel { price: number; qty: number; }
interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  receivedAt: number;
}

// Phase 92.5 — loosened from 0.60 to 0.75. The 0.60 gate required current
// spread to be ≤60% of median — a once-per-minute event at best on liquid
// majors. 0.75 catches sustained mild tightening that still indicates MM
// confidence + pending move, and lets the agent emit directional signals
// instead of silent neutral-loop.
const COMPRESSION_FACTOR = 0.75;
// Phase 82.3 — lowered from 0.30 to 0.10 bps. Live: 0/0/632 (100% neutral).
// Binance BTC perp typically trades 0.1-0.2 bps spread; the 0.30 floor
// permanently muted the agent on the most liquid pairs (which is what it
// was supposed to monitor). 0.10 lets it fire on compression in the real
// BTC/ETH/SOL perp regime.
const MIN_BASELINE_BPS = 0.10;
const STALE_MS = 1_500;
const RING_SIZE = 60;
const MAX_CONFIDENCE = 0.78; // Compression alone is direction-light, capped lower

export class SpreadCompressionAgent extends AgentBase {
  private spreadRings: Map<string, number[]> = new Map();
  private lastFeedWarnAt = 0;

  constructor() {
    const config: AgentConfig = {
      name: 'SpreadCompressionAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[SpreadCompressionAgent] initialized (reads __binanceFuturesBook + __binancePerpDepth5)');
  }

  protected async cleanup(): Promise<void> { this.spreadRings.clear(); }
  protected async periodicUpdate(): Promise<void> { /* no periodic */ }

  private toBinanceSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
      const [b, q] = upper.split('-');
      return `${b}${q === 'USD' ? 'USDT' : q}`;
    }
    if (upper.includes('/')) {
      const [b, q] = upper.split('/');
      return `${b}${q === 'USD' ? 'USDT' : q}`;
    }
    return upper;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const futuresBookGlobal = (global as any).__binanceFuturesBook as Record<string, BookSnapshot> | undefined;
    const book = (futuresBookGlobal || {})[binSym];
    if (!book) {
      if (!futuresBookGlobal || Object.keys(futuresBookGlobal).length === 0) {
        const nowMs = getActiveClock().now();
        if (nowMs - this.lastFeedWarnAt > 60_000) {
          this.lastFeedWarnAt = nowMs;
          engineLogger.warn('SpreadCompressionAgent has no Binance futures book feed', {
            agent: this.config.name, symbol, binanceSymbol: binSym,
          });
        }
      }
      return this.neutralSignal(symbol, startTime, `No futures book for ${binSym}`);
    }

    const age = getActiveClock().now() - book.eventTime;
    if (age > STALE_MS) return this.neutralSignal(symbol, startTime, `Book stale (${age}ms)`);
    if (!isFinite(book.bidPrice) || !isFinite(book.askPrice) || book.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid book prices`);
    }

    const spreadBps = (book.askPrice - book.bidPrice) / book.midPrice * 10_000;
    if (spreadBps < 0) return this.neutralSignal(symbol, startTime, `Negative spread (crossed book)`);

    let ring = this.spreadRings.get(symbol);
    if (!ring) {
      ring = [];
      this.spreadRings.set(symbol, ring);
    }
    ring.push(spreadBps);
    if (ring.length > RING_SIZE) ring.shift();

    if (ring.length < 15) {
      return this.neutralSignal(symbol, startTime, `Building baseline (${ring.length}/15) — current ${spreadBps.toFixed(2)}bps`);
    }

    const sorted = [...ring].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median < MIN_BASELINE_BPS) {
      return this.neutralSignal(symbol, startTime, `Baseline already tight (median ${median.toFixed(2)}bps < ${MIN_BASELINE_BPS}bps) — no compression signal`);
    }

    const compressionRatio = spreadBps / median;
    if (compressionRatio > COMPRESSION_FACTOR) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Spread normal: ${spreadBps.toFixed(2)}bps vs median ${median.toFixed(2)}bps (${(compressionRatio * 100).toFixed(0)}% — need ≤${(COMPRESSION_FACTOR * 100).toFixed(0)}%)`,
      );
    }

    // Compression detected — use depth5 imbalance to pick direction
    const depth = ((global as any).__binancePerpDepth5 || {})[binSym] as DepthSnapshot | undefined;
    if (!depth || !depth.bids || !depth.asks || depth.bids.length === 0 || depth.asks.length === 0) {
      return this.neutralSignal(symbol, startTime, `Compression detected (${(compressionRatio * 100).toFixed(0)}%) but no depth5 to pick direction`);
    }

    const bidQtySum = depth.bids.reduce((s, l) => s + l.qty, 0);
    const askQtySum = depth.asks.reduce((s, l) => s + l.qty, 0);
    const totalQty = bidQtySum + askQtySum;
    if (totalQty <= 0) {
      return this.neutralSignal(symbol, startTime, `Compression but zero depth — neutral`);
    }
    const depthImbalance = (bidQtySum - askQtySum) / totalQty;

    // Need at least 10% directional bias in depth to commit to direction
    if (Math.abs(depthImbalance) < 0.10) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Compression detected (${(compressionRatio * 100).toFixed(0)}%) but depth flat (${(depthImbalance * 100).toFixed(1)}%) — direction unclear`,
      );
    }

    const signal: 'bullish' | 'bearish' = depthImbalance > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.40
    //   + up to 0.20 from compression depth (1 - ratio scaled)
    //   + up to 0.18 from depth imbalance magnitude (saturating at 0.40)
    const compressionFactor = Math.min((COMPRESSION_FACTOR - compressionRatio) / COMPRESSION_FACTOR, 1);
    const directionFactor = Math.min(Math.abs(depthImbalance) / 0.40, 1);
    const confidence = Math.min(0.40 + compressionFactor * 0.20 + directionFactor * 0.18, MAX_CONFIDENCE);

    const reasoning =
      `Spread compression on ${binSym}: ${spreadBps.toFixed(2)}bps vs median ${median.toFixed(2)}bps ` +
      `(${(compressionRatio * 100).toFixed(0)}% — ${(compressionFactor * 100).toFixed(0)}% tightening), ` +
      `depth5 ${(depthImbalance * 100).toFixed(1)}% ${signal === 'bullish' ? 'bid-heavy' : 'ask-heavy'} → ${signal} break expected`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(compressionFactor + directionFactor * 0.5, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        currentSpreadBps: spreadBps,
        baselineMedianBps: median,
        compressionRatio,
        depthImbalance,
        bidQtySum,
        askQtySum,
        ringSize: ring.length,
        bookAgeMs: age,
        compressionFactor,
        directionFactor,
        source: 'binance-perp-bookTicker + depth5',
      },
      qualityScore: 0.72,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: age,
      executionScore: Math.round(45 + compressionFactor * 25 + directionFactor * 15),
    };
  }

  private neutralSignal(symbol: string, startTime: number, reason: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal: 'neutral',
      confidence: 0.5,
      strength: 0,
      reasoning: reason,
      evidence: { ringSize: this.spreadRings.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
