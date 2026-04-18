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

console.log('=== Current Wallet Status ===');
const [wallets] = await connection.query(
  'SELECT pw.userId, u.email, pw.balance, pw.margin, (CAST(pw.balance AS DECIMAL(20,2)) - CAST(pw.margin AS DECIMAL(20,2))) as availableBalance FROM paperWallets pw JOIN users u ON pw.userId = u.id WHERE pw.userId = 272657'
);
console.table(wallets);

console.log('\n=== Open Positions for User 272657 ===');
const [positions] = await connection.query(
  'SELECT id, symbol, side, entryPrice, quantity, status, createdAt FROM paperPositions WHERE userId = 272657 AND status = "open" ORDER BY createdAt DESC LIMIT 10'
);
console.log('Open positions:', positions.length);
if (positions.length > 0) console.table(positions);

console.log('\n=== Recent Positions (created today) ===');
const [recentPositions] = await connection.query(
  "SELECT id, symbol, side, entryPrice, quantity, status, createdAt FROM paperPositions WHERE userId = 272657 AND createdAt > '2026-01-30 00:00:00' ORDER BY createdAt DESC LIMIT 10"
);
console.log('Positions created today:', recentPositions.length);
if (recentPositions.length > 0) console.table(recentPositions);

console.log('\n=== Recent Paper Trades ===');
const [trades] = await connection.query(
  "SELECT id, symbol, side, price, quantity, pnl, strategy, timestamp FROM paperTrades WHERE userId = 272657 ORDER BY timestamp DESC LIMIT 10"
);
console.log('Recent trades:', trades.length);
if (trades.length > 0) console.table(trades);

await connection.end();
