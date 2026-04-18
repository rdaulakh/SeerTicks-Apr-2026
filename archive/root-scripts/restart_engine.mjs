import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("Restarting engine for user 272657...\n");

// Update engine state to running
await conn.query(`
  UPDATE engineState 
  SET isRunning = 1, 
      startedAt = NOW(), 
      stoppedAt = NULL,
      updatedAt = NOW()
  WHERE userId = 272657
`);

// Verify the update
const [result] = await conn.query(`
  SELECT isRunning, startedAt, stoppedAt 
  FROM engineState 
  WHERE userId = 272657 
  ORDER BY id DESC LIMIT 1
`);

console.log("Engine state after update:");
console.log(`  isRunning: ${result[0].isRunning === 1 ? '✅ YES' : '❌ NO'}`);
console.log(`  startedAt: ${result[0].startedAt}`);
console.log(`  stoppedAt: ${result[0].stoppedAt || 'null (good)'}`);

await conn.end();
console.log("\n✅ Engine restarted successfully!");
