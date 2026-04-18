/**
 * CapitalUtilizationLogger - P1 HIGH
 * 
 * Tracks capital deployment efficiency every 5 minutes.
 * Answers: How much capital is idle vs deployed? What's the risk exposure?
 * 
 * Usage:
 *   capitalUtilizationLogger.updateSnapshot({
 *     totalCapital: 100000,
 *     deployedCapital: 45000,
 *     openPositionsCount: 3,
 *     ...
 *   });
 */

import { getDb } from "../db";
import { capitalUtilization } from "../../drizzle/schema";

interface CapitalSnapshot {
  totalCapital: number;
  deployedCapital: number;
  reservedCapital?: number;
  openPositionsCount: number;
  totalPositionValue: number;
  avgPositionSize?: number;
  largestPositionSize?: number;
  totalRiskExposure?: number;
}

class CapitalUtilizationLoggerService {
  private static instance: CapitalUtilizationLoggerService | null = null;
  private recordInterval: NodeJS.Timeout | null = null;
  private readonly RECORD_INTERVAL_MS = 5 * 60_000; // Every 5 minutes
  
  // Latest snapshot for quick access
  private latestSnapshot: CapitalSnapshot | null = null;

  private constructor() {}

  static getInstance(): CapitalUtilizationLoggerService {
    if (!CapitalUtilizationLoggerService.instance) {
      CapitalUtilizationLoggerService.instance = new CapitalUtilizationLoggerService();
    }
    return CapitalUtilizationLoggerService.instance;
  }

  start(): void {
    if (this.recordInterval) return;
    
    console.log("[CapitalUtilizationLogger] Started (5-minute intervals)");
    this.recordInterval = setInterval(() => {
      this.recordSnapshot().catch(() => {});
    }, this.RECORD_INTERVAL_MS);

    if (this.recordInterval.unref) {
      this.recordInterval.unref();
    }
  }

  stop(): void {
    if (this.recordInterval) {
      clearInterval(this.recordInterval);
      this.recordInterval = null;
    }
  }

  /**
   * Update the latest capital snapshot. Called by the engine.
   */
  updateSnapshot(snapshot: CapitalSnapshot): void {
    this.latestSnapshot = snapshot;
  }

  /**
   * Get latest snapshot for health dashboard.
   */
  getLatestSnapshot(): CapitalSnapshot | null {
    return this.latestSnapshot;
  }

  /**
   * Internal: Record current snapshot to database.
   */
  private async recordSnapshot(): Promise<void> {
    if (!this.latestSnapshot) return;

    const s = this.latestSnapshot;
    const idleCapital = s.totalCapital - s.deployedCapital - (s.reservedCapital || 0);
    const utilizationPercent = s.totalCapital > 0 ? (s.deployedCapital / s.totalCapital) * 100 : 0;
    const riskPercent = s.totalCapital > 0 && s.totalRiskExposure
      ? (s.totalRiskExposure / s.totalCapital) * 100
      : 0;

    try {
      const db = await getDb();
      if (!db) return;

      await db.insert(capitalUtilization).values({
        timestamp: new Date(),
        totalCapital: String(s.totalCapital),
        deployedCapital: String(s.deployedCapital),
        idleCapital: String(idleCapital),
        reservedCapital: s.reservedCapital ? String(s.reservedCapital) : null,
        utilizationPercent: String(utilizationPercent.toFixed(2)),
        openPositionsCount: s.openPositionsCount,
        totalPositionValue: String(s.totalPositionValue),
        avgPositionSize: s.avgPositionSize ? String(s.avgPositionSize) : null,
        largestPositionSize: s.largestPositionSize ? String(s.largestPositionSize) : null,
        totalRiskExposure: s.totalRiskExposure ? String(s.totalRiskExposure) : null,
        riskPercent: String(riskPercent.toFixed(2)),
      });
    } catch (err: any) {
      console.error("[CapitalUtilizationLogger] DB write failed:", err.message);
    }
  }
}

export const capitalUtilizationLogger = CapitalUtilizationLoggerService.getInstance();
export { CapitalUtilizationLoggerService };
