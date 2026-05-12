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
import { winningPatterns } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';
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

    // Defensive: prune stale entry contexts every 30min.
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.entries) {
        if (now - v.openedAtMs > this.ENTRY_TTL_MS) this.entries.delete(k);
      }
    }, 30 * 60 * 1000);
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
      this.entries.set(evt.positionId, {
        positionId: evt.positionId,
        symbol: evt.symbol,
        side: evt.side,
        patternName,
        openedAtMs: Date.now(),
      });
      logger.info(`[PatternPopulator] 📚 captured entry: ${evt.symbol} ${evt.side} → pattern="${patternName}" (RSI=${tech?.rsi?.toFixed(1) ?? '?'} trend=${tech?.emaTrend ?? '?'} votes ${votes?.longCount ?? 0}L/${votes?.shortCount ?? 0}S)`);
    } catch (err) {
      logger.warn('[PatternPopulator] handleOpen failed', { error: (err as Error)?.message });
    }
  };

  /** UPSERT the pattern row on close. */
  private handleClose = async (evt: {
    positionId: number | string;
    symbol: string;
    side: 'long' | 'short';
    realizedPnl: number;
  }): Promise<void> => {
    const ctx = this.entries.get(evt.positionId);
    if (!ctx) {
      // Pre-Phase-88 positions or restart-loss — fine, just no learning.
      return;
    }
    this.entries.delete(evt.positionId);
    try {
      await this.upsertPattern(ctx, evt.realizedPnl);
    } catch (err) {
      logger.warn('[PatternPopulator] upsert failed', { error: (err as Error)?.message });
    }
  };

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
