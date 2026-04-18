/**
 * EntryValidationLogger - P2 OPTIMIZATION
 * 
 * Logs every entry validation decision with full context.
 * Answers: Why was this trade taken/skipped? What was the validation score?
 * 
 * Usage:
 *   entryValidationLogger.logValidation({
 *     symbol: "BTC-USD",
 *     consensusStrength: 0.75,
 *     finalDecision: "enter",
 *     ...
 *   });
 */

import { getDb } from "../db";
import { entryValidationLog } from "../../drizzle/schema";

interface EntryValidation {
  symbol: string;
  consensusStrength: number;
  priceConfirmation: number;
  trendAlignment: number;
  volumeConfirmation: number;
  historicalEdge: number;
  finalDecision: string; // "enter" | "skip" | "wait"
  skipReason?: string;
  agentSignals?: Array<{ agent: string; signal: string; confidence: number; weight: number }>;
  metadata?: Record<string, any>;
}

class EntryValidationLoggerService {
  private static instance: EntryValidationLoggerService | null = null;
  private writeBuffer: any[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 15_000;
  private readonly MAX_BUFFER_SIZE = 100;

  private constructor() {}

  static getInstance(): EntryValidationLoggerService {
    if (!EntryValidationLoggerService.instance) {
      EntryValidationLoggerService.instance = new EntryValidationLoggerService();
    }
    return EntryValidationLoggerService.instance;
  }

  start(): void {
    if (this.flushInterval) return;
    
    console.log("[EntryValidationLogger] Started");
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
   * Log an entry validation decision.
   */
  logValidation(validation: EntryValidation): void {
    this.writeBuffer.push({
      timestamp: new Date(),
      symbol: validation.symbol,
      consensusStrength: String(validation.consensusStrength),
      priceConfirmation: validation.priceConfirmation,
      trendAlignment: validation.trendAlignment,
      volumeConfirmation: validation.volumeConfirmation,
      historicalEdge: validation.historicalEdge,
      finalDecision: validation.finalDecision,
      skipReason: validation.skipReason || null,
      agentSignals: validation.agentSignals || null,
      metadata: validation.metadata || null,
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
      await db.insert(entryValidationLog).values(entries);
    } catch (err: any) {
      console.error("[EntryValidationLogger] Batch flush failed:", err.message);
    }
  }
}

export const entryValidationLogger = EntryValidationLoggerService.getInstance();
export { EntryValidationLoggerService };
