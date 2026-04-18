import mysql from 'mysql2/promise';

const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port) || 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true }
});

console.log('=== Paper Wallet After Fix ===');
const [wallets] = await connection.query(
  'SELECT pw.id, pw.userId, u.email, pw.balance, pw.margin, pw.equity, (CAST(pw.balance AS DECIMAL(20,2)) - CAST(pw.margin AS DECIMAL(20,2))) as availableBalance FROM paperWallets pw JOIN users u ON pw.userId = u.id WHERE pw.userId = 272657'
);
console.table(wallets);

await connection.end();
