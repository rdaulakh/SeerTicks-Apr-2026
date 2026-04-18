import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  
  console.log('=== TRADE DECISION LOGS AUDIT ===\n');
  console.log('Timestamp:', new Date().toISOString());
  
  // 1. Get table structure
  console.log('\n=== TABLE STRUCTURE ===');
  const [columns] = await connection.query(`DESCRIBE tradeDecisionLogs`);
  console.log('Columns:', JSON.stringify(columns, null, 2));
  
  // 2. Get all records from last 10 hours
  console.log('\n=== RECORDS FROM LAST 10 HOURS ===');
  const [recentRecords] = await connection.query(`
    SELECT * FROM tradeDecisionLogs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    ORDER BY createdAt DESC
    LIMIT 50
  `);
  console.log('Recent Records Count:', (recentRecords as any[]).length);
  if ((recentRecords as any[]).length > 0) {
    console.log('Sample Records:', JSON.stringify((recentRecords as any[]).slice(0, 10), null, 2));
  }
  
  // 3. Get decision summary
  console.log('\n=== DECISION SUMMARY (Last 10 Hours) ===');
  const [decisionSummary] = await connection.query(`
    SELECT 
      decision,
      COUNT(*) as count
    FROM tradeDecisionLogs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    GROUP BY decision
    ORDER BY count DESC
  `);
  console.log('Decision Summary:', JSON.stringify(decisionSummary, null, 2));
  
  // 4. Get all records (no time filter)
  console.log('\n=== ALL RECORDS (No Time Filter) ===');
  const [allRecords] = await connection.query(`
    SELECT id, symbol, signalType, totalConfidence, decision, decisionReason, createdAt
    FROM tradeDecisionLogs 
    ORDER BY createdAt DESC
    LIMIT 30
  `);
  console.log('All Records:', JSON.stringify(allRecords, null, 2));
  
  // 5. Get decision summary for all time
  console.log('\n=== DECISION SUMMARY (All Time) ===');
  const [allTimeSummary] = await connection.query(`
    SELECT 
      decision,
      COUNT(*) as count,
      AVG(totalConfidence) as avgConfidence
    FROM tradeDecisionLogs 
    GROUP BY decision
    ORDER BY count DESC
  `);
  console.log('All Time Summary:', JSON.stringify(allTimeSummary, null, 2));
  
  // 6. Find signals above threshold that weren't executed
  console.log('\n=== SIGNALS ABOVE THRESHOLD NOT EXECUTED ===');
  const [aboveThreshold] = await connection.query(`
    SELECT id, symbol, signalType, totalConfidence, threshold, decision, decisionReason, createdAt
    FROM tradeDecisionLogs 
    WHERE totalConfidence >= threshold
      AND decision != 'EXECUTED'
    ORDER BY createdAt DESC
    LIMIT 30
  `);
  console.log('Above Threshold Not Executed:', JSON.stringify(aboveThreshold, null, 2));
  
  // 7. Get skipped reasons
  console.log('\n=== SKIPPED REASONS ===');
  const [skippedReasons] = await connection.query(`
    SELECT 
      decisionReason,
      COUNT(*) as count
    FROM tradeDecisionLogs 
    WHERE decision = 'SKIPPED'
    GROUP BY decisionReason
    ORDER BY count DESC
    LIMIT 20
  `);
  console.log('Skipped Reasons:', JSON.stringify(skippedReasons, null, 2));
  
  await connection.end();
  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);
