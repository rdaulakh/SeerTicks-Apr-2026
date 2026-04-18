import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const [rows] = await connection.execute('SELECT * FROM exchanges ORDER BY id DESC');
  console.log('Exchanges in database:');
  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}

main().catch(console.error);
