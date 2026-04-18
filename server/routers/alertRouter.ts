/**
 * Alert Router
 * tRPC endpoints for alert notification management
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getAlertService } from "../services/AlertNotificationService";

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

export const alertRouter = router({
  /**
   * Get all alerts
   */
  getAll: protectedProcedure.query(async () => {
    const alertService = getAlertService();
    return alertService.getAllAlerts();
  }),

  /**
   * Get alerts by type
   */
  getByType: protectedProcedure
    .input(z.object({
      type: z.enum(['cpu', 'memory', 'error_rate', 'position_loss', 'database', 'websocket']),
    }))
    .query(async ({ input }) => {
      const alertService = getAlertService();
      return alertService.getAlertsByType(input.type);
    }),

  /**
   * Get alerts by severity
   */
  getBySeverity: protectedProcedure
    .input(z.object({
      severity: z.enum(['critical', 'warning', 'info']),
    }))
    .query(async ({ input }) => {
      const alertService = getAlertService();
      return alertService.getAlertsBySeverity(input.severity);
    }),

  /**
   * Get alert service status
   */
  getStatus: protectedProcedure.query(async () => {
    const alertService = getAlertService();
    return alertService.getStatus();
  }),

  /**
   * Clear old alerts
   */
  clearOld: adminProcedure.mutation(async () => {
    const alertService = getAlertService();
    alertService.clearOldAlerts();
    return { success: true };
  }),

  /**
   * Manually trigger position loss alert
   */
  triggerPositionLoss: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      loss: z.number(),
      positionId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const alertService = getAlertService();
      alertService.alertPositionLoss(input.symbol, input.loss, input.positionId);
      return { success: true };
    }),

  /**
   * Manually trigger database failure alert
   */
  triggerDatabaseFailure: adminProcedure
    .input(z.object({
      error: z.string(),
    }))
    .mutation(async ({ input }) => {
      const alertService = getAlertService();
      alertService.alertDatabaseFailure(input.error);
      return { success: true };
    }),

  /**
   * Manually trigger WebSocket disconnection alert
   */
  triggerWebSocketDisconnection: protectedProcedure
    .input(z.object({
      exchange: z.string(),
      symbol: z.string(),
    }))
    .mutation(async ({ input }) => {
      const alertService = getAlertService();
      alertService.alertWebSocketDisconnection(input.exchange, input.symbol);
      return { success: true };
    }),
});
