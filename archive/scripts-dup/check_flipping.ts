import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check recently closed positions
  const closed = await db.execute(sql.raw(`
    SELECT id, symbol, side, entryPrice, exitPrice, realizedPnL, exitReason, 
           entryTime, exitTime,
           TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds
    FROM paperPositions 
    WHERE status = 'closed' AND exitTime > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ORDER BY exitTime DESC LIMIT 30
  `));
  const closedRows = (closed as any)[0] || [];
  console.log(`=== RECENTLY CLOSED (last 10 min): ${closedRows.length} ===`);
  for (const r of closedRows) {
    console.log(`#${r.id} ${r.symbol} ${r.side} | Entry: $${Number(r.entryPrice).toFixed(2)} → Exit: $${Number(r.exitPrice).toFixed(2)} | PnL: $${Number(r.realizedPnL).toFixed(4)} | Hold: ${r.holdSeconds}s | Reason: ${r.exitReason}`);
  }
  
  // Summary
  const totalPnL = closedRows.reduce((sum: number, r: any) => sum + Number(r.realizedPnL || 0), 0);
  const wins = closedRows.filter((r: any) => Number(r.realizedPnL) > 0).length;
  console.log(`\nSummary: ${closedRows.length} trades, ${wins} wins, PnL: $${totalPnL.toFixed(4)}`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
