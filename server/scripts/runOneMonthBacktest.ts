/**
 * Run One-Month Comprehensive Backtest
 * 
 * Usage: npx tsx server/scripts/runOneMonthBacktest.ts
 */

import { runOneMonthBacktest, BacktestResult } from '../backtest/OneMonthComprehensiveBacktest';
import * as fs from 'fs';

async function main() {
  console.log('Starting SEER Platform 1-Month Comprehensive Backtest...\n');
  
  const startTime = Date.now();
  
  try {
    // Run backtest with December 2025 data
    const result = await runOneMonthBacktest({
      startDate: new Date('2025-12-01T00:00:00Z'),
      endDate: new Date('2025-12-31T00:00:00Z'),
      symbols: ['BTC-USD', 'ETH-USD'],
      initialCapital: 50000,
      
      // Adjusted thresholds for realistic backtest (will compare against A++ targets)
      consensusThreshold: 0.30,  // Lower to generate trades, then analyze quality
      confidenceThreshold: 0.50,  // Lower to generate trades
      minAgentsRequired: 3,  // Lower to generate trades
      alphaThreshold: 0.60,  // Lower alpha threshold
      
      // Position sizing
      basePositionPercent: 0.05,
      maxPositionPercent: 0.20,
      
      // Exit strategy
      stopLossPercent: 0.05,
      takeProfitPercent: 0.10,
      
      // Enable macro veto
      enableMacroVeto: true,
    });
    
    const duration = (Date.now() - startTime) / 1000;
    
    // Print results
    printResults(result, duration);
    
    // Save results to file
    const outputPath = `/home/ubuntu/seer/backtest_results_${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
    
    // Generate markdown report
    const reportPath = `/home/ubuntu/seer/BACKTEST_REPORT_${new Date().toISOString().split('T')[0]}.md`;
    fs.writeFileSync(reportPath, generateMarkdownReport(result, duration));
    console.log(`Report saved to: ${reportPath}`);
    
  } catch (error) {
    console.error('Backtest failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

function printResults(result: BacktestResult, duration: number) {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    SEER PLATFORM BACKTEST RESULTS                            ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Period: ${result.period.start.toISOString().split('T')[0]} to ${result.period.end.toISOString().split('T')[0]}`.padEnd(79) + '║');
  console.log(`║  Duration: ${duration.toFixed(1)} seconds`.padEnd(79) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║                              GRADE: ' + result.grade.padEnd(41) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  PERFORMANCE METRICS                                                         ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Initial Capital:    $${result.initialCapital.toLocaleString()}`.padEnd(79) + '║');
  console.log(`║  Final Capital:      $${result.finalCapital.toLocaleString()}`.padEnd(79) + '║');
  console.log(`║  Total P&L:          $${result.totalPnl.toFixed(2)} (${result.totalPnlPercent.toFixed(2)}%)`.padEnd(79) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  A++ GRADE METRICS                                                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Win Rate:           ${(result.winRate * 100).toFixed(1)}% (Target: 65%)`.padEnd(79) + '║');
  console.log(`║  Profit Factor:      ${result.profitFactor.toFixed(2)} (Target: 2.0)`.padEnd(79) + '║');
  console.log(`║  Sharpe Ratio:       ${result.sharpeRatio.toFixed(2)} (Target: 1.5)`.padEnd(79) + '║');
  console.log(`║  Max Drawdown:       ${(result.maxDrawdown * 100).toFixed(1)}% (Target: <10%)`.padEnd(79) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  TRADE STATISTICS                                                            ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Trades:       ${result.totalTrades}`.padEnd(79) + '║');
  console.log(`║  Winning Trades:     ${result.winningTrades}`.padEnd(79) + '║');
  console.log(`║  Losing Trades:      ${result.losingTrades}`.padEnd(79) + '║');
  console.log(`║  Avg Win:            $${result.avgWin.toFixed(2)}`.padEnd(79) + '║');
  console.log(`║  Avg Loss:           $${result.avgLoss.toFixed(2)}`.padEnd(79) + '║');
  console.log(`║  Avg Hold Time:      ${result.avgHoldTime.toFixed(1)} minutes`.padEnd(79) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  GAPS IDENTIFIED                                                             ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  for (const gap of result.gaps.slice(0, 5)) {
    console.log(`║  • ${gap}`.padEnd(79) + '║');
  }
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  RECOMMENDED IMPROVEMENTS                                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  for (const improvement of result.improvements.slice(0, 5)) {
    console.log(`║  • ${improvement}`.padEnd(79) + '║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
}

function generateMarkdownReport(result: BacktestResult, duration: number): string {
  let report = `# SEER Platform Comprehensive Backtest Report

## Executive Summary

| Metric | Value | Target (A++) | Status |
|--------|-------|--------------|--------|
| **Grade** | ${result.grade} | A++ | ${result.grade === 'A++' ? '✅' : '⚠️'} |
| **Win Rate** | ${(result.winRate * 100).toFixed(1)}% | ≥65% | ${result.winRate >= 0.65 ? '✅' : '❌'} |
| **Profit Factor** | ${result.profitFactor.toFixed(2)} | ≥2.0 | ${result.profitFactor >= 2.0 ? '✅' : '❌'} |
| **Sharpe Ratio** | ${result.sharpeRatio.toFixed(2)} | ≥1.5 | ${result.sharpeRatio >= 1.5 ? '✅' : '❌'} |
| **Max Drawdown** | ${(result.maxDrawdown * 100).toFixed(1)}% | ≤10% | ${result.maxDrawdown <= 0.10 ? '✅' : '❌'} |

## Backtest Configuration

- **Period:** ${result.period.start.toISOString().split('T')[0]} to ${result.period.end.toISOString().split('T')[0]}
- **Symbols:** ${result.config.symbols.join(', ')}
- **Initial Capital:** $${result.initialCapital.toLocaleString()}
- **Consensus Threshold:** ${(result.config.consensusThreshold * 100).toFixed(0)}%
- **Confidence Threshold:** ${(result.config.confidenceThreshold * 100).toFixed(0)}%
- **Min Agents Required:** ${result.config.minAgentsRequired}
- **Macro Veto:** ${result.config.enableMacroVeto ? 'Enabled' : 'Disabled'}

## Performance Results

### Capital Performance

| Metric | Value |
|--------|-------|
| Initial Capital | $${result.initialCapital.toLocaleString()} |
| Final Capital | $${result.finalCapital.toLocaleString()} |
| Total P&L | $${result.totalPnl.toFixed(2)} |
| Total Return | ${result.totalPnlPercent.toFixed(2)}% |

### Trade Statistics

| Metric | Value |
|--------|-------|
| Total Trades | ${result.totalTrades} |
| Winning Trades | ${result.winningTrades} |
| Losing Trades | ${result.losingTrades} |
| Win Rate | ${(result.winRate * 100).toFixed(1)}% |
| Average Win | $${result.avgWin.toFixed(2)} |
| Average Loss | $${result.avgLoss.toFixed(2)} |
| Profit Factor | ${result.profitFactor.toFixed(2)} |
| Average Hold Time | ${result.avgHoldTime.toFixed(1)} minutes |

## Workflow Analysis

### Step 1: Agent Signal Generation

The backtest simulated signals from 6 core agents:
- **TechnicalAnalyst:** RSI, MACD, Moving Averages
- **PatternMatcher:** Candlestick patterns (engulfing, hammer, shooting star)
- **OrderFlowAnalyst:** Volume analysis and divergence detection
- **SentimentAnalyst:** Price-based sentiment simulation
- **MacroAnalyst:** Trend analysis with SMA50/SMA200
- **WhaleTracker:** Volume spike detection

### Step 2: Consensus Mechanism

- Fast agents (Technical, Pattern, OrderFlow) provide primary signals
- Slow agents (Sentiment, Macro) provide confirmation bonus
- Weighted voting based on historical agent accuracy
- Macro veto can override consensus for counter-trend trades

### Step 3: Trade Entry

Quality gate requirements:
- Consensus score ≥ ${(result.config.consensusThreshold * 100).toFixed(0)}%
- Average confidence ≥ ${(result.config.confidenceThreshold * 100).toFixed(0)}%
- Minimum ${result.config.minAgentsRequired} agents with non-neutral signals
- No active macro veto

### Step 4: Trade Management

- Breakeven activation at ${result.config.breakevenActivationPercent}% profit
- Partial profit taking at ${result.config.partialProfitLevels.map(l => l.pnlPercent + '%').join(', ')}
- Trailing stop activation at ${result.config.trailingActivationPercent}%

### Step 5: Trade Exit

Exit triggers:
- Stop loss: ${(result.config.stopLossPercent * 100).toFixed(0)}%
- Take profit: ${(result.config.takeProfitPercent * 100).toFixed(0)}%
- Trailing stop: ${result.config.trailingPercent}%
- Max hold time: ${result.config.maxHoldTimeMinutes} minutes

## Performance by Market Regime

| Regime | Trades | Win Rate | P&L |
|--------|--------|----------|-----|
${Object.entries(result.tradesByRegime).map(([regime, stats]) => 
  `| ${regime} | ${stats.trades} | ${(stats.winRate * 100).toFixed(1)}% | $${stats.pnl.toFixed(2)} |`
).join('\n')}

## Agent Performance Analysis

| Agent | Trades | Win Rate | Accuracy | P&L |
|-------|--------|----------|----------|-----|
${Object.entries(result.tradesByAgent).map(([agent, stats]) => 
  `| ${agent} | ${stats.trades} | ${(stats.winRate * 100).toFixed(1)}% | ${(stats.accuracy * 100).toFixed(1)}% | $${stats.pnl.toFixed(2)} |`
).join('\n')}

## Winning Trade Factors

${Object.entries(result.winningTradeFactors).sort((a, b) => b[1] - a[1]).map(([factor, count]) => 
  `- **${factor}:** ${count} occurrences`
).join('\n')}

## Losing Trade Factors

${Object.entries(result.losingTradeFactors).sort((a, b) => b[1] - a[1]).map(([factor, count]) => 
  `- **${factor}:** ${count} occurrences`
).join('\n')}

## Gaps Identified

${result.gaps.map(gap => `1. ${gap}`).join('\n')}

## Recommended Improvements

${result.improvements.map(imp => `1. ${imp}`).join('\n')}

## Individual Trade Analysis

### Top 5 Winning Trades

${result.trades
  .filter(t => (t.pnl || 0) > 0)
  .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))
  .slice(0, 5)
  .map((t, i) => `
#### Trade ${i + 1}: ${t.symbol} ${t.direction.toUpperCase()}
- **Entry:** $${t.entryPrice.toFixed(2)} at ${t.entryTime.toISOString()}
- **Exit:** $${t.exitPrice?.toFixed(2)} at ${t.exitTime?.toISOString()}
- **P&L:** $${t.pnl?.toFixed(2)} (${t.pnlPercent?.toFixed(2)}%)
- **Exit Reason:** ${t.exitReason}
- **Consensus:** ${(t.consensus * 100).toFixed(1)}%
- **Regime:** ${t.regime}
- **Winning Factors:** ${t.winningFactors?.join(', ') || 'None identified'}
`).join('\n')}

### Top 5 Losing Trades

${result.trades
  .filter(t => (t.pnl || 0) < 0)
  .sort((a, b) => (a.pnl || 0) - (b.pnl || 0))
  .slice(0, 5)
  .map((t, i) => `
#### Trade ${i + 1}: ${t.symbol} ${t.direction.toUpperCase()}
- **Entry:** $${t.entryPrice.toFixed(2)} at ${t.entryTime.toISOString()}
- **Exit:** $${t.exitPrice?.toFixed(2)} at ${t.exitTime?.toISOString()}
- **P&L:** $${t.pnl?.toFixed(2)} (${t.pnlPercent?.toFixed(2)}%)
- **Exit Reason:** ${t.exitReason}
- **Consensus:** ${(t.consensus * 100).toFixed(1)}%
- **Regime:** ${t.regime}
- **Losing Factors:** ${t.losingFactors?.join(', ') || 'None identified'}
`).join('\n')}

## Conclusion

The SEER platform achieved a grade of **${result.grade}** during the 1-month backtest period.

${result.grade === 'A++' 
  ? 'The platform meets all A++ grade requirements and is performing at institutional-grade level.'
  : `To achieve A++ grade, the following improvements are critical:
${result.improvements.slice(0, 3).map(imp => `- ${imp}`).join('\n')}`
}

---

*Report generated: ${new Date().toISOString()}*
*Backtest duration: ${duration.toFixed(1)} seconds*
`;

  return report;
}

main();
