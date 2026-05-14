/**
 * SpotTakerFlowAgent — Phase 53.7
 *
 * Cumulative Volume Delta (CVD) on Binance SPOT, mirroring PerpTakerFlowAgent
 * (Phase 53.5). Spot taker flow alone is a weaker signal than perp because
 * spot speculation is rarer (no leverage), but the agent's real value is in
 * COMBINATION with PerpTakerFlowAgent inside the consensus engine:
 *
 *   - Both bullish → real demand (perp speculators + spot buyers in agreement)
 *   - Both bearish → real supply
 *   - Perp bullish, spot weak → perp speculation only → likely fade
 *   - Perp bearish, spot bullish → underlying demand absorbing perp shorts
 *
 * The consensus engine handles the mixing automatically; this agent just
 * needs to be honest about spot CVD and let consensus reconcile.
 *
 * Data source:
 *   global.__binanceSpotTakerFlow[BTCUSDT] = [
 *     { side: 'buy'|'sell', price, qty, notional, timestamp }, ...
 *   ]
 *
 * Calibration: same shape as perp, slightly stricter notional floor since
 * spot tape is busier (more chaff to filter).
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
const MIN_NOTIONAL = 250_000;     // higher floor than perp ($250K) — spot tape is busier
const THRESHOLD = 0.30;
const SIZE_SAT = 5_000_000;       // saturate at $5M one-sided spot notional

export class SpotTakerFlowAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'SpotTakerFlowAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[SpotTakerFlowAgent] initialized (reads __binanceSpotTakerFlow)');
  }

  protected async cleanup(): Promise<void> {
    // No persistent state — ring is global.
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

    const ring = ((global as any).__binanceSpotTakerFlow || {})[binSym] as TakerFill[] | undefined;
    if (!ring || ring.length === 0) {
      return this.neutralSignal(symbol, startTime, `No spot taker flow for ${binSym}`);
    }

    const now = getActiveClock().now();
    const cutoff = now - LOOKBACK_MS;
    const recent = ring.filter(f => f.timestamp >= cutoff);
    if (recent.length === 0) {
      return this.neutralSignal(symbol, startTime, `Spot taker flow ring stale (no fills in last ${LOOKBACK_MS}ms)`);
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
        `Quiet spot tape: $${(totalNotional / 1000).toFixed(0)}K total in last ${LOOKBACK_MS / 1000}s (need ≥$${MIN_NOTIONAL / 1000}K)`,
      );
    }

    const imbalance = (buyNotional - sellNotional) / totalNotional;
    if (Math.abs(imbalance) < THRESHOLD) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Balanced spot flow: ${(imbalance * 100).toFixed(1)}% imbalance (need ≥${THRESHOLD * 100}%)`,
      );
    }

    const dominantNotional = Math.max(buyNotional, sellNotional);
    const sizeFactor = Math.min(dominantNotional / SIZE_SAT, 1);
    const magFactor = Math.min((Math.abs(imbalance) - THRESHOLD) / (1 - THRESHOLD), 1);

    const confidence = Math.min(0.40 + magFactor * 0.25 + sizeFactor * 0.20, 0.85);

    const signal = imbalance > 0 ? 'bullish' : 'bearish';
    const sideText = signal === 'bullish' ? 'spot taker BUYS' : 'spot taker SELLS';
    const reasoning =
      `Spot taker flow ${LOOKBACK_MS / 1000}s on ${binSym}: ` +
      `$${(dominantNotional / 1000).toFixed(0)}K ${sideText} vs $${(Math.min(buyNotional, sellNotional) / 1000).toFixed(0)}K opposite ` +
      `(${(imbalance * 100).toFixed(1)}% imbalance, ${recent.length} fills) → ${signal} demand`;

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
        source: 'binance-spot-aggTrade-ws',
      },
      qualityScore: 0.72,    // spot CVD slightly noisier than perp CVD
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: now - Math.max(...recent.map(f => f.timestamp)),
      executionScore: Math.round(45 + magFactor * 25 + sizeFactor * 15),
    };
  }

  private neutralSignal(symbol: string, startTime: number, reason: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal: 'neutral',
      // Phase 93.25 — silent-neutral demotion (was 0.5 phantom-vote bug). See attribution audit 2026-05-15.
      confidence: 0.02,
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
