/**
 * PerpTakerFlowAgent — Phase 53.5
 *
 * Cumulative Volume Delta (CVD) on Binance USDT-M perpetuals. Aggressive
 * taker fills are the cleanest expression of intent — passive limit orders
 * are noise, taker market orders are commitment. When taker buys overwhelm
 * taker sells (or vice-versa) by significant notional in a short window,
 * price typically follows within 500ms–2s, even on the same exchange.
 *
 * Data source:
 *   global.__binancePerpTakerFlow[BTCUSDT] = [
 *     { side: 'buy'|'sell', price, qty, notional, timestamp }, ...
 *   ]
 * (Populated by the Phase 53.5 boot wiring on @aggTrade futures stream.)
 *
 * Algorithm (per symbol per analyze tick):
 *   1. Filter ring to the last LOOKBACK_MS window
 *   2. Sum notional per side; compute imbalance = (buy - sell) / total
 *   3. If |imbalance| < THRESHOLD or total < MIN_NOTIONAL → neutral
 *   4. Else: signal direction = sign(imbalance), confidence scales with
 *      magnitude * size factor (capped)
 *
 * Calibration starting points:
 *   LOOKBACK_MS    = 10_000    (last 10s of perp tape)
 *   MIN_NOTIONAL   = 100_000   ($100K — filters out quiet windows)
 *   THRESHOLD      = 0.30      (30% one-sided in the window)
 *   SIZE_SAT       = 2_000_000 (saturate confidence at $2M one-sided notional)
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

const LOOKBACK_MS = 10_000;
const MIN_NOTIONAL = 100_000;
const THRESHOLD = 0.30;
const SIZE_SAT = 2_000_000;

export class PerpTakerFlowAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'PerpTakerFlowAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[PerpTakerFlowAgent] initialized (reads __binancePerpTakerFlow)');
  }

  protected async cleanup(): Promise<void> {
    // No persistent state — ring is global.
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze().
  }

  /** SEER canonical "BTC-USD" → Binance native "BTCUSDT". */
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

    const ring = ((global as any).__binancePerpTakerFlow || {})[binSym] as TakerFill[] | undefined;
    if (!ring || ring.length === 0) {
      return this.neutralSignal(symbol, startTime, `No perp taker flow for ${binSym}`);
    }

    const now = getActiveClock().now();
    const cutoff = now - LOOKBACK_MS;
    const recent = ring.filter(f => f.timestamp >= cutoff);
    if (recent.length === 0) {
      return this.neutralSignal(symbol, startTime, `Taker flow ring stale (no fills in last ${LOOKBACK_MS}ms)`);
    }

    let buyNotional = 0;
    let sellNotional = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const f of recent) {
      if (f.side === 'buy') {
        buyNotional += f.notional;
        buyCount++;
      } else {
        sellNotional += f.notional;
        sellCount++;
      }
    }
    const totalNotional = buyNotional + sellNotional;

    if (totalNotional < MIN_NOTIONAL) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Quiet tape: $${(totalNotional / 1000).toFixed(0)}K total taker flow in last ${LOOKBACK_MS / 1000}s (need ≥$${MIN_NOTIONAL / 1000}K)`,
      );
    }

    const imbalance = (buyNotional - sellNotional) / totalNotional; // -1..+1
    if (Math.abs(imbalance) < THRESHOLD) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Balanced taker flow: ${(imbalance * 100).toFixed(1)}% imbalance (need ≥${THRESHOLD * 100}%)`,
      );
    }

    // Confidence scales with two factors: magnitude of imbalance, and size of
    // the dominant side (saturating). Bigger one-sided burst = more conviction.
    const dominantNotional = Math.max(buyNotional, sellNotional);
    const sizeFactor = Math.min(dominantNotional / SIZE_SAT, 1);
    const magFactor = Math.min((Math.abs(imbalance) - THRESHOLD) / (1 - THRESHOLD), 1);

    // Base 0.40, +up to 0.25 from magnitude, +up to 0.20 from size. Capped 0.85.
    const confidence = Math.min(0.40 + magFactor * 0.25 + sizeFactor * 0.20, 0.85);

    const signal = imbalance > 0 ? 'bullish' : 'bearish';
    const sideText = signal === 'bullish' ? 'taker BUYS' : 'taker SELLS';
    const reasoning =
      `Perp taker flow ${LOOKBACK_MS / 1000}s on ${binSym}: ` +
      `$${(dominantNotional / 1000).toFixed(0)}K ${sideText} vs $${(Math.min(buyNotional, sellNotional) / 1000).toFixed(0)}K opposite ` +
      `(${(imbalance * 100).toFixed(1)}% imbalance, ${recent.length} fills) → ${signal} momentum`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.abs(imbalance),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        windowMs: LOOKBACK_MS,
        buyNotional,
        sellNotional,
        totalNotional,
        imbalance,
        buyCount,
        sellCount,
        sizeFactor,
        magnitudeFactor: magFactor,
        source: 'binance-perp-aggTrade-ws',
      },
      qualityScore: 0.78,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: now - Math.max(...recent.map(f => f.timestamp)),
      executionScore: Math.round(50 + magFactor * 25 + sizeFactor * 15),
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
