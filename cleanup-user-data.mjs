import { createConnection } from 'mysql2/promise';

const TARGET_USER_ID = 272657;
const OLD_USER_ID = 1;

async function cleanupAndMigrate() {
  const conn = await createConnection(process.env.DATABASE_URL);
  
  console.log('=== Starting Database Cleanup ===\n');
  
  // 1. Check current state
  console.log('--- Current State ---');
  const [users] = await conn.query('SELECT id, email, name FROM users WHERE id IN (?, ?)', [OLD_USER_ID, TARGET_USER_ID]);
  console.log('Users:', users);
  
  const [oldSymbols] = await conn.query('SELECT * FROM tradingSymbols WHERE userId = ?', [OLD_USER_ID]);
  console.log(`\nSymbols for userId ${OLD_USER_ID}:`, oldSymbols.length);
  
  const [targetSymbols] = await conn.query('SELECT * FROM tradingSymbols WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Symbols for userId ${TARGET_USER_ID}:`, targetSymbols.length);
  
  const [oldExchanges] = await conn.query('SELECT * FROM exchanges WHERE userId = ?', [OLD_USER_ID]);
  console.log(`\nExchanges for userId ${OLD_USER_ID}:`, oldExchanges.length);
  
  const [targetExchanges] = await conn.query('SELECT * FROM exchanges WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Exchanges for userId ${TARGET_USER_ID}:`, targetExchanges.length);
  
  // 2. Delete all data for userId 1
  console.log('\n--- Deleting data for userId 1 ---');
  
  // Delete in order of foreign key dependencies
  const tablesToClean = [
    'tradingSymbols',
    'apiKeys',
    'exchanges',
    'settings',
    'paperWallets',
    'paperPositions',
    'paperTrades',
    'trades',
    'positions',
    'agentSignals',
    'engineState',
    'automatedTradingSettings',
    'automatedTradeLogs',
    'healthMetrics',
    'orderHistory',
  ];
  
  for (const table of tablesToClean) {
    try {
      const [result] = await conn.query(`DELETE FROM ${table} WHERE userId = ?`, [OLD_USER_ID]);
      console.log(`  Deleted from ${table}: ${result.affectedRows} rows`);
    } catch (err) {
      // Table might not exist or have userId column
      console.log(`  Skipped ${table}: ${err.message}`);
    }
  }
  
  // Delete user 1 itself
  try {
    const [result] = await conn.query('DELETE FROM users WHERE id = ?', [OLD_USER_ID]);
    console.log(`  Deleted user ${OLD_USER_ID}: ${result.affectedRows} rows`);
  } catch (err) {
    console.log(`  Could not delete user ${OLD_USER_ID}: ${err.message}`);
  }
  
  // 3. Verify target user has exchange configured
  console.log('\n--- Verifying userId 272657 setup ---');
  
  const [finalExchanges] = await conn.query('SELECT * FROM exchanges WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Exchanges for userId ${TARGET_USER_ID}:`, finalExchanges);
  
  const [finalSymbols] = await conn.query('SELECT * FROM tradingSymbols WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Symbols for userId ${TARGET_USER_ID}:`, finalSymbols);
  
  // 4. If no symbols exist for target user, we need to add them
  if (finalSymbols.length === 0 && finalExchanges.length > 0) {
    console.log('\n--- Adding default symbols for userId 272657 ---');
    
    // Add BTC and ETH symbols for coinbase
    const symbolsToAdd = ['BTC-USD', 'ETH-USD'];
    for (const symbol of symbolsToAdd) {
      await conn.query(
        'INSERT INTO tradingSymbols (userId, symbol, exchangeName, isActive) VALUES (?, ?, ?, ?)',
        [TARGET_USER_ID, symbol, 'coinbase', true]
      );
      console.log(`  Added symbol: ${symbol}`);
    }
  }
  
  // 5. Final verification
  console.log('\n--- Final State ---');
  const [verifySymbols] = await conn.query('SELECT * FROM tradingSymbols WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Final symbols for userId ${TARGET_USER_ID}:`, verifySymbols);
  
  const [verifyExchanges] = await conn.query('SELECT * FROM exchanges WHERE userId = ?', [TARGET_USER_ID]);
  console.log(`Final exchanges for userId ${TARGET_USER_ID}:`, verifyExchanges);
  
  await conn.end();
  console.log('\n=== Cleanup Complete ===');
}

cleanupAndMigrate().catch(console.error);
