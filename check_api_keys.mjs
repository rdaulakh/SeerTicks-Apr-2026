import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('=== API KEYS for userId 272657 ===');
  const [keys] = await conn.query(`
    SELECT ak.id, ak.userId, ak.exchangeId, ak.isValid, ak.lastTested,
           LENGTH(ak.encryptedApiKey) as keyLen, LENGTH(ak.encryptedApiSecret) as secretLen,
           e.exchangeName, e.isActive, e.connectionStatus
    FROM apiKeys ak
    JOIN exchanges e ON ak.exchangeId = e.id
    WHERE ak.userId = 272657
  `);
  console.log(JSON.stringify(keys, null, 2));
  
  console.log('\n=== EXCHANGES for userId 272657 ===');
  const [exchanges] = await conn.query(`
    SELECT * FROM exchanges WHERE userId = 272657
  `);
  console.log(JSON.stringify(exchanges, null, 2));
  
  console.log('\n=== TRADING SYMBOLS for userId 272657 ===');
  const [symbols] = await conn.query(`
    SELECT * FROM tradingSymbols WHERE userId = 272657
  `);
  console.log(JSON.stringify(symbols, null, 2));
  
  await conn.end();
}

main().catch(console.error);
