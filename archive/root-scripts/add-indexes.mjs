import { createConnection } from 'mysql2/promise';

async function addIndexes() {
  const conn = await createConnection(process.env.DATABASE_URL);
  
  console.log('Adding indexes...');
  
  // Add index on exchanges.userId
  try {
    await conn.query('CREATE INDEX idx_exchanges_user ON exchanges(userId)');
    console.log('  Created idx_exchanges_user');
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') {
      console.log('  idx_exchanges_user already exists');
    } else {
      console.log('  Error creating idx_exchanges_user:', e.message);
    }
  }
  
  // Add index on tradingSymbols.userId
  try {
    await conn.query('CREATE INDEX idx_trading_symbols_user ON tradingSymbols(userId)');
    console.log('  Created idx_trading_symbols_user');
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') {
      console.log('  idx_trading_symbols_user already exists');
    } else {
      console.log('  Error creating idx_trading_symbols_user:', e.message);
    }
  }
  
  // Add unique index on tradingSymbols(userId, symbol, exchangeName)
  try {
    await conn.query('CREATE UNIQUE INDEX idx_trading_symbols_user_symbol ON tradingSymbols(userId, symbol, exchangeName)');
    console.log('  Created idx_trading_symbols_user_symbol');
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') {
      console.log('  idx_trading_symbols_user_symbol already exists');
    } else {
      console.log('  Error creating idx_trading_symbols_user_symbol:', e.message);
    }
  }
  
  // Show indexes
  console.log('\nExchanges indexes:');
  const [exchangeIndexes] = await conn.query('SHOW INDEX FROM exchanges');
  exchangeIndexes.forEach(idx => console.log(`  ${idx.Key_name}: ${idx.Column_name}`));
  
  console.log('\nTradingSymbols indexes:');
  const [symbolIndexes] = await conn.query('SHOW INDEX FROM tradingSymbols');
  symbolIndexes.forEach(idx => console.log(`  ${idx.Key_name}: ${idx.Column_name}`));
  
  await conn.end();
  console.log('\nDone!');
}

addIndexes().catch(console.error);
