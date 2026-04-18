import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check current values
const [positions] = await conn.execute(`
  SELECT id, symbol, originalConsensus, currentConfidence, peakConfidence
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
`);

console.log('\n=== BEFORE FIX ===');
for (const pos of positions) {
  console.log(`${pos.id} (${pos.symbol}): original=${pos.originalConsensus}, current=${pos.currentConfidence}, peak=${pos.peakConfidence}`);
}

// Fix values that are stored as integers (65) instead of decimals (0.65)
// The correct format is decimal (0.65 = 65%)
for (const pos of positions) {
  const original = parseFloat(pos.originalConsensus || '0.65');
  const current = parseFloat(pos.currentConfidence || '0.65');
  const peak = parseFloat(pos.peakConfidence || '0.65');
  
  // If values are > 1, they're stored as percentages, convert to decimals
  const fixedOriginal = original > 1 ? original / 100 : original;
  const fixedCurrent = current > 1 ? current / 100 : current;
  const fixedPeak = peak > 1 ? peak / 100 : peak;
  
  await conn.execute(`
    UPDATE paperPositions 
    SET originalConsensus = ?, currentConfidence = ?, peakConfidence = ?
    WHERE id = ?
  `, [fixedOriginal.toString(), fixedCurrent.toString(), fixedPeak.toString(), pos.id]);
}

// Verify
const [fixed] = await conn.execute(`
  SELECT id, symbol, originalConsensus, currentConfidence, peakConfidence
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
`);

console.log('\n=== AFTER FIX ===');
for (const pos of fixed) {
  const original = parseFloat(pos.originalConsensus || '0.65') * 100;
  const current = parseFloat(pos.currentConfidence || '0.65') * 100;
  const peak = parseFloat(pos.peakConfidence || '0.65') * 100;
  console.log(`${pos.id} (${pos.symbol}): original=${original.toFixed(1)}%, current=${current.toFixed(1)}%, peak=${peak.toFixed(1)}%`);
}

await conn.end();
