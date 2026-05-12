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
import { paperPositions, positions as livePositionsTable } from '../../drizzle/schema';
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

// Phase 85 — feature flag for live ENTRY. Live exits + stop updates are
// always allowed when the brain operates on a live position (closing real
// risk is safer than opening it). Live entries remain gated until we add
// the brain↔︎engine reconciliation handshake (slippage cap, partial fills,
// margin pre-check). Set via systemConfig key 'brain.liveEntriesEnabled'.
async function liveEntriesEnabled(): Promise<boolean> {
  try {
    const { systemConfig } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return false;
    const [row] = await db.select().from(systemConfig)
      .where(eq(systemConfig.configKey, 'brain.liveEntriesEnabled')).limit(1);
    if (!row?.configValue) return false;
    const raw = row.configValue as unknown;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed === true;
  } catch { return false; }
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

      // Phase 85 — try live path first. positionId in the brain currently
      // points to paperPositions.id, but live positions live in a separate
      // table. Probe the live table first; if matched, route via the live
      // EngineAdapter (NOT direct DB) so the exchange order is actually
      // placed and slippage/partial-fill paths fire properly.
      try {
        const [liveRow] = await db.select().from(livePositionsTable)
          .where(and(eq(livePositionsTable.id, numericId), eq(livePositionsTable.status, 'open')))
          .limit(1);
        if (liveRow) {
          const { getExistingAdapter } = await import('../services/EngineAdapter');
          const adapter = getExistingAdapter(liveRow.userId);
          if (!adapter) {
            logger.warn(`[BrainExecutor] 🧠⚠️  LIVE exit requested for position ${numericId} but no live engine adapter for user ${liveRow.userId}`);
            return { ok: false, affectedRows: 0, error: 'no_live_adapter', reason };
          }
          const r = await adapter.closePosition(0, liveRow.symbol, String(numericId), `brain:${reason}`)
            .catch((err: Error) => ({ success: false, error: err?.message } as any));
          if ((r as any)?.success) {
            logger.info(`[BrainExecutor] 🧠💰 LIVE EXIT routed via EngineAdapter id=${numericId} ${liveRow.symbol} ${liveRow.side} → engine closed @ $${(r as any).price ?? currentPrice} reason="${reason}"`);
            // Learning loop: feed real-money outcome too.
            try {
              const { getDecisionEvaluator } = await import('../services/DecisionEvaluator');
              const evaluator = getDecisionEvaluator(liveRow.userId);
              const exitPrice = (r as any).price ?? currentPrice;
              const entryPx = parseFloat(liveRow.entryPrice);
              const qty = parseFloat(liveRow.quantity);
              const sideMul = liveRow.side === 'long' ? 1 : -1;
              const realizedPnl = sideMul * (exitPrice - entryPx) * qty;
              evaluator.recordTradeOutcome(liveRow.symbol, realizedPnl, exitPrice, `brain:${reason}`, { tradeId: numericId, tradingMode: 'live' })
                .catch((err: Error) => logger.warn('[BrainExecutor] live learning-loop failed', { error: err?.message }));
            } catch { /* never block exit on learning */ }
            this.emit('brain_position_closed', { positionId: numericId, symbol: liveRow.symbol, side: liveRow.side, exitPrice: (r as any).price ?? currentPrice, reason, mode: 'live' });
            return { ok: true, affectedRows: 1, reason };
          }
          // Live attempted but failed — return structured failure (do NOT
          // fall through to paper; this position is LIVE money).
          return { ok: false, affectedRows: 0, error: (r as any)?.error ?? 'live_exit_failed', reason };
        }
      } catch (err) {
        // Live probe failed — proceed to paper path. Live path is opt-in via
        // a position existing in `positions` table; absence means paper.
        logger.warn('[BrainExecutor] live-exit probe failed, falling through to paper', { error: (err as Error)?.message });
      }

      // ─── Paper path (default) ─────────────────────────────────────────
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

      // Phase 87 — Symmetric exit slippage. A market close hits the OPPOSITE
      // side of the book vs the entry (long exits by selling at bid, short
      // exits by buying at ask). Apply half-spread + 1bp impact, just like
      // openPosition. Without this paper P&L is artificially generous on
      // exits too.
      let exitSlipBps = 2.0; // 1bp half-spread + 1bp impact, safe default
      try {
        const fut = (global as any).__binanceFuturesBook ?? {};
        const binSym = row.symbol.replace('-USD', 'USDT');
        const book = fut[binSym];
        if (book?.askPrice && book?.bidPrice && book?.midPrice > 0) {
          const liveSpreadBps = ((book.askPrice - book.bidPrice) / book.midPrice) * 10_000;
          exitSlipBps = Math.max(1.0, liveSpreadBps / 2) + 1.0;
        }
      } catch { /* keep default */ }
      // For long exit: sell — fill BELOW mid (bid). For short exit: buy —
      // fill ABOVE mid (ask). Sign is the same: P&L gets WORSE in both cases.
      const exitSlipFactor = exitSlipBps / 10_000;
      const adverseExitSlip = row.side === 'long' ? -currentPrice * exitSlipFactor : currentPrice * exitSlipFactor;
      const fillPrice = currentPrice + adverseExitSlip;
      const realizedPnl = sideMul * (fillPrice - entryPrice) * quantity;

      const result = await db.update(paperPositions)
        .set({
          status: 'closed',
          exitPrice: fillPrice.toString(),
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
        logger.info(`[BrainExecutor] 🧠✅ EXIT_FULL id=${numericId} ${row.symbol} ${row.side} @ $${fillPrice.toFixed(4)} (slip ${exitSlipBps.toFixed(1)}bps) pnl=$${realizedPnl.toFixed(2)} reason="${reason}"`);
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

        // Phase 84 — close the learning loop. Fire DecisionEvaluator's
        // recordTradeOutcome so AgentWeightManager updates per-agent Brier
        // scores AND AgentPnlAttributor writes the signed-$ row. Fire-and-
        // forget; learning failures NEVER block exit confirmation.
        try {
          const { getDecisionEvaluator } = await import('../services/DecisionEvaluator');
          const evaluator = getDecisionEvaluator(row.userId);
          evaluator
            .recordTradeOutcome(
              row.symbol,
              realizedPnl,
              fillPrice,
              `brain:${reason}`,
              { tradeId: numericId, tradingMode: row.tradingMode === 'live' ? 'live' : 'paper' },
            )
            .catch((err: Error) => logger.warn('[BrainExecutor] learning-loop recordTradeOutcome failed', { error: err?.message }));
        } catch (err) {
          logger.warn('[BrainExecutor] learning-loop wiring failed', { error: (err as Error)?.message });
        }

        // Update PaperTradingEngine wallet via the position_closed event chain.
        // We emit our own brain_position_closed; UserTradingSession listens.
        this.emit('brain_position_closed', {
          positionId: numericId,
          symbol: row.symbol,
          side: row.side,
          exitPrice: fillPrice,
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

      // Phase 85 — try LIVE positions table first. The live IEM polls this
      // table for stop changes, so a DB-update is the simplest cross-process
      // signaling path. (No exchange-side stop order is placed here — stops
      // are server-side; engine takes a market exit when price crosses.)
      try {
        const liveUpd = await db.update(livePositionsTable)
          .set({ stopLoss: newStop.toString(), updatedAt: getActiveClock().date() })
          .where(and(
            eq(livePositionsTable.id, numericId),
            eq(livePositionsTable.status, 'open'),
          ));
        const liveAffected = (liveUpd as any)?.[0]?.affectedRows ?? (liveUpd as any)?.affectedRows ?? 0;
        if (liveAffected > 0) {
          logger.info(`[BrainExecutor] 🧠🪜 LIVE STOP UPDATE id=${numericId} → $${newStop} reason="${reason}"`);
          return { ok: true, affectedRows: liveAffected, reason };
        }
      } catch { /* fall through to paper */ }

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

  /**
   * Phase 84 — open a new paper position via direct DB insert. Uses the
   * SAME path UserTradingSession uses for direct-DB-fallback on the entry
   * side. PaperTradingEngine's next loadOpenPositions or DB poll picks it
   * up in its in-memory map.
   *
   * For v1 we go direct-DB to avoid coupling the brain to a per-user
   * PaperTradingEngine instance. v2 will route through the engine for
   * proper wallet-margin accounting and commission tracking.
   */
  async openPosition(args: {
    symbol: string;
    side: 'long' | 'short';
    quantity: number;
    stopLoss: number;
    takeProfit: number;
    reason: string;
    userId?: number;
    exchange?: 'coinbase' | 'binance';
    /** Phase 85 — set 'live' to attempt live entry (requires brain.liveEntriesEnabled feature flag). */
    mode?: 'paper' | 'live';
  }): Promise<ExecutionResult & { positionId?: number }> {
    try {
      const db = await getDb();
      if (!db) return { ok: false, affectedRows: 0, error: 'db_unavailable', reason: args.reason };

      // Phase 86 — live entries via EngineAdapter.placeOrder (paper/real
      // engines route under the same interface). Still gated by feature flag.
      if (args.mode === 'live') {
        const enabled = await liveEntriesEnabled();
        if (!enabled) {
          logger.warn(`[BrainExecutor] 🧠⛔ LIVE entry requested for ${args.symbol} ${args.side} but brain.liveEntriesEnabled=false. Skipping.`);
          return { ok: false, affectedRows: 0, error: 'live_entries_disabled', reason: args.reason };
        }
        if (!args.userId) {
          return { ok: false, affectedRows: 0, error: 'live_requires_userId', reason: args.reason };
        }
        try {
          const { getExistingAdapter } = await import('../services/EngineAdapter');
          const adapter = getExistingAdapter(args.userId);
          if (!adapter) return { ok: false, affectedRows: 0, error: 'no_live_adapter', reason: args.reason };
          const r = await adapter.placeOrder({
            symbol: args.symbol,
            side: args.side === 'long' ? 'buy' : 'sell',
            quantity: args.quantity,
            stopLoss: args.stopLoss,
            takeProfit: args.takeProfit,
            strategy: `brain_v2_entry:${args.reason}`.slice(0, 50),
          });
          if (!r.success) {
            logger.warn(`[BrainExecutor] 🧠❌ LIVE entry failed: ${r.error} for ${args.symbol} ${args.side}`);
            return { ok: false, affectedRows: 0, error: r.error ?? 'live_entry_failed', reason: args.reason };
          }
          logger.info(`[BrainExecutor] 🧠💰 LIVE OPENED ${args.symbol} ${args.side} qty=${args.quantity.toFixed(6)} @ $${r.filledPrice?.toFixed(4) ?? '?'} order=${r.orderId} reason="${args.reason}"`);
          this.emit('brain_position_opened', {
            positionId: r.orderId, symbol: args.symbol, side: args.side,
            entryPrice: r.filledPrice, quantity: args.quantity,
            stopLoss: args.stopLoss, takeProfit: args.takeProfit,
            reason: args.reason, mode: 'live',
          });
          return { ok: true, affectedRows: 1, reason: args.reason };
        } catch (err) {
          return { ok: false, affectedRows: 0, error: (err as Error)?.message ?? 'live_route_failed', reason: args.reason };
        }
      }

      // Resolve current price from PriceFabric / globals.
      let entryPrice = 0;
      let spreadBps = 0;
      try {
        const fut = (global as any).__binanceFuturesBook ?? {};
        const binSym = args.symbol.replace('-USD', 'USDT');
        const book = fut[binSym];
        if (book?.midPrice) {
          entryPrice = book.midPrice;
          // Phase 86 — read live spread if available so slippage is anchored
          // to the actual book, not a guess.
          if (book.askPrice && book.bidPrice && book.midPrice > 0) {
            spreadBps = ((book.askPrice - book.bidPrice) / book.midPrice) * 10_000;
          }
        }
      } catch { /* fall back below */ }
      if (!entryPrice || !Number.isFinite(entryPrice)) {
        // Fall back to last paperPositions price for this symbol
        const [row] = await db.select().from(paperPositions)
          .where(eq(paperPositions.symbol, args.symbol))
          .limit(1);
        if (row?.currentPrice) entryPrice = parseFloat(row.currentPrice);
      }
      if (!entryPrice || !Number.isFinite(entryPrice)) {
        return { ok: false, affectedRows: 0, error: 'no_price', reason: args.reason };
      }

      // Phase 86 — paper slippage simulator. A live market order doesn't
      // fill at mid — it crosses the spread + pays some impact. Model:
      //   slippage_bps = max(1, spreadBps/2) + impactBps
      //   impactBps    = 1.0 (for typical $1–5k notional on BTC/ETH/SOL)
      // Long fills ABOVE mid, shorts BELOW. Without this paper P&L is
      // systematically optimistic (~3–5 bps per round-trip on majors).
      const halfSpreadBps = spreadBps > 0 ? spreadBps / 2 : 1.0; // 1 bp minimum
      const impactBps = 1.0;
      const slipBps = halfSpreadBps + impactBps;
      const slipFactor = slipBps / 10_000;
      const adverseSlip = args.side === 'long' ? entryPrice * slipFactor : -entryPrice * slipFactor;
      entryPrice = entryPrice + adverseSlip;

      const inserted = await db.insert(paperPositions).values({
        userId: args.userId ?? 1,
        tradingMode: 'paper',
        symbol: args.symbol,
        exchange: args.exchange ?? 'coinbase',
        side: args.side,
        entryPrice: entryPrice.toString(),
        currentPrice: entryPrice.toString(),
        quantity: args.quantity.toString(),
        stopLoss: args.stopLoss.toString(),
        takeProfit: args.takeProfit.toString(),
        entryTime: getActiveClock().date(),
        unrealizedPnL: '0',
        unrealizedPnLPercent: '0',
        commission: '0',
        strategy: 'brain_v2_entry',
        status: 'open',
      });
      const insertedId = (inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? null;
      logger.info(`[BrainExecutor] 🧠🆕 OPENED ${args.symbol} ${args.side} qty=${args.quantity.toFixed(6)} @ $${entryPrice.toFixed(4)} (slip ${slipBps.toFixed(1)}bps) sl=$${args.stopLoss.toFixed(4)} tp=$${args.takeProfit.toFixed(4)} id=${insertedId} reason="${args.reason}"`);
      this.emit('brain_position_opened', {
        positionId: insertedId, symbol: args.symbol, side: args.side,
        entryPrice, quantity: args.quantity, stopLoss: args.stopLoss, takeProfit: args.takeProfit,
        reason: args.reason,
      });
      return { ok: true, affectedRows: 1, reason: args.reason, positionId: insertedId };
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      logger.error(`[BrainExecutor] openPosition threw: ${msg}`);
      return { ok: false, affectedRows: 0, error: msg, reason: args.reason };
    }
  }
}

let _brainExecutor: BrainExecutor | null = null;
export function getBrainExecutor(): BrainExecutor {
  if (!_brainExecutor) _brainExecutor = new BrainExecutor();
  return _brainExecutor;
}
