import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  
  console.log('=== FULL TRADE AUDIT - Last 10 Hours ===\n');
  console.log('Timestamp:', new Date().toISOString());
  
  // 1. Check consensusHistory table structure
  console.log('\n=== CONSENSUS HISTORY TABLE STRUCTURE ===');
  const [consensusColumns] = await connection.query(`DESCRIBE consensusHistory`);
  console.log('Columns:', JSON.stringify(consensusColumns, null, 2));
  
  // 2. Get all consensusHistory records
  console.log('\n=== CONSENSUS HISTORY (Last 10 Hours) ===');
  const [consensusHistory] = await connection.query(`
    SELECT * FROM consensusHistory 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    ORDER BY createdAt DESC
    LIMIT 50
  `);
  console.log('Consensus History Count:', (consensusHistory as any[]).length);
  if ((consensusHistory as any[]).length > 0) {
    console.log('Sample Records:', JSON.stringify((consensusHistory as any[]).slice(0, 5), null, 2));
  }
  
  // 3. Check positions table
  console.log('\n=== POSITIONS (Last 10 Hours) ===');
  const [positions] = await connection.query(`
    SELECT * FROM positions 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Positions Count:', (positions as any[]).length);
  if ((positions as any[]).length > 0) {
    console.log('Sample Records:', JSON.stringify((positions as any[]).slice(0, 3), null, 2));
  }
  
  // 4. Check trades table
  console.log('\n=== TRADES (Last 10 Hours) ===');
  const [trades] = await connection.query(`
    SELECT * FROM trades 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Trades Count:', (trades as any[]).length);
  if ((trades as any[]).length > 0) {
    console.log('Sample Records:', JSON.stringify((trades as any[]).slice(0, 3), null, 2));
  }
  
  // 5. Check tradeExecutions table
  console.log('\n=== TRADE EXECUTIONS (Last 10 Hours) ===');
  const [tradeExecutions] = await connection.query(`
    SELECT * FROM tradeExecutions 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('Trade Executions Count:', (tradeExecutions as any[]).length);
  if ((tradeExecutions as any[]).length > 0) {
    console.log('Sample Records:', JSON.stringify((tradeExecutions as any[]).slice(0, 3), null, 2));
  }
  
  // 6. Check trade_decision_logs table - all time
  console.log('\n=== TRADE DECISION LOGS (ALL TIME) ===');
  const [allDecisionLogs] = await connection.query(`
    SELECT COUNT(*) as total FROM trade_decision_logs
  `);
  console.log('Total Decision Logs:', JSON.stringify(allDecisionLogs, null, 2));
  
  // 7. Get the most recent trade decision logs
  console.log('\n=== MOST RECENT TRADE DECISION LOGS ===');
  const [recentDecisionLogs] = await connection.query(`
    SELECT id, symbol, signalType, totalConfidence, decision, decisionReason, createdAt
    FROM trade_decision_logs 
    ORDER BY createdAt DESC
    LIMIT 10
  `);
  console.log('Recent Decision Logs:', JSON.stringify(recentDecisionLogs, null, 2));
  
  // 8. Check if there are any paper_positions
  console.log('\n=== PAPER POSITIONS CHECK ===');
  try {
    const [paperPositions] = await connection.query(`
      SELECT * FROM paper_positions 
      ORDER BY openedAt DESC
      LIMIT 10
    `);
    console.log('Paper Positions:', JSON.stringify(paperPositions, null, 2));
  } catch (e: any) {
    console.log('Error querying paper_positions:', e.message);
  }
  
  // 9. Check all tables with recent data
  console.log('\n=== TABLES WITH DATA IN LAST 10 HOURS ===');
  const tradingTables = [
    'consensusHistory', 'positions', 'trades', 'tradeExecutions', 
    'trade_decision_logs', 'tradeDecisionLogs'
  ];
  
  for (const table of tradingTables) {
    try {
      const [count] = await connection.query(`
        SELECT COUNT(*) as count FROM ${table} 
        WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      `);
      console.log(`${table}: ${(count as any[])[0].count} records`);
    } catch (e: any) {
      console.log(`${table}: Error - ${e.message}`);
    }
  }
  
  // 10. Check engine state
  console.log('\n=== ENGINE STATE ===');
  try {
    const [engineState] = await connection.query(`
      SELECT * FROM engineState ORDER BY id DESC LIMIT 1
    `);
    console.log('Engine State:', JSON.stringify(engineState, null, 2));
  } catch (e: any) {
    console.log('Error querying engineState:', e.message);
  }
  
  await connection.end();
  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);
