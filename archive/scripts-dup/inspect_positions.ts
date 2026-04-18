import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  const open = await db.execute(sql`
    SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnL, unrealizedPnLPercent, 
           stopLoss, takeProfit, originalConsensus, currentConfidence, peakConfidence,
           entryTime, updatedAt
    FROM paperPositions 
    WHERE status = 'open'
    ORDER BY id DESC
  `);
  
  const rows = (open as any)[0] || [];
  console.log('=== OPEN POSITIONS DETAIL ===');
  console.log(`Count: ${rows.length}`);
  for (const r of rows) {
    console.log(`\nID: ${r.id} | ${r.symbol} ${r.side}`);
    console.log(`  Entry: $${r.entryPrice} | Current: $${r.currentPrice}`);
    console.log(`  P&L: $${r.unrealizedPnL} (${r.unrealizedPnLPercent}%)`);
    console.log(`  SL: $${r.stopLoss} | TP: $${r.takeProfit}`);
    console.log(`  Consensus: entry=${r.originalConsensus} current=${r.currentConfidence} peak=${r.peakConfidence}`);
    console.log(`  EntryTime: ${r.entryTime} | Updated: ${r.updatedAt}`);
  }
  
  // Also check last 10 closed trades after fix
  const closed = await db.execute(sql`
    SELECT id, symbol, side, entryPrice, exitPrice, realizedPnl, exitReason, createdAt, updatedAt
    FROM paperPositions 
    WHERE status = 'closed' AND createdAt > '2026-03-09 20:00:00'
    ORDER BY updatedAt DESC
    LIMIT 10
  `);
  
  const closedRows = (closed as any)[0] || [];
  console.log('\n=== RECENTLY CLOSED TRADES ===');
  console.log(`Count: ${closedRows.length}`);
  for (const r of closedRows) {
    const pnl = parseFloat(r.realizedPnl || '0');
    const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '➖';
    console.log(`${emoji} ${r.id}: ${r.symbol} ${r.side} | Entry: $${r.entryPrice} | Exit: $${r.exitPrice} | P&L: $${pnl.toFixed(2)} | ${r.exitReason}`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
