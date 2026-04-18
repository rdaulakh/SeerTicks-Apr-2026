import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== CONSENSUS RECORDING INVESTIGATION ===\n");

// 1. Check consensusHistory table schema
console.log("1. consensusHistory schema:");
const [cols] = await conn.query(`DESCRIBE consensusHistory`);
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

// 2. Check most recent consensus records
console.log("\n2. Most recent consensus records:");
const [recent] = await conn.query(`
  SELECT * FROM consensusHistory 
  ORDER BY id DESC 
  LIMIT 5
`);
console.log(JSON.stringify(recent, null, 2));

// 3. Check if there are any records from 2026
console.log("\n3. Records from 2026:");
const [records2026] = await conn.query(`
  SELECT COUNT(*) as count, MIN(timestamp) as earliest, MAX(timestamp) as latest
  FROM consensusHistory 
  WHERE timestamp >= '2026-01-01'
`);
console.log(JSON.stringify(records2026[0], null, 2));

// 4. Check total records and date range
console.log("\n4. Total records and date range:");
const [stats] = await conn.query(`
  SELECT COUNT(*) as total, MIN(timestamp) as earliest, MAX(timestamp) as latest
  FROM consensusHistory
`);
console.log(JSON.stringify(stats[0], null, 2));

// 5. Check if there's a different table being used
console.log("\n5. Tables containing 'consensus':");
const [tables] = await conn.query(`SHOW TABLES LIKE '%consensus%'`);
tables.forEach(t => console.log(`  ${Object.values(t)[0]}`));

await conn.end();
