import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
const connection = await mysql.createConnection(DATABASE_URL);

// Get table schema
const [columns] = await connection.execute(
  `DESCRIBE tradeDecisionLogs`
);

console.log('=== tradeDecisionLogs SCHEMA ===');
for (const col of columns) {
  console.log(`${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(nullable)' : ''}`);
}

// Get a sample row with all fields
const [rows] = await connection.execute(
  `SELECT * FROM tradeDecisionLogs WHERE userId = 272657 ORDER BY timestamp DESC LIMIT 1`
);

if (rows.length > 0) {
  console.log('\n=== SAMPLE ROW ===');
  const row = rows[0];
  for (const [key, value] of Object.entries(row)) {
    console.log(`${key}: ${value}`);
  }
}

await connection.end();
