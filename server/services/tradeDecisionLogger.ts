/**
 * Trade Decision Logger Service
 * 
 * Captures and stores all trading decisions with full agent breakdown
 * for comprehensive audit trail and performance analysis.
 */

import { getDb } from '../db';
import { tradeDecisionLogs, InsertTradeDecisionLog } from '../../drizzle/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export interface AgentScore {
  score: number;
  weight: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning?: string;
}

export interface MarketConditions {
  volatility: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  volume: number;
  regime: 'trending' | 'ranging' | 'volatile';
  atr?: number;
}

export interface TradeDecisionInput {
  userId: number;
  symbol: string;
  exchange: string;
  price: number;
  signalType: 'BUY' | 'SELL' | 'HOLD';
  signalStrength?: number;
  fastScore?: number;
  slowBonus?: number;
  totalConfidence: number;
  threshold: number;
  agentScores: Record<string, AgentScore>;
  decision: 'EXECUTED' | 'SKIPPED' | 'VETOED' | 'PENDING' | 'FAILED' | 'PARTIAL';
  decisionReason?: string;
  marketConditions?: MarketConditions;
}

export interface TradeExecutionUpdate {
  signalId: string;
  positionId?: number;
  orderId?: string;
  entryPrice?: number;
  quantity?: number;
  positionSizePercent?: number;
}

export interface TradeExitUpdate {
  signalId: string;
  exitPrice: number;
  exitReason: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'signal_reversal' | 'manual' | 'timeout' | 'risk_limit';
  pnl: number;
  pnlPercent: number;
  holdDuration: number;
  maxDrawdown?: number;
  maxProfit?: number;
}

class TradeDecisionLoggerService {
  private static instance: TradeDecisionLoggerService;

  private constructor() {}

  public static getInstance(): TradeDecisionLoggerService {
    if (!TradeDecisionLoggerService.instance) {
      TradeDecisionLoggerService.instance = new TradeDecisionLoggerService();
    }
    return TradeDecisionLoggerService.instance;
  }

  /**
   * Log a new trade decision
   */
  async logDecision(input: TradeDecisionInput): Promise<string> {
    const db = await getDb();
    if (!db) {
      console.warn('[TradeDecisionLogger] Database not available');
      return '';
    }

    const signalId = uuidv4();
    
    try {
      // Determine status based on decision and whether it was a genuine missed opportunity
      // OPPORTUNITY_MISSED: Consensus >= Threshold but trade was still skipped (genuine miss)
      // SIGNAL_GENERATED: Consensus < Threshold, correctly rejected (not a miss)
      let status: 'DECISION_MADE' | 'OPPORTUNITY_MISSED' | 'SIGNAL_GENERATED';
      if (input.decision === 'EXECUTED') {
        status = 'DECISION_MADE';
      } else if (input.decision === 'SKIPPED') {
        // Only mark as OPPORTUNITY_MISSED if consensus was above threshold
        // This is a genuine miss - the signal qualified but wasn't executed
        const isGenuineMiss = input.totalConfidence >= input.threshold;
        status = isGenuineMiss ? 'OPPORTUNITY_MISSED' : 'SIGNAL_GENERATED';
      } else {
        status = 'SIGNAL_GENERATED';
      }

      const record: InsertTradeDecisionLog = {
        userId: input.userId,
        signalId,
        symbol: input.symbol,
        exchange: input.exchange,
        price: input.price.toString(),
        signalType: input.signalType,
        signalStrength: input.signalStrength?.toString(),
        fastScore: input.fastScore?.toString(),
        slowBonus: input.slowBonus?.toString(),
        totalConfidence: input.totalConfidence.toString(),
        threshold: input.threshold.toString(),
        agentScores: input.agentScores,
        decision: input.decision,
        decisionReason: input.decisionReason,
        status,
        marketConditions: input.marketConditions,
      };

      await db.insert(tradeDecisionLogs).values(record);
      
      console.log(`[TradeDecisionLogger] Logged decision: ${signalId} - ${input.symbol} ${input.signalType} (${input.decision})`);
      
      return signalId;
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to log decision:', error);
      return '';
    }
  }

  /**
   * Update a decision with execution details (Phase 60 — also promotes
   * decision PENDING→EXECUTED so the row reflects actual exchange-side
   * truth, not just consensus-stage approval).
   */
  async updateExecution(update: TradeExecutionUpdate): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      await db.update(tradeDecisionLogs)
        .set({
          positionId: update.positionId,
          orderId: update.orderId,
          entryPrice: update.entryPrice?.toString(),
          quantity: update.quantity?.toString(),
          positionSizePercent: update.positionSizePercent?.toString(),
          decision: 'EXECUTED',
          status: 'POSITION_OPENED',
        })
        .where(eq(tradeDecisionLogs.signalId, update.signalId));

      console.log(`[TradeDecisionLogger] Updated execution: ${update.signalId}`);
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to update execution:', error);
    }
  }

  /**
   * Phase 60 — mark a PENDING decision as FAILED with the gate that
   * rejected it. Called from EnhancedTradeExecutor when an approved
   * signal can't actually open a position (R:R, duplicate, VaR,
   * regime cooldown, insufficient balance, etc.).
   */
  async markFailed(signalId: string, reason: string): Promise<void> {
    const db = await getDb();
    if (!db || !signalId) return;
    try {
      await db.update(tradeDecisionLogs)
        .set({
          decision: 'FAILED',
          decisionReason: reason.slice(0, 250),
          status: 'OPPORTUNITY_MISSED',
        })
        .where(eq(tradeDecisionLogs.signalId, signalId));
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to mark FAILED:', error);
    }
  }

  /**
   * Update a decision with exit details
   */
  async updateExit(update: TradeExitUpdate): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      await db.update(tradeDecisionLogs)
        .set({
          exitPrice: update.exitPrice.toString(),
          exitTime: new Date(),
          exitReason: update.exitReason,
          pnl: update.pnl.toString(),
          pnlPercent: update.pnlPercent.toString(),
          holdDuration: update.holdDuration,
          maxDrawdown: update.maxDrawdown?.toString(),
          maxProfit: update.maxProfit?.toString(),
          status: 'POSITION_CLOSED',
        })
        .where(eq(tradeDecisionLogs.signalId, update.signalId));
      
      console.log(`[TradeDecisionLogger] Updated exit: ${update.signalId} - P&L: ${update.pnl}`);
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to update exit:', error);
    }
  }

  /**
   * Get trade decision logs with filters
   */
  async getLogs(params: {
    userId: number;
    startDate?: Date;
    endDate?: Date;
    symbol?: string;
    decision?: string;
    status?: string;
    signalType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const db = await getDb();
    if (!db) return { logs: [], total: 0 };

    try {
      const conditions = [eq(tradeDecisionLogs.userId, params.userId)];
      
      if (params.startDate) {
        conditions.push(gte(tradeDecisionLogs.timestamp, params.startDate));
      }
      if (params.endDate) {
        conditions.push(lte(tradeDecisionLogs.timestamp, params.endDate));
      }
      if (params.symbol) {
        conditions.push(eq(tradeDecisionLogs.symbol, params.symbol));
      }
      if (params.decision) {
        conditions.push(eq(tradeDecisionLogs.decision, params.decision as any));
      }
      if (params.status) {
        conditions.push(eq(tradeDecisionLogs.status, params.status as any));
      }
      if (params.signalType) {
        conditions.push(eq(tradeDecisionLogs.signalType, params.signalType as any));
      }

      const whereClause = and(...conditions);

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tradeDecisionLogs)
        .where(whereClause);
      
      const total = countResult[0]?.count || 0;

      // Get logs with pagination
      const logs = await db
        .select()
        .from(tradeDecisionLogs)
        .where(whereClause)
        .orderBy(desc(tradeDecisionLogs.timestamp))
        .limit(params.limit || 100)
        .offset(params.offset || 0);

      return { logs, total };
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to get logs:', error);
      return { logs: [], total: 0 };
    }
  }

  /**
   * Get summary statistics for trade decisions
   */
  async getStats(params: {
    userId: number;
    startDate?: Date;
    endDate?: Date;
    symbol?: string;
  }): Promise<{
    totalSignals: number;
    executedTrades: number;
    skippedSignals: number;
    vetoedSignals: number;
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    winRate: number;
    avgConfidence: number;
    avgHoldDuration: number;
    opportunitiesMissed: number;
  }> {
    const db = await getDb();
    if (!db) {
      return {
        totalSignals: 0,
        executedTrades: 0,
        skippedSignals: 0,
        vetoedSignals: 0,
        closedTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalPnl: 0,
        winRate: 0,
        avgConfidence: 0,
        avgHoldDuration: 0,
        opportunitiesMissed: 0,
      };
    }

    try {
      const conditions = [eq(tradeDecisionLogs.userId, params.userId)];
      
      if (params.startDate) {
        conditions.push(gte(tradeDecisionLogs.timestamp, params.startDate));
      }
      if (params.endDate) {
        conditions.push(lte(tradeDecisionLogs.timestamp, params.endDate));
      }
      if (params.symbol) {
        conditions.push(eq(tradeDecisionLogs.symbol, params.symbol));
      }

      const whereClause = and(...conditions);

      const logs = await db
        .select()
        .from(tradeDecisionLogs)
        .where(whereClause);

      const totalSignals = logs.length;
      const executedTrades = logs.filter(l => l.decision === 'EXECUTED').length;
      const skippedSignals = logs.filter(l => l.decision === 'SKIPPED').length;
      const vetoedSignals = logs.filter(l => l.decision === 'VETOED').length;
      const closedTrades = logs.filter(l => l.status === 'POSITION_CLOSED').length;
      
      const tradesWithPnl = logs.filter(l => l.pnl !== null);
      const winningTrades = tradesWithPnl.filter(l => parseFloat(l.pnl || '0') > 0).length;
      const losingTrades = tradesWithPnl.filter(l => parseFloat(l.pnl || '0') < 0).length;
      const totalPnl = tradesWithPnl.reduce((sum, l) => sum + parseFloat(l.pnl || '0'), 0);
      
      const winRate = closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0;
      
      const avgConfidence = totalSignals > 0 
        ? logs.reduce((sum, l) => sum + parseFloat(l.totalConfidence || '0'), 0) / totalSignals 
        : 0;
      
      const tradesWithDuration = logs.filter(l => l.holdDuration !== null);
      const avgHoldDuration = tradesWithDuration.length > 0
        ? tradesWithDuration.reduce((sum, l) => sum + (l.holdDuration || 0), 0) / tradesWithDuration.length
        : 0;
      
      const opportunitiesMissed = logs.filter(l => l.status === 'OPPORTUNITY_MISSED').length;

      return {
        totalSignals,
        executedTrades,
        skippedSignals,
        vetoedSignals,
        closedTrades,
        winningTrades,
        losingTrades,
        totalPnl,
        winRate,
        avgConfidence,
        avgHoldDuration,
        opportunitiesMissed,
      };
    } catch (error) {
      console.error('[TradeDecisionLogger] Failed to get stats:', error);
      return {
        totalSignals: 0,
        executedTrades: 0,
        skippedSignals: 0,
        vetoedSignals: 0,
        closedTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalPnl: 0,
        winRate: 0,
        avgConfidence: 0,
        avgHoldDuration: 0,
        opportunitiesMissed: 0,
      };
    }
  }
}

export const tradeDecisionLogger = TradeDecisionLoggerService.getInstance();
