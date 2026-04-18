import mysql from 'mysql2/promise';
const DATABASE_URL = process.env.DATABASE_URL;
async function check() {
  const conn = await mysql.createConnection({ uri: DATABASE_URL });
  const [rows] = await conn.query('SELECT config FROM engineState WHERE userId = 272657');
  const rawConfig = rows[0]?.config;
  console.log('Raw config type:', typeof rawConfig);
  console.log('Raw config:', rawConfig);
  
  // Parse if string
  let config;
  if (typeof rawConfig === 'string') {
    config = JSON.parse(rawConfig);
  } else if (rawConfig && typeof rawConfig === 'object') {
    // Check if it's a Buffer or has numeric keys (character array)
    if (Buffer.isBuffer(rawConfig) || rawConfig[0] !== undefined) {
      // Convert character array to string
      const str = Object.values(rawConfig).join('');
      config = JSON.parse(str);
    } else {
      config = rawConfig;
    }
  }
  
  console.log('\nParsed config:', config);
  console.log('enableAutoTrading:', config?.enableAutoTrading);
  await conn.end();
}
check().catch(console.error);
