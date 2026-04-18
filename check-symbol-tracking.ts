import { getDb } from './server/db';
import { candleData } from './drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getCandleCache } from './server/WebSocketCandleCache';

const db = await getDb();
if (!db) {
  console.log('Database not available');
  process.exit(1);
}

const symbols = ['BTCUSD', 'ETHUSD', 'BTC-USD', 'ETH-USD'];
const timeframes = ['1m', '5m', '4h', '1d'];

console.log('=== Symbol Tracking & Cache Diagnostic ===\n');

// Check database for historical candles
console.log('📊 Database Candle Data:');
console.log('='.repeat(60));

for (const symbol of symbols) {
  console.log(`\nSymbol: ${symbol}`);
  for (const timeframe of timeframes) {
    const candleRows = await db
      .select()
      .from(candleData)
      .where(and(
        eq(candleData.symbol, symbol),
        eq(candleData.interval, timeframe)
      ))
      .orderBy(desc(candleData.timestamp))
      .limit(1);
    
    if (candleRows.length > 0) {
      const totalCount = await db
        .select()
        .from(candleData)
        .where(and(
          eq(candleData.symbol, symbol),
          eq(candleData.interval, timeframe)
        ));
      
      console.log(`  [${timeframe}] ${totalCount.length} candles in DB (latest: ${new Date(candleRows[0].timestamp).toISOString()})`);
    } else {
      console.log(`  [${timeframe}] No candles in DB`);
    }
  }
}

// Check WebSocket cache
console.log('\n\n💾 WebSocket Cache Status:');
console.log('='.repeat(60));

const cache = getCandleCache();

for (const symbol of symbols) {
  console.log(`\nSymbol: ${symbol}`);
  for (const timeframe of timeframes) {
    const cached = cache.getCandles(symbol, timeframe, 50);
    console.log(`  [${timeframe}] ${cached.length} candles cached`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('Diagnostic complete');

process.exit(0);
