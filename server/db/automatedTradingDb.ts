import { eq, and, gte, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import { withDatabaseRetry, DatabaseRetryPresets } from '../utils/DatabaseRetry';
import {
  automatedTradingSettings,
  InsertAutomatedTradingSettings,
  AutomatedTradingSettings,
  automatedTradeLog,
  InsertAutomatedTradeLog,
  AutomatedTradeLog,
  paperPositions,
} from "../../drizzle/schema";

export async function getAutomatedTradingSettings(userId: number): Promise<AutomatedTradingSettings | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(automatedTradingSettings).where(eq(automatedTradingSettings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertAutomatedTradingSettings(settings: InsertAutomatedTradingSettings): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert automated trading settings: database not available");
    return;
  }

  await withDatabaseRetry(async () => {
    await db.insert(automatedTradingSettings).values(settings).onDuplicateKeyUpdate({
      set: {
        enabled: settings.enabled,
        minSignalConfidence: settings.minSignalConfidence,
        maxPositionSizePercent: settings.maxPositionSizePercent,
        useKellyCriterion: settings.useKellyCriterion,
        kellyFraction: settings.kellyFraction,
        maxTradesPerDay: settings.maxTradesPerDay,
        maxOpenPositions: settings.maxOpenPositions,
        cooldownMinutes: settings.cooldownMinutes,
        maxDailyLossUSD: settings.maxDailyLossUSD,
        stopOnConsecutiveLosses: settings.stopOnConsecutiveLosses,
        requireBothAgentTypes: settings.requireBothAgentTypes,
        tradingHours: settings.tradingHours,
        allowedSymbols: settings.allowedSymbols,
        blockedSymbols: settings.blockedSymbols,
        enableTechnicalSignals: settings.enableTechnicalSignals,
        enableSentimentSignals: settings.enableSentimentSignals,
        enableOnChainSignals: settings.enableOnChainSignals,
        useMarketOrders: settings.useMarketOrders,
        limitOrderOffsetPercent: settings.limitOrderOffsetPercent,
        notifyOnExecution: settings.notifyOnExecution,
        notifyOnRejection: settings.notifyOnRejection,
        updatedAt: new Date(),
      },
    });
  }, DatabaseRetryPresets.STANDARD, "upsertAutomatedTradingSettings");
}

export async function createAutomatedTradeLog(log: InsertAutomatedTradeLog): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create automated trade log: database not available");
    return 0;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.insert(automatedTradeLog).values(log);
    return result[0].insertId;
  }, DatabaseRetryPresets.STANDARD, "createAutomatedTradeLog");
}

export async function updateAutomatedTradeLog(id: number, updates: Partial<InsertAutomatedTradeLog>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update automated trade log: database not available");
    return;
  }

  await withDatabaseRetry(async () => {
    await db.update(automatedTradeLog).set(updates).where(eq(automatedTradeLog.id, id));
  }, DatabaseRetryPresets.STANDARD, "updateAutomatedTradeLog");
}

export async function getAutomatedTradeLogsByUser(userId: number, limit: number = 100): Promise<AutomatedTradeLog[]> {
  const db = await getDb();
  if (!db) return [];

  return await withDatabaseRetry(async () => {
    return await db.select().from(automatedTradeLog)
      .where(eq(automatedTradeLog.userId, userId))
      .orderBy(desc(automatedTradeLog.createdAt))
      .limit(limit);
  }, DatabaseRetryPresets.FAST, "getAutomatedTradeLogsByUser");
}

export async function getTodayAutomatedTradeCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed"),
        gte(automatedTradeLog.createdAt, today)
      ));
    
    return result[0]?.count || 0;
  }, DatabaseRetryPresets.FAST, "getTodayAutomatedTradeCount");
}

export async function getTodayAutomatedPnL(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all executed automated trades today
    const logs = await db.select()
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed"),
        gte(automatedTradeLog.createdAt, today)
      ));
    
    // Sum up P&L from associated positions
    let totalPnL = 0;
    for (const log of logs) {
      if (log.positionId) {
        const position = await db.select()
          .from(paperPositions)
          .where(eq(paperPositions.id, log.positionId))
          .limit(1);
        
        if (position.length > 0) {
          totalPnL += Number(position[0].realizedPnl || position[0].unrealizedPnL || 0);
        }
      }
    }
    
    return totalPnL;
  }, DatabaseRetryPresets.FAST, "getTodayAutomatedPnL");
}

export async function getRecentConsecutiveLosses(userId: number, limit: number = 10): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    // Get recent executed trades
    const logs = await db.select()
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed")
      ))
      .orderBy(desc(automatedTradeLog.createdAt))
      .limit(limit);
    
    let consecutiveLosses = 0;
    for (const log of logs) {
      if (log.positionId) {
        const position = await db.select()
          .from(paperPositions)
          .where(eq(paperPositions.id, log.positionId))
          .limit(1);
        
        if (position.length > 0) {
          const pnl = Number(position[0].realizedPnl || position[0].unrealizedPnL || 0);
          if (pnl < 0) {
            consecutiveLosses++;
          } else {
            break; // Stop at first win
          }
        }
      }
    }
    
    return consecutiveLosses;
  }, DatabaseRetryPresets.FAST, "getRecentConsecutiveLosses");
}
