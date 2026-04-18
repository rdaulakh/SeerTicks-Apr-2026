import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }
  
  // Query historicalOHLCV table directly
  console.log('=== Querying historicalOHLCV table ===');
  const result = await db.execute(sql`
    SELECT 
      symbol, 
      timeframe,
      COUNT(*) as candle_count,
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest
    FROM historicalOHLCV 
    GROUP BY symbol, timeframe
    ORDER BY symbol, timeframe
  `);
  
  console.log('Result:', JSON.stringify(result[0], null, 2));
  
  // Also get total count
  const totalResult = await db.execute(sql`SELECT COUNT(*) as total FROM historicalOHLCV`);
  console.log('\nTotal candles:', totalResult[0]);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
