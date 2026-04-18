/**
 * AlertLogger - P2 OPTIMIZATION
 * 
 * Centralized alert logging with delivery tracking.
 * Logs all alerts sent through any channel (email, notification, console).
 * 
 * Usage:
 *   alertLogger.logAlert({
 *     alertType: "connection_lost",
 *     severity: "critical",
 *     title: "WebSocket Connection Lost",
 *     message: "CoinAPI WebSocket disconnected for 5+ minutes",
 *     deliveryMethod: "notification",
 *     deliveryStatus: "sent",
 *   });
 */

import { getDb } from "../db";
import { alertLog } from "../../drizzle/schema";

type Severity = "info" | "warning" | "critical" | "emergency";
type DeliveryMethod = "notification" | "email" | "console" | "webhook";
type DeliveryStatus = "sent" | "failed" | "pending" | "suppressed";

interface AlertEntry {
  alertType: string;
  severity: Severity;
  title: string;
  message: string;
  deliveryMethod: DeliveryMethod;
  deliveryStatus: DeliveryStatus;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, any>;
}

class AlertLoggerService {
  private static instance: AlertLoggerService | null = null;
  private writeBuffer: any[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 10_000;
  private readonly MAX_BUFFER_SIZE = 50;

  // Deduplication: prevent alert storms
  private recentAlerts: Map<string, number> = new Map(); // key -> timestamp
  private readonly DEDUP_WINDOW_MS = 5 * 60_000; // 5 minutes

  private constructor() {}

  static getInstance(): AlertLoggerService {
    if (!AlertLoggerService.instance) {
      AlertLoggerService.instance = new AlertLoggerService();
    }
    return AlertLoggerService.instance;
  }

  start(): void {
    if (this.flushInterval) return;
    
    console.log("[AlertLogger] Started");
    this.flushInterval = setInterval(() => {
      this.flushBuffer().catch(() => {});
      this.cleanupDedupMap();
    }, this.FLUSH_INTERVAL_MS);

    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushBuffer().catch(() => {});
  }

  /**
   * Log an alert. Returns true if logged, false if deduplicated/suppressed.
   */
  logAlert(alert: AlertEntry): boolean {
    // Deduplication check
    const dedupKey = `${alert.alertType}:${alert.severity}:${alert.relatedEntityId || ""}`;
    const lastSent = this.recentAlerts.get(dedupKey);
    if (lastSent && Date.now() - lastSent < this.DEDUP_WINDOW_MS) {
      // Suppress duplicate alert
      return false;
    }
    this.recentAlerts.set(dedupKey, Date.now());

    // Console output for immediate visibility
    const severityIcon = alert.severity === "emergency" ? "🚨" 
      : alert.severity === "critical" ? "🔴" 
      : alert.severity === "warning" ? "🟡" 
      : "🔵";
    console.log(`[AlertLogger] ${severityIcon} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`);

    this.writeBuffer.push({
      timestamp: new Date(),
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      deliveryMethod: alert.deliveryMethod,
      deliveryStatus: alert.deliveryStatus,
      deliveredAt: alert.deliveryStatus === "sent" ? new Date() : null,
      relatedEntityType: alert.relatedEntityType || null,
      relatedEntityId: alert.relatedEntityId || null,
      metadata: alert.metadata || null,
    });

    if (this.writeBuffer.length >= this.MAX_BUFFER_SIZE) {
      this.flushBuffer().catch(() => {});
    }

    return true;
  }

  /**
   * Convenience: Log a critical alert.
   */
  critical(alertType: string, title: string, message: string, entityType?: string, entityId?: string): boolean {
    return this.logAlert({
      alertType,
      severity: "critical",
      title,
      message,
      deliveryMethod: "console",
      deliveryStatus: "sent",
      relatedEntityType: entityType,
      relatedEntityId: entityId,
    });
  }

  /**
   * Convenience: Log a warning alert.
   */
  warning(alertType: string, title: string, message: string, entityType?: string, entityId?: string): boolean {
    return this.logAlert({
      alertType,
      severity: "warning",
      title,
      message,
      deliveryMethod: "console",
      deliveryStatus: "sent",
      relatedEntityType: entityType,
      relatedEntityId: entityId,
    });
  }

  private cleanupDedupMap(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.recentAlerts) {
      if (now - timestamp > this.DEDUP_WINDOW_MS) {
        this.recentAlerts.delete(key);
      }
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const entries = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(alertLog).values(entries);
    } catch (err: any) {
      console.error("[AlertLogger] Batch flush failed:", err.message);
    }
  }
}

export const alertLogger = AlertLoggerService.getInstance();
export { AlertLoggerService };
