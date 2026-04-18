/**
 * Exit Strategy Backtesting with Real Historical Data
 * 
 * Uses CoinAPI to fetch real minute-by-minute price data for BTC and ETH,
 * then simulates different exit strategies against actual market movements.
 */

import * as fs from "fs";

// CoinAPI configuration
const COINAPI_KEY = process.env.COINAPI_KEY;
const COINAPI_BASE = "https://rest.coinapi.io/v1";

interface OHLCV {
  time_period_start: string;
  time_period_end: string;
  time_open: string;
  time_close: string;
  price_open: number;
  price_high: number;
  price_low: number;
  price_close: number;
  volume_traded: number;
  trades_count: number;
}

interface SimulatedTrade {
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  side: "long" | "short";
  pnlPercent: number;
  exitReason: string;
  holdTimeSeconds: number;
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
}

// Fetch historical OHLCV data from CoinAPI
async function fetchOHLCV(symbol: string, period: string, limit: number = 1000): Promise<OHLCV[]> {
  const symbolId = symbol === "BTC" ? "COINBASE_SPOT_BTC_USD" : "COINBASE_SPOT_ETH_USD";
  const url = `${COINAPI_BASE}/ohlcv/${symbolId}/history?period_id=${period}&limit=${limit}`;
  
  console.log(`Fetching ${symbol} data from CoinAPI...`);
  
  const response = await fetch(url, {
    headers: {
      "X-CoinAPI-Key": COINAPI_KEY!,
    },
  });
  
  if (!response.ok) {
    throw new Error(`CoinAPI error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as OHLCV[];
  console.log(`Fetched ${data.length} candles for ${symbol}`);
  return data;
}

// Simulate consensus based on price momentum
function calculateConsensus(candles: OHLCV[], index: number, lookback: number = 10): number {
  if (index < lookback) return 0.5;
  
  // Calculate momentum-based consensus
  let bullishSignals = 0;
  let totalSignals = 0;
  
  for (let i = index - lookback; i < index; i++) {
    const candle = candles[i];
    // Price momentum
    if (candle.price_close > candle.price_open) bullishSignals++;
    totalSignals++;
    
    // Volume momentum
    if (i > 0 && candle.volume_traded > candles[i - 1].volume_traded) bullishSignals += 0.5;
    totalSignals += 0.5;
    
    // Trend momentum
    if (i > 0 && candle.price_close > candles[i - 1].price_close) bullishSignals++;
    totalSignals++;
  }
  
  // Normalize to 0.5-1.0 range for bullish signals
  const rawConsensus = bullishSignals / totalSignals;
  return 0.5 + (rawConsensus * 0.5);
}

// Strategy: Threshold Touch (User's Strategy)
function strategyThresholdTouch(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short",
  threshold: number = 0.65
): { exitIndex: number; reason: string } {
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const consensus = calculateConsensus(candles, i);
    if (consensus <= threshold) {
      return { exitIndex: i, reason: `Threshold Touch: ${(consensus * 100).toFixed(1)}% <= ${(threshold * 100).toFixed(0)}%` };
    }
  }
  return { exitIndex: candles.length - 1, reason: "End of data" };
}

// Strategy: Threshold + Stop Loss
function strategyThresholdWithSL(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short",
  threshold: number = 0.65,
  stopLoss: number = 0.003
): { exitIndex: number; reason: string } {
  const entryPrice = candles[entryIndex].price_close;
  
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const currentPrice = candles[i].price_close;
    const priceChange = side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    // Stop loss first
    if (priceChange <= -stopLoss) {
      return { exitIndex: i, reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}%` };
    }
    
    // Then threshold
    const consensus = calculateConsensus(candles, i);
    if (consensus <= threshold) {
      return { exitIndex: i, reason: `Threshold Touch: ${(consensus * 100).toFixed(1)}%` };
    }
  }
  return { exitIndex: candles.length - 1, reason: "End of data" };
}

// Strategy: Scalp (0.1% TP, 0.15% SL, 2min max)
function strategyScalp(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short"
): { exitIndex: number; reason: string } {
  const entryPrice = candles[entryIndex].price_close;
  const maxCandles = 2; // 2 minute candles = 2 minutes max hold
  
  for (let i = entryIndex + 1; i < Math.min(entryIndex + maxCandles + 1, candles.length); i++) {
    const currentPrice = candles[i].price_close;
    const priceChange = side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    if (priceChange >= 0.001) {
      return { exitIndex: i, reason: `Take Profit: +${(priceChange * 100).toFixed(3)}%` };
    }
    if (priceChange <= -0.0015) {
      return { exitIndex: i, reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}%` };
    }
  }
  return { exitIndex: Math.min(entryIndex + maxCandles, candles.length - 1), reason: "Max Hold" };
}

// Strategy: Momentum (0.5% TP, trailing stop)
function strategyMomentum(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short"
): { exitIndex: number; reason: string } {
  const entryPrice = candles[entryIndex].price_close;
  let highWaterMark = 0;
  
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const currentPrice = candles[i].price_close;
    const priceChange = side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    if (priceChange > highWaterMark) highWaterMark = priceChange;
    
    if (priceChange >= 0.005) {
      return { exitIndex: i, reason: `Take Profit: +${(priceChange * 100).toFixed(3)}%` };
    }
    if (priceChange <= -0.005) {
      return { exitIndex: i, reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}%` };
    }
    // Trailing stop after 0.3% profit
    if (highWaterMark >= 0.003) {
      const trailingStop = highWaterMark - 0.002;
      if (priceChange <= trailingStop) {
        return { exitIndex: i, reason: `Trailing Stop: ${(priceChange * 100).toFixed(3)}%` };
      }
    }
  }
  return { exitIndex: candles.length - 1, reason: "End of data" };
}

// Strategy: 50% Decay (Current System)
function strategyDecay50(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short"
): { exitIndex: number; reason: string } {
  let peakConsensus = entryConsensus;
  
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const consensus = calculateConsensus(candles, i);
    if (consensus > peakConsensus) peakConsensus = consensus;
    
    const decay = (peakConsensus - consensus) / peakConsensus;
    if (decay >= 0.5) {
      return { exitIndex: i, reason: `Decay 50%: ${(decay * 100).toFixed(1)}%` };
    }
  }
  return { exitIndex: candles.length - 1, reason: "End of data" };
}

// Strategy: Pure Price (0.3% TP, 0.5% SL)
function strategyPurePrice(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short"
): { exitIndex: number; reason: string } {
  const entryPrice = candles[entryIndex].price_close;
  
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const currentPrice = candles[i].price_close;
    const priceChange = side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    if (priceChange >= 0.003) {
      return { exitIndex: i, reason: `Take Profit: +${(priceChange * 100).toFixed(3)}%` };
    }
    if (priceChange <= -0.005) {
      return { exitIndex: i, reason: `Stop Loss: ${(priceChange * 100).toFixed(3)}%` };
    }
  }
  return { exitIndex: candles.length - 1, reason: "End of data" };
}

// Strategy: Tight Scalp (0.05% TP, 0.1% SL, 1min max)
function strategyTightScalp(
  candles: OHLCV[],
  entryIndex: number,
  entryConsensus: number,
  side: "long" | "short"
): { exitIndex: number; reason: string } {
  const entryPrice = candles[entryIndex].price_close;
  const maxCandles = 1; // 1 minute max
  
  for (let i = entryIndex + 1; i < Math.min(entryIndex + maxCandles + 1, candles.length); i++) {
    const currentPrice = candles[i].price_close;
    const priceChange = side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    if (priceChange >= 0.0005) {
      return { exitIndex: i, reason: `Take Profit: +${(priceChange * 100).toFixed(4)}%` };
    }
    if (priceChange <= -0.001) {
      return { exitIndex: i, reason: `Stop Loss: ${(priceChange * 100).toFixed(4)}%` };
    }
  }
  return { exitIndex: Math.min(entryIndex + maxCandles, candles.length - 1), reason: "Max Hold" };
}

async function runBacktest() {
  console.log("=".repeat(100));
  console.log("EXIT STRATEGY BACKTESTING WITH REAL HISTORICAL DATA");
  console.log("=".repeat(100));
  console.log("");
  
  if (!COINAPI_KEY) {
    console.error("ERROR: COINAPI_KEY not set in environment");
    process.exit(1);
  }
  
  // Fetch real historical data
  const btcData = await fetchOHLCV("BTC", "1MIN", 1000);
  const ethData = await fetchOHLCV("ETH", "1MIN", 1000);
  
  // Combine data for testing
  const allData = [
    { symbol: "BTC", candles: btcData },
    { symbol: "ETH", candles: ethData },
  ];
  
  // Define strategies
  const strategies = [
    { name: "1. Threshold Touch (Your Strategy)", fn: strategyThresholdTouch },
    { name: "2. Threshold + 0.3% SL", fn: strategyThresholdWithSL },
    { name: "3. Scalp (0.1% TP, 0.15% SL)", fn: strategyScalp },
    { name: "4. Momentum (0.5% TP, trailing)", fn: strategyMomentum },
    { name: "5. Decay 50% (Current)", fn: strategyDecay50 },
    { name: "6. Pure Price (0.3% TP, 0.5% SL)", fn: strategyPurePrice },
    { name: "7. Tight Scalp (0.05% TP)", fn: strategyTightScalp },
  ];
  
  const results: StrategyResult[] = [];
  
  // Run backtest for each strategy
  for (const strategy of strategies) {
    console.log(`\nTesting: ${strategy.name}`);
    console.log("-".repeat(60));
    
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    let totalHoldTime = 0;
    let tradeCount = 0;
    
    for (const { symbol, candles } of allData) {
      // Find entry points (when consensus crosses above threshold)
      for (let i = 20; i < candles.length - 10; i += 5) { // Skip every 5 candles to avoid overlapping trades
        const consensus = calculateConsensus(candles, i);
        const prevConsensus = calculateConsensus(candles, i - 1);
        
        // Entry signal: consensus crosses above 65%
        if (consensus >= 0.65 && prevConsensus < 0.65) {
          const side: "long" | "short" = "long"; // Always long for simplicity
          const entryPrice = candles[i].price_close;
          
          // Apply strategy
          const { exitIndex, reason } = strategy.fn(candles, i, consensus, side);
          
          const exitPrice = candles[exitIndex].price_close;
          const pnlPercent = (exitPrice - entryPrice) / entryPrice;
          const holdTimeMinutes = exitIndex - i;
          
          // Calculate P&L (assuming $1000 position size)
          const positionSize = 1000;
          const grossPnL = pnlPercent * positionSize;
          const commission = positionSize * 0.001; // 0.1% commission
          const netPnL = grossPnL - commission;
          
          totalPnL += netPnL;
          totalHoldTime += holdTimeMinutes;
          tradeCount++;
          
          if (netPnL > 0) {
            wins++;
            totalWinAmount += netPnL;
          } else {
            losses++;
            totalLossAmount += Math.abs(netPnL);
          }
        }
      }
    }
    
    const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0;
    const avgPnL = tradeCount > 0 ? totalPnL / tradeCount : 0;
    const avgWin = wins > 0 ? totalWinAmount / wins : 0;
    const avgLoss = losses > 0 ? totalLossAmount / losses : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
    const avgHoldTime = tradeCount > 0 ? totalHoldTime / tradeCount : 0;
    
    results.push({
      name: strategy.name,
      description: "",
      trades: tradeCount,
      wins,
      losses,
      winRate,
      totalPnL,
      avgPnL,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldTime,
    });
    
    console.log(`  Trades: ${tradeCount} | Wins: ${wins} | Losses: ${losses}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}% | Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`  Profit Factor: ${profitFactor.toFixed(2)} | Avg Hold: ${avgHoldTime.toFixed(0)} min`);
  }
  
  // Sort by Total P&L
  results.sort((a, b) => b.totalPnL - a.totalPnL);
  
  // Print comparison table
  console.log("\n");
  console.log("=".repeat(120));
  console.log("STRATEGY COMPARISON (Sorted by Total P&L)");
  console.log("=".repeat(120));
  console.log("");
  
  console.log("| Rank | Strategy                          | Trades | Win Rate | Total P&L    | Profit Factor |");
  console.log("|------|-----------------------------------|--------|----------|--------------|---------------|");
  
  results.forEach((r, i) => {
    const rank = i + 1;
    const name = r.name.substring(0, 35).padEnd(35);
    const trades = String(r.trades).padStart(6);
    const winRate = `${r.winRate.toFixed(1)}%`.padStart(8);
    const pnl = `$${r.totalPnL.toFixed(2)}`.padStart(12);
    const pf = r.profitFactor.toFixed(2).padStart(13);
    
    console.log(`| ${rank}    | ${name} | ${trades} | ${winRate} | ${pnl} | ${pf} |`);
  });
  
  // Identify winner
  const winner = results[0];
  console.log("\n");
  console.log("=".repeat(80));
  console.log(`🏆 WINNER: ${winner.name}`);
  console.log("=".repeat(80));
  console.log(`  Trades: ${winner.trades}`);
  console.log(`  Win Rate: ${winner.winRate.toFixed(1)}%`);
  console.log(`  Total P&L: $${winner.totalPnL.toFixed(2)}`);
  console.log(`  Profit Factor: ${winner.profitFactor.toFixed(2)}`);
  console.log(`  Avg Hold Time: ${winner.avgHoldTime.toFixed(0)} minutes`);
  
  // Save report
  const report = `# Exit Strategy Backtest with Real Data

**Date:** ${new Date().toISOString()}
**Data Source:** CoinAPI (BTC-USD, ETH-USD)
**Timeframe:** 1-minute candles

## Strategy Comparison

| Rank | Strategy | Trades | Win Rate | Total P&L | Profit Factor |
|------|----------|--------|----------|-----------|---------------|
${results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.trades} | ${r.winRate.toFixed(1)}% | $${r.totalPnL.toFixed(2)} | ${r.profitFactor.toFixed(2)} |`).join('\n')}

## Winner: ${winner.name}

- **Trades:** ${winner.trades}
- **Win Rate:** ${winner.winRate.toFixed(1)}%
- **Total P&L:** $${winner.totalPnL.toFixed(2)}
- **Profit Factor:** ${winner.profitFactor.toFixed(2)}
- **Average Hold Time:** ${winner.avgHoldTime.toFixed(0)} minutes

## Recommendation

Based on real historical data backtest, the **${winner.name}** strategy shows the best performance.
`;

  fs.writeFileSync("/home/ubuntu/seer/BACKTEST_REAL_DATA_RESULTS.md", report);
  console.log("\nReport saved to: /home/ubuntu/seer/BACKTEST_REAL_DATA_RESULTS.md");
}

runBacktest().catch(console.error);
