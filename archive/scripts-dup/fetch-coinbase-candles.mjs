#!/usr/bin/env node
/**
 * Fetch 2 years of historical candle data from Coinbase API
 * Coinbase API: https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const COINBASE_API_BASE = "https://api.exchange.coinbase.com";
const SYMBOL = "BTC-USD";
const GRANULARITY = 3600; // 1 hour in seconds
const TWO_YEARS_AGO = Math.floor(Date.now() / 1000) - (2 * 365 * 24 * 60 * 60);
const NOW = Math.floor(Date.now() / 1000);
const MAX_CANDLES_PER_REQUEST = 300; // Coinbase limit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCandlesChunk(symbol, start, end, granularity) {
  const url = `${COINBASE_API_BASE}/products/${symbol}/candles?start=${start}&end=${end}&granularity=${granularity}`;
  
  console.log(`Fetching candles from ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`);
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SEER-Trading-Platform",
    },
  });

  if (!response.ok) {
    throw new Error(`Coinbase API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Coinbase returns: [[time, low, high, open, close, volume], ...]
  return data.map(candle => ({
    timestamp: new Date(candle[0] * 1000),
    low: candle[1].toString(),
    high: candle[2].toString(),
    open: candle[3].toString(),
    close: candle[4].toString(),
    volume: candle[5].toString(),
  }));
}

async function main() {
  console.log("🚀 Starting Coinbase candle data fetch...");
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Granularity: ${GRANULARITY}s (1 hour)`);
  console.log(`Time range: ${new Date(TWO_YEARS_AGO * 1000).toISOString()} to ${new Date(NOW * 1000).toISOString()}`);

  // Connect to database
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);

  let currentStart = TWO_YEARS_AGO;
  let totalCandles = 0;
  const allCandles = [];

  // Fetch data in chunks
  while (currentStart < NOW) {
    const currentEnd = Math.min(currentStart + (MAX_CANDLES_PER_REQUEST * GRANULARITY), NOW);
    
    try {
      const candles = await fetchCandlesChunk(SYMBOL, currentStart, currentEnd, GRANULARITY);
      
      if (candles.length > 0) {
        allCandles.push(...candles);
        totalCandles += candles.length;
        console.log(`✅ Fetched ${candles.length} candles (Total: ${totalCandles})`);
      }
      
      currentStart = currentEnd;
      
      // Rate limiting: wait 200ms between requests
      await sleep(200);
    } catch (error) {
      console.error(`❌ Error fetching chunk:`, error.message);
      // Continue with next chunk
      currentStart = currentEnd;
    }
  }

  console.log(`\n📊 Total candles fetched: ${totalCandles}`);
  console.log(`💾 Inserting into database...`);

  // Insert in batches of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < allCandles.length; i += BATCH_SIZE) {
    const batch = allCandles.slice(i, i + BATCH_SIZE);
    const values = batch.map(c => 
      `('${SYMBOL}', '${c.timestamp.toISOString().slice(0, 19).replace('T', ' ')}', '${c.open}', '${c.high}', '${c.low}', '${c.close}', '${c.volume}', '1h')`
    ).join(',');
    
    await connection.execute(
      `INSERT INTO candleData (symbol, timestamp, open, high, low, close, volume, \`interval\`) VALUES ${values}`
    );
    
    console.log(`✅ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allCandles.length / BATCH_SIZE)}`);
  }

  await connection.end();
  
  console.log(`\n✅ Done! ${totalCandles} candles stored in database.`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
