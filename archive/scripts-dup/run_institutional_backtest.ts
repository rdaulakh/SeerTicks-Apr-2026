/**
 * Institutional Grade Backtest Runner
 * 
 * Runs the backtest simulation and generates comprehensive reports
 */

import { runInstitutionalBacktest, BacktestResults } from '../server/backtest/InstitutionalBacktestEngine';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('='.repeat(80));
  console.log('SEER INSTITUTIONAL GRADE BACKTEST');
  console.log('='.repeat(80));
  console.log('');
  
  // Run backtest for BTC-USD
  console.log('Running backtest for BTC-USD...');
  const btcResults = await runInstitutionalBacktest('BTC-USD', {
    initialCapital: 10000,
    consensusThreshold: 0.5,
    minAgentAgreement: 2,
    stopLossPercent: 2.0,
    takeProfitPercent: 4.0,
    maxHoldPeriod: 72,
    useTrailingStop: true,
    trailingStopPercent: 1.5,
  });
  
  // Run backtest for ETH-USD
  console.log('\nRunning backtest for ETH-USD...');
  const ethResults = await runInstitutionalBacktest('ETH-USD', {
    initialCapital: 10000,
    consensusThreshold: 0.5,
    minAgentAgreement: 2,
    stopLossPercent: 2.0,
    takeProfitPercent: 4.0,
    maxHoldPeriod: 72,
    useTrailingStop: true,
    trailingStopPercent: 1.5,
  });
  
  // Generate report
  const report = generateReport(btcResults, ethResults);
  
  // Save report
  const reportPath = path.join(__dirname, '../docs/BACKTEST_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport saved to: ${reportPath}`);
  
  // Save raw results as JSON
  const resultsPath = path.join(__dirname, '../docs/backtest_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ btc: btcResults, eth: ethResults }, null, 2));
  console.log(`Raw results saved to: ${resultsPath}`);
  
  // Print summary
  printSummary(btcResults, ethResults);
}

function generateReport(btcResults: BacktestResults, ethResults: BacktestResults): string {
  const now = new Date().toISOString();
  
  return `# SEER Institutional Grade Backtest Report

**Generated**: ${now}

## Executive Summary

This report presents the results of a comprehensive backtest simulation of the SEER trading system. The backtest properly classifies agents into three categories (ACTIVE, PROXY, SHADOW) and simulates the complete trading workflow.

### Key Findings

| Metric | BTC-USD | ETH-USD |
|--------|---------|---------|
| Total Trades | ${btcResults.metrics.totalTrades} | ${ethResults.metrics.totalTrades} |
| Win Rate | ${btcResults.metrics.winRate.toFixed(1)}% | ${ethResults.metrics.winRate.toFixed(1)}% |
| Total P&L | $${btcResults.metrics.totalPnL.toFixed(2)} | $${ethResults.metrics.totalPnL.toFixed(2)} |
| Total P&L % | ${btcResults.metrics.totalPnLPercent.toFixed(2)}% | ${ethResults.metrics.totalPnLPercent.toFixed(2)}% |
| Max Drawdown | ${btcResults.metrics.maxDrawdownPercent.toFixed(2)}% | ${ethResults.metrics.maxDrawdownPercent.toFixed(2)}% |
| Sharpe Ratio | ${btcResults.metrics.sharpeRatio.toFixed(2)} | ${ethResults.metrics.sharpeRatio.toFixed(2)} |
| Profit Factor | ${btcResults.metrics.profitFactor.toFixed(2)} | ${ethResults.metrics.profitFactor.toFixed(2)} |
| Final Equity | $${btcResults.metrics.finalEquity.toFixed(2)} | $${ethResults.metrics.finalEquity.toFixed(2)} |

## Backtest Configuration

| Parameter | Value |
|-----------|-------|
| Initial Capital | $${btcResults.config.initialCapital.toLocaleString()} |
| Consensus Threshold | ${(btcResults.config.consensusThreshold * 100).toFixed(0)}% |
| Min Agent Agreement | ${btcResults.config.minAgentAgreement} agents |
| Stop Loss | ${btcResults.config.stopLossPercent}% |
| Take Profit | ${btcResults.config.takeProfitPercent}% |
| Max Hold Period | ${btcResults.config.maxHoldPeriod} hours |
| Trailing Stop | ${btcResults.config.useTrailingStop ? `Yes (${btcResults.config.trailingStopPercent}%)` : 'No'} |
| Backtest Period | ${btcResults.config.startDate.toISOString().split('T')[0]} to ${btcResults.config.endDate.toISOString().split('T')[0]} |

## Agent Classification & Performance

### Agent Modes Used

| Agent | Mode | Max Weight | Performance |
|-------|------|------------|-------------|
${btcResults.agentPerformance.map(a => 
  `| ${a.agentName} | ${a.mode} | ${a.mode === 'SHADOW' ? '0%' : a.mode === 'ACTIVE' ? '100%' : '10-15%'} | ${a.recommendation.replace(/_/g, ' ')} |`
).join('\n')}

### Agent Signal Analysis (BTC-USD)

| Agent | Total Signals | Bullish | Bearish | Neutral | Alignment Rate | Recommendation |
|-------|---------------|---------|---------|---------|----------------|----------------|
${btcResults.agentPerformance.map(a => 
  `| ${a.agentName} | ${a.totalSignals} | ${a.bullishSignals} | ${a.bearishSignals} | ${a.neutralSignals} | ${(a.alignmentRate * 100).toFixed(1)}% | ${a.recommendation.replace(/_/g, ' ')} |`
).join('\n')}

## Trading Performance Details

### BTC-USD Performance

- **Winning Trades**: ${btcResults.metrics.winningTrades}
- **Losing Trades**: ${btcResults.metrics.losingTrades}
- **Average Win**: $${btcResults.metrics.averageWin.toFixed(2)}
- **Average Loss**: $${btcResults.metrics.averageLoss.toFixed(2)}
- **Largest Win**: $${btcResults.metrics.largestWin.toFixed(2)}
- **Largest Loss**: $${btcResults.metrics.largestLoss.toFixed(2)}
- **Average Hold Time**: ${btcResults.metrics.averageHoldTime.toFixed(1)} hours

### ETH-USD Performance

- **Winning Trades**: ${ethResults.metrics.winningTrades}
- **Losing Trades**: ${ethResults.metrics.losingTrades}
- **Average Win**: $${ethResults.metrics.averageWin.toFixed(2)}
- **Average Loss**: $${ethResults.metrics.averageLoss.toFixed(2)}
- **Largest Win**: $${ethResults.metrics.largestWin.toFixed(2)}
- **Largest Loss**: $${ethResults.metrics.largestLoss.toFixed(2)}
- **Average Hold Time**: ${ethResults.metrics.averageHoldTime.toFixed(1)} hours

## Monthly P&L Breakdown

### BTC-USD

| Month | P&L | P&L % | Trades | Win Rate |
|-------|-----|-------|--------|----------|
${btcResults.monthlyPnL.map(m => 
  `| ${m.month} | $${m.pnl.toFixed(2)} | ${m.pnlPercent.toFixed(2)}% | ${m.trades} | ${m.winRate.toFixed(1)}% |`
).join('\n')}

### ETH-USD

| Month | P&L | P&L % | Trades | Win Rate |
|-------|-----|-------|--------|----------|
${ethResults.monthlyPnL.map(m => 
  `| ${m.month} | $${m.pnl.toFixed(2)} | ${m.pnlPercent.toFixed(2)}% | ${m.trades} | ${m.winRate.toFixed(1)}% |`
).join('\n')}

## Drawdown Analysis

### BTC-USD Top 3 Drawdowns

| Start | End | Drawdown | Recovery (hours) |
|-------|-----|----------|------------------|
${btcResults.drawdowns.slice(0, 3).map(d => 
  `| ${d.startDate.toISOString().split('T')[0]} | ${d.endDate.toISOString().split('T')[0]} | ${d.drawdownPercent.toFixed(2)}% | ${d.recoveryCandles === -1 ? 'Ongoing' : d.recoveryCandles} |`
).join('\n')}

### ETH-USD Top 3 Drawdowns

| Start | End | Drawdown | Recovery (hours) |
|-------|-----|----------|------------------|
${ethResults.drawdowns.slice(0, 3).map(d => 
  `| ${d.startDate.toISOString().split('T')[0]} | ${d.endDate.toISOString().split('T')[0]} | ${d.drawdownPercent.toFixed(2)}% | ${d.recoveryCandles === -1 ? 'Ongoing' : d.recoveryCandles} |`
).join('\n')}

## Recommendations

### What is Working (DO NOT TOUCH)

${btcResults.agentPerformance.filter(a => a.recommendation === 'keep_active').map(a => `- **${a.agentName}**: ${(a.alignmentRate * 100).toFixed(1)}% alignment rate, generating actionable signals`).join('\n')}

### What Requires Proxy Simulation

${btcResults.agentPerformance.filter(a => a.recommendation === 'add_proxy').map(a => `- **${a.agentName}**: Current proxy logic needs improvement (${(a.alignmentRate * 100).toFixed(1)}% alignment)`).join('\n') || '- No agents require proxy improvements'}

### What Must Be Validated in Live Trading

${btcResults.agentPerformance.filter(a => a.recommendation === 'live_validation_only').map(a => `- **${a.agentName}**: Shadow mode - requires live API data for accurate signals`).join('\n')}

### Safe Tuning vs Overfitting Risk

**Safe to Tune:**
- Consensus threshold (currently ${(btcResults.config.consensusThreshold * 100).toFixed(0)}%)
- Position sizing tiers
- Stop loss / take profit ratios

**Overfitting Risk:**
- Agent-specific weights (limited data)
- Pattern recognition parameters
- Indicator periods (RSI, MACD, etc.)

## Conclusion

${generateConclusion(btcResults, ethResults)}

---

*This report was generated by the SEER Institutional Grade Backtest Engine*
`;
}

function generateConclusion(btcResults: BacktestResults, ethResults: BacktestResults): string {
  const combinedPnL = btcResults.metrics.totalPnL + ethResults.metrics.totalPnL;
  const avgWinRate = (btcResults.metrics.winRate + ethResults.metrics.winRate) / 2;
  const maxDD = Math.max(btcResults.metrics.maxDrawdownPercent, ethResults.metrics.maxDrawdownPercent);
  
  let verdict = '';
  
  if (combinedPnL > 0 && avgWinRate > 50 && maxDD < 20) {
    verdict = '✅ **VERDICT: SYSTEM PERFORMING WELL**\n\nThe backtest shows positive returns with acceptable drawdowns. The agent classification is working correctly, with ACTIVE agents generating actionable signals and PROXY agents providing supplementary information.';
  } else if (combinedPnL > 0 || avgWinRate > 45) {
    verdict = '⚠️ **VERDICT: SYSTEM NEEDS OPTIMIZATION**\n\nThe backtest shows mixed results. Consider:\n1. Adjusting consensus thresholds\n2. Improving proxy logic for API-dependent agents\n3. Reviewing position sizing tiers';
  } else {
    verdict = '❌ **VERDICT: SYSTEM NEEDS SIGNIFICANT IMPROVEMENTS**\n\nThe backtest shows concerning results. Recommended actions:\n1. Review agent signal quality\n2. Increase consensus threshold\n3. Implement stricter risk management\n4. Consider reducing position sizes';
  }
  
  return verdict + `

**Data Limitation Note**: This backtest uses ~2.5 months of historical data (Oct 15, 2025 - Jan 1, 2026). Results should be validated with longer historical periods when available. The user mentioned 2 years of data, but the database currently contains limited data.

**API-Dependent Agents**: WhaleTracker, FundingRateAnalyst, LiquidationHeatmap, and other API-dependent agents used proxy logic during this backtest. Their actual live performance may differ.

**Shadow Agents**: NewsSentinel, SentimentAnalyst, and MacroAnalyst ran in shadow mode and did not influence trading decisions. These agents require live validation.`;
}

function printSummary(btcResults: BacktestResults, ethResults: BacktestResults): void {
  console.log('\n' + '='.repeat(80));
  console.log('BACKTEST SUMMARY');
  console.log('='.repeat(80));
  
  console.log('\n📊 BTC-USD Results:');
  console.log(`   Total Trades: ${btcResults.metrics.totalTrades}`);
  console.log(`   Win Rate: ${btcResults.metrics.winRate.toFixed(1)}%`);
  console.log(`   Total P&L: $${btcResults.metrics.totalPnL.toFixed(2)} (${btcResults.metrics.totalPnLPercent.toFixed(2)}%)`);
  console.log(`   Max Drawdown: ${btcResults.metrics.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`   Sharpe Ratio: ${btcResults.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`   Final Equity: $${btcResults.metrics.finalEquity.toFixed(2)}`);
  
  console.log('\n📊 ETH-USD Results:');
  console.log(`   Total Trades: ${ethResults.metrics.totalTrades}`);
  console.log(`   Win Rate: ${ethResults.metrics.winRate.toFixed(1)}%`);
  console.log(`   Total P&L: $${ethResults.metrics.totalPnL.toFixed(2)} (${ethResults.metrics.totalPnLPercent.toFixed(2)}%)`);
  console.log(`   Max Drawdown: ${ethResults.metrics.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`   Sharpe Ratio: ${ethResults.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`   Final Equity: $${ethResults.metrics.finalEquity.toFixed(2)}`);
  
  console.log('\n📈 Combined Results:');
  const combinedPnL = btcResults.metrics.totalPnL + ethResults.metrics.totalPnL;
  const combinedPnLPercent = (combinedPnL / 20000) * 100;
  console.log(`   Combined P&L: $${combinedPnL.toFixed(2)} (${combinedPnLPercent.toFixed(2)}%)`);
  console.log(`   Combined Final Equity: $${(btcResults.metrics.finalEquity + ethResults.metrics.finalEquity).toFixed(2)}`);
  
  // Verdict
  console.log('\n' + '='.repeat(80));
  if (combinedPnL > 0 && btcResults.metrics.winRate > 45 && ethResults.metrics.winRate > 45) {
    console.log('✅ VERDICT: System is performing well');
  } else if (combinedPnL > 0) {
    console.log('⚠️ VERDICT: System needs optimization');
  } else {
    console.log('❌ VERDICT: System needs significant improvements');
  }
  console.log('='.repeat(80));
}

main().catch(console.error);
