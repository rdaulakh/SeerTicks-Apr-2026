import { describe, it, expect } from 'vitest';

const hasApiKey = !!process.env.WHALE_ALERT_API_KEY;

/**
 * Test Whale Alert API integration
 * Validates that the WHALE_ALERT_API_KEY is correctly configured
 * Skipped when API key is not available (CI unit test mode)
 */
describe.skipIf(!hasApiKey)('Whale Alert API Integration', () => {
  it('should validate WHALE_ALERT_API_KEY by fetching recent transactions', async () => {
    const API_KEY = process.env.WHALE_ALERT_API_KEY;
    
    expect(API_KEY).toBeDefined();
    expect(API_KEY).not.toBe('');

    // Retry up to 3 times with backoff for rate-limited API
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const start = now - 3600;
        
        const url = `https://api.whale-alert.io/v1/transactions?api_key=${API_KEY}&start=${start}&end=${now}&min_value=1000000`;
        const response = await fetch(url);
        const data = await response.json();

        if (response.status === 429) {
          // Rate limited — wait and retry
          const waitTime = attempt * 5000;
          console.log(`⏳ Whale Alert rate limited (attempt ${attempt}/3), waiting ${waitTime/1000}s...`);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }

        expect(response.ok).toBe(true);
        expect(data).toHaveProperty('result');
        expect(data.result).toBe('success');
        expect(data).toHaveProperty('transactions');
        expect(Array.isArray(data.transactions)).toBe(true);

        console.log(`✅ Whale Alert API validated: ${data.transactions.length} transactions found in last hour`);
        return; // Success — exit
      } catch (err) {
        lastError = err as Error;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 3000));
        }
      }
    }
    
    throw lastError || new Error('Whale Alert API validation failed after 3 attempts');
  }, 30000);
});
