import { TechnicalAnalyst } from './server/agents/TechnicalAnalyst.js';
import { getCandleCache } from './server/WebSocketCandleCache.js';

console.log("=== Testing TechnicalAnalyst with Seeded Cache ===\n");

// Create TechnicalAnalyst instance
const analyst = new TechnicalAnalyst();

// Test with BTCUSDT
const symbol = 'BTCUSDT';
const context = {
  symbol,
  currentPrice: 91436.23,
  volume24h: 12832.73,
  timestamp: new Date()
};

console.log(`Testing ${symbol} at $${context.currentPrice}...`);

// Check cache has data
const cache = getCandleCache();
const candles1h = cache.getCandles(symbol, '1h', 200);
console.log(`\nCache status: ${candles1h.length}/200 candles for ${symbol} 1h`);

if (candles1h.length < 50) {
  console.log("❌ Insufficient candles - TechnicalAnalyst needs 50+ candles");
  process.exit(1);
}

// Generate signal
console.log("\nGenerating signal...");
const signal = await analyst.generateSignal(symbol, context);

console.log("\n=== TechnicalAnalyst Signal ===");
console.log(`Signal: ${signal.signal}`);
console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
console.log(`Strength: ${signal.strength.toFixed(2)}`);
console.log(`Execution Score: ${signal.executionScore}/100`);
console.log(`\nReasoning: ${signal.reasoning.substring(0, 200)}...`);

if (signal.executionScore === undefined || signal.executionScore === 0) {
  console.log("\n❌ FAILED: Execution score is missing or zero");
  process.exit(1);
}

console.log("\n✅ SUCCESS: TechnicalAnalyst generated signal with execution score!");
process.exit(0);
