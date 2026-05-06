/**
 * TradeBurstAgent — Phase 53.22
 *
 * Detects sudden surges in fill frequency on Binance perp aggTrade. When
 * fills/second jumps far above the recent baseline, it usually signals an
 * incoming larger order being worked or a coordinated reaction to news /
 * a level break. Direction comes from the side imbalance during the burst.
 *
 *   - High fill frequency + buy-side dominant fills → bullish burst
 *   - High fill frequency + sell-side dominant fills → bearish burst
 *   - High frequency but balanced sides → contested level → neutral
 *
 * Different from PerpTakerFlow which integrates total notional. This one
 * uses RAW FILL COUNT — capturing institutional iceberg orders broken into
 * many small fills (each individually small, but the COUNT signals algo
 * activity).
 *
 * Data: global.__binancePerpTakerFlow[BTCUSDT]
 *
 * Algorithm:
 *   1. Count fills in last BURST_MS window
 *   2. Count fills in baseline BASELINE_MS window
 *   3. burst_rate = fills_in_burst / (BURST_MS / 1000)
 *      baseline_rate = (fills_in_baseline - fills_in_burst) / ((BASELINE_MS - BURST_MS) / 1000)
 *   4. If burst_rate >= BURST_RATIO × baseline_rate AND burst_rate >= MIN_FILLS_PER_S
 *      → use side imbalance during burst to pick direction
 *
 * Calibration:
 *   BURST_MS         = 3_000
 *   BASELINE_MS      = 60_000
 *   BURST_RATIO      = 3.0    (burst rate must be 3× baseline)
 *   MIN_FILLS_PER_S  = 5      (minimum activity in burst itself)
 *   MIN_IMBALANCE    = 0.30
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";

interface TakerFill {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  timestamp: number;
}

const BURST_MS = 3_000;
const BASELINE_MS = 60_000;
const BURST_RATIO = 3.0;
const MIN_FILLS_PER_S = 5;
const MIN_IMBALANCE = 0.30;
const MAX_CONFIDENCE = 0.83;

export class TradeBurstAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'TradeBurstAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[TradeBurstAgent] initialized (reads __binancePerpTakerFlow)');
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

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = Date.now();
    const binSym = this.toBinanceSymbol(symbol);

    const ring = ((global as any).__binancePerpTakerFlow || {})[binSym] as TakerFill[] | undefined;
    if (!ring) return this.neutralSignal(symbol, startTime, `No taker flow ring for ${binSym}`);

    const now = Date.now();
    const burstCutoff = now - BURST_MS;
    const baselineCutoff = now - BASELINE_MS;

    const baselineFills = ring.filter(f => f.timestamp >= baselineCutoff);
    const burstFills = baselineFills.filter(f => f.timestamp >= burstCutoff);
    const olderFills = baselineFills.length - burstFills.length;
    const olderWindowS = (BASELINE_MS - BURST_MS) / 1000;

    if (baselineFills.length < 30) {
      return this.neutralSignal(symbol, startTime, `Insufficient baseline (${baselineFills.length} fills in ${BASELINE_MS / 1000}s)`);
    }

    const burstRate = burstFills.length / (BURST_MS / 1000);
    const baselineRate = olderWindowS > 0 ? olderFills / olderWindowS : 0;

    if (burstRate < MIN_FILLS_PER_S) {
      return this.neutralSignal(symbol, startTime, `Burst quiet: ${burstRate.toFixed(1)} fills/s (need ≥${MIN_FILLS_PER_S})`);
    }
    if (baselineRate <= 0) {
      return this.neutralSignal(symbol, startTime, `Degenerate baseline rate`);
    }
    const ratio = burstRate / baselineRate;
    if (ratio < BURST_RATIO) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No burst: ${burstRate.toFixed(1)}/s vs baseline ${baselineRate.toFixed(1)}/s (ratio ${ratio.toFixed(2)} < ${BURST_RATIO})`,
      );
    }

    // Side imbalance within the burst
    let buyN = 0, sellN = 0;
    let buyCount = 0, sellCount = 0;
    for (const f of burstFills) {
      if (f.side === 'buy') { buyN += f.notional; buyCount++; }
      else { sellN += f.notional; sellCount++; }
    }
    const totalN = buyN + sellN;
    const imbalance = totalN > 0 ? (buyN - sellN) / totalN : 0;

    if (Math.abs(imbalance) < MIN_IMBALANCE) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Burst contested: ${burstFills.length} fills, ${(imbalance * 100).toFixed(1)}% imbalance — neutral`,
      );
    }

    const signal: 'bullish' | 'bearish' = imbalance > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.45
    //   + up to 0.20 from burst ratio (saturating at 8x)
    //   + up to 0.18 from imbalance (saturating at 1.0)
    const ratioFactor = Math.min((ratio - BURST_RATIO) / (8.0 - BURST_RATIO), 1);
    const imbalanceFactor = Math.min(Math.abs(imbalance), 1);
    const confidence = Math.min(0.45 + ratioFactor * 0.20 + imbalanceFactor * 0.18, MAX_CONFIDENCE);

    const reasoning =
      `Trade burst on ${binSym}: ${burstFills.length} fills in ${BURST_MS / 1000}s ` +
      `(${burstRate.toFixed(1)}/s vs baseline ${baselineRate.toFixed(1)}/s = ${ratio.toFixed(1)}× burst), ` +
      `${(imbalance * 100).toFixed(1)}% ${signal === 'bullish' ? 'buy' : 'sell'}-dominant ($${(Math.max(buyN, sellN) / 1000).toFixed(0)}K) → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: imbalanceFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        burstFills: burstFills.length,
        baselineFills: baselineFills.length,
        burstRate,
        baselineRate,
        ratio,
        imbalance,
        buyCount,
        sellCount,
        buyNotional: buyN,
        sellNotional: sellN,
        ratioFactor,
        imbalanceFactor,
        source: 'binance-perp-aggTrade-burst',
      },
      qualityScore: 0.76,
      processingTime: Date.now() - startTime,
      dataFreshness: now - Math.max(...burstFills.map(f => f.timestamp)),
      executionScore: Math.round(50 + ratioFactor * 20 + imbalanceFactor * 15),
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
      evidence: {},
      qualityScore: 0.5,
      processingTime: Date.now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
