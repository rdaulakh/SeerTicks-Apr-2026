import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { paperPositions } from "../../drizzle/schema";
import { and, eq, gte, lte, sql, isNotNull, notLike } from "drizzle-orm";

export const pnlChartRouter = router({
  // Get date-wise P&L data for chart
  getDateWisePnl: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      strategy: z.string().optional(), // Filter by strategy type
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Build date filter conditions - only include closed PRODUCTION positions
      const conditions = [
        eq(paperPositions.userId, ctx.user.id),
        eq(paperPositions.status, "closed"),
        isNotNull(paperPositions.exitTime),
        notLike(paperPositions.strategy, '%test%'),
        notLike(paperPositions.strategy, '%demo%'),
        notLike(paperPositions.strategy, '%backtest%'),
      ];
      
      // Add strategy filter if provided
      if (input.strategy) {
        conditions.push(eq(paperPositions.strategy, input.strategy));
      }
      
      if (input.startDate) {
        conditions.push(gte(paperPositions.exitTime, new Date(input.startDate)));
      }
      
      if (input.endDate) {
        const endDate = new Date(input.endDate);
        endDate.setHours(23, 59, 59, 999); // Include entire end date
        conditions.push(lte(paperPositions.exitTime, endDate));
      }

      // Get all closed positions grouped by date
      const positions = await db
        .select({
          date: sql<string>`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`,
          totalPnl: sql<string>`COALESCE(SUM(${paperPositions.realizedPnl}), 0)`,
          totalCommission: sql<string>`COALESCE(SUM(${paperPositions.commission}), 0)`,
          netPnl: sql<string>`COALESCE(SUM(${paperPositions.realizedPnl} - ${paperPositions.commission}), 0)`,
          tradeCount: sql<number>`COUNT(*)`,
          winCount: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} > 0 THEN 1 ELSE 0 END)`,
          lossCount: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} <= 0 THEN 1 ELSE 0 END)`,
        })
        .from(paperPositions)
        .where(and(...conditions))
        .groupBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d')`)
        .orderBy(sql`DATE_FORMAT(${paperPositions.exitTime}, '%Y-%m-%d') ASC`);

      // Calculate cumulative P&L
      let cumulativePnl = 0;
      const chartData = positions.map((position) => {
        const netPnl = Number(position.netPnl);
        const totalCommission = Number(position.totalCommission);
        cumulativePnl += netPnl;
        return {
          date: position.date,
          dailyPnl: Number(netPnl.toFixed(2)),
          cumulativePnl: Number(cumulativePnl.toFixed(2)),
          totalCommission: Number(totalCommission.toFixed(2)),
          tradeCount: position.tradeCount,
          winCount: position.winCount,
          lossCount: position.lossCount,
          winRate: position.tradeCount > 0 
            ? Number(((position.winCount / position.tradeCount) * 100).toFixed(2))
            : 0,
        };
      });

      return {
        data: chartData,
        summary: {
          totalTrades: chartData.reduce((sum, d) => sum + d.tradeCount, 0),
          totalWins: chartData.reduce((sum, d) => sum + d.winCount, 0),
          totalLosses: chartData.reduce((sum, d) => sum + d.lossCount, 0),
          totalPnl: Number(cumulativePnl.toFixed(2)),
          totalCommission: Number(chartData.reduce((sum, d) => sum + d.totalCommission, 0).toFixed(2)),
        },
      };
    }),

  // Get detailed trades for a specific date
  getTradesByDate: protectedProcedure
    .input(z.object({
      date: z.string(), // ISO date string (YYYY-MM-DD)
      strategy: z.string().optional(), // Filter by strategy type
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const startDate = new Date(input.date);
      const endDate = new Date(input.date);
      endDate.setHours(23, 59, 59, 999);

      const tradeConditions = [
        eq(paperPositions.userId, ctx.user.id),
        eq(paperPositions.status, "closed"),
        isNotNull(paperPositions.exitTime),
        gte(paperPositions.exitTime, startDate),
        lte(paperPositions.exitTime, endDate),
      ];
      
      // Add strategy filter if provided
      if (input.strategy) {
        tradeConditions.push(eq(paperPositions.strategy, input.strategy));
      }

      const positions = await db
        .select()
        .from(paperPositions)
        .where(and(...tradeConditions))
        .orderBy(paperPositions.exitTime);

      return positions.map(position => {
        const realizedPnl = Number(position.realizedPnl || 0);
        const commission = Number(position.commission || 0);
        const entryPrice = Number(position.entryPrice);
        const quantity = Number(position.quantity);
        const exitPrice = Number(position.currentPrice); // currentPrice is the exit price for closed positions
        
        return {
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          quantity: quantity,
          entryPrice: entryPrice,
          exitPrice: exitPrice,
          entryTime: position.entryTime,
          exitTime: position.exitTime,
          realizedPnl: realizedPnl,
          commission: commission,
          netPnl: Number((realizedPnl - commission).toFixed(2)),
          pnlPercentage: entryPrice > 0 && quantity > 0
            ? Number(((realizedPnl / (entryPrice * quantity)) * 100).toFixed(2))
            : 0,
          strategy: position.strategy,
          exitReason: position.exitReason,
        };
      });  
    }),

  // Get list of all strategies used by the user
  getStrategies: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const strategies = await db
        .selectDistinct({ strategy: paperPositions.strategy })
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.userId, ctx.user.id),
            isNotNull(paperPositions.strategy)
          )
        );

      // Filter out null, undefined, and empty/whitespace-only strings
      return strategies
        .map(s => s.strategy)
        .filter((s): s is string => !!s && s.trim() !== '');
    }),

  // Get strategy breakdown summary
  getStrategyBreakdown: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const conditions = [
        eq(paperPositions.userId, ctx.user.id),
        eq(paperPositions.status, "closed"),
        isNotNull(paperPositions.exitTime),
        isNotNull(paperPositions.strategy),
        notLike(paperPositions.strategy, '%test%'),
        notLike(paperPositions.strategy, '%demo%'),
        notLike(paperPositions.strategy, '%backtest%'),
      ];
      
      if (input.startDate) {
        conditions.push(gte(paperPositions.exitTime, new Date(input.startDate)));
      }
      
      if (input.endDate) {
        const endDate = new Date(input.endDate);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(lte(paperPositions.exitTime, endDate));
      }

      const strategyStats = await db
        .select({
          strategy: paperPositions.strategy,
          totalTrades: sql<number>`COUNT(*)`,
          totalPnl: sql<string>`COALESCE(SUM(${paperPositions.realizedPnl}), 0)`,
          totalCommission: sql<string>`COALESCE(SUM(${paperPositions.commission}), 0)`,
          winCount: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} > 0 THEN 1 ELSE 0 END)`,
          lossCount: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} <= 0 THEN 1 ELSE 0 END)`,
        })
        .from(paperPositions)
        .where(and(...conditions))
        .groupBy(paperPositions.strategy);

      return strategyStats.map(stat => {
        const totalPnl = Number(stat.totalPnl);
        const totalCommission = Number(stat.totalCommission);
        return {
          strategy: stat.strategy,
          totalTrades: stat.totalTrades,
          totalPnl: Number(totalPnl.toFixed(2)),
          totalCommission: Number(totalCommission.toFixed(2)),
          netPnl: Number((totalPnl - totalCommission).toFixed(2)),
          winCount: stat.winCount,
          lossCount: stat.lossCount,
          winRate: stat.totalTrades > 0
            ? Number(((stat.winCount / stat.totalTrades) * 100).toFixed(2))
            : 0,
        };
      });
    }),
});
