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

import { getSensorium, type TechnicalSensation, type FlowSensation, type PositionSensation, type StanceSensation, type MarketSensation } from './Sensorium';
import { engineLogger as logger } from '../utils/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

let started = false;
let intervalIds: NodeJS.Timeout[] = [];

export function startSensorWiring(): void {
  if (started) return;
  started = true;

  // ─── Technical + Flow: pull from latest agentSignals every 5s ────────
  intervalIds.push(setInterval(() => {
    pullTechnicalAndFlowSensors().catch(err => {
      logger.warn('[SensorWiring] technical/flow pull failed', { error: err?.message });
    });
  }, 5000));

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

  logger.info('[SensorWiring] started — 4 sensors active');
}

export function stopSensorWiring(): void {
  for (const id of intervalIds) clearInterval(id);
  intervalIds = [];
  started = false;
}

// ──────────────────────────────────────────────────────────────────────
// Sensor implementations
// ──────────────────────────────────────────────────────────────────────

async function pullTechnicalAndFlowSensors(): Promise<void> {
  const { getDb } = await import('../db');
  const { agentSignals } = await import('../../drizzle/schema');
  const { eq, and, desc, gte, inArray } = await import('drizzle-orm');
  const db = await getDb();
  if (!db) return;

  const sensorium = getSensorium();
  const since = new Date(Date.now() - 30_000);

  // Pull the LAST signal per agent per symbol in the last 30s.
  const rows = await db
    .select({
      agentName: agentSignals.agentName,
      signalData: agentSignals.signalData,
      timestamp: agentSignals.timestamp,
    })
    .from(agentSignals)
    .where(and(
      gte(agentSignals.timestamp, since),
      inArray(agentSignals.agentName, ['TechnicalAnalyst', 'OrderFlowAnalyst']),
    ))
    .orderBy(desc(agentSignals.timestamp))
    .limit(200);

  // Deduplicate: keep newest per (agentName, symbol).
  const newest = new Map<string, any>();
  for (const r of rows) {
    const sd = r.signalData as any;
    const symbol = sd?.symbol;
    if (!symbol) continue;
    const key = `${r.agentName}:${symbol}`;
    if (!newest.has(key)) newest.set(key, sd);
  }

  for (const [key, sd] of newest) {
    const [agentName, symbol] = key.split(':');
    const ev = sd?.evidence ?? {};
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
    } else if (agentName === 'OrderFlowAnalyst') {
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
  const symbolMap: Record<string, string> = {
    BTCUSDT: 'BTC-USD',
    ETHUSDT: 'ETH-USD',
    SOLUSDT: 'SOL-USD',
  };
  for (const binSym of Object.keys(futuresBook)) {
    const seerSym = symbolMap[binSym] ?? binSym;
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
