import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== FAST AGENT SIGNAL PERSISTENCE AUDIT ===\n");

// Check the agentSignals table structure
console.log("1. AGENT SIGNALS TABLE STRUCTURE:");
const [columns] = await conn.query(`DESCRIBE agentSignals`);
console.table(columns);

// Check recent signals with full data
console.log("\n2. RECENT SIGNALS (Last 10 minutes):");
const [recentSignals] = await conn.query(`
  SELECT 
    id,
    agentName, 
    signalType,
    confidence,
    executionScore,
    timestamp
  FROM agentSignals 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
  ORDER BY timestamp DESC
  LIMIT 20
`);
console.table(recentSignals);

// Check if TechnicalAnalyst signals exist
console.log("\n3. TECHNICAL ANALYST SIGNALS (All Time):");
const [techSignals] = await conn.query(`
  SELECT COUNT(*) as count, MAX(timestamp) as latest
  FROM agentSignals 
  WHERE agentName = 'TechnicalAnalyst'
`);
console.table(techSignals);

// Check if PatternMatcher signals exist
console.log("\n4. PATTERN MATCHER SIGNALS (All Time):");
const [patternSignals] = await conn.query(`
  SELECT COUNT(*) as count, MAX(timestamp) as latest
  FROM agentSignals 
  WHERE agentName = 'PatternMatcher'
`);
console.table(patternSignals);

// Check if OrderFlowAnalyst signals exist
console.log("\n5. ORDER FLOW ANALYST SIGNALS (All Time):");
const [orderFlowSignals] = await conn.query(`
  SELECT COUNT(*) as count, MAX(timestamp) as latest
  FROM agentSignals 
  WHERE agentName = 'OrderFlowAnalyst'
`);
console.table(orderFlowSignals);

// Check signal count per agent in last 24 hours
console.log("\n6. SIGNAL COUNT PER AGENT (Last 24 Hours):");
const [signalCounts] = await conn.query(`
  SELECT 
    agentName,
    COUNT(*) as count,
    AVG(CAST(confidence AS DECIMAL(10,4))) as avg_confidence,
    AVG(executionScore) as avg_execution_score,
    MAX(timestamp) as latest
  FROM agentSignals 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY agentName
  ORDER BY count DESC
`);
console.table(signalCounts);

await conn.end();
console.log("\n=== AUDIT COMPLETE ===");
