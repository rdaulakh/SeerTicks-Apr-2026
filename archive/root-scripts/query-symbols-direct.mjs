import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await connection.execute('SELECT * FROM tradingSymbols');

console.log('\n=== TRADING SYMBOLS ===\n');
console.table(rows);

await connection.end();
