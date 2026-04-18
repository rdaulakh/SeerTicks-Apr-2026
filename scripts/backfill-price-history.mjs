/**
 * Backfill priceHistory table
 * 
 * Step 1: Copy existing data from historicalCandles table
 * Step 2: Fetch additional historical data from Binance API
 * 
 * Usage: node scripts/backfill-price-history.mjs
 */

import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

async function getConnection() {
  return mysql.createConnection(DATABASE_URL);
}

/**
 * Step 1: Copy data from historicalCandles to priceHistory
 * historicalCandles.timestamp is a MySQL TIMESTAMP (datetime)
 * priceHistory.timestamp is a BIGINT (epoch ms)
 */
async function backfillFromHistoricalCandles(conn) {
  console.log('[Backfill] Step 1: Copying from historicalCandles...');
  
  // Check how many rows exist in historicalCandles
  const [countRows] = await conn.execute('SELECT COUNT(*) as cnt FROM historicalCandles');
  const totalCandles = countRows[0].cnt;
  console.log(`[Backfill] Found ${totalCandles} rows in historicalCandles`);
  
  if (totalCandles === 0) {
    console.log('[Backfill] No data in historicalCandles, skipping Step 1');
    return 0;
  }

  // Insert in batches to avoid memory issues
  // Convert TIMESTAMP to epoch milliseconds using UNIX_TIMESTAMP
  // Use INSERT IGNORE to skip duplicates (unique index on symbol+timestamp)
  const batchSize = 5000;
  let offset = 0;
  let totalInserted = 0;

  while (offset < totalCandles) {
    const [rows] = await conn.query(
      `INSERT IGNORE INTO priceHistory (symbol, timestamp, open, high, low, close, volume, source)
       SELECT 
         symbol,
         UNIX_TIMESTAMP(timestamp) * 1000,
         open, high, low, close, volume,
         CONCAT(source, '_backfill')
       FROM historicalCandles
       ORDER BY id
       LIMIT ${batchSize} OFFSET ${offset}`
    );
    
    const inserted = rows.affectedRows || 0;
    totalInserted += inserted;
    offset += batchSize;
    
    if (offset % 50000 === 0 || offset >= totalCandles) {
      console.log(`[Backfill] Progress: ${Math.min(offset, totalCandles)}/${totalCandles} processed, ${totalInserted} inserted`);
    }
  }

  console.log(`[Backfill] Step 1 complete: ${totalInserted} rows copied from historicalCandles`);
  return totalInserted;
}

/**
 * Step 2: Fetch historical klines from Binance API
 * Fetches 5m candles for BTC and ETH for the last 30 days
 */
async function backfillFromBinance(conn) {
  console.log('[Backfill] Step 2: Fetching from Binance API...');
  
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const interval = '5m';
  const limit = 1000; // Max per request
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let totalInserted = 0;

  for (const symbol of symbols) {
    console.log(`[Backfill] Fetching ${symbol} ${interval} candles...`);
    
    let startTime = thirtyDaysAgo;
    let batchCount = 0;

    while (startTime < Date.now()) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[Backfill] Binance API error: ${response.status} ${response.statusText}`);
          break;
        }
        
        const klines = await response.json();
        if (klines.length === 0) break;

        // Convert symbol format: BTCUSDT -> BTC-USD (for consistency with our system)
        const seerSymbol = symbol.replace('USDT', '-USD');

        // Batch insert
        const values = klines.map(k => [
          seerSymbol,
          k[0], // Open time (epoch ms)
          k[1], // Open
          k[2], // High
          k[3], // Low
          k[4], // Close
          k[5], // Volume
          'binance_backfill',
        ]);

        if (values.length > 0) {
          const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const flatValues = values.flat();
          
          const [result] = await conn.execute(
            `INSERT IGNORE INTO priceHistory (symbol, timestamp, open, high, low, close, volume, source)
             VALUES ${placeholders}`,
            flatValues
          );
          
          totalInserted += result.affectedRows || 0;
        }

        // Move to next batch
        startTime = klines[klines.length - 1][0] + 1;
        batchCount++;

        // Rate limit: Binance allows 1200 requests/min, but be conservative
        if (batchCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (batchCount % 50 === 0) {
          console.log(`[Backfill] ${symbol}: ${batchCount} batches fetched, ${totalInserted} total inserted`);
        }
      } catch (error) {
        console.error(`[Backfill] Error fetching ${symbol}:`, error.message);
        break;
      }
    }

    console.log(`[Backfill] ${symbol}: ${batchCount} batches complete`);
    // Small delay between symbols
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[Backfill] Step 2 complete: ${totalInserted} rows from Binance API`);
  return totalInserted;
}

async function main() {
  console.log('[Backfill] Starting priceHistory backfill...');
  const conn = await getConnection();
  
  try {
    // Check current state
    const [before] = await conn.execute('SELECT COUNT(*) as cnt FROM priceHistory');
    console.log(`[Backfill] priceHistory before: ${before[0].cnt} rows`);

    // Step 1: Copy from historicalCandles
    const step1 = await backfillFromHistoricalCandles(conn);
    
    // Step 2: Fetch from Binance
    const step2 = await backfillFromBinance(conn);

    // Final count
    const [after] = await conn.execute('SELECT COUNT(*) as cnt FROM priceHistory');
    console.log(`\n[Backfill] === COMPLETE ===`);
    console.log(`[Backfill] Before: ${before[0].cnt} rows`);
    console.log(`[Backfill] Step 1 (historicalCandles): +${step1} rows`);
    console.log(`[Backfill] Step 2 (Binance API): +${step2} rows`);
    console.log(`[Backfill] After: ${after[0].cnt} rows`);

    // Show sample data
    const [sample] = await conn.execute(
      'SELECT symbol, COUNT(*) as cnt, MIN(FROM_UNIXTIME(timestamp/1000)) as earliest, MAX(FROM_UNIXTIME(timestamp/1000)) as latest FROM priceHistory GROUP BY symbol'
    );
    console.log('\n[Backfill] Data summary by symbol:');
    for (const row of sample) {
      console.log(`  ${row.symbol}: ${row.cnt} candles (${row.earliest} to ${row.latest})`);
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
