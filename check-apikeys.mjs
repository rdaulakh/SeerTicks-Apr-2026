import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function checkApiKeys() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.execute('SELECT id, userId, exchangeId, isValid FROM apiKeys');
  console.log('API Keys in database:');
  console.log(rows);
  await connection.end();
}

checkApiKeys();
