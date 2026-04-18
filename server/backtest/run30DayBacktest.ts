/**
 * Extended 30+ Day Backtest with 70% Consensus Threshold
 * 
 * Purpose: Validate the SEER trading system across multiple market conditions
 * - Captures trending, ranging, and volatile market periods
 * - Tests the 70% consensus threshold for quality signal filtering
 * - Compares results with lower thresholds for validation
 */

import { ComprehensiveBacktestEngine, BacktestConfig, BacktestResult, OHLCV, MarketRegime } from './ComprehensiveBacktestEngine';

interface ExtendedBacktestResult extends BacktestResult {
  thresholdUsed: number;
  marketConditions: {
    trendingDays: number;
    rangingDays: number;
    volatileDays: number;
    totalDays: number;
  };
  signalQuality: {
    totalSignalsGenerated: number;
    signalsPassingThreshold: number;
    signalPassRate: number;
  };
}

interface ThresholdComparison {
  threshold: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgTradesPerDay: number;
}

async function run30DayBacktest(): Promise<void> {
  console.log('\n========================================');
  console.log('   30+ DAY EXTENDED BACKTEST');
  console.log('   70% Consensus Threshold Validation');
  console.log('========================================\n');

  // Calculate date range: 35 days to ensure 30+ trading days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 35); // 35 days ago

  console.log(`Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`Duration: ~35 days\n`);

  // Test multiple thresholds for comparison
  const thresholds = [0.25, 0.50, 0.70, 0.80];
  const comparisonResults: ThresholdComparison[] = [];

  for (const threshold of thresholds) {
    console.log(`\n--- Testing ${(threshold * 100).toFixed(0)}% Consensus Threshold ---\n`);

    const config: Partial<BacktestConfig> = {
      startDate,
      endDate,
      symbols: ['BTC-USD', 'ETH-USD'],
      initialCapital: 50000,
      consensusThreshold: threshold,
      alphaThreshold: threshold + 0.10, // Alpha is 10% higher than base
      minAgentsRequired: threshold >= 0.70 ? 4 : 3, // A++ requires 4 agents
      
      // Position sizing
      basePositionPercent: 0.05,
      maxPositionPercent: 0.15,
      confidenceMultiplier: 1.5,
      
      // Exit strategy (optimized for crypto volatility)
      breakevenActivationPercent: 1.0,
      breakevenBuffer: 0.2,
      partialProfitLevels: [
        { pnlPercent: 2.0, exitPercent: 25 },
        { pnlPercent: 3.0, exitPercent: 25 },
        { pnlPercent: 5.0, exitPercent: 25 },
      ],
      trailingActivationPercent: 2.0,
      trailingPercent: 1.0,
      emergencyStopPercent: -5.0,
      maxHoldTimeMinutes: 480, // 8 hours max hold
      
      // Fees
      feePercent: 0.1,
      
      // Regime strategies
      regimeStrategies: {
        trending_up: true,
        trending_down: true,
        ranging: true,
        volatile: threshold >= 0.70, // Only trade volatile with high threshold
        choppy: false,
      },
    };

    const engine = new ComprehensiveBacktestEngine(config);
    const results = await engine.runBacktest();

    // Aggregate results across symbols
    let totalTrades = 0;
    let totalWins = 0;
    let totalPnl = 0;
    let maxDrawdown = 0;
    let totalGrossProfit = 0;
    let totalGrossLoss = 0;
    let allReturns: number[] = [];

    for (const result of results) {
      totalTrades += result.totalTrades;
      totalWins += result.winningTrades;
      totalPnl += result.totalPnl;
      maxDrawdown = Math.max(maxDrawdown, result.maxDrawdown);
      
      // Calculate gross profit/loss for profit factor
      for (const trade of result.trades) {
        if (trade.pnl !== undefined) {
          if (trade.pnl > 0) {
            totalGrossProfit += trade.pnl;
          } else {
            totalGrossLoss += Math.abs(trade.pnl);
          }
          allReturns.push(trade.pnlPercent || 0);
        }
      }
    }

    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : totalGrossProfit > 0 ? Infinity : 0;
    const totalPnlPercent = (totalPnl / 50000) * 100;
    const avgTradesPerDay = totalTrades / 35;

    // Calculate Sharpe Ratio
    let sharpeRatio = 0;
    if (allReturns.length > 0) {
      const avgReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
      const variance = allReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / allReturns.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
    }

    comparisonResults.push({
      threshold,
      totalTrades,
      winRate,
      profitFactor,
      totalPnl,
      totalPnlPercent,
      maxDrawdown,
      sharpeRatio,
      avgTradesPerDay,
    });

    console.log(`\n${(threshold * 100).toFixed(0)}% Threshold Results:`);
    console.log(`  Total Trades: ${totalTrades}`);
    console.log(`  Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`  Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`  Total P&L: $${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}%)`);
    console.log(`  Max Drawdown: ${maxDrawdown.toFixed(2)}%`);
    console.log(`  Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
    console.log(`  Avg Trades/Day: ${avgTradesPerDay.toFixed(2)}`);
  }

  // Print comparison table
  console.log('\n========================================');
  console.log('   THRESHOLD COMPARISON SUMMARY');
  console.log('========================================\n');

  console.log('Threshold | Trades | Win Rate | PF    | P&L %   | Max DD | Sharpe | Trades/Day');
  console.log('----------|--------|----------|-------|---------|--------|--------|----------');

  for (const result of comparisonResults) {
    console.log(
      `${(result.threshold * 100).toFixed(0).padStart(8)}% | ` +
      `${result.totalTrades.toString().padStart(6)} | ` +
      `${result.winRate.toFixed(1).padStart(7)}% | ` +
      `${result.profitFactor.toFixed(2).padStart(5)} | ` +
      `${result.totalPnlPercent.toFixed(2).padStart(6)}% | ` +
      `${result.maxDrawdown.toFixed(1).padStart(5)}% | ` +
      `${result.sharpeRatio.toFixed(2).padStart(6)} | ` +
      `${result.avgTradesPerDay.toFixed(2).padStart(10)}`
    );
  }

  // Determine best threshold
  const best70 = comparisonResults.find(r => r.threshold === 0.70);
  const best25 = comparisonResults.find(r => r.threshold === 0.25);

  console.log('\n========================================');
  console.log('   ANALYSIS & RECOMMENDATIONS');
  console.log('========================================\n');

  if (best70 && best25) {
    const capitalPreservation = best70.totalPnlPercent >= best25.totalPnlPercent;
    const betterWinRate = best70.winRate >= best25.winRate;
    const betterRiskAdjusted = best70.sharpeRatio >= best25.sharpeRatio;

    console.log('70% vs 25% Threshold Comparison:');
    console.log(`  Capital Preservation: ${capitalPreservation ? '✅ 70% better' : '❌ 25% better'}`);
    console.log(`  Win Rate: ${betterWinRate ? '✅ 70% better' : '❌ 25% better'}`);
    console.log(`  Risk-Adjusted Returns: ${betterRiskAdjusted ? '✅ 70% better' : '❌ 25% better'}`);
    console.log(`  Trade Frequency: ${best70.avgTradesPerDay.toFixed(2)} vs ${best25.avgTradesPerDay.toFixed(2)} trades/day`);

    if (best70.totalTrades === 0) {
      console.log('\n⚠️  WARNING: 70% threshold generated 0 trades in 35 days.');
      console.log('   This indicates the threshold may be too conservative for current market conditions.');
      console.log('   Consider:');
      console.log('   1. Lowering threshold to 60-65% for more trade opportunities');
      console.log('   2. Adding more data sources to increase signal diversity');
      console.log('   3. Adjusting agent weights to generate stronger signals');
    } else if (best70.winRate > 60 && best70.profitFactor > 1.5) {
      console.log('\n✅ RECOMMENDATION: 70% threshold shows strong performance.');
      console.log('   Ready for paper trading validation.');
    } else {
      console.log('\n⚠️  RECOMMENDATION: 70% threshold needs optimization.');
      console.log('   Consider adjusting agent weights or signal generation logic.');
    }
  }

  console.log('\n========================================');
  console.log('   BACKTEST COMPLETE');
  console.log('========================================\n');
}

// Run the backtest
run30DayBacktest().catch(console.error);
