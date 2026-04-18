/**
 * ExitDecisionLogger - P1 HIGH
 * 
 * Logs detailed exit decision analysis for each position check.
 * Validates exit system is working correctly by recording:
 * - Which exit checks were evaluated
 * - Which check triggered the exit (if any)
 * - Current P&L and consensus at time of check
 * 
 * Usage:
 *   exitDecisionLogger.logExitCheck(positionId, checks, triggeredExit, metrics);
 */

import { getDb } from "../db";
import { exitDecisionLog } from "../../drizzle/schema";

interface ExitCheck {
  checkName: string;
  result: boolean;
  details: string;
}

interface ExitMetrics {
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  holdTimeMinutes: number;
  currentConsensus?: number;
  entryConsensus?: number;
  metadata?: Record<string, any>;
}

class ExitDecisionLoggerService {
  private static instance: ExitDecisionLoggerService | null = null;
  
  // Batch buffer to reduce DB writes
  private writeBuffer: any[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 15_000; // Flush every 15 seconds
  private readonly MAX_BUFFER_SIZE = 100;

  private constructor() {}

  static getInstance(): ExitDecisionLoggerService {
    if (!ExitDecisionLoggerService.instance) {
      ExitDecisionLoggerService.instance = new ExitDecisionLoggerService();
    }
    return ExitDecisionLoggerService.instance;
  }

  start(): void {
    if (this.flushInterval) return;
    
    console.log("[ExitDecisionLogger] Started logging exit decisions");
    this.flushInterval = setInterval(() => {
      this.flushBuffer().catch(() => {});
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
   * Log an exit decision check for a position.
   * Called each time exit conditions are evaluated.
   */
  logExitCheck(
    positionId: number,
    checks: ExitCheck[],
    triggeredExit: string | null,
    metrics: ExitMetrics,
    priority?: number
  ): void {
    this.writeBuffer.push({
      timestamp: new Date(),
      positionId,
      exitChecks: checks,
      triggeredExit: triggeredExit || null,
      priority: priority || null,
      currentPrice: String(metrics.currentPrice),
      unrealizedPnl: String(metrics.unrealizedPnl),
      unrealizedPnlPercent: String(metrics.unrealizedPnlPercent),
      holdTimeMinutes: metrics.holdTimeMinutes,
      currentConsensus: metrics.currentConsensus ? String(metrics.currentConsensus) : null,
      entryConsensus: metrics.entryConsensus ? String(metrics.entryConsensus) : null,
      metadata: metrics.metadata || null,
    });

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
      await db.insert(exitDecisionLog).values(entries);
    } catch (err: any) {
      console.error("[ExitDecisionLogger] Batch flush failed:", err.message);
    }
  }
}

export const exitDecisionLogger = ExitDecisionLoggerService.getInstance();
export { ExitDecisionLoggerService };
