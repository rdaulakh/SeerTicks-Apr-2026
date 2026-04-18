/**
 * Trade Decision Log Router
 * 
 * tRPC endpoints for fetching trade decision logs with filters
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { tradeDecisionLogger } from '../services/tradeDecisionLogger';

export const tradeDecisionLogRouter = router({
  /**
   * Get trade decision logs with filters
   */
  getLogs: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      symbol: z.string().optional(),
      decision: z.enum(['EXECUTED', 'SKIPPED', 'VETOED', 'PENDING', 'FAILED', 'PARTIAL']).optional(),
      status: z.enum(['SIGNAL_GENERATED', 'DECISION_MADE', 'POSITION_OPENED', 'POSITION_CLOSED', 'OPPORTUNITY_MISSED']).optional(),
      signalType: z.enum(['BUY', 'SELL', 'HOLD']).optional(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      
      // Default to last 7 days if no date range specified
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const startDate = input.startDate ? new Date(input.startDate) : sevenDaysAgo;
      const endDate = input.endDate ? new Date(input.endDate) : now;
      
      const result = await tradeDecisionLogger.getLogs({
        userId,
        startDate,
        endDate,
        symbol: input.symbol,
        decision: input.decision,
        status: input.status,
        signalType: input.signalType,
        limit: input.limit,
        offset: input.offset,
      });
      
      // Transform logs for frontend
      const transformedLogs = result.logs.map(log => ({
        id: log.id,
        signalId: log.signalId,
        timestamp: log.timestamp,
        symbol: log.symbol,
        exchange: log.exchange,
        price: parseFloat(log.price),
        signalType: log.signalType,
        signalStrength: log.signalStrength ? parseFloat(log.signalStrength) : null,
        fastScore: log.fastScore ? parseFloat(log.fastScore) : null,
        slowBonus: log.slowBonus ? parseFloat(log.slowBonus) : null,
        totalConfidence: parseFloat(log.totalConfidence),
        threshold: parseFloat(log.threshold),
        agentScores: log.agentScores,
        decision: log.decision,
        decisionReason: log.decisionReason,
        positionId: log.positionId,
        orderId: log.orderId,
        entryPrice: log.entryPrice ? parseFloat(log.entryPrice) : null,
        quantity: log.quantity ? parseFloat(log.quantity) : null,
        positionSizePercent: log.positionSizePercent ? parseFloat(log.positionSizePercent) : null,
        exitPrice: log.exitPrice ? parseFloat(log.exitPrice) : null,
        exitTime: log.exitTime,
        exitReason: log.exitReason,
        pnl: log.pnl ? parseFloat(log.pnl) : null,
        pnlPercent: log.pnlPercent ? parseFloat(log.pnlPercent) : null,
        status: log.status,
        marketConditions: log.marketConditions,
        holdDuration: log.holdDuration,
        maxDrawdown: log.maxDrawdown ? parseFloat(log.maxDrawdown) : null,
        maxProfit: log.maxProfit ? parseFloat(log.maxProfit) : null,
      }));
      
      return {
        logs: transformedLogs,
        total: result.total,
        hasMore: result.total > input.offset + input.limit,
      };
    }),

  /**
   * Get summary statistics for trade decisions
   */
  getStats: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      symbol: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      
      // Default to last 7 days if no date range specified
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const startDate = input.startDate ? new Date(input.startDate) : sevenDaysAgo;
      const endDate = input.endDate ? new Date(input.endDate) : now;
      
      return await tradeDecisionLogger.getStats({
        userId,
        startDate,
        endDate,
        symbol: input.symbol,
      });
    }),

  /**
   * Get available symbols from logs
   */
  getSymbols: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      
      // Get logs from last 30 days to find unique symbols
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const result = await tradeDecisionLogger.getLogs({
        userId,
        startDate: thirtyDaysAgo,
        endDate: now,
        limit: 1000,
      });
      
      const symbols = [...new Set(result.logs.map(log => log.symbol))];
      return symbols.sort();
    }),

  /**
   * Get a single trade decision log by ID
   */
  getById: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      
      const result = await tradeDecisionLogger.getLogs({
        userId,
        limit: 1000,
      });
      
      const log = result.logs.find(l => l.id === input.id);
      if (!log) {
        return null;
      }
      
      return {
        id: log.id,
        signalId: log.signalId,
        timestamp: log.timestamp,
        symbol: log.symbol,
        exchange: log.exchange,
        price: parseFloat(log.price),
        signalType: log.signalType,
        signalStrength: log.signalStrength ? parseFloat(log.signalStrength) : null,
        fastScore: log.fastScore ? parseFloat(log.fastScore) : null,
        slowBonus: log.slowBonus ? parseFloat(log.slowBonus) : null,
        totalConfidence: parseFloat(log.totalConfidence),
        threshold: parseFloat(log.threshold),
        agentScores: log.agentScores,
        decision: log.decision,
        decisionReason: log.decisionReason,
        positionId: log.positionId,
        orderId: log.orderId,
        entryPrice: log.entryPrice ? parseFloat(log.entryPrice) : null,
        quantity: log.quantity ? parseFloat(log.quantity) : null,
        positionSizePercent: log.positionSizePercent ? parseFloat(log.positionSizePercent) : null,
        exitPrice: log.exitPrice ? parseFloat(log.exitPrice) : null,
        exitTime: log.exitTime,
        exitReason: log.exitReason,
        pnl: log.pnl ? parseFloat(log.pnl) : null,
        pnlPercent: log.pnlPercent ? parseFloat(log.pnlPercent) : null,
        status: log.status,
        marketConditions: log.marketConditions,
        holdDuration: log.holdDuration,
        maxDrawdown: log.maxDrawdown ? parseFloat(log.maxDrawdown) : null,
        maxProfit: log.maxProfit ? parseFloat(log.maxProfit) : null,
      };
    }),
});
