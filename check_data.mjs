import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

async function checkData() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);
  
  // Check candle data
  const candleCount = await db.execute(sql`
    SELECT symbol, COUNT(*) as count, 
           MIN(timestamp) as earliest, 
           MAX(timestamp) as latest 
    FROM candle_data 
    GROUP BY symbol
  `);
  
  console.log('\n=== CANDLE DATA ===');
  console.log(candleCount[0]);
  
  // Check agent signals
  const signalCount = await db.execute(sql`
    SELECT agent_name, COUNT(*) as count,
           MIN(timestamp) as earliest,
           MAX(timestamp) as latest
    FROM agent_signals
    GROUP BY agent_name
    ORDER BY count DESC
    LIMIT 10
  `);
  
  console.log('\n=== AGENT SIGNALS ===');
  console.log(signalCount[0]);
  
  // Check trades
  const tradeCount = await db.execute(sql`
    SELECT COUNT(*) as total_trades,
           SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winning_trades,
           SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END) as losing_trades,
           MIN(created_at) as earliest,
           MAX(created_at) as latest
    FROM trades
  `);
  
  console.log('\n=== TRADES ===');
  console.log(tradeCount[0]);
  
  await connection.end();
}

checkData().catch(console.error);
