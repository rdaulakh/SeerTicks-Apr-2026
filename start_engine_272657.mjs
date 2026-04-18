import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== STARTING ENGINE FOR USER 272657 ===\n");

// 1. Check current state
console.log("1. Current engine state:");
const [before] = await conn.query(`SELECT * FROM seerEngineState WHERE userId = 272657`);
console.log(JSON.stringify(before[0], null, 2));

// 2. Update engine state to running
console.log("\n2. Setting isRunning = 1...");
await conn.query(`
  UPDATE seerEngineState 
  SET isRunning = 1, 
      startedAt = NOW(),
      updatedAt = NOW()
  WHERE userId = 272657
`);

// 3. Verify update
console.log("\n3. Verifying update:");
const [after] = await conn.query(`SELECT * FROM seerEngineState WHERE userId = 272657`);
console.log(JSON.stringify(after[0], null, 2));

// 4. Also ensure tradingModeConfig is correct
console.log("\n4. Checking tradingModeConfig:");
const [tradingConfig] = await conn.query(`SELECT * FROM tradingModeConfig WHERE userId = 272657`);
console.log(JSON.stringify(tradingConfig[0], null, 2));

// 5. Update autoTradeEnabled if needed
if (tradingConfig[0] && !tradingConfig[0].autoTradeEnabled) {
  console.log("\n5. Enabling autoTradeEnabled...");
  await conn.query(`UPDATE tradingModeConfig SET autoTradeEnabled = 1 WHERE userId = 272657`);
  const [updated] = await conn.query(`SELECT * FROM tradingModeConfig WHERE userId = 272657`);
  console.log(JSON.stringify(updated[0], null, 2));
}

await conn.end();
console.log("\n=== ENGINE START COMPLETE ===");
