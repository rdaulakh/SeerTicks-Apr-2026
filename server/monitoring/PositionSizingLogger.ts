/**
 * PositionSizingLogger - P1 HIGH
 * 
 * Logs every position sizing decision with full context.
 * Answers: Why was this size chosen? What constraints were applied?
 * 
 * Usage:
 *   positionSizingLogger.logSizingDecision({
 *     positionId: 123,
 *     symbol: "BTC-USD",
 *     side: "long",
 *     intendedRiskAmount: 500,
 *     ...
 *   });
 */

import { getDb } from "../db";
import { positionSizingLog } from "../../drizzle/schema";

interface SizingDecision {
  positionId?: number;
  symbol: string;
  side: string;
  intendedRiskAmount: number;
  intendedRiskPercent: number;
  stopLossDistance: number;
  calculatedSize: number;
  sizeBeforeConstraints: number;
  sizeAfterConstraints: number;
  constraintsApplied: Array<{ constraint: string; impact: string }>;
  finalSize: number;
  finalCapitalUsed: number;
  finalCapitalPercent: number;
  accountBalance: number;
  availableCapital: number;
  openPositionsCount: number;
}

class PositionSizingLoggerService {
  private static instance: PositionSizingLoggerService | null = null;
  private writeBuffer: any[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 15_000;
  private readonly MAX_BUFFER_SIZE = 50;

  private constructor() {}

  static getInstance(): PositionSizingLoggerService {
    if (!PositionSizingLoggerService.instance) {
      PositionSizingLoggerService.instance = new PositionSizingLoggerService();
    }
    return PositionSizingLoggerService.instance;
  }

  start(): void {
    if (this.flushInterval) return;
    
    console.log("[PositionSizingLogger] Started");
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
   * Log a position sizing decision.
   */
  logSizingDecision(decision: SizingDecision): void {
    this.writeBuffer.push({
      timestamp: new Date(),
      positionId: decision.positionId || null,
      symbol: decision.symbol,
      side: decision.side,
      intendedRiskAmount: String(decision.intendedRiskAmount),
      intendedRiskPercent: String(decision.intendedRiskPercent),
      stopLossDistance: String(decision.stopLossDistance),
      calculatedSize: String(decision.calculatedSize),
      sizeBeforeConstraints: String(decision.sizeBeforeConstraints),
      sizeAfterConstraints: String(decision.sizeAfterConstraints),
      constraintsApplied: decision.constraintsApplied,
      finalSize: String(decision.finalSize),
      finalCapitalUsed: String(decision.finalCapitalUsed),
      finalCapitalPercent: String(decision.finalCapitalPercent),
      accountBalance: String(decision.accountBalance),
      availableCapital: String(decision.availableCapital),
      openPositionsCount: decision.openPositionsCount,
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
      await db.insert(positionSizingLog).values(entries);
    } catch (err: any) {
      console.error("[PositionSizingLogger] Batch flush failed:", err.message);
    }
  }
}

export const positionSizingLogger = PositionSizingLoggerService.getInstance();
export { PositionSizingLoggerService };
