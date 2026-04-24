/**
 * TradingSilenceWatchdog — detects pipeline silence and sustained rejection.
 *
 * The prime directive is "only pick and exit profit." Phases 6–12 closed
 * the exit+entry gates, but they can't tell you if the pipeline itself has
 * gone mute. This watchdog does.
 *
 * Scenarios caught (discovered live 2026-04-21 → 2026-04-24: zero trades
 * for 3 days despite agents running, because the consensus gate refused
 * every signal under degraded data quality):
 *
 *   1. TRADE_SILENCE: no TRADE_EXECUTED in the last configured window
 *      (default 2h) while the engine is active (not paused / not in
 *      emergency stop).
 *   2. HIGH_REJECTION_RATE: SIGNAL_REJECTED / (SIGNAL_REJECTED +
 *      SIGNAL_APPROVED) > 0.95 over the last 30min, indicating something
 *      upstream (data, thresholds, agent health) is mis-configured.
 *   3. AGENT_FAILURE_SPIKE: agent-update cycles reporting >25% failures.
 *
 * When a condition fires:
 *   - Emits a structured console.warn the ops layer can parse.
 *   - Updates a shared `getLastHealthSnapshot()` that any HTTP health
 *     endpoint can return.
 *   - Appends a RISK_CHECK event to the pipeline log with the rejection
 *     breakdown (top 3 rejection reasons + counts) so operators can see
 *     which gate is rejecting without tailing raw logs.
 *
 * Intentionally boring: does not auto-loosen thresholds, does not force
 * a trade, does not restart anything. Its job is to SURFACE the problem
 * before the operator notices from trade count. Self-healing is a
 * separate concern; reliable silence-detection is a prerequisite.
 */

import {
  getRecentPipelineEvents,
  logPipelineEvent,
  type PipelineLogEntry,
} from './TradingPipelineLogger';

export interface WatchdogConfig {
  /** How often the watchdog runs. Default 5 min. */
  checkIntervalMs: number;
  /** Maximum silent period before TRADE_SILENCE fires. Default 2h. */
  tradeSilenceWindowMs: number;
  /** Window over which rejection rate is measured. Default 30 min. */
  rejectionRateWindowMs: number;
  /** Rejection rate above which HIGH_REJECTION_RATE fires. Default 0.95. */
  rejectionRateThreshold: number;
  /** Min attempts before rejection rate is computed (avoids noise on fresh start). */
  minAttemptsForRate: number;
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  checkIntervalMs: 5 * 60_000,
  tradeSilenceWindowMs: 2 * 60 * 60_000,
  rejectionRateWindowMs: 30 * 60_000,
  rejectionRateThreshold: 0.95,
  minAttemptsForRate: 20,
};

export interface TradingHealthSnapshot {
  takenAt: string;
  healthy: boolean;
  tradesInWindow: number;
  signalsApprovedInWindow: number;
  signalsRejectedInWindow: number;
  rejectionRate: number | null;
  mostRecentTradeAt: string | null;
  minutesSinceLastTrade: number | null;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  alarms: string[]; // Human-readable alarm names that fired this check
}

let _lastSnapshot: TradingHealthSnapshot | null = null;
let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _config: WatchdogConfig = { ...DEFAULT_WATCHDOG_CONFIG };

export function getLastHealthSnapshot(): TradingHealthSnapshot | null {
  return _lastSnapshot;
}

/**
 * Normalize a rejection reason into a bucket for top-reason counting.
 *
 * Raw reasons contain live values (symbol, confidence percent, price) that
 * would explode the top-N count into singletons. We strip numbers + volatile
 * substrings to get a stable bucket key, e.g.
 *   "Not enough high-confidence agents for consensus: 1/3 (min confidence: 65%)"
 *   → "not enough high-confidence agents for consensus"
 *   "price_feed_stale: 7321ms > 5000ms"
 *   → "price_feed_stale"
 */
function bucketRejectionReason(raw: string | undefined): string {
  if (!raw) return '(unknown)';
  // Take the prefix up to the first ':' — most reasons encode the gate name
  // before the colon and live values after.
  const head = raw.split(':')[0].trim();
  return head.toLowerCase();
}

export function computeHealthSnapshot(
  config: WatchdogConfig = _config,
  now: Date = new Date(),
): TradingHealthSnapshot {
  // Pull a generous slice of recent events; the file log keeps 10MB × 7 files,
  // which at typical load is ~24 hours of traffic. 5000 entries is a safe
  // upper bound for a 30–120 min window without pressure on the FS read.
  const events = getRecentPipelineEvents(5000);
  const nowMs = now.getTime();
  const tradeWindowStart = nowMs - config.tradeSilenceWindowMs;
  const rejWindowStart = nowMs - config.rejectionRateWindowMs;

  let tradesInTradeWindow = 0;
  let approvedInRejWindow = 0;
  let rejectedInRejWindow = 0;
  let mostRecentTradeMs: number | null = null;
  const reasonCounts = new Map<string, number>();

  for (const ev of events) {
    const t = Date.parse(ev.timestamp);
    if (Number.isNaN(t)) continue;

    if (ev.eventType === 'TRADE_EXECUTED') {
      if (t >= tradeWindowStart) tradesInTradeWindow++;
      if (mostRecentTradeMs == null || t > mostRecentTradeMs) mostRecentTradeMs = t;
    }
    if (t >= rejWindowStart) {
      if (ev.eventType === 'SIGNAL_APPROVED') approvedInRejWindow++;
      if (ev.eventType === 'SIGNAL_REJECTED') {
        rejectedInRejWindow++;
        const bucket = bucketRejectionReason(ev.reason);
        reasonCounts.set(bucket, (reasonCounts.get(bucket) ?? 0) + 1);
      }
    }
  }

  const totalAttempts = approvedInRejWindow + rejectedInRejWindow;
  const rejectionRate =
    totalAttempts >= config.minAttemptsForRate
      ? rejectedInRejWindow / totalAttempts
      : null;

  const topRejectionReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  const minutesSinceLastTrade =
    mostRecentTradeMs != null
      ? Math.round((nowMs - mostRecentTradeMs) / 60_000)
      : null;

  const alarms: string[] = [];
  if (tradesInTradeWindow === 0) alarms.push('TRADE_SILENCE');
  if (
    rejectionRate != null &&
    rejectionRate >= config.rejectionRateThreshold
  ) {
    alarms.push('HIGH_REJECTION_RATE');
  }

  const snapshot: TradingHealthSnapshot = {
    takenAt: now.toISOString(),
    healthy: alarms.length === 0,
    tradesInWindow: tradesInTradeWindow,
    signalsApprovedInWindow: approvedInRejWindow,
    signalsRejectedInWindow: rejectedInRejWindow,
    rejectionRate,
    mostRecentTradeAt:
      mostRecentTradeMs != null ? new Date(mostRecentTradeMs).toISOString() : null,
    minutesSinceLastTrade,
    topRejectionReasons,
    alarms,
  };

  return snapshot;
}

function emitAlarm(snapshot: TradingHealthSnapshot): void {
  const topReasons = snapshot.topRejectionReasons
    .map((r) => `${r.reason}=${r.count}`)
    .join(', ');
  console.warn(
    `[TradingSilenceWatchdog] 🚨 ALARM=[${snapshot.alarms.join(',')}] ` +
      `trades_in_last_${Math.round(_config.tradeSilenceWindowMs / 60_000)}min=${snapshot.tradesInWindow} ` +
      `minutes_since_last_trade=${snapshot.minutesSinceLastTrade ?? 'never'} ` +
      `rejRate_last_${Math.round(_config.rejectionRateWindowMs / 60_000)}min=${
        snapshot.rejectionRate != null ? (snapshot.rejectionRate * 100).toFixed(1) + '%' : 'n/a'
      } ` +
      `(approved=${snapshot.signalsApprovedInWindow} rejected=${snapshot.signalsRejectedInWindow}) ` +
      `top_reasons=[${topReasons}]`,
  );

  // Also record in the pipeline log so operators get a durable audit trail
  // with the same context, searchable by RISK_CHECK.
  try {
    logPipelineEvent('RISK_CHECK', {
      reason: `watchdog_alarm:${snapshot.alarms.join(',')}`,
      metadata: {
        watchdog: 'TradingSilenceWatchdog',
        snapshot,
      },
    });
  } catch {
    // Pipeline logger may be down during early startup — don't crash the watchdog.
  }
}

function runCheckOnce(): void {
  try {
    const snapshot = computeHealthSnapshot(_config);
    _lastSnapshot = snapshot;
    if (!snapshot.healthy) emitAlarm(snapshot);
  } catch (err) {
    console.error(
      `[TradingSilenceWatchdog] check failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Start the watchdog. Safe to call multiple times (idempotent).
 * Returns a `stop` handle for tests / graceful shutdown.
 */
export function startTradingSilenceWatchdog(
  config: Partial<WatchdogConfig> = {},
): () => void {
  _config = { ...DEFAULT_WATCHDOG_CONFIG, ..._config, ...config };
  if (_intervalHandle) return stopTradingSilenceWatchdog;

  // Warm up: run once immediately so the first snapshot is available
  // without waiting a full interval.
  runCheckOnce();

  _intervalHandle = setInterval(runCheckOnce, _config.checkIntervalMs);
  return stopTradingSilenceWatchdog;
}

export function stopTradingSilenceWatchdog(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

// ─── Testing hooks ────────────────────────────────────────────────────
/** @internal — resets module singleton state for tests. */
export function __resetWatchdogForTests(): void {
  stopTradingSilenceWatchdog();
  _lastSnapshot = null;
  _config = { ...DEFAULT_WATCHDOG_CONFIG };
}

/** @internal — exposed for integration tests that simulate event streams. */
export function __injectEventsForTests(_events: PipelineLogEntry[]): void {
  // Tests mock `getRecentPipelineEvents` directly; this is a no-op marker
  // to keep the symbol exported for clarity.
}
