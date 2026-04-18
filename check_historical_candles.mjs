import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== HISTORICAL CANDLES DATABASE CHECK ===\n");

// Check data by symbol and interval
const [results] = await conn.query(`
  SELECT symbol, \`interval\`, COUNT(*) as count, MAX(timestamp) as latest
  FROM historicalCandles 
  GROUP BY symbol, \`interval\`
  ORDER BY count DESC
`);

console.log("Historical Candles by Symbol/Interval:");
console.table(results);

// Check if we have BTC-USD data
const [btcData] = await conn.query(`
  SELECT symbol, \`interval\`, COUNT(*) as count
  FROM historicalCandles 
  WHERE symbol LIKE '%BTC%'
  GROUP BY symbol, \`interval\`
`);

console.log("\nBTC-related data:");
console.table(btcData);

await conn.end();
