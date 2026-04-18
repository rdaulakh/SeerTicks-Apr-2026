/**
 * Coinbase CDP API Connection Test
 * Tests Advanced Trade API with JWT authentication
 */

import { CoinbaseAdapter } from './server/exchanges/CoinbaseAdapter';

// CDP API credentials (replace with your actual credentials)
const CDP_API_KEY = process.env.COINBASE_CDP_KEY || 'organizations/b36cead7-c49b-44e9-a773-78f59f51f472/apiKeys/0f3cc5c3-41ea-49ae-a778-d77d05d66fd0';
const CDP_API_SECRET = process.env.COINBASE_CDP_SECRET || `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIGRXSvLMZPOgU0fDG3rJVLvQdYKQKQQKQKQKQKQKQKQ
oAoGCCqGSM49AwEHoUQDQgAEKQKQKQKQKQKQKQKQKQKQKQKQKQKQ
KQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQ==
-----END EC PRIVATE KEY-----`;

async function testCoinbaseCDP() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║      COINBASE CDP API (JWT) CONNECTION TEST                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('API Key:', CDP_API_KEY);
  console.log('API Secret (first line):', CDP_API_SECRET.split('\n')[0]);
  console.log('API Secret (last line):', CDP_API_SECRET.split('\n').filter(l => l.trim()).pop());
  console.log('\n' + '─'.repeat(66) + '\n');

  try {
    console.log('Creating CoinbaseAdapter with JWT authentication...');
    const adapter = new CoinbaseAdapter(CDP_API_KEY, CDP_API_SECRET);
    
    console.log('\nTest 1: Testing connection...');
    const isConnected = await adapter.testConnection();
    
    if (!isConnected) {
      console.error('\n❌ FAILED: testConnection() returned false');
      console.log('\n' + '═'.repeat(66));
      console.log('RESULT: ❌ Connection failed');
      console.log('═'.repeat(66) + '\n');
      process.exit(1);
    }
    
    console.log('✅ Connection successful!\n');
    
    // Test 2: Get balances
    console.log('Test 2: Fetching account balances...');
    const balances = await adapter.getAccountBalance();
    console.log('✅ Balances retrieved:', balances.length, 'accounts');
    if (balances.length > 0) {
      console.log('   Sample:', balances[0]);
    }
    console.log('');
    
    // Test 3: Get BTC price
    console.log('Test 3: Fetching BTC-USD price...');
    const btcPrice = await adapter.getCurrentPrice('BTC-USD');
    console.log('✅ BTC Price: $' + btcPrice.toFixed(2));
    console.log('');
    
    // Test 4: Get order book
    console.log('Test 4: Fetching BTC-USD order book...');
    const orderBook = await adapter.getOrderBook('BTC-USD', 5);
    console.log('✅ Order book retrieved:');
    console.log('   Bids:', orderBook.bids.length);
    console.log('   Asks:', orderBook.asks.length);
    if (orderBook.bids.length > 0) {
      console.log('   Best bid:', orderBook.bids[0].price, '@', orderBook.bids[0].quantity);
    }
    if (orderBook.asks.length > 0) {
      console.log('   Best ask:', orderBook.asks[0].price, '@', orderBook.asks[0].quantity);
    }
    
    console.log('\n' + '═'.repeat(66));
    console.log('RESULT: ✅ All tests passed! Coinbase CDP API working perfectly.');
    console.log('═'.repeat(66) + '\n');
    
    console.log('Next steps:');
    console.log('  1. Go to Settings → Advanced → Exchanges');
    console.log('  2. Click "Add Exchange"');
    console.log('  3. Select "Coinbase"');
    console.log('  4. Paste your CDP API Key and Secret');
    console.log('  5. Click "Test Connection"');
    console.log('  6. If successful, add trading symbols (BTC-USD, ETH-USD, etc.)');
    console.log('');
    
    process.exit(0);
    
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error('\nFull error:', error);
    
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    TROUBLESHOOTING                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    if (error.message.includes('401')) {
      console.log('401 Unauthorized - Your CDP API credentials are invalid.');
      console.log('\nHow to get CDP API keys:');
      console.log('  1. Go to https://portal.cdp.coinbase.com/access/api');
      console.log('  2. Click "Create API Key"');
      console.log('  3. Name: "SEER Trading Bot"');
      console.log('  4. Permissions: Select "View" and "Trade"');
      console.log('  5. Copy the API Key (format: organizations/.../apiKeys/...)');
      console.log('  6. Copy the Private Key (starts with -----BEGIN EC PRIVATE KEY-----)');
      console.log('  7. Update this script with your credentials');
      console.log('');
    } else if (error.message.includes('403')) {
      console.log('403 Forbidden - Your API key lacks required permissions.');
      console.log('\nFix:');
      console.log('  1. Go to https://portal.cdp.coinbase.com/access/api');
      console.log('  2. Find your API key');
      console.log('  3. Edit permissions to include "View" and "Trade"');
      console.log('');
    } else if (error.message.includes('ENOTFOUND')) {
      console.log('Network error - Cannot reach Coinbase API.');
      console.log('\nCheck:');
      console.log('  1. Internet connection');
      console.log('  2. Firewall settings');
      console.log('  3. VPN/proxy configuration');
      console.log('');
    } else {
      console.log('Unknown error. Check the error message above.');
      console.log('');
    }
    
    console.log('═'.repeat(66));
    console.log('RESULT: ❌ Connection failed. See troubleshooting tips above.');
    console.log('═'.repeat(66) + '\n');
    
    process.exit(1);
  }
}

testCoinbaseCDP();
