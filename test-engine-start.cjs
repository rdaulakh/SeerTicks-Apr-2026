const { drizzle } = require('drizzle-orm/mysql2');

(async () => {
  const db = drizzle(process.env.DATABASE_URL);
  
  const userId = 1260007;
  console.log('\n=== Testing Engine Start for userId:', userId, '===\n');
  
  // Test 1: Check exchanges
  console.log('1. Checking exchanges...');
  const exchangesResult = await db.execute(
    'SELECT id, userId, exchangeName, isActive FROM exchanges WHERE userId = ? AND isActive = 1',
    [userId]
  );
  console.log('   Found exchanges:', JSON.stringify(exchangesResult[0], null, 2));
  
  // Test 2: Check API keys
  console.log('\n2. Checking API keys...');
  const apiKeysResult = await db.execute(
    'SELECT id, userId, exchangeId, isValid FROM apiKeys WHERE userId = ?',
    [userId]
  );
  console.log('   Found API keys:', JSON.stringify(apiKeysResult[0], null, 2));
  
  // Test 3: Check trading symbols
  console.log('\n3. Checking trading symbols...');
  const symbolsResult = await db.execute(
    'SELECT id, userId, symbol, isActive FROM tradingSymbols WHERE userId = ? AND isActive = 1',
    [userId]
  );
  console.log('   Found symbols:', JSON.stringify(symbolsResult[0], null, 2));
  
  process.exit(0);
})();
