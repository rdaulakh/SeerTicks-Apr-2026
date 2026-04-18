import { getDb } from './server/db';
import { tradingSymbols, exchanges } from './drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
if (!db) {
  console.log('❌ Database not available');
  process.exit(1);
}

console.log('=== SEER Engine Diagnostic ===\n');

// Check exchanges
console.log('📡 Configured Exchanges:');
const allExchanges = await db.select().from(exchanges);
console.log(`Total: ${allExchanges.length}`);
allExchanges.forEach(ex => {
  console.log(`  - ${ex.exchangeName}: ${ex.isActive ? '✅ Active' : '❌ Inactive'} (Status: ${ex.connectionStatus})`);
  console.log(`    Has API Key: ${!!ex.apiKey}, Has Secret: ${!!ex.apiSecret}`);
});

// Check trading symbols
console.log('\n📊 Trading Symbols:');
const symbols = await db.select().from(tradingSymbols);
console.log(`Total: ${symbols.length}`);
symbols.forEach(s => {
  console.log(`  - ${s.symbol} on ${s.exchangeName}: ${s.isActive ? '✅ Active' : '❌ Inactive'}`);
});

// Check if engine would start
console.log('\n🔍 Engine Startup Check:');
const activeExchanges = allExchanges.filter(ex => ex.isActive && ex.apiKey && ex.apiSecret);
const activeSymbols = symbols.filter(s => s.isActive);

console.log(`Active exchanges with API keys: ${activeExchanges.length}`);
console.log(`Active trading symbols: ${activeSymbols.length}`);

if (activeExchanges.length === 0) {
  console.log('\n❌ PROBLEM: No active exchanges with API keys configured!');
  console.log('   The engine cannot start without exchange credentials.');
} else if (activeSymbols.length === 0) {
  console.log('\n❌ PROBLEM: No active trading symbols configured!');
  console.log('   The engine cannot start without symbols to track.');
} else {
  console.log('\n✅ Engine should be able to start');
  console.log(`   Will track ${activeSymbols.length} symbols on ${activeExchanges.length} exchanges`);
}

process.exit(0);
