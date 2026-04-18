/**
 * Trading Signals Database Functions
 */

import { eq, and, desc, gte } from "drizzle-orm";
import { getDb } from "../db";
import { tradingSignals, type InsertTradingSignal, type TradingSignal } from "../../drizzle/schema";

/**
 * Save a trading signal to database
 */
export async function saveTradingSignal(signal: InsertTradingSignal): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot save signal: database not available");
    return;
  }

  try {
    await db.insert(tradingSignals).values(signal);
  } catch (error) {
    console.error("[SignalsDb] Failed to save signal:", error);
    throw error;
  }
}

/**
 * Get recent signals for a user
 */
export async function getRecentSignals(
  userId: number,
  limit: number = 50
): Promise<TradingSignal[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot get signals: database not available");
    return [];
  }

  try {
    const signals = await db
      .select()
      .from(tradingSignals)
      .where(eq(tradingSignals.userId, userId))
      .orderBy(desc(tradingSignals.timestamp))
      .limit(limit);

    return signals;
  } catch (error) {
    console.error("[SignalsDb] Failed to get signals:", error);
    return [];
  }
}

/**
 * Get signals for a specific symbol
 */
export async function getSignalsBySymbol(
  userId: number,
  symbol: string,
  limit: number = 20
): Promise<TradingSignal[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot get signals: database not available");
    return [];
  }

  try {
    const signals = await db
      .select()
      .from(tradingSignals)
      .where(
        and(
          eq(tradingSignals.userId, userId),
          eq(tradingSignals.symbol, symbol)
        )
      )
      .orderBy(desc(tradingSignals.timestamp))
      .limit(limit);

    return signals;
  } catch (error) {
    console.error("[SignalsDb] Failed to get signals by symbol:", error);
    return [];
  }
}

/**
 * Get unexecuted signals
 */
export async function getUnexecutedSignals(userId: number): Promise<TradingSignal[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot get signals: database not available");
    return [];
  }

  try {
    const signals = await db
      .select()
      .from(tradingSignals)
      .where(
        and(
          eq(tradingSignals.userId, userId),
          eq(tradingSignals.executed, false)
        )
      )
      .orderBy(desc(tradingSignals.timestamp));

    return signals;
  } catch (error) {
    console.error("[SignalsDb] Failed to get unexecuted signals:", error);
    return [];
  }
}

/**
 * Mark signal as executed
 */
export async function markSignalExecuted(
  signalId: number,
  tradeId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot update signal: database not available");
    return;
  }

  try {
    await db
      .update(tradingSignals)
      .set({
        executed: true,
        executedAt: new Date(),
        tradeId,
      })
      .where(eq(tradingSignals.id, signalId));
  } catch (error) {
    console.error("[SignalsDb] Failed to mark signal executed:", error);
    throw error;
  }
}

/**
 * Get signals from the last N hours
 */
export async function getRecentSignalsByTime(
  userId: number,
  hoursAgo: number = 24
): Promise<TradingSignal[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot get signals: database not available");
    return [];
  }

  try {
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const signals = await db
      .select()
      .from(tradingSignals)
      .where(
        and(
          eq(tradingSignals.userId, userId),
          gte(tradingSignals.timestamp, cutoffTime)
        )
      )
      .orderBy(desc(tradingSignals.timestamp));

    return signals;
  } catch (error) {
    console.error("[SignalsDb] Failed to get recent signals by time:", error);
    return [];
  }
}

/**
 * Get signal statistics
 */
export async function getSignalStats(userId: number): Promise<{
  total: number;
  executed: number;
  unexecuted: number;
  byType: { BUY: number; SELL: number; NEUTRAL: number };
  bySource: { RSI: number; MACD: number; STOCHASTIC: number; COMBINED: number };
}> {
  const db = await getDb();
  if (!db) {
    console.warn("[SignalsDb] Cannot get stats: database not available");
    return {
      total: 0,
      executed: 0,
      unexecuted: 0,
      byType: { BUY: 0, SELL: 0, NEUTRAL: 0 },
      bySource: { RSI: 0, MACD: 0, STOCHASTIC: 0, COMBINED: 0 },
    };
  }

  try {
    const allSignals = await db
      .select()
      .from(tradingSignals)
      .where(eq(tradingSignals.userId, userId));

    const stats = {
      total: allSignals.length,
      executed: allSignals.filter(s => s.executed).length,
      unexecuted: allSignals.filter(s => !s.executed).length,
      byType: {
        BUY: allSignals.filter(s => s.signalType === 'BUY').length,
        SELL: allSignals.filter(s => s.signalType === 'SELL').length,
        NEUTRAL: allSignals.filter(s => s.signalType === 'NEUTRAL').length,
      },
      bySource: {
        RSI: allSignals.filter(s => s.source === 'RSI').length,
        MACD: allSignals.filter(s => s.source === 'MACD').length,
        STOCHASTIC: allSignals.filter(s => s.source === 'STOCHASTIC').length,
        COMBINED: allSignals.filter(s => s.source === 'COMBINED').length,
      },
    };

    return stats;
  } catch (error) {
    console.error("[SignalsDb] Failed to get signal stats:", error);
    return {
      total: 0,
      executed: 0,
      unexecuted: 0,
      byType: { BUY: 0, SELL: 0, NEUTRAL: 0 },
      bySource: { RSI: 0, MACD: 0, STOCHASTIC: 0, COMBINED: 0 },
    };
  }
}
