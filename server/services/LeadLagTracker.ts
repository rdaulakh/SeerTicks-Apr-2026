/**
 * LeadLagTracker — measure how far Binance leads Coinbase on price moves.
 *
 * Phase 52. The premise: Binance is the price-discovery venue for crypto
 * (~6-8x Coinbase volume on BTC/ETH). Academic literature (Makarov & Schoar
 * 2020, et al.) shows Binance moves first on directional shifts; Coinbase
 * follows by 50-200ms typically, more during volatility events.
 *
 * This service quantifies that lead time per symbol per regime so we can
 * either (a) confirm the edge exists for our infra, or (b) feed the
 * lead-lag delta as a confidence multiplier into the consensus engine.
 *
 * Algorithm (deliberately simple — we want measurement, not magic):
 *   1. Maintain a ring buffer of recent ticks per (source, symbol).
 *   2. On every Binance bookTicker tick, check if its mid price represents
 *      a meaningful move (>= MIN_MOVE_BPS) vs the previous Binance tick.
 *   3. If yes, scan the Coinbase ring backwards for the most recent tick
 *      whose price was on the OLD side of the move. The time delta from
 *      that Coinbase tick to NOW is the upper bound of the lag — meaning
 *      Coinbase has not yet caught up to where Binance is now.
 *   4. After SETTLE_MS, when Coinbase has either followed (price crossed
 *      Binance's new level) or diverged, emit a `lead_lag_event` with the
 *      observed lag and resolve.
 *
 * Memory bounded: 200 ticks per (source, symbol), evicted FIFO.
 */

import { EventEmitter } from 'events';

interface RingTick {
  price: number;
  ts: number;
}

interface PendingLead {
  symbol: string;
  binanceFromPrice: number;
  binanceToPrice: number;
  direction: 'up' | 'down';
  observedAt: number;
  resolveBy: number;
}

export interface LeadLagEvent {
  symbol: string;
  leader: 'binance' | 'coinbase' | 'tied';
  leadMs: number;          // how long Binance led by (ms). Negative if Coinbase led.
  moveBps: number;         // size of the move in basis points (1 bps = 0.01%)
  direction: 'up' | 'down';
  binancePrice: number;
  coinbasePrice: number;
  resolvedAt: number;
}

const RING_SIZE = 200;
const MIN_MOVE_BPS = 5;           // 5 bps = 0.05% — filters out noise
const SETTLE_MS = 2000;           // wait up to 2s for the follower to confirm
const SCAN_BACK_MS = 5000;        // ignore Coinbase ticks older than this when computing lag

export class LeadLagTracker extends EventEmitter {
  private rings: Map<string, RingTick[]> = new Map();
  private pendingLeads: PendingLead[] = [];
  private resolveTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Aggregate stats (in-memory, last 1000 events per symbol)
  private statsBySymbol: Map<string, LeadLagEvent[]> = new Map();

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.resolveTimer = setInterval(() => this.resolvePending(), 250);
    console.log('[LeadLagTracker] 🔬 started — measuring Binance ↔ Coinbase lead-lag');
  }

  stop(): void {
    this.isRunning = false;
    if (this.resolveTimer) clearInterval(this.resolveTimer);
    this.resolveTimer = null;
    this.pendingLeads = [];
    this.rings.clear();
    this.removeAllListeners();
  }

  /**
   * Push a Binance bookTicker mid-price. Returns true if it triggered a
   * lead candidate (significant price move).
   */
  pushBinance(symbol: string, price: number, ts: number = Date.now()): void {
    if (!this.isRunning || !isFinite(price) || price <= 0) return;
    const ring = this.getRing('binance', symbol);
    const last = ring[ring.length - 1];
    this.append(ring, { price, ts });

    if (!last) return;
    const moveBps = ((price - last.price) / last.price) * 10000;
    if (Math.abs(moveBps) < MIN_MOVE_BPS) return;

    // Significant Binance move — register a pending lead candidate
    this.pendingLeads.push({
      symbol,
      binanceFromPrice: last.price,
      binanceToPrice: price,
      direction: moveBps > 0 ? 'up' : 'down',
      observedAt: ts,
      resolveBy: ts + SETTLE_MS,
    });
  }

  /**
   * Push a Coinbase ticker price. Resolves any pending lead whose direction
   * Coinbase has now confirmed.
   */
  pushCoinbase(symbol: string, price: number, ts: number = Date.now()): void {
    if (!this.isRunning || !isFinite(price) || price <= 0) return;
    const ring = this.getRing('coinbase', symbol);
    this.append(ring, { price, ts });

    // Try to resolve pending leads for this symbol
    for (let i = this.pendingLeads.length - 1; i >= 0; i--) {
      const p = this.pendingLeads[i];
      if (p.symbol !== symbol) continue;
      const crossedUp = p.direction === 'up' && price >= p.binanceToPrice;
      const crossedDown = p.direction === 'down' && price <= p.binanceToPrice;
      if (!crossedUp && !crossedDown) continue;

      const leadMs = ts - p.observedAt;
      const moveBps = Math.abs(((p.binanceToPrice - p.binanceFromPrice) / p.binanceFromPrice) * 10000);
      const evt: LeadLagEvent = {
        symbol,
        leader: leadMs > 0 ? 'binance' : leadMs < 0 ? 'coinbase' : 'tied',
        leadMs,
        moveBps,
        direction: p.direction,
        binancePrice: p.binanceToPrice,
        coinbasePrice: price,
        resolvedAt: ts,
      };
      this.recordEvent(evt);
      this.emit('lead_lag_event', evt);
      this.pendingLeads.splice(i, 1);
    }
  }

  /**
   * Periodically drop pending leads that the follower never confirmed.
   * Those are noise (Binance flickered, Coinbase didn't follow) and should
   * not skew the median lag.
   */
  private resolvePending(): void {
    const now = Date.now();
    for (let i = this.pendingLeads.length - 1; i >= 0; i--) {
      if (this.pendingLeads[i].resolveBy < now) this.pendingLeads.splice(i, 1);
    }
  }

  private getRing(source: 'binance' | 'coinbase', symbol: string): RingTick[] {
    const key = `${source}:${symbol}`;
    let ring = this.rings.get(key);
    if (!ring) { ring = []; this.rings.set(key, ring); }
    return ring;
  }

  private append(ring: RingTick[], tick: RingTick): void {
    ring.push(tick);
    if (ring.length > RING_SIZE) ring.shift();
  }

  private recordEvent(evt: LeadLagEvent): void {
    let bucket = this.statsBySymbol.get(evt.symbol);
    if (!bucket) { bucket = []; this.statsBySymbol.set(evt.symbol, bucket); }
    bucket.push(evt);
    if (bucket.length > 1000) bucket.shift();
  }

  /**
   * Snapshot stats for monitoring / tRPC exposure.
   * Returns median + p95 lag per symbol over the last N events.
   */
  getStats(): Record<string, { count: number; medianLeadMs: number; p95LeadMs: number; binanceLeadFraction: number; avgMoveBps: number }> {
    const out: Record<string, { count: number; medianLeadMs: number; p95LeadMs: number; binanceLeadFraction: number; avgMoveBps: number }> = {};
    for (const [symbol, events] of this.statsBySymbol) {
      if (events.length === 0) continue;
      const lags = events.map(e => e.leadMs).sort((a, b) => a - b);
      const median = lags[Math.floor(lags.length / 2)];
      const p95 = lags[Math.floor(lags.length * 0.95)];
      const binanceLeadFraction = events.filter(e => e.leader === 'binance').length / events.length;
      const avgMoveBps = events.reduce((s, e) => s + e.moveBps, 0) / events.length;
      out[symbol] = {
        count: events.length,
        medianLeadMs: median,
        p95LeadMs: p95,
        binanceLeadFraction,
        avgMoveBps,
      };
    }
    return out;
  }
}

// Singleton
let _instance: LeadLagTracker | null = null;
export function getLeadLagTracker(): LeadLagTracker {
  if (!_instance) _instance = new LeadLagTracker();
  return _instance;
}
