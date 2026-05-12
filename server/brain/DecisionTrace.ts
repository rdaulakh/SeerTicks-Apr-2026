/**
 * DecisionTrace — Phase 83
 *
 * Writes one row to `brainDecisions` per brain tick. Fire-and-forget;
 * trace failure NEVER blocks the brain's decision path.
 */

import { getDb } from '../db';
import { brainDecisions } from '../../drizzle/schema';
import { engineLogger as logger } from '../utils/logger';

export interface TraceEntry {
  positionId: string | number;
  symbol: string;
  side: 'long' | 'short';
  // Phase 84 widened to include entry-side actions (enter_long / enter_short / abstain).
  // DB column `kind` is varchar(32) — fits any of these values.
  kind: 'hold' | 'tighten_stop' | 'take_partial' | 'exit_full'
    | 'enter_long' | 'enter_short' | 'abstain';
  pipelineStep: string;
  reason: string;
  urgency?: 'now' | 'soon';
  sensoriumSnapshot: Record<string, unknown>;
  newStopLoss?: number | null;
  exitQuantityPercent?: number | null;
  isDryRun: boolean;
  liveIEMAction?: string;
  latencyUs: number;
}

class DecisionTrace {
  private writeQueue: TraceEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 2000;
  private readonly MAX_QUEUE = 1000;

  start(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush().catch(() => { }), this.FLUSH_INTERVAL_MS);
    logger.info('[DecisionTrace] started (batched flush every 2s)');
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  record(entry: TraceEntry): void {
    this.writeQueue.push(entry);
    if (this.writeQueue.length >= this.MAX_QUEUE) {
      // Drain immediately if queue is full
      this.flush().catch(() => { });
    }
  }

  private async flush(): Promise<void> {
    if (this.writeQueue.length === 0) return;
    const batch = this.writeQueue.splice(0, this.writeQueue.length);
    try {
      const db = await getDb();
      if (!db) return;
      const rows = batch.map(e => ({
        positionId: String(e.positionId),
        symbol: e.symbol,
        side: e.side,
        kind: e.kind,
        pipelineStep: e.pipelineStep,
        reason: e.reason?.slice(0, 1000) ?? null,
        urgency: e.urgency ?? null,
        sensorium: e.sensoriumSnapshot as any,
        newStopLoss: e.newStopLoss !== undefined && e.newStopLoss !== null ? e.newStopLoss.toString() : null,
        exitQuantityPercent: e.exitQuantityPercent !== undefined && e.exitQuantityPercent !== null
          ? e.exitQuantityPercent.toString() : null,
        isDryRun: e.isDryRun,
        liveIEMAction: e.liveIEMAction ?? null,
        latencyUs: e.latencyUs,
      }));
      await db.insert(brainDecisions).values(rows);
    } catch (err) {
      logger.warn('[DecisionTrace] flush failed', { error: (err as Error)?.message, batchSize: batch.length });
    }
  }
}

let _decisionTrace: DecisionTrace | null = null;
export function getDecisionTrace(): DecisionTrace {
  if (!_decisionTrace) {
    _decisionTrace = new DecisionTrace();
    _decisionTrace.start();
  }
  return _decisionTrace;
}
