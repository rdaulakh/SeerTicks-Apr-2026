/**
 * Coinbase Connection Test Script
 * 
 * Tests Coinbase Advanced Trade API connection with detailed error logging
 */

import crypto from 'crypto';

// Test credentials (user will replace with real ones)
const API_KEY = '5b4a6070-cc5c-45c6-b115-ceb89f23b7bc';
const API_SECRET = 'ZzYizGrYNOnX1RnwNLNCoELUqU8o9qKNNQJQmYRdV60lhx08g4aNfYCmCDjExPzeQKqP0JS5X6nidCkSB1LXiQ==';

const baseUrl = 'https://api.coinbase.com/api/v3/brokerage';

function generateSignature(timestamp: string, method: string, path: string, body: string = ''): string {
  const message = timestamp + method + path + body;
  return crypto.createHmac('sha256', API_SECRET).update(message).digest('hex');
}

async function testCoinbaseConnection() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         COINBASE CONNECTION TEST                               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('API Key:', API_KEY.substring(0, 10) + '...');
  console.log('API Secret:', API_SECRET.substring(0, 10) + '...\n');

  try {
    // Test 1: Accounts endpoint
    console.log('Test 1: Fetching accounts...');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = '/api/v3/brokerage/accounts';
    const signature = generateSignature(timestamp, 'GET', path, '');

    console.log('Request details:');
    console.log('  Timestamp:', timestamp);
    console.log('  Path:', path);
    console.log('  Signature:', signature.substring(0, 20) + '...');
    console.log('  Full URL:', baseUrl + '/accounts\n');

    const headers: Record<string, string> = {
      'CB-ACCESS-KEY': API_KEY,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };

    console.log('Headers:');
    console.log('  CB-ACCESS-KEY:', headers['CB-ACCESS-KEY'].substring(0, 10) + '...');
    console.log('  CB-ACCESS-SIGN:', headers['CB-ACCESS-SIGN'].substring(0, 20) + '...');
    console.log('  CB-ACCESS-TIMESTAMP:', headers['CB-ACCESS-TIMESTAMP']);
    console.log('  Content-Type:', headers['Content-Type']);
    console.log('');

    const response = await fetch(baseUrl + '/accounts', {
      method: 'GET',
      headers,
    });

    console.log('Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('\n❌ ERROR RESPONSE:');
      console.error(errorText);
      
      try {
        const errorJson = JSON.parse(errorText);
        console.error('\nParsed error:');
        console.error(JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Not JSON
      }

      console.log('\n╔════════════════════════════════════════════════════════════════╗');
      console.log('║                    TROUBLESHOOTING TIPS                        ║');
      console.log('╚════════════════════════════════════════════════════════════════╝\n');

      if (response.status === 401) {
        console.log('401 Unauthorized - Possible causes:');
        console.log('  1. Invalid API key or secret');
        console.log('  2. API key not enabled for Advanced Trade API');
        console.log('  3. Signature generation error');
        console.log('  4. Timestamp out of sync (check system clock)');
      } else if (response.status === 403) {
        console.log('403 Forbidden - Possible causes:');
        console.log('  1. API key lacks required permissions');
        console.log('  2. Account not verified');
        console.log('  3. IP whitelist restriction');
      } else if (response.status === 400) {
        console.log('400 Bad Request - Possible causes:');
        console.log('  1. Malformed request');
        console.log('  2. Invalid headers');
        console.log('  3. Wrong API endpoint');
      }

      console.log('\nHow to create Coinbase API keys:');
      console.log('  1. Go to https://www.coinbase.com/settings/api');
      console.log('  2. Click "New API Key"');
      console.log('  3. Select "Advanced Trade API" (NOT "Coinbase API")');
      console.log('  4. Enable permissions: View, Trade');
      console.log('  5. Copy API Key and API Secret');
      console.log('  6. Paste them into this script and run again\n');

      return false;
    }

    const data = await response.json();
    console.log('\n✅ SUCCESS! Connection established.');
    console.log('\nAccounts found:', data.accounts?.length || 0);
    
    if (data.accounts && data.accounts.length > 0) {
      console.log('\nSample account:');
      const account = data.accounts[0];
      console.log('  Currency:', account.currency);
      console.log('  Available:', account.available_balance?.value || '0');
      console.log('  Hold:', account.hold?.value || '0');
    }

    return true;

  } catch (error: any) {
    console.error('\n❌ NETWORK ERROR:');
    console.error(error.message);
    console.error('\nFull error:');
    console.error(error);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    TROUBLESHOOTING TIPS                        ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('Network error - Possible causes:');
    console.log('  1. No internet connection');
    console.log('  2. Firewall blocking Coinbase API');
    console.log('  3. DNS resolution failure');
    console.log('  4. Coinbase API is down (check https://status.coinbase.com)');

    return false;
  }
}

// Run test
testCoinbaseConnection().then((success) => {
  console.log('\n' + '═'.repeat(66));
  if (success) {
    console.log('RESULT: ✅ Coinbase connection working!');
  } else {
    console.log('RESULT: ❌ Coinbase connection failed. See errors above.');
  }
  console.log('═'.repeat(66) + '\n');
  process.exit(success ? 0 : 1);
});
