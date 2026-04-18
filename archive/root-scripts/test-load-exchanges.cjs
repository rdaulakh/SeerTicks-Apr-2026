const { getActiveExchangesWithKeys, getAllActiveTradingSymbols } = require('./server/exchangeDb.ts');

async function testLoadExchanges() {
  try {
    const userId = 1260007; // Your user ID
    
    console.log(`\n=== Testing getActiveExchangesWithKeys for userId ${userId} ===\n`);
    
    const exchanges = await getActiveExchangesWithKeys(userId);
    
    console.log(`Found ${exchanges.length} active exchanges:`);
    console.log(JSON.stringify(exchanges, null, 2));
    
    console.log(`\n=== Testing getAllActiveTradingSymbols for userId ${userId} ===\n`);
    
    const symbols = await getAllActiveTradingSymbols(userId);
    
    console.log(`Found ${symbols.length} active trading symbols:`);
    console.log(JSON.stringify(symbols, null, 2));
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

testLoadExchanges();
