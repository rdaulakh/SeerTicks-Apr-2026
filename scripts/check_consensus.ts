import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Find consensus-related tables
  const tables = await db.execute(sql`SHOW TABLES LIKE '%consensus%'`);
  const tableRows = (tables as any)[0] || [];
  console.log('Consensus tables:', tableRows.map((r: any) => Object.values(r)[0]));
  
  // Try consensus_snapshots
  try {
    const snapshots = await db.execute(sql`
      SELECT * FROM consensus_snapshots 
      WHERE createdAt > '2026-03-09 21:00:00'
      ORDER BY createdAt DESC LIMIT 20
    `);
    const rows = (snapshots as any)[0] || [];
    console.log(`\n=== CONSENSUS SNAPSHOTS (${rows.length}) ===`);
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
  } catch (e) {
    console.log('consensus_snapshots error:', (e as Error).message);
  }
  
  // Try consensusSnapshots
  try {
    const snapshots = await db.execute(sql`
      SELECT * FROM consensusSnapshots 
      WHERE createdAt > '2026-03-09 21:00:00'
      ORDER BY createdAt DESC LIMIT 20
    `);
    const rows = (snapshots as any)[0] || [];
    console.log(`\n=== consensusSnapshots (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.netDirection} | Conf: ${r.consensusConfidence} | Threshold: ${r.threshold} | Meets: ${r.meetsThreshold} | B:${r.bullishCount} Be:${r.bearishCount} N:${r.neutralCount}`);
    }
  } catch (e) {
    console.log('consensusSnapshots error:', (e as Error).message);
  }
  
  // Check agent signals table for recent data
  try {
    const signals = await db.execute(sql`
      SELECT agentName, symbol, signal, confidence, createdAt
      FROM agentSignals 
      WHERE createdAt > '2026-03-09 21:10:00'
      ORDER BY createdAt DESC LIMIT 30
    `);
    const rows = (signals as any)[0] || [];
    console.log(`\n=== RECENT AGENT SIGNALS (${rows.length}) ===`);
    const bySymbol: Record<string, any[]> = {};
    for (const r of rows) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
      bySymbol[r.symbol].push(r);
    }
    for (const [sym, sigs] of Object.entries(bySymbol)) {
      const bullish = sigs.filter(s => s.signal === 'bullish');
      const bearish = sigs.filter(s => s.signal === 'bearish');
      const neutral = sigs.filter(s => s.signal === 'neutral');
      const avgConf = sigs.reduce((sum, s) => sum + parseFloat(s.confidence || '0'), 0) / sigs.length;
      console.log(`  ${sym}: ${bullish.length}B/${bearish.length}Be/${neutral.length}N | Avg conf: ${(avgConf * 100).toFixed(1)}%`);
      for (const s of sigs.slice(0, 5)) {
        console.log(`    ${s.agentName}: ${s.signal} (${(parseFloat(s.confidence) * 100).toFixed(1)}%)`);
      }
    }
  } catch (e) {
    console.log('agentSignals error:', (e as Error).message);
  }
  
  // Check trade decisions
  try {
    const decisions = await db.execute(sql`
      SELECT * FROM tradeDecisionLog
      WHERE createdAt > '2026-03-09 21:00:00'
      ORDER BY createdAt DESC LIMIT 20
    `);
    const rows = (decisions as any)[0] || [];
    console.log(`\n=== TRADE DECISIONS (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.direction} ${r.decision} | Consensus: ${r.consensusConfidence} | Reason: ${r.rejectReason || r.rejectStage || 'APPROVED'}`);
    }
  } catch (e) {
    console.log('tradeDecisionLog error:', (e as Error).message);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
