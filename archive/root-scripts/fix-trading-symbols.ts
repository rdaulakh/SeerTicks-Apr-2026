import { getDb } from './server/db';
import { tradingSymbols, users } from './drizzle/schema';
import { eq, isNull } from 'drizzle-orm';

const db = await getDb();
if (!db) {
  console.log('Database not available');
  process.exit(1);
}

console.log('🔧 Fixing trading symbols with missing exchange names...\n');

// Get first user
const allUsers = await db.select().from(users).limit(1);
if (allUsers.length === 0) {
  console.log('❌ No users found in database');
  process.exit(1);
}

const user = allUsers[0];
console.log(`User: ${user.name} (ID: ${user.id})\n`);

// Get all symbols for this user
const symbols = await db
  .select()
  .from(tradingSymbols)
  .where(eq(tradingSymbols.userId, user.id));

console.log(`Found ${symbols.length} trading symbols:\n`);

for (const symbol of symbols) {
  console.log(`Symbol: ${symbol.symbol}, Exchange: ${symbol.exchangeName || 'undefined'}`);
  
  // Fix missing exchange names
  if (!symbol.exchangeName) {
    // Determine exchange based on symbol format
    let exchangeName = 'coinbase'; // Default to coinbase
    
    // Binance symbols end with USDT, BTC, ETH, BNB, etc.
    if (symbol.symbol.endsWith('USDT') || symbol.symbol.endsWith('BTC') || symbol.symbol.endsWith('BNB')) {
      exchangeName = 'binance';
    }
    
    await db
      .update(tradingSymbols)
      .set({ exchangeName: exchangeName })
      .where(eq(tradingSymbols.id, symbol.id));
    
    console.log(`  ✅ Fixed: Set exchange to '${exchangeName}'`);
  }
}

// Add Coinbase symbols if they don't exist
console.log('\n📊 Checking for Coinbase symbols...');

const coinbaseSymbols = ['BTCUSD', 'ETHUSD'];

for (const symbolName of coinbaseSymbols) {
  const existing = symbols.find(s => s.symbol === symbolName && s.exchangeName === 'coinbase');
  
  if (!existing) {
    await db.insert(tradingSymbols).values({
      userId: user.id,
      symbol: symbolName,
      exchangeName: 'coinbase',
      isActive: true,
    });
    console.log(`  ✅ Added ${symbolName} on Coinbase`);
  } else {
    console.log(`  ℹ️  ${symbolName} already exists on Coinbase`);
  }
}

// Show final state
console.log('\n📋 Final trading symbols:');
const finalSymbols = await db
  .select()
  .from(tradingSymbols)
  .where(eq(tradingSymbols.userId, user.id));

finalSymbols.forEach(s => {
  console.log(`  - ${s.symbol} on ${s.exchangeName} (active: ${s.isActive})`);
});

console.log('\n✅ Trading symbols fixed!');
console.log('\n⚠️  IMPORTANT: Restart the server for changes to take effect.\n');

process.exit(0);
