/**
 * StopHuntAgent — Phase 53.20
 *
 * Detects "stop hunt" patterns: a fast spike through a round-number price
 * level followed immediately by a reversal back through it. This is a
 * well-documented institutional manipulation tactic — sweep liquidity
 * (resting stops) at psychological levels, then reverse with the freed
 * inventory.
 *
 * Pattern signature:
 *   - Price approaches a round number (e.g. $80,000 BTC)
 *   - Spikes through it (within 10bps) on a quick burst (1-3 seconds)
 *   - Within 5-15 seconds, price returns through the level in the opposite
 *     direction
 *   - The REVERSAL direction is the high-conviction signal — it's where
 *     the manipulator wants to take price
 *
 *   Spike up through level then reverse down → bearish (longs caught,
 *     manipulators selling into the squeeze fuel)
 *   Spike down through level then reverse up → bullish (shorts caught,
 *     manipulators buying the capitulation)
 *
 * Data:
 *   global.__binanceFuturesBook[BTCUSDT].midPrice  (perp mid)
 *
 * Algorithm per analyze():
 *   1. Sample current perp mid into ring (last 30s of samples)
 *   2. Find recent local extreme (highest high or lowest low) in last
 *      EXTREME_LOOKBACK_MS
 *   3. Identify round-number levels nearby (within ROUND_PROXIMITY_BPS):
 *        BTC: $1,000 increments
 *        ETH: $50 increments
 *        SOL: $5 increments
 *   4. If extreme price crossed a round level and current price has now
 *      retreated back through it, signal reversal direction
 *
 * Calibration:
 *   EXTREME_LOOKBACK_MS  = 15_000
 *   REVERSAL_LOOKBACK_MS = 30_000  (spike + reversal must complete in 30s)
 *   ROUND_PROXIMITY_BPS  = 5.0     (extreme must pierce round by ≤5bps)
 *   MIN_REVERSAL_BPS     = 5.0     (must retrace at least 5bps past the round)
 *   MIN_SPIKE_BPS        = 8.0     (the spike itself must be at least 8bps)
 *   STALE_MS             = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { engineLogger } from '../utils/logger';

interface PriceSample {
  price: number;
  timestamp: number;
}

interface BookSnapshot { midPrice: number; eventTime: number; }

const EXTREME_LOOKBACK_MS = 15_000;
const REVERSAL_LOOKBACK_MS = 30_000;
const ROUND_PROXIMITY_BPS = 5.0;
const MIN_REVERSAL_BPS = 5.0;
const MIN_SPIKE_BPS = 8.0;
const RING_KEEP_MS = 35_000;
const STALE_MS = 1_500;
const MAX_CONFIDENCE = 0.85;

// Round-number step sizes per symbol (USD). Stops cluster at these levels.
// Phase 92.5 — lowered from BTC $1000 / ETH $50 / SOL $5 to BTC $500 / ETH $25
// / SOL $2. The original steps were too coarse (BTC hits $1000 levels only a
// few times per hour at ~$95K); the agent emitted zero hunts in 6h of live
// data. The smaller steps still represent real psychological levels (half-K
// on BTC, $25 on ETH) where retail stops cluster, and dramatically increase
// the chance of detecting an actual sweep-and-reverse pattern.
const ROUND_STEPS: Record<string, number> = {
  BTCUSDT: 500,
  ETHUSDT: 25,
  SOLUSDT: 2,
};

export class StopHuntAgent extends AgentBase {
  private samples: Map<string, PriceSample[]> = new Map();
  // Track which (symbol, level, direction) triples we've already fired on
  // recently, to avoid double-counting the same hunt event.
  private firedRecently: Map<string, number> = new Map(); // key → timestamp
  private lastFeedWarnAt = 0;

  constructor() {
    const config: AgentConfig = {
      name: 'StopHuntAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[StopHuntAgent] initialized (samples __binanceFuturesBook on each analyze)');
  }

  protected async cleanup(): Promise<void> {
    this.samples.clear();
    this.firedRecently.clear();
  }
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

  private nearestRoundLevel(price: number, step: number): number {
    return Math.round(price / step) * step;
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
          engineLogger.warn('StopHuntAgent has no Binance futures book feed', {
            agent: this.config.name, symbol, binanceSymbol: binSym,
          });
        }
      }
      return this.neutralSignal(symbol, startTime, `No futures book for ${binSym}`);
    }
    const age = getActiveClock().now() - book.eventTime;
    if (age > STALE_MS) return this.neutralSignal(symbol, startTime, `Book stale (${age}ms)`);
    if (!isFinite(book.midPrice) || book.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid mid`);
    }

    const step = ROUND_STEPS[binSym];
    if (!step) return this.neutralSignal(symbol, startTime, `No round-step config for ${binSym}`);

    const now = getActiveClock().now();
    let ring = this.samples.get(symbol);
    if (!ring) { ring = []; this.samples.set(symbol, ring); }
    ring.push({ price: book.midPrice, timestamp: now });
    const cutoff = now - RING_KEEP_MS;
    while (ring.length > 0 && ring[0].timestamp < cutoff) ring.shift();

    if (ring.length < 10) {
      return this.neutralSignal(symbol, startTime, `Building samples (${ring.length}/10)`);
    }

    // Find local extreme in the last REVERSAL_LOOKBACK_MS but earlier than EXTREME_LOOKBACK_MS old
    const reversalCutoff = now - REVERSAL_LOOKBACK_MS;
    const extremeWindowEnd = now - 2_000; // extreme should be at least 2s old (gave time to reverse)
    const candidates = ring.filter(s => s.timestamp >= reversalCutoff && s.timestamp <= extremeWindowEnd);
    if (candidates.length < 5) {
      return this.neutralSignal(symbol, startTime, `Insufficient extreme candidates (${candidates.length})`);
    }

    // Find both high and low extremes in the candidate window
    let highSample = candidates[0], lowSample = candidates[0];
    for (const s of candidates) {
      if (s.price > highSample.price) highSample = s;
      if (s.price < lowSample.price) lowSample = s;
    }

    // Decide which extreme is more recent / more likely to be the spike
    const highAge = now - highSample.timestamp;
    const lowAge = now - lowSample.timestamp;

    // Check upside hunt: high pierced a round level, current price below it
    const upsideHunt = this.checkHunt(
      ring, book.midPrice, step, highSample, 'up',
      reversalCutoff, now,
    );
    if (upsideHunt) {
      const key = `${binSym}:${upsideHunt.level}:up`;
      const lastFire = this.firedRecently.get(key) || 0;
      if (now - lastFire >= 60_000) {
        this.firedRecently.set(key, now);
        return this.makeSignal(symbol, startTime, binSym, 'bearish', upsideHunt, age, ring.length);
      }
    }

    // Check downside hunt: low pierced a round level, current price above it
    const downsideHunt = this.checkHunt(
      ring, book.midPrice, step, lowSample, 'down',
      reversalCutoff, now,
    );
    if (downsideHunt) {
      const key = `${binSym}:${downsideHunt.level}:down`;
      const lastFire = this.firedRecently.get(key) || 0;
      if (now - lastFire >= 60_000) {
        this.firedRecently.set(key, now);
        return this.makeSignal(symbol, startTime, binSym, 'bullish', downsideHunt, age, ring.length);
      }
    }

    return this.neutralSignal(
      symbol,
      startTime,
      `No stop-hunt: ${highAge / 1000}s-old high $${highSample.price.toFixed(2)}, ${lowAge / 1000}s-old low $${lowSample.price.toFixed(2)}, current $${book.midPrice.toFixed(2)}`,
    );
  }

  /**
   * Check whether `extreme` represents a stop-hunt at a nearby round level
   * given direction `dir` ('up' = sweep highs, 'down' = sweep lows).
   * Returns hunt details if true, else null.
   */
  private checkHunt(
    _ring: PriceSample[],
    currentPrice: number,
    step: number,
    extreme: PriceSample,
    dir: 'up' | 'down',
    _reversalCutoff: number,
    now: number,
  ): { level: number; spikeBps: number; reversalBps: number; ageMs: number } | null {
    const round = this.nearestRoundLevel(extreme.price, step);
    const distExtremeToRound = ((extreme.price - round) / round) * 10_000;

    if (dir === 'up') {
      // Spike up: extreme.price > round, by ≤ ROUND_PROXIMITY_BPS
      if (distExtremeToRound <= 0) return null; // didn't pierce upward
      if (distExtremeToRound > ROUND_PROXIMITY_BPS) return null; // pierced too far (not a hunt, real breakout)

      // Reversal: current price now BELOW round by ≥ MIN_REVERSAL_BPS
      const distCurrentToRound = ((currentPrice - round) / round) * 10_000;
      if (distCurrentToRound >= -MIN_REVERSAL_BPS) return null;

      // Spike size: from a recent baseline (~10s before extreme)
      const spikeBps = distExtremeToRound - distCurrentToRound;
      if (spikeBps < MIN_SPIKE_BPS) return null;

      return {
        level: round,
        spikeBps,
        reversalBps: -distCurrentToRound,
        ageMs: now - extreme.timestamp,
      };
    } else {
      // Spike down: extreme.price < round, by ≤ ROUND_PROXIMITY_BPS
      if (distExtremeToRound >= 0) return null;
      if (distExtremeToRound < -ROUND_PROXIMITY_BPS) return null;

      const distCurrentToRound = ((currentPrice - round) / round) * 10_000;
      if (distCurrentToRound <= MIN_REVERSAL_BPS) return null;

      const spikeBps = distCurrentToRound - distExtremeToRound;
      if (spikeBps < MIN_SPIKE_BPS) return null;

      return {
        level: round,
        spikeBps,
        reversalBps: distCurrentToRound,
        ageMs: now - extreme.timestamp,
      };
    }
  }

  private makeSignal(
    symbol: string, startTime: number, binSym: string,
    signal: 'bullish' | 'bearish',
    hunt: { level: number; spikeBps: number; reversalBps: number; ageMs: number },
    bookAgeMs: number, ringSize: number,
  ): AgentSignal {
    // Confidence: base 0.50
    //   + up to 0.20 from spike size
    //   + up to 0.15 from reversal magnitude past round
    //   + recency bonus — fresh hunts (<5s) rate higher
    const spikeFactor = Math.min((hunt.spikeBps - MIN_SPIKE_BPS) / 12, 1);
    const reversalFactor = Math.min((hunt.reversalBps - MIN_REVERSAL_BPS) / 10, 1);
    const recencyBonus = Math.max(0, 1 - hunt.ageMs / 15_000);
    const confidence = Math.min(
      0.50 + spikeFactor * 0.20 + reversalFactor * 0.15 + recencyBonus * 0.05,
      MAX_CONFIDENCE,
    );

    const direction = signal === 'bearish' ? 'upside' : 'downside';
    const action = signal === 'bearish' ? 'longs squeezed' : 'shorts squeezed';
    const reasoning =
      `Stop hunt on ${binSym} at $${hunt.level}: ${direction} sweep then reversal ` +
      `(spike ${hunt.spikeBps.toFixed(1)}bps, reversal ${hunt.reversalBps.toFixed(1)}bps past level, ${(hunt.ageMs / 1000).toFixed(1)}s ago) — ` +
      `${action} → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(spikeFactor + reversalFactor * 0.5, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        roundLevel: hunt.level,
        spikeBps: hunt.spikeBps,
        reversalBps: hunt.reversalBps,
        huntAgeMs: hunt.ageMs,
        spikeFactor,
        reversalFactor,
        recencyBonus,
        ringSize,
        source: 'binance-perp-mid-stophunt',
      },
      qualityScore: 0.78,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: bookAgeMs,
      executionScore: Math.round(50 + spikeFactor * 25 + recencyBonus * 15),
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
      evidence: { ringSize: this.samples.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
