import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runSafeCleanup() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('========================================');
  console.log('SAFE DATABASE CLEANUP (smaller batches)');
  console.log('Started at:', new Date().toISOString());
  console.log('========================================');
  
  // Get initial counts
  const [ticksBefore] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const [oldTicks] = await connection.execute(`SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`);
  
  console.log('\n📊 BEFORE CLEANUP:');
  console.log(`   Total ticks: ${Number(ticksBefore[0].count).toLocaleString()}`);
  console.log(`   Old ticks (>24h): ${Number(oldTicks[0].count).toLocaleString()}`);
  
  // Delete in smaller batches with longer delays
  const batchSize = 25000;  // Smaller batch
  let totalDeleted = 0;
  let batchNum = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();
  
  console.log(`\n🗑️  DELETING IN BATCHES OF ${batchSize.toLocaleString()}...\n`);
  
  while (consecutiveErrors < 3) {
    batchNum++;
    const batchStart = Date.now();
    
    try {
      const [result] = await connection.execute(
        `DELETE FROM ticks WHERE timestampMs < ${cutoffMs} LIMIT ${batchSize}`
      );
      
      const deleted = result.affectedRows;
      totalDeleted += deleted;
      consecutiveErrors = 0;  // Reset error counter on success
      
      const batchTime = Date.now() - batchStart;
      const rate = (deleted / (batchTime / 1000)).toFixed(0);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      
      console.log(`Batch ${batchNum}: ${deleted.toLocaleString()} rows in ${batchTime}ms (${rate}/sec) | Total: ${totalDeleted.toLocaleString()} | Elapsed: ${elapsed}s`);
      
      if (deleted < batchSize) {
        break;  // No more rows to delete
      }
      
      // Longer delay between batches to reduce lock contention
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      consecutiveErrors++;
      console.log(`⚠️ Batch ${batchNum} error (attempt ${consecutiveErrors}/3): ${error.message}`);
      
      if (consecutiveErrors < 3) {
        console.log('   Waiting 5 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  // Get final counts
  const [ticksAfter] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  const [oldTicksAfter] = await connection.execute(`SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`);
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n========================================');
  console.log('✅ CLEANUP SESSION COMPLETE');
  console.log('========================================');
  console.log(`   Total deleted this session: ${totalDeleted.toLocaleString()} rows`);
  console.log(`   Total time: ${totalTime} seconds`);
  console.log(`\n📊 CURRENT STATE:`);
  console.log(`   Total ticks: ${Number(ticksAfter[0].count).toLocaleString()}`);
  console.log(`   Old ticks remaining: ${Number(oldTicksAfter[0].count).toLocaleString()}`);
  
  if (Number(oldTicksAfter[0].count) > 0) {
    console.log('\n⚠️ Some old ticks remain. Run this script again to continue cleanup.');
  }
  
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  
  await connection.end();
}

runSafeCleanup().catch(console.error);
