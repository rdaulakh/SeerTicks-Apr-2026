/**
 * PriceImpactAgent — Phase 53.24
 *
 * Computes the realized price impact per $1M of taker flow on Binance perp:
 *
 *   impact_bps_per_million = abs(price_move_bps) / (notional_M)
 *
 * over a short window. Compares to a longer-window baseline. When current
 * impact is significantly higher than baseline, liquidity is thin → next
 * push moves price more than it normally would. Direction is taken from
 * the side imbalance during the high-impact window.
 *
 * Symmetric to LiquidityVacuumAgent but measures REALIZED impact rather
 * than displayed depth — sometimes display is fake (spoofing) and only
 * realized cost reveals real liquidity.
 *
 * Data:
 *   global.__binancePerpTakerFlow[BTCUSDT]
 *   global.__binanceFuturesBook[BTCUSDT]   (current ref price)
 *
 * Algorithm:
 *   1. SHORT window (10s): compute Σnotional, Σbuy_notional, abs(price_move)
 *   2. LONG window (60s, excluding short): same
 *   3. impact_short = move_short_bps / (notional_short_M)
 *      impact_long  = move_long_bps  / (notional_long_M)
 *   4. If impact_short ≥ IMPACT_RATIO × impact_long AND short-window has
 *      meaningful notional → high-impact regime
 *   5. Direction = sign of buy-sell imbalance during the short window
 *
 * Calibration:
 *   SHORT_MS         = 10_000
 *   LONG_MS          = 60_000
 *   MIN_NOTIONAL     = 200_000
 *   IMPACT_RATIO     = 2.0
 *   MIN_IMBALANCE    = 0.25
 *   STALE_MS         = 1500
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

interface BookSnapshot { midPrice: number; eventTime: number; }

const SHORT_MS = 10_000;
const LONG_MS = 60_000;
const MIN_NOTIONAL = 200_000;
const IMPACT_RATIO = 2.0;
const MIN_IMBALANCE = 0.25;
const STALE_MS = 1_500;
const MAX_CONFIDENCE = 0.80;

function summarize(fills: TakerFill[]): { notional: number; minPrice: number; maxPrice: number; firstPrice: number; lastPrice: number; buy: number; sell: number } {
  if (fills.length === 0) return { notional: 0, minPrice: 0, maxPrice: 0, firstPrice: 0, lastPrice: 0, buy: 0, sell: 0 };
  let n = 0, buy = 0, sell = 0;
  let mn = Infinity, mx = -Infinity;
  const first = fills[0].price;
  const last = fills[fills.length - 1].price;
  for (const f of fills) {
    n += f.notional;
    if (f.side === 'buy') buy += f.notional;
    else sell += f.notional;
    if (f.price < mn) mn = f.price;
    if (f.price > mx) mx = f.price;
  }
  return { notional: n, minPrice: mn, maxPrice: mx, firstPrice: first, lastPrice: last, buy, sell };
}

export class PriceImpactAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'PriceImpactAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[PriceImpactAgent] initialized (reads __binancePerpTakerFlow + __binanceFuturesBook)');
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
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const ring = ((global as any).__binancePerpTakerFlow || {})[binSym] as TakerFill[] | undefined;
    const book = ((global as any).__binanceFuturesBook || {})[binSym] as BookSnapshot | undefined;
    if (!ring || !book) {
      return this.neutralSignal(symbol, startTime, `Missing data (ring=${!!ring}, book=${!!book})`);
    }
    const bookAge = getActiveClock().now() - book.eventTime;
    if (bookAge > STALE_MS) {
      return this.neutralSignal(symbol, startTime, `Book stale (${bookAge}ms)`);
    }

    const now = getActiveClock().now();
    const shortCutoff = now - SHORT_MS;
    const longCutoff = now - LONG_MS;
    const allFills = ring.filter(f => f.timestamp >= longCutoff)
                          .sort((a, b) => a.timestamp - b.timestamp);
    const shortFills = allFills.filter(f => f.timestamp >= shortCutoff);
    const olderFills = allFills.filter(f => f.timestamp < shortCutoff);

    if (shortFills.length < 5 || olderFills.length < 10) {
      return this.neutralSignal(symbol, startTime, `Insufficient fills (short ${shortFills.length}, older ${olderFills.length})`);
    }

    const short = summarize(shortFills);
    const long = summarize(olderFills);

    if (short.notional < MIN_NOTIONAL) {
      return this.neutralSignal(symbol, startTime, `Short window quiet: $${(short.notional / 1000).toFixed(0)}K (need ≥$${MIN_NOTIONAL / 1000}K)`);
    }
    if (short.firstPrice <= 0 || long.firstPrice <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid baseline price`);
    }

    // Realized price move (range-based: absolute high-low travel)
    const shortMoveBps = ((short.maxPrice - short.minPrice) / short.firstPrice) * 10_000;
    const longMoveBps = ((long.maxPrice - long.minPrice) / long.firstPrice) * 10_000;
    const shortNotionalM = short.notional / 1_000_000;
    const longNotionalM = long.notional / 1_000_000;

    if (shortNotionalM <= 0 || longNotionalM <= 0) {
      return this.neutralSignal(symbol, startTime, `Zero-notional window`);
    }

    const shortImpact = shortMoveBps / shortNotionalM;
    const longImpact = longMoveBps / Math.max(longNotionalM, 0.001);
    if (longImpact <= 0 || !isFinite(longImpact) || !isFinite(shortImpact)) {
      return this.neutralSignal(symbol, startTime, `Degenerate impact (long=${longImpact.toFixed(2)}, short=${shortImpact.toFixed(2)})`);
    }

    const ratio = shortImpact / longImpact;
    if (ratio < IMPACT_RATIO) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Normal impact: ${shortImpact.toFixed(1)}bps/$1M (short) vs ${longImpact.toFixed(1)}bps/$1M (long), ratio ${ratio.toFixed(2)} < ${IMPACT_RATIO}`,
      );
    }

    // Direction from short-window side imbalance
    const totalShort = short.buy + short.sell;
    const imbalance = totalShort > 0 ? (short.buy - short.sell) / totalShort : 0;
    if (Math.abs(imbalance) < MIN_IMBALANCE) {
      return this.neutralSignal(
        symbol,
        startTime,
        `High impact (${ratio.toFixed(1)}×) but contested sides (${(imbalance * 100).toFixed(1)}%) — neutral`,
      );
    }

    const signal: 'bullish' | 'bearish' = imbalance > 0 ? 'bullish' : 'bearish';

    // Confidence: base 0.45
    //   + up to 0.20 from impact ratio (saturating at 6x)
    //   + up to 0.18 from imbalance magnitude
    const ratioFactor = Math.min((ratio - IMPACT_RATIO) / (6.0 - IMPACT_RATIO), 1);
    const imbalanceFactor = Math.min(Math.abs(imbalance), 1);
    const confidence = Math.min(0.45 + ratioFactor * 0.20 + imbalanceFactor * 0.18, MAX_CONFIDENCE);

    const reasoning =
      `High price impact on ${binSym}: ${shortImpact.toFixed(1)}bps/$1M (${SHORT_MS / 1000}s) vs ` +
      `${longImpact.toFixed(1)}bps/$1M (baseline) = ${ratio.toFixed(1)}× impact, ` +
      `${(imbalance * 100).toFixed(1)}% ${signal === 'bullish' ? 'buy' : 'sell'}-dominant in burst ($${(short.notional / 1000).toFixed(0)}K) → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: imbalanceFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        shortMoveBps,
        longMoveBps,
        shortNotionalM,
        longNotionalM,
        shortImpact,
        longImpact,
        ratio,
        imbalance,
        shortBuyNotional: short.buy,
        shortSellNotional: short.sell,
        ratioFactor,
        imbalanceFactor,
        source: 'binance-perp-aggTrade-impact',
      },
      qualityScore: 0.74,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: bookAge,
      executionScore: Math.round(50 + ratioFactor * 20 + imbalanceFactor * 15),
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
