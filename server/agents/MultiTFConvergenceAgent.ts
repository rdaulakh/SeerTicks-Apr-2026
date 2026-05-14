/**
 * MultiTFConvergenceAgent — Phase 53.21
 *
 * Looks for directional agreement across multiple timeframes (1s, 5s, 15s,
 * 60s). When ALL timeframes agree on direction AND the bps/sec rate is
 * monotonically increasing toward shorter timeframes (acceleration), the
 * setup has high conviction:
 *
 *   - All 4 windows same sign → trend confirmed
 *   - Plus 1s rate ≥ 5s rate ≥ 15s rate ≥ 60s rate (in absolute) → accelerating
 *     trend (strongest)
 *   - Plus 1s rate < 5s rate < 15s rate < 60s rate → trend exhausting,
 *     fade signal (weaker confidence)
 *
 * Mechanically similar to VelocityAgent but more dimensions and looks at
 * convergence shape across 4 windows instead of 2-window ratio.
 *
 * Data: maintains its own per-symbol price ring sampled from
 * __binanceFuturesBook on each analyze call.
 *
 * Calibration:
 *   WINDOWS_MS    = [1_000, 5_000, 15_000, 60_000]
 *   MIN_RATE_BPS_PER_S = 0.3   (need at least mild trend on every window)
 *   RING_KEEP_MS  = 80_000
 *   STALE_MS      = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { engineLogger } from '../utils/logger';

interface PriceSample { price: number; timestamp: number; }
interface BookSnapshot { midPrice: number; eventTime: number; }

const WINDOWS_MS = [1_000, 5_000, 15_000, 60_000];
// Phase 82.3 — lowered from 0.3 to 0.15 bps/s. The strict ALL-4-windows-
// must-agree-AND-all-above-floor gate at 0.3 was 100% muting the agent
// (0/0/632 live) in sideways markets. 0.15 lets longer windows participate
// even at lower velocity; the same-sign requirement still rejects chop.
const MIN_RATE_BPS_PER_S = 0.15;
const RING_KEEP_MS = 80_000;
const STALE_MS = 1_500;
const MAX_CONFIDENCE = 0.83;

export class MultiTFConvergenceAgent extends AgentBase {
  private samples: Map<string, PriceSample[]> = new Map();
  private lastFeedWarnAt = 0;

  constructor() {
    const config: AgentConfig = {
      name: 'MultiTFConvergenceAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[MultiTFConvergenceAgent] initialized (4-window price agreement on perp mid)');
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

  private sampleAt(ring: PriceSample[], targetTs: number): PriceSample | null {
    if (ring.length === 0) return null;
    let best = ring[0];
    let bestDiff = Math.abs(ring[0].timestamp - targetTs);
    for (const s of ring) {
      const d = Math.abs(s.timestamp - targetTs);
      if (d < bestDiff) { best = s; bestDiff = d; }
    }
    return best;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const futuresBookGlobal = (global as any).__binanceFuturesBook as Record<string, BookSnapshot> | undefined;
    const book = (futuresBookGlobal || {})[binSym];
    if (!book) {
      // If the futures book global is empty entirely, the Binance Futures WS
      // is not delivering data (geo-block / ENABLE_BINANCE_FUTURES_WS=0 /
      // connection failed). Log once per minute and exit gracefully instead
      // of silently neutral-looping forever.
      if (!futuresBookGlobal || Object.keys(futuresBookGlobal).length === 0) {
        const now = getActiveClock().now();
        if (now - this.lastFeedWarnAt > 60_000) {
          this.lastFeedWarnAt = now;
          engineLogger.warn('MultiTFConvergenceAgent has no Binance futures book feed', {
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

    const now = getActiveClock().now();
    let ring = this.samples.get(symbol);
    if (!ring) { ring = []; this.samples.set(symbol, ring); }
    ring.push({ price: book.midPrice, timestamp: now });
    const cutoff = now - RING_KEEP_MS;
    while (ring.length > 0 && ring[0].timestamp < cutoff) ring.shift();

    if (ring.length < 10) {
      return this.neutralSignal(symbol, startTime, `Building samples (${ring.length}/10)`);
    }

    // Compute rate (bps/s) for each window
    const rates: { window: number; rate: number; ageMs: number }[] = [];
    for (const w of WINDOWS_MS) {
      const ref = this.sampleAt(ring, now - w);
      if (!ref) continue;
      const span = now - ref.timestamp;
      if (span < w * 0.5 || ref.price <= 0) continue; // window not yet filled enough
      const rate = ((book.midPrice - ref.price) / ref.price) * 10_000 / (span / 1000);
      rates.push({ window: w, rate, ageMs: span });
    }

    if (rates.length < WINDOWS_MS.length) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Only ${rates.length}/${WINDOWS_MS.length} windows ready — need full 4-window picture`,
      );
    }

    // All same sign?
    const sign = Math.sign(rates[0].rate);
    if (sign === 0) {
      return this.neutralSignal(symbol, startTime, `Flat 1s rate`);
    }
    for (const r of rates) {
      if (Math.sign(r.rate) !== sign) {
        return this.neutralSignal(
          symbol,
          startTime,
          `Sign disagreement across windows: ${rates.map(r => r.rate.toFixed(1)).join(', ')} bps/s`,
        );
      }
      if (Math.abs(r.rate) < MIN_RATE_BPS_PER_S) {
        return this.neutralSignal(
          symbol,
          startTime,
          `Window ${r.window / 1000}s below floor: ${r.rate.toFixed(2)}bps/s < ${MIN_RATE_BPS_PER_S}`,
        );
      }
    }

    // Shape: monotonically accelerating (1s ≥ 5s ≥ 15s ≥ 60s in abs) → strong continuation
    //        monotonically decelerating (1s ≤ 5s ≤ 15s ≤ 60s in abs)  → exhausting → fade
    //        else: mixed — confirmed direction but weaker
    const abs = rates.map(r => Math.abs(r.rate));
    const accelerating = abs[0] >= abs[1] && abs[1] >= abs[2] && abs[2] >= abs[3];
    const decelerating = abs[0] <= abs[1] && abs[1] <= abs[2] && abs[2] <= abs[3];

    let signal: 'bullish' | 'bearish';
    let scenario: string;
    let confidenceBase: number;
    if (accelerating) {
      signal = sign > 0 ? 'bullish' : 'bearish';
      scenario = 'accelerating-continuation';
      confidenceBase = 0.55;
    } else if (decelerating) {
      // Trend exhausting → fade signal points opposite the trend
      signal = sign > 0 ? 'bearish' : 'bullish';
      scenario = 'decelerating-fade';
      confidenceBase = 0.48; // Fades are less reliable than continuations
    } else {
      // Mixed shape but all-same-sign → confirmed direction, moderate
      signal = sign > 0 ? 'bullish' : 'bearish';
      scenario = 'confirmed-mixed';
      confidenceBase = 0.50;
    }

    // Magnitude factor: strongest window's rate (saturating at 5 bps/s)
    const peakRate = Math.max(...abs);
    const magFactor = Math.min(peakRate / 5.0, 1);
    // Spread factor: how big the gap between strongest and weakest window
    const spreadFactor = abs[0] > 0 ? Math.min(Math.abs(abs[0] - abs[3]) / abs[0], 1) : 0;
    const confidence = Math.min(confidenceBase + magFactor * 0.18 + spreadFactor * 0.12, MAX_CONFIDENCE);

    const reasoning =
      `Multi-TF ${scenario} on ${binSym}: ` +
      rates.map(r => `${r.window / 1000}s=${r.rate >= 0 ? '+' : ''}${r.rate.toFixed(2)}bps/s`).join(', ') +
      ` → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: magFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        scenario,
        rates: rates.map(r => ({ windowMs: r.window, bpsPerS: r.rate })),
        peakRate,
        magFactor,
        spreadFactor,
        ringSize: ring.length,
        source: 'binance-perp-mid-multitf',
      },
      qualityScore: 0.74,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: age,
      executionScore: Math.round(45 + magFactor * 25 + spreadFactor * 10),
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
