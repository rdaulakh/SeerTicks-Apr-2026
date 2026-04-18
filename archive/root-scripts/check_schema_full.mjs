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

const [columns] = await connection.query('DESCRIBE automatedTradeLog');
console.log('Columns:', columns.map(c => c.Field).join(', '));

// Get a sample row
const [rows] = await connection.query('SELECT * FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 1');
if (rows.length > 0) {
  console.log('\nSample row:');
  console.log(JSON.stringify(rows[0], null, 2));
}

await connection.end();
