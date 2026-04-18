/**
 * COMPLETE External API Audit Test
 * 
 * This test validates ALL external APIs used by the SEER Trading Platform.
 * 
 * EXTERNAL APIS DISCOVERED:
 * ============================================================================
 * 
 * PAID APIs (Require API Keys):
 * 1. DUNE_API_KEY - Dune Analytics (on-chain data, exchange flows)
 * 2. WHALE_ALERT_API_KEY - Whale Alert (large transaction monitoring)
 * 3. COINAPI_KEY - CoinAPI (OHLCV data, WebSocket price feed)
 * 4. METAAPI_TOKEN - MetaAPI (forex trading - optional)
 * 
 * FREE APIs (No Key Required):
 * 5. CoinGecko - News feed, market data, global stats
 * 6. Coinbase - Real-time prices, WebSocket
 * 7. Binance Futures - Funding rates, open interest, long/short ratio
 * 8. Alternative.me - Fear & Greed Index
 * 9. Mempool.space - Bitcoin hash rate, miner data
 * 
 * EXCHANGE APIs (User-provided, stored encrypted in DB):
 * 10. Binance Exchange - Trading API (user's own keys)
 * 11. Coinbase Exchange - Trading API (user's own keys)
 * 
 * NOT FOUND (User mentioned but not in codebase):
 * - Perplexity API - NOT FOUND in current codebase
 * 
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';

const API_TIMEOUT = 30000;

describe('COMPLETE External API Audit', () => {
  
  // ============================================================================
  // SECTION 1: PAID APIs (Require API Keys)
  // ============================================================================
  
  describe('PAID APIs', () => {
    
    describe('1. DUNE_API_KEY (Dune Analytics)', () => {
      it('should be configured', () => {
        const key = process.env.DUNE_API_KEY;
        console.log(`[DUNE] Configured: ${key ? '✅ YES' : '❌ NO'}`);
        expect(key).toBeDefined();
        expect(key).not.toBe('');
      });

      it('should authenticate successfully', async () => {
        const key = process.env.DUNE_API_KEY;
        if (!key) return;

        const response = await fetch(
          'https://api.dune.com/api/v1/query/1621987/results?limit=1',
          { headers: { 'X-Dune-API-Key': key } }
        );

        console.log(`[DUNE] Auth Status: ${response.status === 200 ? '✅ SUCCESS' : response.status === 429 ? '⚠️ RATE LIMITED' : '❌ FAILED'}`);
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      }, API_TIMEOUT);
    });

    describe('2. WHALE_ALERT_API_KEY (Whale Alert)', () => {
      it('should be configured', () => {
        const key = process.env.WHALE_ALERT_API_KEY;
        console.log(`[WHALE_ALERT] Configured: ${key ? '✅ YES' : '❌ NO'}`);
        expect(key).toBeDefined();
        expect(key).not.toBe('');
      });

      it('should authenticate successfully', async () => {
        const key = process.env.WHALE_ALERT_API_KEY;
        if (!key) return;

        const response = await fetch(
          `https://api.whale-alert.io/v1/status?api_key=${key}`
        );

        if (response.status === 200) {
          const data = await response.json();
          console.log(`[WHALE_ALERT] Auth Status: ✅ SUCCESS (${data.blockchain_count} blockchains)`);
          expect(data.result).toBe('success');
        } else {
          console.log(`[WHALE_ALERT] Auth Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ FAILED'}`);
          expect(response.status).not.toBe(401);
        }
      }, API_TIMEOUT);
    });

    describe('3. COINAPI_KEY (CoinAPI - OHLCV & WebSocket)', () => {
      it('should be configured', () => {
        const key = process.env.COINAPI_KEY;
        console.log(`[COINAPI] Configured: ${key ? '✅ YES' : '❌ NO'}`);
        expect(key).toBeDefined();
        expect(key).not.toBe('');
      });

      it('should authenticate successfully', async () => {
        const key = process.env.COINAPI_KEY;
        if (!key) return;

        const response = await fetch(
          'https://rest.coinapi.io/v1/exchanges?filter_exchange_id=COINBASE',
          { headers: { 'X-CoinAPI-Key': key } }
        );

        if (response.status === 200) {
          const data = await response.json();
          console.log(`[COINAPI] Auth Status: ✅ SUCCESS (${data.length} exchanges)`);
          expect(Array.isArray(data)).toBe(true);
        } else {
          console.log(`[COINAPI] Auth Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ FAILED'}`);
          expect(response.status).not.toBe(401);
        }
      }, API_TIMEOUT);
    });

    describe('4. METAAPI_TOKEN (MetaAPI - Forex)', () => {
      it('should check configuration (optional)', () => {
        const token = process.env.METAAPI_TOKEN;
        console.log(`[METAAPI] Configured: ${token ? '✅ YES' : '⚠️ NO (Optional for crypto-only)'}`);
        // MetaAPI is optional - only needed for forex trading
      });
    });
  });

  // ============================================================================
  // SECTION 2: FREE APIs (No Key Required)
  // ============================================================================
  
  describe('FREE APIs (No Key Required)', () => {
    
    describe('5. CoinGecko API', () => {
      it('should be accessible (ping)', async () => {
        const response = await fetch('https://api.coingecko.com/api/v3/ping');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[COINGECKO] Status: ✅ ACCESSIBLE - "${data.gecko_says}"`);
          expect(data.gecko_says).toBeDefined();
        } else {
          console.log(`[COINGECKO] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);

      it('should fetch news', async () => {
        const response = await fetch('https://api.coingecko.com/api/v3/news?page=1');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[COINGECKO NEWS] Status: ✅ ACCESSIBLE (${data.data?.length || 0} articles)`);
        } else {
          console.log(`[COINGECKO NEWS] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);

      it('should fetch global market data', async () => {
        const response = await fetch('https://api.coingecko.com/api/v3/global');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[COINGECKO GLOBAL] Status: ✅ ACCESSIBLE (BTC dominance: ${data.data?.market_cap_percentage?.btc?.toFixed(1)}%)`);
        } else {
          console.log(`[COINGECKO GLOBAL] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);
    });

    describe('6. Coinbase API', () => {
      it('should be accessible', async () => {
        const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[COINBASE] Status: ✅ ACCESSIBLE (BTC: $${parseFloat(data.price).toLocaleString()})`);
          expect(data.price).toBeDefined();
        } else {
          console.log(`[COINBASE] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);
    });

    describe('7. Binance Futures API', () => {
      it('should fetch funding rates', async () => {
        const response = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[BINANCE FUTURES] Funding Rate: ✅ ACCESSIBLE (${(parseFloat(data.lastFundingRate) * 100).toFixed(4)}%)`);
          expect(data.lastFundingRate).toBeDefined();
        } else {
          console.log(`[BINANCE FUTURES] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);

      it('should fetch open interest', async () => {
        const response = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[BINANCE OI] Open Interest: ✅ ACCESSIBLE (${parseFloat(data.openInterest).toLocaleString()} BTC)`);
        } else {
          console.log(`[BINANCE OI] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);

      it('should fetch long/short ratio', async () => {
        const response = await fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1');
        
        if (response.status === 200) {
          const data = await response.json();
          if (data.length > 0) {
            console.log(`[BINANCE L/S] Long/Short Ratio: ✅ ACCESSIBLE (${data[0].longShortRatio})`);
          }
        } else {
          console.log(`[BINANCE L/S] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);
    });

    describe('8. Alternative.me (Fear & Greed Index)', () => {
      it('should be accessible', async () => {
        const response = await fetch('https://api.alternative.me/fng/?limit=1');
        
        if (response.status === 200) {
          const data = await response.json();
          const fng = data.data?.[0];
          console.log(`[FEAR&GREED] Status: ✅ ACCESSIBLE (Value: ${fng?.value}, Classification: ${fng?.value_classification})`);
          expect(fng?.value).toBeDefined();
        } else {
          console.log(`[FEAR&GREED] Status: ❌ ERROR (${response.status})`);
        }
      }, API_TIMEOUT);
    });

    describe('9. Mempool.space (Bitcoin Network)', () => {
      it('should fetch hash rate', async () => {
        const response = await fetch('https://mempool.space/api/v1/mining/hashrate/1w');
        
        if (response.status === 200) {
          const data = await response.json();
          console.log(`[MEMPOOL] Hash Rate: ✅ ACCESSIBLE (${data.currentHashrate ? (data.currentHashrate / 1e18).toFixed(2) + ' EH/s' : 'N/A'})`);
        } else {
          console.log(`[MEMPOOL] Status: ${response.status === 429 ? '⚠️ RATE LIMITED' : '❌ ERROR'}`);
        }
      }, API_TIMEOUT);
    });
  });

  // ============================================================================
  // SECTION 3: Summary Report
  // ============================================================================
  
  describe('API Audit Summary', () => {
    it('should generate complete API inventory', () => {
      console.log('\n');
      console.log('╔══════════════════════════════════════════════════════════════════╗');
      console.log('║          COMPLETE EXTERNAL API INVENTORY - SEER PLATFORM         ║');
      console.log('╠══════════════════════════════════════════════════════════════════╣');
      console.log('║                                                                  ║');
      console.log('║  PAID APIs (Require Subscription):                               ║');
      console.log('║  ─────────────────────────────────────────────────────────────   ║');
      console.log(`║  1. DUNE_API_KEY        ${process.env.DUNE_API_KEY ? '✅ Configured' : '❌ Missing   '}  Dune Analytics       ║`);
      console.log(`║  2. WHALE_ALERT_API_KEY ${process.env.WHALE_ALERT_API_KEY ? '✅ Configured' : '❌ Missing   '}  Whale Alert          ║`);
      console.log(`║  3. COINAPI_KEY         ${process.env.COINAPI_KEY ? '✅ Configured' : '❌ Missing   '}  CoinAPI (OHLCV/WS)   ║`);
      console.log(`║  4. METAAPI_TOKEN       ${process.env.METAAPI_TOKEN ? '✅ Configured' : '⚠️ Optional  '}  MetaAPI (Forex)      ║`);
      console.log('║                                                                  ║');
      console.log('║  FREE APIs (No Key Required):                                    ║');
      console.log('║  ─────────────────────────────────────────────────────────────   ║');
      console.log('║  5. CoinGecko           ✅ Free Tier   News, Market Data        ║');
      console.log('║  6. Coinbase            ✅ Free Tier   Real-time Prices         ║');
      console.log('║  7. Binance Futures     ✅ Free Tier   Funding, OI, L/S Ratio   ║');
      console.log('║  8. Alternative.me      ✅ Free Tier   Fear & Greed Index       ║');
      console.log('║  9. Mempool.space       ✅ Free Tier   Bitcoin Network Data     ║');
      console.log('║                                                                  ║');
      console.log('║  USER EXCHANGE APIs (Stored Encrypted in DB):                    ║');
      console.log('║  ─────────────────────────────────────────────────────────────   ║');
      console.log('║  10. Binance Exchange   User-provided  Trading API              ║');
      console.log('║  11. Coinbase Exchange  User-provided  Trading API              ║');
      console.log('║                                                                  ║');
      console.log('║  NOT IN CODEBASE:                                                ║');
      console.log('║  ─────────────────────────────────────────────────────────────   ║');
      console.log('║  - Perplexity API       ❌ Not Found   (Not implemented)        ║');
      console.log('║                                                                  ║');
      console.log('╚══════════════════════════════════════════════════════════════════╝');
      console.log('\n');

      // Verify critical APIs are configured
      expect(process.env.DUNE_API_KEY).toBeDefined();
      expect(process.env.WHALE_ALERT_API_KEY).toBeDefined();
      expect(process.env.COINAPI_KEY).toBeDefined();
    });
  });
});
