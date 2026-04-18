/**
 * Phase 40: Monitor post-fix trade performance (v2)
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check for new trades after the fix
  const newTrades = await db.execute(sql`
    SELECT id, symbol, side, status, entryPrice, currentPrice, exitPrice, exitReason, realizedPnl, createdAt, updatedAt
    FROM paperPositions 
    WHERE createdAt > '2026-03-09 20:51:00'
    ORDER BY createdAt DESC
    LIMIT 30
  `);
  
  const rows = (newTrades as any)[0] || [];
  console.log(`\n=== NEW TRADES AFTER FIX (after 20:51 UTC) ===`);
  console.log(`Total new trades: ${rows.length}`);
  
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  
  for (const row of rows) {
    const ep = parseFloat(row.entryPrice || '0');
    const cp = parseFloat(row.currentPrice || row.exitPrice || row.entryPrice || '0');
    const exitP = parseFloat(row.exitPrice || '0');
    const priceForPnl = exitP > 0 ? exitP : cp;
    let pnl = 0;
    if (ep > 0) {
      pnl = row.side === 'long' ? ((priceForPnl - ep) / ep) * 100 : ((ep - priceForPnl) / ep) * 100;
    }
    const realizedPnl = parseFloat(row.realizedPnl || '0');
    if (row.status === 'closed') {
      totalPnl += realizedPnl;
      if (realizedPnl > 0) wins++;
      else losses++;
    }
    console.log(`  ${row.id}: ${row.symbol} ${row.side} ${row.status} | Entry: $${ep.toFixed(2)} | Price: $${priceForPnl.toFixed(2)} | P&L: ${pnl.toFixed(3)}% ($${realizedPnl.toFixed(2)}) | ${row.exitReason || 'OPEN'}`);
  }
  
  if (rows.length > 0) {
    console.log(`\n  Summary: ${wins} wins / ${losses} losses | Total P&L: $${totalPnl.toFixed(2)}`);
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
  
  // Check signal log for rejections
  try {
    const signalLogs = await db.execute(sql`
      SELECT id, symbol, action, confidence, metadata, createdAt
      FROM signalLog
      WHERE createdAt > '2026-03-09 20:51:00'
      ORDER BY createdAt DESC
      LIMIT 20
    `);
    const logRows = (signalLogs as any)[0] || [];
    console.log(`\n=== RECENT SIGNAL LOG ===`);
    console.log(`Signals logged: ${logRows.length}`);
    for (const row of logRows) {
      console.log(`  ${row.symbol} ${row.action} | Conf: ${(parseFloat(row.confidence || '0') * 100).toFixed(1)}% | ${new Date(row.createdAt).toISOString()}`);
    }
  } catch (e) {
    console.log('\n(Signal log table not available)');
  }
  
  // Check audit log for trade decisions
  try {
    const auditLogs = await db.execute(sql`
      SELECT id, eventType, symbol, details, createdAt
      FROM auditLog
      WHERE createdAt > '2026-03-09 20:51:00' AND eventType LIKE '%trade%'
      ORDER BY createdAt DESC
      LIMIT 20
    `);
    const auditRows = (auditLogs as any)[0] || [];
    console.log(`\n=== AUDIT LOG (trade events) ===`);
    console.log(`Trade events: ${auditRows.length}`);
    for (const row of auditRows) {
      const details = typeof row.details === 'string' ? row.details.substring(0, 120) : JSON.stringify(row.details).substring(0, 120);
      console.log(`  ${row.eventType} ${row.symbol} | ${details}`);
    }
  } catch (e) {
    console.log('\n(Audit log table not available)');
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
