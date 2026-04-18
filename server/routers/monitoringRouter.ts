/**
 * Monitoring Router
 * API endpoints for accessing monitoring metrics, disk usage, and cleanup status
 */

import { z } from 'zod';
import { adminProcedure, router } from '../_core/trpc';
import { monitoringService } from '../services/MonitoringService';
import { databaseCleanupService } from '../services/DatabaseCleanupService';
import { diskUsageMonitor } from '../services/DiskUsageMonitor';
import { slowDeathMonitor } from '../services/SlowDeathMonitor';
import { tickStalenessMonitor } from '../services/TickStalenessMonitor';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  systemHeartbeat,
  serviceEvents,
  apiConnectionLog,
  websocketHealthLog,
  exitDecisionLog,
  capitalUtilization,
  positionSizingLog,
  entryValidationLog,
  alertLog,
  tradingPipelineLog,
} from '../../drizzle/schema';

export const monitoringRouter = router({
  /**
   * Get current monitoring snapshot
   */
  getCurrentSnapshot: adminProcedure.query(async () => {
    return await monitoringService.getCurrentSnapshot();
  }),

  /**
   * Get metrics history for a time window
   */
  getHistory: adminProcedure
    .input(
      z
        .object({
          windowMs: z.number().positive().default(300000).optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const windowMs = input?.windowMs || 300000; // Default: 5 minutes
      return monitoringService.getHistory(windowMs);
    }),

  /**
   * Get system health status
   */
  getHealthStatus: adminProcedure.query(async () => {
    const snapshot = await monitoringService.getCurrentSnapshot();
    
    // Determine health status based on metrics
    const isHealthy = 
      snapshot.system.cpu.usage < 80 &&
      snapshot.system.memory.usagePercent < 85 &&
      snapshot.system.disk.usagePercent < 90 &&
      snapshot.api.errorRate < 5;

    const warnings: string[] = [];
    
    if (snapshot.system.cpu.usage >= 80) {
      warnings.push(`High CPU usage: ${snapshot.system.cpu.usage.toFixed(1)}%`);
    }
    if (snapshot.system.memory.usagePercent >= 85) {
      warnings.push(`High memory usage: ${snapshot.system.memory.usagePercent.toFixed(1)}%`);
    }
    if (snapshot.system.disk.usagePercent >= 90) {
      warnings.push(`High disk usage: ${snapshot.system.disk.usagePercent.toFixed(1)}%`);
    }
    if (snapshot.api.errorRate >= 5) {
      warnings.push(`High API error rate: ${snapshot.api.errorRate.toFixed(1)}%`);
    }

    return {
      healthy: isHealthy,
      warnings,
      snapshot,
    };
  }),

  // ========================================
  // DATABASE CLEANUP ENDPOINTS
  // ========================================

  /**
   * Get database cleanup service status
   */
  getCleanupStatus: adminProcedure.query(() => {
    return databaseCleanupService.getStatus();
  }),

  /**
   * Get last cleanup statistics
   */
  getLastCleanupStats: adminProcedure.query(() => {
    return databaseCleanupService.getLastCleanupStats();
  }),

  /**
   * Get cleanup history
   */
  getCleanupHistory: adminProcedure.query(() => {
    return databaseCleanupService.getCleanupHistory();
  }),

  /**
   * Force run cleanup immediately
   */
  forceCleanup: adminProcedure.mutation(async () => {
    const stats = await databaseCleanupService.forceCleanup();
    return {
      success: true,
      stats,
      message: `Cleanup completed: ${stats.reduce((sum, s) => sum + s.deletedRows, 0)} rows deleted`,
    };
  }),

  /**
   * Update cleanup configuration
   */
  updateCleanupConfig: adminProcedure
    .input(z.object({
      ticksRetentionHours: z.number().min(1).max(168).optional(),
      agentSignalsRetentionDays: z.number().min(1).max(30).optional(),
      cleanupIntervalHours: z.number().min(1).max(24).optional(),
    }))
    .mutation(({ input }) => {
      databaseCleanupService.updateConfig(input);
      return {
        success: true,
        config: databaseCleanupService.getConfig(),
      };
    }),

  // ========================================
  // DISK USAGE MONITORING ENDPOINTS
  // ========================================

  /**
   * Get disk usage monitor status
   */
  getDiskUsageStatus: adminProcedure.query(() => {
    return diskUsageMonitor.getStatus();
  }),

  /**
   * Get disk usage alerts
   */
  getDiskAlerts: adminProcedure.query(() => {
    return diskUsageMonitor.getAlerts();
  }),

  /**
   * Get disk growth metrics
   */
  getDiskGrowthMetrics: adminProcedure.query(() => {
    return diskUsageMonitor.getGrowthMetrics();
  }),

  /**
   * Get comprehensive disk usage report
   */
  getDiskReport: adminProcedure.query(async () => {
    return await diskUsageMonitor.getReport();
  }),

  /**
   * Force disk usage check
   */
  forceDiskCheck: adminProcedure.mutation(async () => {
    const snapshot = await diskUsageMonitor.forceCheck();
    return {
      success: true,
      snapshot,
    };
  }),

  /**
   * Update disk monitor configuration
   */
  updateDiskMonitorConfig: adminProcedure
    .input(z.object({
      checkIntervalMinutes: z.number().min(5).max(120).optional(),
      warningThresholdPercent: z.number().min(50).max(95).optional(),
      criticalThresholdPercent: z.number().min(60).max(99).optional(),
    }))
    .mutation(({ input }) => {
      diskUsageMonitor.updateConfig(input);
      return {
        success: true,
        status: diskUsageMonitor.getStatus(),
      };
    }),

  // ========================================
  // SLOW DEATH MONITORING ENDPOINTS
  // ========================================

  /**
   * Get slow death monitor status
   */
  getSlowDeathStatus: adminProcedure.query(() => {
    return slowDeathMonitor.getStatus();
  }),

  /**
   * Get memory trend analysis
   */
  getMemoryTrend: adminProcedure.query(() => {
    return slowDeathMonitor.getMemoryTrend();
  }),

  /**
   * Get memory snapshots for charting
   */
  getMemorySnapshots: adminProcedure.query(() => {
    return slowDeathMonitor.getMemorySnapshots();
  }),

  /**
   * Get latency trend analysis
   */
  getLatencyTrend: adminProcedure.query(() => {
    return slowDeathMonitor.getLatencyTrend();
  }),

  /**
   * Get all active slow death alerts
   */
  getSlowDeathAlerts: adminProcedure.query(() => {
    return slowDeathMonitor.getActiveAlerts();
  }),

  /**
   * Get slow death alert history
   */
  getSlowDeathAlertHistory: adminProcedure.query(() => {
    return slowDeathMonitor.getAlertHistory();
  }),

  /**
   * Get comprehensive slow death report
   */
  getSlowDeathReport: adminProcedure.query(() => {
    return slowDeathMonitor.getReport();
  }),

  /**
   * Acknowledge a slow death alert
   */
  acknowledgeSlowDeathAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(({ input }) => {
      const success = slowDeathMonitor.acknowledgeAlert(input.alertId);
      return { success, alertId: input.alertId };
    }),

  /**
   * Force slow death analysis run
   */
  forceSlowDeathAnalysis: adminProcedure.mutation(() => {
    slowDeathMonitor.forceAnalysis();
    return {
      success: true,
      report: slowDeathMonitor.getReport(),
    };
  }),

  /**
   * Update slow death monitor configuration
   */
  updateSlowDeathConfig: adminProcedure
    .input(z.object({
      checkIntervalMinutes: z.number().min(1).max(60).optional(),
      memoryGrowthAlertThresholdMBPerHour: z.number().min(1).max(100).optional(),
      memoryGrowthSustainedHours: z.number().min(1).max(24).optional(),
      latencyIncreaseAlertPercent: z.number().min(5).max(100).optional(),
      latencyIncreaseWindowMinutes: z.number().min(5).max(120).optional(),
    }))
    .mutation(({ input }) => {
      slowDeathMonitor.updateConfig(input);
      return {
        success: true,
        status: slowDeathMonitor.getStatus(),
      };
    }),

  // ========================================
  // COMBINED INFRASTRUCTURE HEALTH
  // ========================================

  /**
   * Get comprehensive infrastructure health report
   */
  getInfrastructureHealth: adminProcedure.query(async () => {
    const [systemSnapshot, cleanupStatus, diskReport, slowDeathReport] = await Promise.all([
      monitoringService.getCurrentSnapshot(),
      Promise.resolve(databaseCleanupService.getStatus()),
      diskUsageMonitor.getReport(),
      Promise.resolve(slowDeathMonitor.getReport()),
    ]);

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check system health
    if (systemSnapshot.system.cpu.usage >= 80) {
      issues.push(`High CPU usage: ${systemSnapshot.system.cpu.usage.toFixed(1)}%`);
    }
    if (systemSnapshot.system.memory.usagePercent >= 85) {
      issues.push(`High memory usage: ${systemSnapshot.system.memory.usagePercent.toFixed(1)}%`);
    }

    // Check cleanup health
    const lastCleanup = cleanupStatus.lastCleanup;
    if (lastCleanup.length > 0) {
      const failedCleanups = lastCleanup.filter(s => s.error);
      if (failedCleanups.length > 0) {
        issues.push(`${failedCleanups.length} cleanup tasks failed`);
        recommendations.push('Review cleanup service logs and fix failing tasks');
      }
    }

    // Check slow death alerts
    for (const alert of slowDeathReport.activeAlerts) {
      if (alert.severity === 'critical') {
        issues.push(`CRITICAL: ${alert.message}`);
      } else {
        issues.push(`WARNING: ${alert.message}`);
      }
    }

    // Add disk recommendations
    recommendations.push(...diskReport.recommendations);
    
    // Add slow death recommendations
    recommendations.push(...slowDeathReport.recommendations);

    // Calculate overall health score
    let healthScore = 100;
    healthScore -= issues.length * 10;
    healthScore -= diskReport.alerts.filter(a => a.type === 'critical').length * 20;
    healthScore -= diskReport.alerts.filter(a => a.type === 'warning').length * 5;
    healthScore -= slowDeathReport.activeAlerts.filter(a => a.severity === 'critical').length * 25;
    healthScore -= slowDeathReport.activeAlerts.filter(a => a.severity === 'warning').length * 10;
    healthScore = Math.max(0, healthScore);

    return {
      healthScore,
      status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical',
      issues,
      recommendations,
      details: {
        system: systemSnapshot,
        cleanup: cleanupStatus,
        disk: diskReport,
        slowDeath: slowDeathReport,
      },
    };
  }),

  // ========================================
  // TICK STALENESS MONITORING ENDPOINTS
  // ========================================

  /**
   * Get tick staleness monitor status
   */
  getTickStalenessStatus: adminProcedure.query(() => {
    return tickStalenessMonitor.getStatus();
  }),

  /**
   * Get tick staleness alerts history
   */
  getTickStalenessAlerts: adminProcedure.query(() => {
    return tickStalenessMonitor.getAlerts();
  }),

  /**
   * Clear tick staleness alerts
   */
  clearTickStalenessAlerts: adminProcedure.mutation(() => {
    tickStalenessMonitor.clearAlerts();
    return { success: true };
  }),

  /**
   * Update tick staleness monitor configuration
   */
  updateTickStalenessConfig: adminProcedure
    .input(z.object({
      stalenessThresholdMs: z.number().min(100).max(10000).optional(),
      reconnectDelayMs: z.number().min(50).max(5000).optional(),
      maxReconnectAttempts: z.number().min(1).max(20).optional(),
      healthCheckIntervalMs: z.number().min(50).max(5000).optional(),
      dualFeedEnabled: z.boolean().optional(),
      alertOnStale: z.boolean().optional(),
      autoReconnect: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      tickStalenessMonitor.updateConfig(input);
      return {
        success: true,
        status: tickStalenessMonitor.getStatus(),
      };
    }),

  /**
   * Reset reconnect counter for a source
   */
  resetTickStalenessReconnectCount: adminProcedure
    .input(z.object({ source: z.string() }))
    .mutation(({ input }) => {
      tickStalenessMonitor.resetReconnectCount(input.source);
      return {
        success: true,
        status: tickStalenessMonitor.getStatus(),
      };
    }),

  // ========================================
  // COMPLETE LOGGING FRAMEWORK ENDPOINTS
  // ========================================

  /**
   * Get comprehensive logging framework status (real-time, in-memory)
   */
  loggingFrameworkStatus: adminProcedure.query(async () => {
    try {
      const { getMonitoringStatus } = await import('../monitoring');
      return getMonitoringStatus();
    } catch {
      return { isRunning: false, error: 'Monitoring framework not started' };
    }
  }),

  /**
   * Get recent heartbeats from database
   */
  getHeartbeats: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(60) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(systemHeartbeat)
        .orderBy(desc(systemHeartbeat.timestamp))
        .limit(input?.limit || 60);
    }),

  /**
   * Get recent service events from database
   */
  getServiceEvents: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(serviceEvents)
        .orderBy(desc(serviceEvents.timestamp))
        .limit(input?.limit || 50);
    }),

  /**
   * Get API connection logs from database
   */
  getApiConnectionLogs: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(apiConnectionLog)
        .orderBy(desc(apiConnectionLog.timestamp))
        .limit(input?.limit || 100);
    }),

  /**
   * Get WebSocket health logs from database
   */
  getWebsocketHealthLogs: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(websocketHealthLog)
        .orderBy(desc(websocketHealthLog.timestamp))
        .limit(input?.limit || 100);
    }),

  /**
   * Get exit decision logs
   */
  getExitDecisionLogs: adminProcedure
    .input(z.object({
      positionId: z.number().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input?.positionId) {
        return db.select().from(exitDecisionLog)
          .where(eq(exitDecisionLog.positionId, input.positionId))
          .orderBy(desc(exitDecisionLog.timestamp))
          .limit(input?.limit || 50);
      }
      return db.select().from(exitDecisionLog)
        .orderBy(desc(exitDecisionLog.timestamp))
        .limit(input?.limit || 50);
    }),

  /**
   * Get capital utilization history
   */
  getCapitalUtilization: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(capitalUtilization)
        .orderBy(desc(capitalUtilization.timestamp))
        .limit(input?.limit || 100);
    }),

  /**
   * Get position sizing logs
   */
  getPositionSizingLogs: adminProcedure
    .input(z.object({
      positionId: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input?.positionId) {
        return db.select().from(positionSizingLog)
          .where(eq(positionSizingLog.positionId, input.positionId))
          .orderBy(desc(positionSizingLog.timestamp))
          .limit(input?.limit || 50);
      }
      return db.select().from(positionSizingLog)
        .orderBy(desc(positionSizingLog.timestamp))
        .limit(input?.limit || 50);
    }),

  /**
   * Get entry validation logs
   */
  getEntryValidationLogs: adminProcedure
    .input(z.object({
      symbol: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input?.symbol) {
        return db.select().from(entryValidationLog)
          .where(eq(entryValidationLog.symbol, input.symbol))
          .orderBy(desc(entryValidationLog.timestamp))
          .limit(input?.limit || 50);
      }
      return db.select().from(entryValidationLog)
        .orderBy(desc(entryValidationLog.timestamp))
        .limit(input?.limit || 50);
    }),

  /**
   * Get alert logs
   */
  getAlertLogs: adminProcedure
    .input(z.object({
      severity: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input?.severity) {
        return db.select().from(alertLog)
          .where(eq(alertLog.severity, input.severity))
          .orderBy(desc(alertLog.timestamp))
          .limit(input?.limit || 50);
      }
      return db.select().from(alertLog)
        .orderBy(desc(alertLog.timestamp))
        .limit(input?.limit || 50);
    }),

  /**
   * Get logging framework summary dashboard data
   */
  getLoggingSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [heartbeatCount] = await db.select({ count: sql<number>`count(*)` })
      .from(systemHeartbeat)
      .where(gte(systemHeartbeat.timestamp, oneHourAgo));

    const [eventCount] = await db.select({ count: sql<number>`count(*)` })
      .from(serviceEvents)
      .where(gte(serviceEvents.timestamp, oneHourAgo));

    const [apiCallCount] = await db.select({ count: sql<number>`count(*)` })
      .from(apiConnectionLog)
      .where(gte(apiConnectionLog.timestamp, oneHourAgo));

    const [alertCount] = await db.select({ count: sql<number>`count(*)` })
      .from(alertLog)
      .where(gte(alertLog.timestamp, oneHourAgo));

    const [latestHeartbeat] = await db.select()
      .from(systemHeartbeat)
      .orderBy(desc(systemHeartbeat.timestamp))
      .limit(1);

    return {
      lastHour: {
        heartbeats: heartbeatCount?.count || 0,
        serviceEvents: eventCount?.count || 0,
        apiCalls: apiCallCount?.count || 0,
        alerts: alertCount?.count || 0,
      },
      latestHeartbeat: latestHeartbeat || null,
    };
  }),

  /**
   * Get trading pipeline activity log
   * Returns recent pipeline events (consensus, signals, trades, exits)
   */
  getPipelineLog: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(100),
      eventTypes: z.array(z.string()).optional(),
      symbol: z.string().optional(),
      since: z.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [], total: 0 };

      const limit = input?.limit ?? 100;
      const conditions = [];
      
      if (input?.eventTypes?.length) {
        conditions.push(sql`${tradingPipelineLog.eventType} IN (${sql.join(input.eventTypes.map(t => sql`${t}`), sql`, `)})`);
      }
      if (input?.symbol) {
        conditions.push(eq(tradingPipelineLog.symbol, input.symbol));
      }
      if (input?.since) {
        conditions.push(gte(tradingPipelineLog.timestamp, input.since));
      }

      const whereClause = conditions.length > 0 
        ? sql`${sql.join(conditions, sql` AND `)}` 
        : undefined;

      const events = await db.select()
        .from(tradingPipelineLog)
        .where(whereClause)
        .orderBy(desc(tradingPipelineLog.timestamp))
        .limit(limit);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(tradingPipelineLog)
        .where(whereClause);

      return {
        events,
        total: countResult?.count || 0,
      };
    }),

  /**
   * Get pipeline log summary (event counts by type in last 24h)
   */
  getPipelineLogSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { summary: [] };

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summary = await db.select({
      eventType: tradingPipelineLog.eventType,
      count: sql<number>`count(*)`,
    })
      .from(tradingPipelineLog)
      .where(gte(tradingPipelineLog.timestamp, oneDayAgo))
      .groupBy(tradingPipelineLog.eventType);

    return { summary };
  }),

  /**
   * Get signal bias distribution — real-time bullish/bearish/neutral ratios
   * Used by the bias monitoring widget on the admin dashboard
   */
  getSignalBiasDistribution: adminProcedure
    .input(z.object({
      hours: z.number().min(1).max(168).default(24),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { consensus: [], approved: [], rejected: [], hourly: [], agentBreakdown: [] };
      const hours = input?.hours ?? 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      // Consensus direction distribution
      const consensus = await db.select({
        direction: tradingPipelineLog.direction,
        count: sql<number>`count(*)`,
      })
        .from(tradingPipelineLog)
        .where(sql`${tradingPipelineLog.timestamp} >= ${since} AND ${tradingPipelineLog.eventType} = 'CONSENSUS'`)
        .groupBy(tradingPipelineLog.direction);

      // Approved signal distribution
      const approved = await db.select({
        direction: tradingPipelineLog.direction,
        count: sql<number>`count(*)`,
      })
        .from(tradingPipelineLog)
        .where(sql`${tradingPipelineLog.timestamp} >= ${since} AND ${tradingPipelineLog.eventType} = 'SIGNAL_APPROVED'`)
        .groupBy(tradingPipelineLog.direction);

      // Rejected signal distribution
      const rejected = await db.select({
        direction: tradingPipelineLog.direction,
        count: sql<number>`count(*)`,
      })
        .from(tradingPipelineLog)
        .where(sql`${tradingPipelineLog.timestamp} >= ${since} AND ${tradingPipelineLog.eventType} = 'SIGNAL_REJECTED'`)
        .groupBy(tradingPipelineLog.direction);

      // Hourly trend (last N hours)
      const hourly = await db.select({
        hour: sql<string>`DATE_FORMAT(${tradingPipelineLog.timestamp}, '%Y-%m-%d %H:00')`,
        direction: tradingPipelineLog.direction,
        eventType: tradingPipelineLog.eventType,
        count: sql<number>`count(*)`,
      })
        .from(tradingPipelineLog)
        .where(sql`${tradingPipelineLog.timestamp} >= ${since} AND ${tradingPipelineLog.eventType} IN ('CONSENSUS', 'SIGNAL_APPROVED')`)
        .groupBy(sql`DATE_FORMAT(${tradingPipelineLog.timestamp}, '%Y-%m-%d %H:00')`, tradingPipelineLog.direction, tradingPipelineLog.eventType)
        .orderBy(sql`DATE_FORMAT(${tradingPipelineLog.timestamp}, '%Y-%m-%d %H:00')`);

      // Agent-level breakdown from consensus reason field
      const agentBreakdown = await db.select({
        reason: tradingPipelineLog.reason,
        direction: tradingPipelineLog.direction,
        count: sql<number>`count(*)`,
      })
        .from(tradingPipelineLog)
        .where(sql`${tradingPipelineLog.timestamp} >= ${since} AND ${tradingPipelineLog.eventType} = 'CONSENSUS'`)
        .groupBy(tradingPipelineLog.reason, tradingPipelineLog.direction)
        .orderBy(sql`count(*) DESC`)
        .limit(20);

      return { consensus, approved, rejected, hourly, agentBreakdown };
    }),
});
