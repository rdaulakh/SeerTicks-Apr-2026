import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runFullCleanup() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== FULL CLEANUP RUN ===');
  console.log('Started at:', new Date().toISOString());
  
  // Count before
  const [ticksBefore] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  console.log('\nTotal ticks before:', Number(ticksBefore[0].count).toLocaleString());
  
  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const [oldTicks] = await connection.execute(
    `SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`
  );
  console.log('Ticks to delete (older than 24h):', Number(oldTicks[0].count).toLocaleString());
  
  // Delete in batches
  const batchSize = 50000;
  let totalDeleted = 0;
  let batchNum = 0;
  
  console.log('\nDeleting in batches of', batchSize, '...');
  
  while (true) {
    batchNum++;
    const batchStart = Date.now();
    
    const [result] = await connection.execute(
      `DELETE FROM ticks WHERE timestampMs < ${cutoffMs} LIMIT ${batchSize}`
    );
    
    const deleted = result.affectedRows;
    totalDeleted += deleted;
    
    const batchTime = Date.now() - batchStart;
    console.log(`Batch ${batchNum}: deleted ${deleted.toLocaleString()} rows in ${batchTime}ms (total: ${totalDeleted.toLocaleString()})`);
    
    if (deleted < batchSize) {
      break;
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Count after
  const [ticksAfter] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  console.log('\n=== CLEANUP COMPLETE ===');
  console.log('Total ticks deleted:', totalDeleted.toLocaleString());
  console.log('Ticks remaining:', Number(ticksAfter[0].count).toLocaleString());
  console.log('Completed at:', new Date().toISOString());
  
  await connection.end();
}

runFullCleanup().catch(console.error);
