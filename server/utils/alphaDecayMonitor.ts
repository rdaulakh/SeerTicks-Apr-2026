/**
 * Alpha Decay Monitoring System
 * 
 * Tracks live pattern performance vs backtest metrics and auto-disables degraded patterns.
 * Implements rolling window win rate calculation and alerts for pattern degradation.
 */

import { getDb } from '../db';
import { winningPatterns } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

export interface TradeResult {
  patternId: number;
  patternName: string;
  symbol: string;
  timeframe: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  success: boolean;
  profitPercent: number;
}

export interface AlphaDecayStatus {
  patternId: number;
  patternName: string;
  symbol: string;
  timeframe: string;
  backtestWinRate: number;
  liveWinRate: number;
  degradation: number; // Percentage point drop
  isDecayed: boolean;
  shouldDisable: boolean;
  totalLiveTrades: number;
  recentLiveTrades: number;
}

const ROLLING_WINDOW_SIZE = 20; // Last 20 trades
const DECAY_THRESHOLD = 0.10; // 10% drop from backtest WR
const MIN_TRADES_FOR_DECAY_CHECK = 10; // Need at least 10 trades to check decay

/**
 * Record a trade result for alpha decay tracking
 * 
 * @param tradeResult Trade execution result
 */
export async function recordTradeResult(tradeResult: TradeResult): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error('[AlphaDecay] Database not available');
    return;
  }

  try {
    // Get current pattern
    const patterns = await db
      .select()
      .from(winningPatterns)
      .where(eq(winningPatterns.id, tradeResult.patternId))
      .limit(1);

    if (patterns.length === 0) {
      console.error(`[AlphaDecay] Pattern ${tradeResult.patternId} not found`);
      return;
    }

    const pattern = patterns[0];

    // Parse performance history
    let performanceHistory: Array<{ success: boolean; profit: number; timestamp: number }> = [];
    if (pattern.performanceHistory) {
      try {
        performanceHistory = typeof pattern.performanceHistory === 'string'
          ? JSON.parse(pattern.performanceHistory)
          : pattern.performanceHistory as any;
      } catch (e) {
        performanceHistory = [];
      }
    }

    // Add new trade result
    performanceHistory.push({
      success: tradeResult.success,
      profit: tradeResult.profitPercent,
      timestamp: tradeResult.exitTime,
    });

    // Keep only last N trades (rolling window)
    if (performanceHistory.length > ROLLING_WINDOW_SIZE * 2) {
      performanceHistory = performanceHistory.slice(-ROLLING_WINDOW_SIZE * 2);
    }

    // Update pattern stats
    const newTotalTrades = pattern.totalTrades + 1;
    const newWinningTrades = pattern.winningTrades + (tradeResult.success ? 1 : 0);

    await db
      .update(winningPatterns)
      .set({
        totalTrades: newTotalTrades,
        winningTrades: newWinningTrades,
        performanceHistory: JSON.stringify(performanceHistory),
        lastUsed: new Date(tradeResult.exitTime),
      })
      .where(eq(winningPatterns.id, tradeResult.patternId));

    console.log(`[AlphaDecay] Recorded trade for ${tradeResult.patternName} (${tradeResult.symbol} ${tradeResult.timeframe}): ${tradeResult.success ? 'WIN' : 'LOSS'}`);

    // Check for alpha decay
    await checkAlphaDecay(tradeResult.patternId);
  } catch (error) {
    console.error('[AlphaDecay] Error recording trade result:', error);
  }
}

/**
 * Check if a pattern has experienced alpha decay
 * 
 * @param patternId Pattern ID to check
 * @returns Alpha decay status
 */
export async function checkAlphaDecay(patternId: number): Promise<AlphaDecayStatus | null> {
  const db = await getDb();
  if (!db) {
    console.error('[AlphaDecay] Database not available');
    return null;
  }

  try {
    // Get pattern
    const patterns = await db
      .select()
      .from(winningPatterns)
      .where(eq(winningPatterns.id, patternId))
      .limit(1);

    if (patterns.length === 0) {
      return null;
    }

    const pattern = patterns[0];

    // Parse performance history
    let performanceHistory: Array<{ success: boolean; profit: number; timestamp: number }> = [];
    if (pattern.performanceHistory) {
      try {
        performanceHistory = typeof pattern.performanceHistory === 'string'
          ? JSON.parse(pattern.performanceHistory)
          : pattern.performanceHistory as any;
      } catch (e) {
        performanceHistory = [];
      }
    }

    // Need minimum trades to check decay
    if (performanceHistory.length < MIN_TRADES_FOR_DECAY_CHECK) {
      return null;
    }

    // Calculate live win rate (last N trades)
    const recentTrades = performanceHistory.slice(-ROLLING_WINDOW_SIZE);
    const recentWins = recentTrades.filter(t => t.success).length;
    const liveWinRate = recentWins / recentTrades.length;

    // Get backtest win rate
    const backtestWinRate = parseFloat(pattern.winRate || '0');

    // Calculate degradation
    const degradation = backtestWinRate - liveWinRate;
    const isDecayed = degradation >= DECAY_THRESHOLD;
    const shouldDisable = isDecayed && !pattern.alphaDecayFlag;

    const status: AlphaDecayStatus = {
      patternId: pattern.id,
      patternName: pattern.patternName,
      symbol: pattern.symbol,
      timeframe: pattern.timeframe,
      backtestWinRate,
      liveWinRate,
      degradation,
      isDecayed,
      shouldDisable,
      totalLiveTrades: performanceHistory.length,
      recentLiveTrades: recentTrades.length,
    };

    // Auto-disable if decayed
    if (shouldDisable) {
      await db
        .update(winningPatterns)
        .set({
          alphaDecayFlag: true,
          isActive: false,
        })
        .where(eq(winningPatterns.id, patternId));

      console.warn(`[AlphaDecay] ⚠️  PATTERN DEGRADED: ${pattern.patternName} (${pattern.symbol} ${pattern.timeframe})`);
      console.warn(`[AlphaDecay]   Backtest WR: ${(backtestWinRate * 100).toFixed(1)}%`);
      console.warn(`[AlphaDecay]   Live WR: ${(liveWinRate * 100).toFixed(1)}%`);
      console.warn(`[AlphaDecay]   Degradation: -${(degradation * 100).toFixed(1)}%`);
      console.warn(`[AlphaDecay]   Pattern auto-disabled`);
    }

    return status;
  } catch (error) {
    console.error('[AlphaDecay] Error checking alpha decay:', error);
    return null;
  }
}

/**
 * Get all patterns with alpha decay
 * 
 * @returns Array of degraded patterns
 */
export async function getDecayedPatterns(): Promise<AlphaDecayStatus[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    const patterns = await db
      .select()
      .from(winningPatterns)
      .where(eq(winningPatterns.alphaDecayFlag, true));

    const statuses: AlphaDecayStatus[] = [];

    for (const pattern of patterns) {
      // Parse performance history
      let performanceHistory: Array<{ success: boolean; profit: number; timestamp: number }> = [];
      if (pattern.performanceHistory) {
        try {
          performanceHistory = typeof pattern.performanceHistory === 'string'
            ? JSON.parse(pattern.performanceHistory)
            : pattern.performanceHistory as any;
        } catch (e) {
          performanceHistory = [];
        }
      }

      if (performanceHistory.length < MIN_TRADES_FOR_DECAY_CHECK) {
        continue;
      }

      // Calculate live win rate
      const recentTrades = performanceHistory.slice(-ROLLING_WINDOW_SIZE);
      const recentWins = recentTrades.filter(t => t.success).length;
      const liveWinRate = recentWins / recentTrades.length;

      const backtestWinRate = parseFloat(pattern.winRate || '0');
      const degradation = backtestWinRate - liveWinRate;

      statuses.push({
        patternId: pattern.id,
        patternName: pattern.patternName,
        symbol: pattern.symbol,
        timeframe: pattern.timeframe,
        backtestWinRate,
        liveWinRate,
        degradation,
        isDecayed: true,
        shouldDisable: false, // Already disabled
        totalLiveTrades: performanceHistory.length,
        recentLiveTrades: recentTrades.length,
      });
    }

    return statuses;
  } catch (error) {
    console.error('[AlphaDecay] Error getting decayed patterns:', error);
    return [];
  }
}

/**
 * Reset alpha decay flag for a pattern (manual re-enable)
 * 
 * @param patternId Pattern ID
 */
export async function resetAlphaDecay(patternId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return false;
  }

  try {
    await db
      .update(winningPatterns)
      .set({
        alphaDecayFlag: false,
        isActive: true,
        performanceHistory: JSON.stringify([]), // Clear history
      })
      .where(eq(winningPatterns.id, patternId));

    console.log(`[AlphaDecay] Reset alpha decay for pattern ${patternId}`);
    return true;
  } catch (error) {
    console.error('[AlphaDecay] Error resetting alpha decay:', error);
    return false;
  }
}

/**
 * Get alpha decay summary for all patterns
 * 
 * @returns Summary statistics
 */
export async function getAlphaDecaySummary(): Promise<{
  totalPatterns: number;
  activePatterns: number;
  decayedPatterns: number;
  atRiskPatterns: number;
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalPatterns: 0,
      activePatterns: 0,
      decayedPatterns: 0,
      atRiskPatterns: 0,
    };
  }

  try {
    const allPatterns = await db.select().from(winningPatterns);

    const totalPatterns = allPatterns.length;
    const activePatterns = allPatterns.filter(p => p.isActive && !p.alphaDecayFlag).length;
    const decayedPatterns = allPatterns.filter(p => p.alphaDecayFlag).length;

    // Check at-risk patterns (degradation > 5% but < 10%)
    let atRiskPatterns = 0;
    for (const pattern of allPatterns) {
      if (pattern.alphaDecayFlag || !pattern.isActive) continue;

      let performanceHistory: Array<{ success: boolean }> = [];
      if (pattern.performanceHistory) {
        try {
          performanceHistory = typeof pattern.performanceHistory === 'string'
            ? JSON.parse(pattern.performanceHistory)
            : pattern.performanceHistory as any;
        } catch (e) {
          continue;
        }
      }

      if (performanceHistory.length < MIN_TRADES_FOR_DECAY_CHECK) continue;

      const recentTrades = performanceHistory.slice(-ROLLING_WINDOW_SIZE);
      const recentWins = recentTrades.filter(t => t.success).length;
      const liveWinRate = recentWins / recentTrades.length;
      const backtestWinRate = parseFloat(pattern.winRate || '0');
      const degradation = backtestWinRate - liveWinRate;

      if (degradation >= 0.05 && degradation < DECAY_THRESHOLD) {
        atRiskPatterns++;
      }
    }

    return {
      totalPatterns,
      activePatterns,
      decayedPatterns,
      atRiskPatterns,
    };
  } catch (error) {
    console.error('[AlphaDecay] Error getting summary:', error);
    return {
      totalPatterns: 0,
      activePatterns: 0,
      decayedPatterns: 0,
      atRiskPatterns: 0,
    };
  }
}
