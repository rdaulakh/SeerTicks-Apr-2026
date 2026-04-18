/**
 * Dune Analytics API Key Validation Test
 * Validates that the DUNE_API_KEY is correctly configured and can fetch real data
 */

import { describe, it, expect } from 'vitest';

describe('Dune Analytics API Key Validation', () => {
  it('should have DUNE_API_KEY configured', () => {
    expect(process.env.DUNE_API_KEY).toBeDefined();
    expect(process.env.DUNE_API_KEY).not.toBe('');
  });

  it('should successfully authenticate with Dune Analytics API', async () => {
    const apiKey = process.env.DUNE_API_KEY;
    
    if (!apiKey) {
      throw new Error('DUNE_API_KEY not configured');
    }

    // Test with a simple query execution status endpoint
    // Using query 1621987 which is the exchange flows query
    const response = await fetch(
      'https://api.dune.com/api/v1/query/1621987/results?limit=1',
      {
        headers: {
          'X-Dune-API-Key': apiKey,
        },
      }
    );

    // Check if we get a valid response (200 or 400 for rate limit, but not 401/403 for auth failure)
    expect(response.status).not.toBe(401); // Unauthorized
    expect(response.status).not.toBe(403); // Forbidden
    
    // If we get 200, the API key is valid and working
    if (response.status === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('result');
      console.log('[Dune API] ✅ API key validated successfully');
    } else if (response.status === 429) {
      // Rate limited but key is valid
      console.log('[Dune API] ⚠️ Rate limited but API key is valid');
    } else {
      console.log(`[Dune API] Response status: ${response.status}`);
    }
  }, 30000); // 30 second timeout for API call
});

describe('Whale Alert API Key Validation', () => {
  it('should have WHALE_ALERT_API_KEY configured', () => {
    expect(process.env.WHALE_ALERT_API_KEY).toBeDefined();
    expect(process.env.WHALE_ALERT_API_KEY).not.toBe('');
  });

  it('should successfully authenticate with Whale Alert API', async () => {
    const apiKey = process.env.WHALE_ALERT_API_KEY;
    
    if (!apiKey) {
      throw new Error('WHALE_ALERT_API_KEY not configured');
    }

    // Test with the status endpoint
    const response = await fetch(
      `https://api.whale-alert.io/v1/status?api_key=${apiKey}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    // Check if we get a valid response
    expect(response.status).not.toBe(401); // Unauthorized
    expect(response.status).not.toBe(403); // Forbidden
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('result');
      console.log('[Whale Alert] ✅ API key validated successfully');
      console.log('[Whale Alert] Status:', data);
    } else if (response.status === 429) {
      // Rate limited but key is valid
      console.log('[Whale Alert] ⚠️ Rate limited but API key is valid');
    } else {
      const text = await response.text();
      console.log(`[Whale Alert] Response status: ${response.status}, body: ${text}`);
    }
  }, 30000); // 30 second timeout for API call
});
