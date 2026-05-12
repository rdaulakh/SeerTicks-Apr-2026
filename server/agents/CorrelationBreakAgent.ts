/**
 * CorrelationBreakAgent — Phase 53.25
 *
 * BTC, ETH, and SOL are highly correlated on intraday timescales (typically
 * 0.85-0.95 over 60-second windows). When that correlation breaks — BTC
 * moves significantly but ETH or SOL hasn't followed — the lagging asset
 * usually catches up within the next 30-90 seconds. The agent emits a
 * directional signal on the LAGGING asset pointing in BTC's direction.
 *
 * Mechanism:
 *   - For each symbol other than BTC, compare its 60s return to BTC's 60s return
 *   - If |btc_return| ≥ MIN_BTC_MOVE_BPS AND ratio = (this_return / btc_return) is
 *     significantly less than 1 (and same sign or zero), this asset lags
 *   - Direction = sign of BTC return (catch-up trade)
 *
 * Only emits non-neutral for ETH-USD and SOL-USD. For BTC-USD itself, returns
 * neutral (BTC is the leader; it doesn't get a catch-up signal).
 *
 * Data: maintains its own per-symbol price ring sampled from
 * __binanceFuturesBook on each analyze tick.
 *
 * Calibration:
 *   WINDOW_MS         = 60_000
 *   MIN_BTC_MOVE_BPS  = 8.0    (BTC needs a real move for the divergence to matter)
 *   MAX_LAG_RATIO     = 0.40   (this asset has done ≤40% of BTC's move → laggard)
 *   RING_KEEP_MS      = 90_000
 *   STALE_MS          = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface PriceSample { price: number; timestamp: number; }
interface BookSnapshot { midPrice: number; eventTime: number; }

const WINDOW_MS = 60_000;
// Phase 82.3 — lowered from 8.0 to 4.0 bps. BTC frequently doesn't move 8 bps
// in any 60s window during low-vol regimes; lower bar means we catch real
// catch-up opportunities on ETH/SOL when BTC makes a modest move.
const MIN_BTC_MOVE_BPS = 4.0;
const MAX_LAG_RATIO = 0.40;
const RING_KEEP_MS = 90_000;
const STALE_MS = 1_500;
const MAX_CONFIDENCE = 0.78;

// Map from canonical SEER → Binance native — symmetric to the other agents.
function toBinanceSymbol(symbol: string): string {
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

export class CorrelationBreakAgent extends AgentBase {
  // Single shared ring per Binance symbol (not per SEER symbol) — same data
  // serves both the cross-asset comparison and the per-symbol output.
  private samples: Map<string, PriceSample[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'CorrelationBreakAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[CorrelationBreakAgent] initialized (BTC/ETH/SOL cross-asset catch-up)');
  }

  protected async cleanup(): Promise<void> { this.samples.clear(); }
  protected async periodicUpdate(): Promise<void> { /* no periodic */ }

  /** Sample all 3 perp prices into our rings each call (cheap; idempotent). */
  private sampleAll(): void {
    const now = getActiveClock().now();
    const futures = (global as any).__binanceFuturesBook || {};
    for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      const book = futures[sym] as BookSnapshot | undefined;
      if (!book || !isFinite(book.midPrice) || book.midPrice <= 0) continue;
      // Only push if book is fresh (don't pollute ring with stale prices)
      if (now - book.eventTime > STALE_MS) continue;
      let ring = this.samples.get(sym);
      if (!ring) { ring = []; this.samples.set(sym, ring); }
      ring.push({ price: book.midPrice, timestamp: now });
      const cutoff = now - RING_KEEP_MS;
      while (ring.length > 0 && ring[0].timestamp < cutoff) ring.shift();
    }
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

  /** Return the bps move over WINDOW_MS for one symbol, or null if not enough history. */
  private moveBps(binSym: string): number | null {
    const ring = this.samples.get(binSym);
    if (!ring || ring.length < 5) return null;
    const now = getActiveClock().now();
    const ref = this.sampleAt(ring, now - WINDOW_MS);
    const last = ring[ring.length - 1];
    if (!ref || !last || ref.price <= 0) return null;
    if ((now - ref.timestamp) < WINDOW_MS * 0.7) return null;
    return ((last.price - ref.price) / ref.price) * 10_000;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = toBinanceSymbol(symbol);

    // Always sample fresh on every analyze call so the rings stay populated
    // regardless of which symbol the analyzer is asking about.
    this.sampleAll();

    if (binSym === 'BTCUSDT') {
      return this.neutralSignal(symbol, startTime, `BTC is the cross-asset leader; no catch-up signal for it`);
    }

    const btcMove = this.moveBps('BTCUSDT');
    const thisMove = this.moveBps(binSym);

    if (btcMove === null || thisMove === null) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Not enough history (btc=${btcMove === null ? 'null' : btcMove.toFixed(1)}, this=${thisMove === null ? 'null' : thisMove.toFixed(1)})`,
      );
    }

    if (Math.abs(btcMove) < MIN_BTC_MOVE_BPS) {
      return this.neutralSignal(
        symbol,
        startTime,
        `BTC quiet: ${btcMove.toFixed(1)}bps (need ≥${MIN_BTC_MOVE_BPS}bps for cross-asset divergence to matter)`,
      );
    }

    // Lag ratio: this asset's move as a fraction of BTC's move (signed).
    // Positive ratio = same direction; negative = opposite (rare but possible).
    const ratio = thisMove / btcMove;
    if (ratio >= MAX_LAG_RATIO) {
      return this.neutralSignal(
        symbol,
        startTime,
        `${binSym} keeping pace: BTC ${btcMove.toFixed(1)}bps, this ${thisMove.toFixed(1)}bps (ratio ${ratio.toFixed(2)} ≥ ${MAX_LAG_RATIO})`,
      );
    }

    // The lag is significant. Catch-up direction = sign of BTC.
    const signal: 'bullish' | 'bearish' = btcMove > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.45
    //   + up to 0.18 from BTC move magnitude (saturating at 30bps)
    //   + up to 0.20 from how-much-lag (lower ratio, including negatives, = more lag)
    const btcMagFactor = Math.min(Math.abs(btcMove) / 30, 1);
    // ratio of MAX_LAG_RATIO = 0 lag-factor; ratio of -1 (going opposite) = 1.0
    const lagFactor = Math.min(Math.max((MAX_LAG_RATIO - ratio) / (MAX_LAG_RATIO + 1), 0), 1);
    const confidence = Math.min(0.45 + btcMagFactor * 0.18 + lagFactor * 0.20, MAX_CONFIDENCE);

    const reasoning =
      `Correlation break on ${binSym}: BTC ${btcMove.toFixed(1)}bps vs this ${thisMove.toFixed(1)}bps over ${WINDOW_MS / 1000}s ` +
      `(ratio ${ratio.toFixed(2)}, ${ratio < 0 ? 'opposite direction' : 'lagging'}) → catch-up ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: lagFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        btcMoveBps: btcMove,
        thisMoveBps: thisMove,
        lagRatio: ratio,
        windowMs: WINDOW_MS,
        btcMagFactor,
        lagFactor,
        source: 'binance-perp-cross-asset-corr',
      },
      qualityScore: 0.74,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: Math.round(45 + btcMagFactor * 20 + lagFactor * 15),
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
      evidence: {
        btcRingSize: this.samples.get('BTCUSDT')?.length || 0,
        ethRingSize: this.samples.get('ETHUSDT')?.length || 0,
        solRingSize: this.samples.get('SOLUSDT')?.length || 0,
      },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
