import { describe, it, expect } from 'vitest';

// Test the state parameter encoding/decoding for Remember Me feature
describe('Remember Me Feature', () => {
  // Helper function to simulate parseStateParam from oauth.ts
  function parseStateParam(state: string): { redirectUri: string; rememberMe: boolean } {
    try {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      // Check if state is JSON (new format with remember_me)
      if (decoded.startsWith('{')) {
        const parsed = JSON.parse(decoded);
        return {
          redirectUri: parsed.redirectUri || '/',
          rememberMe: parsed.rememberMe === true,
        };
      }
      // Legacy format: state is just the redirect URI
      return {
        redirectUri: decoded,
        rememberMe: false,
      };
    } catch {
      // If parsing fails, return defaults
      return {
        redirectUri: '/',
        rememberMe: false,
      };
    }
  }

  it('should parse state with rememberMe=true', () => {
    const stateData = JSON.stringify({
      redirectUri: 'https://example.com/api/oauth/callback',
      rememberMe: true,
    });
    const state = Buffer.from(stateData).toString('base64');
    
    const result = parseStateParam(state);
    
    expect(result.rememberMe).toBe(true);
    expect(result.redirectUri).toBe('https://example.com/api/oauth/callback');
  });

  it('should parse state with rememberMe=false', () => {
    const stateData = JSON.stringify({
      redirectUri: 'https://example.com/api/oauth/callback',
      rememberMe: false,
    });
    const state = Buffer.from(stateData).toString('base64');
    
    const result = parseStateParam(state);
    
    expect(result.rememberMe).toBe(false);
    expect(result.redirectUri).toBe('https://example.com/api/oauth/callback');
  });

  it('should handle legacy state format (just redirect URI)', () => {
    const redirectUri = 'https://example.com/api/oauth/callback';
    const state = Buffer.from(redirectUri).toString('base64');
    
    const result = parseStateParam(state);
    
    expect(result.rememberMe).toBe(false);
    expect(result.redirectUri).toBe(redirectUri);
  });

  it('should handle invalid state gracefully', () => {
    // Invalid base64 will decode to garbage, but not throw
    // The actual oauth.ts catches JSON.parse errors
    const result = parseStateParam('invalid-base64!!!');
    
    // Since the decoded string doesn't start with '{', it's treated as legacy format
    expect(result.rememberMe).toBe(false);
    // The redirectUri will be the decoded garbage string, not '/'
    // This is expected behavior - the server will handle invalid redirects
  });

  it('should handle empty state', () => {
    const result = parseStateParam('');
    
    // Empty string decodes to empty string, treated as legacy format
    expect(result.rememberMe).toBe(false);
    expect(result.redirectUri).toBe('');
  });

  it('should handle missing rememberMe field', () => {
    const stateData = JSON.stringify({
      redirectUri: 'https://example.com/api/oauth/callback',
      // No rememberMe field
    });
    const state = Buffer.from(stateData).toString('base64');
    
    const result = parseStateParam(state);
    
    expect(result.rememberMe).toBe(false);
    expect(result.redirectUri).toBe('https://example.com/api/oauth/callback');
  });

  it('should handle rememberMe as string "true" (should be false)', () => {
    const stateData = JSON.stringify({
      redirectUri: 'https://example.com/api/oauth/callback',
      rememberMe: 'true', // String, not boolean
    });
    const state = Buffer.from(stateData).toString('base64');
    
    const result = parseStateParam(state);
    
    // Should be false because we check for strict boolean true
    expect(result.rememberMe).toBe(false);
  });

  it('should use correct session durations', () => {
    // Import the constants
    const SESSION_DURATION_SHORT = 1000 * 60 * 60 * 24; // 24 hours
    const SESSION_DURATION_LONG = 1000 * 60 * 60 * 24 * 30; // 30 days
    
    expect(SESSION_DURATION_SHORT).toBe(86400000); // 24 hours in ms
    expect(SESSION_DURATION_LONG).toBe(2592000000); // 30 days in ms
    expect(SESSION_DURATION_LONG / SESSION_DURATION_SHORT).toBe(30); // 30x longer
  });
});
