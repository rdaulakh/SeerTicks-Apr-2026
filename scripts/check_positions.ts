import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // Check all positions (not just open)
  const [positions] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, quantity, status, DATE_FORMAT(entryTime, '%Y-%m-%d %H:%i:%s') as entryTime 
    FROM paperPositions 
    WHERE userId = 1 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log('Recent Positions (all statuses):', JSON.stringify(positions, null, 2));
  
  // Check paper trades
  const [trades] = await conn.execute(`
    SELECT id, orderId, symbol, side, price, quantity, pnl, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') as timestamp 
    FROM paperTrades 
    WHERE userId = 1 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log('Recent Paper Trades:', JSON.stringify(trades, null, 2));
  
  await conn.end();
}

check().catch(console.error);
