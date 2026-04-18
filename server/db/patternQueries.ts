/**
 * Pattern Queries
 * Database helpers for fetching validated patterns from winningPatterns table
 */

import { getDb } from '../db';
import { winningPatterns } from '../../drizzle/schema';
import { and, eq, gte } from 'drizzle-orm';

export interface ValidatedPattern {
  id: number;
  patternName: string;
  symbol: string;
  timeframe: string;
  winRate: number;
  profitFactor: number;
  confidenceScore: number;
  stopLoss: number;
  takeProfit: number;
  maxHold: number;
  totalTrades: number;
  winningTrades: number;
  isActive: boolean;
  alphaDecayFlag: boolean;
}

/**
 * Get all validated patterns above minimum win rate threshold
 * 
 * @param minWinRate Minimum win rate (0.55 = 55%)
 * @param symbol Optional symbol filter
 * @param timeframe Optional timeframe filter
 * @returns Array of validated patterns
 */
export async function getValidatedPatterns(
  minWinRate: number = 0.55,
  symbol?: string,
  timeframe?: string
): Promise<ValidatedPattern[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const conditions = [
      gte(winningPatterns.winRate, minWinRate.toString()),
      eq(winningPatterns.isActive, true),
      eq(winningPatterns.alphaDecayFlag, false),
    ];

    if (symbol) {
      conditions.push(eq(winningPatterns.symbol, symbol));
    }

    if (timeframe) {
      conditions.push(eq(winningPatterns.timeframe, timeframe as any));
    }

    const results = await db
      .select()
      .from(winningPatterns)
      .where(and(...conditions));

    return results.map(row => ({
      id: row.id,
      patternName: row.patternName,
      symbol: row.symbol,
      timeframe: row.timeframe,
      winRate: parseFloat(row.winRate || '0'),
      profitFactor: parseFloat(row.profitFactor || '0'),
      confidenceScore: row.confidenceScore / 100, // Convert from 0-100 to 0-1
      stopLoss: parseFloat(row.stopLoss || '0'),
      takeProfit: parseFloat(row.takeProfit || '0'),
      maxHold: row.maxHold || 0,
      totalTrades: row.totalTrades,
      winningTrades: row.winningTrades,
      isActive: row.isActive,
      alphaDecayFlag: row.alphaDecayFlag,
    }));
  } catch (error) {
    console.error('[PatternQueries] Error fetching validated patterns:', error);
    return [];
  }
}

/**
 * Get pattern configuration for a specific pattern/symbol/timeframe
 * 
 * @param patternName Pattern name
 * @param symbol Trading symbol
 * @param timeframe Candle timeframe
 * @returns Pattern configuration or null
 */
export async function getPatternConfig(
  patternName: string,
  symbol: string,
  timeframe: string
): Promise<ValidatedPattern | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const results = await db
      .select()
      .from(winningPatterns)
      .where(
        and(
          eq(winningPatterns.patternName, patternName),
          eq(winningPatterns.symbol, symbol),
          eq(winningPatterns.timeframe, timeframe as any),
          eq(winningPatterns.isActive, true)
        )
      )
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id,
      patternName: row.patternName,
      symbol: row.symbol,
      timeframe: row.timeframe,
      winRate: parseFloat(row.winRate || '0'),
      profitFactor: parseFloat(row.profitFactor || '0'),
      confidenceScore: row.confidenceScore / 100, // Convert from 0-100 to 0-1
      stopLoss: parseFloat(row.stopLoss || '0'),
      takeProfit: parseFloat(row.takeProfit || '0'),
      maxHold: row.maxHold || 0,
      totalTrades: row.totalTrades,
      winningTrades: row.winningTrades,
      isActive: row.isActive,
      alphaDecayFlag: row.alphaDecayFlag,
    };
  } catch (error) {
    console.error('[PatternQueries] Error fetching pattern config:', error);
    return null;
  }
}

/**
 * Get top N patterns by win rate
 * 
 * @param limit Number of patterns to return
 * @param symbol Optional symbol filter
 * @param timeframe Optional timeframe filter
 * @returns Array of top patterns
 */
export async function getTopPatterns(
  limit: number = 10,
  symbol?: string,
  timeframe?: string
): Promise<ValidatedPattern[]> {
  const patterns = await getValidatedPatterns(0.55, symbol, timeframe);
  
  return patterns
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit);
}

/**
 * Check if a pattern is validated and active
 * 
 * @param patternName Pattern name
 * @param symbol Trading symbol
 * @param timeframe Candle timeframe
 * @returns True if pattern is validated and active
 */
export async function isPatternValidated(
  patternName: string,
  symbol: string,
  timeframe: string
): Promise<boolean> {
  const config = await getPatternConfig(patternName, symbol, timeframe);
  return config !== null && config.winRate >= 0.55 && !config.alphaDecayFlag;
}

/**
 * Get all patterns for a symbol across all timeframes
 * 
 * @param symbol Trading symbol
 * @param minWinRate Minimum win rate threshold
 * @returns Array of patterns grouped by timeframe
 */
export async function getSymbolPatterns(
  symbol: string,
  minWinRate: number = 0.55
): Promise<Record<string, ValidatedPattern[]>> {
  const patterns = await getValidatedPatterns(minWinRate, symbol);
  
  const grouped: Record<string, ValidatedPattern[]> = {};
  
  for (const pattern of patterns) {
    if (!grouped[pattern.timeframe]) {
      grouped[pattern.timeframe] = [];
    }
    grouped[pattern.timeframe].push(pattern);
  }
  
  return grouped;
}
