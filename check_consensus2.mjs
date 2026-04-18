import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get schema first
const [cols] = await conn.execute(`DESCRIBE tradeDecisionLogs`);
console.log('=== COLUMNS ===');
for (const c of cols) {
  console.log(`${c.Field}: ${c.Type}`);
}

// Get latest logs
const [logs] = await conn.execute(`
  SELECT * FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY createdAt DESC
  LIMIT 5
`);

console.log('\n=== LATEST CONSENSUS VALUES ===');
for (const log of logs) {
  console.log(JSON.stringify(log, null, 2));
}

// Get open positions
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
