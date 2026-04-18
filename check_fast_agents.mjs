import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== FAST AGENT SIGNALS AUDIT ===\n");

// 1. Check all agent signals in last hour
console.log("1. ALL AGENT SIGNALS (Last 1 Hour):");
const [allSignals] = await conn.query(`
  SELECT 
    agentName, 
    COUNT(*) as signal_count,
    AVG(confidence) as avg_confidence,
    MAX(timestamp) as latest_signal
  FROM agentSignals 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  GROUP BY agentName
  ORDER BY signal_count DESC
`);
console.table(allSignals);

// 2. Check fast agent names in the system
console.log("\n2. FAST AGENT TYPES:");
const fastAgents = ['MomentumAgent', 'VolumeAgent', 'TrendAgent', 'VolatilityAgent', 'OrderFlowAgent', 'PriceActionAgent'];
console.log("Expected fast agents:", fastAgents);

// 3. Check if any fast agent signals exist at all
console.log("\n3. FAST AGENT SIGNALS (All Time):");
const [fastSignalsAll] = await conn.query(`
  SELECT 
    agentName, 
    COUNT(*) as total_count,
    AVG(confidence) as avg_confidence,
    MAX(timestamp) as latest_signal
  FROM agentSignals 
  WHERE agentName IN (?)
  GROUP BY agentName
`, [fastAgents]);
if (fastSignalsAll.length === 0) {
  console.log("  ❌ NO FAST AGENT SIGNALS FOUND IN DATABASE!");
} else {
  console.table(fastSignalsAll);
}

// 4. Check what agent types exist in the database
console.log("\n4. ALL UNIQUE AGENT NAMES IN DATABASE:");
const [uniqueAgents] = await conn.query(`
  SELECT DISTINCT agentName FROM agentSignals ORDER BY agentName
`);
console.log(uniqueAgents.map(a => a.agentName));

// 5. Check recent signals sample
console.log("\n5. SAMPLE OF RECENT SIGNALS:");
const [recentSample] = await conn.query(`
  SELECT agentName, symbol, direction, confidence, timestamp
  FROM agentSignals 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
  ORDER BY timestamp DESC
  LIMIT 10
`);
console.table(recentSample);

await conn.end();
console.log("\n=== AUDIT COMPLETE ===");
