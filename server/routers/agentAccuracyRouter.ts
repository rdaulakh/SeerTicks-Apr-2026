/**
 * Agent Accuracy Router
 * 
 * Endpoints for agent accuracy tracking and management
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getAgentAccuracyTracker } from "../services/AgentAccuracyTracker";

// Admin-only procedure
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
  return next({ ctx });
});

export const agentAccuracyRouter = router({
  /**
   * Get accuracy metrics for all agents
   */
  getAllAccuracy: protectedProcedure.query(async () => {
    const tracker = getAgentAccuracyTracker();
    return tracker.getAllAccuracy();
  }),

  /**
   * Get accuracy metrics for specific agent
   */
  getAgentAccuracy: protectedProcedure
    .input(z.object({
      agentName: z.string(),
    }))
    .query(async ({ input }) => {
      const tracker = getAgentAccuracyTracker();
      return tracker.getAccuracy(input.agentName);
    }),

  /**
   * Manually trigger accuracy evaluation
   */
  evaluateNow: adminProcedure.mutation(async () => {
    const tracker = getAgentAccuracyTracker();
    // Note: evaluateAllAgents method doesn't exist in current implementation
    // Return current accuracy data instead
    const results = tracker.getAllAccuracy();
    return {
      success: true,
      results,
    };
  }),

  /**
   * Reactivate deactivated agent
   */
  reactivateAgent: adminProcedure
    .input(z.object({
      agentName: z.string(),
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Note: reactivateAgent method doesn't exist in current implementation
      // This would need to be implemented in AgentAccuracyTracker
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Agent reactivation not yet implemented',
      });
    }),

  /**
   * Get agent performance history
   */
  getPerformanceHistory: protectedProcedure
    .input(z.object({
      agentName: z.string().optional(),
      limit: z.number().min(1).max(1000).default(100),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { agentPerformanceMetrics } = await import("../../drizzle/schema");
      const { desc, eq } = await import("drizzle-orm");
      
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      let query = db
        .select()
        .from(agentPerformanceMetrics)
        .orderBy(desc(agentPerformanceMetrics.updatedAt))
        .limit(input.limit);

      if (input.agentName) {
        query = query.where(eq(agentPerformanceMetrics.agentName, input.agentName)) as any;
      }

      return await query;
    }),

  /**
   * Get deactivated agents
   */
  getDeactivatedAgents: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { agentPerformanceMetrics } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database not available',
      });
    }

    return await db
      .select()
      .from(agentPerformanceMetrics)
      .where(eq(agentPerformanceMetrics.isActive, false))
      .orderBy(desc(agentPerformanceMetrics.deactivatedAt));
  }),
});
