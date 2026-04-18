import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all recent trade decision logs and check agent scores
const [logs] = await conn.execute(`
  SELECT id, symbol, agentScores, totalConfidence, createdAt
  FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('=== AGENT CONTRIBUTION ANALYSIS ===\n');

const agentCounts = {};
for (const log of logs) {
  const scores = typeof log.agentScores === 'string' ? JSON.parse(log.agentScores) : log.agentScores;
  if (scores) {
    for (const agent of Object.keys(scores)) {
      agentCounts[agent] = (agentCounts[agent] || 0) + 1;
    }
  }
}

console.log('Agent Contribution Count (last 20 signals):');
for (const [agent, count] of Object.entries(agentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${agent}: ${count} signals`);
}

console.log('\n=== SAMPLE AGENT SCORES ===');
for (const log of logs.slice(0, 3)) {
  const scores = typeof log.agentScores === 'string' ? JSON.parse(log.agentScores) : log.agentScores;
  console.log(`\n${log.symbol} @ ${log.createdAt}:`);
  if (scores) {
    for (const [agent, data] of Object.entries(scores)) {
      console.log(`  ${agent}: ${data.signal} (${data.confidence}%)`);
    }
  }
}

await conn.end();
