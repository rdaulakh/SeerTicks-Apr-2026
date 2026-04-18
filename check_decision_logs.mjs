import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== tradeDecisionLogs SCHEMA ===");
const [cols] = await conn.query(`DESCRIBE tradeDecisionLogs`);
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

console.log("\n=== Recent tradeDecisionLogs ===");
const [recent] = await conn.query(`
  SELECT * FROM tradeDecisionLogs 
  ORDER BY createdAt DESC 
  LIMIT 3
`);
console.log(JSON.stringify(recent, null, 2));

console.log("\n=== Decision counts by type ===");
const [counts] = await conn.query(`
  SELECT decision, COUNT(*) as count 
  FROM tradeDecisionLogs 
  GROUP BY decision
`);
console.log(JSON.stringify(counts, null, 2));

console.log("\n=== Last decision timestamp ===");
const [last] = await conn.query(`SELECT MAX(createdAt) as lastDecision FROM tradeDecisionLogs`);
console.log(`Last decision: ${last[0].lastDecision}`);

await conn.end();
