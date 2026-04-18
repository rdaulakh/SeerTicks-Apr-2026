import { describe, it, expect } from 'vitest';
import { generateCoinbaseJWT, buildCoinbaseAuthHeader } from './coinbaseJWT';

describe('Coinbase JWT Authentication', () => {
  const API_KEY = 'organizations/test-org/apiKeys/test-key';
  const API_SECRET = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIJIekg/Rh8BRmJCsHf/Zb4s1IzJ+0uz1ciDT2gtUQql2oAoGCCqGSM49
AwEHoUQDQgAETsz2obU92jAXmFACRt0qA8JRM4gUPMMXwNLwpoDX/Osclf2Nn6FF
jmLC8eQoDmisqovVpKvEH/aTX1OTY2n5wQ==
-----END EC PRIVATE KEY-----`;

  it('should generate a valid JWT token', () => {
    const token = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('should include correct issuer in JWT payload', () => {
    const token = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    // Decode payload (base64)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );

    expect(payload.iss).toBe('cdp');
    expect(payload.sub).toBe(API_KEY);
    expect(payload.uri).toBe('GET api.coinbase.com/api/v3/brokerage/accounts');
  });

  it('should include kid in JWT header', () => {
    const token = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    // Decode header (base64)
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64').toString()
    );

    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(API_KEY);
    expect(header.nonce).toBeTruthy();
  });

  it('should build correct Authorization header', () => {
    const authHeader = buildCoinbaseAuthHeader(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    expect(authHeader).toMatch(/^Bearer .+/);
    expect(authHeader.split(' ')).toHaveLength(2);
    expect(authHeader.split(' ')[0]).toBe('Bearer');
  });

  it('should generate different tokens for different endpoints', () => {
    const token1 = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    const token2 = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/product_book'
    );

    expect(token1).not.toBe(token2);
  });

  it('should include expiration time (2 minutes)', () => {
    const token = generateCoinbaseJWT(
      API_KEY,
      API_SECRET,
      'GET',
      '/api/v3/brokerage/accounts'
    );

    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );

    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp).toBeLessThanOrEqual(now + 120); // 2 minutes
    expect(payload.nbf).toBeLessThanOrEqual(now);
  });
});
