import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function testAutoTradingQuery() {
  console.log('Testing getAutoTrading query...');
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  
  // Get user with email rdaulakh@exoways.com
  const [users] = await connection.query('SELECT id, email FROM users WHERE email = ?', ['rdaulakh@exoways.com']);
  if (users.length === 0) {
    console.log('User not found');
    await connection.end();
    return;
  }
  
  const userId = users[0].id;
  console.log(`Testing with user ID: ${userId}, email: ${users[0].email}`);
  
  // Test the exact query used in getAutoTrading
  console.log('\nTesting engineState query...');
  const start = Date.now();
  const [engineState] = await connection.query(
    'SELECT * FROM engineState WHERE userId = ? LIMIT 1',
    [userId]
  );
  console.log(`Query time: ${Date.now() - start}ms`);
  
  if (engineState.length === 0) {
    console.log('No engine state found - this is the issue!');
    console.log('The query returns empty, but the code should handle this...');
  } else {
    console.log('Engine state found:', engineState[0]);
    // Parse config
    const config = typeof engineState[0].config === 'string' 
      ? JSON.parse(engineState[0].config) 
      : engineState[0].config;
    console.log('Parsed config:', config);
    console.log('enableAutoTrading:', config?.enableAutoTrading);
  }
  
  await connection.end();
  console.log('\nDone!');
}

testAutoTradingQuery().catch(console.error);
