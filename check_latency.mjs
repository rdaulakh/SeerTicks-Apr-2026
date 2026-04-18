import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check execution latency logs
const [latencyLogs] = await conn.execute(`
  SELECT * FROM executionLatencyLogs 
  ORDER BY id DESC 
  LIMIT 10
`);
console.log('Recent Execution Latency Logs:');
console.table(latencyLogs);

// Check average latencies
const [avgLatency] = await conn.execute(`
  SELECT 
    AVG(signalToConsensusMs) as avgSignalToConsensus,
    AVG(consensusToDecisionMs) as avgConsensusToDecision,
    AVG(decisionToOrderMs) as avgDecisionToOrder,
    AVG(orderToFillMs) as avgOrderToFill,
    AVG(totalLatencyMs) as avgTotal,
    COUNT(*) as sampleCount
  FROM executionLatencyLogs
  WHERE totalLatencyMs IS NOT NULL
`);
console.log('\nAverage Latencies (ms):');
console.table(avgLatency);

await conn.end();
