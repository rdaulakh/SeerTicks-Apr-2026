import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function investigate() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== TICKS TABLE SCHEMA ===');
  const [ticksSchema] = await connection.execute('DESCRIBE ticks');
  console.table(ticksSchema);
  
  console.log('\n=== SAMPLE TICKS DATA ===');
  const [sampleTicks] = await connection.execute('SELECT * FROM ticks ORDER BY id DESC LIMIT 5');
  console.table(sampleTicks);
  
  console.log('\n=== TICKS TIMESTAMP ANALYSIS ===');
  const [ticksAnalysis] = await connection.execute(`
    SELECT 
      MIN(timestamp) as oldest_tick,
      MAX(timestamp) as newest_tick,
      COUNT(*) as total_count,
      NOW() as current_time,
      DATE_SUB(NOW(), INTERVAL 24 HOUR) as cutoff_24h
  `);
  console.table(ticksAnalysis);
  
  console.log('\n=== TICKS BY AGE BUCKET ===');
  const [ticksBuckets] = await connection.execute(`
    SELECT 
      CASE 
        WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 'last_1h'
        WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 6 HOUR) THEN 'last_6h'
        WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 'last_24h'
        WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'last_7d'
        ELSE 'older_than_7d'
      END as age_bucket,
      COUNT(*) as count
    FROM ticks
    GROUP BY age_bucket
    ORDER BY FIELD(age_bucket, 'last_1h', 'last_6h', 'last_24h', 'last_7d', 'older_than_7d')
  `);
  console.table(ticksBuckets);
  
  console.log('\n=== AGENT SIGNALS SCHEMA ===');
  const [signalsSchema] = await connection.execute('DESCRIBE agentSignals');
  console.table(signalsSchema);
  
  console.log('\n=== SAMPLE AGENT SIGNALS ===');
  const [sampleSignals] = await connection.execute('SELECT id, agentName, symbol, createdAt FROM agentSignals ORDER BY id DESC LIMIT 5');
  console.table(sampleSignals);
  
  console.log('\n=== AGENT SIGNALS BY AGE BUCKET ===');
  const [signalsBuckets] = await connection.execute(`
    SELECT 
      CASE 
        WHEN createdAt >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'last_1d'
        WHEN createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'last_7d'
        WHEN createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY) THEN 'last_14d'
        ELSE 'older_than_14d'
      END as age_bucket,
      COUNT(*) as count
    FROM agentSignals
    GROUP BY age_bucket
    ORDER BY FIELD(age_bucket, 'last_1d', 'last_7d', 'last_14d', 'older_than_14d')
  `);
  console.table(signalsBuckets);
  
  console.log('\n=== TEST DELETE QUERY (DRY RUN) ===');
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  console.log('Cutoff time (24h ago):', cutoff24h.toISOString());
  
  const [countToDelete] = await connection.execute(`
    SELECT COUNT(*) as rows_to_delete FROM ticks WHERE timestamp < ?
  `, [cutoff24h]);
  console.table(countToDelete);
  
  await connection.end();
}

investigate().catch(console.error);
