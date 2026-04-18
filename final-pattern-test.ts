import { getSEERMultiEngine } from './server/seerMainMulti';

async function testAllSymbols() {
  console.log('\n=== FINAL PATTERN CONFIDENCE TEST ===\n');
  
  const userId = 1;
  const engine = await getSEERMultiEngine(userId);
  
  // Check if engine is running
  const status = engine.getStatus();
  console.log('Engine Status:', status);
  console.log('Trading Pairs:', status.tradingPairs);
  console.log('Exchanges:', status.exchanges);
  
  // Wait for signals to generate
  console.log('\nWaiting 5 seconds for signals...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Get latest recommendations
  console.log('=== LATEST SIGNALS ===\n');
  
  const symbols = ['BTCUSD', 'ETHUSD', 'BNBUSD'];
  for (const symbol of symbols) {
    try {
      const orchestrator = engine['symbolOrchestrators'].get(`coinbase_${symbol}`);
      if (orchestrator) {
        const rec = await orchestrator.getFastRecommendation();
        console.log(`${symbol}:`);
        console.log(`  Action: ${rec.action}`);
        console.log(`  Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
        console.log(`  Reasoning: ${rec.reasoning.substring(0, 100)}...`);
        console.log('');
      } else {
        console.log(`${symbol}: ❌ No orchestrator found`);
      }
    } catch (error) {
      console.log(`${symbol}: ❌ Error - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===\n');
  process.exit(0);
}

testAllSymbols().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
