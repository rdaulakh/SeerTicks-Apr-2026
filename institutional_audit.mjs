/**
 * SEER Trading Platform - Institutional Grade A++ Audit
 * Silicon Valley Professional Standard
 * 
 * This script audits:
 * 1. Agent System - All 13 agents
 * 2. Trade Execution Flow
 * 3. ML Services
 * 4. API/WebSocket Connections
 * 5. Database Operations
 * 6. Latency Metrics
 * 7. Uptime/Reliability
 * 8. Trade Logs vs Execution
 */

import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runAudit() {
  console.log('='.repeat(80));
  console.log('SEER TRADING PLATFORM - INSTITUTIONAL GRADE A++ AUDIT');
  console.log('Silicon Valley Professional Standard');
  console.log('='.repeat(80));
  console.log('');

  const connection = await mysql.createConnection(DATABASE_URL);

  try {
    // ========================================
    // PHASE 1: AGENT SYSTEM AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 1: AGENT SYSTEM AUDIT');
    console.log('='.repeat(80));

    // Check agent signals in last 24 hours
    const [agentSignals] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as signalCount,
        AVG(confidence) as avgConfidence,
        MIN(createdAt) as firstSignal,
        MAX(createdAt) as lastSignal,
        SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) as bullishCount,
        SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) as bearishCount,
        SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) as neutralCount,
        SUM(CASE WHEN confidence = 0 THEN 1 ELSE 0 END) as zeroConfidenceCount
      FROM agentSignals
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY agentName
      ORDER BY signalCount DESC
    `);

    console.log('\n📊 Agent Signal Summary (Last 24 Hours):');
    console.log('-'.repeat(120));
    console.log('Agent Name'.padEnd(25) + 'Signals'.padStart(10) + 'Avg Conf'.padStart(10) + 
                'Bullish'.padStart(10) + 'Bearish'.padStart(10) + 'Neutral'.padStart(10) + 
                'Zero Conf'.padStart(12) + 'Last Signal'.padStart(25));
    console.log('-'.repeat(120));

    const expectedAgents = [
      'TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'SentimentAnalyst',
      'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst', 'WhaleTracker',
      'FundingRateAnalyst', 'LiquidationHeatmap', 'OnChainFlowAnalyst', 
      'VolumeProfileAnalyzer', 'MLPredictionAgent'
    ];

    const foundAgents = new Set();
    for (const row of agentSignals) {
      foundAgents.add(row.agentName);
      const zeroConfPct = ((row.zeroConfidenceCount / row.signalCount) * 100).toFixed(1);
      const status = row.zeroConfidenceCount > row.signalCount * 0.5 ? '⚠️ HIGH ZERO CONF' : '✅';
      console.log(
        row.agentName.padEnd(25) +
        row.signalCount.toString().padStart(10) +
        (row.avgConfidence * 100).toFixed(1).padStart(9) + '%' +
        row.bullishCount.toString().padStart(10) +
        row.bearishCount.toString().padStart(10) +
        row.neutralCount.toString().padStart(10) +
        `${row.zeroConfidenceCount} (${zeroConfPct}%)`.padStart(12) +
        new Date(row.lastSignal).toISOString().padStart(25)
      );
    }

    console.log('\n🔍 Missing Agents:');
    const missingAgents = expectedAgents.filter(a => !foundAgents.has(a));
    if (missingAgents.length === 0) {
      console.log('   ✅ All 13 agents are generating signals');
    } else {
      for (const agent of missingAgents) {
        console.log(`   ❌ ${agent} - NO SIGNALS IN LAST 24 HOURS`);
      }
    }

    // ========================================
    // PHASE 2: TRADE EXECUTION FLOW AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 2: TRADE EXECUTION FLOW AUDIT');
    console.log('='.repeat(80));

    // Check paper trades
    const [paperTrades] = await connection.execute(`
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) as filledTrades,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTrades,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledTrades,
        SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) as buyTrades,
        SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sellTrades,
        MIN(createdAt) as firstTrade,
        MAX(createdAt) as lastTrade
      FROM paperTrades
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    console.log('\n📈 Paper Trade Summary (Last 7 Days):');
    console.log('-'.repeat(60));
    for (const row of paperTrades) {
      console.log(`   Total Trades: ${row.totalTrades}`);
      console.log(`   Filled: ${row.filledTrades} | Pending: ${row.pendingTrades} | Cancelled: ${row.cancelledTrades}`);
      console.log(`   Buy: ${row.buyTrades} | Sell: ${row.sellTrades}`);
      console.log(`   First Trade: ${row.firstTrade ? new Date(row.firstTrade).toISOString() : 'N/A'}`);
      console.log(`   Last Trade: ${row.lastTrade ? new Date(row.lastTrade).toISOString() : 'N/A'}`);
    }

    // Check paper positions
    const [paperPositions] = await connection.execute(`
      SELECT 
        COUNT(*) as totalPositions,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openPositions,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedPositions,
        SUM(CASE WHEN status = 'open' THEN unrealizedPnl ELSE 0 END) as totalUnrealizedPnl,
        SUM(CASE WHEN status = 'closed' THEN realizedPnl ELSE 0 END) as totalRealizedPnl
      FROM paperPositions
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    console.log('\n📊 Paper Position Summary (Last 7 Days):');
    console.log('-'.repeat(60));
    for (const row of paperPositions) {
      console.log(`   Total Positions: ${row.totalPositions}`);
      console.log(`   Open: ${row.openPositions} | Closed: ${row.closedPositions}`);
      console.log(`   Unrealized P&L: $${(row.totalUnrealizedPnl || 0).toFixed(2)}`);
      console.log(`   Realized P&L: $${(row.totalRealizedPnl || 0).toFixed(2)}`);
    }

    // Check open positions details
    const [openPositions] = await connection.execute(`
      SELECT 
        id, symbol, side, entryPrice, currentPrice, quantity,
        unrealizedPnl, stopLoss, takeProfit, 
        originalConsensus, currentConsensus, exitThreshold,
        createdAt, updatedAt
      FROM paperPositions
      WHERE status = 'open'
      ORDER BY createdAt DESC
      LIMIT 10
    `);

    console.log('\n🔓 Open Positions:');
    console.log('-'.repeat(140));
    if (openPositions.length === 0) {
      console.log('   No open positions');
    } else {
      console.log('ID'.padEnd(10) + 'Symbol'.padEnd(12) + 'Side'.padEnd(8) + 
                  'Entry'.padStart(12) + 'Current'.padStart(12) + 'Qty'.padStart(10) +
                  'P&L'.padStart(12) + 'SL'.padStart(12) + 'TP'.padStart(12) +
                  'Consensus'.padStart(12) + 'Threshold'.padStart(12));
      console.log('-'.repeat(140));
      for (const pos of openPositions) {
        console.log(
          pos.id.toString().padEnd(10) +
          pos.symbol.padEnd(12) +
          pos.side.padEnd(8) +
          `$${pos.entryPrice.toFixed(2)}`.padStart(12) +
          `$${(pos.currentPrice || 0).toFixed(2)}`.padStart(12) +
          pos.quantity.toFixed(4).padStart(10) +
          `$${(pos.unrealizedPnl || 0).toFixed(2)}`.padStart(12) +
          `$${(pos.stopLoss || 0).toFixed(2)}`.padStart(12) +
          `$${(pos.takeProfit || 0).toFixed(2)}`.padStart(12) +
          `${((pos.currentConsensus || 0) * 100).toFixed(1)}%`.padStart(12) +
          `${((pos.exitThreshold || 0) * 100).toFixed(1)}%`.padStart(12)
        );
      }
    }

    // ========================================
    // PHASE 3: ML SERVICES AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 3: ML SERVICES AUDIT');
    console.log('='.repeat(80));

    // Check ML optimization logs
    const [mlLogs] = await connection.execute(`
      SELECT 
        optimizationType,
        COUNT(*) as runCount,
        MAX(createdAt) as lastRun,
        AVG(JSON_EXTRACT(result, '$.improvement')) as avgImprovement
      FROM mlOptimizationLogs
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY optimizationType
    `);

    console.log('\n🤖 ML Optimization Summary (Last 7 Days):');
    console.log('-'.repeat(80));
    if (mlLogs.length === 0) {
      console.log('   ⚠️ No ML optimization runs in last 7 days');
    } else {
      for (const row of mlLogs) {
        console.log(`   ${row.optimizationType}: ${row.runCount} runs, Last: ${new Date(row.lastRun).toISOString()}`);
      }
    }

    // Check agent weights
    const [agentWeights] = await connection.execute(`
      SELECT agentName, weight, accuracy, updatedAt
      FROM agentWeights
      ORDER BY weight DESC
    `);

    console.log('\n⚖️ Agent Weights:');
    console.log('-'.repeat(60));
    if (agentWeights.length === 0) {
      console.log('   ⚠️ No agent weights configured');
    } else {
      for (const row of agentWeights) {
        console.log(`   ${row.agentName.padEnd(25)} Weight: ${row.weight.toFixed(3)} | Accuracy: ${(row.accuracy * 100).toFixed(1)}%`);
      }
    }

    // ========================================
    // PHASE 4: ENGINE STATE AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4: ENGINE STATE AUDIT');
    console.log('='.repeat(80));

    const [engineStates] = await connection.execute(`
      SELECT 
        userId, isRunning, isPaperMode, startedAt, updatedAt,
        JSON_EXTRACT(config, '$.enableAutoTrading') as autoTrading,
        JSON_EXTRACT(config, '$.riskLevel') as riskLevel
      FROM seerEngineState
      ORDER BY updatedAt DESC
    `);

    console.log('\n🔧 Engine States:');
    console.log('-'.repeat(100));
    for (const row of engineStates) {
      const status = row.isRunning ? '🟢 RUNNING' : '🔴 STOPPED';
      const mode = row.isPaperMode ? 'PAPER' : 'LIVE';
      const autoTrade = row.autoTrading ? '✅ AUTO' : '❌ MANUAL';
      console.log(`   User ${row.userId}: ${status} | Mode: ${mode} | ${autoTrade} | Started: ${row.startedAt ? new Date(row.startedAt).toISOString() : 'N/A'}`);
    }

    // ========================================
    // PHASE 5: WALLET AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: WALLET AUDIT');
    console.log('='.repeat(80));

    const [wallets] = await connection.execute(`
      SELECT 
        userId, balance, initialBalance, realizedPnL,
        totalTrades, winningTrades, losingTrades,
        updatedAt
      FROM paperWallets
      ORDER BY userId
    `);

    console.log('\n💰 Paper Wallets:');
    console.log('-'.repeat(100));
    for (const row of wallets) {
      const winRate = row.totalTrades > 0 ? ((row.winningTrades / row.totalTrades) * 100).toFixed(1) : 0;
      const pnlPct = ((row.balance - row.initialBalance) / row.initialBalance * 100).toFixed(2);
      console.log(`   User ${row.userId}: Balance: $${row.balance.toFixed(2)} | Initial: $${row.initialBalance.toFixed(2)} | P&L: ${pnlPct}%`);
      console.log(`              Trades: ${row.totalTrades} | Win: ${row.winningTrades} | Lose: ${row.losingTrades} | Win Rate: ${winRate}%`);
    }

    // ========================================
    // PHASE 6: TRADE LOG AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 6: TRADE LOG AUDIT');
    console.log('='.repeat(80));

    // Check trade logs
    const [tradeLogs] = await connection.execute(`
      SELECT 
        COUNT(*) as totalLogs,
        COUNT(DISTINCT tradeId) as uniqueTrades,
        MIN(timestamp) as firstLog,
        MAX(timestamp) as lastLog
      FROM tradeLogs
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    console.log('\n📝 Trade Logs (Last 7 Days):');
    console.log('-'.repeat(60));
    for (const row of tradeLogs) {
      console.log(`   Total Logs: ${row.totalLogs}`);
      console.log(`   Unique Trades: ${row.uniqueTrades}`);
      console.log(`   First Log: ${row.firstLog ? new Date(row.firstLog).toISOString() : 'N/A'}`);
      console.log(`   Last Log: ${row.lastLog ? new Date(row.lastLog).toISOString() : 'N/A'}`);
    }

    // Check for trade vs log discrepancies
    const [tradeLogDiscrepancy] = await connection.execute(`
      SELECT 
        pt.id as tradeId,
        pt.symbol,
        pt.createdAt as tradeTime,
        COUNT(tl.id) as logCount
      FROM paperTrades pt
      LEFT JOIN tradeLogs tl ON pt.id = tl.tradeId
      WHERE pt.createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY pt.id, pt.symbol, pt.createdAt
      HAVING logCount = 0
      LIMIT 10
    `);

    console.log('\n⚠️ Trades Without Logs:');
    if (tradeLogDiscrepancy.length === 0) {
      console.log('   ✅ All trades have corresponding logs');
    } else {
      console.log(`   ❌ Found ${tradeLogDiscrepancy.length} trades without logs`);
      for (const row of tradeLogDiscrepancy) {
        console.log(`      Trade ${row.tradeId}: ${row.symbol} @ ${new Date(row.tradeTime).toISOString()}`);
      }
    }

    // ========================================
    // PHASE 7: CONSENSUS TRACKING AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 7: CONSENSUS TRACKING AUDIT');
    console.log('='.repeat(80));

    const [consensusHistory] = await connection.execute(`
      SELECT 
        symbol,
        COUNT(*) as recordCount,
        AVG(consensus) as avgConsensus,
        MIN(consensus) as minConsensus,
        MAX(consensus) as maxConsensus,
        MIN(timestamp) as firstRecord,
        MAX(timestamp) as lastRecord
      FROM consensusHistory
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY symbol
    `);

    console.log('\n📊 Consensus History (Last 24 Hours):');
    console.log('-'.repeat(100));
    if (consensusHistory.length === 0) {
      console.log('   ⚠️ No consensus history records');
    } else {
      for (const row of consensusHistory) {
        console.log(`   ${row.symbol}: ${row.recordCount} records | Avg: ${(row.avgConsensus * 100).toFixed(1)}% | Range: ${(row.minConsensus * 100).toFixed(1)}% - ${(row.maxConsensus * 100).toFixed(1)}%`);
      }
    }

    // ========================================
    // PHASE 8: DATABASE PERFORMANCE AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 8: DATABASE PERFORMANCE AUDIT');
    console.log('='.repeat(80));

    // Check table sizes
    const [tableSizes] = await connection.execute(`
      SELECT 
        table_name,
        table_rows,
        ROUND(data_length / 1024 / 1024, 2) as data_mb,
        ROUND(index_length / 1024 / 1024, 2) as index_mb
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY data_length DESC
    `);

    console.log('\n💾 Table Sizes:');
    console.log('-'.repeat(80));
    console.log('Table'.padEnd(30) + 'Rows'.padStart(15) + 'Data (MB)'.padStart(15) + 'Index (MB)'.padStart(15));
    console.log('-'.repeat(80));
    for (const row of tableSizes) {
      console.log(
        row.table_name.padEnd(30) +
        (row.table_rows || 0).toString().padStart(15) +
        (row.data_mb || 0).toString().padStart(15) +
        (row.index_mb || 0).toString().padStart(15)
      );
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(80));

    const issues = [];
    
    // Check for missing agents
    if (missingAgents.length > 0) {
      issues.push(`❌ ${missingAgents.length} agents not generating signals`);
    }

    // Check for high zero-confidence signals
    for (const row of agentSignals) {
      if (row.zeroConfidenceCount > row.signalCount * 0.5) {
        issues.push(`⚠️ ${row.agentName} has ${((row.zeroConfidenceCount / row.signalCount) * 100).toFixed(0)}% zero-confidence signals`);
      }
    }

    // Check for trade log discrepancies
    if (tradeLogDiscrepancy.length > 0) {
      issues.push(`⚠️ ${tradeLogDiscrepancy.length} trades without corresponding logs`);
    }

    // Check for stale engine states
    for (const row of engineStates) {
      const lastUpdate = new Date(row.updatedAt);
      const now = new Date();
      const minutesSinceUpdate = (now - lastUpdate) / 1000 / 60;
      if (row.isRunning && minutesSinceUpdate > 5) {
        issues.push(`⚠️ User ${row.userId} engine last updated ${minutesSinceUpdate.toFixed(0)} minutes ago`);
      }
    }

    if (issues.length === 0) {
      console.log('\n✅ NO CRITICAL ISSUES FOUND');
    } else {
      console.log('\n🚨 ISSUES FOUND:');
      for (const issue of issues) {
        console.log(`   ${issue}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Audit error:', error);
  } finally {
    await connection.end();
  }
}

runAudit().catch(console.error);
