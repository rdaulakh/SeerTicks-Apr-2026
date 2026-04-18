import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // 1. Check recent agent signals (are agents generating signals?)
  try {
    const data = await db.execute(sql.raw(`
      SELECT agentName, symbol, signal, confidence, timestamp 
      FROM agentSignalLog 
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      ORDER BY timestamp DESC LIMIT 30
    `));
    const rows = (data as any)[0] || [];
    console.log(`=== RECENT AGENT SIGNALS (last 10 min): ${rows.length} ===`);
    const bySymbol: Record<string, any[]> = {};
    for (const r of rows) {
      const sym = r.symbol;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(r);
    }
    for (const [sym, entries] of Object.entries(bySymbol)) {
      const bullish = entries.filter((e: any) => e.signal === 'bullish').length;
      const bearish = entries.filter((e: any) => e.signal === 'bearish').length;
      const neutral = entries.filter((e: any) => e.signal === 'neutral').length;
      const avgConf = entries.reduce((s: number, e: any) => s + parseFloat(e.confidence || '0'), 0) / entries.length;
      console.log(`  ${sym}: ${entries.length} signals | B:${bullish} Be:${bearish} N:${neutral} | Avg conf: ${(avgConf * 100).toFixed(1)}%`);
      for (const e of entries.slice(0, 3)) {
        console.log(`    ${e.agentName}: ${e.signal} (${(parseFloat(e.confidence) * 100).toFixed(1)}%)`);
      }
    }
  } catch (e) {
    console.log('agentSignalLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // 2. Check consensus log (is consensus being computed?)
  try {
    const data = await db.execute(sql.raw(`
      SELECT symbol, netDirection, consensusConfidence, threshold, meetsThreshold, timestamp
      FROM consensusLog 
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      ORDER BY timestamp DESC LIMIT 10
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== CONSENSUS LOG (last 10 min): ${rows.length} ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.netDirection} | Conf: ${(parseFloat(r.consensusConfidence) * 100).toFixed(1)}% | Threshold: ${(parseFloat(r.threshold) * 100).toFixed(0)}% | Meets: ${r.meetsThreshold} | ${r.timestamp}`);
    }
  } catch (e) {
    console.log('consensusLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // 3. Check trade decisions (are trades being approved or rejected?)
  try {
    const data = await db.execute(sql.raw(`
      SELECT symbol, decision, direction, consensusConfidence, rejectReason, rejectStage, timestamp
      FROM tradeDecisionLog 
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      ORDER BY timestamp DESC LIMIT 20
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== TRADE DECISIONS (last 10 min): ${rows.length} ===`);
    for (const r of rows) {
      const conf = parseFloat(r.consensusConfidence || '0');
      console.log(`  ${r.timestamp} | ${r.symbol} ${r.direction} ${r.decision} | Conf: ${(conf * 100).toFixed(1)}% | Stage: ${r.rejectStage || 'APPROVED'} | Reason: ${(r.rejectReason || 'OK').substring(0, 80)}`);
    }
  } catch (e) {
    console.log('tradeDecisionLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // 4. Check pipeline events log
  try {
    const data = await db.execute(sql.raw(`
      SELECT eventType, symbol, direction, confidence, reason, timestamp
      FROM pipelineEvents 
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      ORDER BY timestamp DESC LIMIT 20
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== PIPELINE EVENTS (last 5 min): ${rows.length} ===`);
    for (const r of rows) {
      console.log(`  ${r.timestamp} | ${r.eventType} | ${r.symbol} ${r.direction || ''} | Conf: ${r.confidence ? (parseFloat(r.confidence) * 100).toFixed(1) + '%' : 'N/A'} | ${(r.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    console.log('pipelineEvents error:', (e as Error).message?.substring(0, 200));
  }
  
  // 5. Check open positions
  try {
    const data = await db.execute(sql.raw(`
      SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnL, updatedAt
      FROM paperPositions 
      WHERE status = 'open'
      ORDER BY id DESC LIMIT 10
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== OPEN POSITIONS: ${rows.length} ===`);
    for (const r of rows) {
      console.log(`  #${r.id} ${r.symbol} ${r.side} | Entry: $${r.entryPrice} | Current: $${r.currentPrice} | PnL: $${r.unrealizedPnL} | Updated: ${r.updatedAt}`);
    }
  } catch (e) {
    console.log('paperPositions error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
