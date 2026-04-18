import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Close all orphaned positions for user 1260007
const [result] = await connection.query(`
  UPDATE paperPositions 
  SET 
    status = 'closed',
    exitReason = 'orphaned_cleanup',
    exitTime = NOW(),
    updatedAt = NOW()
  WHERE userId = 1260007 AND status = 'open'
`);

console.log(`✅ Closed ${result.affectedRows} orphaned positions for user 1260007`);

// Verify
const [remaining] = await connection.query(`
  SELECT COUNT(*) as count FROM paperPositions WHERE status = 'open'
`);
console.log(`\nRemaining open positions: ${remaining[0].count}`);

// Show summary by user
const [summary] = await connection.query(`
  SELECT userId, status, COUNT(*) as count 
  FROM paperPositions 
  GROUP BY userId, status
  ORDER BY userId, status
`);
console.log("\n=== POSITION SUMMARY BY USER ===");
summary.forEach(s => {
  console.log(`User ${s.userId}: ${s.count} ${s.status}`);
});

await connection.end();
