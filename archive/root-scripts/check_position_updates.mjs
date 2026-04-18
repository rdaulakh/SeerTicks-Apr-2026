import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get open positions with their update timestamps
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, 
         unrealizedPnLPercent, createdAt, updatedAt,
         TIMESTAMPDIFF(SECOND, updatedAt, NOW()) as secondsSinceUpdate
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
  ORDER BY createdAt DESC
`);

console.log('\n=== POSITION UPDATE STATUS ===');
for (const p of positions) {
  console.log(`\n${p.symbol} (ID: ${p.id})`);
  console.log(`  Entry: $${parseFloat(p.entryPrice).toFixed(2)}`);
  console.log(`  Current: $${parseFloat(p.currentPrice).toFixed(2)}`);
  console.log(`  P&L: ${parseFloat(p.unrealizedPnLPercent || 0).toFixed(2)}%`);
  console.log(`  Last Updated: ${p.secondsSinceUpdate}s ago`);
  
  if (parseFloat(p.entryPrice) === parseFloat(p.currentPrice)) {
    console.log(`  ⚠️ STALE: Current price equals entry price!`);
  }
}

// Get current market prices from a recent trade decision log
const [recentLogs] = await conn.execute(`
  SELECT symbol, price, createdAt
  FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY createdAt DESC
  LIMIT 5
`);

console.log('\n=== RECENT MARKET PRICES (from logs) ===');
for (const log of recentLogs) {
  console.log(`${log.symbol}: $${parseFloat(log.price).toFixed(2)} (${log.createdAt})`);
}

await conn.end();
