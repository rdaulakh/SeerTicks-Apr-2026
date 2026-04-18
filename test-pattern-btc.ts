import { CoinbaseAdapter } from './server/exchanges/CoinbaseAdapter';
import { PatternMatcher } from './server/agents/PatternMatcher';

async function testBTCPattern() {
  console.log('\n=== TESTING BTC PATTERN DETECTION ===\n');
  
  // Initialize Coinbase adapter
  const adapter = new CoinbaseAdapter({
    apiKey: process.env.COINBASE_API_KEY || '',
    apiSecret: process.env.COINBASE_API_SECRET || '',
    passphrase: process.env.COINBASE_PASSPHRASE || ''
  });
  
  // Initialize pattern matcher
  const patternAgent = new PatternMatcher();
  patternAgent.setExchange(adapter);
  await patternAgent['initialize']();
  
  // Test BTC-USD
  console.log('\n📊 Testing BTC-USD pattern detection...\n');
  const btcSignal = await patternAgent['analyze']('BTC-USD');
  
  console.log('\n=== BTC-USD RESULT ===');
  console.log(`Action: ${btcSignal.action}`);
  console.log(`Confidence: ${(btcSignal.confidence * 100).toFixed(1)}%`);
  console.log(`Reasoning: ${btcSignal.reasoning}`);
  
  // Test ETH-USD
  console.log('\n📊 Testing ETH-USD pattern detection...\n');
  const ethSignal = await patternAgent['analyze']('ETH-USD');
  
  console.log('\n=== ETH-USD RESULT ===');
  console.log(`Action: ${ethSignal.action}`);
  console.log(`Confidence: ${(ethSignal.confidence * 100).toFixed(1)}%`);
  console.log(`Reasoning: ${ethSignal.reasoning}`);
  
  console.log('\n=== TEST COMPLETE ===\n');
  process.exit(0);
}

testBTCPattern().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
