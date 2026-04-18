/**
 * Trade Execution Flow Audit
 * Audits the complete trade lifecycle from signal to exit
 */

import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function auditTradeFlow() {
  console.log('='.repeat(80));
  console.log('TRADE EXECUTION FLOW AUDIT');
  console.log('='.repeat(80));

  const connection = await mysql.createConnection(DATABASE_URL);

  try {
    // 1. Check recent trade entries
    console.log('\n📊 RECENT TRADES (Last 7 Days):');
    console.log('-'.repeat(80));
    
    const [recentTrades] = await connection.execute(`
      SELECT 
        id, userId, symbol, side, status,
        CAST(entryPrice AS DECIMAL(20,8)) as entryPrice,
        CAST(exitPrice AS DECIMAL(20,8)) as exitPrice,
        CAST(quantity AS DECIMAL(20,8)) as quantity,
        CAST(pnl AS DECIMAL(20,8)) as pnl,
        CAST(confidence AS DECIMAL(10,4)) as confidence,
        exitReason,
        entryTime, exitTime,
        createdAt
      FROM trades
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY createdAt DESC
      LIMIT 10
    `);

    if (recentTrades.length === 0) {
      console.log('   No trades in last 7 days');
    } else {
      for (const trade of recentTrades) {
        console.log(`\n   Trade #${trade.id}:`);
        console.log(`     User: ${trade.userId} | Symbol: ${trade.symbol} | Side: ${trade.side}`);
        console.log(`     Status: ${trade.status} | Entry: $${trade.entryPrice?.toFixed(2) || 'N/A'} | Exit: $${trade.exitPrice?.toFixed(2) || 'N/A'}`);
        console.log(`     Qty: ${trade.quantity?.toFixed(6) || 'N/A'} | P&L: $${trade.pnl?.toFixed(2) || 'N/A'}`);
        console.log(`     Confidence: ${((trade.confidence || 0) * 100).toFixed(1)}% | Exit Reason: ${trade.exitReason || 'N/A'}`);
        console.log(`     Entry Time: ${trade.entryTime || 'N/A'} | Exit Time: ${trade.exitTime || 'N/A'}`);
      }
    }

    // 2. Check paper positions
    console.log('\n\n📊 PAPER POSITIONS:');
    console.log('-'.repeat(80));
    
    const [paperPositions] = await connection.execute(`
      SELECT 
        id, userId, symbol, side, status,
        CAST(entryPrice AS DECIMAL(20,8)) as entryPrice,
        CAST(currentPrice AS DECIMAL(20,8)) as currentPrice,
        CAST(quantity AS DECIMAL(20,8)) as quantity,
        CAST(unrealizedPnL AS DECIMAL(20,8)) as unrealizedPnL,
        CAST(realizedPnl AS DECIMAL(20,8)) as realizedPnl,
        CAST(stopLoss AS DECIMAL(20,8)) as stopLoss,
        CAST(takeProfit AS DECIMAL(20,8)) as takeProfit,
        CAST(originalConsensus AS DECIMAL(10,4)) as originalConsensus,
        CAST(currentConfidence AS DECIMAL(10,4)) as currentConfidence,
        exitReason,
        entryTime, exitTime,
        createdAt, updatedAt
      FROM paperPositions
      ORDER BY createdAt DESC
      LIMIT 20
    `);

    let openCount = 0;
    let closedCount = 0;
    
    for (const pos of paperPositions) {
      if (pos.status === 'open') openCount++;
      else closedCount++;
      
      console.log(`\n   Position #${pos.id} [${pos.status.toUpperCase()}]:`);
      console.log(`     User: ${pos.userId} | Symbol: ${pos.symbol} | Side: ${pos.side}`);
      console.log(`     Entry: $${pos.entryPrice?.toFixed(2) || 'N/A'} | Current: $${pos.currentPrice?.toFixed(2) || 'N/A'}`);
      console.log(`     Qty: ${pos.quantity?.toFixed(6) || 'N/A'}`);
      
      if (pos.status === 'open') {
        console.log(`     Unrealized P&L: $${pos.unrealizedPnL?.toFixed(2) || 'N/A'}`);
        console.log(`     Stop Loss: $${pos.stopLoss?.toFixed(2) || 'N/A'} | Take Profit: $${pos.takeProfit?.toFixed(2) || 'N/A'}`);
        console.log(`     Original Consensus: ${((pos.originalConsensus || 0) * 100).toFixed(1)}% | Current: ${((pos.currentConfidence || 0) * 100).toFixed(1)}%`);
      } else {
        console.log(`     Realized P&L: $${pos.realizedPnl?.toFixed(2) || 'N/A'}`);
        console.log(`     Exit Reason: ${pos.exitReason || 'N/A'}`);
        console.log(`     Exit Time: ${pos.exitTime || 'N/A'}`);
      }
    }

    console.log(`\n   Summary: ${openCount} open, ${closedCount} closed`);

    // 3. Check consensus history
    console.log('\n\n📊 CONSENSUS HISTORY (Last 24 Hours):');
    console.log('-'.repeat(80));
    
    const [consensusStats] = await connection.execute(`
      SELECT 
        symbol,
        COUNT(*) as recordCount,
        AVG(consensusPercentage) as avgConsensus,
        SUM(CASE WHEN finalSignal = 'BULLISH' THEN 1 ELSE 0 END) as bullish,
        SUM(CASE WHEN finalSignal = 'BEARISH' THEN 1 ELSE 0 END) as bearish,
        SUM(CASE WHEN finalSignal = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral,
        MAX(timestamp) as lastRecord
      FROM consensusHistory
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY symbol
    `);

    for (const stat of consensusStats) {
      console.log(`\n   ${stat.symbol}:`);
      console.log(`     Records: ${stat.recordCount} | Avg Consensus: ${stat.avgConsensus?.toFixed(1) || 0}%`);
      console.log(`     Bullish: ${stat.bullish} | Bearish: ${stat.bearish} | Neutral: ${stat.neutral}`);
      console.log(`     Last: ${stat.lastRecord}`);
    }

    // 4. Check trade quality
    console.log('\n\n📊 TRADE QUALITY ANALYSIS:');
    console.log('-'.repeat(80));
    
    const [tradeQuality] = await connection.execute(`
      SELECT 
        tradeQualityScore,
        COUNT(*) as count,
        AVG(CAST(pnl AS DECIMAL(20,8))) as avgPnl,
        SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as winners,
        SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) < 0 THEN 1 ELSE 0 END) as losers
      FROM trades
      WHERE status = 'closed' AND tradeQualityScore IS NOT NULL
      GROUP BY tradeQualityScore
      ORDER BY tradeQualityScore DESC
    `);

    if (tradeQuality.length === 0) {
      console.log('   No closed trades with quality scores');
    } else {
      console.log('   Quality Score | Count | Avg P&L | Winners | Losers | Win Rate');
      console.log('   ' + '-'.repeat(70));
      for (const q of tradeQuality) {
        const winRate = q.count > 0 ? ((q.winners / q.count) * 100).toFixed(1) : '0.0';
        console.log(`   ${(q.tradeQualityScore || 'N/A').padEnd(14)} | ${q.count.toString().padStart(5)} | $${(q.avgPnl || 0).toFixed(2).padStart(8)} | ${q.winners.toString().padStart(7)} | ${q.losers.toString().padStart(6)} | ${winRate}%`);
      }
    }

    // 5. Check exit reasons distribution
    console.log('\n\n📊 EXIT REASON DISTRIBUTION:');
    console.log('-'.repeat(80));
    
    const [exitReasons] = await connection.execute(`
      SELECT 
        exitReason,
        COUNT(*) as count,
        AVG(CAST(realizedPnl AS DECIMAL(20,8))) as avgPnl
      FROM paperPositions
      WHERE status = 'closed' AND exitReason IS NOT NULL
      GROUP BY exitReason
      ORDER BY count DESC
    `);

    if (exitReasons.length === 0) {
      console.log('   No closed positions with exit reasons');
    } else {
      for (const er of exitReasons) {
        console.log(`   ${er.exitReason}: ${er.count} trades, Avg P&L: $${(er.avgPnl || 0).toFixed(2)}`);
      }
    }

    // 6. Check for potential issues
    console.log('\n\n🔍 POTENTIAL ISSUES:');
    console.log('-'.repeat(80));

    // Check for positions without stop-loss
    const [noStopLoss] = await connection.execute(`
      SELECT COUNT(*) as count FROM paperPositions 
      WHERE status = 'open' AND (stopLoss IS NULL OR CAST(stopLoss AS DECIMAL(20,8)) = 0)
    `);
    if (noStopLoss[0].count > 0) {
      console.log(`   ⚠️ ${noStopLoss[0].count} open positions without stop-loss`);
    }

    // Check for stale positions (not updated in 1 hour)
    const [stalePositions] = await connection.execute(`
      SELECT COUNT(*) as count FROM paperPositions 
      WHERE status = 'open' AND updatedAt < DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);
    if (stalePositions[0].count > 0) {
      console.log(`   ⚠️ ${stalePositions[0].count} positions not updated in last hour`);
    }

    // Check for positions with zero confidence
    const [zeroConfidence] = await connection.execute(`
      SELECT COUNT(*) as count FROM paperPositions 
      WHERE status = 'open' AND (currentConfidence IS NULL OR CAST(currentConfidence AS DECIMAL(10,4)) = 0)
    `);
    if (zeroConfidence[0].count > 0) {
      console.log(`   ⚠️ ${zeroConfidence[0].count} open positions with zero/null confidence`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('TRADE FLOW AUDIT COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Audit error:', error);
  } finally {
    await connection.end();
  }
}

auditTradeFlow().catch(console.error);
