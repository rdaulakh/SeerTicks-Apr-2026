import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * Generate JWT token for Coinbase Advanced Trade API authentication
 * Based on official Coinbase Python SDK implementation
 * 
 * @param apiKey - CDP API key in format: organizations/{org_id}/apiKeys/{key_id}
 * @param apiSecret - PEM-encoded EC private key
 * @param requestMethod - HTTP method (GET, POST, etc.)
 * @param requestPath - API endpoint path (e.g., /api/v3/brokerage/accounts)
 * @returns JWT token string
 */
export function generateCoinbaseJWT(
  apiKey: string,
  apiSecret: string,
  requestMethod: string,
  requestPath: string
): string {
  const algorithm = 'ES256';
  
  // Format URI: "METHOD api.coinbase.com/path" (includes full domain)
  const uri = `${requestMethod} api.coinbase.com${requestPath}`;
  
  // Generate a unique nonce (random hex string)
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Current timestamp
  const issuedAt = Math.floor(Date.now() / 1000);
  
  // Token expires in 2 minutes (120 seconds)
  const expiresAt = issuedAt + 120;
  
  const payload = {
    sub: apiKey,
    iss: 'cdp',  // CRITICAL: Must be "cdp" not "coinbase-cloud"
    nbf: issuedAt,
    exp: expiresAt,
    uri: uri     // Full URI with domain
  };
  
  // CRITICAL FIX: Convert literal \n to actual newlines (browser forms escape them)
  // jsonwebtoken requires proper PEM format with actual newline characters
  const formattedSecret = apiSecret
    .trim()
    .replace(/\\n/g, '\n')  // Convert literal \n to actual newlines
    .replace(/\s+-----END/g, '\n-----END')  // Ensure newline before END marker
    .replace(/-----BEGIN\s+/g, '-----BEGIN ')  // Clean up BEGIN marker
    .replace(/KEY-----\s+/g, 'KEY-----\n');  // Ensure newline after BEGIN marker
  
  const token = jwt.sign(payload, formattedSecret, {
    algorithm: algorithm,
    header: {
      alg: algorithm,
      kid: apiKey,
      typ: 'JWT',
      nonce: nonce
    } as any  // TypeScript doesn't recognize custom header fields
  });
  
  return token;
}

/**
 * Build Authorization header value for Coinbase API requests
 * 
 * @param apiKey - CDP API key
 * @param apiSecret - PEM-encoded EC private key
 * @param requestMethod - HTTP method
 * @param requestPath - API endpoint path
 * @returns Bearer token string for Authorization header
 */
export function buildCoinbaseAuthHeader(
  apiKey: string,
  apiSecret: string,
  requestMethod: string,
  requestPath: string
): string {
  const token = generateCoinbaseJWT(apiKey, apiSecret, requestMethod, requestPath);
  return `Bearer ${token}`;
}

/**
 * Generate JWT token for Coinbase Advanced Trade WebSocket authentication
 * WebSocket uses a different URI format than REST API
 * 
 * @param apiKey - CDP API key
 * @param apiSecret - PEM-encoded EC private key
 * @returns JWT token string for WebSocket subscribe message
 */
export function generateCoinbaseWebSocketJWT(
  apiKey: string,
  apiSecret: string
): string {
  const algorithm = 'ES256';
  
  // WebSocket URI format: "GET advanced-trade-ws.coinbase.com" (no path)
  const uri = 'GET advanced-trade-ws.coinbase.com';
  
  // Generate a unique nonce (random hex string)
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Current timestamp
  const issuedAt = Math.floor(Date.now() / 1000);
  
  // Token expires in 2 minutes (120 seconds)
  const expiresAt = issuedAt + 120;
  
  const payload = {
    sub: apiKey,
    iss: 'cdp',  // Must be "cdp" for Coinbase Cloud
    nbf: issuedAt,
    exp: expiresAt,
    uri: uri
  };
  
  // Format PEM key (convert literal \n to actual newlines)
  const formattedSecret = apiSecret
    .trim()
    .replace(/\\n/g, '\n')
    .replace(/\s+-----END/g, '\n-----END')
    .replace(/-----BEGIN\s+/g, '-----BEGIN ')
    .replace(/KEY-----\s+/g, 'KEY-----\n');
  
  const token = jwt.sign(payload, formattedSecret, {
    algorithm: algorithm,
    header: {
      alg: algorithm,
      kid: apiKey,
      typ: 'JWT',
      nonce: nonce
    } as any  // TypeScript doesn't recognize custom header fields
  });
  
  return token;
}
