import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  // Add originalConsensus column
  await conn.execute(`
    ALTER TABLE paperPositions 
    ADD COLUMN IF NOT EXISTS originalConsensus VARCHAR(50) DEFAULT NULL
  `);
  console.log('Added originalConsensus column');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('originalConsensus column already exists');
  } else {
    console.log('Error adding originalConsensus:', e.message);
  }
}

try {
  // Add currentConfidence column
  await conn.execute(`
    ALTER TABLE paperPositions 
    ADD COLUMN IF NOT EXISTS currentConfidence VARCHAR(50) DEFAULT NULL
  `);
  console.log('Added currentConfidence column');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('currentConfidence column already exists');
  } else {
    console.log('Error adding currentConfidence:', e.message);
  }
}

try {
  // Add peakConfidence column
  await conn.execute(`
    ALTER TABLE paperPositions 
    ADD COLUMN IF NOT EXISTS peakConfidence VARCHAR(50) DEFAULT NULL
  `);
  console.log('Added peakConfidence column');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('peakConfidence column already exists');
  } else {
    console.log('Error adding peakConfidence:', e.message);
  }
}

try {
  // Add peakConfidenceTime column
  await conn.execute(`
    ALTER TABLE paperPositions 
    ADD COLUMN IF NOT EXISTS peakConfidenceTime TIMESTAMP DEFAULT NULL
  `);
  console.log('Added peakConfidenceTime column');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('peakConfidenceTime column already exists');
  } else {
    console.log('Error adding peakConfidenceTime:', e.message);
  }
}

// Verify columns were added
const [columns] = await conn.execute(`DESCRIBE paperPositions`);
console.log('\n=== Updated paperPositions SCHEMA ===');
for (const col of columns) {
  if (col.Field.includes('onsensus') || col.Field.includes('onfidence')) {
    console.log(`✓ ${col.Field}: ${col.Type}`);
  }
}

await conn.end();
console.log('\nDone!');
