import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ENABLING AUTO TRADING FOR USER 272657 ===\n");

// 1. Update engineState config to enable auto trading
console.log("1. Updating engineState.config.enableAutoTrading...");
const [current] = await conn.query(`SELECT config FROM engineState WHERE userId = 272657`);
const config = current[0].config;
config.enableAutoTrading = 1;

await conn.query(`
  UPDATE engineState 
  SET config = ?,
      updatedAt = NOW()
  WHERE userId = 272657
`, [JSON.stringify(config)]);

// 2. Verify engineState update
const [after] = await conn.query(`SELECT * FROM engineState WHERE userId = 272657`);
console.log("Updated engineState:", JSON.stringify(after[0], null, 2));

// 3. Check tradingModeConfig
console.log("\n2. Checking tradingModeConfig...");
const [tradingConfig] = await conn.query(`SELECT * FROM tradingModeConfig WHERE userId = 272657`);
console.log("tradingModeConfig:", JSON.stringify(tradingConfig[0], null, 2));

// 4. Enable autoTradeEnabled in tradingModeConfig if needed
if (tradingConfig[0] && !tradingConfig[0].autoTradeEnabled) {
  console.log("\n3. Enabling autoTradeEnabled in tradingModeConfig...");
  await conn.query(`UPDATE tradingModeConfig SET autoTradeEnabled = 1 WHERE userId = 272657`);
  const [updated] = await conn.query(`SELECT * FROM tradingModeConfig WHERE userId = 272657`);
  console.log("Updated tradingModeConfig:", JSON.stringify(updated[0], null, 2));
} else {
  console.log("\n3. autoTradeEnabled already enabled in tradingModeConfig");
}

await conn.end();
console.log("\n=== AUTO TRADING ENABLED ===");
