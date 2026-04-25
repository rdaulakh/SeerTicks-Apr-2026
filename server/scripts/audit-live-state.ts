/**
 * Phase 20 — live state audit. Now that trades are firing (post-Phase 19),
 * we need a fast read on whether the EXIT side is actually closing
 * profitably or if positions are stuck open / closing at losses.
 *
 * Reports:
 *   - All open positions: symbol, side, entry, current, unrealized PnL
 *   - Closed positions in last hour: realized PnL, hold time, exit reason
 *   - Aggregate: win rate, avg PnL, total realized, longest open
 *   - Top exit reasons over last hour (which gate is firing)
 */

import 'dotenv/config';
import { getDb } from '../db';
import { paperPositions, tradingPipelineLog } from '../../drizzle/schema';
import { sql, gte, eq, desc, and } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('[audit] no db');
    process.exit(1);
  }
  // Optional --since=ISO override; default 1 hour back.
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const since = sinceArg
    ? new Date(sinceArg.split('=')[1])
    : new Date(Date.now() - 60 * 60_000);
  console.log(`[audit] window: since=${since.toISOString()}`);

  // Open positions snapshot
  const open = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, 'open'))
    .orderBy(desc(paperPositions.entryTime));

  console.log(`\n== OPEN POSITIONS (${open.length}) ==`);
  for (const p of open) {
    const entry = parseFloat(p.entryPrice as any) || 0;
    const current = parseFloat(p.currentPrice as any) || 0;
    const upnl = parseFloat(p.unrealizedPnL as any) || 0;
    const upnlPct = parseFloat(p.unrealizedPnLPercent as any) || 0;
    const minutesHeld = p.entryTime
      ? Math.round((Date.now() - new Date(p.entryTime as any).getTime()) / 60_000)
      : 0;
    console.log(
      `  #${p.id} ${p.symbol} ${p.side} entry=$${entry.toFixed(2)} current=$${current.toFixed(2)} ` +
        `pnl=$${upnl.toFixed(2)} (${upnlPct.toFixed(2)}%) held=${minutesHeld}m`,
    );
  }

  // Closed positions in last hour
  const closed = await db
    .select()
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.status, 'closed'),
        gte(paperPositions.exitTime, since),
      ),
    )
    .orderBy(desc(paperPositions.exitTime))
    .limit(50);

  console.log(`\n== CLOSED IN LAST HOUR (${closed.length}) ==`);
  let wins = 0,
    losses = 0,
    totalRealized = 0;
  for (const p of closed) {
    const realized = parseFloat(p.realizedPnl as any) || 0;
    if (realized > 0) wins++;
    else if (realized < 0) losses++;
    totalRealized += realized;
    const heldMs =
      p.entryTime && p.exitTime
        ? new Date(p.exitTime as any).getTime() - new Date(p.entryTime as any).getTime()
        : 0;
    console.log(
      `  #${p.id} ${p.symbol} ${p.side} pnl=$${realized.toFixed(2)} ` +
        `held=${Math.round(heldMs / 60_000)}m reason="${p.exitReason ?? '?'}"`,
    );
  }

  if (closed.length > 0) {
    console.log(
      `\n  AGGREGATE: ${wins}W / ${losses}L = ${((wins / closed.length) * 100).toFixed(1)}% wins ` +
        `| total realized: $${totalRealized.toFixed(2)} ` +
        `| avg per trade: $${(totalRealized / closed.length).toFixed(2)}`,
    );
  } else {
    console.log('\n  (no closes yet)');
  }

  // Top pipeline rejections / events in last hour
  const events = await db
    .select({
      eventType: tradingPipelineLog.eventType,
      count: sql<number>`count(*)`,
    })
    .from(tradingPipelineLog)
    .where(gte(tradingPipelineLog.timestamp, since))
    .groupBy(tradingPipelineLog.eventType)
    .orderBy(desc(sql`count(*)`));

  console.log(`\n== PIPELINE EVENTS LAST HOUR ==`);
  for (const e of events) {
    console.log(`  ${String(e.eventType).padEnd(24)}  ${e.count}`);
  }

  // Top rejection reasons
  const reasons = await db
    .select({
      reason: tradingPipelineLog.reason,
      count: sql<number>`count(*)`,
    })
    .from(tradingPipelineLog)
    .where(
      and(
        gte(tradingPipelineLog.timestamp, since),
        sql`${tradingPipelineLog.eventType} IN ('SIGNAL_REJECTED', 'TRADE_REJECTED')`,
      ),
    )
    .groupBy(tradingPipelineLog.reason)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  console.log(`\n== TOP 10 REJECTION REASONS LAST HOUR ==`);
  for (const r of reasons) {
    const reason = String(r.reason ?? '').slice(0, 80);
    console.log(`  ${String(r.count).padStart(5)}  ${reason}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
