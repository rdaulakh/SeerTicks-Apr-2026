import { PositionReconciliationService } from "./PositionReconciliationService";
import { getActiveClock } from '../_core/clock';

/**
 * Reconciliation Scheduler
 * 
 * Manages scheduled reconciliation jobs for all users.
 * Runs reconciliation at configurable intervals (default: 5 minutes)
 * 
 * Features:
 * - Automatic scheduling with configurable interval
 * - Per-user reconciliation tracking
 * - Failure handling and retry logic
 * - Performance monitoring
 */

export class ReconciliationScheduler {
  private intervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private userIds: Set<number> = new Set();

  // Default: run every 5 minutes
  constructor(intervalMinutes: number = 5) {
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  /**
   * Start the reconciliation scheduler
   */
  start() {
    if (this.isRunning) {
      console.log("[ReconciliationScheduler] Already running");
      return;
    }

    console.log(`[ReconciliationScheduler] Starting with ${this.intervalMs / 60000}min interval`);
    this.isRunning = true;

    // Run immediately on start
    this.runReconciliation();

    // Schedule recurring runs
    this.intervalId = setInterval(() => {
      this.runReconciliation();
    }, this.intervalMs);
  }

  /**
   * Stop the reconciliation scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log("[ReconciliationScheduler] Not running");
      return;
    }

    console.log("[ReconciliationScheduler] Stopping");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Add a user to the reconciliation schedule
   */
  addUser(userId: number) {
    this.userIds.add(userId);
    console.log(`[ReconciliationScheduler] Added user ${userId} to reconciliation schedule`);
  }

  /**
   * Remove a user from the reconciliation schedule
   */
  removeUser(userId: number) {
    this.userIds.delete(userId);
    console.log(`[ReconciliationScheduler] Removed user ${userId} from reconciliation schedule`);
  }

  /**
   * Run reconciliation for all registered users
   */
  private async runReconciliation() {
    if (this.userIds.size === 0) {
      console.log("[ReconciliationScheduler] No users registered for reconciliation");
      return;
    }

    console.log(`[ReconciliationScheduler] Running reconciliation for ${this.userIds.size} users`);
    const startTime = getActiveClock().now();

    const results = await Promise.allSettled(
      Array.from(this.userIds).map(userId => this.reconcileUser(userId))
    );

    const executionTimeMs = getActiveClock().now() - startTime;

    // Log summary
    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    console.log(
      `[ReconciliationScheduler] Completed in ${executionTimeMs}ms: ` +
      `${succeeded} succeeded, ${failed} failed`
    );

    // Log failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const userId = Array.from(this.userIds)[index];
        console.error(
          `[ReconciliationScheduler] Reconciliation failed for user ${userId}:`,
          result.reason
        );
      }
    });
  }

  /**
   * Run reconciliation for a specific user
   */
  private async reconcileUser(userId: number) {
    try {
      const service = new PositionReconciliationService(userId);
      const result = await service.reconcile("scheduled");

      console.log(
        `[ReconciliationScheduler] User ${userId}: ` +
        `${result.totalPositionsChecked} positions checked, ` +
        `${result.discrepanciesFound} discrepancies found, ` +
        `${result.autoResolved} auto-resolved, ` +
        `${result.manualReviewRequired} require manual review`
      );

      return result;
    } catch (error) {
      console.error(`[ReconciliationScheduler] Error reconciling user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Trigger manual reconciliation for a specific user
   */
  async triggerManual(userId: number) {
    console.log(`[ReconciliationScheduler] Triggering manual reconciliation for user ${userId}`);
    
    const service = new PositionReconciliationService(userId);
    return await service.reconcile("manual");
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMinutes: this.intervalMs / 60000,
      registeredUsers: this.userIds.size,
      users: Array.from(this.userIds),
    };
  }
}

// Global scheduler instance
let globalScheduler: ReconciliationScheduler | null = null;

/**
 * Get or create the global reconciliation scheduler
 */
export function getReconciliationScheduler(intervalMinutes?: number): ReconciliationScheduler {
  if (!globalScheduler) {
    globalScheduler = new ReconciliationScheduler(intervalMinutes);
  }
  return globalScheduler;
}

/**
 * Initialize reconciliation scheduler on server startup
 * Call this from your server initialization code
 */
export function initializeReconciliationScheduler(intervalMinutes: number = 5) {
  const scheduler = getReconciliationScheduler(intervalMinutes);
  scheduler.start();
  
  console.log(`[ReconciliationScheduler] Initialized with ${intervalMinutes}min interval`);
  
  return scheduler;
}
