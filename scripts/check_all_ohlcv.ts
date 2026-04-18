import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }
  
  // List all tables that might contain OHLCV data
  const tables = await db.execute(sql`SHOW TABLES LIKE '%candle%'`);
  console.log('=== Tables containing "candle" ===');
  console.log(tables);
  
  const ohlcvTables = await db.execute(sql`SHOW TABLES LIKE '%ohlcv%'`);
  console.log('\n=== Tables containing "ohlcv" ===');
  console.log(ohlcvTables);
  
  const histTables = await db.execute(sql`SHOW TABLES LIKE '%hist%'`);
  console.log('\n=== Tables containing "hist" ===');
  console.log(histTables);
  
  // Check historicalOHLCV table specifically
  try {
    const ohlcvCount = await db.execute(sql`
      SELECT 
        symbol, 
        \`interval\` as timeframe,
        COUNT(*) as candle_count,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
      FROM historicalOHLCV 
      GROUP BY symbol, \`interval\`
      ORDER BY symbol, \`interval\`
    `);
    console.log('\n=== historicalOHLCV Data Summary ===');
    console.log(ohlcvCount);
  } catch (e) {
    console.log('\n=== historicalOHLCV table not found, trying alternatives ===');
  }
  
  // Try historical_ohlcv (snake_case)
  try {
    const ohlcvCount = await db.execute(sql`
      SELECT 
        symbol, 
        \`interval\` as timeframe,
        COUNT(*) as candle_count,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
      FROM historical_ohlcv 
      GROUP BY symbol, \`interval\`
      ORDER BY symbol, \`interval\`
    `);
    console.log('\n=== historical_ohlcv Data Summary ===');
    console.log(ohlcvCount);
  } catch (e) {
    console.log('historical_ohlcv table not found');
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
