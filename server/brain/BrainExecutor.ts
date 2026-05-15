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
          // Phase 94.1 — bypassProfitLock=true. The brain decided this exit;
          // ProfitLockGuard's cost-drag floor was a legacy safety net for the
          // pre-Phase-82 rule manager. Auditing the Phase 93.33/.34 fires
          // proved the allow-list approach is fragile — any new reason string
          // the brain emits is a silent block. Brain takes accountability.
          const r = await adapter.closePosition(0, liveRow.symbol, String(numericId), `brain:${reason}`, true)
            .catch((err: Error) => ({ success: false, error: err?.message } as any));
          if ((r as any)?.success) {
            // Phase 93.5 — use the ACTUAL exchange fill price + engine-reported
            // realizedPnl. Pre-Phase-93.5 `r.price` was the request-time mid
            // (UserTradingSession.requestManualClose returned `currentPrice`),
            // so every closed LIVE trade taught PatternPopulator + agentWeights +
            // mlTrainingData the WRONG outcome. Now r.price = true fill,
            // r.realizedPnl = engine pnl from order.filledPrice.
            const rPrice = (r as any).price;
            const exitPrice = typeof rPrice === 'number' && Number.isFinite(rPrice) && rPrice > 0
              ? rPrice : currentPrice;
            const usingRealFill = exitPrice !== currentPrice;
            const entryPx = parseFloat(liveRow.entryPrice);
            const qty = (typeof (r as any).filledQuantity === 'number' && (r as any).filledQuantity > 0)
              ? (r as any).filledQuantity
              : parseFloat(liveRow.quantity);
            const sideMul = liveRow.side === 'long' ? 1 : -1;
            // Prefer the engine's realizedPnl if it observed the actual fill;
            // otherwise derive from exit/entry/qty.
            const enginePnl = (r as any).realizedPnl;
            const realizedPnl = typeof enginePnl === 'number' && Number.isFinite(enginePnl)
              ? enginePnl
              : sideMul * (exitPrice - entryPx) * qty;
            logger.info(`[BrainExecutor] 🧠💰 LIVE EXIT routed via EngineAdapter id=${numericId} ${liveRow.symbol} ${liveRow.side} → engine closed @ $${exitPrice.toFixed(4)} (${usingRealFill ? 'real fill' : 'request-time fallback'}) pnl=$${realizedPnl.toFixed(2)} reason="${reason}"`);

            // Learning loop: feed REAL-MONEY outcome (real fill, real pnl).
            try {
              const { getDecisionEvaluator } = await import('../services/DecisionEvaluator');
              const evaluator = getDecisionEvaluator(liveRow.userId);
              evaluator.recordTradeOutcome(liveRow.symbol, realizedPnl, exitPrice, `brain:${reason}`, { tradeId: numericId, tradingMode: 'live' })
                .catch((err: Error) => logger.warn('[BrainExecutor] live learning-loop failed', { error: err?.message }));
            } catch { /* never block exit on learning */ }
            this.emit('brain_position_closed', {
              positionId: numericId, symbol: liveRow.symbol, side: liveRow.side,
              exitPrice, realizedPnl, reason, mode: 'live',
            });
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

      // ─── Phase 93.3 — LIVE-in-paperPositions path ────────────────────
      // The first probe above only checks the `positions` table for live rows.
      // But hydrated-from-exchange positions live in `paperPositions` with
      // tradingMode='live'. Without this branch, "live" rows that are in
      // paperPositions fall through to the DB-only update below and the
      // exchange position is NEVER actually closed — the next reconcile
      // sweep then re-imports it. Bug surfaced 2026-05-13: ETH/BTC shorts
      // closed by brain at 19:42:16 reappeared identically at 19:52:43,
      // confirming a re-hydration loop with no actual Binance close.
      if (row.tradingMode === 'live') {
        try {
          const { getExistingAdapter } = await import('../services/EngineAdapter');
          const adapter = getExistingAdapter(row.userId);
          if (!adapter) {
            logger.warn(`[BrainExecutor] 🧠⚠️  LIVE-mode paperPositions row ${numericId} but no engine adapter for user ${row.userId}`);
            return { ok: false, affectedRows: 0, error: 'no_live_adapter', reason };
          }
          // Phase 94.1 — bypassProfitLock=true on this LIVE-in-paperPositions
          // branch too. Same reasoning as the primary live branch above.
          const r = await adapter.closePosition(0, row.symbol, String(numericId), `brain:${reason}`, true)
            .catch((err: Error) => ({ success: false, error: err?.message } as any));
          if ((r as any)?.success) {
            // Phase 93.5 — same fix as the primary LIVE branch above: prefer the
            // ACTUAL exchange fill price and engine-reported realizedPnl over
            // the request-time mid. Pre-fix this branch fed the learning loop +
            // PatternPopulator + AgentPnlAttributor with mid-price PnL.
            const rPrice = (r as any).price;
            const exitPrice = typeof rPrice === 'number' && Number.isFinite(rPrice) && rPrice > 0
              ? rPrice : currentPrice;
            const usingRealFill = exitPrice !== currentPrice;
            const entryPx = parseFloat(row.entryPrice);
            const qty = (typeof (r as any).filledQuantity === 'number' && (r as any).filledQuantity > 0)
              ? (r as any).filledQuantity
              : parseFloat(row.quantity);
            const sideMul = row.side === 'long' ? 1 : -1;
            const enginePnl = (r as any).realizedPnl;
            const realizedPnl = typeof enginePnl === 'number' && Number.isFinite(enginePnl)
              ? enginePnl
              : sideMul * (exitPrice - entryPx) * qty;
            logger.info(`[BrainExecutor] 🧠💰 LIVE EXIT (paperPositions row, tradingMode=live) routed via EngineAdapter id=${numericId} ${row.symbol} ${row.side} → engine closed @ $${exitPrice.toFixed(4)} (${usingRealFill ? 'real fill' : 'request-time fallback'}) pnl=$${realizedPnl.toFixed(2)} reason="${reason}"`);
            // Learning loop
            try {
              const { getDecisionEvaluator } = await import('../services/DecisionEvaluator');
              const evaluator = getDecisionEvaluator(row.userId);
              evaluator.recordTradeOutcome(row.symbol, realizedPnl, exitPrice, `brain:${reason}`, { tradeId: numericId, tradingMode: 'live' })
                .catch((err: Error) => logger.warn('[BrainExecutor] live (paper-tbl) learning-loop failed', { error: err?.message }));
            } catch { /* never block exit on learning */ }
            this.emit('brain_position_closed', {
              positionId: numericId, symbol: row.symbol, side: row.side,
              exitPrice, realizedPnl, reason, mode: 'live',
            });
            return { ok: true, affectedRows: 1, reason };
          }
          // Live close attempted but failed — return structured failure. Do NOT
          // fall through to the DB-only update; that's the bug we're fixing.
          logger.error(`[BrainExecutor] 🧠⛔ LIVE close failed for id=${numericId} ${row.symbol}: ${(r as any)?.error ?? 'unknown'}`);
          return { ok: false, affectedRows: 0, error: (r as any)?.error ?? 'live_exit_failed', reason };
        } catch (err) {
          logger.error(`[BrainExecutor] 🧠⛔ LIVE-in-paperPositions exit threw for id=${numericId}: ${(err as Error)?.message}`);
          return { ok: false, affectedRows: 0, error: (err as Error)?.message ?? 'live_exit_threw', reason };
        }
      }

      // True paper from here down (tradingMode='paper').
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
              { tradeId: numericId, tradingMode: 'paper' as const }, // Phase 93.3 — live rows route via EngineAdapter above and never reach here
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
    /**
     * Phase 93.18 — brain confidence at entry time (geometric mean of
     * opp×stance×confluence; range 0..1). Persisted as originalConsensus +
     * peakConfidence so the confidence-decay exit + Brier scoring use real
     * values instead of the 0.65 default that was hardcoded in
     * UserTradingSession.
     */
    entryConsensus?: number;
  }): Promise<ExecutionResult & { positionId?: number }> {
    try {
      const db = await getDb();
      if (!db) return { ok: false, affectedRows: 0, error: 'db_unavailable', reason: args.reason };

      // ──────────────────────────────────────────────────────────────────
      // Phase 93.10 — SAME-SYMBOL EXPOSURE GUARD (belt-and-suspenders).
      //
      // Before opening ANY new position, verify the user has no other open
      // position on this symbol — regardless of side, exchange, strategy,
      // or which engine created it. A LONG+SHORT pair on the same symbol
      // is net-zero exposure that pays fees on both sides; a same-direction
      // pile-on over-concentrates conviction the prior position already
      // represents. This authoritative DB check catches all code paths:
      //   • Brain's own race (decideEntry ran before Sensorium re-polled)
      //   • Legacy enhanced_automated path (EnhancedTradeExecutor)
      //   • Live hydration (RealTradingEngine.hydrateFromExchange)
      //   • Concurrent brain ticks at 10Hz
      //
      // Bug reported 2026-05-13: paperPositions had BTC-USD SHORT #129 +
      // BTC-USD LONG #138 simultaneously, ETH-USD LONG + SHORT pair too.
      // Sensorium-level checks alone were insufficient because of the 1s
      // polling lag between table state and Sensorium state.
      // ──────────────────────────────────────────────────────────────────
      const userIdForCheck = args.userId ?? 1;
      const [existing] = await db.select({ id: paperPositions.id, side: paperPositions.side, strategy: paperPositions.strategy })
        .from(paperPositions)
        .where(and(
          eq(paperPositions.userId, userIdForCheck),
          eq(paperPositions.symbol, args.symbol),
          eq(paperPositions.status, 'open'),
        ))
        .limit(1);
      if (existing) {
        logger.warn(`[BrainExecutor] 🧠⛔ openPosition REFUSED: ${args.symbol} ${args.side} blocked — existing open position id=${existing.id} side=${existing.side} strategy=${existing.strategy} (user ${userIdForCheck}). Same-symbol exposure guard active.`);
        return { ok: false, affectedRows: 0, error: 'same_symbol_exposure', reason: args.reason };
      }
      // Also check the live `positions` table for the same user/symbol —
      // live and paper trades can coexist for the same user but should
      // never simultaneously hold opposite-side exposure on one symbol.
      try {
        const [liveExisting] = await db.select({ id: livePositionsTable.id, side: livePositionsTable.side })
          .from(livePositionsTable)
          .where(and(
            eq(livePositionsTable.userId, userIdForCheck),
            eq(livePositionsTable.symbol, args.symbol),
            eq(livePositionsTable.status, 'open'),
          ))
          .limit(1);
        if (liveExisting) {
          logger.warn(`[BrainExecutor] 🧠⛔ openPosition REFUSED: ${args.symbol} ${args.side} blocked — existing LIVE position id=${liveExisting.id} side=${liveExisting.side} (user ${userIdForCheck}). Same-symbol exposure guard active.`);
          return { ok: false, affectedRows: 0, error: 'same_symbol_exposure', reason: args.reason };
        }
      } catch { /* live table probe is best-effort; the paper-tbl check above is the primary gate */ }

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

      // Phase 93.18 — persist real entry consensus on the row so downstream
      // exit logic (confidence decay, peak-tracking) doesn't fall back to the
      // 0.65 default that was hardcoded in UserTradingSession.
      const conf = typeof args.entryConsensus === 'number' && Number.isFinite(args.entryConsensus)
        ? Math.max(0, Math.min(1, args.entryConsensus))
        : null;
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
        ...(conf !== null ? {
          originalConsensus: conf.toFixed(4),
          currentConfidence: conf.toFixed(4),
          peakConfidence: conf.toFixed(4),
          peakConfidenceTime: getActiveClock().date(),
        } : {}),
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
