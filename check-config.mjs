import mysql from 'mysql2/promise';
const DATABASE_URL = process.env.DATABASE_URL;
async function check() {
  const conn = await mysql.createConnection({ uri: DATABASE_URL });
  const [rows] = await conn.query('SELECT config FROM engineState WHERE userId = 272657');
  console.log('Config:', rows[0]?.config);
  const config = typeof rows[0]?.config === 'string' ? JSON.parse(rows[0].config) : rows[0]?.config;
  console.log('Parsed:', config);
  console.log('enableAutoTrading:', config?.enableAutoTrading);
  await conn.end();
}
check().catch(console.error);
