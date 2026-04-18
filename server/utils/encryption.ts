import crypto from "crypto";
import { ENV } from "../_core/env";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = ENV.encryptionMasterKey; // 32 bytes from environment

/**
 * Encrypt sensitive data (API keys, secrets)
 * Returns { encrypted: string, iv: string }
 */
export function encrypt(text: string): { encrypted: string; iv: string } {
  if (!text || typeof text !== 'string') {
    throw new Error(`Encryption error: Invalid input. Expected string, received ${typeof text}`);
  }
  
  const iv = crypto.randomBytes(16); // Initialization vector
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return {
    encrypted,
    iv: iv.toString("hex"),
  };
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encrypted: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash sensitive data for comparison (one-way)
 */
export function hash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Generate a random API key (for testing)
 */
export function generateRandomKey(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}
