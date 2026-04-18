import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get latest trade decision logs to see consensus values
const [logs] = await conn.execute(`
  SELECT symbol, signalType, totalConfidence, threshold, decision, reason, price, createdAt
  FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY createdAt DESC
  LIMIT 10
`);

console.log('\n=== LATEST CONSENSUS VALUES ===');
for (const log of logs) {
  const conf = parseFloat(log.totalConfidence || 0) * 100;
  console.log(`${log.symbol}: ${log.signalType} | Consensus: ${conf.toFixed(1)}% | Decision: ${log.decision}`);
  console.log(`  Reason: ${log.reason}`);
  console.log(`  Time: ${log.createdAt}`);
  console.log('');
}

// Get open positions to compare
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnLPercent, createdAt
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
`);

console.log('\n=== OPEN POSITIONS ===');
for (const p of positions) {
  console.log(`${p.id}: ${p.symbol} ${p.side} | Entry: $${parseFloat(p.entryPrice).toFixed(2)} | Current: $${parseFloat(p.currentPrice).toFixed(2)} | P&L: ${parseFloat(p.unrealizedPnLPercent || 0).toFixed(2)}%`);
}

await conn.end();
