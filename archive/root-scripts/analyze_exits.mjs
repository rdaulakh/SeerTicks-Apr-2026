import mysql from 'mysql2/promise';

const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port) || 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true }
});

console.log('=== Closed Positions Analysis ===');
const [positions] = await connection.query(`
  SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnL, unrealizedPnLPercent, 
         status, createdAt, updatedAt
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'closed'
  ORDER BY updatedAt DESC 
  LIMIT 20
`);

console.log('Recent closed positions:', positions.length);
for (const p of positions) {
  const entry = parseFloat(p.entryPrice);
  const exit = parseFloat(p.currentPrice);
  const pnl = parseFloat(p.unrealizedPnL || 0);
  const pnlPct = parseFloat(p.unrealizedPnLPercent || 0);
  const holdTime = (new Date(p.updatedAt) - new Date(p.createdAt)) / 1000 / 60; // minutes
  console.log(`ID ${p.id} | ${p.symbol} ${p.side} | Entry: $${entry.toFixed(2)} | Exit: $${exit.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Hold: ${holdTime.toFixed(1)}min`);
}

console.log('\n=== P&L Summary ===');
const [summary] = await connection.query(`
  SELECT 
    COUNT(*) as totalClosed,
    SUM(CASE WHEN CAST(unrealizedPnL AS DECIMAL(20,4)) > 0 THEN 1 ELSE 0 END) as winners,
    SUM(CASE WHEN CAST(unrealizedPnL AS DECIMAL(20,4)) <= 0 THEN 1 ELSE 0 END) as losers,
    SUM(CAST(unrealizedPnL AS DECIMAL(20,4))) as totalPnL,
    AVG(CAST(unrealizedPnL AS DECIMAL(20,4))) as avgPnL,
    AVG(CAST(unrealizedPnLPercent AS DECIMAL(20,4))) as avgPnLPercent
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'closed'
`);
console.table(summary);

console.log('\n=== Exit Reasons (from tradeDecisionLogs) ===');
const [exitLogs] = await connection.query(`
  SELECT id, symbol, signalType, decision, decisionReason, exitReason, pnl, pnlPercent, timestamp
  FROM tradeDecisionLogs 
  WHERE userId = 272657 AND exitReason IS NOT NULL
  ORDER BY timestamp DESC 
  LIMIT 10
`);
console.log('Exit logs found:', exitLogs.length);
if (exitLogs.length > 0) {
  for (const log of exitLogs) {
    console.log(`${log.symbol} | Exit: ${log.exitReason} | P&L: ${log.pnl} (${log.pnlPercent}%)`);
  }
}

await connection.end();
