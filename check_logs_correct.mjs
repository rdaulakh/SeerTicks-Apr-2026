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

console.log('=== Recent Trade Logs (last 20) ===');
const [logs] = await connection.query(
  'SELECT id, symbol, signalType, status, rejectionReason, walletBalanceAtTime, openPositionsAtTime, createdAt FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 20'
);
console.table(logs);

console.log('\n=== Logs after 13:30 UTC today (after wallet fix) ===');
const [recentLogs] = await connection.query(
  "SELECT id, symbol, signalType, status, rejectionReason, walletBalanceAtTime, createdAt FROM automatedTradeLog WHERE createdAt > '2026-01-30 13:30:00' ORDER BY createdAt DESC LIMIT 10"
);
console.log('Found', recentLogs.length, 'logs after server restart');
if (recentLogs.length > 0) console.table(recentLogs);

await connection.end();
