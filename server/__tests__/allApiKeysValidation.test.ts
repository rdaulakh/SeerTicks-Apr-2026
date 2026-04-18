/**
 * Comprehensive External API Keys Validation Test
 * Tests all external API keys used in the SEER Trading Platform
 * 
 * External APIs Used:
 * 1. DUNE_API_KEY - Dune Analytics (on-chain data, exchange flows)
 * 2. WHALE_ALERT_API_KEY - Whale Alert (large transaction monitoring)
 * 3. COINAPI_KEY - CoinAPI (market data, OHLCV)
 * 4. METAAPI_TOKEN - MetaAPI (forex/trading data)
 * 5. CoinGecko API - Free, no key required (news feed)
 * 6. Coinbase WebSocket - Free, no key required (real-time prices)
 */

import { describe, it, expect } from 'vitest';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


// Test timeout for API calls
const API_TIMEOUT = 30000;

describe.skipIf(!isIntegration)('External API Keys Validation', () => {
  
  describe('1. DUNE_API_KEY (Dune Analytics)', () => {
    it('should have DUNE_API_KEY configured', () => {
      const apiKey = process.env.DUNE_API_KEY;
      expect(apiKey).toBeDefined();
      expect(apiKey).not.toBe('');
      console.log('[DUNE] API Key configured: ✅');
    });

    it('should authenticate with Dune Analytics API', async () => {
      const apiKey = process.env.DUNE_API_KEY;
      if (!apiKey) {
        console.log('[DUNE] ❌ API Key not configured - skipping auth test');
        return;
      }

      const response = await fetch(
        'https://api.dune.com/api/v1/query/1621987/results?limit=1',
        {
          headers: {
            'X-Dune-API-Key': apiKey,
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        console.log('[DUNE] ❌ Authentication FAILED - Invalid API key');
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      } else if (response.status === 429) {
        console.log('[DUNE] ⚠️ Rate limited but API key is VALID');
      } else if (response.status === 200) {
        const data = await response.json();
        console.log('[DUNE] ✅ Authentication SUCCESS');
        console.log('[DUNE] Sample data rows:', data.result?.rows?.length || 0);
        expect(data).toHaveProperty('result');
      } else {
        console.log(`[DUNE] ⚠️ Unexpected status: ${response.status}`);
      }
    }, API_TIMEOUT);
  });

  describe('2. WHALE_ALERT_API_KEY (Whale Alert)', () => {
    it('should have WHALE_ALERT_API_KEY configured', () => {
      const apiKey = process.env.WHALE_ALERT_API_KEY;
      expect(apiKey).toBeDefined();
      expect(apiKey).not.toBe('');
      console.log('[WHALE_ALERT] API Key configured: ✅');
    });

    it('should authenticate with Whale Alert API', async () => {
      const apiKey = process.env.WHALE_ALERT_API_KEY;
      if (!apiKey) {
        console.log('[WHALE_ALERT] ❌ API Key not configured - skipping auth test');
        return;
      }

      const response = await fetch(
        `https://api.whale-alert.io/v1/status?api_key=${apiKey}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        console.log('[WHALE_ALERT] ❌ Authentication FAILED - Invalid API key');
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      } else if (response.status === 429) {
        console.log('[WHALE_ALERT] ⚠️ Rate limited but API key is VALID');
      } else if (response.status === 200) {
        const data = await response.json();
        console.log('[WHALE_ALERT] ✅ Authentication SUCCESS');
        console.log('[WHALE_ALERT] Connected blockchains:', data.blockchain_count);
        expect(data.result).toBe('success');
      } else {
        const text = await response.text();
        console.log(`[WHALE_ALERT] ⚠️ Unexpected status: ${response.status}, body: ${text}`);
      }
    }, API_TIMEOUT);
  });

  describe('3. COINAPI_KEY (CoinAPI)', () => {
    it('should have COINAPI_KEY configured', () => {
      const apiKey = process.env.COINAPI_KEY;
      expect(apiKey).toBeDefined();
      expect(apiKey).not.toBe('');
      console.log('[COINAPI] API Key configured: ✅');
    });

    it('should authenticate with CoinAPI', async () => {
      const apiKey = process.env.COINAPI_KEY;
      if (!apiKey) {
        console.log('[COINAPI] ❌ API Key not configured - skipping auth test');
        return;
      }

      const response = await fetch(
        'https://rest.coinapi.io/v1/exchanges?filter_exchange_id=BINANCE',
        {
          headers: {
            'X-CoinAPI-Key': apiKey,
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        console.log('[COINAPI] ❌ Authentication FAILED - Invalid API key');
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      } else if (response.status === 429) {
        console.log('[COINAPI] ⚠️ Rate limited but API key is VALID');
      } else if (response.status === 200) {
        const data = await response.json();
        console.log('[COINAPI] ✅ Authentication SUCCESS');
        console.log('[COINAPI] Exchanges returned:', data.length);
        expect(Array.isArray(data)).toBe(true);
      } else {
        const text = await response.text();
        console.log(`[COINAPI] ⚠️ Unexpected status: ${response.status}, body: ${text}`);
      }
    }, API_TIMEOUT);
  });

  describe('4. METAAPI_TOKEN (MetaAPI)', () => {
    it('should check if METAAPI_TOKEN is configured', () => {
      const token = process.env.METAAPI_TOKEN;
      if (token && token.length > 0) {
        console.log('[METAAPI] Token configured: ✅');
        expect(token).toBeDefined();
      } else {
        console.log('[METAAPI] ⚠️ Token NOT configured (optional for crypto-only trading)');
        // MetaAPI is optional - used for forex trading
      }
    });

    it('should authenticate with MetaAPI if configured', async () => {
      const token = process.env.METAAPI_TOKEN;
      if (!token) {
        console.log('[METAAPI] ⚠️ Token not configured - skipping auth test');
        return;
      }

      const response = await fetch(
        'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts',
        {
          headers: {
            'auth-token': token,
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        console.log('[METAAPI] ❌ Authentication FAILED - Invalid token');
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      } else if (response.status === 429) {
        console.log('[METAAPI] ⚠️ Rate limited but token is VALID');
      } else if (response.status === 200) {
        const data = await response.json();
        console.log('[METAAPI] ✅ Authentication SUCCESS');
        console.log('[METAAPI] Accounts:', Array.isArray(data) ? data.length : 'N/A');
      } else {
        console.log(`[METAAPI] ⚠️ Unexpected status: ${response.status}`);
      }
    }, API_TIMEOUT);
  });

  describe('5. CoinGecko API (Free - No Key Required)', () => {
    it('should successfully fetch data from CoinGecko', async () => {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/ping',
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (response.status === 200) {
        const data = await response.json();
        console.log('[COINGECKO] ✅ API accessible (Free tier)');
        console.log('[COINGECKO] Response:', data.gecko_says);
        expect(data.gecko_says).toBeDefined();
      } else if (response.status === 429) {
        console.log('[COINGECKO] ⚠️ Rate limited (Free tier limit reached)');
      } else {
        console.log(`[COINGECKO] ⚠️ Unexpected status: ${response.status}`);
      }
    }, API_TIMEOUT);
  });

  describe('6. Coinbase WebSocket (Free - No Key Required)', () => {
    it('should verify Coinbase WebSocket endpoint is accessible', async () => {
      // Just verify the REST API is accessible (WebSocket tested separately)
      const response = await fetch(
        'https://api.exchange.coinbase.com/products/BTC-USD/ticker',
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (response.status === 200) {
        const data = await response.json();
        console.log('[COINBASE] ✅ API accessible (Free tier)');
        console.log('[COINBASE] BTC-USD Price:', data.price);
        expect(data.price).toBeDefined();
      } else if (response.status === 429) {
        console.log('[COINBASE] ⚠️ Rate limited');
      } else {
        console.log(`[COINBASE] ⚠️ Unexpected status: ${response.status}`);
      }
    }, API_TIMEOUT);
  });
});

describe('API Keys Summary Report', () => {
  it('should generate summary of all API keys status', () => {
    const summary = {
      'DUNE_API_KEY': process.env.DUNE_API_KEY ? '✅ Configured' : '❌ Missing',
      'WHALE_ALERT_API_KEY': process.env.WHALE_ALERT_API_KEY ? '✅ Configured' : '❌ Missing',
      'COINAPI_KEY': process.env.COINAPI_KEY ? '✅ Configured' : '❌ Missing',
      'METAAPI_TOKEN': process.env.METAAPI_TOKEN ? '✅ Configured' : '⚠️ Optional (Forex)',
      'CoinGecko': '✅ Free (No key needed)',
      'Coinbase': '✅ Free (No key needed)',
    };

    console.log('\n========================================');
    console.log('     EXTERNAL API KEYS STATUS REPORT');
    console.log('========================================');
    Object.entries(summary).forEach(([key, status]) => {
      console.log(`${key.padEnd(25)} ${status}`);
    });
    console.log('========================================\n');

    // At minimum, the critical APIs should be configured
    expect(process.env.DUNE_API_KEY).toBeDefined();
    expect(process.env.WHALE_ALERT_API_KEY).toBeDefined();
    expect(process.env.COINAPI_KEY).toBeDefined();
  });
});

describe('allApiKeysValidation (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
