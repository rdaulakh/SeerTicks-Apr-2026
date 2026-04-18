import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ARCHIVING OLD AGENT SIGNALS (v2) ===\n");

// Step 1: Check current state
const [mainCount] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals`);
const [archiveCount] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals_archive`);
console.log(`Current state:`);
console.log(`  Main table: ${mainCount[0].count.toLocaleString()} records`);
console.log(`  Archive table: ${archiveCount[0].count.toLocaleString()} records`);

// Step 2: Count old records in main table
const [toDelete] = await connection.query(`
  SELECT COUNT(*) as count FROM agentSignals WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log(`\nRecords older than 7 days to remove: ${toDelete[0].count.toLocaleString()}`);

// Step 3: Since archive already has data, just delete old records from main table
console.log("\nDeleting old records from main table in batches...");
let totalDeleted = 0;
let batchNum = 0;
const BATCH_SIZE = 100000;
const MAX_BATCHES = 100;

while (batchNum < MAX_BATCHES) {
  batchNum++;
  
  const [deleteResult] = await connection.query(`
    DELETE FROM agentSignals 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
    LIMIT ${BATCH_SIZE}
  `);
  
  if (deleteResult.affectedRows === 0) {
    console.log(`   Batch ${batchNum}: No more records to delete`);
    break;
  }
  
  totalDeleted += deleteResult.affectedRows;
  console.log(`   Batch ${batchNum}: Deleted ${deleteResult.affectedRows.toLocaleString()} (Total: ${totalDeleted.toLocaleString()})`);
  
  await new Promise(r => setTimeout(r, 50));
}

console.log(`\n✅ Total deleted: ${totalDeleted.toLocaleString()} records`);

// Step 4: Verify final state
const [finalMain] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals`);
const [finalArchive] = await connection.query(`SELECT COUNT(*) as count FROM agentSignals_archive`);
console.log(`\nFinal state:`);
console.log(`  Main table: ${finalMain[0].count.toLocaleString()} records`);
console.log(`  Archive table: ${finalArchive[0].count.toLocaleString()} records`);

// Step 5: Optimize
console.log("\nOptimizing main table...");
await connection.query(`OPTIMIZE TABLE agentSignals`);
console.log("✅ Table optimized");

await connection.end();
console.log("\n=== ARCHIVAL COMPLETE ===");
