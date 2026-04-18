import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check agentSignals schema
const [signalsSchema] = await conn.execute(`DESCRIBE agentSignals`);
console.log('=== AGENT SIGNALS SCHEMA ===');
signalsSchema.forEach(col => console.log(`  ${col.Field}: ${col.Type}`));

// Check old ticks
const [oldTicks] = await conn.execute(`
  SELECT COUNT(*) as count FROM ticks WHERE createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);
console.log('\n=== OLD TICKS (>24h) ===');
console.log(`  Count: ${oldTicks[0].count}`);

// Check old signals using timestamp column
const [oldSignals] = await conn.execute(`
  SELECT COUNT(*) as count FROM agentSignals WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log('\n=== OLD SIGNALS (>7d) ===');
console.log(`  Count: ${oldSignals[0].count}`);

// Check total counts
const [totalTicks] = await conn.execute(`SELECT COUNT(*) as count FROM ticks`);
const [totalSignals] = await conn.execute(`SELECT COUNT(*) as count FROM agentSignals`);
console.log('\n=== TOTAL COUNTS ===');
console.log(`  Ticks: ${totalTicks[0].count}`);
console.log(`  AgentSignals: ${totalSignals[0].count}`);

// Calculate daily growth rate
const [recentTicks] = await conn.execute(`
  SELECT COUNT(*) as count FROM ticks WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 DAY)
`);
console.log('\n=== DAILY GROWTH ===');
console.log(`  Ticks/day: ~${recentTicks[0].count}`);

await conn.end();
