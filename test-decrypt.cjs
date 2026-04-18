const { drizzle } = require('drizzle-orm/mysql2');
const { decrypt } = require('./server/utils/encryption.ts');

const db = drizzle(process.env.DATABASE_URL);

async function testDecryption() {
  try {
    console.log('\n=== Testing API Key Decryption ===\n');
    
    // Get the latest API key
    const result = await db.execute('SELECT * FROM apiKeys WHERE id = 120004 LIMIT 1');
    const apiKey = result[0][0];
    
    if (!apiKey) {
      console.log('❌ No API key found with ID 120004');
      return;
    }
    
    console.log(`Found API Key ID: ${apiKey.id}`);
    console.log(`Exchange ID: ${apiKey.exchangeId}`);
    console.log(`Encrypted API Key length: ${apiKey.encryptedApiKey?.length || 0}`);
    console.log(`Encrypted API Secret length: ${apiKey.encryptedApiSecret?.length || 0}`);
    console.log(`API Key IV length: ${apiKey.apiKeyIv?.length || 0}`);
    console.log(`API Secret IV length: ${apiKey.apiSecretIv?.length || 0}`);
    
    // Try to decrypt
    try {
      const decryptedKey = decrypt(apiKey.encryptedApiKey, apiKey.apiKeyIv);
      const decryptedSecret = decrypt(apiKey.encryptedApiSecret, apiKey.apiSecretIv);
      
      console.log(`\n✅ Decryption successful!`);
      console.log(`Decrypted API Key length: ${decryptedKey.length}`);
      console.log(`Decrypted API Secret length: ${decryptedSecret.length}`);
      console.log(`API Key starts with: ${decryptedKey.substring(0, 10)}...`);
      console.log(`API Secret starts with: ${decryptedSecret.substring(0, 10)}...`);
      
    } catch (decryptError) {
      console.log(`\n❌ Decryption failed: ${decryptError.message}`);
      console.log(`Error details:`, decryptError);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

testDecryption();
