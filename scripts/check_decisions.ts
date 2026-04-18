import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  const data = await db.execute(sql.raw(`
    SELECT symbol, decision, direction, 
           ROUND(consensusConfidence * 100, 1) as confPct, 
           SUBSTRING(rejectReason, 1, 100) as reason, 
           rejectStage, timestamp 
    FROM tradeDecisionLog 
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 MINUTE) 
    ORDER BY timestamp DESC LIMIT 30
  `));
  const rows = (data as any)[0] || [];
  console.log(`=== TRADE DECISIONS (last 30 min): ${rows.length} ===`);
  for (const r of rows) {
    console.log(`${r.timestamp} | ${r.symbol} ${r.direction} ${r.decision} | conf=${r.confPct}% | stage=${r.rejectStage || 'APPROVED'} | ${(r.reason || 'OK').substring(0, 80)}`);
  }
  
  // Also check open positions
  const posData = await db.execute(sql.raw(`
    SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnL, updatedAt
    FROM paperPositions WHERE status = 'open' ORDER BY id DESC LIMIT 10
  `));
  const positions = (posData as any)[0] || [];
  console.log(`\n=== OPEN POSITIONS: ${positions.length} ===`);
  for (const p of positions) {
    console.log(`#${p.id} ${p.symbol} ${p.side} | Entry: $${p.entryPrice} | Current: $${p.currentPrice} | PnL: $${p.unrealizedPnL} | Updated: ${p.updatedAt}`);
  }
  
  // Check consensus log for comparison
  const consData = await db.execute(sql.raw(`
    SELECT symbol, netDirection, ROUND(consensusConfidence * 100, 1) as confPct, 
           ROUND(threshold * 100, 0) as threshPct, meetsThreshold, timestamp
    FROM consensusLog 
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ORDER BY timestamp DESC LIMIT 10
  `));
  const consensus = (consData as any)[0] || [];
  console.log(`\n=== CONSENSUS LOG (last 10 min): ${consensus.length} ===`);
  for (const c of consensus) {
    console.log(`${c.timestamp} | ${c.symbol} ${c.netDirection} | conf=${c.confPct}% | threshold=${c.threshPct}% | meets=${c.meetsThreshold}`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
