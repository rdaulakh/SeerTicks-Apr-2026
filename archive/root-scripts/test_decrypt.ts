/**
 * Test decrypt function to diagnose API key issue
 */

import { getDb } from './server/db.js';
import { decrypt } from './server/crypto.js';
import { apiKeys } from './drizzle/schema.js';

async function testDecrypt() {
  console.log('🔍 Testing Decrypt Function\n');

  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const keyRecords = await db.select().from(apiKeys).limit(1);
  
  if (keyRecords.length === 0) {
    console.error('❌ No API keys found in database');
    process.exit(1);
  }

  const record = keyRecords[0];
  
  console.log('Database Record:');
  console.log(`  ID: ${record.id}`);
  console.log(`  encryptedApiKey type: ${typeof record.encryptedApiKey}`);
  console.log(`  encryptedApiKey length: ${record.encryptedApiKey?.length || 'null'}`);
  console.log(`  apiKeyIv type: ${typeof record.apiKeyIv}`);
  console.log(`  apiKeyIv length: ${record.apiKeyIv?.length || 'null'}`);
  console.log(`  encryptedApiKey sample: ${record.encryptedApiKey?.substring(0, 50)}`);
  console.log(`  apiKeyIv value: ${record.apiKeyIv}\n`);

  try {
    console.log('Attempting decrypt...');
    const decrypted = decrypt(record.encryptedApiKey, record.apiKeyIv);
    
    console.log(`\n✅ Decryption successful!`);
    console.log(`  Result type: ${typeof decrypted}`);
    console.log(`  Result length: ${decrypted?.length || 'null'}`);
    console.log(`  Result value: ${decrypted}`);
    console.log(`  After trim: "${decrypted.trim()}"`);
    console.log(`  After trim length: ${decrypted.trim().length}`);
    
  } catch (error) {
    console.error('\n❌ Decryption failed:', error);
    console.error('Stack:', (error as Error).stack);
  }

  process.exit(0);
}

testDecrypt();
