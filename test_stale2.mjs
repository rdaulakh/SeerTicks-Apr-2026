import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get column names
const [cols] = await conn.execute(`DESCRIBE paperPositions`);
console.log('=== PAPER POSITIONS COLUMNS ===');
for (const col of cols) {
  console.log(`  ${col.Field}: ${col.Type}`);
}

// Get open positions with correct columns
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, quantity, createdAt
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
  ORDER BY createdAt DESC
`);

console.log('\n=== STALE CONSENSUS TEST ===\n');

const now = Date.now();
for (const pos of positions) {
  const entryTime = new Date(pos.createdAt).getTime();
  const ageMinutes = (now - entryTime) / (1000 * 60);
  
  // Calculate P&L
  const pnlPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
  
  // Check stale consensus conditions
  const isOldEnough = ageMinutes >= 10;
  const isInLoss = pnlPercent <= -1;
  
  console.log(`Position ${pos.id} (${pos.symbol} ${pos.side}):`);
  console.log(`  Entry: $${pos.entryPrice} | Current: $${pos.currentPrice}`);
  console.log(`  P&L: ${pnlPercent.toFixed(2)}%`);
  console.log(`  Age: ${ageMinutes.toFixed(1)} minutes`);
  console.log(`  Stale Consensus Check:`);
  console.log(`    - Age >= 10 min: ${isOldEnough ? '✅ YES' : '❌ NO'}`);
  console.log(`    - P&L <= -1%: ${isInLoss ? '✅ YES' : '❌ NO'}`);
  console.log(`    - Would trigger: ${isOldEnough && isInLoss ? '🚨 YES - EXIT!' : '❌ NO - HOLD'}`);
  console.log('');
}

await conn.end();
