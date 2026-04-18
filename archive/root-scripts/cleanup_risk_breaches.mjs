import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Mark all old test breaches as resolved
const [result] = await connection.query(`
  UPDATE riskLimitBreaches 
  SET resolved = 1, resolvedAt = NOW() 
  WHERE resolved = 0 AND userId = 1
`);

console.log(`Resolved ${result.affectedRows} test risk breach records`);

// Check remaining unresolved
const [remaining] = await connection.query(`
  SELECT COUNT(*) as count FROM riskLimitBreaches WHERE resolved = 0
`);
console.log(`Remaining unresolved breaches: ${remaining[0].count}`);

await connection.end();
