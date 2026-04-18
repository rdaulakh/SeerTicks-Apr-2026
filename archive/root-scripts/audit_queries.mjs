import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runAuditQueries() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const results = {};
  
  // Query 1: Agent Signal Distribution
  console.log("Running Query 1: Agent Signal Distribution...");
  const [q1] = await connection.execute(`
    SELECT 
      agentName,
      COUNT(*) as total_signals,
      SUM(CASE WHEN signalType = 'bullish' THEN 1 ELSE 0 END) as bullish_count,
      SUM(CASE WHEN signalType = 'bearish' THEN 1 ELSE 0 END) as bearish_count,
      SUM(CASE WHEN signalType = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
      ROUND(AVG(CAST(confidence AS DECIMAL(10,4))) * 100, 2) as avg_confidence,
      ROUND(AVG(executionScore), 2) as avg_execution_score
    FROM agentSignals
    GROUP BY agentName
    ORDER BY total_signals DESC
    LIMIT 20
  `);
  results.agentSignalDistribution = q1;
  
  // Query 5: Exit Reason Distribution
  console.log("Running Query 5: Exit Reason Distribution...");
  const [q5] = await connection.execute(`
    SELECT 
      exitReason,
      COUNT(*) as count,
      SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) < 0 THEN 1 ELSE 0 END) as losses,
      ROUND(AVG(CAST(pnl AS DECIMAL(20,8))), 4) as avg_pnl
    FROM paperPositions
    WHERE status = 'closed'
    GROUP BY exitReason
    ORDER BY count DESC
    LIMIT 20
  `);
  results.exitReasonDistribution = q5;
  
  // Query 9: System Performance
  console.log("Running Query 9: System Performance...");
  const [q9] = await connection.execute(`
    SELECT 
      COUNT(*) as total_trades,
      SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) < 0 THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as win_rate,
      ROUND(SUM(CAST(pnl AS DECIMAL(20,8))), 4) as total_pnl,
      ROUND(AVG(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN CAST(pnl AS DECIMAL(20,8)) END), 4) as avg_win,
      ROUND(AVG(CASE WHEN CAST(pnl AS DECIMAL(20,8)) < 0 THEN CAST(pnl AS DECIMAL(20,8)) END), 4) as avg_loss
    FROM paperPositions
    WHERE status = 'closed'
  `);
  results.systemPerformance = q9;
  
  // Query: Total positions count
  console.log("Running Query: Position counts...");
  const [posCount] = await connection.execute(`
    SELECT 
      status,
      COUNT(*) as count
    FROM paperPositions
    GROUP BY status
  `);
  results.positionCounts = posCount;
  
  // Query: Recent trades
  console.log("Running Query: Recent trades...");
  const [recentTrades] = await connection.execute(`
    SELECT 
      id,
      symbol,
      side,
      entryPrice,
      exitPrice,
      pnl,
      exitReason,
      entryConfidence
    FROM paperPositions
    WHERE status = 'closed'
    ORDER BY id DESC
    LIMIT 20
  `);
  results.recentTrades = recentTrades;
  
  // Query: Waitlist count
  console.log("Running Query: Waitlist count...");
  const [waitlist] = await connection.execute(`
    SELECT COUNT(*) as total FROM waitlist
  `);
  results.waitlistCount = waitlist;
  
  // Query: User count
  console.log("Running Query: User count...");
  const [users] = await connection.execute(`
    SELECT COUNT(*) as total FROM users
  `);
  results.userCount = users;
  
  await connection.end();
  
  console.log("\n=== AUDIT RESULTS ===\n");
  console.log(JSON.stringify(results, null, 2));
  
  return results;
}

runAuditQueries().catch(console.error);
