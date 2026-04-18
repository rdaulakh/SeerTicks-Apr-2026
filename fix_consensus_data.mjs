import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Update all open positions with missing consensus data
// Use 0.95 (95%) as the entry consensus since that's what the logs show
const [result] = await conn.execute(`
  UPDATE paperPositions 
  SET 
    originalConsensus = '0.95',
    currentConfidence = COALESCE(currentConfidence, '0.95'),
    peakConfidence = COALESCE(peakConfidence, '0.95'),
    peakConfidenceTime = COALESCE(peakConfidenceTime, createdAt)
  WHERE status = 'open' 
    AND userId = 272657
    AND originalConsensus IS NULL
`);

console.log(`Updated ${result.affectedRows} positions with consensus data`);

// Verify the update
const [positions] = await conn.execute(`
  SELECT id, symbol, originalConsensus, currentConfidence, peakConfidence
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
  ORDER BY id DESC
  LIMIT 5
`);

console.log('\n=== UPDATED POSITIONS ===\n');
for (const pos of positions) {
  console.log(`ID ${pos.id} (${pos.symbol}):`);
  console.log(`  Original: ${pos.originalConsensus}`);
  console.log(`  Current: ${pos.currentConfidence}`);
  console.log(`  Peak: ${pos.peakConfidence}`);
  console.log('');
}

await conn.end();
