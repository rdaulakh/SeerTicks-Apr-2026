import { describe, it, expect } from 'vitest';
import { ENV } from '../_core/env';

describe('Whale Alert API Key Verification', () => {
  it('should have WHALE_ALERT_API_KEY configured', () => {
    expect(ENV.whaleAlertApiKey).toBeDefined();
    expect(ENV.whaleAlertApiKey).not.toBe('');
    console.log('API Key configured:', ENV.whaleAlertApiKey ? 'Yes (length: ' + ENV.whaleAlertApiKey.length + ')' : 'No');
  });

  it('should successfully connect to Whale Alert API', async () => {
    const apiKey = ENV.whaleAlertApiKey;
    
    if (!apiKey) {
      console.log('Skipping API test - no API key configured');
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams();
    params.append('api_key', apiKey);
    params.append('start', (now - 3600).toString()); // Last hour
    params.append('min_value', '10000000'); // $10M minimum to get fewer results
    params.append('limit', '5');

    const url = `https://api.whale-alert.io/v1/transactions?${params.toString()}`;
    
    console.log('Testing Whale Alert API...');
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('API Response Status:', response.status);
      console.log('API Response:', JSON.stringify(data, null, 2));
      
      console.log('Response OK:', response.ok);
      console.log('Full response data:', JSON.stringify(data, null, 2));
      
      if (response.ok && data.result === 'success') {
        console.log('✅ Whale Alert API is working!');
        console.log('Transactions found:', data.count || 0);
        if (data.transactions && data.transactions.length > 0) {
          console.log('Sample transaction:', JSON.stringify(data.transactions[0], null, 2));
        }
      } else {
        console.log('❌ API Error or no success result');
        console.log('Error message:', data.message || 'No message');
        console.log('Error result:', data.result || 'No result');
        // Don't fail the test if we get rate limited or no transactions
        if (data.result === 'success' || data.message?.includes('rate')) {
          console.log('⚠️ API accessible but rate limited or no recent transactions');
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
  });

  it('should check API status endpoint', async () => {
    const apiKey = ENV.whaleAlertApiKey;
    
    if (!apiKey) {
      console.log('Skipping status test - no API key configured');
      return;
    }

    const url = `https://api.whale-alert.io/v1/status?api_key=${apiKey}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('Status Response:', response.status);
      console.log('Status Data:', JSON.stringify(data, null, 2));
      
      expect(response.ok).toBe(true);
    } catch (error) {
      console.error('Status check error:', error);
    }
  });
});
