import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== STARTING ENGINE FOR USER 272657 ===\n");

// Set isRunning = 1 and clear stoppedAt
await conn.query(`
  UPDATE engineState 
  SET isRunning = 1, 
      startedAt = NOW(),
      stoppedAt = NULL,
      updatedAt = NOW()
  WHERE userId = 272657 AND id = 300006
`);

// Verify
const [after] = await conn.query(`SELECT * FROM engineState WHERE userId = 272657 ORDER BY id DESC LIMIT 1`);
console.log("Engine state after update:", JSON.stringify(after[0], null, 2));

await conn.end();
console.log("\n=== ENGINE STARTED ===");
