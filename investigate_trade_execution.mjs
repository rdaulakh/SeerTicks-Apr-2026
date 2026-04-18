import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== TRADE EXECUTION PIPELINE INVESTIGATION ===\n");

// 1. Check trade decision logs structure
console.log("1. Sample EXECUTED decision:");
const [executed] = await conn.query(`
  SELECT * FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' 
  ORDER BY createdAt DESC 
  LIMIT 1
`);
console.log(JSON.stringify(executed[0], null, 2));

// 2. Check if there's a positionId or tradeId in the decision
console.log("\n2. EXECUTED decisions with positionId:");
const [withPosition] = await conn.query(`
  SELECT COUNT(*) as count FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' AND positionId IS NOT NULL
`);
console.log(`  With positionId: ${withPosition[0].count}`);

const [withoutPosition] = await conn.query(`
  SELECT COUNT(*) as count FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' AND positionId IS NULL
`);
console.log(`  Without positionId: ${withoutPosition[0].count}`);

// 3. Check paperPositions creation timestamps
console.log("\n3. Recent paperPositions (last 24h):");
const [recentPositions] = await conn.query(`
  SELECT id, symbol, side, status, entryPrice, createdAt 
  FROM paperPositions 
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  ORDER BY createdAt DESC
  LIMIT 5
`);
console.log(JSON.stringify(recentPositions, null, 2));

// 4. Check automatedTradeLog
console.log("\n4. Recent automatedTradeLog:");
const [autoTrades] = await conn.query(`
  SELECT * FROM automatedTradeLog 
  ORDER BY createdAt DESC 
  LIMIT 5
`);
console.log(`  Total automated trades: ${autoTrades.length}`);
if (autoTrades.length > 0) {
  console.log(JSON.stringify(autoTrades[0], null, 2));
}

// 5. Check if there's a gap between decision and position creation
console.log("\n5. Decisions vs Positions by hour (last 24h):");
const [decisionsByHour] = await conn.query(`
  SELECT 
    DATE_FORMAT(createdAt, '%Y-%m-%d %H:00') as hour,
    COUNT(*) as decisions
  FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' 
    AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY hour
  ORDER BY hour DESC
  LIMIT 5
`);
console.log("Decisions:", JSON.stringify(decisionsByHour, null, 2));

const [positionsByHour] = await conn.query(`
  SELECT 
    DATE_FORMAT(createdAt, '%Y-%m-%d %H:00') as hour,
    COUNT(*) as positions
  FROM paperPositions 
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY hour
  ORDER BY hour DESC
  LIMIT 5
`);
console.log("Positions:", JSON.stringify(positionsByHour, null, 2));

await conn.end();
