import { CoinbaseAdapter } from './server/exchanges/CoinbaseAdapter';

async function testSignals() {
  console.log('\n=== TESTING COINBASE API ===\n');
  
  const adapter = new CoinbaseAdapter({
    apiKey: process.env.COINBASE_API_KEY || '',
    apiSecret: process.env.COINBASE_API_SECRET || '',
    passphrase: process.env.COINBASE_PASSPHRASE || ''
  });
  
  const symbols = ['BTC-USD', 'ETH-USD', 'BNB-USD'];
  
  for (const symbol of symbols) {
    console.log(`\n📊 Testing ${symbol}...`);
    try {
      const price = await adapter.getCurrentPrice(symbol);
      console.log(`  ✅ Price: $${price.toFixed(2)}`);
      
      const candles = await adapter.getMarketData(symbol, '1d', 30);
      console.log(`  ✅ Candles: ${candles.length} fetched`);
    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===\n');
}

testSignals().catch(console.error);
