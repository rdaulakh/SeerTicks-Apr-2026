import { getCandleCache, seedCandleCache } from './server/WebSocketCandleCache.js';
import { loadCandlesFromDatabase } from './server/db/candleStorage.js';

async function test() {
  console.log('=== Testing Candle Cache Fix ===\n');
  
  // Test 1: Check database has candles
  console.log('1. Testing database candle loading...');
  const symbols = ['BTC-USD', 'ETH-USD'];
  const timeframes = ['1h', '4h', '1d', '5m', '1m'];
  
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      const candles = await loadCandlesFromDatabase(symbol, tf, 50);
      console.log(`   ${symbol} ${tf}: ${candles.length} candles`);
    }
  }
  
  // Test 2: Seed the cache
  console.log('\n2. Testing cache seeding...');
  await seedCandleCache(['BTC-USD', 'ETH-USD']);
  
  // Test 3: Check cache status
  console.log('\n3. Checking cache status after seeding...');
  const cache = getCandleCache();
  const stats = cache.getStats();
  console.log(JSON.stringify(stats, null, 2));
  
  // Test 4: Get candles from cache
  console.log('\n4. Getting candles from cache...');
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      const candles = cache.getCandles(symbol, tf, 50);
      console.log(`   ${symbol} ${tf}: ${candles.length} candles in cache`);
    }
  }
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
