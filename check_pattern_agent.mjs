import { getDb } from './server/db.ts';
import { winningPatterns } from './drizzle/schema.ts';
import { gte } from 'drizzle-orm';
import { getCandleCache } from './server/WebSocketCandleCache.ts';

console.log('=== PATTERN AGENT DIAGNOSTIC ===\n');

// Check 1: Validated Patterns in Database
console.log('1. Checking validated patterns in database...');
try {
  const db = await getDb();
  if (!db) {
    console.error('❌ Database not available');
  } else {
    const patterns = await db.select().from(winningPatterns).where(gte(winningPatterns.winRate, 0.50));
    console.log(`✅ Found ${patterns.length} validated patterns (winRate >= 50%)`);
    if (patterns.length > 0) {
      console.log('Top 5 patterns:');
      patterns.slice(0, 5).forEach(p => {
        console.log(`  - ${p.patternName} (${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, Trades=${p.totalTrades}, PF=${p.profitFactor.toFixed(2)}`);
      });
    } else {
      console.warn('⚠️  No validated patterns found! PatternMatcher will use fallback mode.');
    }
  }
} catch (error) {
  console.error('❌ Error checking patterns:', error.message);
}

// Check 2: Candle Cache Status
console.log('\n2. Checking candle cache status...');
try {
  const candleCache = getCandleCache();
  const symbol = 'BTC-USD';
  const timeframes = ['1m', '5m', '4h', '1d'];
  
  console.log(`Symbol: ${symbol}`);
  for (const tf of timeframes) {
    const candles = candleCache.getCandles(symbol, tf, 50);
    const status = candles.length >= 20 ? '✅' : '❌';
    console.log(`  ${status} ${tf}: ${candles.length} candles (need 20+)`);
  }
  
  if (timeframes.every(tf => candleCache.getCandles(symbol, tf, 50).length >= 20)) {
    console.log('✅ Candle cache has sufficient data');
  } else {
    console.warn('⚠️  Candle cache insufficient! PatternMatcher will use REST API fallback.');
  }
} catch (error) {
  console.error('❌ Error checking candle cache:', error.message);
}

// Check 3: Pattern Detection Test
console.log('\n3. Testing pattern detection...');
try {
  const { detectAllPatterns } = await import('./server/agents/PatternDetection.ts');
  const candleCache = getCandleCache();
  const symbol = 'BTC-USD';
  const candles1d = candleCache.getCandles(symbol, '1d', 50);
  
  if (candles1d.length >= 20) {
    const currentPrice = candles1d[candles1d.length - 1]?.close || 0;
    const detected = detectAllPatterns(
      candles1d.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
      '1d',
      currentPrice
    );
    console.log(`✅ Detected ${detected.length} patterns on 1d timeframe`);
    if (detected.length > 0) {
      console.log('Detected patterns:');
      detected.forEach(p => {
        console.log(`  - ${p.name}: confidence=${(p.confidence * 100).toFixed(1)}%`);
      });
    }
  } else {
    console.warn('⚠️  Not enough candle data to test pattern detection');
  }
} catch (error) {
  console.error('❌ Error testing pattern detection:', error.message);
}

console.log('\n=== DIAGNOSTIC COMPLETE ===');
process.exit(0);
