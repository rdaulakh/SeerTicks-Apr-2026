/**
 * APIConnectionMonitor - P0 CRITICAL
 * 
 * Wraps all external API calls to log connection status and performance.
 * Success rate should be >99%, avg response <1000ms.
 * 
 * Usage:
 *   const result = await apiConnectionMonitor.trackCall("Coinbase", "getMarketData", async () => {
 *     return await coinbaseApi.getMarketData();
 *   }, "BTC-USD");
 */

import { getDb } from "../db";
import { apiConnectionLog } from "../../drizzle/schema";

interface APICallResult<T> {
  data: T;
  responseTimeMs: number;
  success: boolean;
}

class APIConnectionMonitorService {
  private static instance: APIConnectionMonitorService | null = null;
  
  // In-memory stats for quick access (no DB query needed)
  private stats: Map<string, {
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    totalResponseTimeMs: number;
    lastCallTime: Date | null;
    lastStatus: string;
    lastError: string | null;
  }> = new Map();

  // Batch write buffer to reduce DB writes
  private writeBuffer: Array<{
    timestamp: Date;
    apiName: string;
    connectionStatus: string;
    connectionAttemptTime: Date;
    connectionEstablishedTime: Date | null;
    connectionDurationMs: number | null;
    responseTimeMs: number | null;
    statusCode: number | null;
    errorMessage: string | null;
    affectedSymbols: string | null;
    affectedOperations: string | null;
  }> = [];

  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 30_000; // Flush every 30 seconds
  private readonly MAX_BUFFER_SIZE = 50;

  private constructor() {}

  static getInstance(): APIConnectionMonitorService {
    if (!APIConnectionMonitorService.instance) {
      APIConnectionMonitorService.instance = new APIConnectionMonitorService();
    }
    return APIConnectionMonitorService.instance;
  }

  /**
   * Start the monitor (begins periodic buffer flushing).
   */
  start(): void {
    if (this.flushInterval) return;
    
    console.log("[APIConnectionMonitor] Started monitoring API connections");
    this.flushInterval = setInterval(() => {
      this.flushBuffer().catch((err) => {
        console.error("[APIConnectionMonitor] Flush failed:", err.message);
      });
    }, this.FLUSH_INTERVAL_MS);

    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  /**
   * Stop the monitor and flush remaining buffer.
   */
  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flushBuffer();
    console.log("[APIConnectionMonitor] Stopped monitoring");
  }

  /**
   * Track an API call with timing and error logging.
   * Wraps the actual API call and records metrics.
   */
  async trackCall<T>(
    apiName: string,
    operation: string,
    fn: () => Promise<T>,
    affectedSymbols?: string
  ): Promise<T> {
    const attemptTime = new Date();
    const startMs = performance.now();
    
    try {
      const result = await fn();
      const responseTimeMs = Math.round(performance.now() - startMs);
      const establishedTime = new Date();

      // Update in-memory stats
      this.updateStats(apiName, true, responseTimeMs);

      // Buffer the log entry
      this.bufferEntry({
        timestamp: new Date(),
        apiName,
        connectionStatus: "connected",
        connectionAttemptTime: attemptTime,
        connectionEstablishedTime: establishedTime,
        connectionDurationMs: responseTimeMs,
        responseTimeMs,
        statusCode: 200,
        errorMessage: null,
        affectedSymbols: affectedSymbols || null,
        affectedOperations: operation,
      });

      return result;
    } catch (error: any) {
      const responseTimeMs = Math.round(performance.now() - startMs);
      
      // Determine status from error
      let connectionStatus = "error";
      let statusCode: number | null = null;
      
      if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT") {
        connectionStatus = "timeout";
      } else if (error.status === 429 || error.message?.includes("rate limit")) {
        connectionStatus = "rate_limited";
        statusCode = 429;
      } else if (error.status) {
        statusCode = error.status;
      }

      // Update in-memory stats
      this.updateStats(apiName, false, responseTimeMs, error.message);

      // Buffer the log entry
      this.bufferEntry({
        timestamp: new Date(),
        apiName,
        connectionStatus,
        connectionAttemptTime: attemptTime,
        connectionEstablishedTime: null,
        connectionDurationMs: responseTimeMs,
        responseTimeMs,
        statusCode,
        errorMessage: error.message?.substring(0, 500) || "Unknown error",
        affectedSymbols: affectedSymbols || null,
        affectedOperations: operation,
      });

      // Re-throw so the caller still handles the error
      throw error;
    }
  }

  /**
   * Log a connection event without wrapping a call (for WebSocket events etc.)
   */
  logConnectionEvent(
    apiName: string,
    status: string,
    details?: { responseTimeMs?: number; errorMessage?: string; affectedSymbols?: string; operation?: string }
  ): void {
    this.bufferEntry({
      timestamp: new Date(),
      apiName,
      connectionStatus: status,
      connectionAttemptTime: new Date(),
      connectionEstablishedTime: status === "connected" ? new Date() : null,
      connectionDurationMs: details?.responseTimeMs || null,
      responseTimeMs: details?.responseTimeMs || null,
      statusCode: null,
      errorMessage: details?.errorMessage || null,
      affectedSymbols: details?.affectedSymbols || null,
      affectedOperations: details?.operation || null,
    });
  }

  /**
   * Get current stats for all APIs (for health dashboard).
   */
  getStats(): Record<string, {
    totalCalls: number;
    successRate: number;
    avgResponseTimeMs: number;
    lastStatus: string;
    lastError: string | null;
  }> {
    const result: Record<string, any> = {};
    for (const [apiName, stat] of this.stats) {
      result[apiName] = {
        totalCalls: stat.totalCalls,
        successRate: stat.totalCalls > 0 ? (stat.successCalls / stat.totalCalls) * 100 : 0,
        avgResponseTimeMs: stat.totalCalls > 0 ? Math.round(stat.totalResponseTimeMs / stat.totalCalls) : 0,
        lastStatus: stat.lastStatus,
        lastError: stat.lastError,
      };
    }
    return result;
  }

  private updateStats(apiName: string, success: boolean, responseTimeMs: number, error?: string): void {
    let stat = this.stats.get(apiName);
    if (!stat) {
      stat = {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        totalResponseTimeMs: 0,
        lastCallTime: null,
        lastStatus: "unknown",
        lastError: null,
      };
      this.stats.set(apiName, stat);
    }

    stat.totalCalls++;
    stat.totalResponseTimeMs += responseTimeMs;
    stat.lastCallTime = new Date();
    
    if (success) {
      stat.successCalls++;
      stat.lastStatus = "connected";
      stat.lastError = null;
    } else {
      stat.failedCalls++;
      stat.lastStatus = "error";
      stat.lastError = error || "Unknown error";
    }
  }

  private bufferEntry(entry: typeof this.writeBuffer[0]): void {
    this.writeBuffer.push(entry);
    
    // Auto-flush if buffer is full
    if (this.writeBuffer.length >= this.MAX_BUFFER_SIZE) {
      this.flushBuffer().catch(() => {});
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const entries = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      const db = await getDb();
      if (!db) return;

      // Batch insert all buffered entries
      await db.insert(apiConnectionLog).values(entries);
    } catch (err: any) {
      console.error("[APIConnectionMonitor] Batch flush failed:", err.message);
      // Don't re-buffer on failure to prevent memory growth
    }
  }
}

export const apiConnectionMonitor = APIConnectionMonitorService.getInstance();
export { APIConnectionMonitorService };
