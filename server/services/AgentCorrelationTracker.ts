/**
 * AgentCorrelationTracker — Phase 70
 *
 * Maintains the pairwise agent direction correlation matrix that powers
 * BayesianAggregator's effective-N calculation.
 *
 * Sources:
 *   - agentSignals table (timestamped per-agent signals)
 *   - paperPositions for entry-time joins (Phase 70 future enhancement)
 *
 * Operations:
 *   - recompute(symbol, windowDays): query agentSignals over the window,
 *     bucket signals into time windows, compute pairwise Pearson correlation
 *     on the direction vectors, persist to agentCorrelations.
 *   - getCorrelationMap(symbol): return a CorrelationMap for the symbol.
 *   - schedulePeriodicRecompute(): kicks off a daily job.
 *
 * Direction encoding:
 *   - bullish → +1
 *   - bearish → -1
 *   - neutral / missing → 0 (NaN in correlation, excluded pairwise)
 */

import { getDb } from '../db';
import { getActiveClock } from '../_core/clock';
import {
  agentSignals,
  agentCorrelations,
  type InsertAgentCorrelation,
} from '../../drizzle/schema';
import { and, eq, gte } from 'drizzle-orm';
import { buildCorrelationMap, type CorrelationMap, IDENTITY_CORRELATION } from './BayesianAggregator';
import { executionLogger } from '../utils/logger';

// In-memory cache so the Bayesian path doesn't hit DB on every signal.
const correlationCache = new Map<string, { map: CorrelationMap; loadedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Direction encoding from signalType varchar */
function encodeDirection(signalType: string | null | undefined): number {
  if (!signalType) return 0;
  const lower = signalType.toLowerCase();
  if (lower.includes('bull') || lower === 'buy') return 1;
  if (lower.includes('bear') || lower === 'sell') return -1;
  return 0;
}

/**
 * Compute Pearson correlation between two direction time-series.
 * Returns 0 when either series has zero variance (degenerate).
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * Recompute correlations for a single symbol over the configured window.
 * Persists the result to agentCorrelations table.
 */
export async function recompute(
  symbol: string,
  windowDays: number = 7,
  bucketMinutes: number = 5,
): Promise<{ pairs: number; agents: number }> {
  const db = await getDb();
  if (!db) {
    executionLogger.warn('AgentCorrelationTracker: DB unavailable');
    return { pairs: 0, agents: 0 };
  }

  const windowStart = new Date(getActiveClock().now() - windowDays * 24 * 60 * 60 * 1000);

  // Pull all agent signals for the symbol in the window.
  // NOTE: agentSignals.signalData is JSON; we filter by symbol field in the JSON.
  // We can't easily index that, so we fetch broadly and filter in app code.
  const rows = await db
    .select({
      agentName: agentSignals.agentName,
      signalType: agentSignals.signalType,
      timestamp: agentSignals.timestamp,
      signalData: agentSignals.signalData,
    })
    .from(agentSignals)
    .where(gte(agentSignals.timestamp, windowStart));

  // Filter to this symbol (signalData.symbol JSON field)
  const symbolRows = rows.filter((r: any) => {
    const sd = r.signalData as any;
    return sd?.symbol === symbol;
  });

  if (symbolRows.length === 0) {
    return { pairs: 0, agents: 0 };
  }

  // Bucket signals by time bucket → agent → direction
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = new Map<number, Map<string, number>>();
  const agentNames = new Set<string>();
  for (const r of symbolRows) {
    const t = new Date(r.timestamp).getTime();
    const bucketKey = Math.floor(t / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
    const dir = encodeDirection(r.signalType);
    if (dir !== 0) {
      // Last write wins per bucket per agent (most recent signal in the bucket)
      buckets.get(bucketKey)!.set(r.agentName, dir);
      agentNames.add(r.agentName);
    }
  }

  // Build per-agent series aligned across buckets
  const bucketKeys = Array.from(buckets.keys()).sort();
  const agentSeries = new Map<string, number[]>();
  for (const name of agentNames) {
    const series: number[] = [];
    for (const k of bucketKeys) {
      const dir = buckets.get(k)!.get(name) ?? 0;
      series.push(dir);
    }
    agentSeries.set(name, series);
  }

  // Pairwise correlations
  const agentList = Array.from(agentNames);
  const upserts: InsertAgentCorrelation[] = [];
  for (let i = 0; i < agentList.length; i++) {
    for (let j = i + 1; j < agentList.length; j++) {
      const a = agentList[i];
      const b = agentList[j];
      const series_a = agentSeries.get(a)!;
      const series_b = agentSeries.get(b)!;
      const corr = pearsonCorrelation(series_a, series_b);
      upserts.push({
        agentA: a,
        agentB: b,
        symbol,
        correlation: corr.toFixed(4),
        sampleSize: bucketKeys.length,
        windowDays,
      });
    }
  }

  // Persist: simple upsert pattern — delete existing pairs for this symbol+window, insert fresh
  if (upserts.length > 0) {
    try {
      // Delete old entries for this symbol (we always rewrite the full matrix)
      await db.delete(agentCorrelations).where(eq(agentCorrelations.symbol, symbol));
      // Insert in chunks to stay under MySQL max packet size
      const CHUNK = 100;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        await db.insert(agentCorrelations).values(upserts.slice(i, i + CHUNK));
      }
      executionLogger.info('AgentCorrelationTracker recomputed', {
        symbol,
        agents: agentList.length,
        pairs: upserts.length,
        buckets: bucketKeys.length,
      });
      // Invalidate cache
      correlationCache.delete(symbol);
    } catch (e) {
      executionLogger.error('AgentCorrelationTracker persist failed', { error: (e as Error).message });
    }
  }

  return { pairs: upserts.length, agents: agentList.length };
}

/**
 * Get the correlation map for a symbol, hitting cache if fresh.
 * Returns IDENTITY_CORRELATION (no correlations) when no data exists yet.
 */
export async function getCorrelationMap(symbol: string): Promise<CorrelationMap> {
  const cached = correlationCache.get(symbol);
  if (cached && getActiveClock().now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.map;
  }

  const db = await getDb();
  if (!db) return IDENTITY_CORRELATION;

  try {
    const rows = await db
      .select({
        agentA: agentCorrelations.agentA,
        agentB: agentCorrelations.agentB,
        correlation: agentCorrelations.correlation,
      })
      .from(agentCorrelations)
      .where(eq(agentCorrelations.symbol, symbol));

    const map = buildCorrelationMap(
      rows.map((r: any) => ({
        agentA: r.agentA,
        agentB: r.agentB,
        correlation: parseFloat(r.correlation),
      })),
    );
    correlationCache.set(symbol, { map, loadedAt: getActiveClock().now() });
    return map;
  } catch {
    return IDENTITY_CORRELATION;
  }
}

/**
 * Recompute correlations for the platform's main symbols.
 * Called from the daily scheduler.
 */
export async function recomputeAll(
  symbols: string[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'],
  windowDays: number = 7,
): Promise<void> {
  for (const sym of symbols) {
    try {
      await recompute(sym, windowDays);
    } catch (e) {
      executionLogger.error('AgentCorrelationTracker.recomputeAll error', {
        symbol: sym,
        error: (e as Error).message,
      });
    }
  }
}

/**
 * Schedule periodic recomputation. Called once at boot.
 * Default cadence: every 6 hours (correlations change slowly).
 */
export function schedulePeriodicRecompute(intervalMs: number = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  executionLogger.info('AgentCorrelationTracker: scheduling periodic recompute', { intervalMs });
  // Kick once at boot, then on cadence
  recomputeAll().catch((e) => executionLogger.error('Initial correlation recompute failed', { error: e?.message }));
  return setInterval(() => {
    recomputeAll().catch((e) => executionLogger.error('Periodic correlation recompute failed', { error: e?.message }));
  }, intervalMs);
}

// Test helper export
export const __test = { pearsonCorrelation, encodeDirection };
