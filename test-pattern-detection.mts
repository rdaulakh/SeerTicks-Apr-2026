import { detectAllPatterns } from './server/agents/PatternDetection.ts';

// Sample candle data for testing
const sampleCandles = [
  // Simulate a bullish trend with potential patterns
  { timestamp: Date.now() - 50 * 60000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { timestamp: Date.now() - 49 * 60000, open: 101, high: 103, low: 100, close: 102, volume: 1100 },
  { timestamp: Date.now() - 48 * 60000, open: 102, high: 104, low: 101, close: 103, volume: 1200 },
  { timestamp: Date.now() - 47 * 60000, open: 103, high: 105, low: 102, close: 104, volume: 1300 },
  { timestamp: Date.now() - 46 * 60000, open: 104, high: 106, low: 103, close: 105, volume: 1400 },
  { timestamp: Date.now() - 45 * 60000, open: 105, high: 107, low: 104, close: 106, volume: 1500 },
  { timestamp: Date.now() - 44 * 60000, open: 106, high: 108, low: 105, close: 107, volume: 1600 },
  { timestamp: Date.now() - 43 * 60000, open: 107, high: 109, low: 106, close: 108, volume: 1700 },
  { timestamp: Date.now() - 42 * 60000, open: 108, high: 110, low: 107, close: 109, volume: 1800 },
  { timestamp: Date.now() - 41 * 60000, open: 109, high: 111, low: 108, close: 110, volume: 1900 },
  { timestamp: Date.now() - 40 * 60000, open: 110, high: 112, low: 109, close: 111, volume: 2000 },
  { timestamp: Date.now() - 39 * 60000, open: 111, high: 113, low: 110, close: 112, volume: 2100 },
  { timestamp: Date.now() - 38 * 60000, open: 112, high: 114, low: 111, close: 113, volume: 2200 },
  { timestamp: Date.now() - 37 * 60000, open: 113, high: 115, low: 112, close: 114, volume: 2300 },
  { timestamp: Date.now() - 36 * 60000, open: 114, high: 116, low: 113, close: 115, volume: 2400 },
  { timestamp: Date.now() - 35 * 60000, open: 115, high: 117, low: 114, close: 116, volume: 2500 },
  { timestamp: Date.now() - 34 * 60000, open: 116, high: 118, low: 115, close: 117, volume: 2600 },
  { timestamp: Date.now() - 33 * 60000, open: 117, high: 119, low: 116, close: 118, volume: 2700 },
  { timestamp: Date.now() - 32 * 60000, open: 118, high: 120, low: 117, close: 119, volume: 2800 },
  { timestamp: Date.now() - 31 * 60000, open: 119, high: 121, low: 118, close: 120, volume: 2900 },
  { timestamp: Date.now() - 30 * 60000, open: 120, high: 122, low: 119, close: 121, volume: 3000 },
  { timestamp: Date.now() - 29 * 60000, open: 121, high: 123, low: 120, close: 122, volume: 3100 },
  { timestamp: Date.now() - 28 * 60000, open: 122, high: 124, low: 121, close: 123, volume: 3200 },
  { timestamp: Date.now() - 27 * 60000, open: 123, high: 125, low: 122, close: 124, volume: 3300 },
  { timestamp: Date.now() - 26 * 60000, open: 124, high: 126, low: 123, close: 125, volume: 3400 },
  { timestamp: Date.now() - 25 * 60000, open: 125, high: 127, low: 124, close: 126, volume: 3500 },
  { timestamp: Date.now() - 24 * 60000, open: 126, high: 128, low: 125, close: 127, volume: 3600 },
  { timestamp: Date.now() - 23 * 60000, open: 127, high: 129, low: 126, close: 128, volume: 3700 },
  { timestamp: Date.now() - 22 * 60000, open: 128, high: 130, low: 127, close: 129, volume: 3800 },
  { timestamp: Date.now() - 21 * 60000, open: 129, high: 131, low: 128, close: 130, volume: 3900 },
];

console.log('=== Pattern Detection Test ===\n');
console.log('Testing with', sampleCandles.length, 'candles\n');

const currentPrice = 130;
const patterns = detectAllPatterns(sampleCandles, '5m', currentPrice);

console.log('Detected patterns:', patterns.length);
console.log('\nPattern Details:');
patterns.forEach((pattern, i) => {
  console.log(`\n${i + 1}. ${pattern.name}`);
  console.log(`   Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
  console.log(`   Timeframe: ${pattern.timeframe}`);
  console.log(`   Description: ${pattern.description}`);
});

if (patterns.length === 0) {
  console.log('\n⚠️  No patterns detected. This might indicate:');
  console.log('   1. Insufficient candle data');
  console.log('   2. Pattern detection algorithms need tuning');
  console.log('   3. Market conditions do not match any pattern criteria');
} else {
  console.log('\n✅ Pattern detection working!');
  console.log(`   Found ${patterns.length} pattern(s) with confidence ranging from ${Math.min(...patterns.map(p => p.confidence * 100)).toFixed(1)}% to ${Math.max(...patterns.map(p => p.confidence * 100)).toFixed(1)}%`);
}

process.exit(0);
