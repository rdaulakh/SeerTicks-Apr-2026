import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import {
  exchanges,
  apiKeys,
  userBias,
  systemConfig,
  InsertExchange,
  InsertApiKey,
  InsertUserBias,
  InsertSystemConfig,
} from "../drizzle/schema";
import { encrypt, decrypt } from "./crypto";

/**
 * Exchange and API key management database helpers
 */

/**
 * Get user's active exchange configuration
 */
export async function getUserExchange(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.userId, userId), eq(exchanges.isActive, true)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Create or update user's exchange configuration
 */
export async function upsertExchange(data: InsertExchange) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Deactivate any existing active exchanges for this user
  await db
    .update(exchanges)
    .set({ isActive: false })
    .where(eq(exchanges.userId, data.userId));

  // Insert new exchange configuration
  const result = await db.insert(exchanges).values({
    ...data,
    isActive: true,
    connectionStatus: "disconnected",
  });

  return result;
}

/**
 * Update exchange connection status
 */
export async function updateExchangeStatus(
  exchangeId: number,
  status: "connected" | "disconnected" | "error"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(exchanges)
    .set({
      connectionStatus: status,
      lastConnected: status === "connected" ? new Date() : undefined,
    })
    .where(eq(exchanges.id, exchangeId));
}

/**
 * Store encrypted API keys for an exchange
 */
export async function storeApiKeys(
  userId: number,
  exchangeId: number,
  apiKey: string,
  apiSecret: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Encrypt the API key and secret (trim to remove any whitespace)
  const encryptedKey = encrypt(apiKey.trim());
  const encryptedSecret = encrypt(apiSecret.trim());

  // Delete any existing API keys for this exchange
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, exchangeId)));

  // Insert new encrypted API keys
  const result = await db.insert(apiKeys).values({
    userId,
    exchangeId,
    encryptedApiKey: encryptedKey.encrypted,
    encryptedApiSecret: encryptedSecret.encrypted,
    apiKeyIv: encryptedKey.iv,
    apiSecretIv: encryptedSecret.iv,
    isValid: false, // Will be validated separately
  });

  return result;
}

/**
 * Retrieve and decrypt API keys for an exchange
 */
export async function getApiKeys(userId: number, exchangeId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, exchangeId)))
    .limit(1);

  if (result.length === 0) return null;

  const record = result[0];

  try {
    // Decrypt the API key and secret
    const apiKey = decrypt(record.encryptedApiKey, record.apiKeyIv).trim();
    const apiSecret = decrypt(record.encryptedApiSecret, record.apiSecretIv).trim();

    return {
      id: record.id,
      apiKey,
      apiSecret,
      isValid: record.isValid,
      lastTested: record.lastTested,
    };
  } catch (error) {
    console.error("[ExchangeDB] Failed to decrypt API keys:", error);
    return null;
  }
}

/**
 * Test API key connection
 */
export async function testApiKeyConnection(
  apiKey: string,
  apiSecret: string,
  exchangeName: string
): Promise<{ success: boolean; error?: string }> {
  // Validate input
  if (!apiKey || !apiSecret || !exchangeName) {
    return {
      success: false,
      error: 'API key, secret, and exchange name are required',
    };
  }

  // Validate format
  if (apiKey.trim().length === 0 || apiSecret.trim().length === 0) {
    return {
      success: false,
      error: 'API key and secret cannot be empty',
    };
  }

  try {
    // For now, just validate the format
    // In production, this would make an actual API call to test the credentials
    return {
      success: false,
      error: 'Invalid API credentials',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mark API keys as valid or invalid after testing
 */
export async function updateApiKeyValidity(apiKeyId: number, isValid: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(apiKeys)
    .set({
      isValid,
      lastTested: new Date(),
    })
    .where(eq(apiKeys.id, apiKeyId));
}

/**
 * Get or create user bias settings
 */
export async function getUserBias(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userBias)
    .where(eq(userBias.userId, userId))
    .limit(1);

  if (result.length > 0) {
    return result[0];
  }

  // Create default bias settings
  await db.insert(userBias).values({
    userId,
    bias: "neutral",
    biasValue: "0.00",
    vetoNextTrade: false,
  });

  return {
    userId,
    bias: "neutral" as const,
    biasValue: "0.00",
    vetoNextTrade: false,
  };
}

/**
 * Update user bias settings
 */
export async function updateUserBias(
  userId: number,
  bias: "bearish" | "neutral" | "bullish",
  vetoNextTrade?: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Convert bias to numeric value
  const biasValue = bias === "bullish" ? 0.05 : bias === "bearish" ? -0.05 : 0.0;

  await db
    .update(userBias)
    .set({
      bias,
      biasValue: biasValue.toFixed(2),
      vetoNextTrade: vetoNextTrade ?? false,
    })
    .where(eq(userBias.userId, userId));
}

/**
 * Get system configuration by key
 */
export async function getSystemConfig(userId: number, configKey: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(systemConfig)
    .where(and(eq(systemConfig.userId, userId), eq(systemConfig.configKey, configKey)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Set system configuration
 */
export async function setSystemConfig(
  userId: number,
  configKey: string,
  configValue: any,
  description?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if config exists
  const existing = await getSystemConfig(userId, configKey);

  if (existing) {
    // Update existing config
    await db
      .update(systemConfig)
      .set({ configValue, description })
      .where(eq(systemConfig.id, existing.id));
  } else {
    // Insert new config
    await db.insert(systemConfig).values({
      userId,
      configKey,
      configValue,
      description,
    });
  }
}

/**
 * Get all system configurations for a user
 */
export async function getAllSystemConfig(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.userId, userId));

  return result;
}

/**
 * Get all active exchanges for a user with their API keys
 */
export async function getActiveExchangesWithKeys(userId: number) {
  const db = await getDb();
  if (!db) {
    console.log('[getActiveExchangesWithKeys] Database not available');
    return [];
  }

  console.log('[getActiveExchangesWithKeys] Querying for userId:', userId);
  
  // Get all active exchanges
  const activeExchanges = await db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.userId, userId), eq(exchanges.isActive, true)));
  
  console.log('[getActiveExchangesWithKeys] Found', activeExchanges.length, 'active exchanges:', activeExchanges.map(e => ({ id: e.id, name: e.exchangeName })));

  // Load API keys for each exchange
  const exchangesWithKeys = await Promise.all(
    activeExchanges.map(async (exchange) => {
      const keys = await getApiKeys(userId, exchange.id);
      return {
        ...exchange,
        apiKey: keys?.apiKey,
        apiSecret: keys?.apiSecret,
        hasValidKeys: keys?.isValid ?? false,
      };
    })
  );

  return exchangesWithKeys;
}

/**
 * Get all trading symbols for a specific exchange
 */
export async function getExchangeTradingSymbols(exchangeId: number) {
  const db = await getDb();
  if (!db) return [];

  const { tradingSymbols } = await import("../drizzle/schema");

  const result = await db
    .select()
    .from(tradingSymbols)
    .where(
      // eq(tradingSymbols.exchangeId, exchangeId), // TODO: Add exchangeId to schema
      eq(tradingSymbols.isActive, true)
    );

  return result;
}

/**
 * Get all active trading symbols across all user's exchanges
 */
export async function getAllActiveTradingSymbols(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const { tradingSymbols } = await import("../drizzle/schema");

  // Get all active exchanges for the user
  const activeExchanges = await db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.userId, userId), eq(exchanges.isActive, true)));

  if (activeExchanges.length === 0) {
    console.log('[getAllActiveTradingSymbols] No active exchanges found for userId:', userId);
    return [];
  }

  console.log('[getAllActiveTradingSymbols] Found', activeExchanges.length, 'active exchanges');
  
  // Get all active trading symbols for this user
  const symbols = await db
    .select()
    .from(tradingSymbols)
    .where(and(eq(tradingSymbols.userId, userId), eq(tradingSymbols.isActive, true)));

  console.log('[getAllActiveTradingSymbols] Found', symbols.length, 'active symbols for userId:', userId);

  // Enrich each symbol with exchange name (all symbols apply to all exchanges for this user)
  const result = activeExchanges.flatMap(exchange =>
    symbols.map(s => ({
      ...s,
      exchangeId: exchange.id,
      exchangeName: exchange.exchangeName
    }))
  );

  console.log('[getAllActiveTradingSymbols] Returning', result.length, 'symbol-exchange combinations');
  return result;
}
