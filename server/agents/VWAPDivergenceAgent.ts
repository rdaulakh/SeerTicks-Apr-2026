/**
 * VWAPDivergenceAgent — Phase 53.23
 *
 * Computes a rolling Volume-Weighted Average Price (VWAP) over the last
 * VWAP_WINDOW_MS of perp aggTrade fills, then measures the divergence
 * between current price and that VWAP. Large divergence = price has run
 * far from average traded price → mean reversion bias.
 *
 *   - Price ≥ VWAP + N×stdev → expensive vs recent volume → bearish bias
 *     (but only if other agents confirm — VWAP fade alone is weak signal)
 *   - Price ≤ VWAP − N×stdev → cheap vs recent volume → bullish bias
 *
 * Standard deviation uses notional-weighted variance for robustness against
 * a single oversized print skewing things.
 *
 * Data: global.__binancePerpTakerFlow[BTCUSDT]  (uses price + notional + ts)
 *       global.__binanceFuturesBook[BTCUSDT]    (current ref price)
 *
 * Calibration:
 *   VWAP_WINDOW_MS    = 5 * 60_000  (5-minute rolling VWAP)
 *   MIN_FILLS         = 50
 *   MIN_DIVERGENCE_STDS = 1.5
 *   STDS_SAT          = 4.0
 *   STALE_MS          = 1500
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";

interface TakerFill {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  timestamp: number;
}

interface BookSnapshot { midPrice: number; eventTime: number; }

const VWAP_WINDOW_MS = 5 * 60_000;
const MIN_FILLS = 50;
const MIN_DIVERGENCE_STDS = 1.5;
const STDS_SAT = 4.0;
const STALE_MS = 1_500;
const MAX_CONFIDENCE = 0.78;

export class VWAPDivergenceAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'VWAPDivergenceAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[VWAPDivergenceAgent] initialized (reads __binancePerpTakerFlow + __binanceFuturesBook)');
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
    const book = ((global as any).__binanceFuturesBook || {})[binSym] as BookSnapshot | undefined;
    if (!ring || !book) {
      return this.neutralSignal(symbol, startTime, `Missing data (ring=${!!ring}, book=${!!book})`);
    }
    const bookAge = Date.now() - book.eventTime;
    if (bookAge > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Book stale (${bookAge}ms)`);
    }
    if (!isFinite(book.midPrice) || book.midPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid mid`);
    }

    const cutoff = Date.now() - VWAP_WINDOW_MS;
    const recent = ring.filter(f => f.timestamp >= cutoff);
    if (recent.length < MIN_FILLS) {
      return this.neutralSignal(symbol, startTime, `Insufficient fills (${recent.length}/${MIN_FILLS}) for VWAP`);
    }

    let totalNotional = 0;
    let weightedSum = 0;
    for (const f of recent) {
      totalNotional += f.notional;
      weightedSum += f.price * f.notional;
    }
    if (totalNotional <= 0) {
      return this.neutralSignal(symbol, startTime, `Zero notional in window`);
    }
    const vwap = weightedSum / totalNotional;

    // Notional-weighted variance
    let varSum = 0;
    for (const f of recent) {
      const dev = f.price - vwap;
      varSum += dev * dev * f.notional;
    }
    const variance = varSum / totalNotional;
    const stdev = Math.sqrt(variance);
    if (stdev <= 0) {
      return this.neutralSignal(symbol, startTime, `Zero stdev — degenerate`);
    }

    const divergenceStds = (book.midPrice - vwap) / stdev;
    if (Math.abs(divergenceStds) < MIN_DIVERGENCE_STDS) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Near VWAP: price $${book.midPrice.toFixed(2)} vs VWAP $${vwap.toFixed(2)} = ${divergenceStds.toFixed(2)}σ (need ≥${MIN_DIVERGENCE_STDS}σ)`,
      );
    }

    // Mean reversion direction
    const signal: 'bullish' | 'bearish' = divergenceStds > 0 ? 'bearish' : 'bullish';

    // Confidence: base 0.45
    //   + up to 0.20 from divergence magnitude (saturating at STDS_SAT)
    //   + up to 0.13 from notional volume in window (saturating at $5M)
    const magFactor = Math.min((Math.abs(divergenceStds) - MIN_DIVERGENCE_STDS) / (STDS_SAT - MIN_DIVERGENCE_STDS), 1);
    const volumeFactor = Math.min(totalNotional / 5_000_000, 1);
    const confidence = Math.min(0.45 + magFactor * 0.20 + volumeFactor * 0.13, MAX_CONFIDENCE);

    const reasoning =
      `VWAP divergence on ${binSym}: price $${book.midPrice.toFixed(2)} vs ${VWAP_WINDOW_MS / 60_000}min VWAP $${vwap.toFixed(2)} ` +
      `(σ=$${stdev.toFixed(2)}, ${divergenceStds >= 0 ? '+' : ''}${divergenceStds.toFixed(2)}σ, ${recent.length} fills, $${(totalNotional / 1_000_000).toFixed(1)}M) ` +
      `→ ${signal} mean reversion`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(divergenceStds) / STDS_SAT, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        currentPrice: book.midPrice,
        vwap,
        stdev,
        divergenceStds,
        windowMs: VWAP_WINDOW_MS,
        fillCount: recent.length,
        totalNotional,
        magFactor,
        volumeFactor,
        source: 'binance-perp-aggTrade-vwap',
      },
      qualityScore: 0.72,
      processingTime: Date.now() - startTime,
      dataFreshness: bookAge,
      executionScore: Math.round(45 + magFactor * 20 + volumeFactor * 10),
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
