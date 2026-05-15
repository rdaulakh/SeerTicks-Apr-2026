/**
 * EngineHeartbeat — Phase 66 watchdog and dead-man's-switch.
 *
 * The May 7 cascade ran for hours and the engine then stayed silent for
 * 3 days because nothing was watching it. This service is the guarantor:
 * if any of the pulse points stops beating, an alert fires; if the daily
 * PnL exceeds a hard band, trading auto-halts.
 *
 * Pulse points (timestamped on each event):
 *
 *   - lastSignalAt   — most recent agent signal received
 *   - lastDecisionAt — most recent SIGNAL_APPROVED or SIGNAL_REJECTED
 *   - lastFillAt     — most recent successful order fill
 *   - lastPriceTickAt — most recent price-feed tick
 *
 * Failure modes detected:
 *
 *   - All four pulses idle > thresholds → engine is wedged → halt + alert
 *   - lastPriceTickAt fresh but lastSignalAt stale > 5min → agent thread died
 *   - lastDecisionAt fresh but lastFillAt stale > 1h with open positions →
 *     execution layer broken
 *   - dailyPnlPercent < halt threshold → blow-up protection halt
 *
 * The watchdog DOESN'T resolve the failure — its job is to halt trading
 * and surface the truth. Recovery is operator-initiated.
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { executionLogger } from '../utils/logger';

export interface HeartbeatConfig {
  signalIdleThresholdMs: number;      // default 5 min — agent thread death
  decisionIdleThresholdMs: number;    // default 5 min — pipeline death
  fillIdleThresholdMs: number;        // default 60 min — execution death (only if positions are open)
  priceTickIdleThresholdMs: number;   // default 60 sec — price feed death
  dailyPnlHaltPercent: number;        // default -5% — blow-up halt
  checkIntervalMs: number;            // default 30 sec
}

const DEFAULTS: HeartbeatConfig = {
  signalIdleThresholdMs: 5 * 60 * 1000,
  decisionIdleThresholdMs: 5 * 60 * 1000,
  fillIdleThresholdMs: 60 * 60 * 1000,
  priceTickIdleThresholdMs: 60 * 1000,
  dailyPnlHaltPercent: -5,
  checkIntervalMs: 30 * 1000,
};

export interface HeartbeatStatus {
  healthy: boolean;
  reasons: string[];                  // empty when healthy
  lastSignalAt: number | null;
  lastDecisionAt: number | null;
  lastFillAt: number | null;
  lastPriceTickAt: number | null;
  signalIdleSec: number | null;
  decisionIdleSec: number | null;
  fillIdleSec: number | null;
  priceTickIdleSec: number | null;
  dailyPnlPercent: number;
  haltActive: boolean;
  haltReason?: string;
}

export class EngineHeartbeat extends EventEmitter {
  private cfg: HeartbeatConfig;
  private lastSignalAt: number | null = null;
  private lastDecisionAt: number | null = null;
  private lastFillAt: number | null = null;
  private lastPriceTickAt: number | null = null;
  private dailyPnl = 0;
  private dailyPnlBaseEquity = 0;
  private dailyPnlResetDate = '';
  private openPositionCount = 0;
  private haltActive = false;
  private haltReason: string | undefined;
  private interval: NodeJS.Timeout | null = null;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    super();
    this.cfg = { ...DEFAULTS, ...config };
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), this.cfg.checkIntervalMs);
    executionLogger.info('EngineHeartbeat started', { intervalMs: this.cfg.checkIntervalMs });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // — Pulse recorders. Wire these from the existing event emitters. —
  recordSignal(): void { this.lastSignalAt = getActiveClock().now(); }
  recordDecision(): void { this.lastDecisionAt = getActiveClock().now(); }
  recordFill(): void { this.lastFillAt = getActiveClock().now(); }
  recordPriceTick(): void { this.lastPriceTickAt = getActiveClock().now(); }

  setOpenPositionCount(n: number): void { this.openPositionCount = n; }

  /**
   * Phase 74 — Data consistency watchdog. Periodically checks that:
   *  - tradingModeConfig.mode aligns with the actual tradingMode of open positions
   *  - paperWallets row for the active mode is being updated (not stale)
   *
   * When the engine writes positions tagged 'live' but the user config is
   * 'paper', the UI reads the wrong wallet and surfaces inconsistent stats.
   * This is exactly what happened on 2026-05-11 (header 39.58% vs DB 70%).
   */
  async runDataConsistencyCheck(userId: number): Promise<{ ok: boolean; issues: string[] }> {
    const issues: string[] = [];
    try {
      const { getDb } = await import('../db');
      const { paperWallets, paperPositions, tradingModeConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return { ok: true, issues: [] };

      const [cfg] = await db.select().from(tradingModeConfig).where(eq(tradingModeConfig.userId, userId)).limit(1);
      if (!cfg) return { ok: true, issues: [] };
      const cfgMode = cfg.mode === 'real' ? 'live' : 'paper';

      const openPositions = await db
        .select()
        .from(paperPositions)
        .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')));

      // Check 1: All open positions match the user's config mode
      const mismatched = openPositions.filter((p: any) => p.tradingMode !== cfgMode);
      if (mismatched.length > 0) {
        const symbols = mismatched.map((p: any) => `${p.symbol}(${p.tradingMode})`).join(', ');
        issues.push(`MODE_MISMATCH: cfg=${cfgMode} but positions tagged differently: ${symbols}`);
      }

      // Check 2: Wallet for the active mode exists and isn't stale (>1h)
      const [wallet] = await db
        .select()
        .from(paperWallets)
        .where(and(eq(paperWallets.userId, userId), eq(paperWallets.tradingMode, cfgMode)))
        .limit(1);
      if (!wallet) {
        issues.push(`WALLET_MISSING for mode=${cfgMode}`);
      } else {
        const ageHours = (getActiveClock().now() - new Date(wallet.updatedAt).getTime()) / 3600000;
        if (ageHours > 1 && openPositions.length > 0) {
          issues.push(`WALLET_STALE: ${cfgMode} wallet not updated in ${ageHours.toFixed(1)}h despite ${openPositions.length} open positions`);
        }
      }

      if (issues.length > 0) {
        executionLogger.warn(`[DataConsistency] User ${userId}: ${issues.join(' | ')}`);
      }
    } catch (err) {
      // Best-effort — never crash the watchdog
      executionLogger.warn(`[DataConsistency] Check failed: ${(err as Error).message}`);
    }
    return { ok: issues.length === 0, issues };
  }

  /**
   * Daily PnL update. Caller computes (currentEquity - dayStartEquity) /
   * dayStartEquity * 100. Watchdog auto-halts if it crosses the threshold.
   */
  updateDailyPnl(currentEquity: number): void {
    const today = getActiveClock().date().toISOString().slice(0, 10);
    if (this.dailyPnlResetDate !== today) {
      this.dailyPnlResetDate = today;
      this.dailyPnlBaseEquity = currentEquity;
      this.dailyPnl = 0;
      return;
    }
    if (this.dailyPnlBaseEquity > 0) {
      this.dailyPnl = ((currentEquity - this.dailyPnlBaseEquity) / this.dailyPnlBaseEquity) * 100;
    }
  }

  isHalted(): boolean { return this.haltActive; }
  getHaltReason(): string | undefined { return this.haltReason; }

  /** Operator-initiated reset after investigation. */
  resumeTrading(): void {
    this.haltActive = false;
    this.haltReason = undefined;
    executionLogger.info('EngineHeartbeat: halt cleared (operator reset)');
    this.emit('resumed');
  }

  status(): HeartbeatStatus {
    const now = getActiveClock().now();
    const reasons = this.evaluateHealth(now).reasons;
    const idle = (t: number | null) => t == null ? null : Math.floor((now - t) / 1000);
    return {
      healthy: reasons.length === 0,
      reasons,
      lastSignalAt: this.lastSignalAt,
      lastDecisionAt: this.lastDecisionAt,
      lastFillAt: this.lastFillAt,
      lastPriceTickAt: this.lastPriceTickAt,
      signalIdleSec: idle(this.lastSignalAt),
      decisionIdleSec: idle(this.lastDecisionAt),
      fillIdleSec: idle(this.lastFillAt),
      priceTickIdleSec: idle(this.lastPriceTickAt),
      dailyPnlPercent: this.dailyPnl,
      haltActive: this.haltActive,
      haltReason: this.haltReason,
    };
  }

  private tick(): void {
    const now = getActiveClock().now();
    const { reasons, halt, haltReason } = this.evaluateHealth(now);
    if (halt && !this.haltActive) {
      this.haltActive = true;
      this.haltReason = haltReason;
      executionLogger.error(`🚨 EngineHeartbeat AUTO-HALT: ${haltReason}`);
      this.emit('auto_halt', { reason: haltReason, status: this.status() });
    }
    // Phase 93.29 — AUTO-CLEAR halt when the underlying conditions resolve.
    // Previously the flag was sticky: once tripped (e.g. transient 5-min
    // decision-silent on a slow startup or restart), the platform required
    // an operator `resumeTrading()` call to recover. After Phase 90+ the
    // brain is the authoritative decision engine; with TraderBrain calling
    // recordDecision() every tick, an auto-halt on this signal is almost
    // always a measurement artifact rather than a real outage. If conditions
    // no longer report any halt-class reason AND the daily-PnL gate is OK,
    // clear the flag and resume. Operator can still manually halt via
    // `auto_halt` listeners (kill switch / emergency stop).
    if (!halt && this.haltActive) {
      this.haltActive = false;
      this.haltReason = undefined;
      executionLogger.info('✅ EngineHeartbeat: halt auto-cleared (decision pipeline recovered)');
      this.emit('resumed');
    }
    if (reasons.length > 0) {
      executionLogger.warn(`⚠️ EngineHeartbeat unhealthy: ${reasons.join('; ')}`);
      this.emit('unhealthy', { reasons });
    }
  }

  private evaluateHealth(now: number): { reasons: string[]; halt: boolean; haltReason?: string } {
    const reasons: string[] = [];
    let halt = false;
    let haltReason: string | undefined;

    // Price tick is the cheapest and earliest indicator — if no ticks for
    // 60s, the WebSocket is broken and nothing else can work.
    if (this.lastPriceTickAt != null && now - this.lastPriceTickAt > this.cfg.priceTickIdleThresholdMs) {
      reasons.push(`price feed silent ${Math.floor((now - this.lastPriceTickAt) / 1000)}s`);
    }

    // Signal pipeline — if ticks are flowing but signals aren't, agent
    // thread is wedged or every agent is throwing.
    if (this.lastSignalAt != null && now - this.lastSignalAt > this.cfg.signalIdleThresholdMs) {
      const reason = `signal pipeline silent ${Math.floor((now - this.lastSignalAt) / 60_000)}m`;
      reasons.push(reason);
      halt = true;
      haltReason = reason;
    }

    // Decision pipeline silent — consensus loop dead.
    if (this.lastDecisionAt != null && now - this.lastDecisionAt > this.cfg.decisionIdleThresholdMs) {
      const reason = `decision pipeline silent ${Math.floor((now - this.lastDecisionAt) / 60_000)}m`;
      reasons.push(reason);
      halt = true;
      haltReason = reason;
    }

    // Fill silence only matters when there are open positions to monitor —
    // a flat account with no signals isn't broken.
    if (this.openPositionCount > 0
        && this.lastFillAt != null
        && now - this.lastFillAt > this.cfg.fillIdleThresholdMs) {
      reasons.push(`no fills in ${Math.floor((now - this.lastFillAt) / 60_000)}m despite ${this.openPositionCount} open positions`);
    }

    // Daily-PnL blow-up gate.
    if (this.dailyPnl < this.cfg.dailyPnlHaltPercent) {
      const reason = `daily PnL ${this.dailyPnl.toFixed(2)}% below halt threshold ${this.cfg.dailyPnlHaltPercent}%`;
      reasons.push(reason);
      halt = true;
      haltReason = reason;
    }

    return { reasons, halt, haltReason };
  }
}

// Singleton — one heartbeat per process.
let _instance: EngineHeartbeat | null = null;
export function getEngineHeartbeat(): EngineHeartbeat {
  if (!_instance) _instance = new EngineHeartbeat();
  return _instance;
}
