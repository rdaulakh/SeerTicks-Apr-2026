import { CoinbaseAdapter } from './server/exchanges/CoinbaseAdapter.ts';

// Test symbol normalization
const adapter = new CoinbaseAdapter({
  apiKey: 'test',
  apiSecret: 'test'
});

const testSymbols = ['BTCUSDT', 'ETHUSDT', 'BTCUSD', 'ETHUSD'];

console.log('\n=== Testing Symbol Normalization ===\n');
for (const symbol of testSymbols) {
  const normalized = adapter.normalizeSymbol(symbol);
  console.log(`${symbol.padEnd(10)} -> ${normalized}`);
}

console.log('\n=== Testing Exchange Name ===');
console.log(`Exchange name: '${adapter.getExchangeName()}'`);
console.log(`Lowercase: '${adapter.getExchangeName().toLowerCase()}'`);
console.log(`Equals 'coinbase': ${adapter.getExchangeName().toLowerCase() === 'coinbase'}`);
