import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check open positions
const [openPositions] = await conn.execute(`
  SELECT COUNT(*) as count FROM paperPositions WHERE status = 'open' AND userId = 272657
`);
console.log(`Open positions: ${openPositions[0].count}`);

// Check recently closed positions
const [closedPositions] = await conn.execute(`
  SELECT id, symbol, exitReason, pnl, closedAt
  FROM paperPositions 
  WHERE status = 'closed' AND userId = 272657
  ORDER BY closedAt DESC
  LIMIT 5
`);

console.log('\n=== RECENTLY CLOSED ===');
for (const pos of closedPositions) {
  console.log(`ID ${pos.id} (${pos.symbol}): P&L $${pos.pnl} - Reason: ${pos.exitReason || 'N/A'}`);
  console.log(`  Closed: ${pos.closedAt}`);
}

// Check current consensus from trade logs
const [logs] = await conn.execute(`
  SELECT symbol, signalType, totalConfidence, createdAt
  FROM tradeDecisionLogs
  WHERE userId = 272657
  ORDER BY id DESC
  LIMIT 3
`);

console.log('\n=== CURRENT CONSENSUS ===');
for (const log of logs) {
  console.log(`${log.symbol}: ${log.signalType} @ ${log.totalConfidence}%`);
}

await conn.end();
