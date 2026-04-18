import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runFullCleanup() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('========================================');
  console.log('FULL DATABASE CLEANUP');
  console.log('Started at:', new Date().toISOString());
  console.log('========================================');
  
  // Get initial counts
  const [ticksBefore] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const [oldTicks] = await connection.execute(`SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`);
  
  console.log('\n📊 BEFORE CLEANUP:');
  console.log(`   Total ticks: ${Number(ticksBefore[0].count).toLocaleString()}`);
  console.log(`   Old ticks (>24h): ${Number(oldTicks[0].count).toLocaleString()}`);
  console.log(`   Cutoff: ${new Date(cutoffMs).toISOString()}`);
  
  // Delete in batches
  const batchSize = 100000;
  let totalDeleted = 0;
  let batchNum = 0;
  const startTime = Date.now();
  
  console.log(`\n🗑️  DELETING IN BATCHES OF ${batchSize.toLocaleString()}...\n`);
  
  while (true) {
    batchNum++;
    const batchStart = Date.now();
    
    const [result] = await connection.execute(
      `DELETE FROM ticks WHERE timestampMs < ${cutoffMs} LIMIT ${batchSize}`
    );
    
    const deleted = result.affectedRows;
    totalDeleted += deleted;
    
    const batchTime = Date.now() - batchStart;
    const rate = (deleted / (batchTime / 1000)).toFixed(0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    
    console.log(`Batch ${batchNum}: ${deleted.toLocaleString()} rows in ${batchTime}ms (${rate}/sec) | Total: ${totalDeleted.toLocaleString()} | Elapsed: ${elapsed}s`);
    
    if (deleted < batchSize) {
      break;
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Get final counts
  const [ticksAfter] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  const [oldTicksAfter] = await connection.execute(`SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`);
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n========================================');
  console.log('✅ CLEANUP COMPLETE');
  console.log('========================================');
  console.log(`   Total deleted: ${totalDeleted.toLocaleString()} rows`);
  console.log(`   Total time: ${totalTime} seconds`);
  console.log(`   Avg rate: ${(totalDeleted / parseFloat(totalTime)).toFixed(0)} rows/sec`);
  console.log(`\n📊 AFTER CLEANUP:`);
  console.log(`   Total ticks: ${Number(ticksAfter[0].count).toLocaleString()}`);
  console.log(`   Old ticks remaining: ${Number(oldTicksAfter[0].count).toLocaleString()}`);
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  
  await connection.end();
}

runFullCleanup().catch(console.error);
