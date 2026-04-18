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

console.log('=== automatedTradeLog Schema ===');
const [columns] = await connection.query('DESCRIBE automatedTradeLog');
console.table(columns);

console.log('\n=== Sample automatedTradeLog entry ===');
const [sample] = await connection.query('SELECT * FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 1');
console.log(sample[0]);

await connection.end();
