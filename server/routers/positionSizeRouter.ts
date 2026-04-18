/**
 * Position Size Router
 * tRPC procedures for Kelly Criterion position sizing recommendations
 */

import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { KellyCriterion } from '../portfolio/KellyCriterion';
import { getDb } from '../db';
import { trades } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export const positionSizeRouter = router({
  /**
   * Calculate Kelly Criterion position size for a symbol
   */
  calculatePositionSize: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      currentPrice: z.number().positive(),
      accountBalance: z.number().positive(),
      confidence: z.number().min(0).max(1),
      maxPositionSize: z.number().min(0).max(1).default(0.25).optional(),
      fractionOfKelly: z.number().min(0).max(1).default(0.5).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      // Calculate win rate and profit factor from historical trades
      const historicalTrades = await db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.userId, ctx.user.id),
            eq(trades.symbol, input.symbol),
            eq(trades.status, 'closed')
          )
        )
        .orderBy(sql`${trades.exitTime} DESC`)
        .limit(100); // Last 100 trades for this symbol

      // Default values if no historical data
      let winRate = 0.55; // Default 55% win rate
      let profitFactor = 2.0; // Default 2:1 profit factor

      if (historicalTrades.length >= 10) {
        // Calculate actual win rate
        const winningTrades = historicalTrades.filter(t => 
          parseFloat(t.pnl || '0') > 0
        );
        winRate = winningTrades.length / historicalTrades.length;

        // Calculate profit factor
        const totalProfit = historicalTrades
          .filter(t => parseFloat(t.pnl || '0') > 0)
          .reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
        
        const totalLoss = Math.abs(
          historicalTrades
            .filter(t => parseFloat(t.pnl || '0') < 0)
            .reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0)
        );

        if (totalLoss > 0) {
          profitFactor = totalProfit / totalLoss;
        }
      }

      // Calculate Kelly position size
      const result = KellyCriterion.calculatePositionSize({
        winRate,
        profitFactor,
        confidence: input.confidence,
        currentPrice: input.currentPrice,
        accountBalance: input.accountBalance,
        maxPositionSize: input.maxPositionSize || 0.25,
        fractionOfKelly: input.fractionOfKelly || 0.5,
      });

      return {
        ...result,
        winRate,
        profitFactor,
        historicalTradesCount: historicalTrades.length,
        usingDefaultMetrics: historicalTrades.length < 10,
      };
    }),

  /**
   * Get historical trading statistics for a symbol
   */
  getSymbolStatistics: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      limit: z.number().positive().default(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      const historicalTrades = await db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.userId, ctx.user.id),
            eq(trades.symbol, input.symbol),
            eq(trades.status, 'closed')
          )
        )
        .orderBy(sql`${trades.exitTime} DESC`)
        .limit(input.limit || 100);

      if (historicalTrades.length === 0) {
        return {
          totalTrades: 0,
          winRate: 0,
          profitFactor: 0,
          averageWin: 0,
          averageLoss: 0,
          largestWin: 0,
          largestLoss: 0,
          totalPnL: 0,
        };
      }

      const winningTrades = historicalTrades.filter(t => parseFloat(t.pnl || '0') > 0);
      const losingTrades = historicalTrades.filter(t => parseFloat(t.pnl || '0') < 0);

      const totalPnL = historicalTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
      const totalProfit = winningTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
      const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0));

      const averageWin = winningTrades.length > 0 ? totalProfit / winningTrades.length : 0;
      const averageLoss = losingTrades.length > 0 ? totalLoss / losingTrades.length : 0;

      const largestWin = winningTrades.length > 0 
        ? Math.max(...winningTrades.map(t => parseFloat(t.pnl || '0')))
        : 0;
      
      const largestLoss = losingTrades.length > 0
        ? Math.min(...losingTrades.map(t => parseFloat(t.pnl || '0')))
        : 0;

      return {
        totalTrades: historicalTrades.length,
        winRate: winningTrades.length / historicalTrades.length,
        profitFactor: totalLoss > 0 ? totalProfit / totalLoss : 0,
        averageWin,
        averageLoss,
        largestWin,
        largestLoss,
        totalPnL,
      };
    }),
});
