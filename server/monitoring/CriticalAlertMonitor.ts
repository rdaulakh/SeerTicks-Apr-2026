/**
 * CriticalAlertMonitor - Step 3 Implementation
 * 
 * Runs periodic health checks and triggers critical alerts when thresholds are breached.
 * Integrates with AlertLogger for persistence and notifyOwner for push notifications.
 * 
 * Alert Rules:
 * 1. System Down: No heartbeat for 5+ minutes
 * 2. Connection Failure: API failure rate > 10% in last hour
 * 3. Capital Underutilization: < 30% utilization for 4+ hours
 * 4. Poor Performance: Win rate < 30% over last 20 trades
 * 5. High Memory: Memory usage > 1GB
 * 6. WebSocket Stale: No WS messages for 5+ minutes
 */

import { getDb } from "../db";
import { getActiveClock } from '../_core/clock';
import {
  systemHeartbeat,
  apiConnectionLog,
  capitalUtilization,
  paperPositions,
  alertLog,
  websocketHealthLog,
} from "../../drizzle/schema";
import { sql, desc, and, gte, eq } from "drizzle-orm";
import { alertLogger } from "./AlertLogger";
import { systemHeartbeatService } from "./SystemHeartbeat";

// Try to import notifyOwner - it may not always be available
let notifyOwnerFn: ((payload: { title: string; content: string }) => Promise<boolean>) | null = null;
try {
  const mod = require("../_core/notification");
  notifyOwnerFn = mod.notifyOwner;
} catch {
  console.warn("[CriticalAlertMonitor] notifyOwner not available, using console-only alerts");
}

interface AlertRule {
  name: string;
  alertType: string;
  severity: "warning" | "critical" | "emergency";
  checkIntervalMs: number;
  lastCheck: number;
  check: () => Promise<{ triggered: boolean; title: string; message: string } | null>;
}

class CriticalAlertMonitorService {
  private static instance: CriticalAlertMonitorService | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private rules: AlertRule[] = [];
  private readonly CHECK_LOOP_MS = 60_000; // Check every minute

  private constructor() {
    this.initializeRules();
  }

  static getInstance(): CriticalAlertMonitorService {
    if (!CriticalAlertMonitorService.instance) {
      CriticalAlertMonitorService.instance = new CriticalAlertMonitorService();
    }
    return CriticalAlertMonitorService.instance;
  }

  private initializeRules(): void {
    this.rules = [
      // Rule 1: System Down - No heartbeat for 5 minutes
      {
        name: "System Down Detection",
        alertType: "system_down",
        severity: "critical",
        checkIntervalMs: 2 * 60_000, // Check every 2 minutes
        lastCheck: 0,
        check: async () => {
          const db = await getDb();
          if (!db) return null;

          const [result] = await db
            .select({ latestBeat: sql<Date>`MAX(timestamp)` })
            .from(systemHeartbeat);

          if (!result?.latestBeat) return null;

          const minutesSinceLastBeat = (getActiveClock().now() - new Date(result.latestBeat).getTime()) / 60_000;

          if (minutesSinceLastBeat > 5) {
            return {
              triggered: true,
              title: "Trading System Down",
              message: `No heartbeat recorded for ${Math.round(minutesSinceLastBeat)} minutes. System may be unresponsive.`,
            };
          }
          return null;
        },
      },

      // Rule 2: API Connection Failure Rate > 10%
      {
        name: "Connection Failure Detection",
        alertType: "api_connection_failure",
        severity: "critical",
        checkIntervalMs: 5 * 60_000, // Check every 5 minutes
        lastCheck: 0,
        check: async () => {
          const db = await getDb();
          if (!db) return null;

          const oneHourAgo = new Date(getActiveClock().now() - 60 * 60_000);
          const results = await db
            .select({
              apiName: apiConnectionLog.apiName,
              total: sql<number>`COUNT(*)`,
              failed: sql<number>`SUM(CASE WHEN connectionStatus != 'connected' THEN 1 ELSE 0 END)`,
            })
            .from(apiConnectionLog)
            .where(gte(apiConnectionLog.timestamp, oneHourAgo))
            .groupBy(apiConnectionLog.apiName);

          for (const row of results) {
            const failureRate = (Number(row.failed) / Number(row.total)) * 100;
            if (failureRate > 10 && Number(row.total) > 5) {
              return {
                triggered: true,
                title: `${row.apiName} Connection Issues`,
                message: `${failureRate.toFixed(1)}% failure rate (${row.failed}/${row.total} calls) in the last hour.`,
              };
            }
          }
          return null;
        },
      },

      // Rule 3: Capital Underutilization < 30% for 4 hours
      {
        name: "Capital Underutilization Detection",
        alertType: "capital_underutilized",
        severity: "warning",
        checkIntervalMs: 30 * 60_000, // Check every 30 minutes
        lastCheck: 0,
        check: async () => {
          const db = await getDb();
          if (!db) return null;

          const fourHoursAgo = new Date(getActiveClock().now() - 4 * 60 * 60_000);
          const [result] = await db
            .select({
              avgUtilization: sql<number>`AVG(CAST(utilizationPercent AS DECIMAL(5,2)))`,
              records: sql<number>`COUNT(*)`,
            })
            .from(capitalUtilization)
            .where(gte(capitalUtilization.timestamp, fourHoursAgo));

          if (!result || Number(result.records) < 4) return null; // Need at least 4 records (1 per hour)

          const avgUtil = Number(result.avgUtilization);
          if (avgUtil < 30) {
            return {
              triggered: true,
              title: "Low Capital Utilization",
              message: `Only ${avgUtil.toFixed(1)}% of capital deployed over the last 4 hours. Consider reviewing trading parameters.`,
            };
          }
          return null;
        },
      },

      // Rule 4: Poor Performance - Win rate < 30% over last 20 trades
      {
        name: "Poor Performance Detection",
        alertType: "poor_performance",
        severity: "warning",
        checkIntervalMs: 60 * 60_000, // Check every hour
        lastCheck: 0,
        check: async () => {
          const db = await getDb();
          if (!db) return null;

          const recentPositions = await db
            .select({
              pnl: paperPositions.realizedPnl,
            })
            .from(paperPositions)
            .where(
              and(
                eq(paperPositions.status, "closed"),
                sql`realizedPnl IS NOT NULL`
              )
            )
            .orderBy(desc(paperPositions.exitTime))
            .limit(20);

          if (recentPositions.length < 20) return null; // Need at least 20 trades

          const wins = recentPositions.filter(p => Number(p.pnl) > 0).length;
          const winRate = (wins / recentPositions.length) * 100;

          if (winRate < 30) {
            return {
              triggered: true,
              title: "Win Rate Below Target",
              message: `Win rate ${winRate.toFixed(1)}% over last ${recentPositions.length} trades (target: >30%). Review strategy parameters.`,
            };
          }
          return null;
        },
      },

      // Rule 5: High Memory Usage > 1GB
      {
        name: "High Memory Usage Detection",
        alertType: "high_memory",
        severity: "warning",
        checkIntervalMs: 5 * 60_000, // Check every 5 minutes
        lastCheck: 0,
        check: async () => {
          const memUsage = process.memoryUsage();
          const memoryMb = Math.round(memUsage.rss / 1024 / 1024);

          if (memoryMb > 1024) {
            return {
              triggered: true,
              title: "High Memory Usage",
              message: `Memory usage at ${memoryMb}MB (threshold: 1024MB). Consider restarting the engine.`,
            };
          }
          return null;
        },
      },

      // Rule 6: WebSocket Stale - No messages for 5+ minutes
      {
        name: "WebSocket Stale Detection",
        alertType: "websocket_stale",
        severity: "critical",
        checkIntervalMs: 3 * 60_000, // Check every 3 minutes
        lastCheck: 0,
        check: async () => {
          const heartbeatStatus = systemHeartbeatService.getStatus();
          
          if (heartbeatStatus.lastTickTime) {
            const minutesSinceLastTick = (getActiveClock().now() - new Date(heartbeatStatus.lastTickTime).getTime()) / 60_000;
            if (minutesSinceLastTick > 5) {
              return {
                triggered: true,
                title: "Price Feed Stale",
                message: `No price tick received for ${Math.round(minutesSinceLastTick)} minutes. WebSocket may be disconnected.`,
              };
            }
          }
          return null;
        },
      },
    ];
  }

  /**
   * Start the critical alert monitoring loop.
   */
  start(): void {
    if (this.checkInterval) return;

    console.log("[CriticalAlertMonitor] Started with", this.rules.length, "alert rules");

    this.checkInterval = setInterval(() => {
      this.runChecks().catch((err) => {
        console.error("[CriticalAlertMonitor] Check loop error:", err.message);
      });
    }, this.CHECK_LOOP_MS);

    if (this.checkInterval.unref) {
      this.checkInterval.unref();
    }

    // Run initial check after 2 minutes (let system stabilize)
    setTimeout(() => {
      this.runChecks().catch(() => {});
    }, 2 * 60_000);
  }

  /**
   * Stop the monitoring loop.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log("[CriticalAlertMonitor] Stopped");
    }
  }

  /**
   * Run all alert rule checks.
   */
  private async runChecks(): Promise<void> {
    const now = getActiveClock().now();

    for (const rule of this.rules) {
      // Skip if not enough time has passed since last check
      if (now - rule.lastCheck < rule.checkIntervalMs) continue;
      rule.lastCheck = now;

      try {
        const result = await rule.check();
        if (result && result.triggered) {
          // Log to AlertLogger (with deduplication)
          const wasLogged = alertLogger.logAlert({
            alertType: rule.alertType,
            severity: rule.severity,
            title: result.title,
            message: result.message,
            deliveryMethod: notifyOwnerFn ? "notification" : "console",
            deliveryStatus: "sent",
            metadata: { ruleName: rule.name },
          });

          // If alert was not deduplicated, send push notification
          if (wasLogged && notifyOwnerFn && (rule.severity === "critical" || rule.severity === "emergency")) {
            try {
              await notifyOwnerFn({
                title: `[SEER Alert] ${result.title}`,
                content: `**Severity:** ${rule.severity.toUpperCase()}\n\n${result.message}\n\n*Automated alert from SEER Trading Platform monitoring system.*`,
              });
              console.log(`[CriticalAlertMonitor] Push notification sent for: ${result.title}`);
            } catch (notifyErr: any) {
              console.error(`[CriticalAlertMonitor] Push notification failed: ${notifyErr.message}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[CriticalAlertMonitor] Rule "${rule.name}" check failed:`, err.message);
      }
    }
  }

  /**
   * Get current alert rule status for dashboard.
   */
  getStatus(): { rules: { name: string; alertType: string; severity: string; lastCheck: string }[] } {
    return {
      rules: this.rules.map(r => ({
        name: r.name,
        alertType: r.alertType,
        severity: r.severity,
        lastCheck: r.lastCheck > 0 ? new Date(r.lastCheck).toISOString() : "never",
      })),
    };
  }
}

export const criticalAlertMonitor = CriticalAlertMonitorService.getInstance();
export { CriticalAlertMonitorService };
