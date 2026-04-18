/**
 * Historical Candle Storage & Retrieval
 * 
 * Database-backed OHLCV storage for super-fast agent analysis.
 * Eliminates API dependency and enables instant backtesting.
 */

import { getDb } from '../db';
import { historicalCandles, type InsertHistoricalCandle } from '../../drizzle/schema';
import { and, eq, gte, lte, desc, or, inArray } from 'drizzle-orm';
import type { Candle } from '../WebSocketCandleCache';
import { getSymbolVariations } from '../utils/symbolNormalization';

/**
 * Save candles to database (batch insert for efficiency)
 * 
 * @param candles Array of candles to save
 * @returns Number of candles saved
 */
export async function saveCandlesToDatabase(
  symbol: string,
  interval: string,
  candles: Candle[]
): Promise<number> {
  const db = await getDb();
  if (!db || candles.length === 0) return 0;

  try {
    const records: InsertHistoricalCandle[] = candles.map(c => ({
      symbol,
      interval,
      timestamp: new Date(c.timestamp),
      open: c.open.toString(),
      high: c.high.toString(),
      low: c.low.toString(),
      close: c.close.toString(),
      volume: c.volume.toString(),
      source: 'binance',
    }));

    // Batch insert (500 at a time to avoid query size limits)
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await db.insert(historicalCandles).values(batch);
      totalInserted += batch.length;
    }

    console.log(`[CandleStorage] ✅ Saved ${totalInserted} candles for ${symbol} ${interval}`);
    return totalInserted;

  } catch (error) {
    console.error(`[CandleStorage] Error saving candles:`, error);
    return 0;
  }
}

/**
 * Load candles from database
 * 
 * @param symbol Trading symbol (e.g., 'BTCUSDT')
 * @param interval Timeframe (e.g., '1h', '4h', '1d')
 * @param limit Number of candles to load (default: 200)
 * @returns Array of candles
 */
export async function loadCandlesFromDatabase(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<Candle[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    // Get all possible symbol format variations (BTC-USD, BTCUSD, BTCUSDT, etc.)
    const symbolVariations = getSymbolVariations(symbol);
    
    // Try to find candles with any of the symbol variations
    const results = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          or(...symbolVariations.map(s => eq(historicalCandles.symbol, s))),
          eq(historicalCandles.interval, interval)
        )
      )
      .orderBy(desc(historicalCandles.timestamp))
      .limit(limit);

    // Convert database format to Candle format
    const candles: Candle[] = results
      .reverse() // Oldest first
      .map(r => ({
        timestamp: r.timestamp.getTime(),
        open: parseFloat(r.open.toString()),
        high: parseFloat(r.high.toString()),
        low: parseFloat(r.low.toString()),
        close: parseFloat(r.close.toString()),
        volume: parseFloat(r.volume.toString()),
      }));

    if (candles.length > 0) {
      console.log(`[CandleStorage] ⚡ Loaded ${candles.length} candles for ${symbol} ${interval} from database`);
    } else {
      console.warn(`[CandleStorage] ⚠️  No candles found for ${symbol} ${interval}. Tried variations: ${symbolVariations.join(', ')}`);
    }
    return candles;

  } catch (error) {
    console.error(`[CandleStorage] Error loading candles:`, error);
    return [];
  }
}

/**
 * Load candles for a specific date range
 * 
 * @param symbol Trading symbol
 * @param interval Timeframe
 * @param startTime Start timestamp (ms)
 * @param endTime End timestamp (ms)
 * @returns Array of candles
 */
export async function loadCandlesByDateRange(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    // Get all possible symbol format variations
    const symbolVariations = getSymbolVariations(symbol);
    
    const results = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          or(...symbolVariations.map(s => eq(historicalCandles.symbol, s))),
          eq(historicalCandles.interval, interval),
          gte(historicalCandles.timestamp, new Date(startTime)),
          lte(historicalCandles.timestamp, new Date(endTime))
        )
      )
      .orderBy(historicalCandles.timestamp);

    const candles: Candle[] = results.map(r => ({
      timestamp: r.timestamp.getTime(),
      open: parseFloat(r.open.toString()),
      high: parseFloat(r.high.toString()),
      low: parseFloat(r.low.toString()),
      close: parseFloat(r.close.toString()),
      volume: parseFloat(r.volume.toString()),
    }));

    return candles;

  } catch (error) {
    console.error(`[CandleStorage] Error loading candles by date range:`, error);
    return [];
  }
}

/**
 * Get the latest candle timestamp for a symbol/interval
 * Used to determine where to start fetching new data
 * 
 * @param symbol Trading symbol
 * @param interval Timeframe
 * @returns Latest candle timestamp (ms) or null if no data
 */
export async function getLatestCandleTimestamp(
  symbol: string,
  interval: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // Get all possible symbol format variations
    const symbolVariations = getSymbolVariations(symbol);
    
    const result = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          or(...symbolVariations.map(s => eq(historicalCandles.symbol, s))),
          eq(historicalCandles.interval, interval)
        )
      )
      .orderBy(desc(historicalCandles.timestamp))
      .limit(1);

    if (result.length === 0) return null;

    return result[0].timestamp.getTime();

  } catch (error) {
    console.error(`[CandleStorage] Error getting latest timestamp:`, error);
    return null;
  }
}

/**
 * Count total candles in database for a symbol/interval
 * 
 * @param symbol Trading symbol
 * @param interval Timeframe
 * @returns Number of candles
 */
export async function getCandleCount(
  symbol: string,
  interval: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    // Get all possible symbol format variations
    const symbolVariations = getSymbolVariations(symbol);
    
    const result = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          or(...symbolVariations.map(s => eq(historicalCandles.symbol, s))),
          eq(historicalCandles.interval, interval)
        )
      );

    return result.length;

  } catch (error) {
    console.error(`[CandleStorage] Error counting candles:`, error);
    return 0;
  }
}

/**
 * Delete old candles to manage database size
 * Keep only the most recent N candles per symbol/interval
 * 
 * @param symbol Trading symbol
 * @param interval Timeframe
 * @param keepCount Number of candles to keep
 * @returns Number of candles deleted
 */
export async function pruneOldCandles(
  symbol: string,
  interval: string,
  keepCount: number = 10000 // Keep ~1 year of hourly data
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    // Get timestamp of the Nth most recent candle
    const cutoffResult = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          eq(historicalCandles.symbol, symbol),
          eq(historicalCandles.interval, interval)
        )
      )
      .orderBy(desc(historicalCandles.timestamp))
      .limit(1)
      .offset(keepCount);

    if (cutoffResult.length === 0) return 0; // Not enough candles to prune

    const cutoffTimestamp = cutoffResult[0].timestamp;

    // Delete candles older than cutoff
    const deleted = await db
      .delete(historicalCandles)
      .where(
        and(
          eq(historicalCandles.symbol, symbol),
          eq(historicalCandles.interval, interval),
          lte(historicalCandles.timestamp, cutoffTimestamp)
        )
      );

    console.log(`[CandleStorage] 🗑️  Pruned old candles for ${symbol} ${interval}`);
    return 0; // Drizzle doesn't return affected rows easily

  } catch (error) {
    console.error(`[CandleStorage] Error pruning candles:`, error);
    return 0;
  }
}


