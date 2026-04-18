import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check trading mode config
const [modeConfig] = await conn.execute(`
  SELECT * FROM tradingModeConfig LIMIT 5
`);
console.log('=== TRADING MODE CONFIG ===');
console.table(modeConfig);

// Check engine state
const [engineState] = await conn.execute(`
  SELECT userId, isRunning, config, startedAt, updatedAt FROM engineState LIMIT 5
`);
console.log('\n=== ENGINE STATE ===');
console.table(engineState);

// Check if there are any live positions (should be 0 in paper mode)
const [livePositions] = await conn.execute(`
  SELECT COUNT(*) as count FROM positions WHERE status = 'open'
`);
console.log('\n=== LIVE POSITIONS (should be 0 in paper mode) ===');
console.log(`  Open live positions: ${livePositions[0].count}`);

// Check paper positions
const [paperPositions] = await conn.execute(`
  SELECT COUNT(*) as count FROM paperPositions WHERE thesisValid = 1
`);
console.log(`  Open paper positions: ${paperPositions[0].count}`);

await conn.end();
