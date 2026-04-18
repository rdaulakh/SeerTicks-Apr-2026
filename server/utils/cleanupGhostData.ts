/**
 * Phase 13D (Enhanced): One-time cleanup of ghost data, price=0 trades, and NULL exitPrice positions.
 *
 * Run this ONCE on production to fix historical data corruption caused by:
 * 1. The price=0 bug (WebSocket disconnects → getCurrentPrice() returned 0)
 * 2. NULL exitPrice bug (positions closed without recording exit price)
 *
 * What it does:
 * 1. Fixes closed positions where exitPrice = 0 OR exitPrice = NULL → sets to entryPrice (breakeven)
 * 2. Recalculates P&L for those positions to $0 (removes phantom losses)
 * 3. Fixes trades in paperTrades table with price = 0 or NULL
 * 4. Closes any "open" ghost positions that are stale (>24h without update)
 * 5. Recalculates wallet balance from corrected positions
 *
 * NOTE: This is paper trading only. No real money was ever at risk.
 * The cleanup ensures P&L tracking accurately reflects real trading performance,
 * not phantom losses from WebSocket disconnects or missing exit prices.
 *
 * Usage: Import and call cleanupGhostData(userId) from a one-off script or admin endpoint.
 */

import { getDb } from '../db';
import { paperPositions, paperWallets, paperTrades } from '../../drizzle/schema';
import { eq, and, or, sql, isNull } from 'drizzle-orm';

interface CleanupResult {
  priceZeroPositionsFixed: number;
  nullExitPricePositionsFixed: number;
  ghostPositionsClosed: number;
  walletRecalculated: boolean;
  priceZeroTradesMarked: number;
  nullPriceTradesMarked: number;
  totalPnlCorrection: number;
  newWalletBalance: number | null;
  actualTotalTrades: number;
  actualWins: number;
  actualLosses: number;
}

export async function cleanupGhostData(userId: number): Promise<CleanupResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result: CleanupResult = {
    priceZeroPositionsFixed: 0,
    nullExitPricePositionsFixed: 0,
    ghostPositionsClosed: 0,
    walletRecalculated: false,
    priceZeroTradesMarked: 0,
    nullPriceTradesMarked: 0,
    totalPnlCorrection: 0,
    newWalletBalance: null,
    actualTotalTrades: 0,
    actualWins: 0,
    actualLosses: 0,
  };

  console.log(`[CleanupGhostData] Starting enhanced cleanup for user ${userId}...`);

  // ========================================
  // STEP 1A: Fix closed positions with exitPrice = 0
  // These are phantom losses caused by the price=0 bug
  // ========================================
  try {
    const priceZeroPositions = await db.select().from(paperPositions).where(
      and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'closed'),
        or(
          eq(paperPositions.exitPrice, '0'),
          eq(paperPositions.exitPrice, '0.00'),
          eq(paperPositions.exitPrice, '0.000000'),
          sql`CAST(${paperPositions.exitPrice} AS DECIMAL(20,8)) <= 0`
        )
      )
    );

    console.log(`[CleanupGhostData] Found ${priceZeroPositions.length} positions with exitPrice = 0`);

    for (const pos of priceZeroPositions) {
      const oldPnl = parseFloat(String(pos.realizedPnl || '0'));
      result.totalPnlCorrection += Math.abs(oldPnl);

      await db.update(paperPositions)
        .set({
          realizedPnl: '0',
          unrealizedPnL: '0',
          unrealizedPnLPercent: '0',
          exitPrice: String(pos.entryPrice), // Exit at entry = breakeven
          exitReason: `SYSTEM_ERROR: price=0 bug (original: ${pos.exitReason || 'unknown'})`,
        })
        .where(eq(paperPositions.id, pos.id));

      result.priceZeroPositionsFixed++;
    }
  } catch (err) {
    console.error('[CleanupGhostData] Error fixing price=0 positions:', (err as Error)?.message);
  }

  // ========================================
  // STEP 1B: Fix closed positions with exitPrice = NULL
  // These are positions that were closed without recording the exit price
  // ========================================
  try {
    const nullExitPositions = await db.select().from(paperPositions).where(
      and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'closed'),
        or(
          isNull(paperPositions.exitPrice),
          eq(paperPositions.exitPrice, '')
        )
      )
    );

    console.log(`[CleanupGhostData] Found ${nullExitPositions.length} positions with exitPrice = NULL`);

    for (const pos of nullExitPositions) {
      const oldPnl = parseFloat(String(pos.realizedPnl || '0'));
      result.totalPnlCorrection += Math.abs(oldPnl);

      await db.update(paperPositions)
        .set({
          realizedPnl: '0',
          unrealizedPnL: '0',
          unrealizedPnLPercent: '0',
          exitPrice: String(pos.entryPrice), // Exit at entry = breakeven
          exitReason: `SYSTEM_ERROR: NULL exitPrice (original: ${pos.exitReason || 'unknown'})`,
        })
        .where(eq(paperPositions.id, pos.id));

      result.nullExitPricePositionsFixed++;
    }
  } catch (err) {
    console.error('[CleanupGhostData] Error fixing NULL exitPrice positions:', (err as Error)?.message);
  }

  // ========================================
  // STEP 2A: Fix trades in paperTrades table with price = 0
  // ========================================
  try {
    const priceZeroTrades = await db.select().from(paperTrades).where(
      and(
        eq(paperTrades.userId, userId),
        or(
          eq(paperTrades.price, '0'),
          eq(paperTrades.price, '0.00'),
          sql`CAST(${paperTrades.price} AS DECIMAL(20,8)) <= 0`
        )
      )
    );

    console.log(`[CleanupGhostData] Found ${priceZeroTrades.length} trades with price = 0`);

    for (const trade of priceZeroTrades) {
      await db.update(paperTrades)
        .set({
          pnl: '0',
          strategy: `SYSTEM_ERROR: price=0 (was: ${trade.strategy || 'unknown'})`,
        })
        .where(eq(paperTrades.id, trade.id));

      result.priceZeroTradesMarked++;
    }
  } catch (err) {
    console.error('[CleanupGhostData] Error fixing price=0 trades:', (err as Error)?.message);
  }

  // ========================================
  // STEP 2B: Fix trades in paperTrades table with price = NULL
  // ========================================
  try {
    const nullPriceTrades = await db.select().from(paperTrades).where(
      and(
        eq(paperTrades.userId, userId),
        or(
          isNull(paperTrades.price),
          eq(paperTrades.price, '')
        )
      )
    );

    console.log(`[CleanupGhostData] Found ${nullPriceTrades.length} trades with price = NULL`);

    for (const trade of nullPriceTrades) {
      await db.update(paperTrades)
        .set({
          pnl: '0',
          strategy: `SYSTEM_ERROR: NULL price (was: ${trade.strategy || 'unknown'})`,
        })
        .where(eq(paperTrades.id, trade.id));

      result.nullPriceTradesMarked++;
    }
  } catch (err) {
    console.error('[CleanupGhostData] Error fixing NULL price trades:', (err as Error)?.message);
  }

  // ========================================
  // STEP 3: Close ghost "open" positions that are stale
  // Ghost = open position with no recent price update (>24h old)
  // ========================================
  try {
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    const ghostPositions = await db.select().from(paperPositions).where(
      and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'open'),
        sql`${paperPositions.updatedAt} < ${staleThreshold}`
      )
    );

    console.log(`[CleanupGhostData] Found ${ghostPositions.length} ghost open positions (stale >24h)`);

    // Phase 23: Import priceFeedService for real market prices
    const { priceFeedService } = await import('../services/priceFeedService');
    
    for (const pos of ghostPositions) {
      // Phase 23: Get real market price, don't fabricate
      const priceData = priceFeedService.getLatestPrice(pos.symbol);
      const exitPx = priceData?.price || parseFloat(pos.currentPrice?.toString() || '0');
      
      if (!exitPx || exitPx <= 0 || isNaN(exitPx)) {
        // No real price available — mark as data_integrity_issue, don't fabricate P&L
        await db.update(paperPositions)
          .set({
            status: 'closed',
            exitPrice: null,
            exitTime: new Date(),
            realizedPnl: null,
            exitReason: 'SYSTEM_CLEANUP: Ghost position closed (stale >24h) — data_integrity_issue (no market price)',
          })
          .where(eq(paperPositions.id, pos.id));
      } else {
        // Real price available — calculate accurate P&L
        const entryPrice = parseFloat(pos.entryPrice?.toString() || '0');
        const quantity = parseFloat(pos.quantity?.toString() || '0');
        const pnl = pos.side === 'long'
          ? (exitPx - entryPrice) * quantity
          : (entryPrice - exitPx) * quantity;
        
        await db.update(paperPositions)
          .set({
            status: 'closed',
            exitPrice: exitPx.toString(),
            exitTime: new Date(),
            realizedPnl: pnl.toFixed(8),
            exitReason: 'SYSTEM_CLEANUP: Ghost position closed (stale >24h)',
          })
          .where(eq(paperPositions.id, pos.id));
      }

      result.ghostPositionsClosed++;
    }
  } catch (err) {
    console.error('[CleanupGhostData] Error closing ghost positions:', (err as Error)?.message);
  }

  // ========================================
  // STEP 4: Recalculate wallet balance from corrected data
  // ========================================
  try {
    const allClosedPositions = await db.select().from(paperPositions).where(
      and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'closed'))
    );

    let totalRealizedPnl = 0;
    let winCount = 0;
    let lossCount = 0;

    for (const pos of allClosedPositions) {
      const pnl = parseFloat(String(pos.realizedPnl || '0'));
      if (!isNaN(pnl)) {
        totalRealizedPnl += pnl;
        if (pnl > 0) winCount++;
        else if (pnl < 0) lossCount++;
      }
    }

    // Paper trading starting balance = $10,000 (standard)
    const STARTING_BALANCE = 10000;
    const correctedBalance = STARTING_BALANCE + totalRealizedPnl;

    // Count currently open positions for margin calculation
    const openPositions = await db.select().from(paperPositions).where(
      and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open'))
    );

    let marginInUse = 0;
    for (const pos of openPositions) {
      const entry = parseFloat(String(pos.entryPrice));
      const qty = parseFloat(String(pos.quantity));
      if (!isNaN(entry) && !isNaN(qty)) marginInUse += entry * qty;
    }

    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(2) : '0.00';

    await db.update(paperWallets)
      .set({
        balance: correctedBalance.toFixed(2),
        realizedPnL: totalRealizedPnl.toFixed(2),
        margin: marginInUse.toFixed(2),
        totalTrades,
        winningTrades: winCount,
        losingTrades: lossCount,
        winRate,
      })
      .where(and(eq(paperWallets.userId, userId), eq(paperWallets.tradingMode, 'paper')));

    result.walletRecalculated = true;
    result.newWalletBalance = correctedBalance;
    result.actualTotalTrades = totalTrades;
    result.actualWins = winCount;
    result.actualLosses = lossCount;

    console.log(`[CleanupGhostData] Wallet recalculated: $${correctedBalance.toFixed(2)} (starting $${STARTING_BALANCE} + realized P&L $${totalRealizedPnl.toFixed(2)})`);
    console.log(`[CleanupGhostData] Actual stats: ${totalTrades} trades, ${winCount} wins, ${lossCount} losses, ${winRate}% win rate`);
  } catch (err) {
    console.error('[CleanupGhostData] Error recalculating wallet:', (err as Error)?.message);
  }

  console.log(`[CleanupGhostData] Enhanced cleanup complete:`, result);
  return result;
}
