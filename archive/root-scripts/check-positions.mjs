import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get open positions
  const [positions] = await connection.execute(
    `SELECT id, userId, symbol, side, entryPrice, currentPrice, quantity, 
            unrealizedPnL, unrealizedPnLPercent, status, entryTime, strategy
     FROM paperPositions 
     WHERE status = 'open' 
     ORDER BY id DESC`
  );
  
  console.log('=== OPEN PAPER POSITIONS ===');
  console.log(JSON.stringify(positions, null, 2));
  
  // Get wallet info
  const [wallets] = await connection.execute(
    `SELECT * FROM paperWallets LIMIT 5`
  );
  console.log('\n=== PAPER WALLETS ===');
  console.log(JSON.stringify(wallets, null, 2));
  
  await connection.end();
}

main().catch(console.error);
