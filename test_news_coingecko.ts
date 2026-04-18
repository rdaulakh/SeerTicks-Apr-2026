/**
 * Test NewsSentinel with CoinGecko News API integration
 */

import { NewsSentinel } from './server/agents/NewsSentinel.js';

async function testNewsSentinel() {
  console.log('='.repeat(60));
  console.log('Testing NewsSentinel with CoinGecko News API');
  console.log('='.repeat(60));

  const agent = new NewsSentinel({
    name: 'NewsSentinel',
    updateInterval: 300000, // 5 minutes
  });

  await agent.start();

  // Test with Bitcoin
  console.log('\n📰 Testing Bitcoin news fetching...\n');
  const btcSignal = await agent.generateSignal('BTCUSDT');

  console.log('BTC Signal:', {
    signal: btcSignal.signal,
    confidence: `${(btcSignal.confidence * 100).toFixed(1)}%`,
    strength: btcSignal.strength.toFixed(2),
    reasoning: btcSignal.reasoning,
    newsCount: btcSignal.evidence?.newsCount || 0,
    topHeadlines: btcSignal.evidence?.topHeadlines || [],
  });

  // Test with Ethereum
  console.log('\n📰 Testing Ethereum news fetching...\n');
  const ethSignal = await agent.generateSignal('ETHUSDT');

  console.log('ETH Signal:', {
    signal: ethSignal.signal,
    confidence: `${(ethSignal.confidence * 100).toFixed(1)}%`,
    strength: ethSignal.strength.toFixed(2),
    reasoning: ethSignal.reasoning,
    newsCount: ethSignal.evidence?.newsCount || 0,
    topHeadlines: ethSignal.evidence?.topHeadlines || [],
  });

  await agent.stop();

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test complete!');
  console.log('='.repeat(60));
}

testNewsSentinel().catch(console.error);
