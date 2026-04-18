import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== VERIFYING ALL FIXES ===\n");

// 1. Check database indexes
console.log("1. DATABASE INDEXES:");
const [indexes] = await conn.query(`
  SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME 
  FROM information_schema.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND INDEX_NAME != 'PRIMARY'
    AND TABLE_NAME IN ('agentSignals', 'paperPositions', 'trades', 'tradeDecisionLogs')
  ORDER BY TABLE_NAME, INDEX_NAME
`);
console.log(`  Found ${indexes.length} non-primary indexes on critical tables`);
indexes.forEach(i => console.log(`    - ${i.TABLE_NAME}.${i.INDEX_NAME} (${i.COLUMN_NAME})`));

// 2. Check consensus recording (last 1 hour)
console.log("\n2. CONSENSUS RECORDING:");
const [recentConsensus] = await conn.query(`
  SELECT COUNT(*) as count, MAX(timestamp) as latest 
  FROM consensusHistory 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);
console.log(`  Records in last hour: ${recentConsensus[0].count}`);
console.log(`  Latest: ${recentConsensus[0].latest || 'None'}`);

// 3. Check engine state for user 272657
console.log("\n3. ENGINE STATE (User 272657):");
const [engineState] = await conn.query(`
  SELECT isRunning, enableAutoTrading, startedAt, stoppedAt 
  FROM engineState 
  WHERE userId = 272657 
  ORDER BY id DESC 
  LIMIT 1
`);
if (engineState.length > 0) {
  console.log(`  isRunning: ${engineState[0].isRunning}`);
  console.log(`  enableAutoTrading: ${engineState[0].enableAutoTrading}`);
  console.log(`  startedAt: ${engineState[0].startedAt}`);
  console.log(`  stoppedAt: ${engineState[0].stoppedAt}`);
}

// 4. Check trading mode config
console.log("\n4. TRADING MODE CONFIG (User 272657):");
const [tradingMode] = await conn.query(`
  SELECT mode, autoTradeEnabled 
  FROM tradingModeConfig 
  WHERE userId = 272657
`);
if (tradingMode.length > 0) {
  console.log(`  mode: ${tradingMode[0].mode}`);
  console.log(`  autoTradeEnabled: ${tradingMode[0].autoTradeEnabled}`);
}

// 5. Check recent signals for user 272657
console.log("\n5. RECENT SIGNALS (User 272657, last 1 hour):");
const [recentSignals] = await conn.query(`
  SELECT COUNT(*) as count, MAX(createdAt) as latest 
  FROM agentSignals 
  WHERE userId = 272657 
    AND createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);
console.log(`  Signals in last hour: ${recentSignals[0].count}`);
console.log(`  Latest: ${recentSignals[0].latest || 'None'}`);

// 6. Check trade decisions with position IDs
console.log("\n6. TRADE DECISIONS WITH POSITION IDs:");
const [decisionsWithPos] = await conn.query(`
  SELECT COUNT(*) as count 
  FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' AND positionId IS NOT NULL
`);
const [decisionsWithoutPos] = await conn.query(`
  SELECT COUNT(*) as count 
  FROM tradeDecisionLogs 
  WHERE decision = 'EXECUTED' AND positionId IS NULL
`);
console.log(`  With positionId: ${decisionsWithPos[0].count}`);
console.log(`  Without positionId: ${decisionsWithoutPos[0].count}`);

// 7. Check recent positions
console.log("\n7. RECENT POSITIONS (last 1 hour):");
const [recentPositions] = await conn.query(`
  SELECT COUNT(*) as count, MAX(createdAt) as latest 
  FROM paperPositions 
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);
console.log(`  Positions in last hour: ${recentPositions[0].count}`);
console.log(`  Latest: ${recentPositions[0].latest || 'None'}`);

await conn.end();
console.log("\n=== VERIFICATION COMPLETE ===");
