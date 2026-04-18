import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== AGENT SIGNALS TABLE ANALYSIS ===\n");

// Get table size
const [tableSize] = await connection.query(`
  SELECT 
    TABLE_NAME,
    ROUND(DATA_LENGTH / 1024 / 1024, 2) as data_mb,
    ROUND(INDEX_LENGTH / 1024 / 1024, 2) as index_mb,
    TABLE_ROWS
  FROM information_schema.TABLES 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agentSignals'
`);
console.log("Table Size:");
console.log(`  Data: ${tableSize[0].data_mb} MB`);
console.log(`  Index: ${tableSize[0].index_mb} MB`);
console.log(`  Rows: ${tableSize[0].TABLE_ROWS}`);

// Get data distribution by date
const [byDate] = await connection.query(`
  SELECT 
    DATE(timestamp) as date,
    COUNT(*) as count
  FROM agentSignals
  GROUP BY DATE(timestamp)
  ORDER BY date DESC
  LIMIT 14
`);
console.log("\n\nData Distribution (Last 14 days):");
byDate.forEach(d => {
  console.log(`  ${d.date}: ${d.count.toLocaleString()} signals`);
});

// Get oldest and newest records
const [oldest] = await connection.query(`SELECT MIN(timestamp) as oldest FROM agentSignals`);
const [newest] = await connection.query(`SELECT MAX(timestamp) as newest FROM agentSignals`);
console.log(`\nDate Range: ${oldest[0].oldest} to ${newest[0].newest}`);

// Count records older than 7 days
const [oldRecords] = await connection.query(`
  SELECT COUNT(*) as count 
  FROM agentSignals 
  WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log(`\nRecords older than 7 days: ${oldRecords[0].count.toLocaleString()}`);

// Count records in last 7 days
const [recentRecords] = await connection.query(`
  SELECT COUNT(*) as count 
  FROM agentSignals 
  WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log(`Records in last 7 days: ${recentRecords[0].count.toLocaleString()}`);

await connection.end();
