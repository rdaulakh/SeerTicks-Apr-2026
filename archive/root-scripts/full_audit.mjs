import mysql from 'mysql2/promise';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;

async function runAudit() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const results = {};

  console.log("=".repeat(60));
  console.log("SEER IMPLEMENTATION AUDIT - COMPREHENSIVE REPORT");
  console.log("Audit Date:", new Date().toISOString());
  console.log("=".repeat(60));

  // ============================================
  // SECTION 1: AGENT FIXES VERIFICATION
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 1: AGENT FIXES VERIFICATION");
  console.log("=".repeat(60));
  
  // Request #1: Agent Signal Distribution (Last 24 Hours)
  console.log("\n### Request #1: Agent Signal Distribution (Last 24 Hours)");
  try {
    const [agentSignals] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as total_signals,
        SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) as bullish_count,
        SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) as bearish_count,
        SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
        ROUND(SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bullish_pct,
        ROUND(SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bearish_pct,
        ROUND(SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as neutral_pct,
        ROUND(AVG(confidence) * 100, 2) as avg_confidence,
        MIN(timestamp) as first_signal,
        MAX(timestamp) as last_signal
      FROM agentSignals
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY agentName
      ORDER BY total_signals DESC
    `);
    results.request1_agent_signal_distribution = agentSignals;
    console.log(JSON.stringify(agentSignals, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    agentSignals.forEach(agent => {
      const bias = agent.bullish_pct > 60 ? "⚠️ BULLISH BIAS" : 
                   agent.bearish_pct > 60 ? "⚠️ BEARISH BIAS" : 
                   agent.neutral_pct > 60 ? "⚠️ NEUTRAL BIAS" : "✅ BALANCED";
      console.log(`  ${agent.agentName}: ${agent.bullish_pct}% bull / ${agent.bearish_pct}% bear / ${agent.neutral_pct}% neutral - ${bias}`);
    });
  } catch (e) {
    results.request1_agent_signal_distribution = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #2: SentimentAnalyst Detailed Analysis
  console.log("\n### Request #2: SentimentAnalyst Detailed Analysis");
  try {
    const [sentimentDetails] = await connection.execute(`
      SELECT 
        timestamp,
        symbol,
        signal,
        confidence,
        reasoning,
        JSON_EXTRACT(evidence, '$.fearGreedValue') as fng_value,
        JSON_EXTRACT(evidence, '$.zScore') as z_score,
        JSON_EXTRACT(evidence, '$.percentile') as percentile
      FROM agentSignals
      WHERE agentName = 'SentimentAnalyst'
        AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY timestamp DESC
      LIMIT 20
    `);
    results.request2_sentiment_analyst = sentimentDetails;
    console.log(JSON.stringify(sentimentDetails, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const hasZScore = sentimentDetails.some(s => s.z_score !== null);
    console.log(`  Z-score present: ${hasZScore ? "✅ YES" : "❌ NO"}`);
    const signalDist = {bullish: 0, bearish: 0, neutral: 0};
    sentimentDetails.forEach(s => signalDist[s.signal]++);
    console.log(`  Signal distribution: ${signalDist.bullish} bullish / ${signalDist.bearish} bearish / ${signalDist.neutral} neutral`);
  } catch (e) {
    results.request2_sentiment_analyst = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #3: FundingRateAnalyst Detailed Analysis
  console.log("\n### Request #3: FundingRateAnalyst Detailed Analysis");
  try {
    const [fundingDetails] = await connection.execute(`
      SELECT 
        timestamp,
        symbol,
        signal,
        confidence,
        reasoning,
        JSON_EXTRACT(evidence, '$.currentFunding') as funding_rate,
        JSON_EXTRACT(evidence, '$.percentile') as percentile,
        JSON_EXTRACT(evidence, '$.source') as data_source
      FROM agentSignals
      WHERE agentName = 'FundingRateAnalyst'
        AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY timestamp DESC
      LIMIT 20
    `);
    results.request3_funding_rate_analyst = fundingDetails;
    console.log(JSON.stringify(fundingDetails, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const signalDist = {bullish: 0, bearish: 0, neutral: 0};
    fundingDetails.forEach(s => signalDist[s.signal]++);
    const isAllNeutral = signalDist.neutral === fundingDetails.length;
    console.log(`  100% neutral: ${isAllNeutral ? "❌ YES (BAD)" : "✅ NO (GOOD)"}`);
    console.log(`  Signal distribution: ${signalDist.bullish} bullish / ${signalDist.bearish} bearish / ${signalDist.neutral} neutral`);
  } catch (e) {
    results.request3_funding_rate_analyst = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 2: EXIT SYSTEM VERIFICATION
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 2: EXIT SYSTEM VERIFICATION");
  console.log("=".repeat(60));

  // Request #5: Exit Reason Distribution (Last 7 Days)
  console.log("\n### Request #5: Exit Reason Distribution (Last 7 Days)");
  try {
    const [exitReasons] = await connection.execute(`
      SELECT 
        CASE 
          WHEN exitReason LIKE 'Confidence decay%' THEN 'Confidence decay'
          WHEN exitReason LIKE 'Partial profit%' THEN 'Partial profit'
          WHEN exitReason LIKE 'Breakeven exit%' THEN 'Breakeven exit'
          WHEN exitReason LIKE 'Emergency exit%' THEN 'Emergency exit (stop loss)'
          ELSE exitReason
        END as exit_category,
        COUNT(*) as count,
        SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losses,
        ROUND(AVG(realizedPnl), 2) as avg_pnl,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, entryTime, exitTime)), 2) as avg_hold_minutes
      FROM paperPositions
      WHERE status = 'closed'
        AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY exit_category
      ORDER BY count DESC
    `);
    results.request5_exit_reasons = exitReasons;
    console.log(JSON.stringify(exitReasons, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const totalExits = exitReasons.reduce((sum, e) => sum + e.count, 0);
    const confidenceDecay = exitReasons.find(e => e.exit_category === 'Confidence decay');
    const confidenceDecayPct = confidenceDecay ? (confidenceDecay.count / totalExits * 100).toFixed(1) : 0;
    console.log(`  Total exits: ${totalExits}`);
    console.log(`  Confidence decay exits: ${confidenceDecayPct}% ${confidenceDecayPct > 50 ? "⚠️ TOO HIGH" : "✅ OK"}`);
    
    const profitTargets = exitReasons.find(e => e.exit_category === 'Partial profit');
    console.log(`  Profit target exits: ${profitTargets ? profitTargets.count : 0} ${profitTargets ? "✅ PRESENT" : "❌ MISSING"}`);
    
    const stopLoss = exitReasons.find(e => e.exit_category.includes('Emergency') || e.exit_category.includes('stop'));
    console.log(`  Stop loss exits: ${stopLoss ? stopLoss.count : 0} ${stopLoss ? "✅ PRESENT" : "❌ MISSING"}`);
  } catch (e) {
    results.request5_exit_reasons = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #6: Recent Exit Details (Last 20 Trades)
  console.log("\n### Request #6: Recent Exit Details (Last 20 Trades)");
  try {
    const [recentExits] = await connection.execute(`
      SELECT 
        id,
        symbol,
        side,
        ROUND(entryPrice, 2) as entryPrice,
        ROUND(exitPrice, 2) as exitPrice,
        ROUND(realizedPnl, 2) as pnl,
        ROUND((realizedPnl / (entryPrice * quantity)) * 100, 2) as pnl_percent,
        TIMESTAMPDIFF(MINUTE, entryTime, exitTime) as hold_minutes,
        exitReason,
        ROUND(originalConsensus * 100, 1) as entry_confidence,
        ROUND(peakConfidence * 100, 1) as peak_confidence,
        ROUND(currentConfidence * 100, 1) as exit_confidence
      FROM paperPositions
      WHERE status = 'closed'
      ORDER BY exitTime DESC
      LIMIT 20
    `);
    results.request6_recent_exits = recentExits;
    console.log(JSON.stringify(recentExits, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const winners = recentExits.filter(t => t.pnl > 0);
    const losers = recentExits.filter(t => t.pnl < 0);
    const avgWinnerHold = winners.length ? (winners.reduce((s, t) => s + t.hold_minutes, 0) / winners.length).toFixed(1) : 'N/A';
    const avgLoserHold = losers.length ? (losers.reduce((s, t) => s + t.hold_minutes, 0) / losers.length).toFixed(1) : 'N/A';
    console.log(`  Winners: ${winners.length}, Avg hold: ${avgWinnerHold} min`);
    console.log(`  Losers: ${losers.length}, Avg hold: ${avgLoserHold} min`);
    console.log(`  Peak confidence tracked: ${recentExits.some(t => t.peak_confidence) ? "✅ YES" : "❌ NO"}`);
  } catch (e) {
    results.request6_recent_exits = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 3: ENTRY SYSTEM VERIFICATION
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 3: ENTRY SYSTEM VERIFICATION");
  console.log("=".repeat(60));

  // Request #7: Entry Decision Log
  console.log("\n### Request #7: Entry Decision Log");
  try {
    const [entryDecisions] = await connection.execute(`
      SELECT 
        timestamp,
        symbol,
        decision,
        skipReason,
        consensusStrength,
        combinedScore,
        executed
      FROM tradeDecisionLogs
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY timestamp DESC
      LIMIT 30
    `);
    results.request7_entry_decisions = entryDecisions;
    console.log(JSON.stringify(entryDecisions.slice(0, 10), null, 2));
    console.log(`... (${entryDecisions.length} total records)`);
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const executed = entryDecisions.filter(d => d.executed || d.decision === 'EXECUTED').length;
    const skipped = entryDecisions.filter(d => d.decision === 'SKIPPED').length;
    console.log(`  Executed: ${executed}, Skipped: ${skipped}`);
    console.log(`  Skip rate: ${((skipped / entryDecisions.length) * 100).toFixed(1)}% ${skipped / entryDecisions.length > 0.5 ? "✅ SELECTIVE" : "⚠️ NOT SELECTIVE ENOUGH"}`);
    
    const skipReasons = [...new Set(entryDecisions.filter(d => d.skipReason).map(d => d.skipReason))];
    console.log(`  Unique skip reasons: ${skipReasons.length}`);
    skipReasons.slice(0, 5).forEach(r => console.log(`    - ${r}`));
  } catch (e) {
    results.request7_entry_decisions = { error: e.message, note: "tradeDecisionLogs table may not exist" };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 4: PERFORMANCE METRICS
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 4: PERFORMANCE METRICS");
  console.log("=".repeat(60));

  // Request #9: System Performance (Last 7 Days)
  console.log("\n### Request #9: System Performance (Last 7 Days)");
  try {
    const [performance] = await connection.execute(`
      SELECT 
        DATE(exitTime) as date,
        COUNT(*) as total_trades,
        SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losses,
        ROUND(SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as win_rate,
        ROUND(SUM(realizedPnl), 2) as total_pnl,
        ROUND(AVG(CASE WHEN realizedPnl > 0 THEN realizedPnl END), 2) as avg_win,
        ROUND(AVG(CASE WHEN realizedPnl < 0 THEN realizedPnl END), 2) as avg_loss,
        ROUND(
          ABS(COALESCE(SUM(CASE WHEN realizedPnl > 0 THEN realizedPnl ELSE 0 END), 1) / 
          NULLIF(SUM(CASE WHEN realizedPnl < 0 THEN realizedPnl ELSE 0 END), 0)), 
          2
        ) as profit_factor
      FROM paperPositions
      WHERE status = 'closed'
        AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(exitTime)
      ORDER BY date DESC
    `);
    results.request9_performance = performance;
    console.log(JSON.stringify(performance, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const totalTrades = performance.reduce((s, d) => s + d.total_trades, 0);
    const totalWins = performance.reduce((s, d) => s + parseInt(d.wins), 0);
    const totalPnl = performance.reduce((s, d) => s + (d.total_pnl || 0), 0);
    const overallWinRate = (totalWins / totalTrades * 100).toFixed(2);
    console.log(`  Total trades (7d): ${totalTrades}`);
    console.log(`  Overall win rate: ${overallWinRate}% ${overallWinRate > 30 ? "✅ IMPROVING" : "⚠️ NEEDS WORK"}`);
    console.log(`  Total P&L: $${totalPnl.toFixed(2)}`);
    
    // Trend analysis
    if (performance.length >= 2) {
      const recent = performance[0];
      const older = performance[performance.length - 1];
      const trend = parseFloat(recent.win_rate) > parseFloat(older.win_rate) ? "📈 IMPROVING" : "📉 DECLINING";
      console.log(`  Win rate trend: ${trend}`);
    }
  } catch (e) {
    results.request9_performance = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 5: COMPARISON METRICS
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 5: BEFORE/AFTER COMPARISON");
  console.log("=".repeat(60));

  // Request #17: Before/After Comparison
  console.log("\n### Request #17: Before/After Comparison");
  try {
    // Get overall stats
    const [overallStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losses,
        ROUND(SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as win_rate,
        ROUND(SUM(realizedPnl), 2) as total_pnl,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, entryTime, exitTime)), 2) as avg_hold_minutes,
        ROUND(AVG(CASE WHEN realizedPnl > 0 THEN TIMESTAMPDIFF(MINUTE, entryTime, exitTime) END), 2) as avg_winner_hold,
        ROUND(AVG(CASE WHEN realizedPnl < 0 THEN TIMESTAMPDIFF(MINUTE, entryTime, exitTime) END), 2) as avg_loser_hold,
        MIN(entryTime) as first_trade,
        MAX(exitTime) as last_trade
      FROM paperPositions
      WHERE status = 'closed'
    `);
    
    // Get agent bias stats (last 7 days)
    const [agentBias] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as total_signals,
        ROUND(SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bullish_pct,
        ROUND(SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bearish_pct,
        ROUND(SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as neutral_pct
      FROM agentSignals
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY agentName
      ORDER BY total_signals DESC
    `);
    
    results.request17_comparison = {
      overall_stats: overallStats[0],
      agent_bias: agentBias
    };
    
    console.log("\n=== OVERALL PERFORMANCE ===");
    console.log(JSON.stringify(overallStats[0], null, 2));
    
    console.log("\n=== AGENT BIAS (Last 7 Days) ===");
    console.log(JSON.stringify(agentBias, null, 2));
    
    // Analysis
    console.log("\n📊 COMPARISON ANALYSIS:");
    console.log("\nBASELINE (Before Fixes - Expected):");
    console.log("  - SentimentAnalyst bias: 99.8% bullish");
    console.log("  - TechnicalAnalyst bias: 76.5% bullish");
    console.log("  - Avg loser hold time: 201 minutes");
    console.log("  - Avg winner hold time: 46 minutes");
    
    console.log("\nCURRENT (After Fixes):");
    const sentiment = agentBias.find(a => a.agentName === 'SentimentAnalyst');
    const technical = agentBias.find(a => a.agentName === 'TechnicalAnalyst');
    if (sentiment) {
      console.log(`  - SentimentAnalyst: ${sentiment.bullish_pct}% bullish ${sentiment.bullish_pct < 50 ? "✅ FIXED" : "⚠️ STILL BIASED"}`);
    }
    if (technical) {
      console.log(`  - TechnicalAnalyst: ${technical.bullish_pct}% bullish ${technical.bullish_pct < 60 ? "✅ IMPROVED" : "⚠️ STILL BIASED"}`);
    }
    console.log(`  - Avg loser hold: ${overallStats[0].avg_loser_hold} min ${overallStats[0].avg_loser_hold < 100 ? "✅ IMPROVED" : "⚠️ STILL HIGH"}`);
    console.log(`  - Avg winner hold: ${overallStats[0].avg_winner_hold} min`);
    console.log(`  - Win rate: ${overallStats[0].win_rate}%`);
    console.log(`  - Total P&L: $${overallStats[0].total_pnl}`);
  } catch (e) {
    results.request17_comparison = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 6: REGRESSION CHECK
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("SECTION 6: REGRESSION & HEALTH CHECK");
  console.log("=".repeat(60));

  // Request #15: Verify No Regressions
  console.log("\n### Request #15: Verify No Regressions (Agent Activity)");
  try {
    const [regressionCheck] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as signals_7d,
        COUNT(DISTINCT DATE(timestamp)) as active_days,
        MAX(timestamp) as last_signal_time,
        TIMESTAMPDIFF(HOUR, MAX(timestamp), NOW()) as hours_since_last
      FROM agentSignals
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY agentName
      ORDER BY signals_7d DESC
    `);
    results.request15_regression_check = regressionCheck;
    console.log(JSON.stringify(regressionCheck, null, 2));
    
    // Analysis
    console.log("\n📊 ANALYSIS:");
    const silentAgents = regressionCheck.filter(a => a.hours_since_last > 24);
    if (silentAgents.length > 0) {
      console.log("⚠️ SILENT AGENTS (no signal in 24h):");
      silentAgents.forEach(a => console.log(`  - ${a.agentName}: ${a.hours_since_last}h since last signal`));
    } else {
      console.log("✅ All agents active in last 24 hours");
    }
    
    const lowActivityAgents = regressionCheck.filter(a => a.active_days < 5);
    if (lowActivityAgents.length > 0) {
      console.log("⚠️ LOW ACTIVITY AGENTS (<5 active days in 7d):");
      lowActivityAgents.forEach(a => console.log(`  - ${a.agentName}: ${a.active_days} active days`));
    }
  } catch (e) {
    results.request15_regression_check = { error: e.message };
    console.log("Error:", e.message);
  }

  // Save results to file
  fs.writeFileSync('/home/ubuntu/SEER_AUDIT_RESULTS.json', JSON.stringify(results, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(60));
  console.log("Results saved to /home/ubuntu/SEER_AUDIT_RESULTS.json");

  await connection.end();
  return results;
}

runAudit().catch(console.error);
