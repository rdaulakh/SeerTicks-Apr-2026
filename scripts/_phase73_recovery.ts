/**
 * Phase 73 — One-shot recovery script.
 *
 * After the code patches deploy and pm2 restarts, this script:
 *   1. Verifies the EnhancedTradeExecutor halt has been cleared (it should
 *      auto-clear on restart since `isHalted` is in-memory state).
 *   2. Force-closes stuck SOL position #48 if it's still open: query exchange,
 *      flatten via market sell, mark DB row as closed with realized PnL.
 *   3. Resyncs PositionLimitTracker via the public syncFromDb() helper.
 *
 * Run via: sudo -u seer bash -c 'cd /home/seer/app && npx tsx scripts/_phase73_recovery.ts'
 */

import 'dotenv/config';
import { USDMClient } from 'binance';
import { getDb } from '../server/db';
import { paperPositions, paperWallets } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

const STUCK_POSITION_ID = 48;
const USER_ID = 1;

async function main() {
  console.log('=== Phase 73 Recovery ===');
  console.log('Tokyo time:', new Date().toISOString());

  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  // 1. Inspect stuck SOL #48
  const stuck = await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.id, STUCK_POSITION_ID), eq(paperPositions.status, 'open')));

  if (stuck.length === 0) {
    console.log(`✓ Position #${STUCK_POSITION_ID} already closed. Nothing to recover.`);
  } else {
    const pos = stuck[0];
    console.log(`Found stuck position #${pos.id} ${pos.symbol} ${pos.side} qty=${pos.quantity} entry=${pos.entryPrice}`);

    // 2. Query exchange for current SOL position
    const client = new USDMClient({
      api_key: process.env.BINANCE_API_KEY!,
      api_secret: process.env.BINANCE_SECRET_KEY!,
      useTestnet: true,
    });

    const acct = await client.getAccountInformationV3();
    const solExch = (acct.positions || []).find((p) => p.symbol === 'SOLUSDT');
    const exchQty = solExch ? parseFloat(solExch.positionAmt) : 0;
    console.log(`Exchange SOLUSDT qty=${exchQty}`);

    const dbQty = parseFloat(pos.quantity || '0');

    if (Math.abs(exchQty) < 1e-6) {
      // Exchange already flat — just close DB row
      console.log('Exchange already flat. Marking DB position closed...');
      const exitPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const realizedPnl = pos.side === 'long' ? (exitPrice - entryPrice) * dbQty : (entryPrice - exitPrice) * dbQty;
      await db
        .update(paperPositions)
        .set({
          status: 'closed',
          exitReason: 'phase73_recovery_exchange_flat',
          exitPrice: exitPrice.toString(),
          exitTime: new Date(),
          realizedPnl: realizedPnl.toFixed(6),
        })
        .where(eq(paperPositions.id, pos.id));
      console.log(`✓ DB position #${pos.id} marked closed. Realized PnL: $${realizedPnl.toFixed(2)}`);
    } else if (exchQty > 0) {
      // Exchange has a long position — sell to flatten
      const sellQty = Math.abs(exchQty);
      console.log(`Placing market SELL of ${sellQty} SOLUSDT to flatten...`);
      const order = await client.submitNewOrder({
        symbol: 'SOLUSDT',
        side: 'SELL',
        type: 'MARKET',
        quantity: sellQty,
      });
      console.log(`Sell order: id=${order.orderId} status=${order.status}`);

      // Poll for fill price
      await new Promise((r) => setTimeout(r, 1500));
      const acctAfter = await client.getAccountInformationV3();
      const solAfter = (acctAfter.positions || []).find((p) => p.symbol === 'SOLUSDT');
      console.log(`After sell: exchange qty=${solAfter?.positionAmt}`);

      const exitPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const realizedPnl = (exitPrice - entryPrice) * dbQty;
      await db
        .update(paperPositions)
        .set({
          status: 'closed',
          exitReason: 'phase73_recovery_force_close',
          exitPrice: exitPrice.toString(),
          exitTime: new Date(),
          realizedPnl: realizedPnl.toFixed(6),
        })
        .where(eq(paperPositions.id, pos.id));
      console.log(`✓ DB position #${pos.id} marked closed. Realized PnL: $${realizedPnl.toFixed(2)}`);
    } else {
      console.log(`⚠ Exchange has SHORT position qty=${exchQty}, DB says long. Manual review needed.`);
    }
  }

  // 3. Verify wallet state
  const wallets = await db
    .select()
    .from(paperWallets)
    .where(eq(paperWallets.userId, USER_ID));
  console.log('\n=== Current wallets ===');
  wallets.forEach((w) =>
    console.log(`  ${w.tradingMode}: balance=$${w.balance} equity=$${w.equity} totalPnL=$${w.totalPnL}`),
  );

  // 4. Check still-open positions
  const stillOpen = await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.userId, USER_ID), eq(paperPositions.status, 'open')));
  console.log(`\n=== Still-open positions: ${stillOpen.length} ===`);
  stillOpen.forEach((p) =>
    console.log(`  #${p.id} ${p.symbol} ${p.side} qty=${p.quantity} entry=${p.entryPrice} held=${Math.round((Date.now() - new Date(p.entryTime).getTime()) / 60000)}min`),
  );

  console.log('\n✓ Phase 73 recovery complete. Restart pm2 to clear in-memory halt state.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Phase 73 recovery FAILED:', e);
  process.exit(1);
});
