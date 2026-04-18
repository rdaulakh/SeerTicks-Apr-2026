import { describe, it, expect } from 'vitest';

describe('reCAPTCHA Configuration', () => {
  it('should have RECAPTCHA_SECRET_KEY configured', () => {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    expect(secretKey).toBeDefined();
    expect(secretKey).not.toBe('');
    expect(secretKey?.length).toBeGreaterThan(10);
  });

  it('should have VITE_RECAPTCHA_SITE_KEY configured', () => {
    const siteKey = process.env.VITE_RECAPTCHA_SITE_KEY;
    expect(siteKey).toBeDefined();
    expect(siteKey).not.toBe('');
    expect(siteKey?.length).toBeGreaterThan(10);
  });

  it('should be able to call reCAPTCHA API with secret key', async () => {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
      console.log('Skipping API test - no secret key configured');
      return;
    }

    // Test with an empty token - should return success: false but validates the key format
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=test-token`,
    });

    expect(response.ok).toBe(true);
    
    const data = await response.json();
    // The API should respond (even if token is invalid, the secret key format is valid)
    expect(data).toHaveProperty('success');
    // With an invalid token, success should be false, but we're testing the API connection
    // If the secret key was invalid, we'd get a different error
    expect(data['error-codes']).toBeDefined();
    // Common error for invalid token is 'invalid-input-response', not 'invalid-input-secret'
    // If we get 'invalid-input-secret', the key is wrong
    if (data['error-codes']) {
      expect(data['error-codes']).not.toContain('invalid-input-secret');
    }
  });
});
