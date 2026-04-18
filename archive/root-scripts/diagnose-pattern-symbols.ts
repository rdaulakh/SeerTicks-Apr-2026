import { getCandleCache } from './server/WebSocketCandleCache';
import { detectAllPatterns } from './server/agents/PatternDetection';
import { getValidatedPatterns } from './server/db/patternQueries';

const symbols = ['BTCUSD', 'ETHUSD'];
const timeframes = ['1m', '5m', '4h', '1d'];

console.log('=== Pattern Detection Diagnostic ===\n');

// Check validated patterns in database
const validatedPatterns = await getValidatedPatterns();
console.log(`Database has ${validatedPatterns.length} validated patterns\n`);

const candleCache = getCandleCache();

for (const symbol of symbols) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Symbol: ${symbol}`);
  console.log('='.repeat(60));
  
  for (const timeframe of timeframes) {
    const candles = candleCache.getCandles(symbol, timeframe, 50);
    console.log(`\n[${timeframe}] Cached candles: ${candles.length}`);
    
    if (candles.length >= 20) {
      const marketData = candles.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));
      
      const currentPrice = candles[candles.length - 1]?.close || 0;
      const detectedPatterns = detectAllPatterns(marketData, timeframe, currentPrice);
      
      console.log(`  Detected patterns: ${detectedPatterns.length}`);
      detectedPatterns.forEach(p => {
        console.log(`    - ${p.name}: confidence=${(p.confidence * 100).toFixed(1)}%`);
        
        // Check if this pattern exists in validated patterns
        const validated = validatedPatterns.find(
          v => v.patternName === p.name && v.timeframe === timeframe
        );
        
        if (validated) {
          console.log(`      ✅ Validated in DB: WR=${(validated.winRate * 100).toFixed(1)}%, Conf=${validated.confidenceScore ? (validated.confidenceScore * 100).toFixed(1) : 'N/A'}%`);
        } else {
          console.log(`      ❌ NOT validated in DB`);
        }
      });
    } else {
      console.log(`  ⚠️  Insufficient data (need 20+)`);
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log('Diagnostic complete');
console.log('='.repeat(60));

process.exit(0);
