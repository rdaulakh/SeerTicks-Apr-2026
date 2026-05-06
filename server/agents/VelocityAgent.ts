/**
 * VelocityAgent — Phase 53.18
 *
 * Multi-timeframe price acceleration detector. Computes price-change rate
 * over short (3s) and long (15s) windows; when the short-window rate is
 * substantially faster than the long-window rate AND in the same direction,
 * price is ACCELERATING — typical breakout signature.
 *
 *   - 3s rate strongly positive vs 15s rate slightly positive → bullish
 *     acceleration (breakout up)
 *   - 3s rate strongly negative vs 15s rate slightly negative → bearish
 *     acceleration (breakout down)
 *   - Opposite signs → recent reversal in progress, neutral (let other
 *     agents pick direction; reversals are less predictable than breakouts)
 *
 * Data: maintains its own per-symbol ring of (price, timestamp) samples
 * pulled from __binanceFuturesBook on each analyze call. Why perp not spot:
 * perp has higher resolution at the tick level due to leverage activity.
 *
 * Algorithm per analyze():
 *   1. Sample current perp mid into ring (keep last 60s of samples)
 *   2. Compute short-window rate: (mid_now - mid_3s_ago) / mid_now over 3s
 *   3. Compute long-window rate: same over 15s
 *   4. Need short and long same sign AND |short_rate| ≥ ACCEL_RATIO × |long_rate|
 *      AND |short_rate| ≥ MIN_SHORT_BPS_PER_S
 *   5. Confidence scales with accel ratio (saturating) and short-rate magnitude
 *
 * Calibration:
 *   SHORT_MS         = 3_000
 *   LONG_MS          = 15_000
 *   ACCEL_RATIO      = 2.0   (short rate must be ≥2x long rate)
 *   MIN_SHORT_BPS_PER_S = 0.5  (short rate must be at least 0.5bps/s in absolute)
 *   ACCEL_SAT        = 5.0   (5x ratio saturates confidence)
 *   STALE_MS         = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";

interface PriceSample {
  price: number;
  timestamp: number;
}

interface BookSnapshot {
  midPrice: number;
  eventTime: number;
}

const SHORT_MS = 3_000;
const LONG_MS = 15_000;
const ACCEL_RATIO = 2.0;
const MIN_SHORT_BPS_PER_S = 0.5;
const ACCEL_SAT = 5.0;
const STALE_MS = 1_500;
const RING_KEEP_MS = 30_000; // keep ~30s of samples (more than LONG_MS for safety)
const MAX_CONFIDENCE = 0.82;

export class VelocityAgent extends AgentBase {
  private samples: Map<string, PriceSample[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'VelocityAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[VelocityAgent] initialized (samples __binanceFuturesBook on each analyze)');
  }

  protected async cleanup(): Promise<void> { this.samples.clear(); }
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

  /** Find the sample with timestamp closest to (now - lookbackMs). */
  private sampleAt(ring: PriceSample[], targetTs: number): PriceSample | null {
    if (ring.length === 0) return null;
    let best: PriceSample = ring[0];
    let bestDiff = Math.abs(ring[0].timestamp - targetTs);
    for (const s of ring) {
      const diff = Math.abs(s.timestamp - targetTs);
      if (diff < bestDiff) { best = s; bestDiff = diff; }
    }
    return best;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = Date.now();
    const binSym = this.toBinanceSymbol(symbol);

    const book = ((global as any).__binanceFuturesBook || {})[binSym] as BookSnapshot | undefined;
    if (!book) return this.neutralSignal(symbol, startTime, `No futures book for ${binSym}`);

    const now = Date.now();
    const bookAge = now - book.eventTime;
    if (bookAge > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Book stale (${bookAge}ms)`);
    }
    if (!isFinite(book.midPrice) || book.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid mid price`);
    }

    let ring = this.samples.get(symbol);
    if (!ring) { ring = []; this.samples.set(symbol, ring); }
    ring.push({ price: book.midPrice, timestamp: now });
    // Trim by age
    const cutoff = now - RING_KEEP_MS;
    while (ring.length > 0 && ring[0].timestamp < cutoff) ring.shift();

    if (ring.length < 5) {
      return this.neutralSignal(symbol, startTime, `Building samples (${ring.length}/5)`);
    }

    const shortRef = this.sampleAt(ring, now - SHORT_MS);
    const longRef = this.sampleAt(ring, now - LONG_MS);
    if (!shortRef || !longRef) {
      return this.neutralSignal(symbol, startTime, `Cannot find reference samples`);
    }

    // If our ring doesn't yet span LONG_MS, the longRef is the oldest sample.
    // Reject signal until we have a true long-window reference.
    const longSpanMs = now - longRef.timestamp;
    if (longSpanMs < LONG_MS * 0.7) {
      return this.neutralSignal(symbol, startTime, `Long window not yet filled (have ${longSpanMs}ms, need ≥${LONG_MS * 0.7}ms)`);
    }

    const shortSpanMs = now - shortRef.timestamp;
    if (shortSpanMs <= 0 || shortRef.price <= 0 || longRef.price <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid reference samples`);
    }

    // bps per second over each window
    const shortBpsPerS = ((book.midPrice - shortRef.price) / shortRef.price) * 10_000 / (shortSpanMs / 1000);
    const longBpsPerS = ((book.midPrice - longRef.price) / longRef.price) * 10_000 / (longSpanMs / 1000);

    // Need same sign and meaningful short-window magnitude
    if (Math.abs(shortBpsPerS) < MIN_SHORT_BPS_PER_S) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Short rate too small: ${shortBpsPerS.toFixed(2)}bps/s (need ≥${MIN_SHORT_BPS_PER_S}bps/s)`,
      );
    }
    if (Math.sign(shortBpsPerS) !== Math.sign(longBpsPerS) || longBpsPerS === 0) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Sign mismatch: short ${shortBpsPerS.toFixed(2)}bps/s vs long ${longBpsPerS.toFixed(2)}bps/s — recent reversal, not acceleration`,
      );
    }

    const accelRatio = Math.abs(shortBpsPerS) / Math.abs(longBpsPerS);
    if (accelRatio < ACCEL_RATIO) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No acceleration: short/long ratio ${accelRatio.toFixed(2)} < ${ACCEL_RATIO} (short ${shortBpsPerS.toFixed(2)}bps/s, long ${longBpsPerS.toFixed(2)}bps/s)`,
      );
    }

    const signal: 'bullish' | 'bearish' = shortBpsPerS > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.45
    //   + up to 0.20 from accel ratio (saturating at ACCEL_SAT)
    //   + up to 0.17 from short-rate magnitude (saturating at 5 bps/s)
    const accelFactor = Math.min((accelRatio - ACCEL_RATIO) / (ACCEL_SAT - ACCEL_RATIO), 1);
    const magFactor = Math.min(Math.abs(shortBpsPerS) / 5.0, 1);
    const confidence = Math.min(0.45 + accelFactor * 0.20 + magFactor * 0.17, MAX_CONFIDENCE);

    const reasoning =
      `Price acceleration on ${binSym}: short ${shortBpsPerS.toFixed(2)}bps/s (${SHORT_MS / 1000}s) ` +
      `vs long ${longBpsPerS.toFixed(2)}bps/s (${(longSpanMs / 1000).toFixed(1)}s) ` +
      `= ${accelRatio.toFixed(2)}× acceleration → ${signal} breakout`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: Math.min(accelFactor + magFactor * 0.5, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        nowPrice: book.midPrice,
        shortRefPrice: shortRef.price,
        longRefPrice: longRef.price,
        shortSpanMs,
        longSpanMs,
        shortBpsPerS,
        longBpsPerS,
        accelRatio,
        ringSize: ring.length,
        accelFactor,
        magFactor,
        source: 'binance-perp-mid-velocity',
      },
      qualityScore: 0.74,
      processingTime: Date.now() - startTime,
      dataFreshness: bookAge,
      executionScore: Math.round(50 + accelFactor * 25 + magFactor * 15),
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
      evidence: { ringSize: this.samples.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: Date.now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
