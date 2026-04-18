#!/usr/bin/env node
/**
 * Validation Queries Script
 * Runs the validation queries from the implementation guide to verify exit system fix
 */

import mysql from 'mysql2/promise';

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  
  // Parse SSL configuration
  const sslParam = url.searchParams.get('ssl');
  let ssl = false;
  if (sslParam) {
    try {
      ssl = JSON.parse(sslParam);
    } catch {
      ssl = { rejectUnauthorized: true };
    }
  }

  const connection = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl,
  });

  console.log('='.repeat(80));
  console.log('SEER EXIT SYSTEM VALIDATION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  // Query 1: Most recent exits (last 2 hours)
  console.log('📊 QUERY 1: Most Recent Exits (Last 2 Hours)');
  console.log('-'.repeat(60));
  const [recentExits] = await connection.execute(`
    SELECT 
      id,
      symbol,
      side,
      exitReason,
      realizedPnl,
      TIMESTAMPDIFF(MINUTE, entryTime, exitTime) as hold_time_min,
      exitTime
    FROM paperPositions
    WHERE status = 'closed'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 2 HOUR)
    ORDER BY exitTime DESC
    LIMIT 20
  `);
  
  if (recentExits.length === 0) {
    console.log('No exits in the last 2 hours.');
  } else {
    console.log('ID\tSymbol\t\tSide\tExit Reason\t\t\t\tP&L\t\tHold(min)\tTime');
    for (const row of recentExits) {
      const exitReason = (row.exitReason || 'N/A').padEnd(32);
      const pnl = parseFloat(row.realizedPnl || 0).toFixed(2).padStart(10);
      console.log(`${row.id}\t${row.symbol}\t${row.side}\t${exitReason}\t${pnl}\t${row.hold_time_min || 'N/A'}\t\t${row.exitTime}`);
    }
  }
  console.log();

  // Query 2: Exit Distribution (last 6 hours)
  console.log('📊 QUERY 2: Exit Distribution (Last 6 Hours)');
  console.log('-'.repeat(60));
  const [exitDist6h] = await connection.execute(`
    SELECT 
      exitReason,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM paperPositions WHERE status = 'closed' AND exitTime > DATE_SUB(NOW(), INTERVAL 6 HOUR)), 1) as percentage,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,8))), 2) as avg_pnl
    FROM paperPositions
    WHERE status = 'closed'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 6 HOUR)
    GROUP BY exitReason
    ORDER BY count DESC
  `);
  
  if (exitDist6h.length === 0) {
    console.log('No exits in the last 6 hours.');
  } else {
    console.log('Exit Reason\t\t\t\t\tCount\t%\tWins\tAvg P&L');
    for (const row of exitDist6h) {
      const exitReason = (row.exitReason || 'N/A').padEnd(40);
      console.log(`${exitReason}\t${row.count}\t${row.percentage}%\t${row.wins}\t$${row.avg_pnl}`);
    }
  }
  console.log();

  // Query 3: Exit Distribution (last 24 hours)
  console.log('📊 QUERY 3: Exit Distribution (Last 24 Hours)');
  console.log('-'.repeat(60));
  const [exitDist24h] = await connection.execute(`
    SELECT 
      exitReason,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM paperPositions WHERE status = 'closed' AND exitTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)), 1) as percentage,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,8))), 2) as avg_pnl
    FROM paperPositions
    WHERE status = 'closed'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY exitReason
    ORDER BY count DESC
  `);
  
  if (exitDist24h.length === 0) {
    console.log('No exits in the last 24 hours.');
  } else {
    console.log('Exit Reason\t\t\t\t\tCount\t%\tWins\tAvg P&L');
    for (const row of exitDist24h) {
      const exitReason = (row.exitReason || 'N/A').padEnd(40);
      console.log(`${exitReason}\t${row.count}\t${row.percentage}%\t${row.wins}\t$${row.avg_pnl}`);
    }
  }
  console.log();

  // Query 4: Overall Performance (last 24 hours)
  console.log('📊 QUERY 4: Overall Performance (Last 24 Hours)');
  console.log('-'.repeat(60));
  const [perf24h] = await connection.execute(`
    SELECT 
      COUNT(*) as trades,
      ROUND(SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,8))), 2) as total_pnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,8))), 2) as avg_pnl
    FROM paperPositions
    WHERE status = 'closed'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `);
  
  if (perf24h.length > 0) {
    const p = perf24h[0];
    console.log(`Total Trades: ${p.trades}`);
    console.log(`Win Rate: ${p.win_rate}%`);
    console.log(`Total P&L: $${p.total_pnl}`);
    console.log(`Avg P&L per Trade: $${p.avg_pnl}`);
  }
  console.log();

  // Query 5: Profit Target Performance (specifically)
  console.log('📊 QUERY 5: Profit Target Performance (Last 24 Hours)');
  console.log('-'.repeat(60));
  const [profitTargets] = await connection.execute(`
    SELECT 
      exitReason,
      COUNT(*) as count,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,8))), 2) as avg_pnl
    FROM paperPositions
    WHERE exitReason LIKE '%profit_target%'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY exitReason
  `);
  
  if (profitTargets.length === 0) {
    console.log('No profit target exits in the last 24 hours.');
    console.log('(This is expected if the fix was just deployed - profit targets need time to be reached)');
  } else {
    console.log('Exit Reason\t\t\t\t\tCount\tWins\tAvg P&L');
    for (const row of profitTargets) {
      const exitReason = (row.exitReason || 'N/A').padEnd(40);
      console.log(`${exitReason}\t${row.count}\t${row.wins}\t$${row.avg_pnl}`);
    }
  }
  console.log();

  // Query 6: Daily Performance (last 7 days)
  console.log('📊 QUERY 6: Daily Performance (Last 7 Days)');
  console.log('-'.repeat(60));
  const [dailyPerf] = await connection.execute(`
    SELECT 
      DATE(exitTime) as date,
      COUNT(*) as total_trades,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,8))), 2) as daily_pnl,
      ROUND(AVG(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN CAST(realizedPnl AS DECIMAL(20,8)) END), 2) as avg_win,
      ROUND(AVG(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) < 0 THEN CAST(realizedPnl AS DECIMAL(20,8)) END), 2) as avg_loss
    FROM paperPositions
    WHERE status = 'closed'
      AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY DATE(exitTime)
    ORDER BY date DESC
  `);
  
  if (dailyPerf.length === 0) {
    console.log('No closed positions in the last 7 days.');
  } else {
    console.log('Date\t\t\tTrades\tWins\tWin%\tDaily P&L\tAvg Win\t\tAvg Loss');
    for (const row of dailyPerf) {
      console.log(`${row.date}\t${row.total_trades}\t${row.wins}\t${row.win_rate}%\t$${row.daily_pnl}\t\t$${row.avg_win || 'N/A'}\t\t$${row.avg_loss || 'N/A'}`);
    }
  }
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  // Calculate key metrics
  const confidenceDecayCount = exitDist24h.find(r => r.exitReason?.includes('confidence_decay'))?.count || 0;
  const profitTargetCount = exitDist24h.filter(r => r.exitReason?.includes('profit_target')).reduce((sum, r) => sum + parseInt(r.count), 0);
  const totalCount = exitDist24h.reduce((sum, r) => sum + parseInt(r.count), 0);
  
  const confidenceDecayPct = totalCount > 0 ? (confidenceDecayCount / totalCount * 100).toFixed(1) : 0;
  const profitTargetPct = totalCount > 0 ? (profitTargetCount / totalCount * 100).toFixed(1) : 0;
  
  console.log();
  console.log('KEY METRICS (Last 24 Hours):');
  console.log(`  Confidence Decay Exits: ${confidenceDecayPct}% (Target: <20%)`);
  console.log(`  Profit Target Exits: ${profitTargetPct}% (Target: >20%)`);
  console.log(`  Win Rate: ${perf24h[0]?.win_rate || 'N/A'}% (Target: >40%)`);
  console.log(`  Daily P&L: $${perf24h[0]?.total_pnl || 'N/A'} (Target: Positive)`);
  console.log();
  
  // Status assessment
  if (parseFloat(confidenceDecayPct) < 20 && parseFloat(profitTargetPct) > 20) {
    console.log('✅ STATUS: EXIT SYSTEM FIX IS WORKING!');
  } else if (totalCount === 0) {
    console.log('⏳ STATUS: No data yet - system needs more time to generate trades');
  } else {
    console.log('⚠️ STATUS: Monitoring in progress - check back in a few hours');
  }
  
  await connection.end();
}

main().catch(console.error);
