import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { PositionReconciliationService } from "../services/PositionReconciliationService";
import { getReconciliationScheduler } from "../services/ReconciliationScheduler";
import { getDb } from "../db";
import { reconciliationLogs, positionDiscrepancies, reconciliationHistory } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * Reconciliation Router
 * 
 * tRPC procedures for position reconciliation management:
 * - Get reconciliation status and history
 * - Trigger manual reconciliation
 * - View and resolve discrepancies
 * - Get reconciliation statistics
 */

export const reconciliationRouter = router({
  /**
   * Get current reconciliation status
   * Returns last run info and unresolved discrepancies count
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const service = new PositionReconciliationService(ctx.user.id);
    const status = await service.getReconciliationStatus();

    if (!status) {
      return {
        lastRun: null,
        unresolvedCount: 0,
        schedulerStatus: getReconciliationScheduler().getStatus(),
      };
    }

    return {
      lastRun: status.lastRun,
      unresolvedCount: status.unresolvedDiscrepancies.length,
      schedulerStatus: getReconciliationScheduler().getStatus(),
    };
  }),

  /**
   * Get reconciliation history
   * Returns paginated list of reconciliation runs
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { logs: [], total: 0 };

      const logs = await db
        .select()
        .from(reconciliationLogs)
        .where(eq(reconciliationLogs.userId, ctx.user.id))
        .orderBy(desc(reconciliationLogs.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get total count (simplified - in production, use a separate count query)
      const total = logs.length;

      return {
        logs,
        total,
      };
    }),

  /**
   * Get discrepancies for a specific reconciliation run
   */
  getDiscrepancies: protectedProcedure
    .input(
      z.object({
        reconciliationLogId: z.number().optional(),
        resolved: z.boolean().optional(),
        severity: z.enum(["critical", "warning", "info"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { discrepancies: [] };

      let query = db
        .select()
        .from(positionDiscrepancies)
        .where(eq(positionDiscrepancies.userId, ctx.user.id))
        .$dynamic();

      // Apply filters
      if (input.reconciliationLogId !== undefined) {
        query = query.where(
          and(
            eq(positionDiscrepancies.userId, ctx.user.id),
            eq(positionDiscrepancies.reconciliationLogId, input.reconciliationLogId)
          )
        );
      }

      if (input.resolved !== undefined) {
        query = query.where(
          and(
            eq(positionDiscrepancies.userId, ctx.user.id),
            eq(positionDiscrepancies.resolved, input.resolved)
          )
        );
      }

      if (input.severity !== undefined) {
        query = query.where(
          and(
            eq(positionDiscrepancies.userId, ctx.user.id),
            eq(positionDiscrepancies.severity, input.severity)
          )
        );
      }

      const discrepancies = await query
        .orderBy(desc(positionDiscrepancies.createdAt))
        .limit(input.limit);

      return {
        discrepancies,
      };
    }),

  /**
   * Get detailed history for a specific discrepancy
   */
  getDiscrepancyHistory: protectedProcedure
    .input(
      z.object({
        discrepancyId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { history: [] };

      const history = await db
        .select()
        .from(reconciliationHistory)
        .where(
          and(
            eq(reconciliationHistory.userId, ctx.user.id),
            eq(reconciliationHistory.discrepancyId, input.discrepancyId)
          )
        )
        .orderBy(desc(reconciliationHistory.createdAt));

      return {
        history,
      };
    }),

  /**
   * Trigger manual reconciliation
   */
  triggerManual: protectedProcedure.mutation(async ({ ctx }) => {
    const scheduler = getReconciliationScheduler();
    
    try {
      const result = await scheduler.triggerManual(ctx.user.id);
      
      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error("[Reconciliation] Manual trigger failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }),

  /**
   * Manually resolve a discrepancy
   */
  resolveDiscrepancy: protectedProcedure
    .input(
      z.object({
        discrepancyId: z.number(),
        resolution: z.enum(["sync_local", "sync_exchange", "ignore"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new PositionReconciliationService(ctx.user.id);

      try {
        await service.manualResolve(
          input.discrepancyId,
          input.resolution,
          input.notes
        );

        return {
          success: true,
        };
      } catch (error) {
        console.error("[Reconciliation] Manual resolution failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Get reconciliation statistics
   */
  getStats: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        return {
          totalRuns: 0,
          totalDiscrepancies: 0,
          autoResolved: 0,
          manualResolved: 0,
          unresolvedCount: 0,
          avgExecutionTimeMs: 0,
          successRate: 0,
        };
      }

      // Get logs from the last N days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.days);

      const logs = await db
        .select()
        .from(reconciliationLogs)
        .where(eq(reconciliationLogs.userId, ctx.user.id))
        .orderBy(desc(reconciliationLogs.createdAt));

      // Calculate statistics
      const totalRuns = logs.length;
      const successfulRuns = logs.filter(l => l.status === "completed").length;
      const failedRuns = logs.filter(l => l.status === "failed").length;

      const totalDiscrepancies = logs.reduce((sum, log) => sum + (log.discrepanciesFound || 0), 0);
      const autoResolved = logs.reduce((sum, log) => sum + (log.autoResolved || 0), 0);
      const manualReviewRequired = logs.reduce((sum, log) => sum + (log.manualReviewRequired || 0), 0);

      const avgExecutionTimeMs = logs.length > 0
        ? logs.reduce((sum, log) => sum + (log.executionTimeMs || 0), 0) / logs.length
        : 0;

      const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

      // Get unresolved discrepancies count
      const unresolvedDiscrepancies = await db
        .select()
        .from(positionDiscrepancies)
        .where(
          and(
            eq(positionDiscrepancies.userId, ctx.user.id),
            eq(positionDiscrepancies.resolved, false)
          )
        );

      return {
        totalRuns,
        successfulRuns,
        failedRuns,
        totalDiscrepancies,
        autoResolved,
        manualResolved: totalDiscrepancies - autoResolved - unresolvedDiscrepancies.length,
        unresolvedCount: unresolvedDiscrepancies.length,
        avgExecutionTimeMs: Math.round(avgExecutionTimeMs),
        successRate: Math.round(successRate * 100) / 100,
      };
    }),

  /**
   * Enable/disable automatic reconciliation for current user
   */
  toggleAutoReconciliation: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scheduler = getReconciliationScheduler();

      if (input.enabled) {
        scheduler.addUser(ctx.user.id);
      } else {
        scheduler.removeUser(ctx.user.id);
      }

      return {
        success: true,
        enabled: input.enabled,
      };
    }),
});
