import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('TRADE LOGS VS EXECUTION ANALYSIS AUDIT');
console.log('='.repeat(80));

// Check trade decision logs vs actual trades
console.log('\n=== TRADE DECISION LOGS SUMMARY ===');
try {
  const [decisions] = await connection.execute(`
    SELECT decision, COUNT(*) as cnt
    FROM tradeDecisionLogs
    GROUP BY decision
  `);
  console.log('Decision distribution:');
  for (const d of decisions) {
    console.log(`  ${d.decision}: ${d.cnt}`);
  }
  
  const [total] = await connection.execute(`SELECT COUNT(*) as cnt FROM tradeDecisionLogs`);
  console.log(`\nTotal trade decisions: ${total[0].cnt}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check paper positions summary
console.log('\n=== PAPER POSITIONS SUMMARY ===');
try {
  const [positions] = await connection.execute(`
    SELECT status, COUNT(*) as cnt, 
           SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as profitable,
           SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losing,
           SUM(realizedPnl) as totalPnl
    FROM paperPositions
    GROUP BY status
  `);
  console.log('Position status:');
  for (const p of positions) {
    console.log(`  ${p.status}: ${p.cnt} positions, profitable=${p.profitable}, losing=${p.losing}, totalPnl=$${p.totalPnl?.toFixed(2) || '0.00'}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check paper trades
console.log('\n=== PAPER TRADES SUMMARY ===');
try {
  const [trades] = await connection.execute(`
    SELECT side, COUNT(*) as cnt, SUM(quantity) as totalQty, SUM(totalValue) as totalValue
    FROM paperTrades
    GROUP BY side
  `);
  console.log('Trade distribution:');
  for (const t of trades) {
    console.log(`  ${t.side}: ${t.cnt} trades, qty=${t.totalQty}, value=$${t.totalValue?.toFixed(2) || '0.00'}`);
  }
  
  const [total] = await connection.execute(`SELECT COUNT(*) as cnt FROM paperTrades`);
  console.log(`\nTotal paper trades: ${total[0].cnt}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check automated trading metrics
console.log('\n=== AUTOMATED TRADING METRICS ===');
try {
  const [metrics] = await connection.execute(`SELECT * FROM automatedTradingMetrics ORDER BY id DESC LIMIT 5`);
  console.log(`Recent metrics: ${metrics.length}`);
  for (const m of metrics) {
    console.log(`  ${m.metricDate}: trades=${m.totalTrades}, winRate=${m.winRate}%, pnl=$${m.totalPnl}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check trading signals
console.log('\n=== TRADING SIGNALS SUMMARY ===');
try {
  const [signals] = await connection.execute(`
    SELECT signal, COUNT(*) as cnt
    FROM tradingSignals
    GROUP BY signal
  `);
  console.log('Signal distribution:');
  for (const s of signals) {
    console.log(`  ${s.signal}: ${s.cnt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check execution latency distribution
console.log('\n=== EXECUTION LATENCY DISTRIBUTION ===');
try {
  const [latency] = await connection.execute(`
    SELECT latencyGrade, COUNT(*) as cnt
    FROM executionLatencyLogs
    GROUP BY latencyGrade
  `);
  console.log('Latency grades:');
  for (const l of latency) {
    console.log(`  ${l.latencyGrade}: ${l.cnt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check trade execution results
console.log('\n=== TRADE EXECUTION RESULTS ===');
try {
  const [results] = await connection.execute(`
    SELECT executionResult, COUNT(*) as cnt
    FROM executionLatencyLogs
    GROUP BY executionResult
  `);
  console.log('Execution results:');
  for (const r of results) {
    console.log(`  ${r.executionResult}: ${r.cnt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for discrepancies between decisions and executions
console.log('\n=== DECISION VS EXECUTION DISCREPANCY ===');
try {
  const [decisionCount] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM tradeDecisionLogs WHERE decision = 'EXECUTED'
  `);
  const [tradeCount] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM paperTrades
  `);
  const [positionCount] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM paperPositions
  `);
  
  console.log(`  EXECUTED decisions: ${decisionCount[0].cnt}`);
  console.log(`  Paper trades: ${tradeCount[0].cnt}`);
  console.log(`  Paper positions: ${positionCount[0].cnt}`);
  
  const discrepancy = decisionCount[0].cnt - tradeCount[0].cnt;
  if (discrepancy > 0) {
    console.log(`\n  ⚠️ DISCREPANCY: ${discrepancy} EXECUTED decisions without corresponding trades!`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check position PnL analysis
console.log('\n=== POSITION PNL ANALYSIS ===');
try {
  const [pnl] = await connection.execute(`
    SELECT 
      COUNT(*) as totalPositions,
      SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as winners,
      SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losers,
      SUM(CASE WHEN realizedPnl = 0 OR realizedPnl IS NULL THEN 1 ELSE 0 END) as breakeven,
      SUM(realizedPnl) as totalPnl,
      AVG(realizedPnl) as avgPnl,
      MAX(realizedPnl) as maxWin,
      MIN(realizedPnl) as maxLoss
    FROM paperPositions
    WHERE status = 'closed'
  `);
  const p = pnl[0];
  console.log(`  Total closed positions: ${p.totalPositions}`);
  console.log(`  Winners: ${p.winners} (${((p.winners/p.totalPositions)*100).toFixed(1)}%)`);
  console.log(`  Losers: ${p.losers} (${((p.losers/p.totalPositions)*100).toFixed(1)}%)`);
  console.log(`  Breakeven: ${p.breakeven}`);
  console.log(`  Total PnL: $${p.totalPnl?.toFixed(2) || '0.00'}`);
  console.log(`  Avg PnL: $${p.avgPnl?.toFixed(2) || '0.00'}`);
  console.log(`  Max Win: $${p.maxWin?.toFixed(2) || '0.00'}`);
  console.log(`  Max Loss: $${p.maxLoss?.toFixed(2) || '0.00'}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check exit reason distribution
console.log('\n=== EXIT REASON DISTRIBUTION ===');
try {
  const [exits] = await connection.execute(`
    SELECT exitReason, COUNT(*) as cnt
    FROM paperPositions
    WHERE status = 'closed'
    GROUP BY exitReason
  `);
  console.log('Exit reasons:');
  for (const e of exits) {
    console.log(`  ${e.exitReason || 'unknown'}: ${e.cnt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
