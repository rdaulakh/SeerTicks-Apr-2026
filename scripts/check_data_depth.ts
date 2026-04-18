import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  // Check all candle intervals available
  console.log('=== All Candle Data by Interval ===');
  const allCandles = await db.execute(sql`
    SELECT 
      symbol, 
      \`interval\`,
      COUNT(*) as candle_count,
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest
    FROM historicalCandles 
    GROUP BY symbol, \`interval\`
    ORDER BY symbol, \`interval\`
  `);
  console.log(JSON.stringify(allCandles[0], null, 2));
  
  // Check agent signals history
  console.log('\n=== Agent Signals History ===');
  const agentSignals = await db.execute(sql`
    SELECT 
      agentName,
      signalType,
      COUNT(*) as signal_count,
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest
    FROM agentSignals 
    GROUP BY agentName, signalType
    ORDER BY agentName, signal_count DESC
  `);
  console.log(JSON.stringify(agentSignals[0], null, 2));
  
  // Check trades history
  console.log('\n=== Trades History ===');
  const trades = await db.execute(sql`
    SELECT 
      COUNT(*) as total_trades,
      MIN(createdAt) as earliest,
      MAX(createdAt) as latest
    FROM trades
  `);
  console.log(JSON.stringify(trades[0], null, 2));
  
  // Check positions history
  console.log('\n=== Positions History ===');
  const positions = await db.execute(sql`
    SELECT 
      status,
      COUNT(*) as count,
      MIN(openedAt) as earliest,
      MAX(openedAt) as latest
    FROM positions
    GROUP BY status
  `);
  console.log(JSON.stringify(positions[0], null, 2));
  
  await connection.end();
}

main().catch(console.error);
