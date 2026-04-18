import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // consensusLog has the data we need but no createdAt - check what timestamp column it uses
  try {
    const data = await db.execute(sql.raw(`SELECT * FROM consensusLog ORDER BY timestamp DESC LIMIT 20`));
    const rows = (data as any)[0] || [];
    console.log(`=== CONSENSUS LOG (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} | Dir: ${r.netDirection} | Conf: ${(parseFloat(r.consensusConfidence || '0') * 100).toFixed(1)}% | Threshold: ${(parseFloat(r.threshold || '0') * 100).toFixed(0)}% | Meets: ${r.meetsThreshold} | B:${r.bullishCount} Be:${r.bearishCount} N:${r.neutralCount} | ${new Date(r.timestamp).toISOString()}`);
    }
  } catch (e) {
    console.log('consensusLog error:', (e as Error).message?.substring(0, 300));
  }
  
  // Check recent agent signals
  try {
    const data = await db.execute(sql.raw(`SELECT * FROM agentSignals ORDER BY createdAt DESC LIMIT 30`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== AGENT SIGNALS (${rows.length}) ===`);
    const bySymbol: Record<string, any[]> = {};
    for (const r of rows) {
      const sym = r.symbol || 'unknown';
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(r);
    }
    for (const [sym, sigs] of Object.entries(bySymbol)) {
      const bullish = sigs.filter((s: any) => s.signal === 'bullish');
      const bearish = sigs.filter((s: any) => s.signal === 'bearish');
      const neutral = sigs.filter((s: any) => s.signal === 'neutral');
      console.log(`  ${sym}: ${bullish.length}B/${bearish.length}Be/${neutral.length}N`);
      for (const s of sigs.slice(0, 8)) {
        const conf = parseFloat(s.confidence || '0');
        console.log(`    ${s.agentName || 'N/A'}: ${s.signal} (${(conf * 100).toFixed(1)}%) @ ${s.createdAt}`);
      }
    }
  } catch (e) {
    console.log('agentSignals error:', (e as Error).message?.substring(0, 300));
  }
  
  // Check tradingSignals
  try {
    const data = await db.execute(sql.raw(`SELECT * FROM tradingSignals ORDER BY createdAt DESC LIMIT 10`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== TRADING SIGNALS (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.signal || r.direction} | Conf: ${r.confidence} | ${r.agentName || ''} | ${r.createdAt}`);
    }
  } catch (e) {
    console.log('tradingSignals error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
