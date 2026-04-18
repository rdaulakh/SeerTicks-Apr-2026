import { getDb } from '../server/db';
import { historicalCandles } from '../drizzle/schema';
import { count, min, max } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }
  
  // Get data summary
  const result = await db
    .select({
      symbol: historicalCandles.symbol,
      interval: historicalCandles.interval,
      candleCount: count(),
      earliest: min(historicalCandles.timestamp),
      latest: max(historicalCandles.timestamp),
    })
    .from(historicalCandles)
    .groupBy(historicalCandles.symbol, historicalCandles.interval);
  
  console.log('=== OHLCV Data Summary ===');
  for (const row of result) {
    const earliest = row.earliest ? new Date(row.earliest) : null;
    const latest = row.latest ? new Date(row.latest) : null;
    const days = earliest && latest ? Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    console.log(`${row.symbol} (${row.interval}): ${row.candleCount} candles, ${days} days`);
    console.log(`  From: ${earliest?.toISOString() || 'N/A'}`);
    console.log(`  To:   ${latest?.toISOString() || 'N/A'}`);
  }
  
  // Get total count
  const totalResult = await db.select({ total: count() }).from(historicalCandles);
  console.log(`\nTotal candles in database: ${totalResult[0].total}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
