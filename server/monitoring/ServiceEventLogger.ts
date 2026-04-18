/**
 * ServiceEventLogger - P0 CRITICAL
 * 
 * Logs service lifecycle events: start, stop, crash, restart, config_reload.
 * Multiple starts/restarts per day = PROBLEM indicator.
 * 
 * Usage:
 *   serviceEventLogger.logStart("SEERMultiEngine", "User initiated start");
 *   serviceEventLogger.logCrash("PriceFeed", error);
 */

import { getDb } from "../db";
import { serviceEvents } from "../../drizzle/schema";

type EventType = "start" | "stop" | "crash" | "restart" | "config_reload";

class ServiceEventLoggerService {
  private static instance: ServiceEventLoggerService | null = null;

  private constructor() {}

  static getInstance(): ServiceEventLoggerService {
    if (!ServiceEventLoggerService.instance) {
      ServiceEventLoggerService.instance = new ServiceEventLoggerService();
    }
    return ServiceEventLoggerService.instance;
  }

  /**
   * Log a service start event.
   */
  async logStart(serviceName: string, reason?: string): Promise<void> {
    await this.logEvent(serviceName, "start", reason);
  }

  /**
   * Log a service stop event.
   */
  async logStop(serviceName: string, reason?: string): Promise<void> {
    await this.logEvent(serviceName, "stop", reason);
  }

  /**
   * Log a service crash event with error details.
   */
  async logCrash(serviceName: string, error: Error | unknown, reason?: string): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    await this.logEvent(serviceName, "crash", reason || err.message, err.message, err.stack);
  }

  /**
   * Log a service restart event.
   */
  async logRestart(serviceName: string, reason?: string): Promise<void> {
    await this.logEvent(serviceName, "restart", reason);
  }

  /**
   * Log a configuration reload event.
   */
  async logConfigReload(serviceName: string, reason?: string): Promise<void> {
    await this.logEvent(serviceName, "config_reload", reason);
  }

  /**
   * Internal: Write event to database.
   * Fire-and-forget: never blocks the calling service.
   */
  private async logEvent(
    serviceName: string,
    eventType: EventType,
    reason?: string,
    errorMessage?: string,
    stackTrace?: string
  ): Promise<void> {
    // Always log to console for immediate visibility
    const prefix = eventType === "crash" ? "🔴" : eventType === "start" ? "🟢" : eventType === "stop" ? "🔵" : "🟡";
    console.log(`[ServiceEventLogger] ${prefix} ${serviceName} → ${eventType}${reason ? `: ${reason}` : ""}`);

    try {
      const db = await getDb();
      if (!db) return;

      await db.insert(serviceEvents).values({
        timestamp: new Date(),
        serviceName,
        eventType,
        reason: reason || null,
        errorMessage: errorMessage || null,
        stackTrace: stackTrace || null,
        version: process.env.npm_package_version || "unknown",
        gitCommit: null, // Could be populated from git rev-parse
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development",
      });
    } catch (err: any) {
      // Never crash the engine for logging failures
      console.error("[ServiceEventLogger] DB write failed:", err.message);
    }
  }
}

export const serviceEventLogger = ServiceEventLoggerService.getInstance();
export { ServiceEventLoggerService };
