import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('=== EXCHANGES ===');
  const [exchanges] = await conn.query('SELECT id, userId, exchangeName, isActive, connectionStatus FROM exchanges');
  console.log(JSON.stringify(exchanges, null, 2));
  
  console.log('\n=== TRADING SYMBOLS ===');
  const [symbols] = await conn.query('SELECT id, userId, symbol, isActive, exchangeName FROM tradingSymbols');
  console.log(JSON.stringify(symbols, null, 2));
  
  console.log('\n=== API KEYS ===');
  const [keys] = await conn.query('SELECT id, userId, exchangeId, isValid FROM apiKeys');
  console.log(JSON.stringify(keys, null, 2));
  
  console.log('\n=== USERS ===');
  const [users] = await conn.query('SELECT id, email, name FROM users');
  console.log(JSON.stringify(users, null, 2));
  
  await conn.end();
}

main().catch(console.error);
