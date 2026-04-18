/**
 * Live Agent Audit Script
 * Tests PatternMatcher and OrderFlowAnalyst in isolation
 */

import { PatternMatcher } from './server/agents/PatternMatcher.js';
import { OrderFlowAnalyst } from './server/agents/OrderFlowAnalyst.js';
import { TechnicalAnalyst } from './server/agents/TechnicalAnalyst.js';
import { BinanceAdapter } from './server/exchanges/BinanceAdapter.js';
import { getDb } from './server/db.js';
import { decrypt } from './server/crypto.js';
import { apiKeys, exchanges } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

async function auditAgents() {
  console.log('🔍 Starting Live Agent Audit...\n');

  try {
    // 1. Load exchange credentials
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const exchangeRecords = await db
      .select()
      .from(exchanges)
      .where(eq(exchanges.isActive, true))
      .limit(1);

    if (exchangeRecords.length === 0) {
      throw new Error('No active exchange found');
    }

    const exchange = exchangeRecords[0];
    console.log(`✅ Found exchange: ${exchange.name}\n`);

    // 2. Load API keys
    const keyRecords = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.exchangeId, exchange.id))
      .limit(1);

    if (keyRecords.length === 0) {
      throw new Error('No API keys found for exchange');
    }

    const keyRecord = keyRecords[0];
    const apiKey = decrypt(keyRecord.encryptedApiKey, keyRecord.apiKeyIv).trim();
    const apiSecret = decrypt(keyRecord.encryptedApiSecret, keyRecord.apiSecretIv).trim();

    console.log(`✅ API keys loaded (length: ${apiKey.length}, ${apiSecret.length})\n`);

    // 3. Initialize exchange adapter
    const adapter = new BinanceAdapter({
      apiKey,
      apiSecret,
    });

    console.log('✅ Exchange adapter initialized\n');

    // 4. Test TechnicalAnalyst
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Testing TechnicalAnalyst...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const technicalAnalyst = new TechnicalAnalyst();
    technicalAnalyst.setExchange(adapter);

    try {
      const techSignal = await technicalAnalyst.generateSignal('BTCUSDT');
      console.log('TechnicalAnalyst Signal:');
      console.log(`  Signal: ${techSignal.signal}`);
      console.log(`  Confidence: ${(techSignal.confidence * 100).toFixed(1)}%`);
      console.log(`  Reasoning: ${techSignal.reasoning.substring(0, 150)}...`);
      console.log(`  ✅ WORKING\n`);
    } catch (error) {
      console.error('  ❌ FAILED:', error);
    }

    // 5. Test PatternMatcher
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Testing PatternMatcher...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const patternMatcher = new PatternMatcher();
    patternMatcher.setExchange(adapter);

    try {
      const patternSignal = await patternMatcher.generateSignal('BTCUSDT');
      console.log('PatternMatcher Signal:');
      console.log(`  Signal: ${patternSignal.signal}`);
      console.log(`  Confidence: ${(patternSignal.confidence * 100).toFixed(1)}%`);
      console.log(`  Reasoning: ${patternSignal.reasoning.substring(0, 150)}...`);
      
      if (patternSignal.confidence === 0) {
        console.log(`  ⚠️  ZERO CONFIDENCE - Investigating...`);
        console.log(`  Evidence:`, JSON.stringify(patternSignal.evidence, null, 2).substring(0, 300));
      } else {
        console.log(`  ✅ WORKING\n`);
      }
    } catch (error) {
      console.error('  ❌ FAILED:', error);
      console.error('  Stack:', (error as Error).stack);
    }

    // 6. Test OrderFlowAnalyst
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Testing OrderFlowAnalyst...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const orderFlowAnalyst = new OrderFlowAnalyst();
    orderFlowAnalyst.setExchange(adapter);

    try {
      const orderFlowSignal = await orderFlowAnalyst.generateSignal('BTCUSDT');
      console.log('OrderFlowAnalyst Signal:');
      console.log(`  Signal: ${orderFlowSignal.signal}`);
      console.log(`  Confidence: ${(orderFlowSignal.confidence * 100).toFixed(1)}%`);
      console.log(`  Reasoning: ${orderFlowSignal.reasoning.substring(0, 150)}...`);
      
      if (orderFlowSignal.confidence === 0) {
        console.log(`  ⚠️  ZERO CONFIDENCE - Investigating...`);
        console.log(`  Evidence:`, JSON.stringify(orderFlowSignal.evidence, null, 2).substring(0, 300));
      } else {
        console.log(`  ✅ WORKING\n`);
      }
    } catch (error) {
      console.error('  ❌ FAILED:', error);
      console.error('  Stack:', (error as Error).stack);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Audit Complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

auditAgents();
