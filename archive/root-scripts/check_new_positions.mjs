import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check the most recent positions
const [positions] = await conn.execute(`
  SELECT 
    id,
    symbol,
    originalConsensus,
    currentConfidence,
    peakConfidence,
    createdAt
  FROM paperPositions 
  WHERE userId = 272657
  ORDER BY id DESC
  LIMIT 10
`);

console.log('=== RECENT POSITIONS - CONSENSUS DATA ===\n');
for (const pos of positions) {
  console.log(`ID ${pos.id} (${pos.symbol}):`);
  console.log(`  Created: ${pos.createdAt}`);
  console.log(`  Original Consensus: ${pos.originalConsensus || 'NULL'}`);
  console.log(`  Current Confidence: ${pos.currentConfidence || 'NULL'}`);
  console.log(`  Peak Confidence: ${pos.peakConfidence || 'NULL'}`);
  console.log('');
}

await conn.end();
