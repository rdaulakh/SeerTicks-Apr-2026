import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function testSettingsQueries() {
  console.log('Testing settings queries...');
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  
  // Get a user ID
  const [users] = await connection.query('SELECT id, email FROM users LIMIT 1');
  if (users.length === 0) {
    console.log('No users found');
    await connection.end();
    return;
  }
  
  const userId = users[0].id;
  console.log(`Testing with user ID: ${userId}, email: ${users[0].email}`);
  
  // Test getTradingModeConfig query
  console.log('\n1. Testing getTradingModeConfig...');
  const start1 = Date.now();
  const [tradingMode] = await connection.query(
    'SELECT * FROM tradingModeConfig WHERE userId = ? LIMIT 1',
    [userId]
  );
  console.log(`   Query time: ${Date.now() - start1}ms`);
  console.log(`   Result:`, tradingMode[0] || 'No config found');
  
  // Test getAutoTrading query (engineState)
  console.log('\n2. Testing getAutoTrading (engineState)...');
  const start2 = Date.now();
  const [engineState] = await connection.query(
    'SELECT * FROM engineState WHERE userId = ? LIMIT 1',
    [userId]
  );
  console.log(`   Query time: ${Date.now() - start2}ms`);
  console.log(`   Result:`, engineState[0] || 'No engine state found');
  
  // Test getPortfolioFunds (same as tradingModeConfig)
  console.log('\n3. Testing getPortfolioFunds...');
  const start3 = Date.now();
  const [portfolioFunds] = await connection.query(
    'SELECT portfolioFunds FROM tradingModeConfig WHERE userId = ? LIMIT 1',
    [userId]
  );
  console.log(`   Query time: ${Date.now() - start3}ms`);
  console.log(`   Result:`, portfolioFunds[0] || 'No funds found');
  
  // Check if there are indexes on these tables
  console.log('\n4. Checking indexes...');
  const [tradingModeIndexes] = await connection.query('SHOW INDEX FROM tradingModeConfig');
  console.log('   tradingModeConfig indexes:', tradingModeIndexes.map(i => i.Key_name));
  
  const [engineStateIndexes] = await connection.query('SHOW INDEX FROM engineState');
  console.log('   engineState indexes:', engineStateIndexes.map(i => i.Key_name));
  
  await connection.end();
  console.log('\nDone!');
}

testSettingsQueries().catch(console.error);
