import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Check recent risk breaches
const [breaches] = await connection.query(`
  SELECT * FROM riskLimitBreaches 
  ORDER BY createdAt DESC 
  LIMIT 20
`);

console.log("=== RECENT RISK LIMIT BREACHES ===\n");
console.log(`Total breaches found: ${breaches.length}`);

breaches.forEach(b => {
  console.log(`\n[${b.createdAt}] ${b.limitType}`);
  console.log(`  User: ${b.userId}, Symbol: ${b.symbol}`);
  console.log(`  Limit: ${b.limitValue}, Actual: ${b.actualValue}`);
  console.log(`  Action: ${b.action || 'NONE'}`);
  console.log(`  Resolved: ${b.resolved ? 'YES' : 'NO'}`);
});

// Check unresolved breaches
const [unresolved] = await connection.query(`
  SELECT COUNT(*) as count FROM riskLimitBreaches WHERE resolved = 0
`);
console.log(`\n\nUnresolved breaches: ${unresolved[0].count}`);

await connection.end();
