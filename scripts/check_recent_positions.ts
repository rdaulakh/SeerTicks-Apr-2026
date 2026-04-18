import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // Check all recent positions
  const [positions] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, quantity, status, 
           DATE_FORMAT(entryTime, '%Y-%m-%d %H:%i:%s') as entryTime,
           DATE_FORMAT(exitTime, '%Y-%m-%d %H:%i:%s') as exitTime
    FROM paperPositions 
    WHERE userId = 1 
    ORDER BY id DESC 
    LIMIT 5
  `);
  console.log('Recent Positions:', JSON.stringify(positions, null, 2));
  
  // Check wallet
  const [wallets] = await conn.execute('SELECT id, userId, balance, margin, realizedPnL FROM paperWallets WHERE userId = 1');
  console.log('Wallet:', JSON.stringify((wallets as any[])[0], null, 2));
  
  await conn.end();
}

check().catch(console.error);
