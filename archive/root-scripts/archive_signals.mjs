import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ARCHIVING OLD AGENT SIGNALS ===\n");

// Step 1: Create archive table if not exists
console.log("1. Creating archive table...");
await connection.query(`
  CREATE TABLE IF NOT EXISTS agentSignals_archive LIKE agentSignals
`);
console.log("   ✅ Archive table created/verified");

// Step 2: Count records to archive
const [toArchive] = await connection.query(`
  SELECT COUNT(*) as count FROM agentSignals WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log(`\n2. Records to archive: ${toArchive[0].count.toLocaleString()}`);

// Step 3: Archive in batches to avoid timeout
console.log("\n3. Archiving in batches of 100,000...");
let totalArchived = 0;
let batchNum = 0;
const BATCH_SIZE = 100000;
const MAX_BATCHES = 70; // Safety limit

while (batchNum < MAX_BATCHES) {
  batchNum++;
  
  // Insert into archive
  const [insertResult] = await connection.query(`
    INSERT INTO agentSignals_archive 
    SELECT * FROM agentSignals 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
    LIMIT ${BATCH_SIZE}
  `);
  
  if (insertResult.affectedRows === 0) {
    console.log(`   Batch ${batchNum}: No more records to archive`);
    break;
  }
  
  // Delete from main table
  const [deleteResult] = await connection.query(`
    DELETE FROM agentSignals 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
    LIMIT ${BATCH_SIZE}
  `);
  
  totalArchived += deleteResult.affectedRows;
  console.log(`   Batch ${batchNum}: Archived ${deleteResult.affectedRows.toLocaleString()} records (Total: ${totalArchived.toLocaleString()})`);
  
  // Brief pause to prevent overwhelming the database
  await new Promise(r => setTimeout(r, 100));
}

console.log(`\n✅ Total archived: ${totalArchived.toLocaleString()} records`);

// Step 4: Verify
const [remaining] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals`);
const [archived] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals_archive`);
console.log(`\n4. Final counts:`);
console.log(`   Main table: ${remaining[0].count.toLocaleString()} records`);
console.log(`   Archive table: ${archived[0].count.toLocaleString()} records`);

// Step 5: Optimize main table
console.log("\n5. Optimizing main table...");
await connection.query(`OPTIMIZE TABLE agentSignals`);
console.log("   ✅ Table optimized");

await connection.end();
console.log("\n=== ARCHIVAL COMPLETE ===");
