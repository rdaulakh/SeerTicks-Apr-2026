import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get ALL positions (not just open)
  const [allPositions] = await connection.execute(
    `SELECT id, userId, symbol, side, entryPrice, currentPrice, quantity, 
            unrealizedPnL, unrealizedPnLPercent, status, entryTime, strategy
     FROM paperPositions 
     ORDER BY id DESC
     LIMIT 20`
  );
  
  console.log('=== ALL PAPER POSITIONS (last 20) ===');
  console.log(JSON.stringify(allPositions, null, 2));
  
  // Count by status
  const [statusCounts] = await connection.execute(
    `SELECT status, COUNT(*) as count FROM paperPositions GROUP BY status`
  );
  console.log('\n=== POSITION STATUS COUNTS ===');
  console.log(JSON.stringify(statusCounts, null, 2));
  
  await connection.end();
}

main().catch(console.error);
