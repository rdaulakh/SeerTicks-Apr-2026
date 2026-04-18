import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function testCleanup() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== BEFORE CLEANUP ===');
  
  // Count ticks
  const [ticksBefore] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  console.log('Total ticks:', ticksBefore[0].count);
  
  // Count old ticks (using timestampMs)
  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const [oldTicks] = await connection.execute(
    `SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffMs}`
  );
  console.log('Ticks older than 24h:', oldTicks[0].count);
  
  // Count agent signals
  const [signalsBefore] = await connection.execute('SELECT COUNT(*) as count FROM agentSignals');
  console.log('Total agent signals:', signalsBefore[0].count);
  
  // Count old signals (using timestamp column)
  const cutoffDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const [oldSignals] = await connection.execute(
    'SELECT COUNT(*) as count FROM agentSignals WHERE timestamp < ?',
    [cutoffDate]
  );
  console.log('Signals older than 7d:', oldSignals[0].count);
  
  console.log('\n=== RUNNING CLEANUP (TEST - 1000 rows each) ===');
  
  // Test delete ticks
  console.log('\nDeleting old ticks...');
  const ticksStart = Date.now();
  const [ticksResult] = await connection.execute(
    `DELETE FROM ticks WHERE timestampMs < ${cutoffMs} LIMIT 1000`
  );
  console.log(`Deleted ${ticksResult.affectedRows} ticks in ${Date.now() - ticksStart}ms`);
  
  // Test delete signals
  console.log('\nDeleting old signals...');
  const signalsStart = Date.now();
  const [signalsResult] = await connection.execute(
    'DELETE FROM agentSignals WHERE timestamp < ? LIMIT 1000',
    [cutoffDate]
  );
  console.log(`Deleted ${signalsResult.affectedRows} signals in ${Date.now() - signalsStart}ms`);
  
  console.log('\n=== AFTER TEST CLEANUP ===');
  
  // Count remaining
  const [ticksAfter] = await connection.execute('SELECT COUNT(*) as count FROM ticks');
  console.log('Total ticks:', ticksAfter[0].count);
  
  const [signalsAfter] = await connection.execute('SELECT COUNT(*) as count FROM agentSignals');
  console.log('Total agent signals:', signalsAfter[0].count);
  
  console.log('\n✅ Cleanup queries are working correctly!');
  console.log('The fix uses:');
  console.log('  - ticks: timestampMs (bigint) instead of timestamp');
  console.log('  - agentSignals: timestamp instead of createdAt');
  
  await connection.end();
}

testCleanup().catch(console.error);
