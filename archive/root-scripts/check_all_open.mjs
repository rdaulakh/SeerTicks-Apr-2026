import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Check all open positions
const [openPositions] = await connection.query(`
  SELECT userId, COUNT(*) as count, MAX(updatedAt) as lastUpdate
  FROM paperPositions 
  WHERE status = 'open'
  GROUP BY userId
`);

console.log("=== OPEN POSITIONS BY USER ===\n");
openPositions.forEach(p => {
  console.log(`User ${p.userId}: ${p.count} positions (last update: ${p.lastUpdate})`);
});

// Check total
const [total] = await connection.query(`SELECT COUNT(*) as count FROM paperPositions WHERE status = 'open'`);
console.log(`\nTotal open positions: ${total[0].count}`);

// Check users table
const [users] = await connection.query(`SELECT id, name FROM users`);
console.log(`\n=== USERS IN SYSTEM ===`);
users.forEach(u => console.log(`  ID: ${u.id}, Name: ${u.name}`));

await connection.end();
