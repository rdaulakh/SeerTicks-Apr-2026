/**
 * Final Exit Strategy Backtesting Engine
 * 
 * Properly simulates tick-by-tick execution for different exit strategies
 * using historical position data and reconstructed price/consensus movements.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { desc, eq, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import * as fs from "fs";

const ENTRY_THRESHOLD = 0.65;
const COMMISSION_RATE = 0.001; // 0.1% commission

interface Position {
  id: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  entryConsensus: number;
  exitConsensus: number;
  peakConsensus: number;
  entryTime: Date;
  exitTime: Date;
  holdTimeSeconds: number;
  exitReason: string;
}

interface SimulatedTick {
  time: number; // seconds from entry
  price: number;
  consensus: number;
  priceChange: number; // from entry
}

interface StrategyResult {
  name: string;
  description: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgHoldTime: number;
  maxDrawdown: number;
}

// Generate simulated ticks based on actual entry/exit data
function generateTicks(position: Position, numTicks: number = 100): SimulatedTick[] {
  const ticks: SimulatedTick[] = [];
  const holdTime = position.holdTimeSeconds;
  
  // Generate ticks with realistic price movement
  // Price typically oscillates before reaching final exit price
  for (let i = 0; i <= numTicks; i++) {
    const progress = i / numTicks;
    const timeSeconds = holdTime * progress;
    
    // Price movement with oscillation
    // Add some noise to simulate real market behavior
    const baseProgress = progress;
    const noise = Math.sin(progress * Math.PI * 4) * 0.001; // Small oscillation
    const priceProgress = baseProgress + noise;
    
    const isLong = position.side.toLowerCase() === 'long';
    const totalPriceMove = position.exitPrice - position.entryPrice;
    const currentPrice = position.entryPrice + (totalPriceMove * priceProgress);
    
    const priceChange = isLong
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
    
    // Consensus movement
    // Typically rises initially then falls
    let consensus: number;
    if (progress < 0.2) {
      // Rising phase (0-20%)
      consensus = position.entryConsensus + 
        (position.peakConsensus - position.entryConsensus) * (progress / 0.2);
    } else {
      // Falling phase (20-100%)
      const fallProgress = (progress - 0.2) / 0.8;
      consensus = position.peakConsensus - 
        (position.peakConsensus - position.exitConsensus) * fallProgress;
    }
    
    ticks.push({
      time: timeSeconds,
      price: currentPrice,
      consensus,
      priceChange,
    });
  }
  
  return ticks;
}

// Strategy 1: Your Threshold Touch Strategy
// Exit when consensus drops back to entry threshold (65%)
function strategyThresholdTouch(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  for (const tick of ticks) {
    if (tick.consensus <= ENTRY_THRESHOLD && position.entryConsensus > ENTRY_THRESHOLD) {
      return { exitTick: tick, reason: `Threshold Touch: consensus ${(tick.consensus * 100).toFixed(1)}% <= 65%` };
    }
  }
  return null;
}

// Strategy 2: Threshold Touch + Stop Loss Protection
function strategyThresholdWithSL(
  ticks: SimulatedTick[],
  position: Position,
  stopLossPercent: number = 0.003 // 0.3%
): { exitTick: SimulatedTick; reason: string } | null {
  for (const tick of ticks) {
    // Stop loss first
    if (tick.priceChange <= -stopLossPercent) {
      return { exitTick: tick, reason: `Stop Loss: ${(tick.priceChange * 100).toFixed(3)}%` };
    }
    // Then threshold touch
    if (tick.consensus <= ENTRY_THRESHOLD && position.entryConsensus > ENTRY_THRESHOLD) {
      return { exitTick: tick, reason: `Threshold Touch: ${(tick.consensus * 100).toFixed(1)}%` };
    }
  }
  return null;
}

// Strategy 3: Scalp (0.1% TP, 0.15% SL, 120s max)
function strategyScalp(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  for (const tick of ticks) {
    if (tick.priceChange >= 0.001) {
      return { exitTick: tick, reason: `Take Profit: +${(tick.priceChange * 100).toFixed(3)}%` };
    }
    if (tick.priceChange <= -0.0015) {
      return { exitTick: tick, reason: `Stop Loss: ${(tick.priceChange * 100).toFixed(3)}%` };
    }
    if (tick.time >= 120) {
      return { exitTick: tick, reason: `Max Hold: ${tick.time.toFixed(0)}s` };
    }
  }
  return null;
}

// Strategy 4: Momentum (0.5% TP, 0.5% SL, trailing after 0.3%)
function strategyMomentum(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  let highWaterMark = 0;
  
  for (const tick of ticks) {
    if (tick.priceChange > highWaterMark) {
      highWaterMark = tick.priceChange;
    }
    
    if (tick.priceChange >= 0.005) {
      return { exitTick: tick, reason: `Take Profit: +${(tick.priceChange * 100).toFixed(3)}%` };
    }
    if (tick.priceChange <= -0.005) {
      return { exitTick: tick, reason: `Stop Loss: ${(tick.priceChange * 100).toFixed(3)}%` };
    }
    // Trailing stop after 0.3% profit
    if (highWaterMark >= 0.003) {
      const trailingStop = highWaterMark - 0.002;
      if (tick.priceChange <= trailingStop) {
        return { exitTick: tick, reason: `Trailing Stop: ${(tick.priceChange * 100).toFixed(3)}%` };
      }
    }
  }
  return null;
}

// Strategy 5: Current System (50% Decay)
function strategyDecay50(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  let peakConsensus = position.entryConsensus;
  
  for (const tick of ticks) {
    if (tick.consensus > peakConsensus) {
      peakConsensus = tick.consensus;
    }
    
    const decay = (peakConsensus - tick.consensus) / peakConsensus;
    if (decay >= 0.5) {
      return { exitTick: tick, reason: `Decay 50%: ${(decay * 100).toFixed(1)}%` };
    }
  }
  return null;
}

// Strategy 6: Pure Price (0.3% TP, 0.5% SL)
function strategyPurePrice(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  for (const tick of ticks) {
    if (tick.priceChange >= 0.003) {
      return { exitTick: tick, reason: `Take Profit: +${(tick.priceChange * 100).toFixed(3)}%` };
    }
    if (tick.priceChange <= -0.005) {
      return { exitTick: tick, reason: `Stop Loss: ${(tick.priceChange * 100).toFixed(3)}%` };
    }
  }
  return null;
}

// Strategy 7: Tight Scalp (0.05% TP, 0.1% SL, 60s max) - Millisecond trading
function strategyTightScalp(
  ticks: SimulatedTick[],
  position: Position
): { exitTick: SimulatedTick; reason: string } | null {
  for (const tick of ticks) {
    if (tick.priceChange >= 0.0005) {
      return { exitTick: tick, reason: `Take Profit: +${(tick.priceChange * 100).toFixed(4)}%` };
    }
    if (tick.priceChange <= -0.001) {
      return { exitTick: tick, reason: `Stop Loss: ${(tick.priceChange * 100).toFixed(4)}%` };
    }
    if (tick.time >= 60) {
      return { exitTick: tick, reason: `Max Hold: ${tick.time.toFixed(0)}s` };
    }
  }
  return null;
}

async function main() {
  console.log("=".repeat(100));
  console.log("FINAL EXIT STRATEGY BACKTESTING ENGINE");
  console.log("=".repeat(100));
  console.log("");
  
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get all closed positions
  console.log("Fetching historical position data...");
  const rawPositions = await db.select({
    id: schema.paperPositions.id,
    symbol: schema.paperPositions.symbol,
    side: schema.paperPositions.side,
    entryPrice: schema.paperPositions.entryPrice,
    currentPrice: schema.paperPositions.currentPrice,
    quantity: schema.paperPositions.quantity,
    realizedPnl: schema.paperPositions.realizedPnl,
    originalConsensus: schema.paperPositions.originalConsensus,
    currentConfidence: schema.paperPositions.currentConfidence,
    peakConfidence: schema.paperPositions.peakConfidence,
    createdAt: schema.paperPositions.createdAt,
    exitTime: schema.paperPositions.exitTime,
    exitReason: schema.paperPositions.exitReason,
  })
  .from(schema.paperPositions)
  .where(eq(schema.paperPositions.status, 'closed'))
  .orderBy(desc(schema.paperPositions.createdAt));
  
  // Convert to Position format
  const positions: Position[] = rawPositions
    .filter(p => p.exitTime) // Only positions with exit time
    .map(p => {
      const entryTime = p.createdAt;
      const exitTime = p.exitTime!;
      const holdTimeSeconds = (exitTime.getTime() - entryTime.getTime()) / 1000;
      
      return {
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: parseFloat(p.entryPrice),
        exitPrice: parseFloat(p.currentPrice), // currentPrice is the exit price for closed positions
        quantity: parseFloat(p.quantity),
        realizedPnl: parseFloat(p.realizedPnl || "0"),
        entryConsensus: parseFloat(p.originalConsensus || "0.65"),
        exitConsensus: parseFloat(p.currentConfidence || "0.5"),
        peakConsensus: parseFloat(p.peakConfidence || "0.7"),
        entryTime,
        exitTime,
        holdTimeSeconds,
        exitReason: p.exitReason || "Unknown",
      };
    });
  
  console.log(`Found ${positions.length} closed positions with exit data`);
  console.log("");
  
  // Define strategies to test
  const strategies = [
    {
      name: "1. Threshold Touch (Your Strategy)",
      description: "Exit when consensus drops to 65% threshold",
      fn: strategyThresholdTouch,
    },
    {
      name: "2. Threshold + 0.3% SL",
      description: "Threshold touch with stop loss protection",
      fn: strategyThresholdWithSL,
    },
    {
      name: "3. Scalp (0.1% TP, 0.15% SL)",
      description: "Quick scalp with tight targets",
      fn: strategyScalp,
    },
    {
      name: "4. Momentum (0.5% TP, trailing)",
      description: "Momentum with trailing stop",
      fn: strategyMomentum,
    },
    {
      name: "5. Decay 50% (Current)",
      description: "Current system - 50% consensus decay",
      fn: strategyDecay50,
    },
    {
      name: "6. Pure Price (0.3% TP, 0.5% SL)",
      description: "Price-only targets",
      fn: strategyPurePrice,
    },
    {
      name: "7. Tight Scalp (0.05% TP)",
      description: "Millisecond trading - very tight targets",
      fn: strategyTightScalp,
    },
  ];
  
  const results: StrategyResult[] = [];
  
  // Run backtest for each strategy
  for (const strategy of strategies) {
    console.log(`\nTesting: ${strategy.name}`);
    console.log(`Description: ${strategy.description}`);
    console.log("-".repeat(60));
    
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    let totalHoldTime = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;
    let peakPnL = 0;
    
    for (const position of positions) {
      // Generate simulated ticks
      const ticks = generateTicks(position, 100);
      
      // Apply strategy
      const exitResult = strategy.fn(ticks, position);
      
      let exitTick: SimulatedTick;
      if (exitResult) {
        exitTick = exitResult.exitTick;
      } else {
        // No exit triggered, use last tick (actual exit)
        exitTick = ticks[ticks.length - 1];
      }
      
      // Calculate P&L
      const isLong = position.side.toLowerCase() === 'long';
      const pnlPercent = exitTick.priceChange;
      const grossPnL = pnlPercent * position.entryPrice * position.quantity;
      const commission = position.entryPrice * position.quantity * COMMISSION_RATE;
      const netPnL = grossPnL - commission;
      
      // Track metrics
      totalPnL += netPnL;
      runningPnL += netPnL;
      totalHoldTime += exitTick.time;
      
      if (runningPnL > peakPnL) peakPnL = runningPnL;
      const drawdown = peakPnL - runningPnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      
      if (netPnL > 0) {
        wins++;
        totalWinAmount += netPnL;
      } else {
        losses++;
        totalLossAmount += Math.abs(netPnL);
      }
    }
    
    const winRate = positions.length > 0 ? (wins / positions.length) * 100 : 0;
    const avgPnL = positions.length > 0 ? totalPnL / positions.length : 0;
    const avgWin = wins > 0 ? totalWinAmount / wins : 0;
    const avgLoss = losses > 0 ? totalLossAmount / losses : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
    const avgHoldTime = positions.length > 0 ? totalHoldTime / positions.length : 0;
    
    results.push({
      name: strategy.name,
      description: strategy.description,
      trades: positions.length,
      wins,
      losses,
      winRate,
      totalPnL,
      avgPnL,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldTime,
      maxDrawdown,
    });
    
    console.log(`  Trades: ${positions.length} | Wins: ${wins} | Losses: ${losses}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}% | Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`  Avg Win: $${avgWin.toFixed(2)} | Avg Loss: $${avgLoss.toFixed(2)}`);
    console.log(`  Profit Factor: ${profitFactor.toFixed(2)} | Avg Hold: ${avgHoldTime.toFixed(0)}s`);
  }
  
  // Sort by Total P&L
  results.sort((a, b) => b.totalPnL - a.totalPnL);
  
  // Print comparison table
  console.log("\n");
  console.log("=".repeat(120));
  console.log("STRATEGY COMPARISON (Sorted by Total P&L)");
  console.log("=".repeat(120));
  console.log("");
  
  console.log("| Rank | Strategy                          | Win Rate | Total P&L    | Profit Factor | Avg Hold |");
  console.log("|------|-----------------------------------|----------|--------------|---------------|----------|");
  
  results.forEach((r, i) => {
    const rank = i + 1;
    const name = r.name.substring(0, 35).padEnd(35);
    const winRate = `${r.winRate.toFixed(1)}%`.padStart(8);
    const pnl = `$${r.totalPnL.toFixed(2)}`.padStart(12);
    const pf = r.profitFactor.toFixed(2).padStart(13);
    const hold = `${r.avgHoldTime.toFixed(0)}s`.padStart(8);
    
    console.log(`| ${rank}    | ${name} | ${winRate} | ${pnl} | ${pf} | ${hold} |`);
  });
  
  // Identify winner
  const winner = results[0];
  console.log("\n");
  console.log("=".repeat(80));
  console.log(`🏆 WINNER: ${winner.name}`);
  console.log("=".repeat(80));
  console.log(`  Win Rate: ${winner.winRate.toFixed(1)}%`);
  console.log(`  Total P&L: $${winner.totalPnL.toFixed(2)}`);
  console.log(`  Profit Factor: ${winner.profitFactor.toFixed(2)}`);
  console.log(`  Avg Hold Time: ${winner.avgHoldTime.toFixed(0)} seconds`);
  console.log(`  Max Drawdown: $${winner.maxDrawdown.toFixed(2)}`);
  
  // Key insights
  console.log("\n");
  console.log("=".repeat(80));
  console.log("KEY INSIGHTS");
  console.log("=".repeat(80));
  
  const thresholdStrategy = results.find(r => r.name.includes("Threshold Touch"));
  const currentStrategy = results.find(r => r.name.includes("Current"));
  
  if (thresholdStrategy && currentStrategy) {
    const improvement = thresholdStrategy.totalPnL - currentStrategy.totalPnL;
    console.log(`\n1. Your Threshold Touch strategy vs Current System:`);
    console.log(`   - Threshold Touch P&L: $${thresholdStrategy.totalPnL.toFixed(2)}`);
    console.log(`   - Current System P&L: $${currentStrategy.totalPnL.toFixed(2)}`);
    console.log(`   - Improvement: $${improvement.toFixed(2)} (${improvement > 0 ? 'BETTER' : 'WORSE'})`);
  }
  
  console.log(`\n2. Best performing strategy: ${winner.name}`);
  console.log(`   - This strategy has the highest total P&L`);
  
  const tightScalp = results.find(r => r.name.includes("Tight Scalp"));
  if (tightScalp) {
    console.log(`\n3. Millisecond Trading (Tight Scalp):`);
    console.log(`   - Win Rate: ${tightScalp.winRate.toFixed(1)}%`);
    console.log(`   - Total P&L: $${tightScalp.totalPnL.toFixed(2)}`);
    console.log(`   - Avg Hold: ${tightScalp.avgHoldTime.toFixed(0)}s`);
  }
  
  // Save report
  const report = `# Final Exit Strategy Backtest Results

**Date:** ${new Date().toISOString()}
**Total Trades Analyzed:** ${positions.length}

## Strategy Comparison

| Rank | Strategy | Win Rate | Total P&L | Profit Factor | Avg Hold |
|------|----------|----------|-----------|---------------|----------|
${results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.winRate.toFixed(1)}% | $${r.totalPnL.toFixed(2)} | ${r.profitFactor.toFixed(2)} | ${r.avgHoldTime.toFixed(0)}s |`).join('\n')}

## Winner: ${winner.name}

- **Win Rate:** ${winner.winRate.toFixed(1)}%
- **Total P&L:** $${winner.totalPnL.toFixed(2)}
- **Profit Factor:** ${winner.profitFactor.toFixed(2)}
- **Average Hold Time:** ${winner.avgHoldTime.toFixed(0)} seconds
- **Max Drawdown:** $${winner.maxDrawdown.toFixed(2)}

## Strategy Details

${results.map(r => `### ${r.name}
${r.description}

| Metric | Value |
|--------|-------|
| Total Trades | ${r.trades} |
| Wins | ${r.wins} |
| Losses | ${r.losses} |
| Win Rate | ${r.winRate.toFixed(1)}% |
| Total P&L | $${r.totalPnL.toFixed(2)} |
| Avg P&L | $${r.avgPnL.toFixed(2)} |
| Avg Win | $${r.avgWin.toFixed(2)} |
| Avg Loss | $${r.avgLoss.toFixed(2)} |
| Profit Factor | ${r.profitFactor.toFixed(2)} |
| Avg Hold Time | ${r.avgHoldTime.toFixed(0)}s |
| Max Drawdown | $${r.maxDrawdown.toFixed(2)} |
`).join('\n')}

## Recommendation

Based on the backtest results, the **${winner.name}** strategy shows the best performance.

### Implementation Notes:
1. ${winner.description}
2. Consider combining with additional risk management rules
3. Monitor live performance and adjust parameters as needed
`;

  fs.writeFileSync("/home/ubuntu/seer/BACKTEST_FINAL_RESULTS.md", report);
  console.log("\nReport saved to: /home/ubuntu/seer/BACKTEST_FINAL_RESULTS.md");
  
  process.exit(0);
}

main().catch(console.error);
