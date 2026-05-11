/**
 * Daily Candle Update Cron Job
 * 
 * Runs daily at 00:05 UTC to fetch yesterday's candles and append to database.
 * Keeps historical data up-to-date without manual intervention.
 * 
 * Schedule: 0 5 0 * * * (00:05:00 UTC daily)
 */

import { fetchFromBinance } from '../utils/fetchHistoricalCandles';
import { getActiveClock } from '../_core/clock';
import { saveCandlesToDatabase, getLatestCandleTimestamp } from '../db/candleStorage';

// Configuration
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS = ['1m', '5m', '1h', '4h', '1d'];
const RATE_LIMIT_MS = 1000; // 1 second between requests

/**
 * Update candles for a single symbol/interval pair
 */
async function updateCandles(symbol: string, interval: string): Promise<number> {
  try {
    // Get latest timestamp in database
    const latestTimestamp = await getLatestCandleTimestamp(symbol, interval);

    if (!latestTimestamp) {
      console.log(`[DailyUpdate] No existing data for ${symbol} ${interval}, skipping...`);
      return 0;
    }

    // Calculate how many candles to fetch (from latest to now)
    const now = getActiveClock().now();
    const timeSinceLatest = now - latestTimestamp;
    
    // Interval durations in ms
    const intervalMs: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    const candlesNeeded = Math.ceil(timeSinceLatest / (intervalMs[interval] || intervalMs['1h']));

    if (candlesNeeded === 0) {
      console.log(`[DailyUpdate] ${symbol} ${interval} is already up-to-date`);
      return 0;
    }

    console.log(`[DailyUpdate] Fetching ${candlesNeeded} new candles for ${symbol} ${interval}...`);

    // Fetch new candles
    const newCandles = await fetchFromBinance(symbol, interval, Math.min(candlesNeeded + 10, 1000));

    if (newCandles.length === 0) {
      console.log(`[DailyUpdate] No new candles available for ${symbol} ${interval}`);
      return 0;
    }

    // Filter out candles we already have
    const candlesToSave = newCandles.filter(c => c.timestamp > latestTimestamp);

    if (candlesToSave.length === 0) {
      console.log(`[DailyUpdate] ${symbol} ${interval} is already up-to-date (no new candles)`);
      return 0;
    }

    // Save to database
    const saved = await saveCandlesToDatabase(symbol, interval, candlesToSave);

    console.log(`[DailyUpdate] ✅ ${symbol} ${interval}: ${saved} new candles saved`);
    return saved;

  } catch (error) {
    console.error(`[DailyUpdate] Error updating ${symbol} ${interval}:`, error);
    return 0;
  }
}

/**
 * Main daily update function
 */
export async function runDailyUpdate(): Promise<void> {
  console.log('='.repeat(60));
  console.log('🔄 DAILY CANDLE UPDATE STARTED');
  console.log('='.repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Intervals: ${INTERVALS.join(', ')}`);
  console.log('='.repeat(60));

  const startTime = getActiveClock().now();
  let totalUpdated = 0;

  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      const updated = await updateCandles(symbol, interval);
      totalUpdated += updated;

      // Rate limit between requests
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  const duration = ((getActiveClock().now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('✅ DAILY CANDLE UPDATE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total candles updated: ${totalUpdated}`);
  console.log(`Duration: ${duration}s`);
  console.log('='.repeat(60));
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyUpdate()
    .then(() => {
      console.log('Daily update completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error during daily update:', error);
      process.exit(1);
    });
}
