import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get table sizes
const [rows] = await conn.execute(`
  SELECT 
    table_name,
    table_rows,
    ROUND(data_length / 1024 / 1024, 2) as data_mb,
    ROUND(index_length / 1024 / 1024, 2) as index_mb,
    ROUND((data_length + index_length) / 1024 / 1024, 2) as total_mb
  FROM information_schema.tables 
  WHERE table_schema = DATABASE()
  ORDER BY (data_length + index_length) DESC
  LIMIT 20
`);

console.log('=== TABLE SIZES ===');
console.table(rows);

// Check growth rate for ticks
const [ticksGrowth] = await conn.execute(`
  SELECT 
    DATE(timestamp) as date,
    COUNT(*) as tick_count
  FROM ticks
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 3 DAY)
  GROUP BY DATE(timestamp)
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

await conn.end();
