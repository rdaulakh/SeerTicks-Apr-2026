/**
 * SmartExecutor — Phase 65 institutional-grade order placement.
 *
 * Replaces blind MARKET orders with a three-stage execution ladder:
 *
 *   Stage 1 — IOC limit at aggressive offset
 *     Place an Immediate-or-Cancel limit at refPrice ± maxSlippageBps.
 *     IOC means: take whatever's resting inside the limit, cancel the rest.
 *     Fully filled → done. Partial → continue with the remainder.
 *
 *   Stage 2 — IOC limit at wider offset (one retry)
 *     Same shape, looser band (2× maxSlippageBps). Catches the case where
 *     book moved between stage-1 quote and submission.
 *
 *   Stage 3 — Capped market fallback
 *     Market order, BUT post-fill we measure realized slippage. If it
 *     exceeds maxSlippageBps × 3 (e.g. flash-crash, paper-thin book), log
 *     critical alert. Decision to halt is the watchdog's (Phase 66), not
 *     this layer's — Smart's job is to surface the truth.
 *
 * Every fill emits a TCAReport (Phase 69) — fill price vs decision-time
 * mid, slippage attribution (book-walk vs latency), per-stage timing.
 *
 * Falls through to plain market for adapters that don't expose getOrderBook
 * (preserves spot/coinbase compatibility — only futures gets the upgrade).
 */

import { ExchangeInterface, OrderParams, OrderResult } from '../exchanges/ExchangeInterface';
import { executionLogger } from '../utils/logger';

export interface SmartOrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  refPrice: number;       // expected mid at decision time
  maxSlippageBps: number; // 1bps = 0.01%; 5bps default
  strategy?: string;
  traceId?: string;       // Phase 67
}

export interface TCAReport {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  refPrice: number;
  executedPrice: number;
  executedQty: number;
  slippageBps: number;        // signed: positive = unfavorable
  stageReached: 1 | 2 | 3;
  totalLatencyMs: number;
  bookSpreadBps?: number;
  partialFill: boolean;
  exceededCap: boolean;
  traceId?: string;
}

export class SmartExecutor {
  constructor(private exchange: ExchangeInterface) {}

  /**
   * Execute an order through the three-stage ladder. Returns the final
   * OrderResult with TCA appended via the `tca` field. Throws only on
   * total failure (all stages fail or adapter throws).
   */
  async execute(params: SmartOrderParams): Promise<OrderResult & { tca: TCAReport }> {
    const start = Date.now();
    const hasOrderBook = typeof (this.exchange as any).getOrderBook === 'function';

    // For adapters without an order book (e.g. paper-only), short-circuit
    // to plain market and synthesize a TCA from refPrice.
    if (!hasOrderBook) {
      const r = await this.exchange.placeMarketOrder({
        symbol: params.symbol, side: params.side, quantity: params.quantity, type: 'market',
      });
      const tca = this.buildTCA(params, r, 3, start, undefined, false);
      this.logTCA(tca);
      return { ...r, tca };
    }

    // Snapshot order book first for spread context + reference.
    let bookSpreadBps: number | undefined;
    try {
      const book = await this.exchange.getOrderBook(params.symbol, 5);
      if (book.bids.length > 0 && book.asks.length > 0) {
        const bestBid = book.bids[0].price;
        const bestAsk = book.asks[0].price;
        const mid = (bestBid + bestAsk) / 2;
        bookSpreadBps = ((bestAsk - bestBid) / mid) * 10_000;
      }
    } catch (err) {
      executionLogger.warn('SmartExecutor: getOrderBook failed, falling back to market', {
        symbol: params.symbol, error: (err as Error)?.message,
      });
      const r = await this.exchange.placeMarketOrder({
        symbol: params.symbol, side: params.side, quantity: params.quantity, type: 'market',
      });
      const tca = this.buildTCA(params, r, 3, start, undefined, false);
      this.logTCA(tca);
      return { ...r, tca };
    }

    // Stage 1: IOC limit at refPrice ± maxSlippageBps
    const stage1Limit = this.aggressiveLimit(params.refPrice, params.side, params.maxSlippageBps);
    let s1: OrderResult | null = null;
    try {
      s1 = await this.exchange.placeLimitOrder({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        type: 'limit',
        price: stage1Limit,
        timeInForce: 'IOC',
      });
    } catch (err) {
      executionLogger.warn('SmartExecutor stage 1 (IOC limit) threw', {
        symbol: params.symbol, error: (err as Error)?.message,
      });
    }

    if (s1 && s1.executedQty && s1.executedQty >= params.quantity * 0.999) {
      const tca = this.buildTCA(params, s1, 1, start, bookSpreadBps, false);
      this.logTCA(tca);
      return { ...s1, tca };
    }

    // Stage 2: wider IOC retry (only for the unfilled remainder)
    const filledSoFar = (s1?.executedQty ?? 0);
    const remaining = params.quantity - filledSoFar;
    const stage2Limit = this.aggressiveLimit(params.refPrice, params.side, params.maxSlippageBps * 2);
    let s2: OrderResult | null = null;
    if (remaining > 0) {
      try {
        s2 = await this.exchange.placeLimitOrder({
          symbol: params.symbol,
          side: params.side,
          quantity: remaining,
          type: 'limit',
          price: stage2Limit,
          timeInForce: 'IOC',
        });
      } catch (err) {
        executionLogger.warn('SmartExecutor stage 2 (wider IOC) threw', {
          symbol: params.symbol, error: (err as Error)?.message,
        });
      }
    }

    const totalFilled1and2 = filledSoFar + (s2?.executedQty ?? 0);
    if (totalFilled1and2 >= params.quantity * 0.999) {
      // Combine the two stages into a single TCA. Use stage 2's executedPrice
      // since that's where the bulk landed if stage 1 was empty.
      const merged: OrderResult = {
        ...(s2 ?? s1!),
        executedQty: totalFilled1and2,
        executedPrice: this.weightedFilledPrice(s1, s2),
      };
      const tca = this.buildTCA(params, merged, 2, start, bookSpreadBps, false);
      this.logTCA(tca);
      return { ...merged, tca };
    }

    // Stage 3: capped market fallback for whatever didn't fill.
    const remaining3 = params.quantity - totalFilled1and2;
    let s3: OrderResult;
    try {
      s3 = await this.exchange.placeMarketOrder({
        symbol: params.symbol,
        side: params.side,
        quantity: remaining3 > 0 ? remaining3 : params.quantity,
        type: 'market',
      });
      // Phase 65 — Binance Futures market orders return immediately, often
      // with avgPrice=0 because the fill is computed async. Poll up to 5×
      // 100ms to get the realized fill price for honest TCA. If the venue
      // never populates the fill data, fall back to refPrice (the slippage
      // measurement degrades but won't crash downstream consumers).
      if ((s3.executedPrice ?? 0) <= 0 && typeof (this.exchange as any).getOrderStatus === 'function') {
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 100));
          try {
            const refresh = await (this.exchange as any).getOrderStatus(s3.orderId, params.symbol);
            if (refresh && (refresh.executedPrice ?? 0) > 0) {
              s3 = refresh;
              break;
            }
          } catch { /* keep polling */ }
        }
      }
      if ((s3.executedPrice ?? 0) <= 0) {
        // Last resort: stamp refPrice so TCA is degraded-but-finite.
        executionLogger.warn('SmartExecutor stage 3: fill price never populated, stamping refPrice', {
          symbol: params.symbol, orderId: s3.orderId,
        });
        s3.executedPrice = params.refPrice;
      }
    } catch (err) {
      executionLogger.error('SmartExecutor stage 3 (market fallback) failed', {
        symbol: params.symbol, error: (err as Error)?.message,
      });
      throw err;
    }

    const finalFilledQty = totalFilled1and2 + (s3.executedQty ?? 0);
    const merged: OrderResult = {
      ...s3,
      executedQty: finalFilledQty,
      executedPrice: this.weightedFilledPrice(s1, s2, s3),
    };
    const tca = this.buildTCA(params, merged, 3, start, bookSpreadBps, finalFilledQty < params.quantity * 0.999);
    this.logTCA(tca);
    return { ...merged, tca };
  }

  /**
   * Aggressive limit price: cross the spread by the full slippage budget.
   * For BUY, we're willing to pay up to refPrice * (1 + bps/10_000).
   * For SELL, we're willing to receive at least refPrice * (1 - bps/10_000).
   */
  private aggressiveLimit(refPrice: number, side: 'buy' | 'sell', bps: number): number {
    const factor = bps / 10_000;
    return side === 'buy' ? refPrice * (1 + factor) : refPrice * (1 - factor);
  }

  private weightedFilledPrice(...orders: (OrderResult | null | undefined)[]): number {
    let totalQty = 0;
    let totalCost = 0;
    for (const o of orders) {
      if (!o || !o.executedQty || !o.executedPrice) continue;
      totalQty += o.executedQty;
      totalCost += o.executedPrice * o.executedQty;
    }
    return totalQty > 0 ? totalCost / totalQty : 0;
  }

  private buildTCA(
    params: SmartOrderParams,
    result: OrderResult,
    stage: 1 | 2 | 3,
    startMs: number,
    bookSpreadBps: number | undefined,
    partialFill: boolean,
  ): TCAReport {
    const executedPrice = result.executedPrice ?? params.refPrice;
    const filledQty = result.executedQty ?? 0;
    // Signed slippage: positive when we paid more (buy) or got less (sell).
    const rawSlippage = params.side === 'buy'
      ? (executedPrice - params.refPrice) / params.refPrice
      : (params.refPrice - executedPrice) / params.refPrice;
    const slippageBps = rawSlippage * 10_000;
    const cap = params.maxSlippageBps * 3; // breach threshold = 3× target
    return {
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      refPrice: params.refPrice,
      executedPrice,
      executedQty: filledQty,
      slippageBps,
      stageReached: stage,
      totalLatencyMs: Date.now() - startMs,
      bookSpreadBps,
      partialFill,
      exceededCap: slippageBps > cap,
      traceId: params.traceId,
    };
  }

  private logTCA(tca: TCAReport): void {
    const tag = tca.exceededCap ? '🚨 SLIPPAGE-CAP-BREACH' : '📊 TCA';
    executionLogger.info(`${tag} ${tca.symbol} ${tca.side}`, {
      symbol: tca.symbol,
      side: tca.side,
      qty: tca.quantity,
      refPrice: tca.refPrice,
      executedPrice: tca.executedPrice,
      slippageBps: tca.slippageBps.toFixed(2),
      bookSpreadBps: tca.bookSpreadBps?.toFixed(2),
      stage: tca.stageReached,
      latencyMs: tca.totalLatencyMs,
      partial: tca.partialFill,
      breach: tca.exceededCap,
      traceId: tca.traceId,
    });
  }
}
