import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Update all open positions with missing originalConsensus
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

// Verify
const [positions] = await conn.execute(`
  SELECT id, symbol, originalConsensus, currentConfidence, peakConfidence
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
`);

console.log('\n=== UPDATED POSITIONS ===');
for (const pos of positions) {
  console.log(`${pos.id} (${pos.symbol}): Original=${pos.originalConsensus}, Current=${pos.currentConfidence}, Peak=${pos.peakConfidence}`);
}

await conn.end();
