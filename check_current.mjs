import mysql from 'mysql2/promise';
const DATABASE_URL = process.env.DATABASE_URL;
async function check() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const [ticks] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const [oldTicks] = await connection.execute(`SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`);
  console.log('Current ticks:', Number(ticks[0].count).toLocaleString());
  console.log('Old ticks (>24h):', Number(oldTicks[0].count).toLocaleString());
  await connection.end();
}
check().catch(console.error);
