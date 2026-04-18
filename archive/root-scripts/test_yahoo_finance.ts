import { callDataApi } from './server/_core/dataApi.js';

async function testYahooFinance() {
  console.log('\n=== Testing Yahoo Finance API ===\n');
  
  const symbols = [
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: 'GC=F', name: 'Gold Futures' },
    { symbol: 'DX-Y.NYB', name: 'DXY' }
  ];
  
  for (const { symbol, name } of symbols) {
    console.log(`\nTesting ${name} (${symbol})...`);
    
    try {
      const data = await callDataApi('YahooFinance/get_stock_chart', {
        query: { symbol, region: 'US', interval: '1d', range: '90d' }
      });
      
      const prices = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const timestamps = data?.chart?.result?.[0]?.timestamp || [];
      
      console.log(`  ✅ Received ${prices.length} data points`);
      console.log(`  ✅ Timestamps: ${timestamps.length}`);
      
      if (prices.length > 0) {
        console.log(`  Latest price: ${prices[prices.length - 1]}`);
        console.log(`  Oldest price: ${prices[0]}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
  }
}

testYahooFinance().catch(console.error).finally(() => process.exit(0));
