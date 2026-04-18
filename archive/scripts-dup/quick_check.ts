import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Open positions
  const [open] = await db.execute(sql`SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnl, entryTime, updatedAt FROM paperPositions WHERE status = 'open' ORDER BY entryTime DESC LIMIT 5`);
  console.log('\n=== OPEN POSITIONS ===');
  for (const p of open as any[]) {
    const age = Math.round((Date.now() - new Date(p.entryTime).getTime()) / 1000);
    const sinceUpdate = Math.round((Date.now() - new Date(p.updatedAt).getTime()) / 1000);
    console.log(`  #${p.id} ${p.symbol} ${p.side} | Entry: $${Number(p.entryPrice).toFixed(2)} | Current: $${Number(p.currentPrice).toFixed(2)} | PnL: $${Number(p.unrealizedPnl || 0).toFixed(4)} | Age: ${age}s | Last update: ${sinceUpdate}s ago`);
  }
  
  // Recently closed since restart
  const [closed] = await db.execute(sql`SELECT id, symbol, side, entryPrice, exitPrice, realizedPnl, exitReason, entryTime, exitTime FROM paperPositions WHERE status = 'closed' AND entryTime >= '2026-03-09 22:48:00' ORDER BY exitTime DESC LIMIT 10`);
  console.log('\n=== CLOSED SINCE RESTART ===');
  let totalPnl = 0;
  for (const p of closed as any[]) {
    const pnl = Number(p.realizedPnl || 0);
    totalPnl += pnl;
    const hold = Math.round((new Date(p.exitTime).getTime() - new Date(p.entryTime).getTime()) / 1000);
    console.log(`  #${p.id} ${p.symbol} ${p.side} | $${Number(p.entryPrice).toFixed(2)} → $${Number(p.exitPrice).toFixed(2)} | PnL: $${pnl.toFixed(4)} | Hold: ${hold}s | ${p.exitReason}`);
  }
  console.log(`\n  Total PnL since restart: $${totalPnl.toFixed(4)}`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
