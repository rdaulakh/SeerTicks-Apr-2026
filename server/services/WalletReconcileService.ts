/**
 * WalletReconcileService — Phase 93.6
 *
 * Periodic reconcile of paperWallets vs the real Binance Futures account.
 *
 * Background: paperWallets is a derived/cached view of trading state. It's
 * updated incrementally when trades close — but live exchange events (fees,
 * funding, slippage, liquidations, manual external withdrawals/deposits)
 * can move the truth on Binance while SEER's view stays stale. Audit on
 * 2026-05-13 found a $565 wallet drift and a stale totalTrades counter
 * (SEER=59, actual closed trades=134).
 *
 * Strategy:
 *   - Every RECONCILE_INTERVAL_MS pull Binance /fapi/v2/account
 *   - Update paperWallets.balance / equity / unrealizedPnL to match
 *   - Recompute totalTrades / wins / losses / winRate from paperPositions
 *   - Log drift magnitude before each update so audit trail is preserved
 *
 * This is purely reactive — does NOT issue orders. It just keeps the local
 * view honest about what's actually in the exchange account.
 */

import { createHmac } from 'crypto';
import { logger } from '../utils/logger';
import { getActiveClock } from '../_core/clock';

const RECONCILE_INTERVAL_MS = 5 * 60_000; // 5 min — tight enough to catch drift, loose enough to not hammer the API.

class WalletReconcileService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastReconcileAtMs: number | null = null;
  private lastDriftUSD: number | null = null;

  start(): void {
    if (this.timer) return;
    // First run 30s after boot — lets the engine finish loading and stabilize.
    setTimeout(() => this.runOnce().catch(() => {}), 30_000);
    this.timer = setInterval(() => this.runOnce().catch(() => {}), RECONCILE_INTERVAL_MS);
    logger.info(`[WalletReconcile] started — reconciles every ${RECONCILE_INTERVAL_MS / 1000}s`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  status() {
    return {
      running: this.timer !== null,
      lastReconcileAtMs: this.lastReconcileAtMs,
      lastDriftUSD: this.lastDriftUSD,
      intervalMs: RECONCILE_INTERVAL_MS,
    };
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;
      const { paperWallets, paperPositions, exchanges, apiKeys } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      // For each user with binance-futures credentials, reconcile.
      const exchangeRows = await db.select().from(exchanges).where(eq(exchanges.exchangeName, 'binance-futures'));
      for (const exRow of exchangeRows) {
        try {
          await this.reconcileUser(db, exRow.userId, exRow.id, { paperWallets, paperPositions, apiKeys, eq, and });
        } catch (err) {
          logger.warn(`[WalletReconcile] user ${exRow.userId} failed`, { error: (err as Error)?.message });
        }
      }
      this.lastReconcileAtMs = Date.now();
    } finally {
      this.running = false;
    }
  }

  private async reconcileUser(
    db: any, userId: number, exchangeId: number,
    schema: any,
  ): Promise<void> {
    const { paperWallets, paperPositions, apiKeys, eq, and } = schema;

    // Pull the encrypted key
    const keyRow = await db.select().from(apiKeys).where(and(
      eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, exchangeId),
    )).limit(1);
    if (keyRow.length === 0) return;
    const { decrypt } = await import('../crypto');
    let apiKey: string, apiSecret: string;
    try {
      apiKey = decrypt(keyRow[0].encryptedApiKey, keyRow[0].apiKeyIv);
      apiSecret = decrypt(keyRow[0].encryptedApiSecret, keyRow[0].apiSecretIv);
    } catch {
      return;  // Can't decrypt — skip silently
    }

    // Fetch Binance truth
    const base = process.env.BINANCE_FUTURES_USE_TESTNET === '1'
      ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
    const ts = Date.now();
    const qs = new URLSearchParams({ timestamp: String(ts), recvWindow: '10000' }).toString();
    const sig = createHmac('sha256', apiSecret).update(qs).digest('hex');
    let binance: any;
    try {
      const r = await fetch(`${base}/fapi/v2/account?${qs}&signature=${sig}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      if (!r.ok) {
        const body = await r.text();
        logger.warn(`[WalletReconcile] user ${userId} api ${r.status}`, { body: body.slice(0, 200) });
        return;
      }
      binance = await r.json();
    } catch (err) {
      logger.warn(`[WalletReconcile] user ${userId} fetch failed`, { error: (err as Error)?.message });
      return;
    }

    const binBalance = parseFloat(binance.totalWalletBalance);
    const binEquity = parseFloat(binance.totalMarginBalance);
    const binMargin = binBalance - parseFloat(binance.availableBalance);
    const binUPnl = parseFloat(binance.totalUnrealizedProfit);

    // Read SEER's current view
    const walletRows = await db.select().from(paperWallets).where(and(
      eq(paperWallets.userId, userId), eq(paperWallets.tradingMode, 'live'),
    )).limit(1);
    const wallet = walletRows[0];
    if (!wallet) {
      logger.info(`[WalletReconcile] user ${userId}: no live wallet yet — skipping`);
      return;
    }

    // Recompute trade counters from paperPositions (the truth) — paperWallets
    // counters drift over time as some code paths forget to increment them.
    const closedTrades = await db.select().from(paperPositions).where(and(
      eq(paperPositions.userId, userId), eq(paperPositions.status, 'closed'),
    ));
    let wins = 0, losses = 0, totalCommission = 0, totalRealized = 0;
    for (const t of closedTrades) {
      const pnl = parseFloat(t.realizedPnl ?? '0');
      const comm = parseFloat(t.commission ?? '0');
      totalRealized += pnl;
      totalCommission += comm;
      if (pnl > 0) wins++; else if (pnl < 0) losses++;
    }
    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    // Compute drift before update
    const seerBalance = parseFloat(wallet.balance);
    const balanceDrift = binBalance - seerBalance;
    this.lastDriftUSD = balanceDrift;

    if (Math.abs(balanceDrift) > 0.5 || wallet.totalTrades !== totalTrades) {
      logger.warn(`[WalletReconcile] user ${userId} drift detected — updating`, {
        balance: { binance: binBalance, seer: seerBalance, drift: balanceDrift },
        trades: { binance: 'n/a', seer_stored: wallet.totalTrades, actual: totalTrades },
      });
    }

    // Push truth into paperWallets
    await db.update(paperWallets).set({
      balance: binBalance.toFixed(2),
      equity: binEquity.toFixed(2),
      margin: Math.max(0, binMargin).toFixed(2),
      marginLevel: binMargin > 0 ? ((binEquity / binMargin) * 100).toFixed(2) : '0.00',
      unrealizedPnL: binUPnl.toFixed(2),
      realizedPnL: totalRealized.toFixed(2),
      totalPnL: (binUPnl + totalRealized).toFixed(2),
      totalCommission: totalCommission.toFixed(2),
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      winRate: winRate.toFixed(2),
      updatedAt: getActiveClock().date(),
    }).where(and(
      eq(paperWallets.userId, userId),
      eq(paperWallets.tradingMode, 'live'),
    ));
  }
}

let _instance: WalletReconcileService | null = null;
export function getWalletReconcileService(): WalletReconcileService {
  if (!_instance) _instance = new WalletReconcileService();
  return _instance;
}
