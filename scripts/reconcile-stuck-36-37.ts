/**
 * One-shot reconciliation for positions 36 (ETH) and 37 (SOL).
 *
 * Both were opened pre-restart, hydrated into the engine map under the wrong
 * key (Phase 55.3 bug: keyed by id instead of `${symbol}_${exchange}`). When
 * IEM later fired exit:
 *   - closePositionById found them by .id and placed a real testnet sell
 *   - the order filled on Binance testnet
 *   - closePosition couldn't find them under the symbol_exchange key
 *   - fell out with "No position found for symbol", DB row stayed status=open
 *   - closePositionById didn't throw → IEM thought exit succeeded → removed
 *     from monitoring → row hung "open" for 14h+ even though exchange was flat
 *
 * pm2 logs of record:
 *   pos 37 SOL: 2026-05-06T20:01:37.774Z  filledPrice=89.32  qty=4.306  pnl=+1.28
 *   pos 36 ETH: 2026-05-06T21:44:02.076Z  filledPrice=2357.29  qty=0.1626  pnl=+1.29
 *
 * This script:
 *   1. Marks paperPositions rows 36 and 37 as status='closed' at the actual fill
 *      prices/times from the exchange logs.
 *   2. Inserts paperTrades exit rows so the audit trail is complete.
 *   3. Does NOT touch the wallet — engine re-syncs wallet from Binance testnet
 *      on next restart (BINANCE_USE_TESTNET=1 path in initializeWallet).
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

interface ReconcileEntry {
  positionId: number;
  symbol: string;
  exitTime: Date;
  exitPrice: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  exchangeOrderId: string;
}

const RECONCILE: ReconcileEntry[] = [
  {
    positionId: 37,
    symbol: 'SOL-USD',
    exitTime: new Date('2026-05-06T20:01:37.774Z'),
    exitPrice: 89.32,
    realizedPnl: 1.28,
    realizedPnlPercent: 0.50,
    exchangeOrderId: '5708',
  },
  {
    positionId: 36,
    symbol: 'ETH-USD',
    exitTime: new Date('2026-05-06T21:44:02.076Z'),
    exitPrice: 2357.29,
    realizedPnl: 1.29,
    realizedPnlPercent: 0.50,
    exchangeOrderId: '43022',
  },
];

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('DB unavailable');
    process.exit(1);
  }

  for (const r of RECONCILE) {
    const rows = await db
      .select()
      .from(schema.paperPositions)
      .where(eq(schema.paperPositions.id, r.positionId))
      .limit(1);
    if (rows.length === 0) {
      console.warn(`position ${r.positionId} not found — skipping`);
      continue;
    }
    const pos = rows[0];
    if (pos.status !== 'open') {
      console.warn(`position ${r.positionId} already ${pos.status} — skipping`);
      continue;
    }

    await db
      .update(schema.paperPositions)
      .set({
        status: 'closed',
        currentPrice: r.exitPrice.toString(),
        exitTime: r.exitTime,
        exitPrice: r.exitPrice.toString(),
        realizedPnl: r.realizedPnl.toString(),
        exitReason: 'reconcile_phase_55_3:engine_desync',
        unrealizedPnL: '0',
        unrealizedPnLPercent: '0',
      } as any)
      .where(eq(schema.paperPositions.id, r.positionId));

    await db.insert(schema.paperTrades).values({
      userId: pos.userId,
      tradingMode: 'live',
      orderId: `reconcile_phase_55_3_${r.exchangeOrderId}`,
      symbol: pos.symbol,
      side: 'sell',
      price: r.exitPrice.toString(),
      quantity: pos.quantity,
      pnl: r.realizedPnl.toString(),
      commission: '0.38',
      strategy: 'reconcile_phase_55_3',
    } as any);

    console.log(
      `✓ position ${r.positionId} ${r.symbol}: ` +
      `closed @ $${r.exitPrice} (${r.exitTime.toISOString()}), ` +
      `realized pnl $${r.realizedPnl.toFixed(2)} (${r.realizedPnlPercent.toFixed(2)}%)`
    );
  }

  console.log('\nReconciliation complete. Restart pm2 next:');
  console.log('  pm2 restart seerticks --update-env');
  console.log('Engine will re-sync wallet from Binance testnet on init.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
