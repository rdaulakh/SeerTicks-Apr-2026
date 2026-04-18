import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Check exit reason distribution
const [exitReasons] = await connection.query(`
  SELECT exitReason, COUNT(*) as count 
  FROM paperPositions 
  WHERE status = 'closed'
  GROUP BY exitReason
  ORDER BY count DESC
`);

console.log("=== EXIT REASON DISTRIBUTION ===\n");
exitReasons.forEach(r => {
  console.log(`${r.exitReason || 'NULL/UNKNOWN'}: ${r.count}`);
});

// Check positions with null/empty exit reason
const [nullExits] = await connection.query(`
  SELECT id, userId, symbol, entryPrice, exitPrice, realizedPnl, closedAt, exitReason
  FROM paperPositions 
  WHERE status = 'closed' AND (exitReason IS NULL OR exitReason = '')
  ORDER BY closedAt DESC
  LIMIT 10
`);

console.log("\n\n=== POSITIONS WITH NULL EXIT REASON ===\n");
nullExits.forEach(p => {
  console.log(`ID: ${p.id}, User: ${p.userId}, Symbol: ${p.symbol}`);
  console.log(`  Entry: ${p.entryPrice}, Exit: ${p.exitPrice}, PnL: ${p.realizedPnl}`);
  console.log(`  Closed: ${p.closedAt}, Reason: ${p.exitReason || 'NULL'}`);
});

await connection.end();
