import crypto from "crypto";

/**
 * Encryption utilities for secure API key storage
 * Uses AES-256-GCM for authenticated encryption
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Get or generate the master encryption key from environment
 * In production, this should be stored in a secure key management service
 */
function getMasterKey(): Buffer {
  const keyEnv = process.env.ENCRYPTION_MASTER_KEY;
  
  if (!keyEnv) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY environment variable is not set. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  const key = Buffer.from(keyEnv, "hex");
  
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_MASTER_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }

  return key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns the encrypted data and initialization vector
 */
export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Combine encrypted data and auth tag
  const combined = encrypted + authTag.toString("hex");
  
  return {
    encrypted: combined,
    iv: iv.toString("hex"),
  };
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 * Requires the initialization vector used during encryption
 */
export function decrypt(encrypted: string, ivHex: string): string {
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, "hex");
  
  // Extract auth tag from the end of the encrypted data
  const authTagStart = encrypted.length - (AUTH_TAG_LENGTH * 2);
  const encryptedData = encrypted.substring(0, authTagStart);
  const authTagHex = encrypted.substring(authTagStart);
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Validate that encryption/decryption is working correctly
 * Used for system health checks
 */
export function validateEncryption(): boolean {
  try {
    const testData = "test-api-key-12345";
    const { encrypted, iv } = encrypt(testData);
    const decrypted = decrypt(encrypted, iv);
    return decrypted === testData;
  } catch (error) {
    console.error("[Crypto] Encryption validation failed:", error);
    return false;
  }
}

/**
 * Generate a secure random string for testing purposes
 */
export function generateRandomKey(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}
