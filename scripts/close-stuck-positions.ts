/**
 * Admin tool to force-close stuck paperPositions where in-memory exit manager
 * fires but DB persistence never lands (engine.closePositionById silently
 * fails / position not in memory). Sets status='closed', booked the unrealized
 * PnL as realized at current price, exitTime=NOW, exitReason as supplied.
 *
 * Usage:
 *   npx tsx scripts/close-stuck-positions.ts <positionId> [<positionId> ...]
 *
 * Reason defaults to 'admin_force_close_stuck'. Pass --reason=<text> to override.
 *
 * IMPORTANT: This skips the trading engine entirely. Only safe to use when
 * the position has already been verified as gone from the actual exchange
 * (e.g. paper trading, or a real exchange where the close already happened).
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import { paperPositions } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const args = process.argv.slice(2);
  let reason = 'admin_force_close_stuck';
  const ids: number[] = [];
  for (const a of args) {
    if (a.startsWith('--reason=')) reason = a.slice('--reason='.length);
    else if (/^\d+$/.test(a)) ids.push(Number(a));
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  if (ids.length === 0) {
    console.error('Usage: tsx scripts/close-stuck-positions.ts <id> [<id> ...] [--reason=text]');
    process.exit(1);
  }

  const db = await getDb();
  if (!db) { console.error('DB unavailable'); process.exit(1); }

  for (const id of ids) {
    const rows = await db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.id, id), eq(paperPositions.status, 'open')))
      .limit(1);
    if (rows.length === 0) {
      console.log(`[${id}] not found or already closed — skipping`);
      continue;
    }
    const p = rows[0];
    const exitPrice = Number(p.currentPrice);
    const realized = Number(p.unrealizedPnL || 0);
    await db.update(paperPositions)
      .set({
        status: 'closed',
        exitPrice: exitPrice.toString(),
        exitTime: new Date(),
        exitReason: reason,
        realizedPnl: realized.toString(),
      })
      .where(eq(paperPositions.id, id));
    console.log(`[${id}] closed: ${p.symbol} ${p.side} @ $${exitPrice} | realized=$${realized.toFixed(2)} | reason=${reason}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
