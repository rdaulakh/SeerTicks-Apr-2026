import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Check open positions by user
console.log('\n=== OPEN POSITIONS BY USER ===');
const [openByUser] = await connection.execute(`
  SELECT userId, COUNT(*) as cnt, MAX(updatedAt) as lastUpdate
  FROM paperPositions
  WHERE status = 'open'
  GROUP BY userId
`);
for (const u of openByUser) {
  console.log(`User ${u.userId}: ${u.cnt} open positions, last update: ${u.lastUpdate}`);
}

// Check consensus history
console.log('\n=== CONSENSUS HISTORY (ALL TIME) ===');
const [consensusAll] = await connection.execute(`
  SELECT COUNT(*) as total, MIN(timestamp) as first, MAX(timestamp) as last
  FROM consensusHistory
`);
console.log(`Total records: ${consensusAll[0].total}`);
console.log(`First: ${consensusAll[0].first}`);
console.log(`Last: ${consensusAll[0].last}`);

// Check recent consensus
console.log('\n=== RECENT CONSENSUS (Last 1 Hour) ===');
const [recentConsensus] = await connection.execute(`
  SELECT symbol, finalSignal, consensusPercentage, timestamp
  FROM consensusHistory
  ORDER BY timestamp DESC
  LIMIT 10
`);
for (const c of recentConsensus) {
  console.log(`${c.timestamp} | ${c.symbol} | ${c.finalSignal} | ${c.consensusPercentage}%`);
}

// Check engine state
console.log('\n=== ENGINE STATE ===');
try {
  const [engines] = await connection.execute(`SELECT * FROM seerEngineState`);
  for (const e of engines) {
    console.log(`User ${e.userId}: running=${e.isRunning}, paper=${e.isPaperMode}, started=${e.startedAt}`);
  }
} catch (e) {
  console.log('seerEngineState table not found');
}

// Check user 1 vs user 272657 positions
console.log('\n=== POSITION DETAILS BY USER ===');
const [user1Positions] = await connection.execute(`
  SELECT id, symbol, status, createdAt, updatedAt
  FROM paperPositions
  WHERE userId = 1 AND status = 'open'
  ORDER BY createdAt DESC
  LIMIT 5
`);
console.log(`\nUser 1 open positions: ${user1Positions.length}`);
for (const p of user1Positions) {
  console.log(`  #${p.id} ${p.symbol} created: ${p.createdAt} updated: ${p.updatedAt}`);
}

const [user272657Positions] = await connection.execute(`
  SELECT id, symbol, status, createdAt, updatedAt
  FROM paperPositions
  WHERE userId = 272657 AND status = 'open'
  ORDER BY createdAt DESC
  LIMIT 5
`);
console.log(`\nUser 272657 open positions: ${user272657Positions.length}`);
for (const p of user272657Positions) {
  console.log(`  #${p.id} ${p.symbol} created: ${p.createdAt} updated: ${p.updatedAt}`);
}

await connection.end();
