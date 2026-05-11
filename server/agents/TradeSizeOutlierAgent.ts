/**
 * TradeSizeOutlierAgent — Phase 53.15
 *
 * Detects single fills on Binance perps with notional much larger than recent
 * median ("whale fills"). Distinct from PerpTakerFlowAgent which sums total
 * notional over a window — that captures sustained pressure. Whale fills are
 * discrete commitment events, often the first visible footprint of an
 * institutional order being worked.
 *
 *   - Single buy fill with ≥ 5x median notional → directional buyer present
 *   - Single sell fill with ≥ 5x median notional → directional seller present
 *   - Multiple outliers in same direction within window → conviction stacks
 *
 * Data source:
 *   global.__binancePerpTakerFlow[BTCUSDT] = [{ side, notional, timestamp }, ...]
 *
 * Algorithm per analyze():
 *   1. Filter ring to last LOOKBACK_MS
 *   2. Compute median notional of recent fills
 *   3. Identify outliers: fills with notional ≥ OUTLIER_MULTIPLIER × median
 *   4. Side imbalance among outliers → directional signal
 *   5. Confidence scales with outlier count, size relative to median, and
 *      directional cleanliness
 *
 * Calibration:
 *   LOOKBACK_MS         = 30_000
 *   MIN_FILLS_FOR_MED   = 20      (need enough history for stable median)
 *   OUTLIER_MULTIPLIER  = 5.0
 *   MIN_OUTLIER_NOTIONAL = 50_000 (absolute floor — small markets)
 *   MAX_CONFIDENCE      = 0.85
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface TakerFill {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  timestamp: number;
}

const LOOKBACK_MS = 30_000;
const MIN_FILLS_FOR_MED = 20;
const OUTLIER_MULTIPLIER = 5.0;
const MIN_OUTLIER_NOTIONAL = 50_000;
const MAX_CONFIDENCE = 0.85;

export class TradeSizeOutlierAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'TradeSizeOutlierAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[TradeSizeOutlierAgent] initialized (reads __binancePerpTakerFlow)');
  }

  protected async cleanup(): Promise<void> { /* no state */ }
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

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);
    const ring = ((global as any).__binancePerpTakerFlow || {})[binSym] as TakerFill[] | undefined;

    if (!ring) return this.neutralSignal(symbol, startTime, `No taker flow ring for ${binSym}`);

    const cutoff = getActiveClock().now() - LOOKBACK_MS;
    const recent = ring.filter(f => f.timestamp >= cutoff);
    if (recent.length < MIN_FILLS_FOR_MED) {
      return this.neutralSignal(symbol, startTime, `Insufficient fills (${recent.length}/${MIN_FILLS_FOR_MED}) for stable median`);
    }

    const med = this.median(recent.map(f => f.notional));
    if (med <= 0) {
      return this.neutralSignal(symbol, startTime, `Median notional 0 — degenerate ring`);
    }

    const threshold = Math.max(med * OUTLIER_MULTIPLIER, MIN_OUTLIER_NOTIONAL);
    const outliers = recent.filter(f => f.notional >= threshold);
    if (outliers.length === 0) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No outliers — median $${med.toFixed(0)}, threshold $${threshold.toFixed(0)} (${recent.length} fills)`,
      );
    }

    let buyOutlierNotional = 0;
    let sellOutlierNotional = 0;
    let buyCount = 0;
    let sellCount = 0;
    let largestNotional = 0;
    let largestSide: 'buy' | 'sell' = 'buy';
    for (const o of outliers) {
      if (o.side === 'buy') {
        buyOutlierNotional += o.notional;
        buyCount++;
      } else {
        sellOutlierNotional += o.notional;
        sellCount++;
      }
      if (o.notional > largestNotional) {
        largestNotional = o.notional;
        largestSide = o.side;
      }
    }

    const totalOutlierNotional = buyOutlierNotional + sellOutlierNotional;
    const imbalance = totalOutlierNotional > 0
      ? (buyOutlierNotional - sellOutlierNotional) / totalOutlierNotional
      : 0;

    // Need direction: outliers on one side only OR strong notional imbalance.
    // Two-sided outliers with balanced notional → noisy → neutral.
    if (Math.abs(imbalance) < 0.40) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Two-sided outliers: ${buyCount}buy/${sellCount}sell ($${(buyOutlierNotional / 1000).toFixed(0)}K vs $${(sellOutlierNotional / 1000).toFixed(0)}K, imbalance ${(imbalance * 100).toFixed(0)}%) — neutral`,
      );
    }

    const signal: 'bullish' | 'bearish' = imbalance > 0 ? 'bullish' : 'bearish';
    const dominantSide = imbalance > 0 ? 'buy' : 'sell';
    const dominantNotional = Math.max(buyOutlierNotional, sellOutlierNotional);

    // Confidence: base 0.45 (one-sided whale activity is noteworthy on its own)
    //   + up to 0.20 from stack count (more outliers same side = more conviction)
    //   + up to 0.20 from largest fill ratio (largest fill / median, saturating at 20x)
    const stackFactor = Math.min(Math.max(buyCount, sellCount) / 5, 1); // 5+ outliers saturates
    const sizeFactor = Math.min((largestNotional / med) / 20, 1); // 20x saturates
    const confidence = Math.min(0.45 + stackFactor * 0.20 + sizeFactor * 0.20, MAX_CONFIDENCE);

    const reasoning =
      `Whale ${dominantSide}-fills on ${binSym}: ${outliers.length} outlier(s) ≥${OUTLIER_MULTIPLIER}× median ($${med.toFixed(0)}) ` +
      `over ${LOOKBACK_MS / 1000}s, dominant $${(dominantNotional / 1000).toFixed(0)}K ${dominantSide}, ` +
      `largest ${largestSide} $${(largestNotional / 1000).toFixed(0)}K (${(largestNotional / med).toFixed(1)}× median) → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(imbalance) + sizeFactor * 0.3, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        windowMs: LOOKBACK_MS,
        medianNotional: med,
        outlierThreshold: threshold,
        outlierCount: outliers.length,
        buyOutliers: buyCount,
        sellOutliers: sellCount,
        buyOutlierNotional,
        sellOutlierNotional,
        imbalance,
        largestNotional,
        largestSide,
        largestRatio: largestNotional / med,
        stackFactor,
        sizeFactor,
        source: 'binance-perp-aggTrade-outliers',
      },
      qualityScore: 0.76,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: getActiveClock().now() - Math.max(...outliers.map(o => o.timestamp)),
      executionScore: Math.round(50 + stackFactor * 25 + sizeFactor * 15),
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
