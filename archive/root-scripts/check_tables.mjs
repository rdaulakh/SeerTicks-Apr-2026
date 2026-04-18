import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

// List all tables
const [tables] = await connection.execute(`SHOW TABLES`);
console.log('=== ALL TABLES ===');
for (const t of tables) {
  const tableName = Object.values(t)[0];
  console.log(`  ${tableName}`);
}

// Check engineState
console.log('\n=== ENGINE STATE TABLE ===');
try {
  const [engines] = await connection.execute(`SELECT * FROM engineState`);
  console.log(`Found ${engines.length} records`);
  for (const e of engines) {
    console.log(`  User ${e.userId}: running=${e.isRunning}, started=${e.startedAt}`);
    if (e.config) {
      const config = typeof e.config === 'string' ? JSON.parse(e.config) : e.config;
      console.log(`    Config: autoTrading=${config.enableAutoTrading}, capital=${config.totalCapital}`);
    }
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check tradingModeConfig
console.log('\n=== TRADING MODE CONFIG ===');
try {
  const [modes] = await connection.execute(`SELECT * FROM tradingModeConfig`);
  console.log(`Found ${modes.length} records`);
  for (const m of modes) {
    console.log(`  User ${m.userId}: mode=${m.mode}, autoTrade=${m.autoTradeEnabled}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
