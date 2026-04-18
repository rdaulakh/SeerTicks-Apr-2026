import { getCandleCache } from './server/WebSocketCandleCache';

const symbols = ['ETH-USD', 'BTC-USD', 'BNB-USD'];
const timeframes = ['1m', '5m', '4h', '1d'];

console.log('\n=== CANDLE CACHE DIAGNOSTIC ===\n');

const cache = getCandleCache();

for (const symbol of symbols) {
  console.log(`\n📊 ${symbol}:`);
  for (const tf of timeframes) {
    const candles = cache.getCandles(symbol, tf, 50);
    console.log(`  ${tf}: ${candles.length} candles ${candles.length >= 20 ? '✅' : '❌ INSUFFICIENT'}`);
    if (candles.length > 0) {
      console.log(`    Latest: ${new Date(candles[candles.length - 1].timestamp).toISOString()} - Close: $${candles[candles.length - 1].close}`);
    }
  }
}

console.log('\n=== END DIAGNOSTIC ===\n');
