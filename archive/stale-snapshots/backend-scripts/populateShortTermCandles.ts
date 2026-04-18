/**
 * Enhanced Historical Candle Population Script
 * 
 * Fetches short-term high-resolution candle data for fast agent testing:
 * - 1m: Last 30 days (43,200 candles per symbol)
 * - 5m: Last 90 days (25,920 candles per symbol)
 * 
 * Uses Binance REST API directly with respectful rate limiting (1 req/sec).
 */

import { saveCandlesToDatabase } from '../../server/db/candleStorage.js';
import axios from 'axios';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

// Timeframe configurations
const TIMEFRAMES = [
  { interval: '1m', days: 30, limit: 1000 }, // 30 days = 43,200 candles
  { interval: '5m', days: 90, limit: 1000 }, // 90 days = 25,920 candles
];

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Fetch candles from Binance REST API
 */
async function fetchCandlesFromBinance(
  symbol: string,
  interval: string,
  limit: number = 1000,
  endTime?: number
): Promise<Candle[]> {
  try {
    const params: any = {
      symbol,
      interval,
      limit,
    };

    if (endTime) {
      params.endTime = endTime;
    }

    const response = await axios.get(
      `https://api.binance.com/api/v3/klines`,
      {
        params,
        timeout: 10000,
      }
    );

    if (!response.data || !Array.isArray(response.data)) {
      console.error('[fetchCandlesFromBinance] Invalid response from Binance');
      return [];
    }

    // Convert Binance format to our Candle format
    // Binance klines: [timestamp, open, high, low, close, volume, closeTime, ...]
    const candles: Candle[] = response.data.map((k: any[]) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    return candles;

  } catch (error: any) {
    if (error.response) {
      console.error(`[fetchCandlesFromBinance] Binance error (${error.response.status}):`, error.response.data);
    } else {
      console.error(`[fetchCandlesFromBinance] Error:`, error.message);
    }
    return [];
  }
}

/**
 * Calculate time chunks for fetching historical data
 */
function calculateTimeChunks(days: number, interval: string): { startTime: number; endTime: number }[] {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startTime = now - (days * oneDayMs);
  
  // Calculate candles per chunk based on interval
  const intervalMs = parseInterval(interval);
  const candlesPerChunk = 1000; // Binance limit
  const chunkDuration = candlesPerChunk * intervalMs;
  
  const chunks: { startTime: number; endTime: number }[] = [];
  let currentStart = startTime;
  
  while (currentStart < now) {
    const currentEnd = Math.min(currentStart + chunkDuration, now);
    chunks.push({ startTime: currentStart, endTime: currentEnd });
    currentStart = currentEnd;
  }
  
  return chunks;
}

/**
 * Parse interval string to milliseconds
 */
function parseInterval(interval: string): number {
  const value = parseInt(interval.slice(0, -1));
  const unit = interval.slice(-1);
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown interval unit: ${unit}`);
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main population function
 */
async function populateShortTermCandles() {
  console.log('🚀 Starting short-term historical candle population...\n');
  
  let totalCandles = 0;
  const startTime = Date.now();
  
  for (const symbol of SYMBOLS) {
    console.log(`\n📊 Processing ${symbol}...`);
    
    for (const { interval, days, limit } of TIMEFRAMES) {
      console.log(`\n  ⏱️  Fetching ${interval} candles (last ${days} days)...`);
      
      // Calculate how many requests needed
      const intervalMs = parseInterval(interval);
      const totalMs = days * 24 * 60 * 60 * 1000;
      const totalCandlesNeeded = Math.floor(totalMs / intervalMs);
      const requests = Math.ceil(totalCandlesNeeded / limit);
      
      console.log(`  📦 Total requests needed: ${requests} (${totalCandlesNeeded} candles)`);
      
      let symbolIntervalCandles = 0;
      let endTime = Date.now();
      
      for (let i = 0; i < requests; i++) {
        try {
          // Fetch candles for this batch
          const candles = await fetchCandlesFromBinance(
            symbol,
            interval,
            limit,
            endTime
          );
          
          if (candles.length === 0) {
            console.log(`  ⚠️  Request ${i + 1}/${requests}: No data returned`);
            break;
          }
          
          // Save to database
          await saveCandlesToDatabase(symbol, interval, candles);
          
          symbolIntervalCandles += candles.length;
          totalCandles += candles.length;
          
          // Update endTime to oldest candle timestamp for next batch
          endTime = candles[0].timestamp - 1;
          
          const progress = ((i + 1) / requests * 100).toFixed(1);
          console.log(`  ✅ Request ${i + 1}/${requests} (${progress}%): Saved ${candles.length} candles`);
          
          // Rate limiting: 1 request per second (respectful to Binance)
          if (i < requests - 1) {
            await sleep(1000);
          }
          
        } catch (error) {
          console.error(`  ❌ Request ${i + 1}/${requests} failed:`, error);
          
          // If rate limited, wait longer
          if (error instanceof Error && error.message.includes('429')) {
            console.log('  ⏳ Rate limited, waiting 5 seconds...');
            await sleep(5000);
            // Retry this request
            i--;
            continue;
          }
          
          // For other errors, continue to next request
          continue;
        }
      }
      
      console.log(`  ✅ ${interval}: Saved ${symbolIntervalCandles} candles`);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Population complete!');
  console.log('='.repeat(60));
  console.log(`📊 Total candles saved: ${totalCandles.toLocaleString()}`);
  console.log(`⏱️  Duration: ${duration} minutes`);
  console.log(`📦 Average rate: ${(totalCandles / parseFloat(duration)).toFixed(0)} candles/min`);
  console.log('='.repeat(60));
  
  // Print final database state
  console.log('\n📈 Expected database state after population:');
  console.log('┌─────────────┬──────────┬────────────┬──────────────┐');
  console.log('│ Symbol      │ Interval │ Days       │ Candles      │');
  console.log('├─────────────┼──────────┼────────────┼──────────────┤');
  
  for (const symbol of SYMBOLS) {
    for (const { interval, days } of TIMEFRAMES) {
      const expectedCandles = calculateExpectedCandles(interval, days);
      console.log(`│ ${symbol.padEnd(11)} │ ${interval.padEnd(8)} │ ${days.toString().padEnd(10)} │ ${expectedCandles.toLocaleString().padEnd(12)} │`);
    }
  }
  
  console.log('└─────────────┴──────────┴────────────┴──────────────┘');
  console.log('\n💡 Tip: Run the following SQL to verify:');
  console.log('   SELECT symbol, `interval`, COUNT(*) FROM historicalCandles GROUP BY symbol, `interval`;');
}

/**
 * Calculate expected number of candles
 */
function calculateExpectedCandles(interval: string, days: number): number {
  const intervalMs = parseInterval(interval);
  const totalMs = days * 24 * 60 * 60 * 1000;
  return Math.floor(totalMs / intervalMs);
}

// Run the script
populateShortTermCandles()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
