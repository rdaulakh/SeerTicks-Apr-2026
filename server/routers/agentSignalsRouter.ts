import { protectedProcedure, router } from "../_core/trpc";
import { getActiveClock } from '../_core/clock';
import { z } from "zod";
import { getDb } from "../db";
import { agentSignals } from "../../drizzle/schema";
import { eq, desc, and, gte } from "drizzle-orm";

/**
 * Agent Signals Router
 * Provides access to historical agent signals for analysis and debugging
 */
export const agentSignalsRouter = router({
  /**
   * Get recent signals from all agents
   */
  getRecent: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      agentName: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const conditions = [eq(agentSignals.userId, ctx.user.id)];
      if (input.agentName) {
        conditions.push(eq(agentSignals.agentName, input.agentName));
      }

      const signals = await db
        .select()
        .from(agentSignals)
        .where(and(...conditions))
        .orderBy(desc(agentSignals.timestamp))
        .limit(input.limit);

      return signals;
    }),

  /**
   * Get signals for a specific agent
   */
  getByAgent: protectedProcedure
    .input(z.object({
      agentName: z.string(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const signals = await db
        .select()
        .from(agentSignals)
        .where(
          and(
            eq(agentSignals.userId, ctx.user.id),
            eq(agentSignals.agentName, input.agentName)
          )
        )
        .orderBy(desc(agentSignals.timestamp))
        .limit(input.limit);

      return signals;
    }),

  /**
   * Get signal statistics by agent
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Get all signals for the user
    const signals = await db
      .select()
      .from(agentSignals)
      .where(eq(agentSignals.userId, ctx.user.id))
      .orderBy(desc(agentSignals.timestamp));

    // Calculate statistics by agent
    const statsByAgent: Record<string, {
      totalSignals: number;
      bullishSignals: number;
      bearishSignals: number;
      neutralSignals: number;
      avgConfidence: number;
      avgExecutionScore: number;
      lastSignalTime: Date | null;
    }> = {};

    signals.forEach(signal => {
      if (!statsByAgent[signal.agentName]) {
        statsByAgent[signal.agentName] = {
          totalSignals: 0,
          bullishSignals: 0,
          bearishSignals: 0,
          neutralSignals: 0,
          avgConfidence: 0,
          avgExecutionScore: 0,
          lastSignalTime: null,
        };
      }

      const stats = statsByAgent[signal.agentName];
      stats.totalSignals++;

      if (signal.signalType === 'bullish') stats.bullishSignals++;
      else if (signal.signalType === 'bearish') stats.bearishSignals++;
      else stats.neutralSignals++;

      const confidence = parseFloat(signal.confidence || '0');
      stats.avgConfidence += confidence;

      if (signal.executionScore) {
        stats.avgExecutionScore += signal.executionScore;
      }

      if (!stats.lastSignalTime || signal.timestamp > stats.lastSignalTime) {
        stats.lastSignalTime = signal.timestamp;
      }
    });

    // Calculate averages
    Object.values(statsByAgent).forEach(stats => {
      if (stats.totalSignals > 0) {
        stats.avgConfidence /= stats.totalSignals;
        stats.avgExecutionScore /= stats.totalSignals;
      }
    });

    return statsByAgent;
  }),

  /**
   * Get recent pattern signals specifically
   */
  getPatternSignals: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      hoursAgo: z.number().min(1).max(168).default(24), // Last 24 hours by default
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const cutoffTime = new Date(getActiveClock().now() - input.hoursAgo * 60 * 60 * 1000);

      const signals = await db
        .select()
        .from(agentSignals)
        .where(
          and(
            eq(agentSignals.userId, ctx.user.id),
            eq(agentSignals.agentName, 'PatternMatcher'),
            gte(agentSignals.timestamp, cutoffTime)
          )
        )
        .orderBy(desc(agentSignals.timestamp))
        .limit(input.limit);

      return signals.map(signal => ({
        ...signal,
        // Parse signalData to extract pattern details
        patternDetails: typeof signal.signalData === 'object' ? signal.signalData : null,
      }));
    }),
});
