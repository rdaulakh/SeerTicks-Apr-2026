import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check ticks schema
const [ticksSchema] = await conn.execute(`DESCRIBE ticks`);
console.log('=== TICKS SCHEMA ===');
console.table(ticksSchema);

// Check ticks growth using createdAt
const [ticksGrowth] = await conn.execute(`
  SELECT 
    DATE(createdAt) as date,
    COUNT(*) as tick_count
  FROM ticks
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 3 DAY)
  GROUP BY DATE(createdAt)
  ORDER BY date DESC
`);
console.log('\n=== TICKS GROWTH (last 3 days) ===');
console.table(ticksGrowth);

// Check agentSignals growth
const [signalsGrowth] = await conn.execute(`
  SELECT 
    DATE(createdAt) as date,
    COUNT(*) as signal_count
  FROM agentSignals
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 3 DAY)
  GROUP BY DATE(createdAt)
  ORDER BY date DESC
`);
console.log('\n=== AGENT SIGNALS GROWTH (last 3 days) ===');
console.table(signalsGrowth);

// Check if cleanup is working
const [oldTicks] = await conn.execute(`
  SELECT COUNT(*) as old_ticks FROM ticks WHERE createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);
console.log('\n=== OLD TICKS (>24h) ===');
console.table(oldTicks);

const [oldSignals] = await conn.execute(`
  SELECT COUNT(*) as old_signals FROM agentSignals WHERE createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log('\n=== OLD SIGNALS (>7d) ===');
console.table(oldSignals);

await conn.end();
