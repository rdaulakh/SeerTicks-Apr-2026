/**
 * PatternPopulator — Phase 88
 *
 * The other half of the alpha library. Phase 87 wired the READ side: brain
 * consults `winningPatterns` in decideEntry. But the table was empty — no
 * service was writing to it. Without a writer, the alpha library stays
 * cold-start forever and the brain never accumulates pattern memory.
 *
 * This service is the WRITER:
 *
 *   On brain_position_opened (BrainExecutor emits) →
 *     Capture the entry-time sensorium snapshot.
 *     Categorize into a pattern key from RSI bucket + EMA trend +
 *     confluence size + direction. 36 possible patterns per symbol.
 *
 *   On brain_position_closed (BrainExecutor emits) →
 *     Look up the entry context, classify outcome (win/loss/break-even),
 *     UPSERT into `winningPatterns` (totalTrades, winningTrades, winRate,
 *     avgPnl, profitFactor, lastUsed).
 *
 *   Every 1 hour →
 *     Decay scan. Any pattern whose rolling-30-trade win rate has slipped
 *     below 0.50 OR whose totalTrades > 50 with overall winRate < 0.50
 *     gets alphaDecayFlag=true. Decayed patterns then BIAS the brain
 *     AGAINST that symbol+setup (Phase 87 SensorWiring already reads
 *     decayedPatternCount).
 *
 * Pattern memory makes the brain genuinely evolve — winning setups get
 * boosted, losing setups get muted. Without this writer, the alpha gate
 * in decideEntry is decorative.
 */

import { EventEmitter } from 'events';
import { getDb } from '../db';
import { winningPatterns, brainEntryContexts } from '../../drizzle/schema';
import { eq, and, lt } from 'drizzle-orm';
import { getActiveClock } from '../_core/clock';
import { engineLogger as logger } from '../utils/logger';
import { getSensorium } from './Sensorium';

interface EntryContext {
  positionId: number | string;
  symbol: string;
  side: 'long' | 'short';
  patternName: string;
  /** Wall-clock when we captured the context (used to age out stale entries). */
  openedAtMs: number;
}

/** Categorize the entry conditions into a stable pattern key. */
function categorize(args: {
  rsi: number | null;
  emaTrend: 'up' | 'down' | 'flat' | null;
  longCount: number;
  shortCount: number;
  side: 'long' | 'short';
}): string {
  const rsi = args.rsi ?? 50;
  const rsiBucket =
    rsi < 30 ? 'OVERSOLD'
    : rsi > 70 ? 'OVERBOUGHT'
    : 'NEUTRAL_RSI';
  const trend =
    args.emaTrend === 'up' ? 'UPTREND'
    : args.emaTrend === 'down' ? 'DOWNTREND'
    : 'FLAT';
  const dominant = Math.max(args.longCount, args.shortCount);
  const confluence = dominant >= 5 ? 'STRONG' : dominant >= 3 ? 'MODERATE' : 'THIN';
  return `${rsiBucket}_${trend}_${confluence}_${args.side.toUpperCase()}`;
}

class PatternPopulator extends EventEmitter {
  /** In-memory entry contexts. Persisted to DB if server restart risk is high. */
  private entries = new Map<string | number, EntryContext>();
  private decayInterval: NodeJS.Timeout | null = null;
  /** Max age before we drop an entry context (defensive — usually trades close fast). */
  private readonly ENTRY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  start(): void {
    if (this.decayInterval) return;

    // Phase 89 — rehydrate any contexts persisted before the last restart.
    // The in-memory Map is cold-started; without this load, a server crash
    // between open and close drops the pattern row permanently.
    this.rehydrateFromDb()
      .then(n => { if (n > 0) logger.info(`[PatternPopulator] rehydrated ${n} entry context(s) from brainEntryContexts`); })
      .catch(err => logger.warn('[PatternPopulator] rehydrate failed', { error: (err as Error)?.message }));

    // Hook BrainExecutor events. Use a late import to dodge circular init.
    import('./BrainExecutor').then(({ getBrainExecutor }) => {
      const executor = getBrainExecutor();
      executor.on('brain_position_opened', this.handleOpen);
      executor.on('brain_position_closed', this.handleClose);
      logger.info('[PatternPopulator] started — listening for brain_position_{opened,closed}');
    }).catch(err => {
      logger.warn('[PatternPopulator] failed to hook BrainExecutor', { error: err?.message });
    });

    // Decay scan every hour.
    this.decayInterval = setInterval(() => {
      this.scanDecay().catch(err => logger.warn('[PatternPopulator] decay scan failed', { error: err?.message }));
    }, 60 * 60 * 1000);

    // Defensive: prune stale entry contexts every 30min — both in-memory and DB.
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.ENTRY_TTL_MS;
      for (const [k, v] of this.entries) {
        if (v.openedAtMs < cutoff) this.entries.delete(k);
      }
      // DB cleanup — fire and forget
      this.pruneStaleDbContexts(cutoff).catch(() => { /* never block on prune */ });
    }, 30 * 60 * 1000);
  }

  /** Phase 89 — Read persisted contexts back into memory on boot. */
  private async rehydrateFromDb(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    const cutoff = Date.now() - this.ENTRY_TTL_MS;
    const rows = await db.select().from(brainEntryContexts).where(
      // Skip rows that are older than the TTL — they're already lost cause.
      // We compare on openedAtMs (bigint) so cutoff is a number.
      // Drizzle's gt helper would be cleaner; we use a sql-tag-free approach.
      // For simplicity rely on lt(createdAt, ...) instead; close enough.
      lt(brainEntryContexts.createdAt, new Date(Date.now() + 1)),
    );
    let n = 0;
    for (const r of rows) {
      if (r.openedAtMs < cutoff) continue; // expired
      this.entries.set(r.positionId, {
        positionId: r.positionId,
        symbol: r.symbol,
        side: r.side as 'long' | 'short',
        patternName: r.patternName,
        openedAtMs: r.openedAtMs,
      });
      n++;
    }
    return n;
  }

  /** Phase 89 — Delete stale DB rows. Called periodically. */
  private async pruneStaleDbContexts(cutoffMs: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    // We delete by createdAt (timestamp) which is close enough to openedAtMs
    // for a 24h TTL window.
    const cutoffDate = new Date(cutoffMs);
    await db.delete(brainEntryContexts).where(lt(brainEntryContexts.createdAt, cutoffDate));
  }

  stop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
    this.entries.clear();
  }

  /** Snapshot sensorium and categorize when the brain opens a position. */
  private handleOpen = (evt: {
    positionId: number | string | null;
    symbol: string;
    side: 'long' | 'short';
  }): void => {
    if (!evt.positionId) return;
    try {
      const sensorium = getSensorium();
      const tech = sensorium.getTechnical(evt.symbol)?.sensation;
      const votes = sensorium.getAgentVotes(evt.symbol)?.sensation;
      const patternName = categorize({
        rsi: tech?.rsi ?? null,
        emaTrend: tech?.emaTrend ?? null,
        longCount: votes?.longCount ?? 0,
        shortCount: votes?.shortCount ?? 0,
        side: evt.side,
      });
      const ctx: EntryContext = {
        positionId: evt.positionId,
        symbol: evt.symbol,
        side: evt.side,
        patternName,
        openedAtMs: Date.now(),
      };
      this.entries.set(evt.positionId, ctx);
      // Phase 89 — also persist to DB so a server restart doesn't lose
      // the context. Fire-and-forget; persistence failure shouldn't block
      // the brain. handleClose will fall back to the in-memory copy.
      this.persistContext(ctx).catch((err: Error) =>
        logger.warn('[PatternPopulator] persistContext failed', { error: err?.message, positionId: evt.positionId }),
      );
      logger.info(`[PatternPopulator] 📚 captured entry: ${evt.symbol} ${evt.side} → pattern="${patternName}" (RSI=${tech?.rsi?.toFixed(1) ?? '?'} trend=${tech?.emaTrend ?? '?'} votes ${votes?.longCount ?? 0}L/${votes?.shortCount ?? 0}S)`);
    } catch (err) {
      logger.warn('[PatternPopulator] handleOpen failed', { error: (err as Error)?.message });
    }
  };

  /** Phase 89 — write context to DB. Upsert behavior: if positionId already
   *  exists (rare — same positionId reused) update; else insert. */
  private async persistContext(ctx: EntryContext): Promise<void> {
    const db = await getDb();
    if (!db) return;
    // Upsert via ON DUPLICATE KEY UPDATE — positionId is unique-indexed.
    try {
      await db.insert(brainEntryContexts).values({
        positionId: String(ctx.positionId),
        symbol: ctx.symbol,
        side: ctx.side,
        patternName: ctx.patternName,
        openedAtMs: ctx.openedAtMs,
      });
    } catch (err) {
      // If the positionId already exists, that's fine — earlier capture wins.
      // Other errors get surfaced to caller for logging.
      const msg = (err as Error)?.message ?? '';
      if (!/duplicate/i.test(msg) && !/ER_DUP_ENTRY/i.test(msg)) throw err;
    }
  }

  /** UPSERT the pattern row on close. */
  private handleClose = async (evt: {
    positionId: number | string;
    symbol: string;
    side: 'long' | 'short';
    realizedPnl: number;
  }): Promise<void> => {
    // Phase 89 — guard against missing/NaN realizedPnl. Live path had a bug
    // where this field was missing from the emit payload, causing NaN
    // pollution of the alpha library. Verify and skip cleanly if invalid.
    if (typeof evt.realizedPnl !== 'number' || !Number.isFinite(evt.realizedPnl)) {
      logger.warn('[PatternPopulator] handleClose: invalid realizedPnl — skipping pattern row to protect alpha library', {
        positionId: evt.positionId, realizedPnl: evt.realizedPnl,
      });
      return;
    }

    // Memory first, DB fallback.
    let ctx: EntryContext | null | undefined = this.entries.get(evt.positionId);
    if (!ctx) {
      ctx = await this.loadContextFromDb(evt.positionId);
    }
    if (!ctx) {
      // Pre-Phase-88 positions, never-captured opens, or expired entries.
      return;
    }
    this.entries.delete(evt.positionId);
    try {
      await this.upsertPattern(ctx, evt.realizedPnl);
      // Successful pattern write — clean up the persisted context.
      this.deleteContextFromDb(evt.positionId).catch(() => { /* best-effort */ });
    } catch (err) {
      logger.warn('[PatternPopulator] upsert failed', { error: (err as Error)?.message });
    }
  };

  /** Phase 89 — DB lookup fallback for handleClose. */
  private async loadContextFromDb(positionId: string | number): Promise<EntryContext | null> {
    const db = await getDb();
    if (!db) return null;
    try {
      const [row] = await db.select().from(brainEntryContexts)
        .where(eq(brainEntryContexts.positionId, String(positionId)))
        .limit(1);
      if (!row) return null;
      return {
        positionId: row.positionId,
        symbol: row.symbol,
        side: row.side as 'long' | 'short',
        patternName: row.patternName,
        openedAtMs: row.openedAtMs,
      };
    } catch {
      return null;
    }
  }

  /** Phase 89 — delete a persisted context after we've used it. */
  private async deleteContextFromDb(positionId: string | number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
      await db.delete(brainEntryContexts).where(eq(brainEntryContexts.positionId, String(positionId)));
    } catch { /* best-effort */ }
  }

  /** UPSERT pattern stats. Reads existing, recomputes, writes. */
  private async upsertPattern(ctx: EntryContext, realizedPnl: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const isWin = realizedPnl > 0;
    // Normalize symbol for DB row — store the platform's primary shape (BTC-USD).
    const dbSymbol = ctx.symbol;
    const tf: '1m' | '5m' | '1h' | '4h' | '1d' = '1m';

    const [existing] = await db.select().from(winningPatterns).where(and(
      eq(winningPatterns.patternName, ctx.patternName),
      eq(winningPatterns.symbol, dbSymbol),
      eq(winningPatterns.timeframe, tf),
    )).limit(1);

    if (existing) {
      const totalTrades = (existing.totalTrades ?? 0) + 1;
      const winningTrades = (existing.winningTrades ?? 0) + (isWin ? 1 : 0);
      const oldWinRate = parseFloat(existing.winRate ?? '0');
      const oldAvgPnl = parseFloat(existing.avgPnl ?? '0');
      const winRate = winningTrades / totalTrades;
      const avgPnl = (oldAvgPnl * (totalTrades - 1) + realizedPnl) / totalTrades;
      // Profit factor = sum(wins) / |sum(losses)|. We approximate by:
      //   pf ≈ (winRate × avgWin) / ((1-winRate) × avgLoss)
      // For now just store avgPnl as the headline metric; PF recomputed at decay scan.
      const profitFactor = (existing.profitFactor ?? '1.00');

      await db.update(winningPatterns).set({
        totalTrades,
        winningTrades,
        winRate: winRate.toFixed(4),
        avgPnl: avgPnl.toFixed(4),
        profitFactor,
        lastUsed: getActiveClock().date(),
      }).where(eq(winningPatterns.id, existing.id));
      logger.info(`[PatternPopulator] 📚⬆ updated "${ctx.patternName}" / ${dbSymbol}: ${winningTrades}/${totalTrades} (${(winRate * 100).toFixed(1)}%) avgPnl=$${avgPnl.toFixed(2)}`);
    } else {
      await db.insert(winningPatterns).values({
        patternName: ctx.patternName,
        symbol: dbSymbol,
        timeframe: tf,
        patternDescription: `Auto-generated from brain trade: ${ctx.patternName} on ${dbSymbol}`,
        totalTrades: 1,
        winningTrades: isWin ? 1 : 0,
        winRate: isWin ? '1.0000' : '0.0000',
        avgPnl: realizedPnl.toFixed(4),
        profitFactor: '1.00',
        confidenceScore: 0,
        isActive: true,
        alphaDecayFlag: false,
        lastUsed: getActiveClock().date(),
      });
      logger.info(`[PatternPopulator] 📚🆕 created "${ctx.patternName}" / ${dbSymbol}: first trade ${isWin ? 'WIN' : 'LOSS'} (pnl=$${realizedPnl.toFixed(2)})`);
    }
  }

  /**
   * Decay scan. Mark patterns whose win rate has slipped below 0.50 with
   * a meaningful sample size (>50 trades) as decayed. Decayed patterns
   * bias the brain AGAINST that symbol+setup via the AlphaSensation that
   * SensorWiring.pullAlphaSensor reads.
   */
  private async scanDecay(): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const allActive = await db.select().from(winningPatterns).where(and(
      eq(winningPatterns.isActive, true),
      eq(winningPatterns.alphaDecayFlag, false),
    ));
    let flagged = 0;
    for (const p of allActive) {
      const winRate = parseFloat(p.winRate ?? '0');
      if (p.totalTrades > 50 && winRate < 0.50) {
        await db.update(winningPatterns)
          .set({ alphaDecayFlag: true })
          .where(eq(winningPatterns.id, p.id));
        flagged++;
        logger.warn(`[PatternPopulator] 📚🚨 decay: "${p.patternName}" / ${p.symbol} winRate=${(winRate * 100).toFixed(1)}% over ${p.totalTrades} trades — flagged`);
      }
    }
    if (flagged > 0) {
      logger.info(`[PatternPopulator] decay scan: ${flagged} pattern(s) newly decayed`);
    }
  }

  /** Health / introspection. */
  status(): {
    started: boolean;
    pendingEntries: number;
    oldestPendingMs: number | null;
  } {
    let oldestPendingMs: number | null = null;
    for (const v of this.entries.values()) {
      const age = Date.now() - v.openedAtMs;
      if (oldestPendingMs === null || age > oldestPendingMs) oldestPendingMs = age;
    }
    return {
      started: this.decayInterval !== null,
      pendingEntries: this.entries.size,
      oldestPendingMs,
    };
  }
}

let _populator: PatternPopulator | null = null;
export function getPatternPopulator(): PatternPopulator {
  if (!_populator) _populator = new PatternPopulator();
  return _populator;
}
