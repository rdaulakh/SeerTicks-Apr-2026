/**
 * BrainExecutor — Phase 83.2
 *
 * The brain's hand. When TraderBrain.config.dryRun=false and a non-hold
 * decision fires, the brain calls BrainExecutor.execute() to actually
 * mutate the world (close positions, tighten stops, take partials).
 *
 * Design principle: same execution path as UserTradingSession's
 * direct-DB-fallback (used today for engine-desync recoveries). This is
 * the SAFEST path for paper trading — there's no exchange-side position
 * to leak, and the DB update is idempotent (re-update on already-closed
 * is a no-op).
 *
 * For paper trades:
 *   1. exit_full         → mark paperPositions.status='closed' + write
 *                          exit price, time, reason, realizedPnl.
 *                          Wallet update flows through PaperTradingEngine's
 *                          next dbSync OR via the position_closed event.
 *   2. exit_partial      → close `qtyPct%` of position via close+reopen at
 *                          smaller size (v1: full-close — partials are a v2
 *                          enhancement).
 *   3. tighten_stop      → UPDATE paperPositions SET stopLoss = newStop.
 *                          IEM picks up on next dbSync. Hard-stop check on
 *                          subsequent ticks fires at the new level.
 *
 * For live trades (RealTradingEngine path): NOT YET WIRED — brain stays
 * in paper-mode-only for the first promotion. Phase 83.3 will wire live.
 */

import { getDb } from '../db';
import { paperPositions } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getActiveClock } from '../_core/clock';
import { engineLogger as logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface ExecutionResult {
  ok: boolean;
  affectedRows: number;
  error?: string;
  reason: string;
}

class BrainExecutor extends EventEmitter {
  /**
   * Mark a position closed via direct DB update. Computes realizedPnl
   * from the position's entry/quantity/side and current price.
   */
  async exitFull(
    positionId: string | number,
    currentPrice: number,
    reason: string,
  ): Promise<ExecutionResult> {
    try {
      const db = await getDb();
      if (!db) return { ok: false, affectedRows: 0, error: 'db_unavailable', reason };

      const numericId = Number(positionId);
      if (!isFinite(numericId)) return { ok: false, affectedRows: 0, error: 'invalid_id', reason };

      // Read the position first to compute realized P&L correctly.
      const [row] = await db.select().from(paperPositions)
        .where(and(eq(paperPositions.id, numericId), eq(paperPositions.status, 'open')))
        .limit(1);
      if (!row) {
        // Already closed by another path — that's fine, not a failure.
        return { ok: true, affectedRows: 0, reason: 'already_closed' };
      }

      const entryPrice = parseFloat(row.entryPrice);
      const quantity = parseFloat(row.quantity);
      const sideMul = row.side === 'long' ? 1 : -1;
      const realizedPnl = sideMul * (currentPrice - entryPrice) * quantity;

      const result = await db.update(paperPositions)
        .set({
          status: 'closed',
          exitPrice: currentPrice.toString(),
          exitTime: getActiveClock().date(),
          exitReason: `brain:${reason}`.slice(0, 64),
          realizedPnl: realizedPnl.toFixed(8),
          updatedAt: getActiveClock().date(),
        })
        .where(and(
          eq(paperPositions.id, numericId),
          eq(paperPositions.status, 'open'),
        ));

      const affected = (result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0;

      if (affected > 0) {
        logger.info(`[BrainExecutor] 🧠✅ EXIT_FULL id=${numericId} ${row.symbol} ${row.side} @ $${currentPrice} pnl=$${realizedPnl.toFixed(2)} reason="${reason}"`);
        // Also notify IEM to drop this position from its in-memory map so it
        // doesn't keep ticking on a closed position.
        try {
          const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
          const iem = getIntelligentExitManager();
          const iemPositions = (iem as any).positions as Map<string, any>;
          if (iemPositions) {
            for (const [k, p] of iemPositions) {
              if (p?.dbPositionId === numericId) {
                iemPositions.delete(k);
                logger.info(`[BrainExecutor] 🧠 Notified IEM: removed position ${numericId} from monitoring map`);
                break;
              }
            }
          }
        } catch { /* IEM may not be initialized */ }

        // Update PaperTradingEngine wallet via the position_closed event chain.
        // We emit our own brain_position_closed; UserTradingSession listens.
        this.emit('brain_position_closed', {
          positionId: numericId,
          symbol: row.symbol,
          side: row.side,
          exitPrice: currentPrice,
          realizedPnl,
          reason,
        });
        return { ok: true, affectedRows: affected, reason };
      }
      return { ok: true, affectedRows: 0, reason: 'race_no_op' };
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      logger.error(`[BrainExecutor] exitFull threw for ${positionId}: ${msg}`);
      return { ok: false, affectedRows: 0, error: msg, reason };
    }
  }

  /**
   * Tighten the stop-loss on an open position. Brain's tighten_stop step
   * fires this; the next IEM/brain tick will hard-stop if price retraces.
   */
  async updateStop(
    positionId: string | number,
    newStop: number,
    reason: string,
  ): Promise<ExecutionResult> {
    try {
      const db = await getDb();
      if (!db) return { ok: false, affectedRows: 0, error: 'db_unavailable', reason };
      const numericId = Number(positionId);
      if (!isFinite(numericId)) return { ok: false, affectedRows: 0, error: 'invalid_id', reason };

      const result = await db.update(paperPositions)
        .set({ stopLoss: newStop.toString(), updatedAt: getActiveClock().date() })
        .where(and(
          eq(paperPositions.id, numericId),
          eq(paperPositions.status, 'open'),
        ));
      const affected = (result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0;

      // Also nudge IEM's in-memory copy so the next IEM tick uses the new stop.
      try {
        const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
        const iem = getIntelligentExitManager();
        const iemPositions = (iem as any).positions as Map<string, any>;
        if (iemPositions) {
          for (const [_k, p] of iemPositions) {
            if (p?.dbPositionId === numericId) {
              p.stopLoss = newStop;
              break;
            }
          }
        }
      } catch { /* skip */ }

      if (affected > 0) {
        logger.info(`[BrainExecutor] 🧠🪜 STOP_UPDATED id=${numericId} → $${newStop} reason="${reason}"`);
      }
      return { ok: affected > 0, affectedRows: affected, reason };
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      logger.error(`[BrainExecutor] updateStop threw for ${positionId}: ${msg}`);
      return { ok: false, affectedRows: 0, error: msg, reason };
    }
  }

  /**
   * Partial close — v1 implements as 50% full close + reopen at smaller size.
   * v2 will support arbitrary % via PaperTradingEngine.partialClose.
   * For now, treat take_partial as a full exit_full to avoid half-baked partials.
   */
  async exitPartial(
    positionId: string | number,
    qtyPercent: number,
    currentPrice: number,
    reason: string,
  ): Promise<ExecutionResult> {
    logger.warn(`[BrainExecutor] take_partial(${qtyPercent}%) — v1 implements as full exit. Defer for v2.`);
    return this.exitFull(positionId, currentPrice, `partial_as_full:${reason}`);
  }
}

let _brainExecutor: BrainExecutor | null = null;
export function getBrainExecutor(): BrainExecutor {
  if (!_brainExecutor) _brainExecutor = new BrainExecutor();
  return _brainExecutor;
}
