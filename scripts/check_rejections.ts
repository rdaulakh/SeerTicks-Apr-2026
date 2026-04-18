import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check recent consensus log entries (last 5 minutes)
  try {
    const data = await db.execute(sql.raw(`
      SELECT symbol, netDirection, consensusConfidence, threshold, meetsThreshold, 
             bullishCount, bearishCount, neutralCount, timestamp
      FROM consensusLog 
      ORDER BY id DESC LIMIT 30
    `));
    const rows = (data as any)[0] || [];
    console.log(`=== CONSENSUS LOG (last ${rows.length}) ===`);
    
    // Group by symbol
    const bySymbol: Record<string, any[]> = {};
    for (const r of rows) {
      const sym = r.symbol || 'unknown';
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(r);
    }
    
    for (const [sym, entries] of Object.entries(bySymbol)) {
      const meets = entries.filter((e: any) => e.meetsThreshold === 1);
      const avgConf = entries.reduce((sum: number, e: any) => sum + parseFloat(e.consensusConfidence || '0'), 0) / entries.length;
      console.log(`\n  ${sym}: ${meets.length}/${entries.length} meet threshold | Avg conf: ${(avgConf * 100).toFixed(1)}%`);
      for (const e of entries.slice(0, 5)) {
        console.log(`    ${e.netDirection} | Conf: ${(parseFloat(e.consensusConfidence) * 100).toFixed(1)}% | Threshold: ${(parseFloat(e.threshold) * 100).toFixed(0)}% | Meets: ${e.meetsThreshold} | B:${e.bullishCount} Be:${e.bearishCount} N:${e.neutralCount}`);
      }
    }
  } catch (e) {
    console.log('consensusLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check recent trade decisions (rejections)
  try {
    const data = await db.execute(sql.raw(`
      SELECT symbol, decision, direction, consensusConfidence, rejectReason, rejectStage, timestamp
      FROM tradeDecisionLog 
      WHERE timestamp > '2026-03-09 21:36:00'
      ORDER BY id DESC LIMIT 20
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== TRADE DECISIONS AFTER RESTART (${rows.length}) ===`);
    for (const r of rows) {
      const conf = parseFloat(r.consensusConfidence || '0');
      console.log(`  ${r.symbol} ${r.direction} ${r.decision} | Conf: ${(conf * 100).toFixed(1)}% | Stage: ${r.rejectStage || 'APPROVED'} | Reason: ${r.rejectReason || 'OK'}`);
    }
  } catch (e) {
    console.log('tradeDecisionLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check tradeDecisionLogs for more detail
  try {
    const data = await db.execute(sql.raw(`
      SELECT symbol, decision, decisionReason, confidenceScore, executionScore, combinedScore,
             combinedScoreThreshold, consensusThreshold, passedConsensusThreshold, 
             passedCombinedScoreThreshold, passedAllChecks, timestamp
      FROM tradeDecisionLogs 
      WHERE timestamp > '2026-03-09 21:36:00'
      ORDER BY id DESC LIMIT 10
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== DETAILED TRADE DECISIONS (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.decision} | Conf: ${r.confidenceScore} | Exec: ${r.executionScore} | Combined: ${r.combinedScore} | ConsThreshold: ${r.passedConsensusThreshold} | CombThreshold: ${r.passedCombinedScoreThreshold} | AllPassed: ${r.passedAllChecks} | Reason: ${r.decisionReason?.substring(0, 100)}`);
    }
  } catch (e) {
    console.log('tradeDecisionLogs error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
