/**
 * Check WebSocket Candle Cache Status
 * Diagnoses why PatternMatcher shows 0% confidence
 */

import { getCandleCache } from './server/WebSocketCandleCache.js';

async function checkCandleCache() {
  console.log('🔍 Checking WebSocket Candle Cache Status...\n');

  const candleCache = getCandleCache();
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const timeframes = ['1d', '4h', '5m', '1m'];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Candle Cache Status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of symbols) {
    console.log(`Symbol: ${symbol}`);
    console.log('─'.repeat(40));
    
    for (const timeframe of timeframes) {
      const candles = candleCache.getCandles(symbol, timeframe, 100);
      const status = candles.length >= 20 ? '✅' : '❌';
      console.log(`  ${status} ${timeframe}: ${candles.length} candles ${candles.length < 20 ? '(NEED 20+)' : ''}`);
      
      if (candles.length > 0) {
        const latest = candles[candles.length - 1];
        console.log(`      Latest: ${new Date(latest.timestamp).toISOString()} | Close: $${latest.close}`);
      }
    }
    console.log();
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Diagnosis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const btc1d = candleCache.getCandles('BTCUSDT', '1d', 100);
  const btc4h = candleCache.getCandles('BTCUSDT', '4h', 100);
  const btc5m = candleCache.getCandles('BTCUSDT', '5m', 100);

  if (btc1d.length < 20 || btc4h.length < 20 || btc5m.length < 20) {
    console.log('❌ PatternMatcher will return 0% confidence');
    console.log('   Reason: Insufficient candles in cache');
    console.log('   Required: 20+ candles in each timeframe (1d, 4h, 5m)');
    console.log(`   Current: 1d=${btc1d.length}, 4h=${btc4h.length}, 5m=${btc5m.length}`);
    console.log('\n💡 Solution: Wait for WebSocket to populate cache OR call seedCandleCache()');
  } else {
    console.log('✅ PatternMatcher has sufficient data');
    console.log(`   1d=${btc1d.length}, 4h=${btc4h.length}, 5m=${btc5m.length}`);
  }

  process.exit(0);
}

checkCandleCache();
