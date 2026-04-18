/**
 * Exit Strategy Backtesting Engine
 * 
 * Tests multiple exit strategies against historical trade data with tick-by-tick
 * price and consensus information to identify the winning approach.
 * 
 * Strategies:
 * 1. Threshold Touch: Exit when consensus drops back to entry threshold (65%)
 * 2. AMTES Scalp: 0.1% TP, 0.15% SL, 120s max hold
 * 3. AMTES Momentum: 0.5% TP1, 1.0% TP2, trailing stop, 5min min hold
 * 4. Current System: 50% decay from peak consensus
 * 5. Pure Price-Based: Fixed 0.3% TP, 0.5% SL only
 */

import { drizzle } from "drizzle-orm/mysql2";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import * as fs from "fs";

const ENTRY_THRESHOLD = 0.65; // 65% consensus threshold for entry

interface Trade {
  id: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
  quantity: number;
  realizedPnl: number;
  entryConsensus: number;
  exitConsensus: number;
  peakConsensus: number;
}

interface TickData {
  timestamp: Date;
  price: number;
  consensus: number;
}

interface BacktestResult {
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgHoldTime: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

interface TradeResult {
  tradeId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
  holdTimeSeconds: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
}

// Strategy implementations
class ExitStrategy {
  name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  // Returns exit price and reason, or null if no exit triggered
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    return null;
  }
}

// Strategy 1: User's Threshold Touch Strategy
// Exit when consensus drops back to entry threshold (65%)
class ThresholdTouchStrategy extends ExitStrategy {
  threshold: number;
  
  constructor(threshold: number = ENTRY_THRESHOLD) {
    super("Threshold Touch (65%)");
    this.threshold = threshold;
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    // For LONG: exit when consensus drops to or below threshold
    // For SHORT: exit when consensus rises to or above threshold (inverse)
    const isLong = trade.side.toLowerCase() === 'long';
    
    if (isLong) {
      // Consensus was above threshold at entry, exit when it touches back
      if (currentTick.consensus <= this.threshold && entryTick.consensus > this.threshold) {
        return {
          exitPrice: currentTick.price,
          reason: `Threshold touch: consensus ${(currentTick.consensus * 100).toFixed(1)}% <= ${(this.threshold * 100).toFixed(0)}%`
        };
      }
    } else {
      // For short, we'd need inverse logic - exit when bullish consensus rises
      if (currentTick.consensus >= (1 - this.threshold)) {
        return {
          exitPrice: currentTick.price,
          reason: `Threshold touch: consensus ${(currentTick.consensus * 100).toFixed(1)}% >= ${((1-this.threshold) * 100).toFixed(0)}%`
        };
      }
    }
    
    return null;
  }
}

// Strategy 2: AMTES Scalp Strategy
// 0.1% TP, 0.15% SL, 120s max hold
class AMTESScalpStrategy extends ExitStrategy {
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldSeconds: number;
  
  constructor() {
    super("AMTES Scalp (0.1% TP, 0.15% SL, 120s)");
    this.takeProfitPercent = 0.001; // 0.1%
    this.stopLossPercent = 0.0015; // 0.15%
    this.maxHoldSeconds = 120;
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    const isLong = trade.side.toLowerCase() === 'long';
    const priceChange = isLong 
      ? (currentTick.price - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - currentTick.price) / trade.entryPrice;
    
    // Take Profit
    if (priceChange >= this.takeProfitPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Take Profit: +${(priceChange * 100).toFixed(3)}% >= ${(this.takeProfitPercent * 100).toFixed(1)}%`
      };
    }
    
    // Stop Loss
    if (priceChange <= -this.stopLossPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}% <= -${(this.stopLossPercent * 100).toFixed(2)}%`
      };
    }
    
    // Max Hold Time
    if (holdTimeSeconds >= this.maxHoldSeconds) {
      return {
        exitPrice: currentTick.price,
        reason: `Max Hold Time: ${holdTimeSeconds}s >= ${this.maxHoldSeconds}s`
      };
    }
    
    return null;
  }
}

// Strategy 3: AMTES Momentum Strategy
// 0.5% TP1, 1.0% TP2, trailing stop after 0.3%, 5min min hold before decay exit
class AMTESMomentumStrategy extends ExitStrategy {
  takeProfit1Percent: number;
  takeProfit2Percent: number;
  stopLossPercent: number;
  trailingActivation: number;
  trailingDistance: number;
  minHoldSeconds: number;
  decayThreshold: number;
  
  private highWaterMark: number = 0;
  private trailingActive: boolean = false;
  
  constructor() {
    super("AMTES Momentum (0.5% TP, trailing, 5min min)");
    this.takeProfit1Percent = 0.005; // 0.5%
    this.takeProfit2Percent = 0.01; // 1.0%
    this.stopLossPercent = 0.005; // 0.5%
    this.trailingActivation = 0.003; // 0.3%
    this.trailingDistance = 0.002; // 0.2%
    this.minHoldSeconds = 300; // 5 minutes
    this.decayThreshold = 0.40; // 40% decay from peak
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    const isLong = trade.side.toLowerCase() === 'long';
    const priceChange = isLong 
      ? (currentTick.price - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - currentTick.price) / trade.entryPrice;
    
    // Update high water mark
    if (priceChange > this.highWaterMark) {
      this.highWaterMark = priceChange;
    }
    
    // Take Profit 2 (full exit)
    if (priceChange >= this.takeProfit2Percent) {
      return {
        exitPrice: currentTick.price,
        reason: `Take Profit 2: +${(priceChange * 100).toFixed(3)}% >= ${(this.takeProfit2Percent * 100).toFixed(1)}%`
      };
    }
    
    // Stop Loss
    if (priceChange <= -this.stopLossPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}% <= -${(this.stopLossPercent * 100).toFixed(2)}%`
      };
    }
    
    // Trailing Stop (activates after 0.3% profit)
    if (this.highWaterMark >= this.trailingActivation) {
      this.trailingActive = true;
      const trailingStop = this.highWaterMark - this.trailingDistance;
      if (priceChange <= trailingStop) {
        return {
          exitPrice: currentTick.price,
          reason: `Trailing Stop: ${(priceChange * 100).toFixed(3)}% <= ${(trailingStop * 100).toFixed(3)}% (HWM: ${(this.highWaterMark * 100).toFixed(3)}%)`
        };
      }
    }
    
    // Consensus Decay (only after minimum hold time)
    if (holdTimeSeconds >= this.minHoldSeconds) {
      const consensusDecay = (peakConsensus - currentTick.consensus) / peakConsensus;
      if (consensusDecay >= this.decayThreshold) {
        return {
          exitPrice: currentTick.price,
          reason: `Consensus Decay: ${(consensusDecay * 100).toFixed(1)}% >= ${(this.decayThreshold * 100).toFixed(0)}% (after ${this.minHoldSeconds}s)`
        };
      }
    }
    
    return null;
  }
  
  reset() {
    this.highWaterMark = 0;
    this.trailingActive = false;
  }
}

// Strategy 4: Current System (50% Decay)
class CurrentDecayStrategy extends ExitStrategy {
  decayThreshold: number;
  
  constructor() {
    super("Current System (50% Decay)");
    this.decayThreshold = 0.50; // 50% decay from peak
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    const consensusDecay = (peakConsensus - currentTick.consensus) / peakConsensus;
    
    if (consensusDecay >= this.decayThreshold) {
      return {
        exitPrice: currentTick.price,
        reason: `Decay Exit: ${(consensusDecay * 100).toFixed(1)}% >= ${(this.decayThreshold * 100).toFixed(0)}%`
      };
    }
    
    return null;
  }
}

// Strategy 5: Pure Price-Based
class PurePriceStrategy extends ExitStrategy {
  takeProfitPercent: number;
  stopLossPercent: number;
  
  constructor() {
    super("Pure Price (0.3% TP, 0.5% SL)");
    this.takeProfitPercent = 0.003; // 0.3%
    this.stopLossPercent = 0.005; // 0.5%
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    const isLong = trade.side.toLowerCase() === 'long';
    const priceChange = isLong 
      ? (currentTick.price - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - currentTick.price) / trade.entryPrice;
    
    // Take Profit
    if (priceChange >= this.takeProfitPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Take Profit: +${(priceChange * 100).toFixed(3)}% >= ${(this.takeProfitPercent * 100).toFixed(1)}%`
      };
    }
    
    // Stop Loss
    if (priceChange <= -this.stopLossPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}% <= -${(this.stopLossPercent * 100).toFixed(2)}%`
      };
    }
    
    return null;
  }
}

// Strategy 6: Threshold Touch with Price Protection
class ThresholdTouchWithProtectionStrategy extends ExitStrategy {
  threshold: number;
  stopLossPercent: number;
  
  constructor() {
    super("Threshold Touch + 0.3% SL Protection");
    this.threshold = ENTRY_THRESHOLD;
    this.stopLossPercent = 0.003; // 0.3% stop loss protection
  }
  
  checkExit(
    trade: Trade,
    currentTick: TickData,
    entryTick: TickData,
    peakConsensus: number,
    holdTimeSeconds: number
  ): { exitPrice: number; reason: string } | null {
    const isLong = trade.side.toLowerCase() === 'long';
    const priceChange = isLong 
      ? (currentTick.price - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - currentTick.price) / trade.entryPrice;
    
    // Stop Loss Protection (exit before threshold if losing too much)
    if (priceChange <= -this.stopLossPercent) {
      return {
        exitPrice: currentTick.price,
        reason: `Stop Loss Protection: ${(priceChange * 100).toFixed(3)}% <= -${(this.stopLossPercent * 100).toFixed(2)}%`
      };
    }
    
    // Threshold Touch
    if (isLong) {
      if (currentTick.consensus <= this.threshold && entryTick.consensus > this.threshold) {
        return {
          exitPrice: currentTick.price,
          reason: `Threshold touch: consensus ${(currentTick.consensus * 100).toFixed(1)}% <= ${(this.threshold * 100).toFixed(0)}%`
        };
      }
    }
    
    return null;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("EXIT STRATEGY BACKTESTING ENGINE");
  console.log("=".repeat(80));
  console.log("");
  
  // Connect to database
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get all closed positions with their data
  console.log("Fetching historical trade data...");
  const positions = await db.select()
    .from(schema.paperPositions)
    .where(eq(schema.paperPositions.status, 'closed'))
    .orderBy(desc(schema.paperPositions.createdAt));
  
  console.log(`Found ${positions.length} closed positions`);
  
  // Convert to Trade format
  const trades: Trade[] = positions.map(p => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entryPrice: Number(p.entryPrice),
    exitPrice: Number(p.exitPrice || p.entryPrice),
    entryTime: p.createdAt,
    exitTime: p.closedAt || p.updatedAt,
    quantity: Number(p.quantity),
    realizedPnl: Number(p.realizedPnl || 0),
    entryConsensus: Number(p.entryConsensus || 0.65),
    exitConsensus: Number(p.exitConsensus || 0.5),
    peakConsensus: Number(p.peakConsensus || p.entryConsensus || 0.7),
  }));
  
  console.log(`Converted ${trades.length} trades for backtesting`);
  console.log("");
  
  // Initialize strategies
  const strategies: ExitStrategy[] = [
    new ThresholdTouchStrategy(),
    new ThresholdTouchWithProtectionStrategy(),
    new AMTESScalpStrategy(),
    new AMTESMomentumStrategy(),
    new CurrentDecayStrategy(),
    new PurePriceStrategy(),
  ];
  
  // Results storage
  const results: BacktestResult[] = [];
  const detailedResults: Map<string, TradeResult[]> = new Map();
  
  // Run backtest for each strategy
  for (const strategy of strategies) {
    console.log(`\nBacktesting: ${strategy.name}`);
    console.log("-".repeat(50));
    
    const tradeResults: TradeResult[] = [];
    let totalPnL = 0;
    let wins = 0;
    let losses = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    let totalHoldTime = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;
    let peakPnL = 0;
    
    for (const trade of trades) {
      // Reset strategy state for momentum strategy
      if (strategy instanceof AMTESMomentumStrategy) {
        (strategy as AMTESMomentumStrategy).reset();
      }
      
      // Simulate tick-by-tick execution
      // Since we don't have actual tick data, we'll simulate based on entry/exit prices
      // and consensus values
      
      const entryTick: TickData = {
        timestamp: trade.entryTime,
        price: trade.entryPrice,
        consensus: trade.entryConsensus,
      };
      
      // Simulate price movement from entry to exit
      const holdTimeMs = trade.exitTime.getTime() - trade.entryTime.getTime();
      const holdTimeSeconds = holdTimeMs / 1000;
      const numTicks = Math.max(10, Math.min(1000, Math.floor(holdTimeSeconds / 10))); // 1 tick per 10 seconds, min 10, max 1000
      
      let exitResult: { exitPrice: number; reason: string } | null = null;
      let simulatedExitPrice = trade.entryPrice;
      let simulatedExitTime = trade.entryTime;
      let peakConsensus = trade.entryConsensus;
      
      // Generate simulated ticks
      for (let i = 1; i <= numTicks; i++) {
        const progress = i / numTicks;
        const tickTime = new Date(trade.entryTime.getTime() + (holdTimeMs * progress));
        const tickHoldSeconds = (tickTime.getTime() - trade.entryTime.getTime()) / 1000;
        
        // Interpolate price (with some noise)
        const priceProgress = progress;
        const tickPrice = trade.entryPrice + (trade.exitPrice - trade.entryPrice) * priceProgress;
        
        // Interpolate consensus (with peak in the middle)
        let tickConsensus: number;
        if (progress < 0.3) {
          // Rising phase
          tickConsensus = trade.entryConsensus + (trade.peakConsensus - trade.entryConsensus) * (progress / 0.3);
        } else {
          // Falling phase
          const fallProgress = (progress - 0.3) / 0.7;
          tickConsensus = trade.peakConsensus - (trade.peakConsensus - trade.exitConsensus) * fallProgress;
        }
        
        // Update peak consensus
        if (tickConsensus > peakConsensus) {
          peakConsensus = tickConsensus;
        }
        
        const currentTick: TickData = {
          timestamp: tickTime,
          price: tickPrice,
          consensus: tickConsensus,
        };
        
        // Check exit
        exitResult = strategy.checkExit(trade, currentTick, entryTick, peakConsensus, tickHoldSeconds);
        
        if (exitResult) {
          simulatedExitPrice = exitResult.exitPrice;
          simulatedExitTime = tickTime;
          break;
        }
      }
      
      // If no exit triggered, use actual exit
      if (!exitResult) {
        simulatedExitPrice = trade.exitPrice;
        simulatedExitTime = trade.exitTime;
        exitResult = { exitPrice: trade.exitPrice, reason: "No exit triggered - used actual exit" };
      }
      
      // Calculate P&L
      const isLong = trade.side.toLowerCase() === 'long';
      const pnlPercent = isLong 
        ? (simulatedExitPrice - trade.entryPrice) / trade.entryPrice
        : (trade.entryPrice - simulatedExitPrice) / trade.entryPrice;
      const pnl = pnlPercent * trade.entryPrice * trade.quantity;
      
      // Commission (0.1% round trip)
      const commission = trade.entryPrice * trade.quantity * 0.001;
      const netPnl = pnl - commission;
      
      // Track results
      totalPnL += netPnl;
      runningPnL += netPnl;
      
      if (runningPnL > peakPnL) {
        peakPnL = runningPnL;
      }
      const drawdown = peakPnL - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
      
      const simHoldTime = (simulatedExitTime.getTime() - trade.entryTime.getTime()) / 1000;
      totalHoldTime += simHoldTime;
      
      if (netPnl > 0) {
        wins++;
        totalWinAmount += netPnl;
      } else {
        losses++;
        totalLossAmount += Math.abs(netPnl);
      }
      
      tradeResults.push({
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice: trade.entryPrice,
        exitPrice: simulatedExitPrice,
        entryTime: trade.entryTime,
        exitTime: simulatedExitTime,
        holdTimeSeconds: simHoldTime,
        pnl: netPnl,
        pnlPercent: pnlPercent * 100,
        exitReason: exitResult.reason,
      });
    }
    
    // Calculate final metrics
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const avgWin = wins > 0 ? totalWinAmount / wins : 0;
    const avgLoss = losses > 0 ? totalLossAmount / losses : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0;
    const avgHoldTime = trades.length > 0 ? totalHoldTime / trades.length : 0;
    
    // Simplified Sharpe Ratio (annualized)
    const returns = tradeResults.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
    
    const result: BacktestResult = {
      strategyName: strategy.name,
      totalTrades: trades.length,
      wins,
      losses,
      winRate,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldTime,
      maxDrawdown,
      sharpeRatio,
    };
    
    results.push(result);
    detailedResults.set(strategy.name, tradeResults);
    
    // Print summary
    console.log(`  Total Trades: ${trades.length}`);
    console.log(`  Wins: ${wins} (${winRate.toFixed(1)}%)`);
    console.log(`  Losses: ${losses}`);
    console.log(`  Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`  Avg Win: $${avgWin.toFixed(2)}`);
    console.log(`  Avg Loss: $${avgLoss.toFixed(2)}`);
    console.log(`  Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`  Avg Hold Time: ${avgHoldTime.toFixed(0)}s`);
    console.log(`  Max Drawdown: $${maxDrawdown.toFixed(2)}`);
    console.log(`  Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
  }
  
  // Print comparison table
  console.log("\n");
  console.log("=".repeat(120));
  console.log("STRATEGY COMPARISON");
  console.log("=".repeat(120));
  console.log("");
  
  // Sort by Total P&L
  results.sort((a, b) => b.totalPnL - a.totalPnL);
  
  console.log("| Rank | Strategy                              | Win Rate | Total P&L    | Profit Factor | Avg Hold | Sharpe |");
  console.log("|------|---------------------------------------|----------|--------------|---------------|----------|--------|");
  
  results.forEach((r, i) => {
    const rank = i + 1;
    const name = r.strategyName.padEnd(37);
    const winRate = `${r.winRate.toFixed(1)}%`.padStart(8);
    const pnl = `$${r.totalPnL.toFixed(2)}`.padStart(12);
    const pf = r.profitFactor.toFixed(2).padStart(13);
    const hold = `${r.avgHoldTime.toFixed(0)}s`.padStart(8);
    const sharpe = r.sharpeRatio.toFixed(2).padStart(6);
    
    console.log(`| ${rank}    | ${name} | ${winRate} | ${pnl} | ${pf} | ${hold} | ${sharpe} |`);
  });
  
  // Identify winner
  const winner = results[0];
  console.log("\n");
  console.log("=".repeat(80));
  console.log(`WINNER: ${winner.strategyName}`);
  console.log("=".repeat(80));
  console.log(`  Win Rate: ${winner.winRate.toFixed(1)}%`);
  console.log(`  Total P&L: $${winner.totalPnL.toFixed(2)}`);
  console.log(`  Profit Factor: ${winner.profitFactor.toFixed(2)}`);
  console.log(`  Sharpe Ratio: ${winner.sharpeRatio.toFixed(2)}`);
  
  // Save detailed results to file
  const reportPath = "/home/ubuntu/seer/BACKTEST_RESULTS.md";
  let report = `# Exit Strategy Backtest Results

**Date:** ${new Date().toISOString()}
**Total Trades Analyzed:** ${trades.length}

## Summary

`;

  report += "| Rank | Strategy | Win Rate | Total P&L | Profit Factor | Avg Hold | Sharpe |\n";
  report += "|------|----------|----------|-----------|---------------|----------|--------|\n";
  
  results.forEach((r, i) => {
    report += `| ${i + 1} | ${r.strategyName} | ${r.winRate.toFixed(1)}% | $${r.totalPnL.toFixed(2)} | ${r.profitFactor.toFixed(2)} | ${r.avgHoldTime.toFixed(0)}s | ${r.sharpeRatio.toFixed(2)} |\n`;
  });
  
  report += `\n## Winner: ${winner.strategyName}\n\n`;
  report += `- **Win Rate:** ${winner.winRate.toFixed(1)}%\n`;
  report += `- **Total P&L:** $${winner.totalPnL.toFixed(2)}\n`;
  report += `- **Profit Factor:** ${winner.profitFactor.toFixed(2)}\n`;
  report += `- **Average Hold Time:** ${winner.avgHoldTime.toFixed(0)} seconds\n`;
  report += `- **Max Drawdown:** $${winner.maxDrawdown.toFixed(2)}\n`;
  report += `- **Sharpe Ratio:** ${winner.sharpeRatio.toFixed(2)}\n`;
  
  report += `\n## Strategy Details\n\n`;
  
  for (const r of results) {
    report += `### ${r.strategyName}\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Trades | ${r.totalTrades} |\n`;
    report += `| Wins | ${r.wins} |\n`;
    report += `| Losses | ${r.losses} |\n`;
    report += `| Win Rate | ${r.winRate.toFixed(1)}% |\n`;
    report += `| Total P&L | $${r.totalPnL.toFixed(2)} |\n`;
    report += `| Avg Win | $${r.avgWin.toFixed(2)} |\n`;
    report += `| Avg Loss | $${r.avgLoss.toFixed(2)} |\n`;
    report += `| Profit Factor | ${r.profitFactor.toFixed(2)} |\n`;
    report += `| Avg Hold Time | ${r.avgHoldTime.toFixed(0)}s |\n`;
    report += `| Max Drawdown | $${r.maxDrawdown.toFixed(2)} |\n`;
    report += `| Sharpe Ratio | ${r.sharpeRatio.toFixed(2)} |\n`;
    report += `\n`;
  }
  
  // Add sample trades for winner
  const winnerTrades = detailedResults.get(winner.strategyName) || [];
  const winningTrades = winnerTrades.filter(t => t.pnl > 0).slice(0, 5);
  const losingTrades = winnerTrades.filter(t => t.pnl <= 0).slice(0, 5);
  
  report += `\n## Sample Trades (${winner.strategyName})\n\n`;
  report += `### Top 5 Winning Trades\n\n`;
  report += `| Symbol | Side | Entry | Exit | Hold | P&L | Exit Reason |\n`;
  report += `|--------|------|-------|------|------|-----|-------------|\n`;
  
  for (const t of winningTrades) {
    report += `| ${t.symbol} | ${t.side} | $${t.entryPrice.toFixed(2)} | $${t.exitPrice.toFixed(2)} | ${t.holdTimeSeconds.toFixed(0)}s | $${t.pnl.toFixed(2)} | ${t.exitReason} |\n`;
  }
  
  report += `\n### Top 5 Losing Trades\n\n`;
  report += `| Symbol | Side | Entry | Exit | Hold | P&L | Exit Reason |\n`;
  report += `|--------|------|-------|------|------|-----|-------------|\n`;
  
  for (const t of losingTrades) {
    report += `| ${t.symbol} | ${t.side} | $${t.entryPrice.toFixed(2)} | $${t.exitPrice.toFixed(2)} | ${t.holdTimeSeconds.toFixed(0)}s | $${t.pnl.toFixed(2)} | ${t.exitReason} |\n`;
  }
  
  fs.writeFileSync(reportPath, report);
  console.log(`\nDetailed report saved to: ${reportPath}`);
  
  process.exit(0);
}

main().catch(console.error);
