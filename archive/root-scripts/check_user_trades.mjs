import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function checkUserTrades() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  // Get user info
  console.log("=== USERS TABLE ===");
  const [users] = await connection.execute(`
    SELECT id, openId, name, email, role FROM users ORDER BY id DESC LIMIT 10
  `);
  console.log(JSON.stringify(users, null, 2));
  
  // Check trades for each user
  console.log("\n=== TRADES BY USER ID (paperPositions) ===");
  const [tradesByUser] = await connection.execute(`
    SELECT 
      userId,
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_trades
    FROM paperPositions
    GROUP BY userId
    ORDER BY total_trades DESC
  `);
  console.log(JSON.stringify(tradesByUser, null, 2));
  
  // Check if there's a mismatch between users table IDs and paperPositions userIds
  console.log("\n=== USER ID MAPPING CHECK ===");
  const [userIds] = await connection.execute(`SELECT DISTINCT id FROM users`);
  const [positionUserIds] = await connection.execute(`SELECT DISTINCT userId FROM paperPositions`);
  
  console.log("User IDs in users table:", userIds.map(u => u.id));
  console.log("User IDs in paperPositions:", positionUserIds.map(u => u.userId));
  
  await connection.end();
}

checkUserTrades().catch(console.error);
