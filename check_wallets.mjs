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

console.log('=== Paper Wallets ===');
const [wallets] = await connection.query('SELECT pw.id, pw.userId, u.email, pw.balance, pw.margin, pw.equity, (CAST(pw.balance AS DECIMAL(20,2)) - CAST(pw.margin AS DECIMAL(20,2))) as availableBalance FROM paperWallets pw JOIN users u ON pw.userId = u.id');
console.table(wallets);

console.log('\n=== Open Positions Count ===');
const [positions] = await connection.query('SELECT userId, COUNT(*) as openPositions FROM paperPositions WHERE status = "open" GROUP BY userId');
console.table(positions);

console.log('\n=== Recent Trade Decision Logs (last 10) ===');
const [logs] = await connection.query('SELECT id, symbol, action, status, reason, createdAt FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 10');
console.table(logs);

await connection.end();
