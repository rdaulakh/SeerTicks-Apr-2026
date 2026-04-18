import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function auditSignals() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== SIGNAL GENERATION AUDIT ===\n');
  
  // 1. Check last 10 signals by timestamp
  console.log('--- Last 10 Signals Generated ---');
  const [lastSignals] = await connection.execute(`
    SELECT id, agentName, symbol, action, confidence, timestamp 
    FROM agentSignals 
    ORDER BY timestamp DESC 
    LIMIT 10
  `);
  lastSignals.forEach(s => {
    console.log(`${s.timestamp} | ${s.agentName} | ${s.symbol} | ${s.action} | conf: ${s.confidence}%`);
  });
  
  // 2. Check signal count by day for last 7 days
  console.log('\n--- Signal Count by Day (Last 7 Days) ---');
  const [dailySignals] = await connection.execute(`
    SELECT DATE(timestamp) as date, COUNT(*) as count 
    FROM agentSignals 
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY DATE(timestamp) 
    ORDER BY date DESC
  `);
  dailySignals.forEach(d => {
    console.log(`${d.date}: ${d.count} signals`);
  });
  
  // 3. Check last trade execution
  console.log('\n--- Last 10 Trade Executions ---');
  const [lastTrades] = await connection.execute(`
    SELECT id, symbol, side, quantity, price, status, createdAt 
    FROM trades 
    ORDER BY createdAt DESC 
    LIMIT 10
  `);
  if (lastTrades.length === 0) {
    console.log('No trades found in database');
  } else {
    lastTrades.forEach(t => {
      console.log(`${t.createdAt} | ${t.symbol} | ${t.side} | qty: ${t.quantity} | $${t.price} | ${t.status}`);
    });
  }
  
  // 4. Check system startup logs
  console.log('\n--- System Startup Logs (Last 10) ---');
  const [startupLogs] = await connection.execute(`
    SELECT id, startTime, endTime, status, engineMode 
    FROM systemStartupLog 
    ORDER BY startTime DESC 
    LIMIT 10
  `);
  startupLogs.forEach(s => {
    console.log(`${s.startTime} | ${s.status} | mode: ${s.engineMode}`);
  });
  
  // 5. Check gaps in signal generation (hours without signals)
  console.log('\n--- Signal Generation Gaps (>1 hour) ---');
  const [gaps] = await connection.execute(`
    SELECT 
      a.timestamp as last_signal,
      b.timestamp as next_signal,
      TIMESTAMPDIFF(MINUTE, a.timestamp, b.timestamp) as gap_minutes
    FROM (
      SELECT timestamp, 
             @row := @row + 1 as row_num
      FROM agentSignals, (SELECT @row := 0) r
      ORDER BY timestamp
    ) a
    JOIN (
      SELECT timestamp,
             @row2 := @row2 + 1 as row_num
      FROM agentSignals, (SELECT @row2 := 0) r
      ORDER BY timestamp
    ) b ON a.row_num = b.row_num - 1
    WHERE TIMESTAMPDIFF(MINUTE, a.timestamp, b.timestamp) > 60
    ORDER BY gap_minutes DESC
    LIMIT 10
  `);
  if (gaps.length === 0) {
    console.log('No significant gaps found');
  } else {
    gaps.forEach(g => {
      console.log(`Gap: ${g.gap_minutes} minutes | From: ${g.last_signal} | To: ${g.next_signal}`);
    });
  }
  
  await connection.end();
}

auditSignals().catch(console.error);
