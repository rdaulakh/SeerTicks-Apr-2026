/**
 * ConsensusRecorder - Records consensus history to database via Drizzle ORM
 * 
 * Migrated from raw SQL to Drizzle for type safety and consistency.
 * Called by StrategyOrchestrator after each consensus calculation.
 */

import { getDb } from '../db';
import { consensusHistory } from '../../drizzle/schema';

export interface ConsensusRecord {
  symbol: string;
  timeframe: string;
  finalSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  finalConfidence: number; // 0-1 range (converted to 0-100 for storage)
  consensusPercentage: number; // 0-100
  bullishVotes: number;
  bearishVotes: number;
  neutralVotes: number;
  agentVotes: {
    agentName: string;
    signal: string;
    confidence: number;
    weight: number;
  }[];
  tradeId?: number;
  userId?: number;
}

/** Map input signal to DB enum value */
function normalizeSignal(signal: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const map: Record<string, 'BULLISH' | 'BEARISH' | 'NEUTRAL'> = {
    bullish: 'BULLISH',
    bearish: 'BEARISH',
    neutral: 'NEUTRAL',
  };
  return map[signal.toLowerCase()] || 'NEUTRAL';
}

/**
 * Record a single consensus decision to the database.
 * Non-throwing — consensus recording must never break trading.
 */
export async function recordConsensus(record: ConsensusRecord): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn('[ConsensusRecorder] Database not available');
      return;
    }

    const finalSignal = normalizeSignal(record.finalSignal);

    await db.insert(consensusHistory).values({
      symbol: record.symbol,
      timeframe: record.timeframe || '5m',
      finalSignal,
      finalConfidence: Math.round(record.finalConfidence * 100),
      consensusPercentage: Math.round(record.consensusPercentage),
      bullishVotes: record.bullishVotes,
      bearishVotes: record.bearishVotes,
      neutralVotes: record.neutralVotes,
      agentVotes: JSON.stringify(record.agentVotes),
      tradeId: record.tradeId || null,
    });

    console.log(`[ConsensusRecorder] Recorded consensus for ${record.symbol}: ${finalSignal} (${record.finalConfidence.toFixed(2)})`);
  } catch (error) {
    // Non-throwing — consensus recording must never break trading
    console.error('[ConsensusRecorder] Failed to record consensus:', error);
  }
}

/**
 * Batch record multiple consensus entries (for high-frequency scenarios).
 * Non-throwing — consensus recording must never break trading.
 */
export async function recordConsensusBatch(records: ConsensusRecord[]): Promise<void> {
  if (records.length === 0) return;

  try {
    const db = await getDb();
    if (!db) {
      console.warn('[ConsensusRecorder] Database not available');
      return;
    }

    const values = records.map(record => ({
      symbol: record.symbol,
      timeframe: record.timeframe || '5m',
      finalSignal: normalizeSignal(record.finalSignal),
      finalConfidence: Math.round(record.finalConfidence * 100),
      consensusPercentage: Math.round(record.consensusPercentage),
      bullishVotes: record.bullishVotes,
      bearishVotes: record.bearishVotes,
      neutralVotes: record.neutralVotes,
      agentVotes: JSON.stringify(record.agentVotes),
      tradeId: record.tradeId || null,
    }));

    await db.insert(consensusHistory).values(values);

    console.log(`[ConsensusRecorder] Batch recorded ${records.length} consensus entries`);
  } catch (error) {
    console.error('[ConsensusRecorder] Failed to batch record consensus:', error);
  }
}
