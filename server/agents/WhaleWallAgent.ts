/**
 * WhaleWallAgent — Phase 53.11
 *
 * Detects "walls" in the Binance USDT-M perp top-5 order book — single quotes
 * that are much larger than the rest of the visible book. Walls reveal large
 * institutional liquidity preference pinned at a specific price:
 *
 *   - Bid wall (large quote on bid side) → institutional support → bullish bias
 *   - Ask wall (large quote on ask side) → institutional resistance → bearish bias
 *
 * The asymmetry matters more than the absolute size. A bid wall 5x the median
 * quote is a real signal even on a quiet day. A bid wall AND ask wall present
 * simultaneously cancel out (range-bound → neutral).
 *
 * Data source:
 *   global.__binancePerpDepth5[BTCUSDT] = { bids: [{price, qty}, ...], asks: [...] }
 *
 * Algorithm per analyze():
 *   1. Read current perp depth5
 *   2. For each side, compute (max_qty / median_qty) — the "wall ratio"
 *   3. Classify:
 *        bid_wall_ratio ≥ WALL_THRESHOLD AND ask_wall_ratio < WALL_THRESHOLD → bullish
 *        ask_wall_ratio ≥ WALL_THRESHOLD AND bid_wall_ratio < WALL_THRESHOLD → bearish
 *        both walls or neither → neutral
 *   4. Confidence scales with the dominant side's wall ratio (saturating)
 *
 * Calibration:
 *   WALL_THRESHOLD = 3.0   (3x median = clear wall)
 *   WALL_SATURATE  = 8.0   (8x = saturate confidence)
 *   STALE_MS       = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface DepthLevel { price: number; qty: number; }
interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  receivedAt: number;
  eventTime: number;
  tradeTime: number;
}

const WALL_THRESHOLD = 3.0;
const WALL_SATURATE = 8.0;
const STALE_MS = 1_500;

export class WhaleWallAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'WhaleWallAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[WhaleWallAgent] initialized (reads __binancePerpDepth5)');
  }

  protected async cleanup(): Promise<void> {
    // No persistent state.
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

  /** Median of a numeric array (does not mutate input). */
  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /** Wall ratio for one side: max_qty / median_qty. ≥3 → wall present. */
  private wallRatio(levels: DepthLevel[]): { ratio: number; maxQty: number; maxPrice: number } {
    if (levels.length < 2) return { ratio: 0, maxQty: 0, maxPrice: 0 };
    const qtys = levels.map(l => l.qty).filter(q => isFinite(q) && q > 0);
    if (qtys.length < 2) return { ratio: 0, maxQty: 0, maxPrice: 0 };
    const med = this.median(qtys);
    if (med <= 0) return { ratio: 0, maxQty: 0, maxPrice: 0 };
    let maxQty = 0;
    let maxPrice = 0;
    for (const l of levels) {
      if (l.qty > maxQty) {
        maxQty = l.qty;
        maxPrice = l.price;
      }
    }
    return { ratio: maxQty / med, maxQty, maxPrice };
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
      return this.neutralSignal(symbol, startTime, `Depth5 stale (${age}ms)`);
    }

    const bidWall = this.wallRatio(depth.bids);
    const askWall = this.wallRatio(depth.asks);

    const bidIsWall = bidWall.ratio >= WALL_THRESHOLD;
    const askIsWall = askWall.ratio >= WALL_THRESHOLD;

    if (bidIsWall && askIsWall) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Two-sided walls (bid ${bidWall.ratio.toFixed(1)}x, ask ${askWall.ratio.toFixed(1)}x) — range-bound`,
      );
    }
    if (!bidIsWall && !askIsWall) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No walls (bid ${bidWall.ratio.toFixed(1)}x, ask ${askWall.ratio.toFixed(1)}x — both <${WALL_THRESHOLD}x)`,
      );
    }

    // Exactly one wall present
    const isBullish = bidIsWall;
    const dominantRatio = isBullish ? bidWall.ratio : askWall.ratio;
    const oppositeRatio = isBullish ? askWall.ratio : bidWall.ratio;

    // Confidence: base 0.45, +up to 0.30 from wall size (saturating),
    // +up to 0.10 bonus when opposite side is tight (no counter-wall forming).
    const sizeFactor = Math.min(
      (dominantRatio - WALL_THRESHOLD) / (WALL_SATURATE - WALL_THRESHOLD),
      1,
    );
    // oppositeRatio < threshold by definition here. The smaller it is relative
    // to threshold, the cleaner the one-sided picture.
    const cleanlinessFactor = Math.max(0, 1 - oppositeRatio / WALL_THRESHOLD);
    const confidence = Math.min(0.45 + sizeFactor * 0.30 + cleanlinessFactor * 0.10, 0.85);

    const signal = isBullish ? 'bullish' : 'bearish';
    const wallSide = isBullish ? 'bid' : 'ask';
    const wallInfo = isBullish ? bidWall : askWall;
    const reasoning =
      `Perp ${wallSide}-wall on ${binSym}: ${wallInfo.maxQty.toFixed(2)} contracts at $${wallInfo.maxPrice.toFixed(2)} ` +
      `(${dominantRatio.toFixed(1)}x median, opposite ${oppositeRatio.toFixed(1)}x) → ` +
      `${signal} (institutional ${isBullish ? 'support' : 'resistance'})`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(dominantRatio / WALL_SATURATE, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        bidWallRatio: bidWall.ratio,
        askWallRatio: askWall.ratio,
        bidWallQty: bidWall.maxQty,
        askWallQty: askWall.maxQty,
        bidWallPrice: bidWall.maxPrice,
        askWallPrice: askWall.maxPrice,
        wallSide,
        sizeFactor,
        cleanlinessFactor,
        depthAgeMs: age,
        source: 'binance-perp-depth5-100ms-ws',
      },
      qualityScore: 0.72,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: age,
      executionScore: Math.round(45 + sizeFactor * 25 + cleanlinessFactor * 10),
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
      evidence: {},
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
