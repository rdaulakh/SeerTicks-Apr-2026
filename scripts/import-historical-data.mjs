/**
 * Import Historical Data Script
 * 
 * Imports 2 years of OHLCV data from Coinbase Exchange API (public, no auth)
 * Stores data in historicalCandles table for pattern analysis
 * 
 * Usage: node scripts/import-historical-data.mjs
 */

import { drizzle } from 'drizzle-orm/mysql2';
import { historicalCandles } from '../drizzle/schema.ts';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable not set');
  process.exit(1);
}

const db = drizzle(DATABASE_URL);

/**
 * Coinbase Exchange API (Public) - No authentication required
 * Endpoint: GET /products/{product_id}/candles
 * Rate limit: 10 requests/second (public endpoints)
 * 
 * Response format: [[timestamp, low, high, open, close, volume], ...]
 */
const COINBASE_BASE_URL = 'https://api.exchange.coinbase.com';

// Symbols to import (Coinbase format)
const SYMBOLS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'ADA-USD',
  'DOGE-USD',
  'MATIC-USD',
  'DOT-USD',
  'AVAX-USD',
  'LINK-USD',
];

// Timeframes to import
// Coinbase granularity in seconds: 60, 300, 900, 3600, 21600, 86400
const INTERVALS = [
  { key: '1m', granularity: 60 },
  { key: '5m', granularity: 300 },
  { key: '15m', granularity: 900 },
  { key: '1h', granularity: 3600 },
  { key: '6h', granularity: 21600 }, // 4h not supported, using 6h
  { key: '1d', granularity: 86400 },
];

/**
 * Fetch candles from Coinbase Exchange API
 * @param {string} symbol - Trading pair (e.g., 'BTC-USD')
 * @param {number} granularity - Granularity in seconds (60, 300, 900, 3600, 21600, 86400)
 * @param {number} start - ISO 8601 timestamp or Unix timestamp
 * @param {number} end - ISO 8601 timestamp or Unix timestamp
 */
async function fetchCandles(symbol, granularity, start, end) {
  // Convert Unix timestamps to ISO 8601 format
  const startISO = new Date(start * 1000).toISOString();
  const endISO = new Date(end * 1000).toISOString();
  
  const url = `${COINBASE_BASE_URL}/products/${symbol}/candles?granularity=${granularity}&start=${startISO}&end=${endISO}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Coinbase API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Coinbase returns: [[timestamp, low, high, open, close, volume], ...]
    return data || [];
  } catch (error) {
    console.error(`❌ Failed to fetch candles for ${symbol} (${granularity}s):`, error.message);
    return [];
  }
}

/**
 * Sleep for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Import historical data for a symbol and interval
 */
async function importSymbolInterval(symbol, interval) {
  console.log(`\n📊 Importing ${symbol} - ${interval.key} (${interval.granularity}s granularity)`);
  
  // Calculate time range: 2 years ago to now
  const now = Math.floor(Date.now() / 1000);
  const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60);
  
  // Coinbase API limits: max 300 candles per request
  const maxCandles = 300;
  const chunkSize = maxCandles * interval.granularity;
  
  let totalImported = 0;
  let start = twoYearsAgo;
  
  while (start < now) {
    const end = Math.min(start + chunkSize, now);
    
    console.log(`  📥 Fetching ${new Date(start * 1000).toISOString().split('T')[0]} to ${new Date(end * 1000).toISOString().split('T')[0]}`);
    
    const candles = await fetchCandles(symbol, interval.granularity, start, end);
    
    if (candles.length === 0) {
      console.log(`  ⚠️  No data returned, skipping...`);
      start = end;
      continue;
    }
    
    // Convert to database format
    // Coinbase format: [timestamp, low, high, open, close, volume]
    const records = candles.map(candle => ({
      symbol: symbol.replace('-', ''), // Convert BTC-USD to BTCUSD for consistency
      interval: interval.key,
      timestamp: new Date(candle[0] * 1000),
      open: candle[3].toString(),
      high: candle[2].toString(),
      low: candle[1].toString(),
      close: candle[4].toString(),
      volume: candle[5].toString(),
      source: 'coinbase',
    }));
    
    // Insert into database (batch insert)
    try {
      await db.insert(historicalCandles).values(records);
      
      totalImported += records.length;
      console.log(`  ✅ Inserted ${records.length} candles (total: ${totalImported})`);
    } catch (error) {
      console.error(`  ❌ Database insert failed:`, error.message);
    }
    
    start = end;
    
    // Rate limiting: 10 requests/second = 100ms between requests
    await sleep(150);
  }
  
  console.log(`✅ Completed ${symbol} - ${interval.key}: ${totalImported} candles`);
  return totalImported;
}

/**
 * Main import function
 */
async function main() {
  console.log('🚀 Starting historical data import...');
  console.log(`📅 Time range: ${new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`);
  console.log(`📊 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Intervals: ${INTERVALS.map(i => i.key).join(', ')}`);
  console.log('');
  
  let totalCandles = 0;
  
  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      const count = await importSymbolInterval(symbol, interval);
      totalCandles += count;
      
      // Pause between symbols to avoid rate limits
      await sleep(500);
    }
  }
  
  console.log('\n✅ Import complete!');
  console.log(`📊 Total candles imported: ${totalCandles.toLocaleString()}`);
  console.log(`💾 Database: historicalCandles table`);
  
  process.exit(0);
}

// Run import
main().catch(error => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});
