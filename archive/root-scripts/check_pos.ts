import mysql from 'mysql2/promise';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const sslParam = url.searchParams.get('ssl');
  let ssl: any = false;
  if (sslParam) {
    try { ssl = JSON.parse(sslParam); } catch { ssl = { rejectUnauthorized: true }; }
  }

  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl
  });

  // Check positions
  const [positions] = await conn.execute(`SELECT id, symbol, side, entryPrice, quantity, status, createdAt FROM paperPositions WHERE userId = 272657 ORDER BY createdAt DESC LIMIT 20`);
  console.log('\n=== Paper Positions for User 272657 ===');
  console.table(positions);

  // Check wallet
  const [wallets] = await conn.execute(`SELECT id, userId, balance, margin FROM paperWallets WHERE userId = 272657`);
  console.log('\n=== Wallet ===');
  console.table(wallets);

  await conn.end();
}

main().catch(console.error);
