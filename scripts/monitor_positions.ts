import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);

  // Check open positions
  const open = await db.execute(sql`
    SELECT id, symbol, direction, entryPrice, currentPrice, quantity,
           unrealizedPnl, stopLoss, takeProfit, entryTime, updatedAt,
           TIMESTAMPDIFF(SECOND, entryTime, NOW()) as ageSeconds
    FROM paperPositions 
    WHERE status = 'open'
    ORDER BY entryTime DESC
    LIMIT 10
  `);
  
  console.log('\n=== OPEN POSITIONS ===');
  for (const p of open[0] as any[]) {
    const pnl = Number(p.unrealizedPnl) || 0;
    const entry = Number(p.entryPrice);
    const current = Number(p.currentPrice);
    const pnlPct = entry > 0 ? ((current - entry) / entry * 100 * (p.direction === 'long' ? 1 : -1)).toFixed(4) : '?';
    const updated = p.updatedAt ? new Date(p.updatedAt).toISOString() : 'never';
    const age = p.ageSeconds || 0;
    console.log(`  #${p.id} ${p.symbol} ${p.direction} | Entry: $${entry.toFixed(2)} | Current: $${current.toFixed(2)} | PnL: $${pnl.toFixed(4)} (${pnlPct}%) | Age: ${age}s | Updated: ${updated}`);
  }
  
  // Check recently closed positions (last 10 minutes)
  const closed = await db.execute(sql`
    SELECT id, symbol, direction, entryPrice, exitPrice, quantity,
           realizedPnl, exitReason, entryTime, exitTime,
           TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds
    FROM paperPositions 
    WHERE status = 'closed' AND exitTime >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ORDER BY exitTime DESC
    LIMIT 20
  `);
  
  console.log('\n=== RECENTLY CLOSED (last 10 min) ===');
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const p of closed[0] as any[]) {
    const pnl = Number(p.realizedPnl) || 0;
    totalPnl += pnl;
    if (pnl > 0) wins++; else losses++;
    console.log(`  #${p.id} ${p.symbol} ${p.direction} | Entry: $${Number(p.entryPrice).toFixed(2)} → Exit: $${Number(p.exitPrice).toFixed(2)} | PnL: $${pnl.toFixed(4)} | Hold: ${p.holdSeconds}s | Reason: ${p.exitReason}`);
  }
  console.log(`\n  SUMMARY: ${wins}W/${losses}L | Total PnL: $${totalPnl.toFixed(4)}`);
  
  // Check overall P&L since the fix (after 22:30 UTC)
  const postFix = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN realizedPnl <= 0 THEN 1 ELSE 0 END) as losses,
      SUM(realizedPnl) as totalPnl,
      AVG(realizedPnl) as avgPnl,
      AVG(TIMESTAMPDIFF(SECOND, entryTime, exitTime)) as avgHoldSec
    FROM paperPositions 
    WHERE status = 'closed' AND entryTime >= '2026-03-09 22:30:00'
  `);
  
  console.log('\n=== POST-FIX PERFORMANCE (since 22:30 UTC) ===');
  const pf = (postFix[0] as any[])[0];
  console.log(`  Trades: ${pf.total} | Wins: ${pf.wins} | Losses: ${pf.losses} | Win Rate: ${pf.total > 0 ? ((pf.wins/pf.total)*100).toFixed(1) : 0}%`);
  console.log(`  Total PnL: $${Number(pf.totalPnl || 0).toFixed(4)} | Avg PnL: $${Number(pf.avgPnl || 0).toFixed(4)} | Avg Hold: ${Number(pf.avgHoldSec || 0).toFixed(0)}s`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
