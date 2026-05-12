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

// ─── Phase 85 — Full agent-votes sensation ───────────────────────────────
// One slot that carries the latest vote from EVERY registered agent for each
// symbol. The Opportunity sensor reads this to count true 33-agent confluence
// instead of the 3-sensor approximation we shipped in Phase 84.
export interface AgentVote {
  agentName: string;
  /** 'bullish' | 'bearish' | 'neutral' — Phase 40 standard. */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** 0.05..0.20 Phase-40 confidence band; some agents emit 0..1 — caller normalizes. */
  confidence: number;
  /** When the brain reads this, how stale is it (ms)? */
  ageMs: number;
  /** If the agent fired a hard veto (DeterministicFallback / MacroVeto). */
  vetoActive?: boolean;
  vetoReason?: string;
}
export interface AgentVotesSensation {
  symbol: string;
  votes: AgentVote[];
  /** Aggregate counts at synthesis time. */
  longCount: number;
  shortCount: number;
  neutralCount: number;
  /** True if any agent is firing a hard veto right now. */
  anyVetoActive: boolean;
  vetoReasons: string[];
}

// ─── Phase 84 — Entry brain sensation ────────────────────────────────────
// Per-symbol opportunity reading the brain uses to decide whether to OPEN a
// new position. Synthesized from the agent sensations + consensus + market
// regime. The brain's SHOULD_ENTER pipeline step reads this when no
// position exists for the symbol.
export interface OpportunitySensation {
  symbol: string;
  /** Synthesized 0..1 score for entering this symbol. */
  score: number;
  /** Direction the score favors. */
  direction: 'long' | 'short' | 'abstain';
  /** Number of sensors actively voting in favor of `direction`. */
  confluenceCount: number;
  /** Total reporting sensors at the time of synthesis. */
  totalSensors: number;
  /** Bayesian posterior mean (if available from consensus aggregator). */
  posteriorMean?: number;
  /** Bayesian posterior std (if available). */
  posteriorStd?: number;
  /** Window of stale-data flags — true if any critical sensor is stale. */
  criticalDataStale: boolean;
}

// ─── Phase 84 — Portfolio sensation ──────────────────────────────────────
// Account-level risk state. The brain's PORTFOLIO_GUARD pipeline step (the
// pre-step that runs BEFORE step 1) reads this. If any limit is breached
// the brain BLOCKS new entries and may ACCELERATE exits on losers.
export interface PortfolioSensation {
  /** Total wallet equity (USD). */
  equity: number;
  /** Realized P&L since UTC midnight. */
  dailyRealizedPnl: number;
  /** Realized + unrealized since UTC midnight, as % of equity. */
  dailyPnlPercent: number;
  /** Number of open positions right now. */
  openPositionCount: number;
  /** Computed portfolio VaR (95%) as % of equity. */
  portfolioVarPercent: number;
  /** Daily loss circuit breaker tripped? */
  dailyLossCircuitTripped: boolean;
  /** Hard configured limits the brain must respect. */
  limits: {
    maxDailyLossPercent: number;
    maxPortfolioVarPercent: number;
    maxOpenPositions: number;
  };
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
  // Phase 84 — entry brain inputs
  private opportunities = new Map<string, StoredEntry<OpportunitySensation>>();
  private portfolio: StoredEntry<PortfolioSensation> | null = null;
  // Phase 85 — full 33-agent vote tally per symbol
  private agentVotes = new Map<string, StoredEntry<AgentVotesSensation>>();

  // ─── Push API (sensors call these) ───────────────────────────────────
  updateMarket(s: MarketSensation): void { this.market.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateTechnical(s: TechnicalSensation): void { this.technical.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateFlow(s: FlowSensation): void { this.flow.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateWhale(s: WhaleSensation): void { this.whale.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateDeriv(s: DerivSensation): void { this.deriv.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateSentiment(s: SentimentSensation): void { this.sentiment = { value: s, receivedAtMs: getActiveClock().now() }; }
  updatePosition(s: PositionSensation): void { this.positions.set(s.positionId, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateStance(s: StanceSensation): void { this.stances.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updateOpportunity(s: OpportunitySensation): void { this.opportunities.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
  updatePortfolio(s: PortfolioSensation): void { this.portfolio = { value: s, receivedAtMs: getActiveClock().now() }; }
  updateAgentVotes(s: AgentVotesSensation): void { this.agentVotes.set(s.symbol, { value: s, receivedAtMs: getActiveClock().now() }); }
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
  getOpportunity(symbol: string): { sensation: OpportunitySensation; stalenessMs: number } | null {
    const e = this.opportunities.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  getAllOpportunities(): OpportunitySensation[] {
    return Array.from(this.opportunities.values()).map(e => e.value);
  }
  getPortfolio(): { sensation: PortfolioSensation; stalenessMs: number } | null {
    return this.portfolio ? { sensation: this.portfolio.value, stalenessMs: getActiveClock().now() - this.portfolio.receivedAtMs } : null;
  }
  getAgentVotes(symbol: string): { sensation: AgentVotesSensation; stalenessMs: number } | null {
    const e = this.agentVotes.get(symbol);
    return e ? { sensation: e.value, stalenessMs: getActiveClock().now() - e.receivedAtMs } : null;
  }
  /** Enumerate active position IDs without exposing the internal map. */
  getActivePositionIds(): Array<string | number> {
    return Array.from(this.positions.keys());
  }
  /** Enumerate symbols WITHOUT an open position (entry candidates). */
  getSymbolsWithoutPosition(allSymbols: string[]): string[] {
    const occupied = new Set<string>();
    for (const e of this.positions.values()) occupied.add(e.value.symbol);
    return allSymbols.filter(s => !occupied.has(s));
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
      // Phase 85 — full 33-agent vote tally
      agentVotes: this.getAgentVotes(symbol)?.sensation ?? null,
      opportunity: this.getOpportunity(symbol)?.sensation ?? null,
      portfolio: this.getPortfolio()?.sensation ?? null,
    };
  }

  // ─── Phase 85 — Snapshot for entry-side decisions (no position yet) ──
  snapshotForEntry(symbol: string): Record<string, unknown> {
    return {
      market: this.getMarket(symbol)?.sensation ?? null,
      technical: this.getTechnical(symbol)?.sensation ?? null,
      flow: this.getFlow(symbol)?.sensation ?? null,
      whale: this.getWhale(symbol)?.sensation ?? null,
      deriv: this.getDeriv(symbol)?.sensation ?? null,
      sentiment: this.getSentiment()?.sensation ?? null,
      stance: this.getStance(symbol)?.sensation ?? null,
      opportunity: this.getOpportunity(symbol)?.sensation ?? null,
      agentVotes: this.getAgentVotes(symbol)?.sensation ?? null,
      portfolio: this.getPortfolio()?.sensation ?? null,
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
    agentVotes: number;
    opportunities: number;
    portfolio: boolean;
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
      agentVotes: this.agentVotes.size,
      opportunities: this.opportunities.size,
      portfolio: this.portfolio !== null,
    };
  }
}

let _sensorium: Sensorium | null = null;
export function getSensorium(): Sensorium {
  if (!_sensorium) _sensorium = new Sensorium();
  return _sensorium;
}
