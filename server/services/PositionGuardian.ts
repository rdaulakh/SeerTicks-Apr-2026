/**
 * PositionGuardian — The Last Line of Defense for Open Positions
 *
 * PHILOSOPHY: Positions must NEVER be left unmonitored. If the engine crashes,
 * if the price feed dies, if the DB disconnects — open positions are like a
 * blind person driving on a highway. This service ensures:
 *
 * 1. DEAD MAN'S SWITCH: If no price tick received for 2 minutes → emergency exit all
 * 2. CRASH RECOVERY: On server restart, verify positions are being monitored
 * 3. LIVENESS WATCHDOG: Verify IntelligentExitManager is actually processing ticks
 * 4. UPTIME TRACKING: Track engine uptime with 99.9% target
 * 5. HEARTBEAT: Persistent heartbeat to DB for external monitoring
 *
 * This runs INDEPENDENTLY of the trading engine. Even if the engine is "stopped"
 * or in a bad state, the Guardian protects open positions.
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

interface GuardianConfig {
  /** Max seconds without a price tick before emergency exit (default: 120) */
  deadManSwitchSeconds: number;
  /** Max seconds without exit manager processing a tick (default: 180) */
  exitManagerStalenessSeconds: number;
  /** How often to check liveness (default: 10000ms) */
  checkIntervalMs: number;
  /** How often to write heartbeat to DB (default: 30000ms) */
  heartbeatIntervalMs: number;
  /** User ID for DB operations */
  userId: number;
  /** Phase 15A: Max daily loss as fraction of balance (default: 0.05 = 5%) */
  maxDailyLossPercent: number;
}

interface UptimeRecord {
  startTime: number;
  totalUptime: number;
  totalDowntime: number;
  lastDownAt: number | null;
  lastUpAt: number;
  crashCount: number;
  emergencyExitCount: number;
}

const DEFAULT_CONFIG: GuardianConfig = {
  deadManSwitchSeconds: 15,      // 15 seconds without ANY price data → emergency exit (Phase 11C: reduced from 60s — with 2 WS feeds, 15s silence is catastrophic)
  exitManagerStalenessSeconds: 90, // 90 seconds without exit manager tick → alert
  checkIntervalMs: 5_000,        // Check every 5 seconds — positions are precious
  heartbeatIntervalMs: 15_000,   // Heartbeat every 15 seconds
  userId: 0,
  maxDailyLossPercent: 0.05,     // Phase 15A: 5% max daily loss
};

class PositionGuardianService extends EventEmitter {
  private config: GuardianConfig;
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Liveness tracking
  private lastPriceTickTime = 0;
  private lastExitManagerTickTime = 0;
  private lastEngineHeartbeat = 0;
  private engineIsRunning = false;

  // Uptime tracking
  private uptime: UptimeRecord = {
    startTime: getActiveClock().now(),
    totalUptime: 0,
    totalDowntime: 0,
    lastDownAt: null,
    lastUpAt: getActiveClock().now(),
    crashCount: 0,
    emergencyExitCount: 0,
  };

  // Dead man's switch state
  private deadManTriggered = false;
  private emergencyExitInProgress = false;

  // Phase 15A: Daily loss tracking
  private dailyPnLTrackingDate: string = '';
  private dailyClosedPnL: number = 0;
  private dailyLossHaltTriggered: boolean = false;
  private startOfDayBalance: number = 0;

  constructor(config?: Partial<GuardianConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the Position Guardian. Should be called at server boot,
   * INDEPENDENT of engine start.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.uptime.startTime = getActiveClock().now();
    this.uptime.lastUpAt = getActiveClock().now();

    console.log('[PositionGuardian] 🛡️ Starting Position Guardian — positions will NEVER be left unmonitored');
    console.log(`[PositionGuardian] Dead man's switch: ${this.config.deadManSwitchSeconds}s without price data → emergency exit`);
    console.log(`[PositionGuardian] Exit manager staleness: ${this.config.exitManagerStalenessSeconds}s → alert`);

    // Main liveness check loop
    this.checkInterval = setInterval(() => this.performLivenessCheck(), this.config.checkIntervalMs);

    // Heartbeat to DB
    this.heartbeatInterval = setInterval(() => this.writeHeartbeat(), this.config.heartbeatIntervalMs);
  }

  /**
   * Stop the guardian (only on intentional server shutdown AFTER positions are closed)
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.checkInterval = null;
    this.heartbeatInterval = null;
    console.log('[PositionGuardian] Guardian stopped');
  }

  // =========================================================================
  // EXTERNAL SIGNALS — Called by other services to report liveness
  // =========================================================================

  /** Called by priceFeedService on every tick */
  onPriceTick(): void {
    this.lastPriceTickTime = getActiveClock().now();
    // Reset dead man's switch if it was triggered
    if (this.deadManTriggered) {
      console.log('[PositionGuardian] ✅ Price feed recovered — dead man\'s switch reset');
      this.deadManTriggered = false;
    }
  }

  /** Called by IntelligentExitManager when it processes a tick */
  onExitManagerTick(): void {
    this.lastExitManagerTickTime = getActiveClock().now();
  }

  /** Called by engine to report its state */
  onEngineHeartbeat(isRunning: boolean): void {
    this.lastEngineHeartbeat = getActiveClock().now();
    this.engineIsRunning = isRunning;
  }

  /** Record a crash event */
  recordCrash(): void {
    this.uptime.crashCount++;
    this.uptime.lastDownAt = getActiveClock().now();
    console.error(`[PositionGuardian] 💥 Crash recorded. Total crashes: ${this.uptime.crashCount}`);
  }

  // =========================================================================
  // LIVENESS CHECK — The core loop
  // =========================================================================

  private async performLivenessCheck(): Promise<void> {
    const now = getActiveClock().now();

    try {
      // 1. Check for open positions
      const openPositions = await this.getOpenPositions();

      if (openPositions.length === 0) {
        // No positions = no risk. Just update uptime.
        this.updateUptime(true);
        return;
      }

      // 2. DEAD MAN'S SWITCH: No price data for configured time
      const priceStalenessSeconds = (now - this.lastPriceTickTime) / 1000;
      if (this.lastPriceTickTime > 0 && priceStalenessSeconds > this.config.deadManSwitchSeconds) {
        if (!this.deadManTriggered && !this.emergencyExitInProgress) {
          console.error(`[PositionGuardian] 🚨🚨🚨 DEAD MAN'S SWITCH TRIGGERED — No price data for ${priceStalenessSeconds.toFixed(0)}s`);
          console.error(`[PositionGuardian] Emergency closing ${openPositions.length} positions`);
          this.deadManTriggered = true;
          this.uptime.emergencyExitCount++;
          await this.emergencyExitAllPositions(openPositions, 'DEAD_MANS_SWITCH: No price data');
        }
      }

      // 3. Check exit manager liveness
      const exitManagerStaleness = (now - this.lastExitManagerTickTime) / 1000;
      if (this.lastExitManagerTickTime > 0 && exitManagerStaleness > this.config.exitManagerStalenessSeconds) {
        console.warn(`[PositionGuardian] ⚠️ Exit manager stale for ${exitManagerStaleness.toFixed(0)}s — positions may not be monitored`);
        this.emit('exitManagerStale', { stalenessSeconds: exitManagerStaleness, openPositions: openPositions.length });
      }

      // 4. Check engine liveness
      const engineStaleness = (now - this.lastEngineHeartbeat) / 1000;
      if (this.lastEngineHeartbeat > 0 && engineStaleness > 120) {
        console.warn(`[PositionGuardian] ⚠️ Engine heartbeat stale for ${engineStaleness.toFixed(0)}s`);
        this.emit('engineStale', { stalenessSeconds: engineStaleness });
      }

      // 5. Phase 15A: Daily loss monitoring — check P&L of closed trades today
      await this.checkDailyLossLimit();

      // 6. Update uptime
      const isHealthy = priceStalenessSeconds < 30 && exitManagerStaleness < 60;
      this.updateUptime(isHealthy);

    } catch (err) {
      console.error('[PositionGuardian] Liveness check error:', (err as Error)?.message);
    }
  }

  // =========================================================================
  // EMERGENCY EXIT — Last resort position closure
  // =========================================================================

  private async emergencyExitAllPositions(positions: any[], reason: string): Promise<void> {
    if (this.emergencyExitInProgress) return;
    this.emergencyExitInProgress = true;

    console.error(`[PositionGuardian] 🚨 EMERGENCY EXIT: ${reason}`);
    console.error(`[PositionGuardian] Closing ${positions.length} positions at last known prices`);

    try {
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { priceFeedService } = await import('./priceFeedService');

      const db = await getDb();
      if (!db) {
        console.error('[PositionGuardian] CANNOT EXECUTE EMERGENCY EXIT — DB unavailable');
        this.emit('emergencyExitFailed', { reason: 'DB unavailable', positions: positions.length });
        this.emergencyExitInProgress = false;
        return;
      }

      for (const pos of positions) {
        try {
          const priceData = priceFeedService.getLatestPrice(pos.symbol);
          // Phase 23: Zero-tolerance — only use real market price, no entryPrice fallback
          const candidatePrice = priceData?.price || Number(pos.currentPrice) || 0;

          // PHASE 13A: NEVER exit at price $0 — this was the root cause of -$326K phantom losses.
          // Paper trading only, so no real money at risk, but corrupted P&L data is useless.
          // If no valid price, SKIP this position — leave it open for manual review.
          if (!candidatePrice || candidatePrice <= 0 || isNaN(candidatePrice)) {
            console.error(`[PositionGuardian] ❌ SKIPPING emergency exit for position ${pos.id} (${pos.symbol}) — no valid price available (got ${candidatePrice}). Position left OPEN for manual review.`);
            continue;
          }

          const exitPrice = candidatePrice;
          const entryPrice = Number(pos.entryPrice);
          const quantity = Number(pos.quantity);
          const side = pos.side as 'long' | 'short';

          const pnlMultiplier = side === 'long' ? 1 : -1;
          const pnl = pnlMultiplier * (exitPrice - entryPrice) * quantity;

          await db.update(paperPositions)
            .set({
              status: 'closed',
              exitPrice: String(exitPrice),
              exitTime: new Date(),
              realizedPnl: String(pnl),
              exitReason: `GUARDIAN_EMERGENCY: ${reason}`,
            })
            .where(eq(paperPositions.id, pos.id));

          console.error(`[PositionGuardian] ⚡ Emergency closed position ${pos.id}: ${pos.symbol} ${side} @ ${exitPrice} | P&L: $${pnl.toFixed(2)}`);
        } catch (posErr) {
          console.error(`[PositionGuardian] Failed to emergency close position ${pos.id}:`, (posErr as Error)?.message);
        }
      }

      this.emit('emergencyExitComplete', { reason, positionsClosed: positions.length });
    } catch (err) {
      console.error('[PositionGuardian] Emergency exit failed:', (err as Error)?.message);
      this.emit('emergencyExitFailed', { reason: (err as Error)?.message });
    } finally {
      this.emergencyExitInProgress = false;
    }
  }

  // =========================================================================
  // Phase 15A: DAILY LOSS MONITORING
  // =========================================================================

  /**
   * Check if daily closed P&L has breached the configured loss limit.
   * If breached: emergency exit all open positions + halt trading.
   * This runs every 5 seconds as part of the liveness check loop.
   */
  private async checkDailyLossLimit(): Promise<void> {
    if (this.dailyLossHaltTriggered) return; // Already triggered today

    try {
      const today = new Date().toISOString().slice(0, 10);
      if (this.dailyPnLTrackingDate !== today) {
        // New day — reset tracking
        this.dailyPnLTrackingDate = today;
        this.dailyClosedPnL = 0;
        this.dailyLossHaltTriggered = false;
        this.startOfDayBalance = 0;
      }

      const { getDb } = await import('../db');
      const { paperPositions, paperWallets } = await import('../../drizzle/schema');
      const { eq, and, gte } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) return;

      // Get start-of-day balance (cached per day)
      if (this.startOfDayBalance === 0) {
        const wallet = await db.select().from(paperWallets)
          .where(eq(paperWallets.userId, this.config.userId))
          .limit(1);
        if (wallet.length > 0) {
          this.startOfDayBalance = parseFloat(wallet[0].balance);
        }
      }

      if (this.startOfDayBalance <= 0) return;

      // Sum P&L of all positions closed today
      const todayStart = new Date(today + 'T00:00:00.000Z');
      const closedToday = await db.select({
        pnl: paperPositions.realizedPnl,
      }).from(paperPositions).where(
        and(
          eq(paperPositions.userId, this.config.userId),
          eq(paperPositions.status, 'closed'),
          gte(paperPositions.exitTime, todayStart)
        )
      );

      this.dailyClosedPnL = closedToday.reduce((sum, p) => sum + parseFloat(p.pnl || '0'), 0);

      const lossLimit = this.startOfDayBalance * this.config.maxDailyLossPercent;

      if (this.dailyClosedPnL < -lossLimit) {
        this.dailyLossHaltTriggered = true;
        const openPositions = await this.getOpenPositions();

        console.error(`[PositionGuardian] 🚨 DAILY LOSS LIMIT BREACHED: $${Math.abs(this.dailyClosedPnL).toFixed(2)} > $${lossLimit.toFixed(2)} (${(this.config.maxDailyLossPercent * 100).toFixed(0)}% of $${this.startOfDayBalance.toFixed(2)})`);

        // Emergency exit all open positions
        if (openPositions.length > 0) {
          console.error(`[PositionGuardian] Emergency closing ${openPositions.length} positions due to daily loss limit`);
          await this.emergencyExitAllPositions(openPositions, `DAILY_LOSS_LIMIT: $${Math.abs(this.dailyClosedPnL).toFixed(2)} > $${lossLimit.toFixed(2)}`);
        }

        // Emit event for engine-level halt
        this.emit('dailyLossLimitBreached', {
          dailyPnL: this.dailyClosedPnL,
          lossLimit: -lossLimit,
          startOfDayBalance: this.startOfDayBalance,
          positionsClosed: openPositions.length,
        });
      }
    } catch (err) {
      // Non-critical — don't crash the guardian
      console.error('[PositionGuardian] Daily loss check error:', (err as Error)?.message);
    }
  }

  /**
   * Phase 15A: External method to record a trade completion for real-time tracking.
   * Called from seerMainMulti.ts on every position close, avoiding the need to
   * query the DB on every 5-second check cycle.
   */
  recordTradeClose(pnl: number): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyPnLTrackingDate !== today) {
      this.dailyPnLTrackingDate = today;
      this.dailyClosedPnL = 0;
      this.dailyLossHaltTriggered = false;
    }
    this.dailyClosedPnL += pnl;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private async getOpenPositions(): Promise<any[]> {
    try {
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) return [];

      return await db.select().from(paperPositions).where(
        and(
          eq(paperPositions.userId, this.config.userId),
          eq(paperPositions.status, 'open')
        )
      );
    } catch {
      return [];
    }
  }

  private updateUptime(isHealthy: boolean): void {
    const now = getActiveClock().now();
    if (isHealthy) {
      if (this.uptime.lastDownAt) {
        // Recovering from downtime
        this.uptime.totalDowntime += now - this.uptime.lastDownAt;
        this.uptime.lastDownAt = null;
      }
      this.uptime.lastUpAt = now;
      this.uptime.totalUptime = now - this.uptime.startTime - this.uptime.totalDowntime;
    } else {
      if (!this.uptime.lastDownAt) {
        this.uptime.lastDownAt = now;
      }
    }
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const totalElapsed = getActiveClock().now() - this.uptime.startTime;
      const uptimePercent = totalElapsed > 0
        ? ((totalElapsed - this.uptime.totalDowntime) / totalElapsed * 100)
        : 100;

      // Write to systemConfig table as a heartbeat record
      const heartbeatData = {
        timestamp: new Date().toISOString(),
        uptimePercent: uptimePercent.toFixed(3),
        totalUptime: this.uptime.totalUptime,
        totalDowntime: this.uptime.totalDowntime,
        crashCount: this.uptime.crashCount,
        emergencyExitCount: this.uptime.emergencyExitCount,
        lastPriceTick: this.lastPriceTickTime,
        lastExitManagerTick: this.lastExitManagerTickTime,
        lastEngineHeartbeat: this.lastEngineHeartbeat,
        engineIsRunning: this.engineIsRunning,
        deadManTriggered: this.deadManTriggered,
      };

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      // Upsert heartbeat
      const existing = await db.select().from(systemConfig)
        .where(eq(systemConfig.configKey, 'position_guardian_heartbeat'))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: JSON.stringify(heartbeatData), updatedAt: new Date() })
          .where(eq(systemConfig.configKey, 'position_guardian_heartbeat'));
      } else {
        await db.insert(systemConfig).values({
          userId: 0,
          configKey: 'position_guardian_heartbeat',
          configValue: JSON.stringify(heartbeatData),
        });
      }
    } catch {
      // Non-critical — don't crash the guardian for a heartbeat failure
    }
  }

  // =========================================================================
  // STATUS API
  // =========================================================================

  getStatus() {
    const now = getActiveClock().now();
    const totalElapsed = now - this.uptime.startTime;
    const uptimePercent = totalElapsed > 0
      ? ((totalElapsed - this.uptime.totalDowntime) / totalElapsed * 100)
      : 100;

    return {
      isRunning: this.isRunning,
      uptime: {
        percent: parseFloat(uptimePercent.toFixed(3)),
        totalMs: this.uptime.totalUptime,
        downtimeMs: this.uptime.totalDowntime,
        startedAt: new Date(this.uptime.startTime).toISOString(),
        target: 99.9,
        meetingTarget: uptimePercent >= 99.9,
      },
      liveness: {
        lastPriceTick: this.lastPriceTickTime ? new Date(this.lastPriceTickTime).toISOString() : null,
        priceStalenessMs: this.lastPriceTickTime ? now - this.lastPriceTickTime : null,
        lastExitManagerTick: this.lastExitManagerTickTime ? new Date(this.lastExitManagerTickTime).toISOString() : null,
        exitManagerStalenessMs: this.lastExitManagerTickTime ? now - this.lastExitManagerTickTime : null,
        lastEngineHeartbeat: this.lastEngineHeartbeat ? new Date(this.lastEngineHeartbeat).toISOString() : null,
        engineIsRunning: this.engineIsRunning,
      },
      safety: {
        deadManTriggered: this.deadManTriggered,
        emergencyExitInProgress: this.emergencyExitInProgress,
        crashCount: this.uptime.crashCount,
        emergencyExitCount: this.uptime.emergencyExitCount,
      },
    };
  }
}

// Singleton
let guardianInstance: PositionGuardianService | null = null;

export function getPositionGuardian(config?: Partial<GuardianConfig>): PositionGuardianService {
  if (!guardianInstance) {
    guardianInstance = new PositionGuardianService(config);
  }
  return guardianInstance;
}

export { PositionGuardianService, GuardianConfig };
