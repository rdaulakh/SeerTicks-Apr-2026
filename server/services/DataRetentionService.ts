/**
 * DataRetentionService — Phase 90
 *
 * Tokyo DB audit revealed 14.5 GB total size dominated by uncapped
 * append-only tables:
 *
 *   ticks            5.3 GB   30.1M rows
 *   agentSignals     4.7 GB    4.6M rows   (+750k/day)
 *   agentSignalLog   2.4 GB    7.1M rows
 *   apiCallLog       586 MB    2.2M rows
 *   slowAgentLog     458 MB    2.5M rows
 *   tradingPipelineLog 281 MB  1.1M rows
 *   dataGapLogs      276 MB    2.2M rows
 *
 * Without retention, DB grows ~1 GB/week and query times degrade. This
 * service runs a nightly sweep that deletes old rows in BATCHES (to avoid
 * lock contention) per a per-table TTL policy.
 *
 * Conservative defaults — recent data stays, history is what gets pruned:
 *   ticks               14 days  (archived_ticks table holds older)
 *   agentSignals         7 days
 *   agentSignalLog       7 days
 *   apiCallLog          14 days
 *   slowAgentLog        14 days
 *   tradingPipelineLog  14 days
 *   dataGapLogs         30 days
 *   brainDecisions      30 days
 *   executionLatencyLogs 14 days
 *   tickHeartbeat        7 days
 *   bayesianConsensusLog 14 days
 *   consensusLog        30 days
 *
 * Critical tables (trades, positions, users, paperWallets, settings,
 * winningPatterns, agentAccuracy, agentPnlAttribution) are NEVER pruned.
 */

import { getDb } from '../db';
import { engineLogger as logger } from '../utils/logger';

interface RetentionPolicy {
  table: string;
  timestampColumn: string;
  ttlDays: number;
  batchSize: number;
}

const POLICIES: RetentionPolicy[] = [
  // Hottest tables first — biggest savings
  { table: 'ticks', timestampColumn: 'time', ttlDays: 14, batchSize: 50_000 },
  { table: 'agentSignals', timestampColumn: 'timestamp', ttlDays: 7, batchSize: 20_000 },
  { table: 'agentSignalLog', timestampColumn: 'timestamp', ttlDays: 7, batchSize: 20_000 },
  { table: 'apiCallLog', timestampColumn: 'timestamp', ttlDays: 14, batchSize: 10_000 },
  { table: 'slowAgentLog', timestampColumn: 'timestamp', ttlDays: 14, batchSize: 10_000 },
  { table: 'tradingPipelineLog', timestampColumn: 'timestamp', ttlDays: 14, batchSize: 10_000 },
  { table: 'dataGapLogs', timestampColumn: 'detectedAt', ttlDays: 30, batchSize: 10_000 },
  { table: 'brainDecisions', timestampColumn: 'timestamp', ttlDays: 30, batchSize: 10_000 },
  { table: 'executionLatencyLogs', timestampColumn: 'timestamp', ttlDays: 14, batchSize: 5_000 },
  { table: 'tickHeartbeat', timestampColumn: 'timestamp', ttlDays: 7, batchSize: 5_000 },
  { table: 'bayesianConsensusLog', timestampColumn: 'timestamp', ttlDays: 14, batchSize: 5_000 },
  { table: 'consensusLog', timestampColumn: 'timestamp', ttlDays: 30, batchSize: 5_000 },
];

interface PolicyResult {
  table: string;
  deletedRows: number;
  durationMs: number;
  error?: string;
}

class DataRetentionService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Run the sweep this many ms after boot, then every 24h. */
  private readonly BOOT_DELAY_MS = 5 * 60 * 1000; // 5 min after boot
  private readonly RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

  start(): void {
    if (this.timer) return;
    // First sweep after the boot delay so deploys don't wedge under DB locks
    // during agent registration.
    setTimeout(() => {
      this.sweep().catch(err => logger.warn('[DataRetention] initial sweep failed', { error: err?.message }));
      this.timer = setInterval(() => {
        this.sweep().catch(err => logger.warn('[DataRetention] sweep failed', { error: err?.message }));
      }, this.RUN_INTERVAL_MS);
    }, this.BOOT_DELAY_MS);
    logger.info(`[DataRetention] scheduled — first sweep in ${this.BOOT_DELAY_MS / 1000}s, daily thereafter`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Sweep all policies. */
  async sweep(): Promise<PolicyResult[]> {
    if (this.running) {
      logger.warn('[DataRetention] sweep already in progress — skipping');
      return [];
    }
    this.running = true;
    const results: PolicyResult[] = [];
    const startTotal = Date.now();
    try {
      logger.info(`[DataRetention] 🧹 starting sweep over ${POLICIES.length} tables`);
      for (const policy of POLICIES) {
        const r = await this.prunePolicy(policy);
        results.push(r);
      }
      const totalDeleted = results.reduce((s, r) => s + r.deletedRows, 0);
      logger.info(`[DataRetention] 🧹 sweep complete — deleted ${totalDeleted.toLocaleString()} rows across ${results.length} tables in ${((Date.now() - startTotal) / 1000).toFixed(1)}s`);
    } finally {
      this.running = false;
    }
    return results;
  }

  /** Prune one table according to its policy. Batched to avoid long locks. */
  private async prunePolicy(p: RetentionPolicy): Promise<PolicyResult> {
    const start = Date.now();
    let totalDeleted = 0;
    const db = await getDb();
    if (!db) return { table: p.table, deletedRows: 0, durationMs: 0, error: 'no_db' };
    const cutoff = new Date(Date.now() - p.ttlDays * 24 * 60 * 60 * 1000);

    try {
      // Use parameterized raw SQL to avoid pulling Drizzle table refs for
      // tables we don't import. Column + table names are policy-controlled
      // (not user input), so injection is not possible here.
      // The LIMIT clause keeps each query bounded so we don't lock the row
      // store for minutes at a time.
      const sqlText = `DELETE FROM \`${p.table}\` WHERE \`${p.timestampColumn}\` < ? LIMIT ${p.batchSize}`;
      while (true) {
        const [res] = await (db as any).execute(sqlText, [cutoff]);
        const affected = (res?.affectedRows ?? 0) as number;
        totalDeleted += affected;
        if (affected < p.batchSize) break; // last batch
        // Tiny pause between batches so other queries can squeeze through
        await new Promise(r => setTimeout(r, 100));
        // Hard safety cap: never delete more than 10M rows per table per
        // sweep (catches a wedged loop on a misconfigured policy).
        if (totalDeleted >= 10_000_000) {
          logger.warn(`[DataRetention] safety cap hit on ${p.table} at ${totalDeleted.toLocaleString()} rows`);
          break;
        }
      }
      const durationMs = Date.now() - start;
      if (totalDeleted > 0) {
        logger.info(`[DataRetention]   ✅ ${p.table.padEnd(28)} deleted ${totalDeleted.toLocaleString().padStart(10)} rows in ${(durationMs / 1000).toFixed(1)}s (ttl ${p.ttlDays}d)`);
      }
      return { table: p.table, deletedRows: totalDeleted, durationMs };
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      logger.warn(`[DataRetention]   ❌ ${p.table} failed: ${msg}`);
      return { table: p.table, deletedRows: totalDeleted, durationMs: Date.now() - start, error: msg };
    }
  }

  /** Health endpoint payload. */
  status(): { scheduled: boolean; nextRunAtMs: number | null; running: boolean; policies: RetentionPolicy[] } {
    return {
      scheduled: this.timer !== null,
      nextRunAtMs: null, // setInterval doesn't expose next fire
      running: this.running,
      policies: POLICIES,
    };
  }
}

let _service: DataRetentionService | null = null;
export function getDataRetentionService(): DataRetentionService {
  if (!_service) _service = new DataRetentionService();
  return _service;
}
