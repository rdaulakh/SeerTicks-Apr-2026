import { getActiveExchangesWithKeys, getAllActiveTradingSymbols } from './server/exchangeDb.ts';

const userId = 1260007; // rdaulakh@gmail.com

console.log('=== Testing Engine Start for userId:', userId, '===\n');

// Test 1: Get active exchanges
console.log('Test 1: getActiveExchangesWithKeys');
const exchanges = await getActiveExchangesWithKeys(userId);
console.log('Result:', JSON.stringify(exchanges, null, 2));
console.log('');

// Test 2: Get trading symbols
console.log('Test 2: getAllActiveTradingSymbols');
const symbols = await getAllActiveTradingSymbols(userId);
console.log('Result:', JSON.stringify(symbols, null, 2));
console.log('');

// Summary
console.log('=== Summary ===');
console.log('Exchanges found:', exchanges.length);
console.log('Symbols found:', symbols.length);
console.log('');

if (exchanges.length === 0) {
  console.log('❌ ERROR: No active exchanges found!');
} else if (symbols.length === 0) {
  console.log('❌ ERROR: No trading symbols found!');
} else {
  console.log('✅ Configuration looks good!');
  console.log('Engine should start successfully.');
}
