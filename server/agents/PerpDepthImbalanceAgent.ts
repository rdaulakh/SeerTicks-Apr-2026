/**
 * PerpDepthImbalanceAgent — Phase 53.8
 *
 * Top-5 order book imbalance on Binance USDT-M perpetuals.
 *
 * bookTicker only shows top-of-book (best bid + size, best ask + size). The
 * top-of-book qty is noisy — single small bids/asks flicker constantly. The
 * sum of the top-5 levels is much more stable and reflects real resting
 * liquidity preferences. When Σbid_qty over top-5 is persistently larger
 * than Σask_qty over a 30s window, market-makers and institutional flow are
 * net long-leaning — price typically follows.
 *
 * Data source:
 *   global.__binancePerpDepth5[BTCUSDT] = {
 *     bids: [{price, qty}, ...up to 5],
 *     asks: [{price, qty}, ...up to 5],
 *     eventTime, tradeTime, receivedAt,
 *   }
 *
 * Algorithm:
 *   1. Compute current imbalance = (Σbid_qty - Σask_qty) / (Σbid_qty + Σask_qty)
 *   2. Push to per-symbol ring (last 30 samples ~ 3s of 100ms updates)
 *   3. Average the ring → robust imbalance reading
 *   4. If |avg_imbalance| > THRESHOLD → directional signal
 *   5. Confidence scales with magnitude × persistence (% same-side samples)
 *
 * Calibration:
 *   THRESHOLD     = 0.20    (20% net imbalance over top-5)
 *   STALE_MS      = 1500    (depth older than this → neutral)
 *   RING_SIZE     = 30      (~3s at 100ms cadence)
 *   PERSISTENCE_F = 0.66    (need ≥66% of ring same side)
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface DepthLevel { price: number; qty: number; }
interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  eventTime: number;
  tradeTime: number;
  receivedAt: number;
}

// Phase 82.3 — retuned from {0.20, 0.66} to {0.12, 0.55}. Live: 22/46/571
// (10% directional firing). BTC top-5 perp imbalance hovers ±5-15% normally;
// the 20% bar + 66% persistence gate was too strict for current vol regime.
const THRESHOLD = 0.12;
const STALE_MS = 1_500;
const RING_SIZE = 30;
const PERSISTENCE_F = 0.55;

export class PerpDepthImbalanceAgent extends AgentBase {
  private imbalanceRings: Map<string, number[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'PerpDepthImbalanceAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[PerpDepthImbalanceAgent] initialized (reads __binancePerpDepth5)');
  }

  protected async cleanup(): Promise<void> {
    this.imbalanceRings.clear();
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze().
  }

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
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const depth = ((global as any).__binancePerpDepth5 || {})[binSym] as DepthSnapshot | undefined;
    if (!depth) {
      return this.neutralSignal(symbol, startTime, `No perp depth5 for ${binSym}`);
    }

    const age = getActiveClock().now() - depth.receivedAt;
    if (age > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Perp depth5 stale (${age}ms > ${STALE_MS}ms)`);
    }
    if (depth.bids.length === 0 || depth.asks.length === 0) {
      return this.neutralSignal(symbol, startTime, `Empty depth5 (bids=${depth.bids.length}, asks=${depth.asks.length})`);
    }

    const bidQty = depth.bids.reduce((s, l) => s + l.qty, 0);
    const askQty = depth.asks.reduce((s, l) => s + l.qty, 0);
    const total = bidQty + askQty;
    if (total <= 0) {
      return this.neutralSignal(symbol, startTime, `Zero-quantity depth (bidQty=${bidQty}, askQty=${askQty})`);
    }

    const currentImbalance = (bidQty - askQty) / total;

    // Update ring
    let ring = this.imbalanceRings.get(symbol);
    if (!ring) {
      ring = [];
      this.imbalanceRings.set(symbol, ring);
    }
    ring.push(currentImbalance);
    if (ring.length > RING_SIZE) ring.shift();

    if (ring.length < 5) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Building ring (${ring.length}/5), current imbalance ${(currentImbalance * 100).toFixed(1)}%`,
      );
    }

    // Robust mean (trim 10% extremes if ring is full)
    const sorted = [...ring].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const avgImbalance = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;

    if (Math.abs(avgImbalance) < THRESHOLD) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Balanced depth: avg imbalance ${(avgImbalance * 100).toFixed(1)}% (need ≥${THRESHOLD * 100}%)`,
      );
    }

    // Persistence: % of ring on same side as avg
    const sameSide = ring.filter(v => Math.sign(v) === Math.sign(avgImbalance)).length;
    const persistence = sameSide / ring.length;
    if (persistence < PERSISTENCE_F) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Direction unstable: ${sameSide}/${ring.length} samples same side (need ≥${(PERSISTENCE_F * 100).toFixed(0)}%)`,
      );
    }

    // Confidence: base 0.40, +up to 0.25 from magnitude (saturates at 0.5),
    // +up to 0.20 from persistence above floor. Capped 0.85.
    const magFactor = Math.min((Math.abs(avgImbalance) - THRESHOLD) / (0.5 - THRESHOLD), 1);
    const persistFactor = (persistence - PERSISTENCE_F) / (1 - PERSISTENCE_F);
    const confidence = Math.min(0.40 + magFactor * 0.25 + persistFactor * 0.20, 0.85);

    const signal = avgImbalance > 0 ? 'bullish' : 'bearish';
    const sideText = signal === 'bullish' ? 'bid-heavy' : 'ask-heavy';
    const reasoning =
      `Perp top-5 depth ${sideText}: avg ${(avgImbalance * 100).toFixed(1)}% imbalance over ${ring.length} samples ` +
      `(persistence ${(persistence * 100).toFixed(0)}%) — Σbid=${bidQty.toFixed(2)} vs Σask=${askQty.toFixed(2)} ` +
      `→ ${signal} pressure`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(avgImbalance), 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        currentImbalance,
        avgImbalance,
        bidQty,
        askQty,
        bidLevels: depth.bids.length,
        askLevels: depth.asks.length,
        ringSize: ring.length,
        persistence,
        sameSideCount: sameSide,
        depthAgeMs: age,
        source: 'binance-perp-depth5-100ms-ws',
      },
      qualityScore: 0.78,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: age,
      executionScore: Math.round(45 + magFactor * 25 + persistFactor * 15),
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
      evidence: { ringSize: this.imbalanceRings.get(symbol)?.length || 0 },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
