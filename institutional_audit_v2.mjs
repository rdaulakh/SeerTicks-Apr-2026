/**
 * SEER Trading Platform - Institutional Grade A++ Audit V2
 * Silicon Valley Professional Standard
 * 
 * Corrected for actual database schema
 */

import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function runAudit() {
  console.log('='.repeat(80));
  console.log('SEER TRADING PLATFORM - INSTITUTIONAL GRADE A++ AUDIT');
  console.log('Silicon Valley Professional Standard');
  console.log('Audit Date: ' + new Date().toISOString());
  console.log('='.repeat(80));
  console.log('');

  const connection = await mysql.createConnection(DATABASE_URL);

  const auditResults = {
    criticalIssues: [],
    warnings: [],
    passed: []
  };

  try {
    // ========================================
    // PHASE 1: AGENT SYSTEM AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 1: AGENT SYSTEM AUDIT');
    console.log('='.repeat(80));

    // Check agent signals - using correct column name 'timestamp'
    const [agentSignals] = await connection.execute(`
      SELECT 
        agentName,
        COUNT(*) as signalCount,
        AVG(CAST(confidence AS DECIMAL(10,4))) as avgConfidence,
        MIN(timestamp) as firstSignal,
        MAX(timestamp) as lastSignal,
        SUM(CASE WHEN JSON_EXTRACT(signalData, '$.signal') = 'bullish' THEN 1 ELSE 0 END) as bullishCount,
        SUM(CASE WHEN JSON_EXTRACT(signalData, '$.signal') = 'bearish' THEN 1 ELSE 0 END) as bearishCount,
        SUM(CASE WHEN JSON_EXTRACT(signalData, '$.signal') = 'neutral' THEN 1 ELSE 0 END) as neutralCount,
        SUM(CASE WHEN CAST(confidence AS DECIMAL(10,4)) = 0 THEN 1 ELSE 0 END) as zeroConfidenceCount
      FROM agentSignals
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY agentName
      ORDER BY signalCount DESC
    `);

    console.log('\n📊 Agent Signal Summary (Last 24 Hours):');
    console.log('-'.repeat(130));
    console.log('Agent Name'.padEnd(25) + 'Signals'.padStart(10) + 'Avg Conf'.padStart(12) + 
                'Bullish'.padStart(10) + 'Bearish'.padStart(10) + 'Neutral'.padStart(10) + 
                'Zero Conf'.padStart(15) + 'Last Signal'.padStart(28));
    console.log('-'.repeat(130));

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
      const avgConf = row.avgConfidence ? (row.avgConfidence * 100).toFixed(1) : '0.0';
      const status = row.zeroConfidenceCount > row.signalCount * 0.5 ? '⚠️' : '✅';
      
      if (row.zeroConfidenceCount > row.signalCount * 0.5) {
        auditResults.warnings.push(`${row.agentName} has ${zeroConfPct}% zero-confidence signals`);
      }
      
      console.log(
        `${status} ${row.agentName}`.padEnd(25) +
        row.signalCount.toString().padStart(10) +
        `${avgConf}%`.padStart(12) +
        row.bullishCount.toString().padStart(10) +
        row.bearishCount.toString().padStart(10) +
        row.neutralCount.toString().padStart(10) +
        `${row.zeroConfidenceCount} (${zeroConfPct}%)`.padStart(15) +
        new Date(row.lastSignal).toISOString().padStart(28)
      );
    }

    console.log('\n🔍 Agent Coverage Analysis:');
    const missingAgents = expectedAgents.filter(a => !foundAgents.has(a));
    if (missingAgents.length === 0) {
      console.log('   ✅ All 13 agents are generating signals');
      auditResults.passed.push('All 13 agents generating signals');
    } else {
      for (const agent of missingAgents) {
        console.log(`   ❌ ${agent} - NO SIGNALS IN LAST 24 HOURS`);
        auditResults.criticalIssues.push(`${agent} not generating signals`);
      }
    }

    // Check signal freshness
    const [latestSignal] = await connection.execute(`
      SELECT MAX(timestamp) as lastSignal FROM agentSignals
    `);
    const lastSignalTime = new Date(latestSignal[0].lastSignal);
    const minutesSinceSignal = (Date.now() - lastSignalTime.getTime()) / 1000 / 60;
    
    console.log(`\n⏱️ Signal Freshness: Last signal ${minutesSinceSignal.toFixed(1)} minutes ago`);
    if (minutesSinceSignal > 10) {
      auditResults.criticalIssues.push(`Signals are stale - ${minutesSinceSignal.toFixed(0)} minutes since last signal`);
    } else {
      auditResults.passed.push(`Signals are fresh (${minutesSinceSignal.toFixed(1)} min ago)`);
    }

    // ========================================
    // PHASE 2: TRADE EXECUTION FLOW AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 2: TRADE EXECUTION FLOW AUDIT');
    console.log('='.repeat(80));

    // Check paper positions
    const [paperPositions] = await connection.execute(`
      SELECT 
        COUNT(*) as totalPositions,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openPositions,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedPositions,
        SUM(CASE WHEN status = 'open' THEN CAST(unrealizedPnL AS DECIMAL(20,8)) ELSE 0 END) as totalUnrealizedPnl,
        SUM(CASE WHEN status = 'closed' THEN CAST(realizedPnl AS DECIMAL(20,8)) ELSE 0 END) as totalRealizedPnl
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
        id, userId, symbol, side, entryPrice, currentPrice, quantity,
        unrealizedPnL, stopLoss, takeProfit, 
        originalConsensus, currentConfidence,
        createdAt, updatedAt
      FROM paperPositions
      WHERE status = 'open'
      ORDER BY createdAt DESC
      LIMIT 10
    `);

    console.log('\n🔓 Open Positions:');
    console.log('-'.repeat(150));
    if (openPositions.length === 0) {
      console.log('   No open positions');
    } else {
      console.log('ID'.padEnd(10) + 'User'.padEnd(8) + 'Symbol'.padEnd(12) + 'Side'.padEnd(8) + 
                  'Entry'.padStart(12) + 'Current'.padStart(12) + 'Qty'.padStart(12) +
                  'P&L'.padStart(14) + 'SL'.padStart(12) + 'TP'.padStart(12) +
                  'Consensus'.padStart(12));
      console.log('-'.repeat(150));
      for (const pos of openPositions) {
        const entry = parseFloat(pos.entryPrice) || 0;
        const current = parseFloat(pos.currentPrice) || 0;
        const qty = parseFloat(pos.quantity) || 0;
        const pnl = parseFloat(pos.unrealizedPnL) || 0;
        const sl = parseFloat(pos.stopLoss) || 0;
        const tp = parseFloat(pos.takeProfit) || 0;
        const consensus = parseFloat(pos.currentConfidence) || 0;
        
        console.log(
          pos.id.toString().padEnd(10) +
          pos.userId.toString().padEnd(8) +
          pos.symbol.padEnd(12) +
          pos.side.padEnd(8) +
          `$${entry.toFixed(2)}`.padStart(12) +
          `$${current.toFixed(2)}`.padStart(12) +
          qty.toFixed(6).padStart(12) +
          `$${pnl.toFixed(2)}`.padStart(14) +
          `$${sl.toFixed(2)}`.padStart(12) +
          `$${tp.toFixed(2)}`.padStart(12) +
          `${(consensus * 100).toFixed(1)}%`.padStart(12)
        );
      }
    }

    // Check for positions without stop-loss
    const [noStopLoss] = await connection.execute(`
      SELECT COUNT(*) as count FROM paperPositions 
      WHERE status = 'open' AND (stopLoss IS NULL OR CAST(stopLoss AS DECIMAL(20,8)) = 0)
    `);
    if (noStopLoss[0].count > 0) {
      auditResults.warnings.push(`${noStopLoss[0].count} open positions without stop-loss`);
      console.log(`\n⚠️ WARNING: ${noStopLoss[0].count} open positions without stop-loss`);
    }

    // ========================================
    // PHASE 3: CONSENSUS TRACKING AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 3: CONSENSUS TRACKING AUDIT');
    console.log('='.repeat(80));

    const [consensusHistory] = await connection.execute(`
      SELECT 
        symbol,
        COUNT(*) as recordCount,
        AVG(consensusPercentage) as avgConsensus,
        MIN(consensusPercentage) as minConsensus,
        MAX(consensusPercentage) as maxConsensus,
        SUM(CASE WHEN finalSignal = 'BULLISH' THEN 1 ELSE 0 END) as bullishCount,
        SUM(CASE WHEN finalSignal = 'BEARISH' THEN 1 ELSE 0 END) as bearishCount,
        SUM(CASE WHEN finalSignal = 'NEUTRAL' THEN 1 ELSE 0 END) as neutralCount,
        MIN(timestamp) as firstRecord,
        MAX(timestamp) as lastRecord
      FROM consensusHistory
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY symbol
    `);

    console.log('\n📊 Consensus History (Last 24 Hours):');
    console.log('-'.repeat(120));
    if (consensusHistory.length === 0) {
      console.log('   ⚠️ No consensus history records');
      auditResults.warnings.push('No consensus history records in last 24 hours');
    } else {
      console.log('Symbol'.padEnd(12) + 'Records'.padStart(10) + 'Avg%'.padStart(10) + 
                  'Min%'.padStart(10) + 'Max%'.padStart(10) + 
                  'Bullish'.padStart(10) + 'Bearish'.padStart(10) + 'Neutral'.padStart(10) +
                  'Last Record'.padStart(28));
      console.log('-'.repeat(120));
      for (const row of consensusHistory) {
        console.log(
          row.symbol.padEnd(12) +
          row.recordCount.toString().padStart(10) +
          `${row.avgConsensus.toFixed(1)}`.padStart(10) +
          `${row.minConsensus}`.padStart(10) +
          `${row.maxConsensus}`.padStart(10) +
          row.bullishCount.toString().padStart(10) +
          row.bearishCount.toString().padStart(10) +
          row.neutralCount.toString().padStart(10) +
          new Date(row.lastRecord).toISOString().padStart(28)
        );
      }
    }

    // ========================================
    // PHASE 4: WALLET AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 4: WALLET AUDIT');
    console.log('='.repeat(80));

    const [wallets] = await connection.execute(`
      SELECT 
        userId, 
        CAST(balance AS DECIMAL(20,8)) as balance,
        CAST(equity AS DECIMAL(20,8)) as equity,
        CAST(realizedPnL AS DECIMAL(20,8)) as realizedPnL,
        CAST(unrealizedPnL AS DECIMAL(20,8)) as unrealizedPnL,
        totalTrades, winningTrades, losingTrades,
        winRate,
        updatedAt
      FROM paperWallets
      ORDER BY userId
    `);

    console.log('\n💰 Paper Wallets:');
    console.log('-'.repeat(120));
    console.log('User'.padEnd(8) + 'Balance'.padStart(15) + 'Equity'.padStart(15) + 
                'Realized P&L'.padStart(15) + 'Unrealized P&L'.padStart(15) +
                'Trades'.padStart(10) + 'Win'.padStart(8) + 'Lose'.padStart(8) + 
                'Win Rate'.padStart(12) + 'Last Update'.padStart(25));
    console.log('-'.repeat(120));
    
    for (const row of wallets) {
      const balance = row.balance || 0;
      const equity = row.equity || 0;
      const realizedPnL = row.realizedPnL || 0;
      const unrealizedPnL = row.unrealizedPnL || 0;
      
      console.log(
        row.userId.toString().padEnd(8) +
        `$${balance.toFixed(2)}`.padStart(15) +
        `$${equity.toFixed(2)}`.padStart(15) +
        `$${realizedPnL.toFixed(2)}`.padStart(15) +
        `$${unrealizedPnL.toFixed(2)}`.padStart(15) +
        (row.totalTrades || 0).toString().padStart(10) +
        (row.winningTrades || 0).toString().padStart(8) +
        (row.losingTrades || 0).toString().padStart(8) +
        (row.winRate || '0%').padStart(12) +
        new Date(row.updatedAt).toISOString().substring(0, 19).padStart(25)
      );
    }

    // ========================================
    // PHASE 5: AGENT WEIGHTS AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: AGENT WEIGHTS AUDIT');
    console.log('='.repeat(80));

    const [agentWeights] = await connection.execute(`
      SELECT * FROM agentWeights WHERE isActive = 1
    `);

    console.log('\n⚖️ Active Agent Weights:');
    console.log('-'.repeat(80));
    if (agentWeights.length === 0) {
      console.log('   ⚠️ No active agent weights configured');
      auditResults.warnings.push('No active agent weights configured');
    } else {
      for (const row of agentWeights) {
        console.log(`   User ${row.userId}:`);
        console.log(`     Technical: ${row.technicalWeight} | Pattern: ${row.patternWeight} | OrderFlow: ${row.orderFlowWeight}`);
        console.log(`     Sentiment: ${row.sentimentWeight} | News: ${row.newsWeight} | Macro: ${row.macroWeight}`);
        console.log(`     OnChain: ${row.onChainWeight} | WhaleTracker: ${row.whaleTrackerWeight}`);
        console.log(`     FundingRate: ${row.fundingRateWeight} | Liquidation: ${row.liquidationWeight}`);
        console.log(`     OnChainFlow: ${row.onChainFlowWeight} | VolumeProfile: ${row.volumeProfileWeight}`);
        console.log(`     Fast Multiplier: ${row.fastAgentMultiplier} | Slow Multiplier: ${row.slowAgentMultiplier}`);
      }
    }

    // ========================================
    // PHASE 6: TRADES AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 6: TRADES AUDIT');
    console.log('='.repeat(80));

    const [trades] = await connection.execute(`
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openTrades,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedTrades,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledTrades,
        SUM(CASE WHEN status = 'closed' THEN CAST(pnl AS DECIMAL(20,8)) ELSE 0 END) as totalPnl,
        AVG(CASE WHEN status = 'closed' THEN CAST(confidence AS DECIMAL(10,4)) ELSE NULL END) as avgConfidence,
        MIN(createdAt) as firstTrade,
        MAX(createdAt) as lastTrade
      FROM trades
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    console.log('\n📈 Trades Summary (Last 7 Days):');
    console.log('-'.repeat(60));
    for (const row of trades) {
      console.log(`   Total Trades: ${row.totalTrades}`);
      console.log(`   Open: ${row.openTrades} | Closed: ${row.closedTrades} | Cancelled: ${row.cancelledTrades}`);
      console.log(`   Total P&L: $${(row.totalPnl || 0).toFixed(2)}`);
      console.log(`   Avg Confidence: ${((row.avgConfidence || 0) * 100).toFixed(1)}%`);
      console.log(`   First Trade: ${row.firstTrade ? new Date(row.firstTrade).toISOString() : 'N/A'}`);
      console.log(`   Last Trade: ${row.lastTrade ? new Date(row.lastTrade).toISOString() : 'N/A'}`);
    }

    // ========================================
    // PHASE 7: DATABASE PERFORMANCE AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 7: DATABASE PERFORMANCE AUDIT');
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
        row.TABLE_NAME.padEnd(30) +
        (row.TABLE_ROWS || 0).toString().padStart(15) +
        (row.data_mb || 0).toString().padStart(15) +
        (row.index_mb || 0).toString().padStart(15)
      );
    }

    // ========================================
    // PHASE 8: SIGNAL TO TRADE CORRELATION AUDIT
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 8: SIGNAL TO TRADE CORRELATION AUDIT');
    console.log('='.repeat(80));

    // Check if trades have corresponding agent signals
    const [tradesWithSignals] = await connection.execute(`
      SELECT 
        id, symbol, side, confidence, agentSignals, createdAt
      FROM trades
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY createdAt DESC
      LIMIT 5
    `);

    console.log('\n🔗 Recent Trades with Agent Signals:');
    console.log('-'.repeat(100));
    if (tradesWithSignals.length === 0) {
      console.log('   No trades in last 7 days');
    } else {
      for (const trade of tradesWithSignals) {
        console.log(`   Trade ${trade.id}: ${trade.symbol} ${trade.side} @ ${new Date(trade.createdAt).toISOString()}`);
        console.log(`     Confidence: ${(parseFloat(trade.confidence || 0) * 100).toFixed(1)}%`);
        if (trade.agentSignals) {
          try {
            const signals = typeof trade.agentSignals === 'string' ? JSON.parse(trade.agentSignals) : trade.agentSignals;
            const signalCount = Array.isArray(signals) ? signals.length : Object.keys(signals).length;
            console.log(`     Agent Signals: ${signalCount} agents contributed`);
          } catch (e) {
            console.log(`     Agent Signals: Unable to parse`);
          }
        } else {
          console.log(`     Agent Signals: None recorded ⚠️`);
          auditResults.warnings.push(`Trade ${trade.id} has no agent signals recorded`);
        }
      }
    }

    // ========================================
    // AUDIT SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(80));

    console.log('\n✅ PASSED CHECKS:');
    if (auditResults.passed.length === 0) {
      console.log('   None');
    } else {
      for (const item of auditResults.passed) {
        console.log(`   ✅ ${item}`);
      }
    }

    console.log('\n⚠️ WARNINGS:');
    if (auditResults.warnings.length === 0) {
      console.log('   None');
    } else {
      for (const item of auditResults.warnings) {
        console.log(`   ⚠️ ${item}`);
      }
    }

    console.log('\n🚨 CRITICAL ISSUES:');
    if (auditResults.criticalIssues.length === 0) {
      console.log('   None');
    } else {
      for (const item of auditResults.criticalIssues) {
        console.log(`   ❌ ${item}`);
      }
    }

    // Calculate overall grade
    let grade = 'A++';
    if (auditResults.criticalIssues.length > 0) {
      grade = 'C';
    } else if (auditResults.warnings.length > 5) {
      grade = 'B';
    } else if (auditResults.warnings.length > 2) {
      grade = 'A';
    } else if (auditResults.warnings.length > 0) {
      grade = 'A+';
    }

    console.log(`\n📊 OVERALL GRADE: ${grade}`);
    console.log(`   Passed: ${auditResults.passed.length}`);
    console.log(`   Warnings: ${auditResults.warnings.length}`);
    console.log(`   Critical: ${auditResults.criticalIssues.length}`);

    console.log('\n' + '='.repeat(80));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(80));

    return auditResults;

  } catch (error) {
    console.error('Audit error:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

runAudit().catch(console.error);
