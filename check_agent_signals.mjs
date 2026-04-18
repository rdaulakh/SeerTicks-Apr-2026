import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check recent trade decision logs to see which agents are contributing
const [logs] = await conn.execute(`
  SELECT 
    id,
    symbol,
    signalType,
    totalConfidence,
    agentScores,
    decision,
    createdAt
  FROM tradeDecisionLogs
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
  ORDER BY createdAt DESC
  LIMIT 5
`);

console.log('\n=== RECENT TRADE DECISIONS (Last 5 min) ===\n');

for (const log of logs) {
  console.log(`${log.symbol} - ${log.signalType} - ${log.totalConfidence?.toFixed(1)}% - ${log.decision}`);
  
  // Parse agent scores to see which agents contributed
  if (log.agentScores) {
    try {
      const scores = typeof log.agentScores === 'string' ? JSON.parse(log.agentScores) : log.agentScores;
      console.log('  Contributing agents:');
      for (const [agent, data] of Object.entries(scores)) {
        console.log(`    - ${agent}: ${data.signal} (${data.confidence?.toFixed(1)}%)`);
      }
    } catch (e) {
      console.log('  Agent scores:', log.agentScores);
    }
  }
  console.log('');
}

await conn.end();
