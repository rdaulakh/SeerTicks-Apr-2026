import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  // Check candleData
  const candleStats = await db.execute(sql`
    SELECT 
      symbol, 
      \`interval\`,
      COUNT(*) as candle_count,
      MIN(timestamp) as earliest_date,
      MAX(timestamp) as latest_date
    FROM candleData 
    GROUP BY symbol, \`interval\`
  `);
  
  console.log('=== candleData Table ===');
  console.log(JSON.stringify(candleStats[0], null, 2));
  
  // Check historicalCandles
  const historicalStats = await db.execute(sql`
    SELECT 
      symbol, 
      \`interval\`,
      COUNT(*) as candle_count,
      MIN(timestamp) as earliest_date,
      MAX(timestamp) as latest_date
    FROM historicalCandles 
    GROUP BY symbol, \`interval\`
  `);
  
  console.log('\n=== historicalCandles Table ===');
  console.log(JSON.stringify(historicalStats[0], null, 2));
  
  await connection.end();
}

main().catch(console.error);
