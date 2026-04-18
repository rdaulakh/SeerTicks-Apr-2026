import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check risk limit breaches
const [breaches] = await conn.execute(`
  SELECT breachType, COUNT(*) as count, MAX(timestamp) as lastOccurrence
  FROM riskLimitBreaches
  GROUP BY breachType
  ORDER BY count DESC
`);
console.log('Risk Limit Breaches by Type:');
console.table(breaches);

// Check recent breaches
const [recentBreaches] = await conn.execute(`
  SELECT breachType, severity, details, timestamp
  FROM riskLimitBreaches
  ORDER BY timestamp DESC
  LIMIT 5
`);
console.log('\nRecent Risk Breaches:');
console.table(recentBreaches);

// Check current drawdown state
const [drawdownState] = await conn.execute(`
  SELECT * FROM engineState ORDER BY id DESC LIMIT 1
`);
console.log('\nEngine State (includes risk config):');
console.log(drawdownState[0]?.config || 'No config found');

await conn.end();
