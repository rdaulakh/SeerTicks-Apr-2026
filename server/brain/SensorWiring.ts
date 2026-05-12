/**
 * SensorWiring — Phase 83
 *
 * Subscribes Sensorium to the live signals/state emitted by the existing
 * services. In v1 we wire 4 sensors directly + an optional 5th for stance.
 *
 *   1. TechnicalSensor   ← reads `agentSignals` table for TechnicalAnalyst's
 *      latest evidence (rsi / macd / bb / supertrend / vwap) per symbol.
 *   2. FlowSensor        ← reads OrderFlowAnalyst's latest evidence.
 *   3. PositionSensor    ← reads IntelligentExitManager's in-memory positions
 *      every brain tick (peak_pnl, ratchet_step, hold_min are tracked there).
 *   4. StanceSensor      ← reads AutomatedSignalProcessor's consensus cache
 *      (per-symbol direction + strength) plus the position's entry-time
 *      consensus snapshot.
 *
 * The other organs (whale, deriv, sentiment, market) will be wired in
 * subsequent phases; the brain reads them gracefully via null-checks today.
 *
 * Sensors push at their own cadence. For TechnicalSensor + FlowSensor we
 * poll the latest `agentSignals` row every 5s. For PositionSensor +
 * StanceSensor we drive on every brain tick (1Hz) since they're in-memory.
 */

import { getSensorium, type TechnicalSensation, type FlowSensation, type PositionSensation, type StanceSensation, type MarketSensation, type OpportunitySensation, type PortfolioSensation, type WhaleSensation, type DerivSensation, type SentimentSensation, type AgentVotesSensation, type AgentVote, type AlphaSensation } from './Sensorium';
import { engineLogger as logger } from '../utils/logger';

// Phase 85 — every agent the platform registers writes to `agentSignals`.
// SensorWiring routes ALL of them into the brain's Sensorium so the brain
// hears all 33 voices, not just 2. Categorized for routing to typed
// sensation slots (whale/deriv/sentiment) AND aggregated into AgentVotes
// for full confluence counting.
const ALL_AGENTS = [
  // Core technical / flow (already feed dedicated sensation slots)
  'TechnicalAnalyst', 'OrderFlowAnalyst', 'PatternMatcher',
  // Whale tracking
  'WhaleTransactionAnalyst', 'WhaleWallAgent',
  // Derivatives / futures
  'FundingRateAnalyst', 'FundingRateFlipAgent', 'OpenInterestDeltaAgent',
  'PerpSpotPremiumAgent', 'PerpDepthImbalanceAgent', 'PerpTakerFlowAgent',
  'SpotTakerFlowAgent', 'LiquidationHeatmap',
  // Volume / structure
  'VolumeProfileAnalyzer', 'VWAPDivergenceAgent', 'OrderbookImbalanceAgent',
  // Microstructure
  'TradeBurstAgent', 'TradeSizeOutlierAgent', 'SpreadCompressionAgent',
  'LiquidityVacuumAgent', 'VelocityAgent', 'PriceImpactAgent',
  'CVDDivergenceAgent', 'StopHuntAgent',
  // Cross-market
  'LeadLagAgent', 'CorrelationBreakAgent', 'ForexCorrelationAgent',
  'CrossExchangeSpreadAgent', 'MultiTFConvergenceAgent',
  // Slow / fundamental
  'SentimentAnalyst', 'NewsAnalyst', 'MacroAnalyst',
  // Veto / safety
  'DeterministicFallback',
];

// Tag-set per category — used to route a single signal to its sensation slot.
const DERIV_AGENTS = new Set(['FundingRateAnalyst', 'FundingRateFlipAgent', 'OpenInterestDeltaAgent', 'PerpSpotPremiumAgent', 'PerpDepthImbalanceAgent', 'PerpTakerFlowAgent', 'LiquidationHeatmap']);
const WHALE_AGENTS = new Set(['WhaleTransactionAnalyst', 'WhaleWallAgent']);
const SENTIMENT_AGENTS = new Set(['SentimentAnalyst', 'NewsAnalyst', 'MacroAnalyst']);
const VETO_AGENTS = new Set(['DeterministicFallback', 'MacroAnalyst']);

/* eslint-disable @typescript-eslint/no-explicit-any */

let started = false;
let intervalIds: NodeJS.Timeout[] = [];

export function startSensorWiring(): void {
  if (started) return;
  started = true;

  // ─── ALL 33 agents: pull from latest agentSignals every 3s ──────────
  // Phase 85 — was 2-agent narrow read; now reads every voice and routes
  // each signal to its sensation slot AND into the AgentVotes tally.
  intervalIds.push(setInterval(() => {
    pullAllAgentSignals().catch(err => {
      logger.warn('[SensorWiring] all-agent pull failed', { error: err?.message });
    });
  }, 3000));

  // ─── Position + Stance: every 1s, read live IEM map + consensus cache ──
  intervalIds.push(setInterval(() => {
    pullPositionAndStanceSensors().catch(err => {
      logger.warn('[SensorWiring] position/stance pull failed', { error: err?.message });
    });
  }, 1000));

  // ─── Market: every 1s, read from PriceFabric / globals ────────────────
  intervalIds.push(setInterval(() => {
    pullMarketSensor().catch(err => {
      logger.warn('[SensorWiring] market pull failed', { error: err?.message });
    });
  }, 1000));

  // ─── Opportunity: every 3s, synthesize from agent sensations ──────────
  intervalIds.push(setInterval(() => {
    pullOpportunitySensor().catch(err => {
      logger.warn('[SensorWiring] opportunity pull failed', { error: err?.message });
    });
  }, 3000));

  // ─── Portfolio: every 5s, read wallet + position state from DB ────────
  intervalIds.push(setInterval(() => {
    pullPortfolioSensor().catch(err => {
      logger.warn('[SensorWiring] portfolio pull failed', { error: err?.message });
    });
  }, 5000));

  // ─── Alpha library: every 60s, read winningPatterns summary per symbol ─
  // Patterns change slowly (one trade close per minute at most updates the
  // table). 60s refresh is plenty; brain reads from the cached sensation
  // synchronously on every tick.
  intervalIds.push(setInterval(() => {
    pullAlphaSensor().catch(err => {
      logger.warn('[SensorWiring] alpha pull failed', { error: err?.message });
    });
  }, 60_000));
  // Also fire once immediately at startup so the brain doesn't wait 60s.
  pullAlphaSensor().catch(() => { /* boot — sensors may not be ready */ });

  logger.info('[SensorWiring] started — Phase 85: all-agent fan-in (' + ALL_AGENTS.length + ' agents) + 5 derived sensors');
}

export function stopSensorWiring(): void {
  for (const id of intervalIds) clearInterval(id);
  intervalIds = [];
  started = false;
}

// ──────────────────────────────────────────────────────────────────────
// Sensor implementations
// ──────────────────────────────────────────────────────────────────────

// Normalize a raw signal's direction to the brain's vote shape.
function normalizeDirection(sd: any): 'bullish' | 'bearish' | 'neutral' {
  const d = sd?.signal ?? sd?.direction ?? '';
  if (d === 'bullish' || d === 'long') return 'bullish';
  if (d === 'bearish' || d === 'short') return 'bearish';
  return 'neutral';
}

// Phase 85 — fan-in EVERY agent's latest signal per symbol.
//   - Route TechnicalAnalyst → TechnicalSensation (unchanged shape)
//   - Route OrderFlowAnalyst → FlowSensation (unchanged shape)
//   - Route deriv-cluster agents → DerivSensation (aggregated)
//   - Route whale-cluster agents → WhaleSensation (aggregated)
//   - Route sentiment-cluster agents → SentimentSensation (aggregated)
//   - ALWAYS append the vote to AgentVotesSensation per symbol
//
// The brain reads AgentVotes for true 33-agent confluence counting; reads
// typed sensations (technical/flow/whale/deriv/sentiment) for evidence-rich
// reasoning in specific pipeline steps.
async function pullAllAgentSignals(): Promise<void> {
  const { getDb } = await import('../db');
  const { agentSignals } = await import('../../drizzle/schema');
  const { and, desc, gte, inArray } = await import('drizzle-orm');
  const db = await getDb();
  if (!db) return;

  const sensorium = getSensorium();
  // Window: 90s gives slow agents (sentiment/news/macro refresh every 60s) a
  // chance to be heard; fast agents will always have multiple rows here.
  const since = new Date(Date.now() - 90_000);

  const rows = await db
    .select({
      agentName: agentSignals.agentName,
      signalData: agentSignals.signalData,
      timestamp: agentSignals.timestamp,
    })
    .from(agentSignals)
    .where(and(
      gte(agentSignals.timestamp, since),
      inArray(agentSignals.agentName, ALL_AGENTS),
    ))
    .orderBy(desc(agentSignals.timestamp))
    .limit(4000); // 33 agents × ~5 syms × ~24 ticks/90s = ~4k upper bound

  // Deduplicate: keep newest per (agentName, symbol).
  const newest = new Map<string, { sd: any; ts: number }>();
  for (const r of rows) {
    const sd = r.signalData as any;
    const symbol = sd?.symbol;
    if (!symbol) continue;
    const key = `${r.agentName}:${symbol}`;
    if (!newest.has(key)) newest.set(key, { sd, ts: new Date(r.timestamp as any).getTime() });
  }

  // ─── Pass 1: route to typed sensations (technical/flow) ─────────────
  // ─── Pass 2: aggregate cluster agents into whale/deriv/sentiment ────
  // ─── Pass 3: build AgentVotesSensation per symbol ───────────────────

  const whaleAgg = new Map<string, { netUsd: number; large30s: number; imbalance: number; n: number }>();
  const derivAgg = new Map<string, { funding: number | null; oi: number | null; liq: number | null; nF: number; nO: number; nL: number }>();
  const sentimentAgg = { news: 0, social: 0, fg: 0, vetoActive: false, vetoReason: '' as string | null, n: 0 };
  const votesBySymbol = new Map<string, AgentVote[]>();
  const vetoesBySymbol = new Map<string, string[]>();

  const now = Date.now();
  for (const [key, { sd, ts }] of newest) {
    const [agentName, symbol] = key.split(':');
    const ev = sd?.evidence ?? {};
    const ageMs = now - ts;

    // ─── Typed: TechnicalAnalyst ─────────────────────────────────────
    if (agentName === 'TechnicalAnalyst') {
      const sensation: TechnicalSensation = {
        symbol,
        rsi: typeof ev.rsi === 'number' ? ev.rsi : 50,
        macdHist: typeof ev.macd?.histogram === 'number' ? ev.macd.histogram : 0,
        bbPctB: typeof ev.bbPctB === 'number' ? ev.bbPctB : 0.5,
        emaTrend: ev.ema?.trend ?? 'flat',
        superTrend: ev.superTrend?.direction ?? 'neutral',
        vwapDevPct: typeof ev.vwapDeviation === 'number' ? ev.vwapDeviation : 0,
      };
      sensorium.updateTechnical(sensation);
    }

    // ─── Typed: OrderFlowAnalyst ─────────────────────────────────────
    if (agentName === 'OrderFlowAnalyst') {
      const sensation: FlowSensation = {
        symbol,
        takerImbalance5s: typeof ev.compositeScore === 'number' ? ev.compositeScore / 100 : 0,
        takerImbalance30s: typeof ev.cvdDelta === 'number' ? Math.tanh(ev.cvdDelta / 1e6) : 0,
        depthImbalance5bp: typeof ev.depthImbalance === 'number' ? ev.depthImbalance : 0,
        cvdDelta5m: typeof ev.cvdDelta === 'number' ? ev.cvdDelta : 0,
        vwapDistanceBps: typeof ev.vwapDistance === 'number' ? ev.vwapDistance * 100 : 0,
      };
      sensorium.updateFlow(sensation);
    }

    // ─── Aggregated: whale cluster ───────────────────────────────────
    if (WHALE_AGENTS.has(agentName)) {
      const acc = whaleAgg.get(symbol) ?? { netUsd: 0, large30s: 0, imbalance: 0, n: 0 };
      if (typeof ev.netExchangeFlow === 'number') acc.netUsd += ev.netExchangeFlow;
      if (typeof ev.netFlowUsd === 'number') acc.netUsd += ev.netFlowUsd;
      if (typeof ev.largeFills === 'number') acc.large30s += ev.largeFills;
      if (typeof ev.imbalance === 'number') acc.imbalance += ev.imbalance;
      acc.n += 1;
      whaleAgg.set(symbol, acc);
    }

    // ─── Aggregated: deriv cluster ───────────────────────────────────
    if (DERIV_AGENTS.has(agentName)) {
      const acc = derivAgg.get(symbol) ?? { funding: null, oi: null, liq: null, nF: 0, nO: 0, nL: 0 };
      if (typeof ev.fundingRate === 'number') { acc.funding = (acc.funding ?? 0) + ev.fundingRate; acc.nF++; }
      if (typeof ev.fundingRatePct === 'number') { acc.funding = (acc.funding ?? 0) + ev.fundingRatePct; acc.nF++; }
      if (typeof ev.oiDelta === 'number') { acc.oi = (acc.oi ?? 0) + ev.oiDelta; acc.nO++; }
      if (typeof ev.oiDeltaPct === 'number') { acc.oi = (acc.oi ?? 0) + ev.oiDeltaPct; acc.nO++; }
      if (agentName === 'LiquidationHeatmap') {
        const norm = normalizeDirection(sd);
        const pressure = norm === 'bullish' ? +1 : norm === 'bearish' ? -1 : 0;
        acc.liq = (acc.liq ?? 0) + pressure * (sd?.confidence ?? 0.1) * 5; // -1..1 scale
        acc.nL++;
      }
      derivAgg.set(symbol, acc);
    }

    // ─── Aggregated: sentiment cluster (platform-wide, not per-symbol) ─
    if (SENTIMENT_AGENTS.has(agentName)) {
      const dir = normalizeDirection(sd);
      const sgn = dir === 'bullish' ? 1 : dir === 'bearish' ? -1 : 0;
      const w = typeof sd?.confidence === 'number' ? sd.confidence : 0.1;
      if (agentName === 'NewsAnalyst') sentimentAgg.news += sgn * w;
      else if (agentName === 'SentimentAnalyst') sentimentAgg.social += sgn * w;
      else if (agentName === 'MacroAnalyst') {
        sentimentAgg.fg += sgn * w;
        // MacroAnalyst now emits veto in evidence when macro window is active.
        if (ev?.vetoActive === true || ev?.macroVetoActive === true) {
          sentimentAgg.vetoActive = true;
          sentimentAgg.vetoReason = (ev.vetoReason ?? sd?.reasoning ?? 'macro-event-window');
        }
      }
      sentimentAgg.n++;
    }

    // ─── Veto detection (DeterministicFallback OR MacroAnalyst veto) ──
    if (VETO_AGENTS.has(agentName)) {
      if (ev?.vetoActive === true || ev?.macroVetoActive === true || sd?.signal === 'veto') {
        const arr = vetoesBySymbol.get(symbol) ?? [];
        arr.push(`${agentName}: ${ev?.vetoReason ?? sd?.reasoning ?? 'active'}`.slice(0, 120));
        vetoesBySymbol.set(symbol, arr);
      }
    }

    // ─── Build vote (every agent contributes) ─────────────────────────
    const vote: AgentVote = {
      agentName,
      direction: normalizeDirection(sd),
      confidence: typeof sd?.confidence === 'number' ? sd.confidence : 0.1,
      ageMs,
      vetoActive: ev?.vetoActive === true || sd?.signal === 'veto',
      vetoReason: ev?.vetoReason ?? undefined,
    };
    const arr = votesBySymbol.get(symbol) ?? [];
    arr.push(vote);
    votesBySymbol.set(symbol, arr);
  }

  // ─── Push aggregated whale sensations ────────────────────────────────
  for (const [symbol, w] of whaleAgg) {
    const sensation: WhaleSensation = {
      symbol,
      netExchangeFlow5m: w.netUsd,
      largeFillsLast30s: w.large30s,
      netLargeImbalance: w.n > 0 ? Math.max(-1, Math.min(1, w.imbalance / w.n)) : 0,
    };
    sensorium.updateWhale(sensation);
  }

  // ─── Push aggregated deriv sensations ────────────────────────────────
  for (const [symbol, d] of derivAgg) {
    const sensation: DerivSensation = {
      symbol,
      fundingRate: d.nF > 0 ? (d.funding ?? 0) / d.nF : null,
      oiDelta5m: d.nO > 0 ? (d.oi ?? 0) / d.nO : null,
      liquidationPressure: d.nL > 0 ? Math.max(-1, Math.min(1, (d.liq ?? 0) / d.nL)) : null,
    };
    sensorium.updateDeriv(sensation);
  }

  // ─── Push platform-wide sentiment ────────────────────────────────────
  if (sentimentAgg.n > 0) {
    const sensation: SentimentSensation = {
      newsScore: Math.max(-1, Math.min(1, sentimentAgg.news)),
      socialScore: Math.max(-1, Math.min(1, sentimentAgg.social)),
      fearGreed: null, // wire when API key available
      macroVetoActive: sentimentAgg.vetoActive,
      macroVetoReason: sentimentAgg.vetoReason,
    };
    sensorium.updateSentiment(sensation);
  }

  // ─── Push AgentVotes per symbol ──────────────────────────────────────
  for (const [symbol, votes] of votesBySymbol) {
    let longC = 0, shortC = 0, neutralC = 0;
    for (const v of votes) {
      if (v.direction === 'bullish') longC++;
      else if (v.direction === 'bearish') shortC++;
      else neutralC++;
    }
    const vetoes = vetoesBySymbol.get(symbol) ?? [];
    const sensation: AgentVotesSensation = {
      symbol,
      votes,
      longCount: longC,
      shortCount: shortC,
      neutralCount: neutralC,
      anyVetoActive: vetoes.length > 0,
      vetoReasons: vetoes,
    };
    sensorium.updateAgentVotes(sensation);
  }
}

async function pullPositionAndStanceSensors(): Promise<void> {
  const sensorium = getSensorium();
  const activeIds = new Set<string | number>();

  // Phase 83.1 — read positions DIRECTLY from paperPositions table. This
  // decouples the brain from IEM's in-memory state (which may be empty if
  // IEM hasn't loaded yet or per-user IEM is gated). The DB is the single
  // source of truth; IEM and the brain are both consumers. We also pull
  // IEM's enriched in-memory fields (peakPnlPercent, ratchetStep) as
  // overrides where available.
  let dbRows: any[] = [];
  try {
    const { getDb } = await import('../db');
    const { paperPositions } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (db) {
      dbRows = await db.select().from(paperPositions).where(eq(paperPositions.status, 'open')).limit(50);
    }
  } catch (err) {
    logger.warn('[SensorWiring] DB position read failed', { error: (err as Error)?.message });
  }

  // Get IEM's in-memory map for enrichment (peakPnl, ratchetStep are NOT in DB).
  let iemPositions: Map<string, any> | null = null;
  try {
    const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
    const iem = getIntelligentExitManager();
    iemPositions = (iem as any).positions as Map<string, any>;
  } catch {
    // IEM not initialized yet — proceed with DB-only data
  }

  // Build a lookup from IEM by dbPositionId for the in-memory enrichments.
  const iemByDbId = new Map<number, any>();
  if (iemPositions) {
    for (const [_k, p] of iemPositions) {
      if (p?.dbPositionId !== undefined && p?.dbPositionId !== null) {
        iemByDbId.set(p.dbPositionId, p);
      }
    }
  }

  for (const row of dbRows) {
    const positionId = row.id;
    activeIds.add(positionId);
    const iemP = iemByDbId.get(positionId);
    const entryPrice = parseFloat(row.entryPrice);
    const currentPrice = parseFloat(row.currentPrice ?? row.entryPrice);
    const unrealizedPnlPercent = row.unrealizedPnLPercent
      ? parseFloat(row.unrealizedPnLPercent)
      : iemP?.unrealizedPnlPercent ?? 0;
    const sensation: PositionSensation = {
      positionId,
      // Phase 86 — carry userId/tradingMode so the brain routes back correctly.
      userId: row.userId,
      tradingMode: row.tradingMode ?? 'paper',
      symbol: row.symbol,
      side: row.side,
      entryPrice,
      currentPrice,
      unrealizedPnlPercent,
      peakPnlPercent: iemP?.peakPnlPercent ?? Math.max(unrealizedPnlPercent, 0),
      holdMinutes: row.entryTime ? (Date.now() - new Date(row.entryTime).getTime()) / 60_000 : 0,
      currentStopLoss: row.stopLoss ? parseFloat(row.stopLoss) : null,
      currentTakeProfit: row.takeProfit ? parseFloat(row.takeProfit) : null,
      ratchetStep: typeof iemP?.ratchetStep === 'number' ? iemP.ratchetStep : -1,
    };
    sensorium.updatePosition(sensation);
  }

  // Prune Sensorium entries for positions that closed.
  const existingPositions = (sensorium as any).positions as Map<string | number, unknown>;
  if (existingPositions) {
    for (const id of existingPositions.keys()) {
      if (!activeIds.has(id)) sensorium.removePosition(id);
    }
  }

  // Stance — read current consensus per symbol from the cache
  try {
    const { getAllCachedConsensus } = await import('../services/AutomatedSignalProcessor');
    const cache = getAllCachedConsensus();
    for (const [symbol, entry] of cache) {
      // Lookup the matching position (if any) to get entry-time consensus.
      let entryDirection: 'bullish' | 'bearish' | null = null;
      let entryConsensus: number | null = null;
      if (iemPositions) {
        for (const [_k, p] of iemPositions) {
          if (p?.symbol === symbol) {
            entryDirection = p.side === 'long' ? 'bullish' : p.side === 'short' ? 'bearish' : null;
            entryConsensus = typeof p.entryConfidence === 'number' ? p.entryConfidence : null;
            break;
          }
        }
      }
      const driftFromEntry = entryConsensus !== null
        ? (entry.direction === entryDirection ? entry.consensus - entryConsensus : -(entry.consensus + (entryConsensus ?? 0)))
        : 0;
      const sensation: StanceSensation = {
        symbol,
        entryDirection,
        entryConsensus,
        currentDirection: entry.direction,
        currentConsensus: entry.consensus,
        driftFromEntry,
        driftVelocityPerMin: 0, // computed in v2; v1 leaves null
      };
      sensorium.updateStance(sensation);
    }
  } catch {
    // consensus cache may be empty early
  }
}

async function pullMarketSensor(): Promise<void> {
  const sensorium = getSensorium();
  const futuresBook = (global as any).__binanceFuturesBook ?? {};
  // Phase 87 — derive seer symbol from binance symbol generically so any new
  // book entry is consumed without code changes. The handful of legacy
  // exceptions (BTC, ETH, SOL) get explicit mappings; everything else goes
  // through the generic 'XXXUSDT → XXX-USD' transform.
  const explicitMap: Record<string, string> = {
    BTCUSDT: 'BTC-USD',
    ETHUSDT: 'ETH-USD',
    SOLUSDT: 'SOL-USD',
  };
  const toSeerSymbol = (binSym: string): string => {
    if (explicitMap[binSym]) return explicitMap[binSym];
    // Generic: 'AVAXUSDT' → 'AVAX-USD'
    if (binSym.endsWith('USDT')) return binSym.replace(/USDT$/, '-USD');
    return binSym;
  };
  for (const binSym of Object.keys(futuresBook)) {
    const seerSym = toSeerSymbol(binSym);
    const book = futuresBook[binSym];
    if (!book) continue;
    const spreadBps = book.askPrice && book.bidPrice
      ? ((book.askPrice - book.bidPrice) / book.midPrice) * 10_000
      : 0;
    const sensation: MarketSensation = {
      symbol: seerSym,
      midPrice: book.midPrice,
      bestBid: book.bidPrice,
      bestAsk: book.askPrice,
      spreadBps,
      lastTickMs: book.tradeTime ?? book.eventTime ?? Date.now(),
    };
    sensorium.updateMarket(sensation);
  }
}

// ─── Phase 85 — Opportunity sensor (33-agent tally) ───────────────────
// Reads AgentVotesSensation (full 33-agent fan-in) and produces a
// confidence-weighted score per symbol. Falls back to the typed-sensation
// approximation when agentVotes is empty (early boot).
async function pullOpportunitySensor(): Promise<void> {
  const sensorium = getSensorium();
  const symbols = await getCandidateSymbols();
  for (const symbol of symbols) {
    const votesEntry = sensorium.getAgentVotes(symbol);
    const market = sensorium.getMarket(symbol);
    const tech = sensorium.getTechnical(symbol);

    // Critical-data freshness: market must be < 5s; technical < 30s
    const marketStale = !market || market.stalenessMs > 5_000;
    const technicalStale = !tech || tech.stalenessMs > 30_000;
    const criticalDataStale = marketStale || technicalStale;

    let longScore = 0, shortScore = 0, totalSensors = 0;
    let confluenceLong = 0, confluenceShort = 0;

    if (votesEntry && votesEntry.stalenessMs < 30_000) {
      // ─── Primary path: 33-agent vote tally ──────────────────────
      // Phase 86 — count-based scoring. Confidence values cross two ranges
      // in the wild (Phase-40 agents emit 0.05–0.20; legacy agents emit
      // 0..1). Using raw weights lets a single legacy agent dominate. We
      // gate on counts (robust) and use a soft confidence kicker on top.
      const v = votesEntry.sensation;
      let strongLongConf = 0, strongShortConf = 0;
      for (const vote of v.votes) {
        // Confidence kicker: weight = clamp(confidence, 0.05, 0.25).
        // Sum over the dominant side later for tiebreak.
        const w = Math.max(0.05, Math.min(0.25, vote.confidence));
        if (vote.direction === 'bullish') { confluenceLong++; strongLongConf += w; }
        else if (vote.direction === 'bearish') { confluenceShort++; strongShortConf += w; }
        totalSensors++;
      }
      // Carry "scores" but as count-derived signals for the rest of the
      // computation. The shared `longScore`/`shortScore` API stays so the
      // downstream direction/score math doesn't have to be touched.
      longScore = confluenceLong + strongLongConf * 0.4;  // counts dominate; conf adds a small kicker
      shortScore = confluenceShort + strongShortConf * 0.4;
    } else {
      // ─── Fallback path: 3-sensor approximation (boot/early state) ─
      const flow = sensorium.getFlow(symbol);
      const stance = sensorium.getStance(symbol);
      if (tech) {
        totalSensors++;
        const t = tech.sensation;
        let s = 0;
        if (t.rsi < 30) s += 0.15; else if (t.rsi > 70) s -= 0.15;
        if (t.superTrend === 'bullish') s += 0.10; else if (t.superTrend === 'bearish') s -= 0.10;
        if (t.emaTrend === 'up') s += 0.05; else if (t.emaTrend === 'down') s -= 0.05;
        if (s > 0) { longScore += s; confluenceLong++; } else if (s < 0) { shortScore += -s; confluenceShort++; }
      }
      if (flow) {
        totalSensors++;
        const f = flow.sensation;
        const c = f.takerImbalance5s * 0.5 + f.depthImbalance5bp * 0.5;
        if (c > 0.15) { longScore += 0.10; confluenceLong++; }
        else if (c < -0.15) { shortScore += 0.10; confluenceShort++; }
      }
      if (stance) {
        totalSensors++;
        const st = stance.sensation;
        if (st.currentDirection === 'bullish' && st.currentConsensus > 0.5) { longScore += 0.10; confluenceLong++; }
        else if (st.currentDirection === 'bearish' && st.currentConsensus > 0.5) { shortScore += 0.10; confluenceShort++; }
      }
    }

    if (totalSensors === 0) continue;

    const dominantWeight = Math.max(longScore, shortScore);
    const totalWeight = longScore + shortScore;
    const direction: 'long' | 'short' | 'abstain' =
      dominantWeight === 0 ? 'abstain'
        : longScore > shortScore ? 'long'
          : shortScore > longScore ? 'short' : 'abstain';

    // Phase 86 — count-based score with a meaningful-presence kicker.
    //   dominantConfluence  = # agents agreeing with dominant direction
    //   directionalAgents   = long+short (NEUTRAL EXCLUDED — agents who
    //                         "have nothing strong to say" must not dilute
    //                         the signal of agents that DO have a view)
    //   ratio               = dominant share of directional voices
    //   presence            = how many directional voices there are
    //                         (a 5-0 split is stronger than a 1-0 split)
    //
    // Final score = ratio × presence. Both ∈ [0,1]; product ∈ [0,1].
    const dominantConfluence = direction === 'long' ? confluenceLong : direction === 'short' ? confluenceShort : 0;
    const directionalAgents = confluenceLong + confluenceShort;
    const ratio = direction === 'abstain' ? 0
      : dominantWeight / Math.max(0.05, totalWeight);          // pure share of dominant voice
    const presence = Math.min(1, dominantConfluence / 4);      // 4+ agents on one side = full presence
    const score = direction === 'abstain' ? 0 : ratio * presence;
    const confluenceCount = dominantConfluence;
    void directionalAgents;

    const sensation: OpportunitySensation = {
      symbol,
      score,
      direction,
      confluenceCount,
      totalSensors,
      criticalDataStale,
    };
    sensorium.updateOpportunity(sensation);
  }
}

// Phase 85 — candidate symbols come from systemConfig (admin-tunable) with
// a sane default if unset. This is the Stream-D hot-reload entry point.
let _candidateSymbolsCache: { syms: string[]; expiresAt: number } | null = null;
async function getCandidateSymbols(): Promise<string[]> {
  const now = Date.now();
  if (_candidateSymbolsCache && _candidateSymbolsCache.expiresAt > now) {
    return _candidateSymbolsCache.syms;
  }
  let syms: string[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
  try {
    const { getDb } = await import('../db');
    const { systemConfig } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(systemConfig)
        .where(eq(systemConfig.configKey, 'brain.candidateSymbols')).limit(1);
      if (row?.configValue) {
        const raw = row.configValue as unknown;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) syms = parsed as string[];
      }
    }
  } catch { /* keep default */ }
  _candidateSymbolsCache = { syms, expiresAt: now + 15_000 };
  return syms;
}
export function invalidateCandidateSymbolsCache(): void { _candidateSymbolsCache = null; }
/** Synchronous read of the most recently cached candidate symbols (or default). */
export function getCachedCandidateSymbols(): string[] {
  return _candidateSymbolsCache?.syms ?? ['BTC-USD', 'ETH-USD', 'SOL-USD'];
}

// ─── Phase 84 — Portfolio sensor ──────────────────────────────────────
// Reads wallet equity + position counts + daily P&L from DB. Brain's
// PORTFOLIO_GUARD pre-step gates on this.
async function pullPortfolioSensor(): Promise<void> {
  const sensorium = getSensorium();
  try {
    const { getDb } = await import('../db');
    const { paperPositions, paperTrades, paperWallets } = await import('../../drizzle/schema');
    const { eq, and, gte, sql } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return;

    // Open positions count (paper for now — brain runs paper-mode-only)
    const openPositions = await db.select({ count: sql<number>`count(*)` })
      .from(paperPositions)
      .where(eq(paperPositions.status, 'open'));
    const openCount = Number(openPositions[0]?.count ?? 0);

    // Daily realized P&L (UTC midnight). paperTrades stores signed $ in the
    // `pnl` varchar column and a `timestamp` of trade close.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let dailyRealizedPnl = 0;
    try {
      const dailyTradesAgg = await db.select({
        total: sql<string>`sum(cast(pnl as decimal(18,4)))`,
      })
        .from(paperTrades)
        .where(gte(paperTrades.timestamp, today));
      dailyRealizedPnl = parseFloat((dailyTradesAgg[0]?.total ?? '0') as string) || 0;
    } catch { /* column name may differ across phases; keep 0 */ }

    // Latest wallet equity — paperWallets stores live equity per (userId, tradingMode).
    // Phase 86 — track the PRIMARY user (largest-equity paper wallet) so the
    // brain's entries route to a real user instead of being hardcoded to 1.
    let equity = 10_000;
    let primaryUserId = 1;
    try {
      const rows = await db.select({ userId: paperWallets.userId, equity: paperWallets.equity })
        .from(paperWallets)
        .where(eq(paperWallets.tradingMode, 'paper'));
      let summed = 0;
      let topEquity = -1;
      for (const r of rows) {
        const eq = parseFloat((r.equity ?? '0') as string) || 0;
        summed += eq;
        if (eq > topEquity) { topEquity = eq; primaryUserId = r.userId; }
      }
      if (Number.isFinite(summed) && summed > 0) equity = summed;
    } catch { /* schema may differ; keep default */ }
    void and;

    const dailyPnlPercent = equity > 0 ? (dailyRealizedPnl / equity) * 100 : 0;

    const sensation: PortfolioSensation = {
      primaryUserId,
      equity,
      dailyRealizedPnl,
      dailyPnlPercent,
      openPositionCount: openCount,
      portfolioVarPercent: 0, // v2 wiring — Week9RiskManager.getPortfolioVar()
      dailyLossCircuitTripped: dailyPnlPercent <= -5.0,
      limits: {
        maxDailyLossPercent: 5.0,
        maxPortfolioVarPercent: 8.0,
        maxOpenPositions: 5,
      },
    };
    sensorium.updatePortfolio(sensation);
  } catch (err) {
    logger.warn('[SensorWiring] pullPortfolioSensor failed', { error: (err as Error)?.message });
  }
}

// ─── Phase 87 — Alpha library sensor ──────────────────────────────────
// Reads winningPatterns table grouped by symbol. The brain reads this in
// decideEntry to BIAS the opportunity score positively when a symbol has
// proven historical patterns. When the table is empty (cold start), the
// sensation reports zero patterns and the brain proceeds as before — alpha
// is a bonus signal, never a hard gate.
async function pullAlphaSensor(): Promise<void> {
  const sensorium = getSensorium();
  try {
    const { getDb } = await import('../db');
    const { winningPatterns } = await import('../../drizzle/schema');
    const { eq, and, sql } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return;

    // Symbols the brain might care about — same set the opportunity sensor
    // iterates. Some patterns are stored in 'BTCUSDT' format while brain
    // uses 'BTC-USD'; query both shapes and normalize.
    const seerSymbols = await getCandidateSymbols();
    const allShapes = new Set<string>();
    for (const s of seerSymbols) {
      allShapes.add(s);
      allShapes.add(s.replace('-USD', 'USDT'));
      allShapes.add(s.replace('-USD', ''));
    }
    const inArr = Array.from(allShapes);

    if (inArr.length === 0) return;

    // Active (non-decayed) patterns first.
    const activeRows = await db.select({
      symbol: winningPatterns.symbol,
      winRate: winningPatterns.winRate,
      totalTrades: winningPatterns.totalTrades,
    })
      .from(winningPatterns)
      .where(and(
        eq(winningPatterns.isActive, true),
        eq(winningPatterns.alphaDecayFlag, false),
      ));

    // Decayed patterns count as a CAUTION signal — bias score DOWN.
    const decayedRows = await db.select({
      symbol: winningPatterns.symbol,
      cnt: sql<number>`count(*)`,
    })
      .from(winningPatterns)
      .where(eq(winningPatterns.alphaDecayFlag, true))
      .groupBy(winningPatterns.symbol);

    // Aggregate per normalized seerSymbol.
    const acc = new Map<string, { active: number; best: number; weighted: number; sampleSize: number; decayed: number }>();

    const normalize = (s: string): string => {
      if (s.endsWith('-USD')) return s;
      if (s.endsWith('USDT')) return s.replace('USDT', '-USD');
      return s + '-USD';
    };

    for (const r of activeRows) {
      const sym = normalize(r.symbol);
      const a = acc.get(sym) ?? { active: 0, best: 0, weighted: 0, sampleSize: 0, decayed: 0 };
      const wr = parseFloat(r.winRate ?? '0');
      const tt = r.totalTrades ?? 0;
      a.active += 1;
      if (wr > a.best) a.best = wr;
      a.weighted += wr * tt;
      a.sampleSize += tt;
      acc.set(sym, a);
    }
    for (const r of decayedRows) {
      const sym = normalize(r.symbol);
      const a = acc.get(sym) ?? { active: 0, best: 0, weighted: 0, sampleSize: 0, decayed: 0 };
      a.decayed += Number(r.cnt);
      acc.set(sym, a);
    }

    // Always push a sensation per candidate (even empty) so the brain can
    // distinguish "alpha cold-start" from "alpha sensor never ran".
    for (const sym of seerSymbols) {
      const a = acc.get(sym) ?? { active: 0, best: 0, weighted: 0, sampleSize: 0, decayed: 0 };
      const sensation: AlphaSensation = {
        symbol: sym,
        activePatternCount: a.active,
        bestWinRate: a.best,
        weightedWinRate: a.sampleSize > 0 ? a.weighted / a.sampleSize : 0,
        totalTradeSampleSize: a.sampleSize,
        decayedPatternCount: a.decayed,
      };
      sensorium.updateAlpha(sensation);
    }
  } catch (err) {
    logger.warn('[SensorWiring] pullAlphaSensor failed', { error: (err as Error)?.message });
  }
}
