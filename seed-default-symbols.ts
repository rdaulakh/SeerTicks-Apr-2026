import { getDb } from './server/db';
import { tradingSymbols, users } from './drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
if (!db) {
  console.log('Database not available');
  process.exit(1);
}

console.log('🔧 Seeding default trading symbols...\n');

// Get first user (for testing)
const allUsers = await db.select().from(users).limit(1);
if (allUsers.length === 0) {
  console.log('❌ No users found in database');
  process.exit(1);
}

const user = allUsers[0];
console.log(`Found user: ${user.name} (ID: ${user.id})`);

// Check if user already has trading symbols
const existingSymbols = await db
  .select()
  .from(tradingSymbols)
  .where(eq(tradingSymbols.userId, user.id));

console.log(`\nExisting symbols: ${existingSymbols.length}`);

if (existingSymbols.length > 0) {
  console.log('\nUser already has trading symbols:');
  existingSymbols.forEach(s => {
    console.log(`  - ${s.symbol} on ${s.exchangeName} (active: ${s.isActive})`);
  });
  
  // Update to make them active if they're not
  for (const symbol of existingSymbols) {
    if (!symbol.isActive) {
      await db
        .update(tradingSymbols)
        .set({ isActive: true })
        .where(eq(tradingSymbols.id, symbol.id));
      console.log(`  ✅ Activated ${symbol.symbol}`);
    }
  }
} else {
  console.log('\n📊 Adding default trading symbols...');
  
  // Add default symbols: BTCUSD and ETHUSD on Coinbase
  const defaultSymbols = [
    { symbol: 'BTCUSD', exchangeName: 'coinbase' },
    { symbol: 'ETHUSD', exchangeName: 'coinbase' },
  ];
  
  for (const symbolData of defaultSymbols) {
    await db.insert(tradingSymbols).values({
      userId: user.id,
      symbol: symbolData.symbol,
      exchangeName: symbolData.exchangeName,
      isActive: true,
    });
    console.log(`  ✅ Added ${symbolData.symbol} on ${symbolData.exchangeName}`);
  }
}

console.log('\n✅ Default trading symbols configured!');
console.log('\n⚠️  IMPORTANT: You must restart the SEER engine for changes to take effect.');
console.log('   The engine only loads symbols on startup.\n');

process.exit(0);
