import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Check orphaned positions
const [orphaned] = await connection.query(`
  SELECT pp.id, pp.userId, pp.symbol, pp.side, pp.entryPrice, pp.quantity, 
         pp.status, pp.createdAt, pp.updatedAt, pp.unrealizedPnL
  FROM paperPositions pp
  LEFT JOIN users u ON pp.userId = u.id
  WHERE pp.status = 'open' AND u.id IS NULL
  ORDER BY pp.createdAt DESC
`);

console.log("=== ORPHANED POSITIONS (No matching user) ===\n");
console.log(`Total: ${orphaned.length}`);
orphaned.forEach(p => {
  console.log(`\nID: ${p.id}, User: ${p.userId}, Symbol: ${p.symbol}`);
  console.log(`  Side: ${p.side}, Entry: ${p.entryPrice}, Qty: ${p.quantity}`);
  console.log(`  Status: ${p.status}, PnL: ${p.unrealizedPnL}`);
  console.log(`  Created: ${p.createdAt}`);
});

// Check positions for user 1260007 specifically
const [user1260007] = await connection.query(`
  SELECT * FROM paperPositions WHERE userId = 1260007 AND status = 'open'
`);
console.log(`\n\n=== USER 1260007 OPEN POSITIONS ===`);
console.log(`Total: ${user1260007.length}`);

// Check if user 1260007 exists
const [userExists] = await connection.query(`SELECT * FROM users WHERE id = 1260007`);
console.log(`\nUser 1260007 exists: ${userExists.length > 0 ? 'YES' : 'NO'}`);

await connection.end();
