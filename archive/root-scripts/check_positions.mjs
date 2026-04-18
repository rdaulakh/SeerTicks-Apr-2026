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

// User ID for rdaulakh@exoways.com
const userId = 272657;

console.log('=== Open Positions for User 272657 (rdaulakh@exoways.com) ===');
const [positions] = await connection.query(
  'SELECT id, symbol, side, entryPrice, quantity, margin, status, createdAt FROM paperPositions WHERE userId = ? AND status = "open"',
  [userId]
);
console.table(positions);

console.log('\n=== All Positions Count by Status ===');
const [statusCount] = await connection.query(
  'SELECT status, COUNT(*) as count FROM paperPositions WHERE userId = ? GROUP BY status',
  [userId]
);
console.table(statusCount);

console.log('\n=== Total Margin Used ===');
const [marginSum] = await connection.query(
  'SELECT SUM(CAST(margin AS DECIMAL(20,2))) as totalMargin FROM paperPositions WHERE userId = ? AND status = "open"',
  [userId]
);
console.table(marginSum);

console.log('\n=== automatedTradeLog columns ===');
const [columns] = await connection.query('DESCRIBE automatedTradeLog');
console.table(columns);

await connection.end();
