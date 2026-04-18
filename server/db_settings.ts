import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  agentWeights,
  thresholdConfig,
  externalApiKeys,
  exchangeSettings,
  InsertAgentWeight,
  InsertThresholdConfig,
  InsertExternalApiKey,
  InsertExchangeSetting,
} from "../drizzle/schema";

// ===== Agent Weights =====

export async function getAgentWeights(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(agentWeights)
    .where(eq(agentWeights.userId, userId))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function upsertAgentWeights(data: InsertAgentWeight) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getAgentWeights(data.userId);
  
  if (existing) {
    await db
      .update(agentWeights)
      .set(data)
      .where(eq(agentWeights.userId, data.userId));
  } else {
    await db.insert(agentWeights).values(data);
  }
}

// ===== Threshold Config =====

export async function getThresholdConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(thresholdConfig)
    .where(eq(thresholdConfig.userId, userId))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function upsertThresholdConfig(data: InsertThresholdConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getThresholdConfig(data.userId);
  
  if (existing) {
    await db
      .update(thresholdConfig)
      .set(data)
      .where(eq(thresholdConfig.userId, data.userId));
  } else {
    await db.insert(thresholdConfig).values(data);
  }
}

// ===== External API Keys =====

export async function getExternalApiKeys(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(externalApiKeys)
    .where(eq(externalApiKeys.userId, userId));
}

export async function upsertExternalApiKey(data: InsertExternalApiKey) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if exists
  const existing = await db
    .select()
    .from(externalApiKeys)
    .where(eq(externalApiKeys.userId, data.userId))
    .limit(1);
  
  const match = existing.find(k => k.provider === data.provider);
  
  if (match) {
    await db
      .update(externalApiKeys)
      .set(data)
      .where(eq(externalApiKeys.id, match.id));
  } else {
    await db.insert(externalApiKeys).values(data);
  }
}

export async function deleteExternalApiKey(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .delete(externalApiKeys)
    .where(eq(externalApiKeys.id, id));
}

// ===== Exchange Settings =====

export async function getExchangeSettings(userId: number, exchangeId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(exchangeSettings)
    .where(eq(exchangeSettings.userId, userId))
    .limit(1);
  
  const match = result.find(s => s.exchangeId === exchangeId);
  
  return match || null;
}

export async function upsertExchangeSettings(data: InsertExchangeSetting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getExchangeSettings(data.userId, data.exchangeId);
  
  if (existing) {
    await db
      .update(exchangeSettings)
      .set(data)
      .where(eq(exchangeSettings.id, existing.id));
  } else {
    await db.insert(exchangeSettings).values(data);
  }
}

// ===== Database Export =====

export async function exportTradesToJSON(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const { trades } = await import("../drizzle/schema");
  
  return await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId));
}

export async function exportWinningPatternsToJSON(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const { winningPatterns } = await import("../drizzle/schema");
  
  return await db
    .select()
    .from(winningPatterns)
    // .where(eq(winningPatterns.userId, userId)); // TODO: Add userId to schema
}

export async function exportMLTrainingDataToJSON(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const { mlTrainingData } = await import("../drizzle/schema");
  
  return await db
    .select()
    .from(mlTrainingData)
    // .where(eq(mlTrainingData.userId, userId)); // TODO: Add userId to schema
}
