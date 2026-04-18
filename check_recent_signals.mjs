import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== RECENT FAST AGENT SIGNALS CHECK ===\n");

// Check the most recent TechnicalAnalyst signals
const [techSignals] = await conn.query(`
  SELECT 
    id,
    agentName, 
    signalType,
    confidence,
    executionScore,
    JSON_EXTRACT(signalData, '$.reasoning') as reasoning,
    timestamp
  FROM agentSignals 
  WHERE agentName IN ('TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'VolumeProfileAnalyzer')
  ORDER BY timestamp DESC
  LIMIT 10
`);

console.log("Recent Fast Agent Signals:");
for (const sig of techSignals) {
  const reasoning = sig.reasoning ? JSON.parse(sig.reasoning).substring(0, 100) : 'N/A';
  console.log(`\n${sig.agentName} @ ${sig.timestamp}:`);
  console.log(`  Signal: ${sig.signalType}, Confidence: ${sig.confidence}, ExecScore: ${sig.executionScore}`);
  console.log(`  Reasoning: ${reasoning}...`);
}

// Check confidence distribution in last hour
console.log("\n\n=== CONFIDENCE DISTRIBUTION (Last Hour) ===");
const [confDist] = await conn.query(`
  SELECT 
    agentName,
    AVG(CAST(confidence AS DECIMAL(10,4))) as avg_confidence,
    MIN(CAST(confidence AS DECIMAL(10,4))) as min_confidence,
    MAX(CAST(confidence AS DECIMAL(10,4))) as max_confidence,
    COUNT(*) as count
  FROM agentSignals 
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  AND agentName IN ('TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'VolumeProfileAnalyzer')
  GROUP BY agentName
`);
console.table(confDist);

await conn.end();
