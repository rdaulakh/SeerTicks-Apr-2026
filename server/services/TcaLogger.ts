/**
 * TcaLogger — Phase 69
 *
 * Persists SmartExecutor TCA reports to the tcaLog table. Pre-Phase-69
 * these were only emitted to pm2 stdout — not queryable, not trendable.
 *
 * Now the post-trade dashboard can render:
 *   - Slippage P50/P95/P99 over time
 *   - Stage distribution (% IOC-1, IOC-2, market fallback)
 *   - Cap-breach rate and which symbols are worst
 *   - Per-traceId end-to-end latency
 */

import { getDb } from '../db';
import { tcaLog, type InsertTcaLog } from '../../drizzle/schema';
import { executionLogger } from '../utils/logger';

export interface TCAPersistInput {
  userId?: number;
  traceId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  refPrice: number;
  executedPrice: number;
  executedQty: number;
  slippageBps: number;
  bookSpreadBps?: number;
  stageReached: 1 | 2 | 3;
  totalLatencyMs: number;
  partialFill: boolean;
  exceededCap: boolean;
}

/** Fire-and-forget persistence. Never throws — execution flow must not stall on TCA writes. */
export async function persistTca(input: TCAPersistInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const row: InsertTcaLog = {
      userId: input.userId,
      traceId: input.traceId,
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity.toString(),
      refPrice: input.refPrice.toString(),
      executedPrice: input.executedPrice.toString(),
      executedQty: input.executedQty.toString(),
      slippageBps: input.slippageBps.toFixed(4),
      bookSpreadBps: input.bookSpreadBps !== undefined ? input.bookSpreadBps.toFixed(4) : null,
      stageReached: input.stageReached,
      totalLatencyMs: input.totalLatencyMs,
      partialFill: input.partialFill ? 1 : 0,
      exceededCap: input.exceededCap ? 1 : 0,
    };
    await db.insert(tcaLog).values(row);
  } catch (e) {
    // Best-effort: don't crash execution on TCA persistence failure
    executionLogger.warn('TcaLogger.persistTca failed', { error: (e as Error).message });
  }
}
