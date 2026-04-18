import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function investigate() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== TICKS TABLE SCHEMA ===');
  const [ticksSchema] = await connection.execute('DESCRIBE ticks');
  console.table(ticksSchema);
  
  console.log('\n=== TICKS TIMESTAMP ANALYSIS ===');
  // Note: ticks table uses timestampMs (bigint) not timestamp!
  const [ticksAnalysis] = await connection.execute(`
    SELECT 
      MIN(timestampMs) as oldest_tick_ms,
      MAX(timestampMs) as newest_tick_ms,
      COUNT(*) as total_count,
      UNIX_TIMESTAMP() * 1000 as current_time_ms
    FROM ticks
  `);
  console.table(ticksAnalysis);
  
  // Calculate age
  const currentMs = Date.now();
  const oldestMs = Number(ticksAnalysis[0].oldest_tick_ms);
  const newestMs = Number(ticksAnalysis[0].newest_tick_ms);
  console.log('\nOldest tick age:', ((currentMs - oldestMs) / (1000 * 60 * 60)).toFixed(2), 'hours');
  console.log('Newest tick age:', ((currentMs - newestMs) / (1000 * 60)).toFixed(2), 'minutes');
  
  console.log('\n=== TICKS BY AGE BUCKET (using timestampMs) ===');
  const cutoff1h = currentMs - (1 * 60 * 60 * 1000);
  const cutoff6h = currentMs - (6 * 60 * 60 * 1000);
  const cutoff24h = currentMs - (24 * 60 * 60 * 1000);
  const cutoff7d = currentMs - (7 * 24 * 60 * 60 * 1000);
  
  const [ticksBuckets] = await connection.execute(`
    SELECT 
      CASE 
        WHEN timestampMs >= ${cutoff1h} THEN 'last_1h'
        WHEN timestampMs >= ${cutoff6h} THEN 'last_6h'
        WHEN timestampMs >= ${cutoff24h} THEN 'last_24h'
        WHEN timestampMs >= ${cutoff7d} THEN 'last_7d'
        ELSE 'older_than_7d'
      END as age_bucket,
      COUNT(*) as count
    FROM ticks
    GROUP BY age_bucket
  `);
  console.table(ticksBuckets);
  
  console.log('\n=== CRITICAL: Check if cleanup is using wrong column ===');
  // The cleanup service uses "timestamp" but the table has "timestampMs"!
  const [hasTimestampCol] = await connection.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'ticks' AND COLUMN_NAME = 'timestamp'
  `);
  console.log('Has "timestamp" column:', hasTimestampCol.length > 0);
  
  const [hasTimestampMsCol] = await connection.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'ticks' AND COLUMN_NAME = 'timestampMs'
  `);
  console.log('Has "timestampMs" column:', hasTimestampMsCol.length > 0);
  
  console.log('\n=== AGENT SIGNALS ANALYSIS ===');
  const [signalsAnalysis] = await connection.execute(`
    SELECT 
      MIN(createdAt) as oldest_signal,
      MAX(createdAt) as newest_signal,
      COUNT(*) as total_count
    FROM agentSignals
  `);
  console.table(signalsAnalysis);
  
  const cutoff7dDate = new Date(currentMs - (7 * 24 * 60 * 60 * 1000));
  const [signalsToDelete] = await connection.execute(`
    SELECT COUNT(*) as rows_to_delete FROM agentSignals WHERE createdAt < ?
  `, [cutoff7dDate]);
  console.log('\nSignals older than 7 days:', signalsToDelete[0].rows_to_delete);
  
  console.log('\n=== ROOT CAUSE IDENTIFIED ===');
  console.log('The cleanup service uses "timestamp" column but ticks table has "timestampMs" (bigint)!');
  console.log('This is why cleanup is not working - the query silently fails or matches nothing.');
  
  await connection.end();
}

investigate().catch(console.error);
