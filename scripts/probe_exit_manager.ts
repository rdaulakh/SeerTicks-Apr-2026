/**
 * Probe the exit manager state by checking the diagnostic file
 * and querying the DB for position update timestamps
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check open positions with their update times
  const positions = await db.execute(sql.raw(`
    SELECT id, symbol, side, entryPrice, currentPrice, 
           unrealizedPnL, unrealizedPnLPercent,
           entryTime, updatedAt,
           TIMESTAMPDIFF(SECOND, updatedAt, NOW()) as secondsSinceUpdate,
           status
    FROM paperPositions 
    WHERE status = 'open'
    ORDER BY entryTime DESC LIMIT 10
  `));
  const rows = (positions as any)[0] || [];
  console.log(`=== OPEN POSITIONS: ${rows.length} ===`);
  for (const r of rows) {
    const stale = r.secondsSinceUpdate > 10 ? '⚠️ STALE' : '✅ LIVE';
    console.log(`${stale} #${r.id} ${r.symbol} ${r.side} | Entry: $${Number(r.entryPrice).toFixed(2)} | Current: $${Number(r.currentPrice).toFixed(2)} | PnL: $${Number(r.unrealizedPnL).toFixed(4)} (${Number(r.unrealizedPnLPercent).toFixed(2)}%) | Updated: ${r.updatedAt} (${r.secondsSinceUpdate}s ago)`);
  }
  
  // Check recently closed positions
  const closed = await db.execute(sql.raw(`
    SELECT id, symbol, side, entryPrice, exitPrice, realizedPnL, exitReason, 
           entryTime, exitTime,
           TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds
    FROM paperPositions 
    WHERE status = 'closed' AND exitTime > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY exitTime DESC LIMIT 20
  `));
  const closedRows = (closed as any)[0] || [];
  console.log(`\n=== RECENTLY CLOSED (last 30 min): ${closedRows.length} ===`);
  let totalPnL = 0;
  let wins = 0;
  for (const r of closedRows) {
    const pnl = Number(r.realizedPnL);
    totalPnL += pnl;
    if (pnl > 0) wins++;
    const icon = pnl > 0 ? '✅' : '❌';
    console.log(`${icon} #${r.id} ${r.symbol} ${r.side} | Entry: $${Number(r.entryPrice).toFixed(2)} → Exit: $${Number(r.exitPrice).toFixed(2)} | PnL: $${pnl.toFixed(4)} | Hold: ${r.holdSeconds}s | Reason: ${r.exitReason}`);
  }
  if (closedRows.length > 0) {
    console.log(`\nSummary: ${closedRows.length} trades, ${wins} wins (${(wins/closedRows.length*100).toFixed(1)}%), Total PnL: $${totalPnL.toFixed(4)}`);
  }
  
  // Check if price feed is working by looking at recent price data
  const prices = await db.execute(sql.raw(`
    SELECT symbol, MAX(updatedAt) as lastUpdate, 
           TIMESTAMPDIFF(SECOND, MAX(updatedAt), NOW()) as secondsSinceUpdate
    FROM paperPositions 
    WHERE status = 'open'
    GROUP BY symbol
  `));
  const priceRows = (prices as any)[0] || [];
  console.log(`\n=== PRICE FEED STATUS ===`);
  for (const r of priceRows) {
    const status = r.secondsSinceUpdate > 30 ? '❌ DEAD' : '✅ LIVE';
    console.log(`${status} ${r.symbol}: Last update ${r.secondsSinceUpdate}s ago`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
