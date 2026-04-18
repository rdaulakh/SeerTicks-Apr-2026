import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check all logging/audit tables
const loggingTables = [
  'tradeDecisionLogs',
  'executionLatencyLogs',
  'riskLimitBreaches',
  'consensusHistory',
  'serviceHealth',
  'serviceHealthHistory',
  'systemStartupLog',
  'learnedParameters'
];

console.log('Logging Tables Summary:');
for (const table of loggingTables) {
  try {
    const [rows] = await conn.execute(`SELECT COUNT(*) as count FROM ${table}`);
    console.log(`  ${table}: ${rows[0].count} records`);
  } catch (e) {
    console.log(`  ${table}: ERROR - ${e.message}`);
  }
}

// Check trade decision log breakdown
const [decisions] = await conn.execute(`
  SELECT decision, COUNT(*) as count 
  FROM tradeDecisionLogs 
  GROUP BY decision
`);
console.log('\nTrade Decision Breakdown:');
console.table(decisions);

// Check service health
const [health] = await conn.execute(`SELECT * FROM serviceHealth ORDER BY id DESC LIMIT 5`);
console.log('\nService Health Status:');
console.table(health);

await conn.end();
