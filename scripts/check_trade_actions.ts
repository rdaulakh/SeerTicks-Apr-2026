import { drizzle } from 'drizzle-orm/mysql2';
import { desc, sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get recent trade decisions with action details
  const decisions = await db.execute(sql`
    SELECT id, symbol, action, consensusDirection, consensusConfidence, status, reason, createdAt
    FROM tradeDecisionLog 
    WHERE createdAt > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  
  console.log('=== RECENT TRADE DECISIONS ===');
  for (const d of (decisions as any)[0]) {
    console.log(`  ${d.createdAt} | ${d.symbol} | action=${d.action} | dir=${d.consensusDirection} | conf=${d.consensusConfidence} | status=${d.status} | ${d.reason || ''}`);
  }
  
  // Get recent positions with side details
  const positions = await db.execute(sql`
    SELECT id, symbol, side, entryPrice, currentPrice, status, exitReason, entryTime, exitTime
    FROM paperPositions 
    WHERE entryTime > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY entryTime DESC
    LIMIT 20
  `);
  
  console.log('\n=== RECENT POSITIONS ===');
  for (const p of (positions as any)[0]) {
    console.log(`  #${p.id} | ${p.symbol} ${p.side} | entry=$${p.entryPrice} | current=$${p.currentPrice} | ${p.status} | ${p.exitReason || 'open'} | ${p.entryTime}`);
  }

  process.exit(0);
}

main().catch(console.error);
