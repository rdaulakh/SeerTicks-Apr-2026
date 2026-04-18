/**
 * Phase 22: AuditLogger — Comprehensive 24/7/365 Audit Logging to Database
 *
 * Provides structured logging methods for 6 audit categories:
 * 1. Tick Heartbeat — proves WebSocket data flows continuously
 * 2. Agent Signals — every agent signal with direction/confidence
 * 3. Consensus Flow — consensus up/down movement per cycle
 * 4. Trade Decisions — picked/rejected/missed with pipeline reasons
 * 5. Slow Agent Activity — periodic agent invocations + results
 * 6. API Calls — external API call results + response times
 *
 * All data goes to DATABASE tables (not console) for audit trail.
 * Uses fire-and-forget batched writes to avoid blocking the hot path.
 */

import { EventEmitter } from 'events';

// Types for log entries (queued before DB write)
interface TickHeartbeatEntry {
  symbol: string;
  tickCount: number;
  lastPrice: number;
  lastTickTime: Date;
  priceHigh: number;
  priceLow: number;
  avgSpreadMs: number;
  source: string;
}

interface AgentSignalEntry {
  symbol: string;
  agentName: string;
  agentCategory: 'fast' | 'slow' | 'pattern';
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning?: string;
  executionTimeMs?: number;
  dataSource?: string;
  isSynthetic?: boolean;
}

interface ConsensusEntry {
  symbol: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  bullishStrength: number;
  bearishStrength: number;
  netDirection: 'bullish' | 'bearish' | 'neutral';
  consensusConfidence: number;
  threshold: number;
  meetsThreshold: boolean;
  fastAgentScore?: number;
  slowAgentBonus?: number;
  agentBreakdown?: Record<string, any>;
}

interface TradeDecisionEntry {
  symbol: string;
  decision: 'executed' | 'rejected' | 'missed';
  direction?: 'long' | 'short';
  consensusConfidence: number;
  rejectReason?: string;
  rejectStage?: string;
  entryPrice?: number;
  positionSize?: number;
  varResult?: any;
  agentSignals?: any;
  pipelineStages?: any;
}

interface SlowAgentEntry {
  symbol: string;
  agentName: string;
  status: 'success' | 'error' | 'timeout' | 'no_data';
  executionTimeMs?: number;
  signal?: 'bullish' | 'bearish' | 'neutral';
  confidence?: number;
  dataPointsProcessed?: number;
  errorMessage?: string;
  apiCallsMade?: number;
  apiCallsFailed?: number;
}

interface ApiCallEntry {
  apiName: string;
  endpoint?: string;
  method?: string;
  status: 'success' | 'error' | 'timeout' | 'rate_limited';
  httpStatusCode?: number;
  responseTimeMs?: number;
  responseSize?: number;
  errorMessage?: string;
  callerAgent?: string;
  symbol?: string;
}

// Per-symbol tick accumulator for the 60s heartbeat window
interface TickAccumulator {
  tickCount: number;
  lastPrice: number;
  lastTickTime: Date;
  priceHigh: number;
  priceLow: number;
  tickTimestamps: number[];  // for avg spread calculation
  source: string;
}

class AuditLogger extends EventEmitter {
  private isRunning = false;

  // Tick heartbeat accumulators (per symbol, flushed every 60s)
  private tickAccumulators: Map<string, TickAccumulator> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Batched write queues (flushed every 5s)
  private agentSignalQueue: AgentSignalEntry[] = [];
  private consensusQueue: ConsensusEntry[] = [];
  private tradeDecisionQueue: TradeDecisionEntry[] = [];
  private slowAgentQueue: SlowAgentEntry[] = [];
  private apiCallQueue: ApiCallEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  // Stats
  private stats = {
    tickHeartbeatsWritten: 0,
    agentSignalsWritten: 0,
    consensusLogsWritten: 0,
    tradeDecisionsWritten: 0,
    slowAgentLogsWritten: 0,
    apiCallLogsWritten: 0,
    writeErrors: 0,
  };

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[AuditLogger] Starting comprehensive audit logging...');

    // Flush tick heartbeats every 60 seconds
    this.heartbeatInterval = setInterval(() => {
      this.flushTickHeartbeats().catch(err => {
        console.error('[AuditLogger] Tick heartbeat flush error:', (err as Error)?.message);
      });
    }, 60_000);

    // Flush queued entries every 5 seconds
    this.flushInterval = setInterval(() => {
      this.flushQueues().catch(err => {
        console.error('[AuditLogger] Queue flush error:', (err as Error)?.message);
      });
    }, 5_000);

    console.log('[AuditLogger] Started — tick heartbeat (60s), queue flush (5s)');
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    this.flushTickHeartbeats().catch(() => {});
    this.flushQueues().catch(() => {});

    console.log('[AuditLogger] Stopped. Stats:', JSON.stringify(this.stats));
  }

  getStats() {
    return { ...this.stats, isRunning: this.isRunning };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. TICK HEARTBEAT — call on every WebSocket tick
  // ──────────────────────────────────────────────────────────────────────────

  recordTick(symbol: string, price: number, source: string = 'coinbase'): void {
    if (!this.isRunning) return;

    let acc = this.tickAccumulators.get(symbol);
    if (!acc) {
      acc = {
        tickCount: 0,
        lastPrice: price,
        lastTickTime: new Date(),
        priceHigh: price,
        priceLow: price,
        tickTimestamps: [],
        source,
      };
      this.tickAccumulators.set(symbol, acc);
    }

    acc.tickCount++;
    acc.lastPrice = price;
    acc.lastTickTime = new Date();
    if (price > acc.priceHigh) acc.priceHigh = price;
    if (price < acc.priceLow) acc.priceLow = price;
    acc.tickTimestamps.push(Date.now());
    acc.source = source;

    // Keep only last 200 tick timestamps for spread calculation
    if (acc.tickTimestamps.length > 200) {
      acc.tickTimestamps = acc.tickTimestamps.slice(-200);
    }
  }

  private async flushTickHeartbeats(): Promise<void> {
    if (this.tickAccumulators.size === 0) return;

    const entries: TickHeartbeatEntry[] = [];
    for (const [symbol, acc] of this.tickAccumulators) {
      // Calculate average spread between ticks
      let avgSpreadMs = 0;
      if (acc.tickTimestamps.length >= 2) {
        let totalSpread = 0;
        for (let i = 1; i < acc.tickTimestamps.length; i++) {
          totalSpread += acc.tickTimestamps[i] - acc.tickTimestamps[i - 1];
        }
        avgSpreadMs = Math.round(totalSpread / (acc.tickTimestamps.length - 1));
      }

      entries.push({
        symbol,
        tickCount: acc.tickCount,
        lastPrice: acc.lastPrice,
        lastTickTime: acc.lastTickTime,
        priceHigh: acc.priceHigh,
        priceLow: acc.priceLow,
        avgSpreadMs,
        source: acc.source,
      });
    }

    // Reset accumulators for next window
    this.tickAccumulators.clear();

    // Write to DB
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { tickHeartbeat } = await import('../../drizzle/schema');

      for (const entry of entries) {
        await db.insert(tickHeartbeat).values({
          symbol: entry.symbol,
          tickCount: entry.tickCount,
          lastPrice: entry.lastPrice.toString(),
          lastTickTime: entry.lastTickTime,
          priceHigh: entry.priceHigh.toString(),
          priceLow: entry.priceLow.toString(),
          avgSpreadMs: entry.avgSpreadMs,
          source: entry.source,
        });
      }
      this.stats.tickHeartbeatsWritten += entries.length;
    } catch (err) {
      this.stats.writeErrors++;
      console.error('[AuditLogger] tickHeartbeat write failed:', (err as Error)?.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. AGENT SIGNAL — call when any agent produces a signal
  // ──────────────────────────────────────────────────────────────────────────

  logAgentSignal(entry: AgentSignalEntry): void {
    if (!this.isRunning) return;
    this.agentSignalQueue.push(entry);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. CONSENSUS — call after every consensus calculation
  // ──────────────────────────────────────────────────────────────────────────

  logConsensus(entry: ConsensusEntry): void {
    if (!this.isRunning) return;
    this.consensusQueue.push(entry);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. TRADE DECISION — call for every signal that reaches the trade pipeline
  // ──────────────────────────────────────────────────────────────────────────

  logTradeDecision(entry: TradeDecisionEntry): void {
    if (!this.isRunning) return;
    this.tradeDecisionQueue.push(entry);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. SLOW AGENT — call after each slow/pattern agent completes
  // ──────────────────────────────────────────────────────────────────────────

  logSlowAgent(entry: SlowAgentEntry): void {
    if (!this.isRunning) return;
    this.slowAgentQueue.push(entry);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. API CALL — call after every external API request
  // ──────────────────────────────────────────────────────────────────────────

  logApiCall(entry: ApiCallEntry): void {
    if (!this.isRunning) return;
    this.apiCallQueue.push(entry);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FLUSH — batch write all queued entries to DB every 5 seconds
  // ──────────────────────────────────────────────────────────────────────────

  private async flushQueues(): Promise<void> {
    const agentSignals = this.agentSignalQueue.splice(0);
    const consensus = this.consensusQueue.splice(0);
    const tradeDecisions = this.tradeDecisionQueue.splice(0);
    const slowAgents = this.slowAgentQueue.splice(0);
    const apiCalls = this.apiCallQueue.splice(0);

    if (agentSignals.length === 0 && consensus.length === 0 &&
        tradeDecisions.length === 0 && slowAgents.length === 0 &&
        apiCalls.length === 0) return;

    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const schema = await import('../../drizzle/schema');

      // Agent Signals
      if (agentSignals.length > 0) {
        await db.insert(schema.agentSignalLog).values(
          agentSignals.map(e => ({
            symbol: e.symbol,
            agentName: e.agentName,
            agentCategory: e.agentCategory,
            signal: e.signal,
            confidence: e.confidence.toString(),
            reasoning: e.reasoning || null,
            executionTimeMs: e.executionTimeMs || null,
            dataSource: e.dataSource || null,
            isSynthetic: e.isSynthetic || false,
          }))
        );
        this.stats.agentSignalsWritten += agentSignals.length;
      }

      // Consensus
      if (consensus.length > 0) {
        await db.insert(schema.consensusLog).values(
          consensus.map(e => ({
            symbol: e.symbol,
            bullishCount: e.bullishCount,
            bearishCount: e.bearishCount,
            neutralCount: e.neutralCount,
            bullishStrength: e.bullishStrength.toString(),
            bearishStrength: e.bearishStrength.toString(),
            netDirection: e.netDirection,
            consensusConfidence: e.consensusConfidence.toString(),
            threshold: e.threshold.toString(),
            meetsThreshold: e.meetsThreshold,
            fastAgentScore: e.fastAgentScore?.toString() || null,
            slowAgentBonus: e.slowAgentBonus?.toString() || null,
            agentBreakdown: e.agentBreakdown || null,
          }))
        );
        this.stats.consensusLogsWritten += consensus.length;
      }

      // Trade Decisions
      if (tradeDecisions.length > 0) {
        await db.insert(schema.tradeDecisionLog).values(
          tradeDecisions.map(e => ({
            symbol: e.symbol,
            decision: e.decision,
            direction: e.direction || null,
            consensusConfidence: e.consensusConfidence.toString(),
            rejectReason: e.rejectReason || null,
            rejectStage: e.rejectStage || null,
            entryPrice: e.entryPrice?.toString() || null,
            positionSize: e.positionSize?.toString() || null,
            varResult: e.varResult || null,
            agentSignals: e.agentSignals || null,
            pipelineStages: e.pipelineStages || null,
          }))
        );
        this.stats.tradeDecisionsWritten += tradeDecisions.length;
      }

      // Slow Agents
      if (slowAgents.length > 0) {
        await db.insert(schema.slowAgentLog).values(
          slowAgents.map(e => ({
            symbol: e.symbol,
            agentName: e.agentName,
            status: e.status,
            executionTimeMs: e.executionTimeMs || null,
            signal: e.signal || null,
            confidence: e.confidence?.toString() || null,
            dataPointsProcessed: e.dataPointsProcessed || null,
            errorMessage: e.errorMessage || null,
            apiCallsMade: e.apiCallsMade || 0,
            apiCallsFailed: e.apiCallsFailed || 0,
          }))
        );
        this.stats.slowAgentLogsWritten += slowAgents.length;
      }

      // API Calls
      if (apiCalls.length > 0) {
        await db.insert(schema.apiCallLog).values(
          apiCalls.map(e => ({
            apiName: e.apiName,
            endpoint: e.endpoint || null,
            method: e.method || 'GET',
            status: e.status,
            httpStatusCode: e.httpStatusCode || null,
            responseTimeMs: e.responseTimeMs || null,
            responseSize: e.responseSize || null,
            errorMessage: e.errorMessage || null,
            callerAgent: e.callerAgent || null,
            symbol: e.symbol || null,
          }))
        );
        this.stats.apiCallLogsWritten += apiCalls.length;
      }

    } catch (err) {
      this.stats.writeErrors++;
      // Don't spam logs — only log every 10th error
      if (this.stats.writeErrors % 10 === 1) {
        console.error('[AuditLogger] Queue flush failed:', (err as Error)?.message);
      }
    }
  }
}

// Singleton
let instance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!instance) {
    instance = new AuditLogger();
  }
  return instance;
}

export { AuditLogger };
export type {
  TickHeartbeatEntry,
  AgentSignalEntry,
  ConsensusEntry,
  TradeDecisionEntry,
  SlowAgentEntry,
  ApiCallEntry,
};
