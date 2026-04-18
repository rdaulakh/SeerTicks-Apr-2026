import mysql from 'mysql2/promise';
const DATABASE_URL = process.env.DATABASE_URL;
async function check() {
  const conn = await mysql.createConnection({ uri: DATABASE_URL });
  const [rows] = await conn.query('SELECT config FROM engineState WHERE userId = 272657');
  const rawConfig = rows[0]?.config;
  console.log('Raw config type:', typeof rawConfig);
  
  // Parse config
  let config;
  if (typeof rawConfig === 'string') {
    config = JSON.parse(rawConfig);
  } else if (rawConfig && typeof rawConfig === 'object') {
    config = rawConfig;
  }
  
  console.log('Parsed config:', JSON.stringify(config, null, 2));
  console.log('\n✅ enableAutoTrading:', config?.enableAutoTrading);
  await conn.end();
}
check().catch(console.error);
