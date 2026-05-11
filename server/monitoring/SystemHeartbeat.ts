/**
 * SystemHeartbeat Service - P0 CRITICAL
 * 
 * Records system health metrics every 60 seconds to prove the system is alive.
 * If no heartbeat for 5 minutes → system is considered DOWN.
 * 
 * Metrics tracked:
 * - Ticks processed per minute
 * - Positions checked per minute
 * - CPU/Memory usage
 * - Uptime
 * - Open positions and active agents count
 */

import { getDb } from "../db";
import { getActiveClock } from '../_core/clock';
import { systemHeartbeat } from "../../drizzle/schema";
import os from "os";

interface HeartbeatMetrics {
  ticksProcessed: number;
  positionsChecked: number;
  openPositionsCount: number;
  activeAgentsCount: number;
  lastTickTime: Date | null;
}

class SystemHeartbeatService {
  private static instance: SystemHeartbeatService | null = null;
  private interval: NodeJS.Timeout | null = null;
  private startTime: Date;
  private lastRestartTime: Date | null = null;
  private restartReason: string | null = null;
  
  // Rolling counters (reset every minute)
  private ticksThisMinute = 0;
  private positionsCheckedThisMinute = 0;
  
  // Snapshot metrics (updated externally)
  private openPositionsCount = 0;
  private activeAgentsCount = 0;
  private lastTickTime: Date | null = null;

  private readonly HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute
  private readonly SERVICE_NAME = "SEERMultiEngine";

  private constructor() {
    this.startTime = new Date();
  }

  static getInstance(): SystemHeartbeatService {
    if (!SystemHeartbeatService.instance) {
      SystemHeartbeatService.instance = new SystemHeartbeatService();
    }
    return SystemHeartbeatService.instance;
  }

  /**
   * Start recording heartbeats every minute.
   * Fire-and-forget: never blocks the trading engine.
   */
  start(restartReason?: string): void {
    if (this.interval) {
      console.log("[SystemHeartbeat] Already running, skipping start");
      return;
    }

    this.startTime = new Date();
    if (restartReason) {
      this.lastRestartTime = new Date();
      this.restartReason = restartReason;
    }

    console.log("[SystemHeartbeat] Starting heartbeat monitoring (60s interval)");

    // Record initial heartbeat immediately
    this.recordHeartbeat().catch(() => {});

    this.interval = setInterval(() => {
      this.recordHeartbeat().catch((err) => {
        console.error("[SystemHeartbeat] Failed to record heartbeat:", err.message);
      });
    }, this.HEARTBEAT_INTERVAL_MS);

    // Ensure interval doesn't prevent process exit
    if (this.interval.unref) {
      this.interval.unref();
    }
  }

  /**
   * Stop heartbeat recording.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[SystemHeartbeat] Stopped heartbeat monitoring");
    }
  }

  /**
   * Record a tick event. Called from price feed handlers.
   */
  recordTick(): void {
    this.ticksThisMinute++;
    this.lastTickTime = new Date();
  }

  /**
   * Record a position check event. Called from position monitoring.
   */
  recordPositionCheck(): void {
    this.positionsCheckedThisMinute++;
  }

  /**
   * Update snapshot metrics from the engine.
   */
  updateMetrics(metrics: Partial<HeartbeatMetrics>): void {
    if (metrics.openPositionsCount !== undefined) this.openPositionsCount = metrics.openPositionsCount;
    if (metrics.activeAgentsCount !== undefined) this.activeAgentsCount = metrics.activeAgentsCount;
    if (metrics.lastTickTime !== undefined) this.lastTickTime = metrics.lastTickTime;
  }

  /**
   * Get current status for API endpoints.
   */
  getStatus(): {
    isRunning: boolean;
    uptimeSeconds: number;
    ticksThisMinute: number;
    positionsCheckedThisMinute: number;
    lastTickTime: Date | null;
  } {
    return {
      isRunning: this.interval !== null,
      uptimeSeconds: Math.floor((getActiveClock().now() - this.startTime.getTime()) / 1000),
      ticksThisMinute: this.ticksThisMinute,
      positionsCheckedThisMinute: this.positionsCheckedThisMinute,
      lastTickTime: this.lastTickTime,
    };
  }

  /**
   * Internal: Record a heartbeat to the database.
   * Uses fire-and-forget pattern to never block trading.
   */
  private async recordHeartbeat(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const uptimeSeconds = Math.floor((now.getTime() - this.startTime.getTime()) / 1000);
    
    // Determine health status
    let status: string = "healthy";
    if (!this.lastTickTime) {
      status = "degraded"; // No ticks received yet
    } else {
      const timeSinceLastTick = now.getTime() - this.lastTickTime.getTime();
      if (timeSinceLastTick > 5 * 60 * 1000) {
        status = "down"; // No tick for 5+ minutes
      } else if (timeSinceLastTick > 2 * 60 * 1000) {
        status = "degraded"; // No tick for 2+ minutes
      }
    }

    // Get memory usage
    const memUsage = process.memoryUsage();
    const memoryMb = Math.round(memUsage.rss / 1024 / 1024);
    
    // Get CPU usage (1-minute load average as percentage of cores)
    const loadAvg = os.loadavg()[0]; // 1-minute average
    const cpuCount = os.cpus().length;
    const cpuPercent = Math.min(100, (loadAvg / cpuCount) * 100).toFixed(2);

    try {
      await db.insert(systemHeartbeat).values({
        timestamp: now,
        serviceName: this.SERVICE_NAME,
        status,
        lastTickTime: this.lastTickTime,
        ticksProcessedLastMinute: this.ticksThisMinute,
        positionsCheckedLastMinute: this.positionsCheckedThisMinute,
        cpuPercent: cpuPercent,
        memoryMb,
        activeThreads: 1, // Node.js is single-threaded
        uptimeSeconds,
        lastRestartTime: this.lastRestartTime,
        restartReason: this.restartReason,
        openPositionsCount: this.openPositionsCount,
        activeAgentsCount: this.activeAgentsCount,
      });
    } catch (err: any) {
      // Silently fail - never crash the engine for logging
      console.error("[SystemHeartbeat] DB write failed:", err.message);
    }

    // Reset rolling counters
    this.ticksThisMinute = 0;
    this.positionsCheckedThisMinute = 0;
  }
}

export const systemHeartbeatService = SystemHeartbeatService.getInstance();
export { SystemHeartbeatService };
