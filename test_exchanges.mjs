import { getActiveExchangesWithKeys } from './server/exchangeDb.js';

const userId = 1; // Current user
console.log(`[Test] Testing getActiveExchangesWithKeys for userId: ${userId}`);

try {
  const exchanges = await getActiveExchangesWithKeys(userId);
  console.log(`[Test] Result: ${exchanges.length} exchanges`);
  console.log('[Test] Exchanges:', JSON.stringify(exchanges, null, 2));
} catch (error) {
  console.error('[Test] Error:', error);
}

process.exit(0);
