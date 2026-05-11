/**
 * tcaRouter — Phase 69
 *
 * Post-trade Transaction Cost Analysis dashboard.
 * Surfaces slippage percentiles, stage distribution, cap-breach rate,
 * and per-trace latency from the tcaLog table.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getDb } from '../db';
import { tcaLog } from '../../drizzle/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

const WINDOW_HOURS = z.number().int().min(1).max(720).default(24);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export const tcaRouter = router({
  /** Aggregate TCA stats over a rolling window. */
  getStats: protectedProcedure
    .input(z.object({ windowHours: WINDOW_HOURS }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const since = new Date(Date.now() - input.windowHours * 60 * 60 * 1000);

      const rows = await db
        .select()
        .from(tcaLog)
        .where(gte(tcaLog.timestamp, since));

      if (rows.length === 0) {
        return {
          windowHours: input.windowHours,
          totalFills: 0,
          slippage: { p50: 0, p95: 0, p99: 0, mean: 0 },
          latencyMs: { p50: 0, p95: 0, p99: 0 },
          stageDistribution: { stage1: 0, stage2: 0, stage3: 0 },
          breachRate: 0,
          partialFillRate: 0,
        };
      }

      const slippageBps = rows.map((r: any) => Math.abs(parseFloat(r.slippageBps)));
      const latencies = rows.map((r: any) => r.totalLatencyMs);
      const breaches = rows.filter((r: any) => r.exceededCap === 1).length;
      const partials = rows.filter((r: any) => r.partialFill === 1).length;
      const stage1 = rows.filter((r: any) => r.stageReached === 1).length;
      const stage2 = rows.filter((r: any) => r.stageReached === 2).length;
      const stage3 = rows.filter((r: any) => r.stageReached === 3).length;

      return {
        windowHours: input.windowHours,
        totalFills: rows.length,
        slippage: {
          p50: percentile(slippageBps, 0.5),
          p95: percentile(slippageBps, 0.95),
          p99: percentile(slippageBps, 0.99),
          mean: slippageBps.reduce((s, v) => s + v, 0) / slippageBps.length,
        },
        latencyMs: {
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          p99: percentile(latencies, 0.99),
        },
        stageDistribution: {
          stage1: rows.length > 0 ? stage1 / rows.length : 0,
          stage2: rows.length > 0 ? stage2 / rows.length : 0,
          stage3: rows.length > 0 ? stage3 / rows.length : 0,
        },
        breachRate: rows.length > 0 ? breaches / rows.length : 0,
        partialFillRate: rows.length > 0 ? partials / rows.length : 0,
      };
    }),

  /** Per-symbol breakdown for the dashboard. */
  getPerSymbol: protectedProcedure
    .input(z.object({ windowHours: WINDOW_HOURS }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date(Date.now() - input.windowHours * 60 * 60 * 1000);

      const rows = await db
        .select({
          symbol: tcaLog.symbol,
          count: sql<number>`count(*)`,
          avgSlippageBps: sql<number>`avg(abs(slippageBps))`,
          maxSlippageBps: sql<number>`max(abs(slippageBps))`,
          avgLatencyMs: sql<number>`avg(totalLatencyMs)`,
          breaches: sql<number>`sum(exceededCap)`,
        })
        .from(tcaLog)
        .where(gte(tcaLog.timestamp, since))
        .groupBy(tcaLog.symbol)
        .orderBy(desc(sql`count(*)`));

      return rows;
    }),

  /** Latest N fills (raw) for diagnostic drill-down. */
  getRecentFills: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(tcaLog)
        .orderBy(desc(tcaLog.timestamp))
        .limit(input.limit);
      return rows;
    }),
});
