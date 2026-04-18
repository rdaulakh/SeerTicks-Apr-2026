/**
 * SEER A++ Institutional Grade Backtest
 * Phase 1: Dry Run Validation (1 Week)
 * 
 * Purpose:
 * - Validate correctness of all 75 strategies
 * - Detect bugs, loops, duplicates
 * - Verify budget and risk constraints
 * - Test dynamic AI systems
 */

import { BacktestEngine, BacktestConfig, OHLCV, BacktestResult } from './BacktestEngine';

// Coinbase API for historical data
const COINBASE_API = 'https://api.exchange.coinbase.com';

interface CoinbaseCandle {
  0: number; // timestamp
  1: number; // low
  2: number; // high
  3: number; // open
  4: number; // close
  5: number; // volume
}

/**
 * Fetch historical candles from Coinbase
 */
async function fetchHistoricalData(
  symbol: string,
  startDate: Date,
  endDate: Date,
  granularity: number = 300 // 5 minutes
): Promise<OHLCV[]> {
  const candles: OHLCV[] = [];
  let currentStart = startDate.getTime() / 1000;
  const endTimestamp = endDate.getTime() / 1000;
  
  console.log(`[DataFetch] Fetching ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  while (currentStart < endTimestamp) {
    const currentEnd = Math.min(currentStart + granularity * 300, endTimestamp);
    
    try {
      const url = `${COINBASE_API}/products/${symbol}/candles?start=${new Date(currentStart * 1000).toISOString()}&end=${new Date(currentEnd * 1000).toISOString()}&granularity=${granularity}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[DataFetch] Error fetching ${symbol}: ${response.status}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      const data: CoinbaseCandle[] = await response.json();
      
      for (const candle of data) {
        candles.push({
          timestamp: candle[0] * 1000,
          open: candle[3],
          high: candle[2],
          low: candle[1],
          close: candle[4],
          volume: candle[5],
        });
      }
      
      console.log(`[DataFetch] ${symbol}: Fetched ${data.length} candles, total: ${candles.length}`);
      
    } catch (error) {
      console.error(`[DataFetch] Error:`, error);
    }
    
    currentStart = currentEnd;
    await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
  }
  
  // Sort by timestamp ascending
  candles.sort((a, b) => a.timestamp - b.timestamp);
  
  return candles;
}

/**
 * Generate report
 */
function generateReport(result: BacktestResult): string {
  const { config, metrics, trades, validation, strategyPerformance, verdict, verdictReason } = result;
  
  let report = `
================================================================================
                    SEER A++ INSTITUTIONAL GRADE BACKTEST
                         PHASE 1: DRY RUN VALIDATION
================================================================================

CONFIGURATION
--------------------------------------------------------------------------------
Period:           ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}
Symbols:          ${config.symbols.join(', ')}
Initial Capital:  $${config.initialCapital.toLocaleString()}
Max Risk/Trade:   ${(config.maxRiskPerTrade * 100).toFixed(1)}%
Max Drawdown:     ${(config.maxDrawdown * 100).toFixed(1)}%
Max Positions:    ${config.maxPositions}
Slippage:         ${config.slippagePercent}%
Fees:             ${config.feePercent}%

VALIDATION RESULTS
--------------------------------------------------------------------------------
Status:           ${validation.isValid ? '✅ PASSED' : '❌ FAILED'}
Strategies:       ${validation.strategiesValidated} validated
Agents:           ${validation.agentsValidated} validated
Duplicates:       ${validation.duplicatesDetected} detected
Budget Violations: ${validation.budgetViolations}
Risk Violations:  ${validation.riskViolations}

${validation.errors.length > 0 ? `ERRORS:\n${validation.errors.map(e => `  ❌ ${e}`).join('\n')}` : ''}
${validation.warnings.length > 0 ? `WARNINGS:\n${validation.warnings.map(w => `  ⚠️ ${w}`).join('\n')}` : ''}

PERFORMANCE METRICS
--------------------------------------------------------------------------------
Total Trades:     ${metrics.totalTrades}
Winning Trades:   ${metrics.winningTrades} (${metrics.winRate.toFixed(2)}%)
Losing Trades:    ${metrics.losingTrades}

Total P&L:        $${metrics.totalPnL.toFixed(2)} (${metrics.totalPnLPercent.toFixed(2)}%)
Max Drawdown:     ${metrics.maxDrawdownPercent.toFixed(2)}%

Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(2)}
Sortino Ratio:    ${metrics.sortinoRatio.toFixed(2)}
Profit Factor:    ${metrics.profitFactor.toFixed(2)}

Avg Win:          $${metrics.avgWin.toFixed(2)}
Avg Loss:         $${metrics.avgLoss.toFixed(2)}
Largest Win:      $${metrics.largestWin.toFixed(2)}
Largest Loss:     $${metrics.largestLoss.toFixed(2)}

Avg Hold Time:    ${metrics.avgHoldTime.toFixed(2)} hours
Trade Frequency:  ${metrics.tradeFrequency.toFixed(2)} trades/day
Capital Util:     ${metrics.capitalUtilization.toFixed(2)}%

Consec. Wins:     ${metrics.consecutiveWins}
Consec. Losses:   ${metrics.consecutiveLosses}

STRATEGY PERFORMANCE (Top 10)
--------------------------------------------------------------------------------
`;

  const topStrategies = strategyPerformance.slice(0, 10);
  report += 'Strategy                          Trades   Win%      P&L      Sharpe\n';
  report += '─'.repeat(70) + '\n';
  
  for (const strat of topStrategies) {
    report += `${strat.strategyName.padEnd(32)} ${strat.trades.toString().padStart(6)} ${strat.winRate.toFixed(1).padStart(6)}% $${strat.pnl.toFixed(2).padStart(9)} ${strat.sharpe.toFixed(2).padStart(8)}\n`;
  }

  report += `
TRADE LOG (Last 20 Trades)
--------------------------------------------------------------------------------
`;

  const lastTrades = trades.slice(-20);
  report += 'ID              Symbol    Side   Entry      Exit       P&L      Strategy\n';
  report += '─'.repeat(80) + '\n';
  
  for (const trade of lastTrades) {
    const pnlStr = trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`;
    report += `${trade.id.slice(0, 14).padEnd(15)} ${trade.symbol.padEnd(9)} ${trade.side.padEnd(6)} $${trade.entryPrice.toFixed(2).padStart(9)} $${trade.exitPrice.toFixed(2).padStart(9)} ${pnlStr.padStart(9)} ${trade.strategy.slice(0, 20)}\n`;
  }

  report += `
================================================================================
                              FINAL VERDICT
================================================================================

${verdict === 'A_PLUS_PLUS_INSTITUTIONAL' ? '✅ A++ INSTITUTIONAL GRADE' : verdict === 'NEEDS_IMPROVEMENT' ? '⚠️ NEEDS IMPROVEMENT' : '❌ NOT PRODUCTION-READY'}

Reason: ${verdictReason}

================================================================================
                           END OF PHASE 1 REPORT
================================================================================
`;

  return report;
}

/**
 * Main execution
 */
async function runPhase1DryRun(): Promise<BacktestResult> {
  console.log('='.repeat(80));
  console.log('SEER A++ INSTITUTIONAL GRADE BACKTEST - PHASE 1: DRY RUN');
  console.log('='.repeat(80));
  
  // Configuration for Phase 1 (1 week)
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  
  const config: BacktestConfig = {
    startDate,
    endDate,
    symbols: ['BTC-USD', 'ETH-USD'],
    initialCapital: 50000, // $50,000 paper wallet
    maxRiskPerTrade: 0.02, // 2% max risk per trade
    maxDrawdown: 0.15, // 15% max drawdown
    maxPositions: 10,
    slippagePercent: 0.1, // 0.1% slippage
    feePercent: 0.25, // 0.25% fee per side (0.5% round trip)
  };
  
  console.log(`\n[Phase1] Configuration:`);
  console.log(`  Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`  Symbols: ${config.symbols.join(', ')}`);
  console.log(`  Initial Capital: $${config.initialCapital.toLocaleString()}`);
  
  // Fetch historical data
  console.log(`\n[Phase1] Fetching historical data...`);
  const priceData = new Map<string, OHLCV[]>();
  
  for (const symbol of config.symbols) {
    const candles = await fetchHistoricalData(symbol, startDate, endDate, 300); // 5-minute candles
    priceData.set(symbol, candles);
    console.log(`[Phase1] ${symbol}: ${candles.length} candles loaded`);
  }
  
  // Create and run backtest engine
  console.log(`\n[Phase1] Running backtest...`);
  const engine = new BacktestEngine(config);
  
  // Listen for events
  engine.on('trade_opened', (trade) => {
    console.log(`[Trade] OPENED: ${trade.symbol} ${trade.side.toUpperCase()} @ $${trade.entryPrice.toFixed(2)} (${trade.strategy})`);
  });
  
  engine.on('trade_closed', (trade) => {
    const pnlStr = trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`;
    console.log(`[Trade] CLOSED: ${trade.symbol} ${trade.side.toUpperCase()} @ $${trade.exitPrice.toFixed(2)} | P&L: ${pnlStr}`);
  });
  
  const result = await engine.run(priceData);
  
  // Generate and print report
  const report = generateReport(result);
  console.log(report);
  
  // Save report to file
  const reportPath = `/home/ubuntu/seer/docs/PHASE1_DRY_RUN_REPORT_${new Date().toISOString().split('T')[0]}.txt`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, report);
  console.log(`\n[Phase1] Report saved to: ${reportPath}`);
  
  return result;
}

// Export for use in other modules
export { runPhase1DryRun, fetchHistoricalData, generateReport };

// Run if executed directly
if (require.main === module) {
  runPhase1DryRun()
    .then(result => {
      console.log(`\n[Phase1] Backtest completed with verdict: ${result.verdict}`);
      process.exit(result.validation.isValid ? 0 : 1);
    })
    .catch(error => {
      console.error('[Phase1] Fatal error:', error);
      process.exit(1);
    });
}
