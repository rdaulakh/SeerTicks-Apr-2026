import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Update NULL exit reasons to 'legacy_unknown'
const [result] = await connection.query(`
  UPDATE paperPositions 
  SET exitReason = 'legacy_unknown' 
  WHERE status = 'closed' AND (exitReason IS NULL OR exitReason = '')
`);

console.log(`Updated ${result.affectedRows} positions with NULL exit reason to 'legacy_unknown'`);

// Verify the fix
const [verify] = await connection.query(`
  SELECT exitReason, COUNT(*) as count 
  FROM paperPositions 
  WHERE status = 'closed'
  GROUP BY exitReason
  ORDER BY count DESC
`);

console.log("\n=== UPDATED EXIT REASON DISTRIBUTION ===");
verify.forEach(r => {
  console.log(`${r.exitReason || 'NULL'}: ${r.count}`);
});

await connection.end();
