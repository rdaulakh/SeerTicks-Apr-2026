import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== RAW FAST AGENT SIGNALS CHECK ===\n");

// Check the most recent TechnicalAnalyst signals
const [techSignals] = await conn.query(`
  SELECT 
    id,
    agentName, 
    signalType,
    confidence,
    executionScore,
    SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(signalData, '$.reasoning')), 1, 150) as reasoning_preview,
    timestamp
  FROM agentSignals 
  WHERE agentName IN ('TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'VolumeProfileAnalyzer')
  ORDER BY timestamp DESC
  LIMIT 10
`);

console.log("Recent Fast Agent Signals:");
console.table(techSignals);

await conn.end();
