import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment
const dotenv = require('dotenv');
dotenv.config();

// Import database functions
const { getActiveExchangesWithKeys } = await import('./server/exchangeDb.js');

async function testApiKeys() {
  console.log('Testing API key retrieval for user 272657...');
  
  try {
    const exchanges = await getActiveExchangesWithKeys(272657);
    console.log('Found exchanges:', exchanges.length);
    
    for (const exchange of exchanges) {
      console.log('\nExchange:', exchange.exchangeName);
      console.log('  ID:', exchange.id);
      console.log('  Has API Key:', !!exchange.apiKey);
      console.log('  Has API Secret:', !!exchange.apiSecret);
      console.log('  Has Valid Keys:', exchange.hasValidKeys);
      
      if (exchange.apiKey) {
        console.log('  API Key (first 20 chars):', exchange.apiKey.substring(0, 20) + '...');
      }
      if (exchange.apiSecret) {
        console.log('  API Secret (first 50 chars):', exchange.apiSecret.substring(0, 50) + '...');
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
  
  process.exit(0);
}

testApiKeys();
