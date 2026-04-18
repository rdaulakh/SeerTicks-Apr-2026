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

  // Reset wallet margin to 0
  console.log('Resetting wallet margin for user 272657...');
  const [result] = await conn.execute(`UPDATE paperWallets SET margin = '0.00' WHERE userId = 272657`);
  console.log('Update result:', result);

  // Verify the update
  const [wallets] = await conn.execute(`SELECT id, userId, balance, margin FROM paperWallets WHERE userId = 272657`);
  console.log('\n=== Updated Wallet ===');
  console.table(wallets);

  await conn.end();
}

main().catch(console.error);
