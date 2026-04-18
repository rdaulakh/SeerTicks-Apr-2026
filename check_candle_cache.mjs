// Check candle cache status
import { getCandleCache } from './server/WebSocketCandleCache.ts';

const cache = getCandleCache();

console.log("=== CANDLE CACHE STATUS ===\n");

const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const timeframes = ['1m', '5m', '1h', '4h', '1d'];

for (const symbol of symbols) {
  console.log(`\n${symbol}:`);
  for (const tf of timeframes) {
    const candles = cache.getCandles(symbol, tf, 200);
    console.log(`  ${tf}: ${candles.length} candles`);
  }
}
