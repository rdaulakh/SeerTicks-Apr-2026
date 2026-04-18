/**
 * Phase 40: Monitor post-fix trade performance
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check for new trades after the fix (after 20:51 UTC on March 9)
  const newTrades = await db.execute(sql`
    SELECT id, symbol, side, status, entryPrice, currentPrice, exitPrice, exitReason, realizedPnl, createdAt, updatedAt
    FROM paperPositions 
    WHERE createdAt > '2026-03-09 20:51:00'
    ORDER BY createdAt DESC
    LIMIT 30
  `);
  
  console.log(`\n=== NEW TRADES AFTER FIX (after 20:51 UTC) ===`);
  console.log(`Total new trades: ${(newTrades as any)[0]?.length || 0}`);
  
  const rows = (newTrades as any)[0] || [];
  for (const row of rows) {
    const ep = parseFloat(row.entryPrice || '0');
    const cp = parseFloat(row.currentPrice || row.exitPrice || row.entryPrice || '0');
    let pnl = 0;
    if (ep > 0) {
      pnl = row.side === 'long' ? ((cp - ep) / ep) * 100 : ((ep - cp) / ep) * 100;
    }
    console.log(`  ${row.id}: ${row.symbol} ${row.side} ${row.status} | Entry: $${ep.toFixed(2)} | Current: $${cp.toFixed(2)} | P&L: ${pnl.toFixed(3)}% | ${row.exitReason || 'OPEN'}`);
  }
  
  // Check open positions
  const openPositions = await db.execute(sql`
    SELECT id, symbol, side, entryPrice, currentPrice, createdAt
    FROM paperPositions 
    WHERE status = 'open'
    ORDER BY createdAt DESC
  `);
  
  const openRows = (openPositions as any)[0] || [];
  console.log(`\n=== CURRENTLY OPEN POSITIONS ===`);
  console.log(`Open positions: ${openRows.length}`);
  for (const row of openRows) {
    const ep = parseFloat(row.entryPrice || '0');
    const cp = parseFloat(row.currentPrice || row.entryPrice || '0');
    let pnl = 0;
    if (ep > 0) {
      pnl = row.side === 'long' ? ((cp - ep) / ep) * 100 : ((ep - cp) / ep) * 100;
    }
    console.log(`  ${row.id}: ${row.symbol} ${row.side} | Entry: $${ep.toFixed(2)} | Current: $${cp.toFixed(2)} | P&L: ${pnl.toFixed(3)}%`);
  }
  
  // Check recent signal rejections from trade decisions log
  const recentDecisions = await db.execute(sql`
    SELECT id, symbol, direction, decision, rejectReason, rejectStage, consensusConfidence, createdAt
    FROM tradeDecisions
    WHERE createdAt > '2026-03-09 20:51:00'
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  
  const decisionRows = (recentDecisions as any)[0] || [];
  console.log(`\n=== RECENT TRADE DECISIONS (after fix) ===`);
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const row of decisionRows) {
    if (row.decision === 'executed') approvedCount++;
    else rejectedCount++;
    const conf = parseFloat(row.consensusConfidence || '0');
    console.log(`  ${row.symbol} ${row.direction} ${row.decision} | Consensus: ${(conf * 100).toFixed(1)}% | ${row.rejectReason || row.rejectStage || 'APPROVED'}`);
  }
  console.log(`\nApproved: ${approvedCount} | Rejected: ${rejectedCount}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
