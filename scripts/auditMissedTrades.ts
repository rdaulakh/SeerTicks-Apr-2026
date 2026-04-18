import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  
  console.log('=== MISSED TRADES AUDIT - Last 10 Hours ===\n');
  console.log('Timestamp:', new Date().toISOString());
  
  // 1. Get all trade decision logs with their decisions
  console.log('\n=== TRADE DECISION SUMMARY ===');
  const [decisionSummary] = await connection.query(`
    SELECT 
      decision,
      COUNT(*) as count,
      AVG(totalConfidence) as avgConfidence,
      MIN(totalConfidence) as minConfidence,
      MAX(totalConfidence) as maxConfidence
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    GROUP BY decision
    ORDER BY count DESC
  `);
  console.log('Decision Summary:', JSON.stringify(decisionSummary, null, 2));
  
  // 2. Get SKIPPED trades with high confidence (potential missed opportunities)
  console.log('\n=== SKIPPED TRADES WITH HIGH CONFIDENCE (>0.65) ===');
  const [skippedHighConf] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold, 
      decision, decisionReason, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND decision = 'SKIPPED'
      AND totalConfidence >= 0.65
    ORDER BY totalConfidence DESC
    LIMIT 20
  `);
  console.log('Skipped High Confidence Trades:', JSON.stringify(skippedHighConf, null, 2));
  
  // 3. Get VETOED trades (blocked by risk management)
  console.log('\n=== VETOED TRADES ===');
  const [vetoedTrades] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold,
      decision, decisionReason, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND decision = 'VETOED'
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Vetoed Trades:', JSON.stringify(vetoedTrades, null, 2));
  
  // 4. Get FAILED trades
  console.log('\n=== FAILED TRADES ===');
  const [failedTrades] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold,
      decision, decisionReason, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND decision = 'FAILED'
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Failed Trades:', JSON.stringify(failedTrades, null, 2));
  
  // 5. Get OPPORTUNITY_MISSED status trades
  console.log('\n=== OPPORTUNITY MISSED STATUS ===');
  const [missedOpportunities] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold,
      decision, decisionReason, status, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND status = 'OPPORTUNITY_MISSED'
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Missed Opportunities:', JSON.stringify(missedOpportunities, null, 2));
  
  // 6. Get EXECUTED trades for comparison
  console.log('\n=== EXECUTED TRADES ===');
  const [executedTrades] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold,
      decision, entryPrice, quantity, pnl, status, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND decision = 'EXECUTED'
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Executed Trades:', JSON.stringify(executedTrades, null, 2));
  
  // 7. Analyze skipped reasons
  console.log('\n=== SKIPPED REASON ANALYSIS ===');
  const [skippedReasons] = await connection.query(`
    SELECT 
      decisionReason,
      COUNT(*) as count
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND decision = 'SKIPPED'
    GROUP BY decisionReason
    ORDER BY count DESC
    LIMIT 20
  `);
  console.log('Skipped Reasons:', JSON.stringify(skippedReasons, null, 2));
  
  // 8. Check consensus history for approved signals
  console.log('\n=== CONSENSUS HISTORY - APPROVED SIGNALS ===');
  const [approvedConsensus] = await connection.query(`
    SELECT 
      id, symbol, direction, confidence, action, isApproved, approvalReason, createdAt
    FROM consensusHistory 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND isApproved = 1
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Approved Consensus Signals:', JSON.stringify(approvedConsensus, null, 2));
  
  // 9. Check for signals above threshold that weren't executed
  console.log('\n=== SIGNALS ABOVE THRESHOLD NOT EXECUTED ===');
  const [aboveThresholdNotExecuted] = await connection.query(`
    SELECT 
      id, symbol, signalType, totalConfidence, threshold,
      decision, decisionReason, createdAt
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      AND totalConfidence >= threshold
      AND decision != 'EXECUTED'
    ORDER BY totalConfidence DESC
    LIMIT 30
  `);
  console.log('Above Threshold Not Executed:', JSON.stringify(aboveThresholdNotExecuted, null, 2));
  
  // 10. Summary statistics
  console.log('\n=== SUMMARY STATISTICS ===');
  const [stats] = await connection.query(`
    SELECT 
      COUNT(*) as totalSignals,
      SUM(CASE WHEN decision = 'EXECUTED' THEN 1 ELSE 0 END) as executed,
      SUM(CASE WHEN decision = 'SKIPPED' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN decision = 'VETOED' THEN 1 ELSE 0 END) as vetoed,
      SUM(CASE WHEN decision = 'FAILED' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN totalConfidence >= threshold AND decision != 'EXECUTED' THEN 1 ELSE 0 END) as potentialMissed,
      AVG(totalConfidence) as avgConfidence,
      AVG(threshold) as avgThreshold
    FROM trade_decision_logs 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
  `);
  console.log('Statistics:', JSON.stringify(stats, null, 2));
  
  await connection.end();
  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);
