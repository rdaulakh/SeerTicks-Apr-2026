/**
 * leadInfoRouter — Phase 53.14
 *
 * Read-only telemetry for the LEAD_INFO category agents (Phases 53.3–53.13).
 * Lets operators inspect the in-memory state that drives those agents:
 *   - Binance spot/futures top-of-book
 *   - Coinbase top-of-book
 *   - Perp top-5 depth
 *   - Spot/perp taker flow ring sizes & last-N-second imbalance
 *   - Last 100 liquidations
 *
 * Pure read of process globals. No DB queries, no external API calls. Safe
 * to call frequently — designed for an admin dashboard refresh loop.
 */

import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';

interface TakerFill {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  timestamp: number;
}

function summarizeTakerRing(ring: TakerFill[] | undefined, lookbackMs: number) {
  if (!ring || ring.length === 0) return { fills: 0, totalNotional: 0, buyNotional: 0, sellNotional: 0, imbalance: 0, oldestAgeMs: null as number | null };
  const cutoff = Date.now() - lookbackMs;
  const recent = ring.filter(f => f.timestamp >= cutoff);
  let buy = 0, sell = 0;
  for (const f of recent) {
    if (f.side === 'buy') buy += f.notional;
    else sell += f.notional;
  }
  const total = buy + sell;
  return {
    fills: recent.length,
    totalNotional: total,
    buyNotional: buy,
    sellNotional: sell,
    imbalance: total > 0 ? (buy - sell) / total : 0,
    oldestAgeMs: recent.length > 0 ? Date.now() - Math.min(...recent.map(f => f.timestamp)) : null,
  };
}

const symbolInput = z.object({
  binanceSymbol: z.string().default('BTCUSDT'),    // for binance-keyed globals
  seerSymbol: z.string().default('BTC-USD'),       // for coinbase-keyed globals
  lookbackMs: z.number().int().min(1000).max(60_000).default(10_000),
});

export const leadInfoRouter = router({
  /**
   * Combined snapshot — everything the LEAD_INFO agents see right now.
   */
  snapshot: protectedProcedure
    .input(symbolInput)
    .query(({ input }) => {
      const g = global as any;
      const futuresBook = (g.__binanceFuturesBook || {})[input.binanceSymbol] || null;
      const spotBook = (g.__binanceSpotBook || {})[input.binanceSymbol] || null;
      const coinbaseBook = (g.__coinbaseTopOfBook || {})[input.seerSymbol] || null;
      const perpDepth = (g.__binancePerpDepth5 || {})[input.binanceSymbol] || null;
      const perpFlow = (g.__binancePerpTakerFlow || {})[input.binanceSymbol] || [];
      const spotFlow = (g.__binanceSpotTakerFlow || {})[input.binanceSymbol] || [];
      const liquidations: any[] = (g.__lastLiquidations || []).filter((l: any) => l.symbol === input.binanceSymbol).slice(-20);

      const now = Date.now();
      const perpSummary = summarizeTakerRing(perpFlow, input.lookbackMs);
      const spotSummary = summarizeTakerRing(spotFlow, input.lookbackMs);

      // Spread (pre-computed for convenience)
      let spreadBps: number | null = null;
      if (spotBook?.midPrice && coinbaseBook?.midPrice && coinbaseBook.midPrice > 0) {
        spreadBps = (spotBook.midPrice - coinbaseBook.midPrice) / coinbaseBook.midPrice * 10_000;
      }

      // Premium (pre-computed)
      let premiumBps: number | null = null;
      if (futuresBook?.midPrice && spotBook?.midPrice && spotBook.midPrice > 0) {
        premiumBps = (futuresBook.midPrice - spotBook.midPrice) / spotBook.midPrice * 10_000;
      }

      // Top-5 depth imbalance
      let depthImbalance: number | null = null;
      let bidQtySum: number | null = null;
      let askQtySum: number | null = null;
      if (perpDepth?.bids && perpDepth?.asks && perpDepth.bids.length > 0 && perpDepth.asks.length > 0) {
        bidQtySum = perpDepth.bids.reduce((s: number, l: any) => s + (l.qty || 0), 0);
        askQtySum = perpDepth.asks.reduce((s: number, l: any) => s + (l.qty || 0), 0);
        const totalQty = (bidQtySum || 0) + (askQtySum || 0);
        depthImbalance = totalQty > 0 ? ((bidQtySum || 0) - (askQtySum || 0)) / totalQty : 0;
      }

      return {
        timestamp: now,
        binanceSymbol: input.binanceSymbol,
        seerSymbol: input.seerSymbol,
        lookbackMs: input.lookbackMs,
        binanceSpot: spotBook ? {
          bid: spotBook.bidPrice,
          ask: spotBook.askPrice,
          mid: spotBook.midPrice,
          ageMs: spotBook.eventTime ? now - spotBook.eventTime : null,
        } : null,
        binancePerp: futuresBook ? {
          bid: futuresBook.bidPrice,
          ask: futuresBook.askPrice,
          mid: futuresBook.midPrice,
          ageMs: futuresBook.eventTime ? now - futuresBook.eventTime : null,
        } : null,
        coinbaseSpot: coinbaseBook ? {
          bid: coinbaseBook.bidPrice,
          ask: coinbaseBook.askPrice,
          mid: coinbaseBook.midPrice,
          ageMs: coinbaseBook.receivedAt ? now - coinbaseBook.receivedAt : null,
        } : null,
        crossExchangeSpreadBps: spreadBps,
        perpSpotPremiumBps: premiumBps,
        perpDepth5: perpDepth ? {
          ageMs: perpDepth.receivedAt ? now - perpDepth.receivedAt : null,
          bids: perpDepth.bids,
          asks: perpDepth.asks,
          bidQtySum,
          askQtySum,
          imbalance: depthImbalance,
        } : null,
        perpTakerFlow: { ...perpSummary, ringSize: perpFlow.length },
        spotTakerFlow: { ...spotSummary, ringSize: spotFlow.length },
        recentLiquidations: liquidations,
      };
    }),

  /**
   * Just the global keys we know about, for ops to confirm everything is wired.
   */
  health: protectedProcedure.query(() => {
    const g = global as any;
    const symbolsIn = (obj: any) => obj && typeof obj === 'object' ? Object.keys(obj) : [];
    return {
      timestamp: Date.now(),
      binanceFuturesBook: symbolsIn(g.__binanceFuturesBook),
      binanceSpotBook: symbolsIn(g.__binanceSpotBook),
      coinbaseTopOfBook: symbolsIn(g.__coinbaseTopOfBook),
      binancePerpDepth5: symbolsIn(g.__binancePerpDepth5),
      binancePerpTakerFlow: symbolsIn(g.__binancePerpTakerFlow).map(s => ({ symbol: s, fills: (g.__binancePerpTakerFlow[s] || []).length })),
      binanceSpotTakerFlow: symbolsIn(g.__binanceSpotTakerFlow).map(s => ({ symbol: s, fills: (g.__binanceSpotTakerFlow[s] || []).length })),
      lastLiquidations: { count: (g.__lastLiquidations || []).length, mostRecentMs: (g.__lastLiquidations || []).slice(-1)[0]?.timestamp || null },
    };
  }),
});
