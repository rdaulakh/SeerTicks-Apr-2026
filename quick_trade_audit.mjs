import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Paper positions
const [positions] = await connection.execute(`
  SELECT id, userId, symbol, side, status, entryPrice, currentPrice, quantity,
         unrealizedPnL, realizedPnl, stopLoss, takeProfit, 
         originalConsensus, currentConfidence, exitReason, createdAt, updatedAt
  FROM paperPositions
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('\n=== PAPER POSITIONS ===');
let openCount = 0, closedCount = 0;
for (const p of positions) {
  if (p.status === 'open') openCount++;
  else closedCount++;
  
  console.log(`\n#${p.id} [${p.status}] User:${p.userId} ${p.symbol} ${p.side}`);
  console.log(`  Entry: ${p.entryPrice} | Current: ${p.currentPrice} | Qty: ${p.quantity}`);
  if (p.status === 'open') {
    console.log(`  Unrealized P&L: ${p.unrealizedPnL} | SL: ${p.stopLoss} | TP: ${p.takeProfit}`);
    console.log(`  Consensus: ${p.originalConsensus} -> ${p.currentConfidence}`);
  } else {
    console.log(`  Realized P&L: ${p.realizedPnl} | Exit: ${p.exitReason}`);
  }
}
console.log(`\nSummary: ${openCount} open, ${closedCount} closed`);

// Check for issues
console.log('\n=== POTENTIAL ISSUES ===');

const [noSL] = await connection.execute(`
  SELECT id, symbol FROM paperPositions 
  WHERE status = 'open' AND (stopLoss IS NULL OR stopLoss = '0' OR stopLoss = '')
`);
console.log(`Positions without stop-loss: ${noSL.length}`);
for (const p of noSL) console.log(`  - #${p.id} ${p.symbol}`);

const [stale] = await connection.execute(`
  SELECT id, symbol, updatedAt FROM paperPositions 
  WHERE status = 'open' AND updatedAt < DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);
console.log(`Stale positions (>1hr): ${stale.length}`);
for (const p of stale) console.log(`  - #${p.id} ${p.symbol} last updated: ${p.updatedAt}`);

const [zeroConf] = await connection.execute(`
  SELECT id, symbol, currentConfidence FROM paperPositions 
  WHERE status = 'open' AND (currentConfidence IS NULL OR currentConfidence = '0' OR currentConfidence = '')
`);
console.log(`Zero confidence positions: ${zeroConf.length}`);
for (const p of zeroConf) console.log(`  - #${p.id} ${p.symbol}`);

// Consensus history
const [consensus] = await connection.execute(`
  SELECT symbol, COUNT(*) as cnt, 
         SUM(CASE WHEN finalSignal = 'BULLISH' THEN 1 ELSE 0 END) as bull,
         SUM(CASE WHEN finalSignal = 'BEARISH' THEN 1 ELSE 0 END) as bear,
         MAX(timestamp) as last
  FROM consensusHistory
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY symbol
`);
console.log('\n=== CONSENSUS (24h) ===');
for (const c of consensus) {
  console.log(`${c.symbol}: ${c.cnt} records | Bull: ${c.bull} | Bear: ${c.bear} | Last: ${c.last}`);
}

// Exit reasons
const [exits] = await connection.execute(`
  SELECT exitReason, COUNT(*) as cnt
  FROM paperPositions
  WHERE status = 'closed' AND exitReason IS NOT NULL
  GROUP BY exitReason
  ORDER BY cnt DESC
`);
console.log('\n=== EXIT REASONS ===');
for (const e of exits) {
  console.log(`${e.exitReason}: ${e.cnt}`);
}

await connection.end();
