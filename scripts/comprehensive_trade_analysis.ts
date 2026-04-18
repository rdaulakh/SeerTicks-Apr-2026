/**
 * Comprehensive Trade Analysis Script
 * Analyzes all winning and losing trades with tick-by-tick data
 * to discover the optimal exit formula
 */

import { drizzle } from "drizzle-orm/mysql2";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import * as fs from "fs";

const db = drizzle(process.env.DATABASE_URL!);

interface TradeAnalysis {
  id: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  priceChangePercent: number;
  entryConsensus: number;
  peakConfidence: number;
  exitConfidence: number;
  holdSeconds: number;
  exitReason: string;
  outcome: "WIN" | "LOSS";
}

async function analyzeAllTrades() {
  console.log("=== COMPREHENSIVE TRADE ANALYSIS ===\n");
  
  // Get all closed positions with full details
  const positions = await db.execute(sql`
    SELECT 
      id, symbol, side, entryPrice, currentPrice as exitPrice,
      CAST(realizedPnl AS DECIMAL(20,8)) as pnl,
      ROUND((CAST(currentPrice AS DECIMAL(20,8)) - CAST(entryPrice AS DECIMAL(20,8))) / CAST(entryPrice AS DECIMAL(20,8)) * 100, 4) as priceChangePercent,
      originalConsensus as entryConsensus,
      peakConfidence,
      currentConfidence as exitConfidence,
      exitReason,
      TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds,
      entryTime,
      exitTime
    FROM paperPositions 
    WHERE status = 'closed' AND exitTime IS NOT NULL
    ORDER BY id DESC
  `);

  const trades: TradeAnalysis[] = (positions[0] as any[]).map((p: any) => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entryPrice: parseFloat(p.entryPrice),
    exitPrice: parseFloat(p.exitPrice),
    pnl: parseFloat(p.pnl),
    priceChangePercent: parseFloat(p.priceChangePercent),
    entryConsensus: parseFloat(p.entryConsensus || 0),
    peakConfidence: parseFloat(p.peakConfidence || 0),
    exitConfidence: parseFloat(p.exitConfidence || 0),
    holdSeconds: parseInt(p.holdSeconds || 0),
    exitReason: p.exitReason || "unknown",
    outcome: parseFloat(p.pnl) >= 0 ? "WIN" : "LOSS"
  }));

  const wins = trades.filter(t => t.outcome === "WIN");
  const losses = trades.filter(t => t.outcome === "LOSS");

  console.log(`Total Trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${(wins.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${(losses.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`Total P&L: $${trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)}`);

  // Analyze winning trades
  console.log("\n=== WINNING TRADES ANALYSIS ===\n");
  if (wins.length > 0) {
    const avgWinPnl = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;
    const avgWinHoldTime = wins.reduce((sum, t) => sum + t.holdSeconds, 0) / wins.length;
    const avgWinPriceChange = wins.reduce((sum, t) => sum + t.priceChangePercent, 0) / wins.length;
    const avgWinEntryConsensus = wins.reduce((sum, t) => sum + t.entryConsensus, 0) / wins.length;
    const avgWinPeakConfidence = wins.reduce((sum, t) => sum + t.peakConfidence, 0) / wins.length;
    const avgWinExitConfidence = wins.reduce((sum, t) => sum + t.exitConfidence, 0) / wins.length;

    console.log(`Average Win P&L: $${avgWinPnl.toFixed(2)}`);
    console.log(`Average Hold Time: ${avgWinHoldTime.toFixed(1)} seconds`);
    console.log(`Average Price Change: ${avgWinPriceChange.toFixed(4)}%`);
    console.log(`Average Entry Consensus: ${(avgWinEntryConsensus * 100).toFixed(1)}%`);
    console.log(`Average Peak Confidence: ${(avgWinPeakConfidence * 100).toFixed(1)}%`);
    console.log(`Average Exit Confidence: ${(avgWinExitConfidence * 100).toFixed(1)}%`);
    console.log(`Confidence Drop (Peak to Exit): ${((avgWinPeakConfidence - avgWinExitConfidence) * 100).toFixed(1)}%`);

    console.log("\nTop 5 Winning Trades:");
    wins.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.symbol} ${t.side}: $${t.pnl.toFixed(2)} (${t.priceChangePercent.toFixed(4)}%) held ${t.holdSeconds}s - ${t.exitReason}`);
    });
  }

  // Analyze losing trades
  console.log("\n=== LOSING TRADES ANALYSIS ===\n");
  if (losses.length > 0) {
    const avgLossPnl = losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length;
    const avgLossHoldTime = losses.reduce((sum, t) => sum + t.holdSeconds, 0) / losses.length;
    const avgLossPriceChange = losses.reduce((sum, t) => sum + t.priceChangePercent, 0) / losses.length;
    const avgLossEntryConsensus = losses.reduce((sum, t) => sum + t.entryConsensus, 0) / losses.length;
    const avgLossPeakConfidence = losses.reduce((sum, t) => sum + t.peakConfidence, 0) / losses.length;
    const avgLossExitConfidence = losses.reduce((sum, t) => sum + t.exitConfidence, 0) / losses.length;

    console.log(`Average Loss P&L: $${avgLossPnl.toFixed(2)}`);
    console.log(`Average Hold Time: ${avgLossHoldTime.toFixed(1)} seconds`);
    console.log(`Average Price Change: ${avgLossPriceChange.toFixed(4)}%`);
    console.log(`Average Entry Consensus: ${(avgLossEntryConsensus * 100).toFixed(1)}%`);
    console.log(`Average Peak Confidence: ${(avgLossPeakConfidence * 100).toFixed(1)}%`);
    console.log(`Average Exit Confidence: ${(avgLossExitConfidence * 100).toFixed(1)}%`);
    console.log(`Confidence Drop (Peak to Exit): ${((avgLossPeakConfidence - avgLossExitConfidence) * 100).toFixed(1)}%`);

    console.log("\nTop 5 Worst Losing Trades:");
    losses.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.symbol} ${t.side}: $${t.pnl.toFixed(2)} (${t.priceChangePercent.toFixed(4)}%) held ${t.holdSeconds}s - ${t.exitReason}`);
    });
  }

  // Hold time distribution analysis
  console.log("\n=== HOLD TIME DISTRIBUTION ===\n");
  const holdTimeRanges = [
    { label: "0-5s", min: 0, max: 5 },
    { label: "5-30s", min: 5, max: 30 },
    { label: "30-60s", min: 30, max: 60 },
    { label: "1-5min", min: 60, max: 300 },
    { label: "5-15min", min: 300, max: 900 },
    { label: "15min+", min: 900, max: Infinity }
  ];

  holdTimeRanges.forEach(range => {
    const inRange = trades.filter(t => t.holdSeconds >= range.min && t.holdSeconds < range.max);
    const winsInRange = inRange.filter(t => t.outcome === "WIN");
    const winRate = inRange.length > 0 ? (winsInRange.length / inRange.length * 100) : 0;
    const totalPnl = inRange.reduce((sum, t) => sum + t.pnl, 0);
    console.log(`${range.label.padEnd(10)}: ${inRange.length} trades, ${winsInRange.length} wins (${winRate.toFixed(1)}%), P&L: $${totalPnl.toFixed(2)}`);
  });

  // Exit reason analysis
  console.log("\n=== EXIT REASON ANALYSIS ===\n");
  const exitReasons = new Map<string, { count: number; wins: number; totalPnl: number; avgHoldTime: number }>();
  
  trades.forEach(t => {
    // Simplify exit reason to category
    let category = "Other";
    if (t.exitReason.includes("decay")) category = "Confidence Decay";
    else if (t.exitReason.includes("stop") || t.exitReason.includes("Stop")) category = "Stop Loss";
    else if (t.exitReason.includes("profit") || t.exitReason.includes("Profit")) category = "Take Profit";
    else if (t.exitReason.includes("trailing") || t.exitReason.includes("Trailing")) category = "Trailing Stop";
    else if (t.exitReason.includes("time") || t.exitReason.includes("Time")) category = "Time-based";
    else if (t.exitReason.includes("reversal") || t.exitReason.includes("Reversal")) category = "Reversal Signal";
    
    const existing = exitReasons.get(category) || { count: 0, wins: 0, totalPnl: 0, avgHoldTime: 0 };
    existing.count++;
    if (t.outcome === "WIN") existing.wins++;
    existing.totalPnl += t.pnl;
    existing.avgHoldTime = (existing.avgHoldTime * (existing.count - 1) + t.holdSeconds) / existing.count;
    exitReasons.set(category, existing);
  });

  exitReasons.forEach((stats, reason) => {
    const winRate = (stats.wins / stats.count * 100).toFixed(1);
    console.log(`${reason.padEnd(20)}: ${stats.count} trades, ${stats.wins} wins (${winRate}%), P&L: $${stats.totalPnl.toFixed(2)}, Avg Hold: ${stats.avgHoldTime.toFixed(1)}s`);
  });

  // Key findings
  console.log("\n=== KEY FINDINGS ===\n");
  
  // 1. Optimal hold time
  const profitableHoldTimes = holdTimeRanges.map(range => {
    const inRange = trades.filter(t => t.holdSeconds >= range.min && t.holdSeconds < range.max);
    const totalPnl = inRange.reduce((sum, t) => sum + t.pnl, 0);
    return { label: range.label, pnl: totalPnl, count: inRange.length };
  }).filter(r => r.count > 0);
  
  const bestHoldTime = profitableHoldTimes.reduce((best, current) => 
    current.pnl > best.pnl ? current : best
  );
  console.log(`1. Best Hold Time Range: ${bestHoldTime.label} (P&L: $${bestHoldTime.pnl.toFixed(2)})`);

  // 2. Confidence drop analysis
  const avgConfidenceDropWins = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.peakConfidence - t.exitConfidence), 0) / wins.length : 0;
  const avgConfidenceDropLosses = losses.length > 0 ? losses.reduce((sum, t) => sum + (t.peakConfidence - t.exitConfidence), 0) / losses.length : 0;
  console.log(`2. Avg Confidence Drop - Wins: ${(avgConfidenceDropWins * 100).toFixed(1)}%, Losses: ${(avgConfidenceDropLosses * 100).toFixed(1)}%`);

  // 3. Price change at exit
  const avgPriceChangeWins = wins.length > 0 ? wins.reduce((sum, t) => sum + Math.abs(t.priceChangePercent), 0) / wins.length : 0;
  const avgPriceChangeLosses = losses.length > 0 ? losses.reduce((sum, t) => sum + Math.abs(t.priceChangePercent), 0) / losses.length : 0;
  console.log(`3. Avg Price Change - Wins: ${avgPriceChangeWins.toFixed(4)}%, Losses: ${avgPriceChangeLosses.toFixed(4)}%`);

  // Save detailed analysis to file
  const analysisReport = {
    summary: {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / trades.length * 100).toFixed(1),
      totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)
    },
    winningTradesAnalysis: {
      avgPnl: wins.length > 0 ? (wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length).toFixed(2) : 0,
      avgHoldTime: wins.length > 0 ? (wins.reduce((sum, t) => sum + t.holdSeconds, 0) / wins.length).toFixed(1) : 0,
      avgPriceChange: wins.length > 0 ? (wins.reduce((sum, t) => sum + t.priceChangePercent, 0) / wins.length).toFixed(4) : 0,
      avgEntryConsensus: wins.length > 0 ? ((wins.reduce((sum, t) => sum + t.entryConsensus, 0) / wins.length) * 100).toFixed(1) : 0,
      avgConfidenceDrop: wins.length > 0 ? ((wins.reduce((sum, t) => sum + (t.peakConfidence - t.exitConfidence), 0) / wins.length) * 100).toFixed(1) : 0
    },
    losingTradesAnalysis: {
      avgPnl: losses.length > 0 ? (losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length).toFixed(2) : 0,
      avgHoldTime: losses.length > 0 ? (losses.reduce((sum, t) => sum + t.holdSeconds, 0) / losses.length).toFixed(1) : 0,
      avgPriceChange: losses.length > 0 ? (losses.reduce((sum, t) => sum + t.priceChangePercent, 0) / losses.length).toFixed(4) : 0,
      avgEntryConsensus: losses.length > 0 ? ((losses.reduce((sum, t) => sum + t.entryConsensus, 0) / losses.length) * 100).toFixed(1) : 0,
      avgConfidenceDrop: losses.length > 0 ? ((losses.reduce((sum, t) => sum + (t.peakConfidence - t.exitConfidence), 0) / losses.length) * 100).toFixed(1) : 0
    },
    holdTimeDistribution: profitableHoldTimes,
    exitReasonAnalysis: Array.from(exitReasons.entries()).map(([reason, stats]) => ({
      reason,
      count: stats.count,
      wins: stats.wins,
      winRate: (stats.wins / stats.count * 100).toFixed(1),
      totalPnl: stats.totalPnl.toFixed(2),
      avgHoldTime: stats.avgHoldTime.toFixed(1)
    })),
    allTrades: trades
  };

  fs.writeFileSync("/tmp/trade_analysis_report.json", JSON.stringify(analysisReport, null, 2));
  console.log("\nDetailed analysis saved to /tmp/trade_analysis_report.json");

  process.exit(0);
}

analyzeAllTrades().catch(console.error);
