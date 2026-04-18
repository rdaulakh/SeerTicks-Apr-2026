/**
 * Test Fast Agents After Cache Seeding
 * Verifies PatternMatcher and OrderFlowAnalyst work correctly
 */

import { seedCandleCache, getCandleCache } from './server/WebSocketCandleCache.js';
import { PatternMatcher } from './server/agents/PatternMatcher.js';
import { TechnicalAnalyst } from './server/agents/TechnicalAnalyst.js';
import { BinanceAdapter } from './server/exchanges/BinanceAdapter.js';
import { getDb } from './server/db.js';
import { decrypt } from './server/crypto.js';
import { apiKeys, exchanges } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

async function testAgentsWithCache() {
  console.log('🧪 Testing Fast Agents After Cache Seeding\n');

  try {
    // Step 1: Seed candle cache
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Step 1: Seeding Candle Cache');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await seedCandleCache(['BTCUSDT', 'ETHUSDT']);

    // Step 2: Verify cache has data
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Step 2: Verifying Cache');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const cache = getCandleCache();
    const btc1d = cache.getCandles('BTCUSDT', '1d', 100);
    const btc4h = cache.getCandles('BTCUSDT', '4h', 100);
    const btc5m = cache.getCandles('BTCUSDT', '5m', 100);

    console.log(`BTCUSDT Cache Status:`);
    console.log(`  1d: ${btc1d.length} candles ${btc1d.length >= 20 ? '✅' : '❌'}`);
    console.log(`  4h: ${btc4h.length} candles ${btc4h.length >= 20 ? '✅' : '❌'}`);
    console.log(`  5m: ${btc5m.length} candles ${btc5m.length >= 20 ? '✅' : '❌'}`);

    if (btc1d.length < 20 || btc4h.length < 20 || btc5m.length < 20) {
      console.error('\n❌ Cache seeding failed - insufficient data');
      process.exit(1);
    }

    // Step 3: Initialize exchange adapter
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔌 Step 3: Initializing Exchange Adapter');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const exchangeRecords = await db
      .select()
      .from(exchanges)
      .where(eq(exchanges.isActive, true))
      .limit(1);

    if (exchangeRecords.length === 0) {
      throw new Error('No active exchange found');
    }

    const exchange = exchangeRecords[0];
    const keyRecords = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.exchangeId, exchange.id))
      .limit(1);

    if (keyRecords.length === 0) {
      throw new Error('No API keys found');
    }

    const keyRecord = keyRecords[0];
    const apiKey = decrypt(keyRecord.encryptedApiKey, keyRecord.apiKeyIv).trim();
    const apiSecret = decrypt(keyRecord.encryptedApiSecret, keyRecord.apiSecretIv).trim();

    const adapter = new BinanceAdapter({ apiKey, apiSecret });
    console.log('✅ Exchange adapter initialized\n');

    // Step 4: Test TechnicalAnalyst (baseline)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Step 4: Testing TechnicalAnalyst');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const technicalAnalyst = new TechnicalAnalyst();
    technicalAnalyst.setExchange(adapter);

    try {
      const techSignal = await technicalAnalyst.generateSignal('BTCUSDT');
      console.log(`Signal: ${techSignal.signal}`);
      console.log(`Confidence: ${(techSignal.confidence * 100).toFixed(1)}%`);
      console.log(`Reasoning: ${techSignal.reasoning.substring(0, 100)}...`);
      
      if (techSignal.confidence > 0) {
        console.log('✅ TechnicalAnalyst WORKING\n');
      } else {
        console.log('⚠️  TechnicalAnalyst returned 0% confidence\n');
      }
    } catch (error) {
      console.error('❌ TechnicalAnalyst FAILED:', error);
    }

    // Step 5: Test PatternMatcher (main focus)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Step 5: Testing PatternMatcher');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const patternMatcher = new PatternMatcher();
    patternMatcher.setExchange(adapter);

    try {
      const patternSignal = await patternMatcher.generateSignal('BTCUSDT');
      console.log(`Signal: ${patternSignal.signal}`);
      console.log(`Confidence: ${(patternSignal.confidence * 100).toFixed(1)}%`);
      console.log(`Reasoning: ${patternSignal.reasoning.substring(0, 150)}...`);
      
      if (patternSignal.confidence > 0) {
        console.log('✅ PatternMatcher WORKING - Cache fix successful!\n');
      } else {
        console.log('⚠️  PatternMatcher still returning 0% confidence');
        console.log('   Reasoning:', patternSignal.reasoning);
        console.log('   Evidence:', JSON.stringify(patternSignal.evidence, null, 2).substring(0, 300));
      }
    } catch (error) {
      console.error('❌ PatternMatcher FAILED:', error);
      console.error('Stack:', (error as Error).stack);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Test Complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

testAgentsWithCache();
