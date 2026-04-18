/**
 * Portfolio Rebalancing Router
 * 
 * tRPC endpoints for:
 * - Manual rebalancing trigger
 * - Rebalancing configuration
 * - Rebalancing history
 * - Portfolio risk metrics
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { PortfolioRebalancer, RebalancingConfig } from '../portfolio/PortfolioRebalancer';
import { PortfolioRiskCalculator } from '../portfolio/PortfolioRiskCalculator';
import { KellyCriterion } from '../portfolio/KellyCriterion';
import { positionManager } from '../PositionManager';
import { getDb, getPaperWallet, getTradingModeConfig } from '../db';
import { positions, agentSignals, paperPositions } from '../../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

/**
 * Compute real win rate and profit factor from closed positions for a given symbol
 */
async function getSymbolTradeStats(userId: number, symbol: string): Promise<{ winRate: number; profitFactor: number }> {
  const db = await getDb();
  if (!db) return { winRate: 0.5, profitFactor: 1.0 };

  const tradingMode = ((await getTradingModeConfig(userId))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';

  const closed = await db.select({
    realizedPnl: paperPositions.realizedPnl,
  }).from(paperPositions).where(
    and(
      eq(paperPositions.userId, userId),
      eq(paperPositions.symbol, symbol),
      eq(paperPositions.status, 'closed'),
      eq(paperPositions.tradingMode, tradingMode),
    )
  );

  if (closed.length === 0) return { winRate: 0.5, profitFactor: 1.0 };

  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const row of closed) {
    const pnl = parseFloat(row.realizedPnl || '0');
    if (pnl > 0) { wins++; grossProfit += pnl; }
    else { grossLoss += Math.abs(pnl); }
  }

  const winRate = wins / closed.length;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10.0 : 1.0;
  return { winRate, profitFactor };
}

// Global rebalancer instance (singleton)
let globalRebalancer: PortfolioRebalancer | null = null;

function getRebalancer(): PortfolioRebalancer {
  if (!globalRebalancer) {
    globalRebalancer = new PortfolioRebalancer(positionManager);
  }
  return globalRebalancer;
}

export const portfolioRouter = router({
  /**
   * Get current rebalancing configuration
   */
  getConfig: protectedProcedure.query(async () => {
    const rebalancer = getRebalancer();
    return rebalancer.getConfig();
  }),

  /**
   * Update rebalancing configuration
   */
  updateConfig: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        minConfidenceThreshold: z.number().min(0).max(1).optional(),
        maxPositionSize: z.number().min(0).max(1).optional(),
        fractionOfKelly: z.number().min(0).max(1).optional(),
        rebalanceIntervalMinutes: z.number().min(1).optional(),
        deviationThreshold: z.number().min(0).optional(),
        confidenceChangeThreshold: z.number().min(0).max(1).optional(),
        maxSymbols: z.number().min(1).optional(),
        minPositionSizeUSD: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rebalancer = getRebalancer();
      rebalancer.updateConfig(input as Partial<RebalancingConfig>);
      return { success: true, config: rebalancer.getConfig() };
    }),

  /**
   * Enable/disable rebalancing
   */
  setEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const rebalancer = getRebalancer();
      rebalancer.setEnabled(input.enabled);
      return { success: true, enabled: input.enabled };
    }),

  /**
   * Manually trigger rebalancing
   */
  triggerRebalance: protectedProcedure.mutation(async ({ ctx }) => {
    const rebalancer = getRebalancer();
    const db = await getDb();

    if (!db) {
      throw new Error('Database not available');
    }

    // Get current positions
    const currentPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.userId, ctx.user.id));

    // Get latest agent signals for confidence scores
    const latestSignals = await db
      .select()
      .from(agentSignals)
      .where(eq(agentSignals.userId, ctx.user.id))
      .orderBy(desc(agentSignals.timestamp))
      .limit(100);

    // Group signals by symbol and calculate average confidence
    const symbolConfidence: Map<string, number> = new Map();
    const symbolCounts: Map<string, number> = new Map();

    for (const signal of latestSignals) {
      const data = signal.signalData as any;
      const symbol = data.symbol || 'UNKNOWN';
      const confidence = signal.confidence ? parseFloat(signal.confidence) : 0.5;

      symbolConfidence.set(symbol, (symbolConfidence.get(symbol) || 0) + confidence);
      symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
    }

    // Calculate average confidence per symbol
    const avgConfidence: Map<string, number> = new Map();
    for (const [symbol, totalConfidence] of Array.from(symbolConfidence.entries())) {
      const count = symbolCounts.get(symbol) || 1;
      avgConfidence.set(symbol, totalConfidence / count);
    }

    // Build symbol metrics with real win rate + profit factor from closed trades
    const symbolMetrics = await Promise.all(currentPositions.map(async (pos) => {
      const stats = await getSymbolTradeStats(ctx.user.id, pos.symbol);
      return {
        symbol: pos.symbol,
        winRate: stats.winRate,
        profitFactor: stats.profitFactor,
        confidence: avgConfidence.get(pos.symbol) || 0.5,
        currentPrice: parseFloat(pos.entryPrice), // Use entry price as fallback until live price feed
        currentPositionSizeUSD: parseFloat(pos.quantity) * parseFloat(pos.entryPrice),
      };
    }));

    // Get real account balance from wallet
    const tradingMode = ((await getTradingModeConfig(ctx.user.id))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
    const wallet = await getPaperWallet(ctx.user.id, tradingMode);
    const accountBalance = wallet ? parseFloat(wallet.balance) : 10000;

    // Execute rebalancing with real balance
    const result = await rebalancer.rebalance(symbolMetrics, 'manual', accountBalance);

    return result;
  }),

  /**
   * Get rebalancing history
   */
  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const rebalancer = getRebalancer();
      return await rebalancer.getRebalancingHistory(input.limit);
    }),

  /**
   * Calculate Kelly Criterion position size for a symbol
   */
  calculateKellyPosition: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        winRate: z.number().min(0).max(1),
        profitFactor: z.number().min(0),
        confidence: z.number().min(0).max(1),
        currentPrice: z.number().min(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const tradingMode = ((await getTradingModeConfig(ctx.user.id))?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      const wallet = await getPaperWallet(ctx.user.id, tradingMode);
      const accountBalance = wallet ? parseFloat(wallet.balance) : 10000;

      const result = KellyCriterion.calculatePositionSize({
        ...input,
        accountBalance,
      });

      return result;
    }),

  /**
   * Get portfolio risk metrics
   */
  getRiskMetrics: protectedProcedure
    .input(z.object({ lookbackDays: z.number().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const calculator = new PortfolioRiskCalculator();
      return await calculator.calculateRiskMetrics(ctx.user.id, input.lookbackDays);
    }),

  /**
   * Get historical risk metrics
   */
  getHistoricalRiskMetrics: protectedProcedure
    .input(z.object({ lookbackDays: z.number().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const calculator = new PortfolioRiskCalculator();
      return await calculator.getHistoricalMetrics(ctx.user.id, input.lookbackDays);
    }),

  /**
   * Check if rebalancing should be triggered
   */
  shouldRebalance: protectedProcedure.query(async ({ ctx }) => {
    const rebalancer = getRebalancer();
    const db = await getDb();

    if (!db) {
      return { shouldRebalance: false };
    }

    // Get current positions
    const currentPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.userId, ctx.user.id));

    // Get latest signals for confidence
    const latestSignals = await db
      .select()
      .from(agentSignals)
      .where(eq(agentSignals.userId, ctx.user.id))
      .orderBy(desc(agentSignals.timestamp))
      .limit(100);

    // Calculate average confidence per symbol
    const symbolConfidence: Map<string, number> = new Map();
    const symbolCounts: Map<string, number> = new Map();

    for (const signal of latestSignals) {
      const data = signal.signalData as any;
      const symbol = data.symbol || 'UNKNOWN';
      const confidence = signal.confidence ? parseFloat(signal.confidence) : 0.5;

      symbolConfidence.set(symbol, (symbolConfidence.get(symbol) || 0) + confidence);
      symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
    }

    const avgConfidence: Map<string, number> = new Map();
    for (const [symbol, totalConfidence] of Array.from(symbolConfidence.entries())) {
      const count = symbolCounts.get(symbol) || 1;
      avgConfidence.set(symbol, totalConfidence / count);
    }

    // Build symbol metrics with real trade stats
    const symbolMetrics = await Promise.all(currentPositions.map(async (pos) => {
      const stats = await getSymbolTradeStats(ctx.user.id, pos.symbol);
      return {
        symbol: pos.symbol,
        winRate: stats.winRate,
        profitFactor: stats.profitFactor,
        confidence: avgConfidence.get(pos.symbol) || 0.5,
        currentPrice: parseFloat(pos.entryPrice),
        currentPositionSizeUSD: parseFloat(pos.quantity) * parseFloat(pos.entryPrice),
      };
    }));

    return rebalancer.shouldRebalance(symbolMetrics);
  }),
});
