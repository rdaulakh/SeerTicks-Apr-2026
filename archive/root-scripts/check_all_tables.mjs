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

console.log('=== All Tables ===');
const [tables] = await connection.query('SHOW TABLES');
console.table(tables);

// Check tradeDecisionLogs
console.log('\n=== tradeDecisionLogs (last 10) ===');
try {
  const [logs] = await connection.query('SELECT * FROM tradeDecisionLogs ORDER BY timestamp DESC LIMIT 10');
  console.log('Found', logs.length, 'entries');
  if (logs.length > 0) {
    console.log('Sample:', JSON.stringify(logs[0], null, 2));
  }
} catch (e) {
  console.log('Table not found or error:', e.message);
}

// Check signals table
console.log('\n=== signals (last 10) ===');
try {
  const [signals] = await connection.query('SELECT * FROM signals ORDER BY timestamp DESC LIMIT 10');
  console.log('Found', signals.length, 'entries');
} catch (e) {
  console.log('Table not found or error:', e.message);
}

await connection.end();
