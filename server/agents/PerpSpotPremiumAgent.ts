/**
 * PerpSpotPremiumAgent — Phase 53.4
 *
 * Exploits the well-documented lead of USDT-M perpetual futures over spot
 * during directional moves. Mechanism:
 *   - Leverage on perps is up to 125x; speculators express directional
 *     conviction on perps first (cheaper, no settlement, instant)
 *   - When demand surges, perp ask gets eaten before spot ask → perp mid
 *     ticks above spot mid (positive premium in bps)
 *   - Spot follows in 1–3 seconds via arbitrage / cash-and-carry desks
 *   - Symmetric on the way down (perp discount → bearish lead)
 *
 * Data sources (both populated by the Phase 52 / 53.4 boot wiring):
 *   - global.__binanceFuturesBook[BTCUSDT]   (perp top-of-book)
 *   - global.__binanceSpotBook[BTCUSDT]      (spot top-of-book)
 *
 * Algorithm:
 *   1. Compute current premium = (perpMid - spotMid) / spotMid * 10_000  bps
 *   2. Maintain a 60-sample ring of recent premiums (one sample per analyze
 *      tick — the analyzer cadence is 1–2 Hz, so the ring covers ~30–60s)
 *   3. Compare current premium vs the median of the ring:
 *        - delta > +ENTRY_BPS  → bullish (perp leading up)
 *        - delta < -ENTRY_BPS  → bearish (perp leading down)
 *        - else                → neutral
 *   4. Confidence scales with magnitude (capped) AND premium-direction
 *      consistency (% of last N samples on the same side of the median)
 *
 * Calibration starting points (low because BTC/ETH/SOL premiums are usually
 * tight — typical spread between perp and spot mid is < 5 bps):
 *   ENTRY_BPS_THRESHOLD = 1.5  (delta from baseline)
 *   PREMIUM_CAP_BPS     = 8.0  (where confidence saturates)
 *   STALE_MS            = 3000 (drop the agent if either book is older)
 *
 * No async I/O — reads two in-memory globals. Effectively zero latency.
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";

interface BookSnapshot {
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  bidQty: number;
  askQty: number;
  tradeTime: number;
  eventTime: number;
}

const RING_SIZE = 60;
const ENTRY_BPS_THRESHOLD = 1.5;   // bps delta from baseline median to fire
const PREMIUM_CAP_BPS = 8.0;       // saturate confidence above this
const STALE_MS = 3_000;            // either book older than this → neutral

export class PerpSpotPremiumAgent extends AgentBase {
  // Per-symbol ring of recent premium samples (bps). Symbol key matches the
  // canonical "BTC-USD" form the analyzer hands us via analyze().
  private premiumRings: Map<string, number[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'PerpSpotPremiumAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    // No subscriptions — agent reads in-memory globals on each analyze().
    console.log('[PerpSpotPremiumAgent] initialized (reads __binanceFuturesBook + __binanceSpotBook)');
  }

  protected async cleanup(): Promise<void> {
    this.premiumRings.clear();
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze().
  }

  /**
   * SEER canonical symbol "BTC-USD" → Binance native "BTCUSDT".
   * Also handles "BTC/USD" defensively. USD → USDT bridging.
   */
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

    const futuresBook = (global as any).__binanceFuturesBook as Record<string, BookSnapshot> | undefined;
    const spotBook = (global as any).__binanceSpotBook as Record<string, BookSnapshot> | undefined;

    const perp = futuresBook?.[binSym];
    const spot = spotBook?.[binSym];

    if (!perp || !spot) {
      return this.neutralSignal(symbol, startTime, `Missing books (perp=${!!perp}, spot=${!!spot}) for ${binSym}`);
    }

    const now = Date.now();
    const perpAge = now - perp.eventTime;
    const spotAge = now - spot.eventTime;
    if (perpAge > STALE_MS || spotAge > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Books stale (perp=${perpAge}ms, spot=${spotAge}ms)`);
    }
    if (!isFinite(perp.midPrice) || !isFinite(spot.midPrice) || spot.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid book prices for ${binSym}`);
    }

    // Premium in bps. Positive = perp trades above spot.
    const premiumBps = (perp.midPrice - spot.midPrice) / spot.midPrice * 10_000;

    // Update ring
    let ring = this.premiumRings.get(symbol);
    if (!ring) {
      ring = [];
      this.premiumRings.set(symbol, ring);
    }
    ring.push(premiumBps);
    if (ring.length > RING_SIZE) ring.shift();

    // Need at least 10 samples for a meaningful baseline
    if (ring.length < 10) {
      return this.neutralSignal(symbol, startTime, `Building baseline (have ${ring.length} samples, need 10) — current premium ${premiumBps.toFixed(2)}bps`);
    }

    // Baseline = median of ring (robust to outliers)
    const sorted = [...ring].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const delta = premiumBps - median;

    if (Math.abs(delta) < ENTRY_BPS_THRESHOLD) {
      return this.neutralSignal(symbol, startTime, `Premium near baseline (${premiumBps.toFixed(2)}bps vs median ${median.toFixed(2)}bps, delta ${delta.toFixed(2)}bps < ${ENTRY_BPS_THRESHOLD}bps)`);
    }

    // Direction-of-move consistency: how many of the last 8 samples are on
    // the same side of the median as the current sample? (excludes current)
    const lookback = Math.min(8, ring.length - 1);
    const recent = ring.slice(-1 - lookback, -1);
    let sameSide = 0;
    for (const v of recent) {
      if (delta > 0 && v - median > 0) sameSide++;
      else if (delta < 0 && v - median < 0) sameSide++;
    }
    const consistency = recent.length > 0 ? sameSide / recent.length : 0;

    // Confidence formula:
    //   base 0.40
    //   + magnitude (delta / PREMIUM_CAP_BPS scaled) → up to +0.30
    //   + consistency (0..1) → up to +0.20
    // capped at 0.85
    const magFactor = Math.min(Math.abs(delta) / PREMIUM_CAP_BPS, 1);
    const confidence = Math.min(0.40 + magFactor * 0.30 + consistency * 0.20, 0.85);

    const signal = delta > 0 ? 'bullish' : 'bearish';
    const reasoning =
      `Perp-spot premium ${premiumBps.toFixed(2)}bps vs median ${median.toFixed(2)}bps (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}bps), ` +
      `${sameSide}/${recent.length} of last ${recent.length} samples confirm direction → perp ${signal === 'bullish' ? 'leading up' : 'leading down'}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(delta) / PREMIUM_CAP_BPS, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        perpMid: perp.midPrice,
        spotMid: spot.midPrice,
        premiumBps,
        baselineMedianBps: median,
        deltaBps: delta,
        ringSize: ring.length,
        consistency,
        sameSideCount: sameSide,
        lookback: recent.length,
        perpAgeMs: perpAge,
        spotAgeMs: spotAge,
        source: 'binance-spot+perp-bookTicker',
      },
      qualityScore: 0.75,
      processingTime: Date.now() - startTime,
      dataFreshness: Math.max(perpAge, spotAge),
      executionScore: Math.round(50 + magFactor * 30 + consistency * 10), // bigger + more consistent → better timing
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
      evidence: { ringSize: this.premiumRings.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: Date.now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
