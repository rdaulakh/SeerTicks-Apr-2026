import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { paperPositions, positions } from "../drizzle/schema";

/**
 * Get closed paper trading positions (order history)
 * Supports filtering by date range, symbol, and exit reason
 */
export async function getClosedPaperPositions(
  userId: number,
  filters?: {
    startDate?: Date;
    endDate?: Date;
    symbol?: string;
    exitReason?: string;
  }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    eq(paperPositions.userId, userId),
    eq(paperPositions.status, 'closed')
  ];

  if (filters?.startDate) {
    conditions.push(gte(paperPositions.exitTime, filters.startDate));
  }

  if (filters?.endDate) {
    conditions.push(lte(paperPositions.exitTime, filters.endDate));
  }

  if (filters?.symbol) {
    conditions.push(eq(paperPositions.symbol, filters.symbol));
  }

  if (filters?.exitReason) {
    conditions.push(eq(paperPositions.exitReason, filters.exitReason as any));
  }

  const result = await db
    .select()
    .from(paperPositions)
    .where(and(...conditions))
    .orderBy(desc(paperPositions.exitTime));

  return result;
}

/**
 * Get closed live trading positions (order history)
 * Supports filtering by date range, symbol, and exit reason
 */
export async function getClosedLivePositions(
  userId: number,
  filters?: {
    startDate?: Date;
    endDate?: Date;
    symbol?: string;
    exitReason?: string;
  }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    eq(positions.userId, userId),
    eq(positions.status, 'closed')
  ];

  if (filters?.startDate) {
    conditions.push(gte(positions.exitTime, filters.startDate));
  }

  if (filters?.endDate) {
    conditions.push(lte(positions.exitTime, filters.endDate));
  }

  if (filters?.symbol) {
    conditions.push(eq(positions.symbol, filters.symbol));
  }

  if (filters?.exitReason) {
    conditions.push(eq(positions.exitReason, filters.exitReason as any));
  }

  const result = await db
    .select()
    .from(positions)
    .where(and(...conditions))
    .orderBy(desc(positions.exitTime));

  return result;
}

/**
 * Get order history analytics for paper trading
 */
export async function getPaperOrderAnalytics(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      totalTrades: sql<number>`COUNT(*)`,
      totalProfit: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} > 0 THEN ${paperPositions.realizedPnl} ELSE 0 END)`,
      totalLoss: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} < 0 THEN ${paperPositions.realizedPnl} ELSE 0 END)`,
      netPnl: sql<number>`SUM(${paperPositions.realizedPnl})`,
      winningTrades: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} > 0 THEN 1 ELSE 0 END)`,
      losingTrades: sql<number>`SUM(CASE WHEN ${paperPositions.realizedPnl} < 0 THEN 1 ELSE 0 END)`,
      avgWin: sql<number>`AVG(CASE WHEN ${paperPositions.realizedPnl} > 0 THEN ${paperPositions.realizedPnl} ELSE NULL END)`,
      avgLoss: sql<number>`AVG(CASE WHEN ${paperPositions.realizedPnl} < 0 THEN ${paperPositions.realizedPnl} ELSE NULL END)`,
      largestWin: sql<number>`MAX(${paperPositions.realizedPnl})`,
      largestLoss: sql<number>`MIN(${paperPositions.realizedPnl})`,
      avgTradeDuration: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${paperPositions.createdAt}, ${paperPositions.exitTime}))`,
    })
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'closed'),
        // Phase 23: Exclude positions with NULL P&L (data_integrity_issue)
        isNotNull(paperPositions.realizedPnl),
        isNotNull(paperPositions.exitPrice)
      )
    );

  if (!result || result.length === 0) {
    return {
      totalTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      netPnl: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradeDuration: 0,
      profitFactor: 0,
    };
  }

  const stats = result[0];
  const winRate = stats.totalTrades > 0 
    ? (stats.winningTrades / stats.totalTrades) * 100 
    : 0;
  const profitFactor = stats.totalLoss !== 0 
    ? Math.abs(stats.totalProfit / stats.totalLoss) 
    : 0;

  return {
    totalTrades: Number(stats.totalTrades) || 0,
    totalProfit: Number(stats.totalProfit) || 0,
    totalLoss: Number(stats.totalLoss) || 0,
    netPnl: Number(stats.netPnl) || 0,
    winningTrades: Number(stats.winningTrades) || 0,
    losingTrades: Number(stats.losingTrades) || 0,
    winRate: Number(winRate.toFixed(2)),
    avgWin: Number(stats.avgWin) || 0,
    avgLoss: Number(stats.avgLoss) || 0,
    largestWin: Number(stats.largestWin) || 0,
    largestLoss: Number(stats.largestLoss) || 0,
    avgTradeDuration: Number(stats.avgTradeDuration) || 0,
    profitFactor: Number(profitFactor.toFixed(2)),
  };
}

/**
 * Get order history analytics for live trading
 */
export async function getLiveOrderAnalytics(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      totalTrades: sql<number>`COUNT(*)`,
      totalProfit: sql<number>`SUM(CASE WHEN ${positions.realizedPnl} > 0 THEN ${positions.realizedPnl} ELSE 0 END)`,
      totalLoss: sql<number>`SUM(CASE WHEN ${positions.realizedPnl} < 0 THEN ${positions.realizedPnl} ELSE 0 END)`,
      netPnl: sql<number>`SUM(${positions.realizedPnl})`,
      winningTrades: sql<number>`SUM(CASE WHEN ${positions.realizedPnl} > 0 THEN 1 ELSE 0 END)`,
      losingTrades: sql<number>`SUM(CASE WHEN ${positions.realizedPnl} < 0 THEN 1 ELSE 0 END)`,
      avgWin: sql<number>`AVG(CASE WHEN ${positions.realizedPnl} > 0 THEN ${positions.realizedPnl} ELSE NULL END)`,
      avgLoss: sql<number>`AVG(CASE WHEN ${positions.realizedPnl} < 0 THEN ${positions.realizedPnl} ELSE NULL END)`,
      largestWin: sql<number>`MAX(${positions.realizedPnl})`,
      largestLoss: sql<number>`MIN(${positions.realizedPnl})`,
      avgTradeDuration: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${positions.createdAt}, ${positions.exitTime}))`,
    })
    .from(positions)
    .where(
      and(
        eq(positions.userId, userId),
        eq(positions.status, 'closed')
      )
    );

  if (!result || result.length === 0) {
    return {
      totalTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      netPnl: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradeDuration: 0,
      profitFactor: 0,
    };
  }

  const stats = result[0];
  const winRate = stats.totalTrades > 0 
    ? (stats.winningTrades / stats.totalTrades) * 100 
    : 0;
  const profitFactor = stats.totalLoss !== 0 
    ? Math.abs(stats.totalProfit / stats.totalLoss) 
    : 0;

  return {
    totalTrades: Number(stats.totalTrades) || 0,
    totalProfit: Number(stats.totalProfit) || 0,
    totalLoss: Number(stats.totalLoss) || 0,
    netPnl: Number(stats.netPnl) || 0,
    winningTrades: Number(stats.winningTrades) || 0,
    losingTrades: Number(stats.losingTrades) || 0,
    winRate: Number(winRate.toFixed(2)),
    avgWin: Number(stats.avgWin) || 0,
    avgLoss: Number(stats.avgLoss) || 0,
    largestWin: Number(stats.largestWin) || 0,
    largestLoss: Number(stats.largestLoss) || 0,
    avgTradeDuration: Number(stats.avgTradeDuration) || 0,
    profitFactor: Number(profitFactor.toFixed(2)),
  };
}

/**
 * Get unique symbols from closed positions
 */
export async function getClosedPositionSymbols(userId: number, isPaper: boolean = true) {
  const db = await getDb();
  if (!db) return [];

  const table = isPaper ? paperPositions : positions;

  const result = await db
    .selectDistinct({ symbol: table.symbol })
    .from(table)
    .where(
      and(
        eq(table.userId, userId),
        eq(table.status, 'closed')
      )
    );

  return result.map(r => r.symbol);
}
