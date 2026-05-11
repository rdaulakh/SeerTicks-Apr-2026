/**
 * Phase 75 — Comprehensive platform reset for fresh observation window.
 *
 * Goal: bring the entire platform to a known-good clean slate so the user can
 * watch a fresh trading day from start.
 *
 * Reset scope:
 *   1. Close every open position on Binance Futures testnet (flatten exchange)
 *   2. Mark every open paperPositions row as closed with exitReason='phase75_reset'
 *   3. Reset BOTH paperWallets (paper + live) to clean state:
 *        balance = 10000, equity = 10000, margin = 0
 *        totalPnL = 0, realizedPnL = 0, unrealizedPnL = 0
 *        totalTrades = 0, winningTrades = 0, losingTrades = 0, winRate = 0
 *   4. Keep paperTrades history for audit but reset the wallet counters
 *   5. Clear tradeDecisionLogs older than 1 day (optional — keeps audit window)
 *
 * After this runs, the operator should restart pm2 to clear in-memory state
 * (EnhancedTradeExecutor.peakEquity, halt flags, position tracker, etc).
 *
 * Run via:
 *   sudo -u seer bash -c 'cd /home/seer/app && \
 *     BINANCE_API_KEY=$(grep ^BINANCE_API_KEY= .env | cut -d= -f2) \
 *     BINANCE_SECRET_KEY=$(grep ^BINANCE_SECRET_KEY= .env | cut -d= -f2) \
 *     npx tsx scripts/_phase75_full_reset.ts'
 */

import 'dotenv/config';
import { USDMClient } from 'binance';
import { getDb } from '../server/db';
import { paperPositions, paperWallets } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

const USER_ID = 1;

interface SymbolMap {
  appSymbol: string;       // e.g. SOL-USD
  binanceSymbol: string;   // e.g. SOLUSDT
}

const SYMBOL_MAP: SymbolMap[] = [
  { appSymbol: 'SOL-USD', binanceSymbol: 'SOLUSDT' },
  { appSymbol: 'ETH-USD', binanceSymbol: 'ETHUSDT' },
  { appSymbol: 'BTC-USD', binanceSymbol: 'BTCUSDT' },
];

async function main() {
  console.log('==========================================');
  console.log('Phase 75 — FULL PLATFORM RESET');
  console.log('==========================================');
  console.log('Timestamp:', new Date().toISOString());

  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  // ---- Step 1: Flatten Binance testnet ----
  console.log('\n=== Step 1: Flatten Binance Futures testnet ===');
  const apiKey = process.env.BINANCE_API_KEY || process.env.BINANCE_FUTURES_API_KEY;
  const apiSecret = process.env.BINANCE_SECRET_KEY || process.env.BINANCE_FUTURES_SECRET_KEY;
  if (!apiKey || !apiSecret) {
    console.warn('⚠ BINANCE_API_KEY / BINANCE_SECRET_KEY not set in env — skipping exchange flatten step.');
    console.warn('  (DB reset will still proceed. Operator should manually flatten exchange if needed.)');
  } else {
    try {
      const client = new USDMClient({
        api_key: apiKey,
        api_secret: apiSecret,
        useTestnet: true,
      });

      const acct = await client.getAccountInformationV3();
      const openPositions = (acct.positions || []).filter((p) => parseFloat(p.positionAmt) !== 0);
      console.log(`Exchange has ${openPositions.length} open positions:`);
      openPositions.forEach((p) => console.log(`  ${p.symbol} qty=${p.positionAmt} entry=${p.entryPrice}`));

      for (const pos of openPositions) {
        const qty = parseFloat(pos.positionAmt);
        if (qty === 0) continue;
        const side = qty > 0 ? 'SELL' : 'BUY'; // Flatten — opposite side
        const absQty = Math.abs(qty);
        console.log(`  → ${side} ${absQty} ${pos.symbol} to flatten`);
        try {
          const order = await client.submitNewOrder({
            symbol: pos.symbol,
            side: side as 'SELL' | 'BUY',
            type: 'MARKET',
            quantity: absQty,
            reduceOnly: 'true',
          });
          console.log(`    ✓ Order ${order.orderId} status=${order.status}`);
        } catch (e) {
          console.error(`    ✗ Failed: ${(e as Error).message}`);
        }
      }
      // Wait for fills to propagate
      await new Promise((r) => setTimeout(r, 2000));
      const acctAfter = await client.getAccountInformationV3();
      const stillOpen = (acctAfter.positions || []).filter((p) => parseFloat(p.positionAmt) !== 0);
      console.log(`Exchange after flatten: ${stillOpen.length} positions remaining`);
      console.log(`Wallet: total=${acctAfter.totalWalletBalance} available=${acctAfter.availableBalance}`);
    } catch (e) {
      console.error('Exchange flatten failed:', (e as Error).message);
      console.warn('Continuing with DB reset anyway...');
    }
  }

  // ---- Step 2: Mark all open DB positions as closed ----
  console.log('\n=== Step 2: Close all open paperPositions rows ===');
  const openPosRows = await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.userId, USER_ID), eq(paperPositions.status, 'open')));
  console.log(`Found ${openPosRows.length} open positions in DB`);

  for (const pos of openPosRows) {
    const exitPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const qty = parseFloat(pos.quantity || '0');
    const realizedPnl = pos.side === 'long' ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;
    await db
      .update(paperPositions)
      .set({
        status: 'closed',
        exitReason: 'phase75_reset',
        exitPrice: exitPrice.toString(),
        exitTime: new Date(),
        realizedPnl: realizedPnl.toFixed(6),
      })
      .where(eq(paperPositions.id, pos.id));
    console.log(`  ✓ Closed #${pos.id} ${pos.symbol} ${pos.side} (PnL: $${realizedPnl.toFixed(2)})`);
  }

  // ---- Step 3: Reset BOTH wallets to clean state ----
  console.log('\n=== Step 3: Reset wallets to clean state ($10,000) ===');
  for (const mode of ['paper', 'live'] as const) {
    const [wallet] = await db
      .select()
      .from(paperWallets)
      .where(and(eq(paperWallets.userId, USER_ID), eq(paperWallets.tradingMode, mode)))
      .limit(1);

    if (wallet) {
      await db
        .update(paperWallets)
        .set({
          balance: '10000.00',
          equity: '10000.00',
          margin: '0.00',
          marginLevel: '0.00',
          totalPnL: '0.00',
          realizedPnL: '0.00',
          unrealizedPnL: '0.00',
          totalCommission: '0.00',
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: '0.00',
        })
        .where(eq(paperWallets.id, wallet.id));
      console.log(`  ✓ Reset ${mode} wallet (id=${wallet.id}) to $10,000`);
    } else {
      // Create fresh
      await db.insert(paperWallets).values({
        userId: USER_ID,
        tradingMode: mode,
        balance: '10000.00',
        equity: '10000.00',
        margin: '0.00',
        marginLevel: '0.00',
        totalPnL: '0.00',
        realizedPnL: '0.00',
        unrealizedPnL: '0.00',
        totalCommission: '0.00',
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: '0.00',
      });
      console.log(`  ✓ Created fresh ${mode} wallet at $10,000`);
    }
  }

  // ---- Step 4: Verify clean state ----
  console.log('\n=== Step 4: Verify clean state ===');
  const finalWallets = await db.select().from(paperWallets).where(eq(paperWallets.userId, USER_ID));
  console.log('Wallets after reset:');
  finalWallets.forEach((w) =>
    console.log(
      `  ${w.tradingMode}: balance=$${w.balance} equity=$${w.equity} totalPnL=$${w.totalPnL} trades=${w.totalTrades} winRate=${w.winRate}%`,
    ),
  );

  const finalOpen = await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.userId, USER_ID), eq(paperPositions.status, 'open')));
  console.log(`Open positions after reset: ${finalOpen.length}`);

  console.log('\n==========================================');
  console.log('✓ Phase 75 reset complete');
  console.log('  Next: restart pm2 to clear in-memory state');
  console.log('  Engine will resume trading from clean slate');
  console.log('==========================================');
  process.exit(0);
}

main().catch((e) => {
  console.error('Phase 75 reset FAILED:', e);
  process.exit(1);
});
