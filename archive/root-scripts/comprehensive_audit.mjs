import mysql from 'mysql2/promise';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;

async function runAudit() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const results = {};

  console.log("=== SEER IMPLEMENTATION AUDIT ===");
  console.log("Audit Date:", new Date().toISOString());
  console.log("=====================================\n");

  // ============================================
  // SECTION 1: AGENT FIXES VERIFICATION
  // ============================================
  
  // Request #1: Agent Signal Distribution (Last 24 Hours)
  console.log("### Request #1: Agent Signal Distribution (Last 24 Hours)");
  try {
    const [agentSignals] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as total_signals,
        SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) as bullish_count,
        SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) as bearish_count,
        SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
        ROUND(AVG(confidence) * 100, 2) as avg_confidence,
        MIN(createdAt) as first_signal,
        MAX(createdAt) as last_signal
      FROM agentSignals
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY agentName
      ORDER BY total_signals DESC
    `);
    results.request1_agent_signal_distribution = agentSignals;
    console.log(JSON.stringify(agentSignals, null, 2));
  } catch (e) {
    results.request1_agent_signal_distribution = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #2: SentimentAnalyst Detailed Analysis
  console.log("\n### Request #2: SentimentAnalyst Detailed Analysis");
  try {
    const [sentimentDetails] = await connection.execute(`
      SELECT 
        createdAt as timestamp,
        symbol,
        signal,
        confidence,
        reasoning,
        JSON_EXTRACT(evidence, '$.fearGreedValue') as fng_value,
        JSON_EXTRACT(evidence, '$.zScore') as z_score,
        JSON_EXTRACT(evidence, '$.percentile') as percentile
      FROM agentSignals
      WHERE agentName = 'SentimentAnalyst'
        AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    results.request2_sentiment_analyst = sentimentDetails;
    console.log(JSON.stringify(sentimentDetails.slice(0, 10), null, 2));
    console.log(`... (${sentimentDetails.length} total records)`);
  } catch (e) {
    results.request2_sentiment_analyst = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #3: FundingRateAnalyst Detailed Analysis
  console.log("\n### Request #3: FundingRateAnalyst Detailed Analysis");
  try {
    const [fundingDetails] = await connection.execute(`
      SELECT 
        createdAt as timestamp,
        symbol,
        signal,
        confidence,
        reasoning,
        JSON_EXTRACT(evidence, '$.currentFunding') as funding_rate,
        JSON_EXTRACT(evidence, '$.percentile') as percentile,
        JSON_EXTRACT(evidence, '$.source') as data_source
      FROM agentSignals
      WHERE agentName = 'FundingRateAnalyst'
        AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    results.request3_funding_rate_analyst = fundingDetails;
    console.log(JSON.stringify(fundingDetails.slice(0, 10), null, 2));
    console.log(`... (${fundingDetails.length} total records)`);
  } catch (e) {
    results.request3_funding_rate_analyst = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #4: Agent Error Logs
  console.log("\n### Request #4: Agent Error Logs");
  try {
    const [errorLogs] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as error_count,
        GROUP_CONCAT(DISTINCT errorMessage SEPARATOR '; ') as error_types
      FROM agentErrors
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY agentName
      ORDER BY error_count DESC
    `);
    results.request4_agent_errors = errorLogs;
    console.log(JSON.stringify(errorLogs, null, 2));
  } catch (e) {
    // Try alternative table name
    try {
      const [errorLogs2] = await connection.execute(`SHOW TABLES LIKE '%error%'`);
      results.request4_agent_errors = { note: "No agent_errors table found", tables: errorLogs2 };
      console.log("No agent_errors table found. Available error-related tables:", errorLogs2);
    } catch (e2) {
      results.request4_agent_errors = { error: e.message };
      console.log("Error:", e.message);
    }
  }

  // ============================================
  // SECTION 2: EXIT SYSTEM VERIFICATION
  // ============================================

  // Request #5: Exit Reason Distribution (Last 7 Days)
  console.log("\n### Request #5: Exit Reason Distribution (Last 7 Days)");
  try {
    const [exitReasons] = await connection.execute(`
      SELECT 
        exitReason,
        COUNT(*) as count,
        SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN realizedPnl < 0 THEN 1 ELSE 0 END) as losses,
        ROUND(AVG(realizedPnl), 2) as avg_pnl,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, entryTime, exitTime)), 2) as avg_hold_minutes
      FROM paperPositions
      WHERE status = 'closed'
        AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY exitReason
      ORDER BY count DESC
    `);
    results.request5_exit_reasons = exitReasons;
    console.log(JSON.stringify(exitReasons, null, 2));
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
        entryPrice,
        exitPrice,
        ROUND(realizedPnl, 2) as pnl,
        ROUND((realizedPnl / (entryPrice * quantity)) * 100, 2) as pnl_percent,
        TIMESTAMPDIFF(MINUTE, entryTime, exitTime) as hold_minutes,
        exitReason,
        entryConfidence
      FROM paperPositions
      WHERE status = 'closed'
      ORDER BY exitTime DESC
      LIMIT 20
    `);
    results.request6_recent_exits = recentExits;
    console.log(JSON.stringify(recentExits, null, 2));
  } catch (e) {
    results.request6_recent_exits = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 3: ENTRY SYSTEM VERIFICATION
  // ============================================

  // Request #7: Entry Decision Log (Last 50 Decisions)
  console.log("\n### Request #7: Entry Decision Log");
  try {
    const [entryDecisions] = await connection.execute(`
      SELECT 
        createdAt as timestamp,
        symbol,
        decision,
        skipReason,
        consensusStrength,
        combinedScore,
        agentVotes,
        executed
      FROM tradeDecisionLogs
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY createdAt DESC
      LIMIT 50
    `);
    results.request7_entry_decisions = entryDecisions;
    console.log(JSON.stringify(entryDecisions.slice(0, 10), null, 2));
    console.log(`... (${entryDecisions.length} total records)`);
  } catch (e) {
    results.request7_entry_decisions = { error: e.message, note: "tradeDecisionLogs table may not exist" };
    console.log("Error:", e.message);
  }

  // Request #8: Entry Validation Stats
  console.log("\n### Request #8: Entry Validation Stats");
  try {
    const [entryStats] = await connection.execute(`
      SELECT 
        DATE(createdAt) as date,
        COUNT(*) as total_signals,
        SUM(CASE WHEN decision = 'EXECUTED' THEN 1 ELSE 0 END) as executed,
        SUM(CASE WHEN decision = 'SKIPPED' THEN 1 ELSE 0 END) as skipped,
        GROUP_CONCAT(DISTINCT skipReason SEPARATOR '; ') as skip_reasons
      FROM tradeDecisionLogs
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(createdAt)
      ORDER BY date DESC
    `);
    results.request8_entry_stats = entryStats;
    console.log(JSON.stringify(entryStats, null, 2));
  } catch (e) {
    results.request8_entry_stats = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 4: PERFORMANCE METRICS
  // ============================================

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
          ABS(COALESCE(SUM(CASE WHEN realizedPnl > 0 THEN realizedPnl ELSE 0 END), 0) / 
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
  } catch (e) {
    results.request9_performance = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #10: Agent Contribution Analysis
  console.log("\n### Request #10: Agent Contribution Analysis");
  try {
    const [agentContribution] = await connection.execute(`
      SELECT 
        JSON_EXTRACT(agentsVoting, '$[0]') as primary_agent,
        COUNT(*) as trades,
        SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as win_rate,
        ROUND(SUM(realizedPnl), 2) as total_contribution
      FROM paperPositions
      WHERE status = 'closed'
        AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND agentsVoting IS NOT NULL
      GROUP BY primary_agent
      ORDER BY trades DESC
    `);
    results.request10_agent_contribution = agentContribution;
    console.log(JSON.stringify(agentContribution, null, 2));
  } catch (e) {
    // Try alternative approach
    try {
      const [trades] = await connection.execute(`
        SELECT COUNT(*) as total, 
               SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins,
               ROUND(SUM(realizedPnl), 2) as total_pnl
        FROM paperPositions
        WHERE status = 'closed' AND exitTime > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);
      results.request10_agent_contribution = { note: "agentsVoting column may not exist", summary: trades };
      console.log("agentsVoting column may not exist. Trade summary:", trades);
    } catch (e2) {
      results.request10_agent_contribution = { error: e.message };
      console.log("Error:", e.message);
    }
  }

  // ============================================
  // SECTION 6: INFRASTRUCTURE VERIFICATION
  // ============================================

  // Request #13: System Health Logs
  console.log("\n### Request #13: System Health Logs");
  try {
    const [healthLogs] = await connection.execute(`
      SELECT 
        serviceName,
        status,
        AVG(responseTime) as avg_latency_ms,
        MIN(createdAt) as first_check,
        MAX(createdAt) as last_check,
        COUNT(CASE WHEN status = 'degraded' THEN 1 END) as degraded_count
      FROM systemHealthLogs
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY serviceName, status
      ORDER BY serviceName, status
    `);
    results.request13_health_logs = healthLogs;
    console.log(JSON.stringify(healthLogs, null, 2));
  } catch (e) {
    results.request13_health_logs = { error: e.message, note: "systemHealthLogs table may not exist" };
    console.log("Error:", e.message);
  }

  // ============================================
  // SECTION 8: SPECIFIC CHECKS
  // ============================================

  // Request #15: Verify No Regressions
  console.log("\n### Request #15: Verify No Regressions");
  try {
    const [regressionCheck] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as signals_7d,
        COUNT(DISTINCT DATE(createdAt)) as active_days,
        MAX(createdAt) as last_signal_time
      FROM agentSignals
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY agentName
      ORDER BY signals_7d DESC
    `);
    results.request15_regression_check = regressionCheck;
    console.log(JSON.stringify(regressionCheck, null, 2));
  } catch (e) {
    results.request15_regression_check = { error: e.message };
    console.log("Error:", e.message);
  }

  // Request #16: Critical Failure Check
  console.log("\n### Request #16: Critical Failure Check");
  try {
    const [criticalErrors] = await connection.execute(`
      SELECT 
        COUNT(*) as total_crashes,
        GROUP_CONCAT(errorMessage SEPARATOR '; ') as crash_reasons
      FROM systemErrors
      WHERE severity = 'critical'
        AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    results.request16_critical_failures = criticalErrors;
    console.log(JSON.stringify(criticalErrors, null, 2));
  } catch (e) {
    results.request16_critical_failures = { error: e.message, note: "No critical errors table or no critical errors" };
    console.log("No critical errors found or table doesn't exist:", e.message);
  }

  // ============================================
  // SECTION 9: COMPARISON METRICS
  // ============================================

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
    
    // Get agent bias stats
    const [agentBias] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as total_signals,
        ROUND(SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bullish_pct,
        ROUND(SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as bearish_pct,
        ROUND(SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as neutral_pct
      FROM agentSignals
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY agentName
      ORDER BY total_signals DESC
    `);
    
    results.request17_comparison = {
      overall_stats: overallStats[0],
      agent_bias: agentBias
    };
    console.log("Overall Stats:", JSON.stringify(overallStats[0], null, 2));
    console.log("Agent Bias:", JSON.stringify(agentBias, null, 2));
  } catch (e) {
    results.request17_comparison = { error: e.message };
    console.log("Error:", e.message);
  }

  // ============================================
  // ADDITIONAL: Database Schema Check
  // ============================================
  console.log("\n### Additional: Database Tables");
  try {
    const [tables] = await connection.execute(`SHOW TABLES`);
    results.database_tables = tables;
    console.log("Available tables:", tables.map(t => Object.values(t)[0]));
  } catch (e) {
    results.database_tables = { error: e.message };
  }

  // Save results to file
  fs.writeFileSync('/home/ubuntu/SEER_AUDIT_RESULTS.json', JSON.stringify(results, null, 2));
  console.log("\n=== AUDIT COMPLETE ===");
  console.log("Results saved to /home/ubuntu/SEER_AUDIT_RESULTS.json");

  await connection.end();
  return results;
}

runAudit().catch(console.error);
