/**
 * Sensorium — Phase 83
 *
 * The single in-memory store of latest "sensations" from every organ
 * (former-agent) of the system. Sensors push updates asynchronously at
 * their own cadence; the brain reads synchronously on every tick.
 *
 * Design principles:
 *   1. Synchronous reads (no awaits in the hot brain loop)
 *   2. Sensors push at whatever cadence makes sense — slow sensors
 *      (sentiment, news) push every minute; fast sensors (flow, depth)
 *      push every tick. The brain just reads "latest known".
 *   3. Every reading carries staleness_ms so the brain can downweight
 *      stale data gracefully without blocking on a fresh fetch.
 *   4. NO sensor has a vote. They describe what they see. The brain
 *      interprets.
 */

import { getActiveClock } from '../_core/clock';

// ─── Sensor reading shapes ────────────────────────────────────────────

export interface MarketSensation {
  symbol: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  atr14h?: number;       // hourly ATR (~14 candles)
  regime?: 'lowVol' | 'normalVol' | 'highVol' | 'trending_up' | 'trending_down' | 'range_bound' | 'mean_reverting';
  momentum_5s_bpsPerS?: number;
  momentum_30s_bpsPerS?: number;
  lastTickMs: number;
}

export interface TechnicalSensation {
  symbol: string;
  rsi: number;
  macdHist: number;
  bbPctB: number;          // 0..1 position within BB; 0=lower, 1=upper
  emaTrend: 'up' | 'down' | 'flat';
  superTrend: 'bullish' | 'bearish' | 'neutral';
  vwapDevPct: number;      // % deviation of price from VWAP
}

export interface FlowSensation {
  symbol: string;
  takerImbalance5s: number;   // -1..1; +ve = buying pressure
  takerImbalance30s: number;
  depthImbalance5bp: number;  // -1..1
  cvdDelta5m: number;          // raw signed notional
  vwapDistanceBps: number;
}

export interface WhaleSensation {
  symbol: string;
  netExchangeFlow5m: number;  // raw signed USD; +ve = inflow (bearish)
  largeFillsLast30s: number;   // count of >$50k fills
  netLargeImbalance: number;   // -1..1 imbalance on outlier fills
}

export interface DerivSensation {
  symbol: string;
  fundingRate: number | null;  // %
  oiDelta5m: number | null;    // % change in open interest
  liquidationPressure: number | null; // -1..1; +ve = long-liquidation cascade
}

export interface SentimentSensation {
  newsScore: number | null;    // -1..1
  socialScore: number | null;
  fearGreed: number | null;    // 0..100
  macroVetoActive: boolean;    // hard block from macro layer
  macroVetoReason: string | null;
}

export interface PositionSensation {
  positionId: string | number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  unrealizedPnlPercent: number;     // gross
  peakPnlPercent: number;            // historical max
  holdMinutes: number;
  currentStopLoss: number | null;
  currentTakeProfit: number | null;
  ratchetStep: number;               // -1 = no rung; 0..6 = ladder rung
}

export interface StanceSensation {
  symbol: string;
  /** Entry-time direction of the open position (if any). */
  entryDirection: 'bullish' | 'bearish' | null;
  /** Entry-time consensus confidence (0..1). */
  entryConsensus: number | null;
  /** Current consensus direction. */
  currentDirection: 'bullish' | 'bearish' | 'neutral';
  /** Current consensus confidence. */
  currentConsensus: number;
  /** Signed drift since entry: positive = stronger in entry-direction, negative = flipping against. */
  driftFromEntry: number;
  /** Rate of drift over the last minute. */
  driftVelocityPerMin: number;
}

// ─── The store ─────────────────────────────────────────────────────────

interface StoredEntry<T> {
  value: T;
  receivedAtMs: number;
}

class Sensorium {
  private market = new Map<string, StoredEntry<MarketSensation>>();
  private technical = new Map<string, StoredEntry<TechnicalSensation>>();
  private flow = new Map<string, StoredEntry<FlowSensation>>();
  private whale = new Map<string, StoredEntry<WhaleSensation>>();
  private deriv = new Map<string, StoredEntry<DerivSensation>>();
  private sentiment: StoredEntry<SentimentSensation> | null = null; // platform-wide
  private positions = new Map<string | number, StoredEntry<PositionSensation>>();
  private stances = new Map<string, StoredEntry<StanceSensation>>();

  // ─── Push API (sensors call these) ───────────────────────────────────
  updateMarket(s: MarketSensation): void { this.market.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateTechnical(s: TechnicalSensation): void { this.technical.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateFlow(s: FlowSensation): void { this.flow.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateWhale(s: WhaleSensation): void { this.whale.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateDeriv(s: DerivSensation): void { this.deriv.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateSentiment(s: SentimentSensation): void { this.sentiment = { value: s, receivedAtMs: getActiveClock().now() }; }
  updatePosition(s: PositionSensation): void { this.positions.set(s.positionId, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateStance(s: StanceSensation): void { this.stances.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  removePosition(positionId: string | number): void { this.positions.delete(positionId); }

  // ─── Pull API (brain calls these) ────────────────────────────────────
  getMarket(symbol: string): { sensation: MarketSensation; stalenessMs: number } | null {
    const e = this.market.get(symbol);
    if (!e) return null;
    return { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs };
  }
  getTechnical(symbol: string): { sensation: TechnicalSensation; stalenessMs: number } | null {
    const e = this.technical.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getFlow(symbol: string): { sensation: FlowSensation; stalenessMs: number } | null {
    const e = this.flow.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getWhale(symbol: string): { sensation: WhaleSensation; stalenessMs: number } | null {
    const e = this.whale.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getDeriv(symbol: string): { sensation: DerivSensation; stalenessMs: number } | null {
    const e = this.deriv.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getSentiment(): { sensation: SentimentSensation; stalenessMs: number } | null {
    return this.sentiment ? { sensation: this.sentiment.value, stalenessMs: getActiveClock().now() - this.sentiment.receivedAtMs } : null;
  }
  getPosition(positionId: string | number): { sensation: PositionSensation; stalenessMs: number } | null {
    const e = this.positions.get(positionId);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getStance(symbol: string): { sensation: StanceSensation; stalenessMs: number } | null {
    const e = this.stances.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }

  // ─── Snapshot for DecisionTrace (full inputs the brain saw) ──────────
  snapshotForPosition(positionId: string | number): Record<string, unknown> {
    const pos = this.getPosition(positionId);
    if (!pos) return {};
    const symbol = pos.sensation.symbol;
    return {
      market: this.getMarket(symbol)?.sensation ?? null,
      marketStalenessMs: this.getMarket(symbol)?.stalenessMs ?? null,
      technical: this.getTechnical(symbol)?.sensation ?? null,
      technicalStalenessMs: this.getTechnical(symbol)?.stalenessMs ?? null,
      flow: this.getFlow(symbol)?.sensation ?? null,
      flowStalenessMs: this.getFlow(symbol)?.stalenessMs ?? null,
      whale: this.getWhale(symbol)?.sensation ?? null,
      deriv: this.getDeriv(symbol)?.sensation ?? null,
      sentiment: this.getSentiment()?.sensation ?? null,
      position: pos.sensation,
      stance: this.getStance(symbol)?.sensation ?? null,
    };
  }

  // ─── Health summary ──────────────────────────────────────────────────
  health(): {
    market: number;
    technical: number;
    flow: number;
    whale: number;
    deriv: number;
    sentiment: boolean;
    positions: number;
    stances: number;
  } {
    return {
      market: this.market.size,
      technical: this.technical.size,
      flow: this.flow.size,
      whale: this.whale.size,
      deriv: this.deriv.size,
      sentiment: this.sentiment !== null,
      positions: this.positions.size,
      stances: this.stances.size,
    };
  }
}

let _sensorium: Sensorium | null = null;
export function getSensorium(): Sensorium {
  if (!_sensorium) _sensorium = new Sensorium();
  return _sensorium;
}
