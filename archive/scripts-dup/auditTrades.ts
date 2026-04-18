import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  
  console.log('=== TRADE EXECUTION AUDIT - Last 10 Hours ===\n');
  
  // 1. Get consensusHistory for last 10 hours
  console.log('=== CONSENSUS HISTORY (Last 10 Hours) ===');
  try {
    const [consensusHistory] = await connection.query(`
      SELECT * FROM consensusHistory 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 100
    `);
    console.log('Consensus History Count:', (consensusHistory as any[]).length);
    console.log('Sample:', JSON.stringify((consensusHistory as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying consensusHistory:', e.message);
  }
  
  // 2. Get trade_decision_logs for last 10 hours
  console.log('\n=== TRADE DECISION LOGS (Last 10 Hours) ===');
  try {
    const [decisionLogs] = await connection.query(`
      SELECT * FROM trade_decision_logs 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 100
    `);
    console.log('Decision Logs Count:', (decisionLogs as any[]).length);
    console.log('Sample:', JSON.stringify((decisionLogs as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying trade_decision_logs:', e.message);
  }
  
  // 3. Get tradeDecisionLogs for last 10 hours
  console.log('\n=== TRADE DECISION LOGS (camelCase) ===');
  try {
    const [decisionLogs] = await connection.query(`
      SELECT * FROM tradeDecisionLogs 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 100
    `);
    console.log('Decision Logs Count:', (decisionLogs as any[]).length);
    console.log('Sample:', JSON.stringify((decisionLogs as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying tradeDecisionLogs:', e.message);
  }
  
  // 4. Get positions for last 10 hours
  console.log('\n=== POSITIONS (Last 10 Hours) ===');
  try {
    const [positions] = await connection.query(`
      SELECT * FROM positions 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    console.log('Positions Count:', (positions as any[]).length);
    console.log('Sample:', JSON.stringify((positions as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying positions:', e.message);
  }
  
  // 5. Get trades for last 10 hours
  console.log('\n=== TRADES (Last 10 Hours) ===');
  try {
    const [trades] = await connection.query(`
      SELECT * FROM trades 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    console.log('Trades Count:', (trades as any[]).length);
    console.log('Sample:', JSON.stringify((trades as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying trades:', e.message);
  }
  
  // 6. Get tradeExecutions for last 10 hours
  console.log('\n=== TRADE EXECUTIONS (Last 10 Hours) ===');
  try {
    const [executions] = await connection.query(`
      SELECT * FROM tradeExecutions 
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 10 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    console.log('Trade Executions Count:', (executions as any[]).length);
    console.log('Sample:', JSON.stringify((executions as any[]).slice(0, 5), null, 2));
  } catch (e: any) {
    console.log('Error querying tradeExecutions:', e.message);
  }
  
  // 7. Describe consensusHistory table structure
  console.log('\n=== CONSENSUS HISTORY TABLE STRUCTURE ===');
  try {
    const [columns] = await connection.query(`DESCRIBE consensusHistory`);
    console.log('Columns:', JSON.stringify(columns, null, 2));
  } catch (e: any) {
    console.log('Error describing consensusHistory:', e.message);
  }
  
  // 8. Describe trade_decision_logs table structure
  console.log('\n=== TRADE DECISION LOGS TABLE STRUCTURE ===');
  try {
    const [columns] = await connection.query(`DESCRIBE trade_decision_logs`);
    console.log('Columns:', JSON.stringify(columns, null, 2));
  } catch (e: any) {
    console.log('Error describing trade_decision_logs:', e.message);
  }
  
  await connection.end();
  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);
