/**
 * Admin Router
 * 
 * Admin-only endpoints for risk management overrides and system controls
 * Requires user role to be 'admin'
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getRiskManager } from "../RiskManager";

// Admin-only procedure that checks user role
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
  return next({ ctx });
});

export const adminRouter = router({
  /**
   * Resume trading after circuit breaker halt
   */
  resumeTrading: adminProcedure
    .input(z.object({
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      await riskManager.manualOverride(ctx.user.id, input.reason);
      
      return {
        success: true,
        message: 'Trading resumed by admin',
      };
    }),

  /**
   * Override position size limit for specific trade
   */
  overridePositionSize: adminProcedure
    .input(z.object({
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      await riskManager.overridePositionSizeLimit(ctx.user.id, input.reason);
      
      return {
        success: true,
        message: 'Position size limit override granted',
      };
    }),

  /**
   * Override correlation limit for specific trade
   */
  overrideCorrelation: adminProcedure
    .input(z.object({
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      await riskManager.overrideCorrelationLimit(ctx.user.id, input.reason);
      
      return {
        success: true,
        message: 'Correlation limit override granted',
      };
    }),

  /**
   * Get all risk limit breaches for audit
   */
  getRiskBreaches: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(1000).default(100),
      resolved: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { riskLimitBreaches } = await import("../../drizzle/schema");
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
        .from(riskLimitBreaches)
        .orderBy(desc(riskLimitBreaches.createdAt))
        .limit(input.limit);

      if (input.resolved !== undefined) {
        query = query.where(eq(riskLimitBreaches.resolved, input.resolved)) as any;
      }

      const breaches = await query;
      
      return breaches;
    }),

  /**
   * Mark risk breach as resolved
   */
  resolveRiskBreach: adminProcedure
    .input(z.object({
      breachId: z.number(),
      resolution: z.string().min(10, "Resolution notes must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { riskLimitBreaches } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      await db
        .update(riskLimitBreaches)
        .set({
          resolved: true,
          resolvedAt: new Date(),
        })
        .where(eq(riskLimitBreaches.id, input.breachId));

      return {
        success: true,
        message: 'Risk breach marked as resolved',
      };
    }),

  /**
   * Get current risk manager state
   */
  getRiskState: adminProcedure.query(async ({ ctx }) => {
    const riskManager = getRiskManager();
    
    if (!riskManager) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Risk manager not initialized',
      });
    }

    return {
      state: riskManager.getRiskState(),
      limits: riskManager.getRiskLimits(),
      isHalted: riskManager.isTradingHalted(),
      haltReason: riskManager.getHaltReason(),
      isMacroVeto: riskManager.isMacroVeto(),
      macroVetoReason: riskManager.getMacroVetoReason(),
    };
  }),

  /**
   * Manually halt trading (emergency stop)
   */
  haltTrading: adminProcedure
    .input(z.object({
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    }))
    .mutation(async ({ ctx, input }) => {
      const riskManager = getRiskManager();
      
      if (!riskManager) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Risk manager not initialized',
        });
      }

      riskManager.haltTrading(input.reason);

      return {
        success: true,
        message: 'Trading halted by admin',
      };
    }),

  /**
   * Phase 13D: Clean up ghost data and price=0 trades
   * Run once to fix historical data corruption from the price=0 bug.
   * Paper trading only — recalculates wallet balance from corrected P&L.
   */
  cleanupGhostData: adminProcedure
    .mutation(async ({ ctx }) => {
      const { cleanupGhostData } = await import('../utils/cleanupGhostData');
      const result = await cleanupGhostData(ctx.user.id);
      return result;
    }),
});
