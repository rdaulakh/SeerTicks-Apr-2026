import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function checkTrades() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  // Check total trades by user
  console.log("=== TRADES BY USER ===");
  const [byUser] = await connection.execute(`
    SELECT 
      userId,
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open
    FROM paperPositions
    GROUP BY userId
    ORDER BY total_trades DESC
  `);
  console.log(JSON.stringify(byUser, null, 2));
  
  // Check trades by date
  console.log("\n=== TRADES BY DATE (Last 20 days) ===");
  const [byDate] = await connection.execute(`
    SELECT 
      DATE(entryTime) as trade_date,
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open
    FROM paperPositions
    GROUP BY DATE(entryTime)
    ORDER BY trade_date DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(byDate, null, 2));
  
  // Check most recent trades
  console.log("\n=== MOST RECENT 10 TRADES ===");
  const [recent] = await connection.execute(`
    SELECT 
      id,
      userId,
      symbol,
      side,
      status,
      entryTime,
      exitTime,
      realizedPnl
    FROM paperPositions
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log(JSON.stringify(recent, null, 2));
  
  // Check if there are trades for user 272657 (RD's user ID)
  console.log("\n=== TRADES FOR USER 272657 ===");
  const [rdTrades] = await connection.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      MIN(entryTime) as first_trade,
      MAX(entryTime) as last_trade
    FROM paperPositions
    WHERE userId = 272657
  `);
  console.log(JSON.stringify(rdTrades, null, 2));
  
  await connection.end();
}

checkTrades().catch(console.error);
