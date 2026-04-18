// Debug script to trace tick flow to fast agents
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  // Check recent ticks
  const [ticks] = await connection.execute(`
    SELECT COUNT(*) as count, MAX(timestampMs) as lastTick 
    FROM ticks 
    WHERE timestampMs > ?
  `, [Date.now() - 60000]); // Last minute
  
  console.log('Recent ticks (last 60s):', ticks[0]);
  
  // Check if ticks are flowing
  const [recentTicks] = await connection.execute(`
    SELECT symbol, price, timestampMs 
    FROM ticks 
    ORDER BY timestampMs DESC 
    LIMIT 5
  `);
  
  console.log('\nMost recent ticks:');
  for (const tick of recentTicks) {
    const age = Date.now() - tick.timestampMs;
    console.log(`  ${tick.symbol}: $${tick.price} (${age}ms ago)`);
  }
  
  await connection.end();
}

main().catch(console.error);
