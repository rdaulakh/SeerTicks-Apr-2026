import { OrderFlowAnalyst } from './server/agents/OrderFlowAnalyst';
import { CoinbaseAdapter } from './server/exchanges/CoinbaseAdapter';

async function testOrderFlowAnalyst() {
  console.log('\n=== Testing OrderFlowAnalyst Fix ===\n');
  
  // Get credentials from environment
  const apiKey = process.env.COINBASE_API_KEY;
  const apiSecret = process.env.COINBASE_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    console.error('❌ Coinbase credentials not found in environment');
    console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('COINBASE')));
    return;
  }
  
  console.log('✅ Coinbase credentials found');
  
  // Initialize exchange
  const exchange = new CoinbaseAdapter(apiKey, apiSecret);
  console.log('✅ CoinbaseAdapter initialized');
  
  // Initialize agent
  const agent = new OrderFlowAnalyst();
  agent.setExchange(exchange);
  agent.setCurrentPrice(95000); // Set mock price
  console.log('✅ OrderFlowAnalyst initialized');
  
  // Start agent
  await agent.start();
  console.log('✅ OrderFlowAnalyst started');
  
  // Generate signal
  console.log('\n🔍 Generating signal for BTC-USD...\n');
  const startTime = Date.now();
  
  try {
    const signal = await agent.generateSignal('BTC-USD');
    const duration = Date.now() - startTime;
    
    console.log('=== Signal Generated ===');
    console.log(`Agent: ${signal.agentName}`);
    console.log(`Symbol: ${signal.symbol}`);
    console.log(`Signal: ${signal.signal}`);
    console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`Strength: ${(signal.strength * 100).toFixed(1)}%`);
    console.log(`Reasoning: ${signal.reasoning}`);
    console.log(`Processing Time: ${signal.processingTime}ms`);
    console.log(`Total Duration: ${duration}ms`);
    console.log(`Data Freshness: ${signal.dataFreshness?.toFixed(1)}s`);
    
    if (signal.evidence) {
      console.log('\n=== Evidence ===');
      console.log(`Bid Volume: ${signal.evidence.bidVolume?.toFixed(2)}`);
      console.log(`Ask Volume: ${signal.evidence.askVolume?.toFixed(2)}`);
      console.log(`Imbalance: ${signal.evidence.imbalance?.toFixed(2)}`);
      console.log(`Order Book Score: ${signal.evidence.orderBookScore}`);
      console.log(`Execution Score: ${signal.evidence.executionScore}`);
      console.log(`Large Orders: ${signal.evidence.largeOrdersCount || 0}`);
    }
    
    // Verify fix
    console.log('\n=== Verification ===');
    if (signal.reasoning.includes('No order book data available')) {
      console.log('❌ FAILED: Agent still has no order book data');
    } else if (signal.reasoning.includes('Failed to fetch order book')) {
      console.log('❌ FAILED: Agent failed to fetch order book');
    } else if (signal.evidence && signal.evidence.bidVolume > 0) {
      console.log('✅ SUCCESS: OrderFlowAnalyst is generating signals with order book data!');
    } else {
      console.log('⚠️  WARNING: Signal generated but evidence is incomplete');
    }
    
  } catch (error) {
    console.error('❌ Error generating signal:', error);
  }
  
  // Stop agent
  await agent.stop();
  console.log('\n✅ OrderFlowAnalyst stopped');
  
  console.log('\n=== Test Complete ===\n');
}

testOrderFlowAnalyst().catch(console.error);
