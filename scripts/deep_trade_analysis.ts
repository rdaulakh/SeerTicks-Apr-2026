/**
 * Deep Trade Analysis Script
 * Extracts all winning and losing trades with tick-by-tick price data and consensus scores
 * Purpose: Find the perfect exit formula for profitable AI trading
 */

import { drizzle } from 'drizzle-orm/mysql2';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

const db = drizzle(process.env.DATABASE_URL!);

interface TradeAnalysis {
  positionId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryTime: Date;
  exitTime: Date;
  holdDurationMs: number;
  holdDurationSeconds: number;
  exitReason: string;
  entryConsensus: number;
  exitConsensus: number;
  peakPrice: number;
  troughPrice: number;
  maxUnrealizedProfit: number;
  maxUnrealizedLoss: number;
  priceAtPeak: number;
  timeToReachPeak: number;
  missedProfitPercent: number;
  ticksAnalyzed: number;
}

async function analyzeAllTrades() {
  console.log('='.repeat(80));
  console.log('DEEP TRADE ANALYSIS - Finding the Perfect Exit Formula');
  console.log('='.repeat(80));
  console.log('');

  // Get all closed positions
  const closedPositions = await db
    .select()
    .from(schema.paperPositions)
    .where(eq(schema.paperPositions.status, 'closed'))
    .orderBy(desc(schema.paperPositions.closedAt));

  console.log(`Total Closed Positions: ${closedPositions.length}`);
  console.log('');

  const winningTrades: TradeAnalysis[] = [];
  const losingTrades: TradeAnalysis[] = [];

  for (const position of closedPositions) {
    const pnl = parseFloat(position.realizedPnl || '0');
    const entryPrice = parseFloat(position.entryPrice || '0');
    const exitPrice = parseFloat(position.exitPrice || position.entryPrice || '0');
    const quantity = parseFloat(position.quantity || '0');
    const entryTime = position.openedAt || new Date();
    const exitTime = position.closedAt || new Date();
    const holdDurationMs = exitTime.getTime() - entryTime.getTime();

    // Get tick data during the position's lifetime
    const tickData = await db
      .select()
      .from(schema.tickHistory)
      .where(
        and(
          eq(schema.tickHistory.symbol, position.symbol),
          gte(schema.tickHistory.timestamp, entryTime),
          lte(schema.tickHistory.timestamp, exitTime)
        )
      )
      .orderBy(schema.tickHistory.timestamp);

    // Get consensus data during the position's lifetime
    const consensusData = await db
      .select()
      .from(schema.consensusHistory)
      .where(
        and(
          eq(schema.consensusHistory.symbol, position.symbol),
          gte(schema.consensusHistory.timestamp, entryTime),
          lte(schema.consensusHistory.timestamp, exitTime)
        )
      )
      .orderBy(schema.consensusHistory.timestamp);

    // Calculate peak and trough prices
    let peakPrice = entryPrice;
    let troughPrice = entryPrice;
    let maxUnrealizedProfit = 0;
    let maxUnrealizedLoss = 0;
    let timeToReachPeak = 0;
    let priceAtPeak = entryPrice;

    const side = position.side?.toUpperCase();

    for (const tick of tickData) {
      const tickPrice = parseFloat(tick.price || '0');
      
      if (side === 'LONG' || side === 'BUY') {
        if (tickPrice > peakPrice) {
          peakPrice = tickPrice;
          priceAtPeak = tickPrice;
          timeToReachPeak = new Date(tick.timestamp!).getTime() - entryTime.getTime();
        }
        if (tickPrice < troughPrice) {
          troughPrice = tickPrice;
        }
        const unrealizedProfit = (tickPrice - entryPrice) * quantity;
        const unrealizedLoss = (entryPrice - tickPrice) * quantity;
        if (unrealizedProfit > maxUnrealizedProfit) maxUnrealizedProfit = unrealizedProfit;
        if (unrealizedLoss > maxUnrealizedLoss) maxUnrealizedLoss = unrealizedLoss;
      } else {
        // SHORT position
        if (tickPrice < peakPrice) {
          peakPrice = tickPrice;
          priceAtPeak = tickPrice;
          timeToReachPeak = new Date(tick.timestamp!).getTime() - entryTime.getTime();
        }
        if (tickPrice > troughPrice) {
          troughPrice = tickPrice;
        }
        const unrealizedProfit = (entryPrice - tickPrice) * quantity;
        const unrealizedLoss = (tickPrice - entryPrice) * quantity;
        if (unrealizedProfit > maxUnrealizedProfit) maxUnrealizedProfit = unrealizedProfit;
        if (unrealizedLoss > maxUnrealizedLoss) maxUnrealizedLoss = unrealizedLoss;
      }
    }

    // Get entry and exit consensus
    const entryConsensus = consensusData.length > 0 
      ? parseFloat(consensusData[0].consensusScore || '0') 
      : 0;
    const exitConsensus = consensusData.length > 0 
      ? parseFloat(consensusData[consensusData.length - 1].consensusScore || '0') 
      : 0;

    // Calculate missed profit
    const actualProfit = pnl;
    const potentialProfit = side === 'LONG' || side === 'BUY'
      ? (peakPrice - entryPrice) * quantity
      : (entryPrice - peakPrice) * quantity;
    const missedProfit = potentialProfit - actualProfit;
    const missedProfitPercent = potentialProfit > 0 ? (missedProfit / potentialProfit) * 100 : 0;

    const analysis: TradeAnalysis = {
      positionId: position.id,
      symbol: position.symbol,
      side: position.side || 'UNKNOWN',
      entryPrice,
      exitPrice,
      quantity,
      pnl,
      pnlPercent: entryPrice > 0 ? (pnl / (entryPrice * quantity)) * 100 : 0,
      entryTime,
      exitTime,
      holdDurationMs,
      holdDurationSeconds: holdDurationMs / 1000,
      exitReason: position.exitReason || 'UNKNOWN',
      entryConsensus,
      exitConsensus,
      peakPrice,
      troughPrice,
      maxUnrealizedProfit,
      maxUnrealizedLoss,
      priceAtPeak,
      timeToReachPeak,
      missedProfitPercent,
      ticksAnalyzed: tickData.length,
    };

    if (pnl >= 0) {
      winningTrades.push(analysis);
    } else {
      losingTrades.push(analysis);
    }
  }

  // Output Analysis
  console.log('='.repeat(80));
  console.log('WINNING TRADES ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Total Winning Trades: ${winningTrades.length}`);
  console.log('');

  for (const trade of winningTrades) {
    console.log(`--- Position #${trade.positionId} (${trade.symbol}) ---`);
    console.log(`Side: ${trade.side}`);
    console.log(`Entry: $${trade.entryPrice.toFixed(2)} at ${trade.entryTime.toISOString()}`);
    console.log(`Exit: $${trade.exitPrice.toFixed(2)} at ${trade.exitTime.toISOString()}`);
    console.log(`P&L: $${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(4)}%)`);
    console.log(`Hold Duration: ${trade.holdDurationSeconds.toFixed(2)}s (${trade.holdDurationMs}ms)`);
    console.log(`Exit Reason: ${trade.exitReason}`);
    console.log(`Entry Consensus: ${(trade.entryConsensus * 100).toFixed(1)}%`);
    console.log(`Exit Consensus: ${(trade.exitConsensus * 100).toFixed(1)}%`);
    console.log(`Peak Price: $${trade.peakPrice.toFixed(2)} (reached in ${trade.timeToReachPeak}ms)`);
    console.log(`Max Unrealized Profit: $${trade.maxUnrealizedProfit.toFixed(2)}`);
    console.log(`Missed Profit: ${trade.missedProfitPercent.toFixed(1)}%`);
    console.log(`Ticks Analyzed: ${trade.ticksAnalyzed}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('LOSING TRADES ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Total Losing Trades: ${losingTrades.length}`);
  console.log('');

  for (const trade of losingTrades) {
    console.log(`--- Position #${trade.positionId} (${trade.symbol}) ---`);
    console.log(`Side: ${trade.side}`);
    console.log(`Entry: $${trade.entryPrice.toFixed(2)} at ${trade.entryTime.toISOString()}`);
    console.log(`Exit: $${trade.exitPrice.toFixed(2)} at ${trade.exitTime.toISOString()}`);
    console.log(`P&L: $${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(4)}%)`);
    console.log(`Hold Duration: ${trade.holdDurationSeconds.toFixed(2)}s (${trade.holdDurationMs}ms)`);
    console.log(`Exit Reason: ${trade.exitReason}`);
    console.log(`Entry Consensus: ${(trade.entryConsensus * 100).toFixed(1)}%`);
    console.log(`Exit Consensus: ${(trade.exitConsensus * 100).toFixed(1)}%`);
    console.log(`Peak Price: $${trade.peakPrice.toFixed(2)} (reached in ${trade.timeToReachPeak}ms)`);
    console.log(`Max Unrealized Profit: $${trade.maxUnrealizedProfit.toFixed(2)}`);
    console.log(`Max Unrealized Loss: $${trade.maxUnrealizedLoss.toFixed(2)}`);
    console.log(`Ticks Analyzed: ${trade.ticksAnalyzed}`);
    console.log('');
  }

  // Statistical Summary
  console.log('='.repeat(80));
  console.log('STATISTICAL SUMMARY');
  console.log('='.repeat(80));
  
  const avgWinHoldTime = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.holdDurationSeconds, 0) / winningTrades.length 
    : 0;
  const avgLossHoldTime = losingTrades.length > 0 
    ? losingTrades.reduce((sum, t) => sum + t.holdDurationSeconds, 0) / losingTrades.length 
    : 0;
  const avgWinEntryConsensus = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.entryConsensus, 0) / winningTrades.length 
    : 0;
  const avgLossEntryConsensus = losingTrades.length > 0 
    ? losingTrades.reduce((sum, t) => sum + t.entryConsensus, 0) / losingTrades.length 
    : 0;
  const avgWinExitConsensus = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.exitConsensus, 0) / winningTrades.length 
    : 0;
  const avgLossExitConsensus = losingTrades.length > 0 
    ? losingTrades.reduce((sum, t) => sum + t.exitConsensus, 0) / losingTrades.length 
    : 0;
  const avgMissedProfit = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.missedProfitPercent, 0) / losingTrades.length
    : 0;

  console.log('');
  console.log('WINNING TRADES:');
  console.log(`  Average Hold Time: ${avgWinHoldTime.toFixed(2)}s`);
  console.log(`  Average Entry Consensus: ${(avgWinEntryConsensus * 100).toFixed(1)}%`);
  console.log(`  Average Exit Consensus: ${(avgWinExitConsensus * 100).toFixed(1)}%`);
  console.log(`  Total Profit: $${winningTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)}`);
  console.log('');
  console.log('LOSING TRADES:');
  console.log(`  Average Hold Time: ${avgLossHoldTime.toFixed(2)}s`);
  console.log(`  Average Entry Consensus: ${(avgLossEntryConsensus * 100).toFixed(1)}%`);
  console.log(`  Average Exit Consensus: ${(avgLossExitConsensus * 100).toFixed(1)}%`);
  console.log(`  Average Missed Profit: ${avgMissedProfit.toFixed(1)}%`);
  console.log(`  Total Loss: $${losingTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)}`);
  console.log('');

  // Exit Reason Analysis
  console.log('='.repeat(80));
  console.log('EXIT REASON ANALYSIS');
  console.log('='.repeat(80));
  
  const exitReasons: Record<string, { wins: number; losses: number; totalPnl: number }> = {};
  
  for (const trade of [...winningTrades, ...losingTrades]) {
    const reason = trade.exitReason || 'UNKNOWN';
    if (!exitReasons[reason]) {
      exitReasons[reason] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    if (trade.pnl >= 0) {
      exitReasons[reason].wins++;
    } else {
      exitReasons[reason].losses++;
    }
    exitReasons[reason].totalPnl += trade.pnl;
  }

  console.log('');
  for (const [reason, stats] of Object.entries(exitReasons)) {
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? (stats.wins / total) * 100 : 0;
    console.log(`${reason}:`);
    console.log(`  Total: ${total} trades (${stats.wins} wins, ${stats.losses} losses)`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total P&L: $${stats.totalPnl.toFixed(2)}`);
    console.log('');
  }

  // Return data for further analysis
  return {
    winningTrades,
    losingTrades,
    exitReasons,
    summary: {
      totalTrades: closedPositions.length,
      winCount: winningTrades.length,
      lossCount: losingTrades.length,
      winRate: closedPositions.length > 0 ? (winningTrades.length / closedPositions.length) * 100 : 0,
      avgWinHoldTime,
      avgLossHoldTime,
      avgWinEntryConsensus,
      avgLossEntryConsensus,
      avgWinExitConsensus,
      avgLossExitConsensus,
      totalProfit: winningTrades.reduce((sum, t) => sum + t.pnl, 0),
      totalLoss: losingTrades.reduce((sum, t) => sum + t.pnl, 0),
    }
  };
}

// Run the analysis
analyzeAllTrades()
  .then((results) => {
    console.log('='.repeat(80));
    console.log('Analysis Complete');
    console.log('='.repeat(80));
    process.exit(0);
  })
  .catch((error) => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
