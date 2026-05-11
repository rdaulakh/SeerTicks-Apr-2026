/**
 * Phase 1 A++ V3 Backtest Runner
 * 
 * Tests all fixes:
 * 1. Agent-driven intelligent exit (no static stop-loss)
 * 2. 60% consensus threshold
 * 3. Dynamic position sizing based on confidence
 * 4. Partial profit taking
 * 5. Strategy-regime matching
 * 6. Breakeven protection
 */

import { BacktestEngineAPlusPlusV3, Candle, AgentSignal } from './BacktestEngineA++V3';
import { getActiveClock } from '../_core/clock';

// Fetch real historical data from Coinbase
async function fetchCoinbaseCandles(symbol: string, days: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  const endTime = Math.floor(getActiveClock().now() / 1000);
  const startTime = endTime - (days * 24 * 60 * 60);
  
  console.log(`Fetching ${days} days of ${symbol} data from Coinbase...`);
  
  // Fetch in chunks (300 candles max per request)
  const granularity = 3600; // 1 hour candles
  const maxCandles = 300;
  let currentEnd = endTime;
  
  while (currentEnd > startTime) {
    const currentStart = Math.max(startTime, currentEnd - (maxCandles * granularity));
    
    const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}&start=${currentStart}&end=${currentEnd}`;
    
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SEER-Backtest/1.0' }
      });
      
      if (!response.ok) {
        console.error(`API error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        for (const row of data) {
          candles.push({
            timestamp: row[0] * 1000,
            low: row[1],
            high: row[2],
            open: row[3],
            close: row[4],
            volume: row[5],
          });
        }
      }
      
      currentEnd = currentStart - granularity;
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (err) {
      console.error(`Fetch error:`, err);
      break;
    }
  }
  
  // Sort by timestamp ascending
  candles.sort((a, b) => a.timestamp - b.timestamp);
  
  console.log(`Fetched ${candles.length} candles for ${symbol}`);
  return candles;
}

// Calculate technical indicators
function calculateIndicators(candles: Candle[]): {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bb: { upper: number; middle: number; lower: number; percentB: number };
  sma20: number;
  sma50: number;
  atr: number;
  adx: number;
  momentum: number;
} {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // RSI (14 period)
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  const rsi = 100 - (100 / (1 + rs));
  
  // MACD (12, 26, 9)
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const macdHistory = [];
  for (let i = 26; i < closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i + 1), 12);
    const e26 = calculateEMA(closes.slice(0, i + 1), 26);
    macdHistory.push(e12 - e26);
  }
  const signalLine = macdHistory.length >= 9 ? calculateEMA(macdHistory, 9) : macdLine;
  const histogram = macdLine - signalLine;
  
  // Bollinger Bands (20, 2)
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const stdDev = Math.sqrt(closes.slice(-20).reduce((sum, c) => sum + Math.pow(c - sma20, 2), 0) / 20);
  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const percentB = (closes[closes.length - 1] - bbLower) / (bbUpper - bbLower);
  
  // SMA 50
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : sma20;
  
  // ATR (14 period)
  let atr = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    atr += tr;
  }
  atr /= 14;
  
  // Simplified ADX
  const adx = Math.abs(closes[closes.length - 1] - sma50) / sma50 * 100 * 5;
  
  // Momentum
  const momentum = closes.length >= 10 
    ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
    : 0;
  
  return {
    rsi,
    macd: { macd: macdLine, signal: signalLine, histogram },
    bb: { upper: bbUpper, middle: sma20, lower: bbLower, percentB },
    sma20,
    sma50,
    atr,
    adx,
    momentum,
  };
}

function calculateEMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

// Generate agent signals based on indicators
function generateAgentSignals(candle: Candle, history: Candle[]): AgentSignal[] {
  const indicators = calculateIndicators(history);
  const signals: AgentSignal[] = [];
  const currentPrice = candle.close;
  
  // TechnicalAnalyst - RSI, MACD, BB
  {
    let bullishScore = 0;
    let bearishScore = 0;
    
    // RSI
    if (indicators.rsi < 30) bullishScore += 0.3;
    else if (indicators.rsi > 70) bearishScore += 0.3;
    else if (indicators.rsi < 45) bullishScore += 0.1;
    else if (indicators.rsi > 55) bearishScore += 0.1;
    
    // MACD
    if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) bullishScore += 0.3;
    else if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) bearishScore += 0.3;
    
    // Bollinger Bands
    if (indicators.bb.percentB < 0.2) bullishScore += 0.2;
    else if (indicators.bb.percentB > 0.8) bearishScore += 0.2;
    
    // Trend
    if (currentPrice > indicators.sma20 && indicators.sma20 > indicators.sma50) bullishScore += 0.2;
    else if (currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) bearishScore += 0.2;
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'TechnicalAnalyst',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `RSI: ${indicators.rsi.toFixed(1)}, MACD: ${indicators.macd.histogram > 0 ? '+' : ''}${indicators.macd.histogram.toFixed(2)}, BB%: ${(indicators.bb.percentB * 100).toFixed(1)}%`,
    });
  }
  
  // PatternMatcher - Price patterns
  {
    const recentHighs = history.slice(-20).map(c => c.high);
    const recentLows = history.slice(-20).map(c => c.low);
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    // Breakout detection
    if (currentPrice > maxHigh * 0.99) bullishScore += 0.4;
    if (currentPrice < minLow * 1.01) bearishScore += 0.4;
    
    // Higher highs / lower lows
    const prevHigh = Math.max(...history.slice(-10, -5).map(c => c.high));
    const currHigh = Math.max(...history.slice(-5).map(c => c.high));
    if (currHigh > prevHigh) bullishScore += 0.3;
    else if (currHigh < prevHigh) bearishScore += 0.3;
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'PatternMatcher',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `Near ${currentPrice > maxHigh * 0.99 ? 'resistance breakout' : currentPrice < minLow * 1.01 ? 'support breakdown' : 'range'}`,
    });
  }
  
  // OrderFlowAnalyst - Volume and momentum
  {
    const avgVolume = history.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const currentVolume = candle.volume;
    const volumeRatio = currentVolume / avgVolume;
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    // Volume spike with direction
    if (volumeRatio > 1.5) {
      if (candle.close > candle.open) bullishScore += 0.4;
      else bearishScore += 0.4;
    }
    
    // Momentum
    if (indicators.momentum > 2) bullishScore += 0.3;
    else if (indicators.momentum < -2) bearishScore += 0.3;
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'OrderFlowAnalyst',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `Volume: ${volumeRatio.toFixed(2)}x avg, Momentum: ${indicators.momentum.toFixed(2)}%`,
    });
  }
  
  // WhaleTracker - Large moves detection
  {
    const priceChange = ((candle.close - candle.open) / candle.open) * 100;
    const avgChange = history.slice(-20).reduce((sum, c) => sum + Math.abs((c.close - c.open) / c.open), 0) / 20 * 100;
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    if (Math.abs(priceChange) > avgChange * 2) {
      if (priceChange > 0) bullishScore += 0.5;
      else bearishScore += 0.5;
    }
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'WhaleTracker',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `Price change: ${priceChange.toFixed(2)}% vs avg ${avgChange.toFixed(2)}%`,
    });
  }
  
  // VolumeProfileAnalyzer - Support/Resistance
  {
    const prices = history.slice(-50).map(c => c.close);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const distanceFromAvg = ((currentPrice - avgPrice) / avgPrice) * 100;
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    // Mean reversion signal
    if (distanceFromAvg < -3) bullishScore += 0.4;  // Below average = bullish reversion
    else if (distanceFromAvg > 3) bearishScore += 0.4;  // Above average = bearish reversion
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'VolumeProfileAnalyzer',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `Distance from avg: ${distanceFromAvg.toFixed(2)}%`,
    });
  }
  
  // SentimentAnalyst - Trend strength
  {
    let bullishScore = 0;
    let bearishScore = 0;
    
    // ADX trend strength
    if (indicators.adx > 25) {
      if (currentPrice > indicators.sma20) bullishScore += 0.4;
      else bearishScore += 0.4;
    }
    
    const confidence = Math.max(bullishScore, bearishScore);
    const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
    
    signals.push({
      agentName: 'SentimentAnalyst',
      direction,
      confidence: Math.min(confidence, 1),
      reasoning: `ADX: ${indicators.adx.toFixed(1)}, Trend: ${currentPrice > indicators.sma20 ? 'up' : 'down'}`,
    });
  }
  
  return signals;
}

// Main execution
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('SEER A++ INSTITUTIONAL GRADE BACKTEST V3');
  console.log('='.repeat(60));
  console.log('\nFixes Applied:');
  console.log('  ✅ Agent-driven intelligent exit (no static stop-loss)');
  console.log('  ✅ 60% consensus threshold');
  console.log('  ✅ Dynamic position sizing based on confidence');
  console.log('  ✅ Partial profit taking (25% at +1%, +1.5%, +2%)');
  console.log('  ✅ Strategy-regime matching');
  console.log('  ✅ Breakeven protection');
  console.log('  ✅ Trailing stop for remaining position');
  console.log('  ✅ Emergency stop only at -5%');
  console.log('='.repeat(60) + '\n');
  
  // Fetch real data
  const btcCandles = await fetchCoinbaseCandles('BTC-USD', 7);
  const ethCandles = await fetchCoinbaseCandles('ETH-USD', 7);
  
  if (btcCandles.length < 50 || ethCandles.length < 50) {
    console.error('Not enough data fetched. Exiting.');
    return;
  }
  
  // Create engine with A++ settings
  const engine = new BacktestEngineAPlusPlusV3({
    initialCapital: 50000,
    consensusThreshold: 0.60,  // 60% consensus
    basePositionPercent: 0.05,
    maxPositionPercent: 0.20,
    confidenceMultiplier: 2.0,
    breakevenActivationPercent: 0.5,
    breakevenBuffer: 0.1,
    partialProfitLevels: [
      { pnlPercent: 1.0, exitPercent: 25 },
      { pnlPercent: 1.5, exitPercent: 25 },
      { pnlPercent: 2.0, exitPercent: 25 },
    ],
    trailingActivationPercent: 1.5,
    trailingPercent: 0.5,
    emergencyStopPercent: -5.0,
    maxHoldTimeMinutes: 240,
    feePercent: 0.1,
  });
  
  // Run backtest for BTC
  console.log('\n' + '-'.repeat(60));
  console.log('BACKTESTING BTC-USD');
  console.log('-'.repeat(60));
  const btcResult = await engine.runBacktest('BTC-USD', btcCandles, generateAgentSignals);
  
  // Create new engine for ETH
  const engineETH = new BacktestEngineAPlusPlusV3({
    initialCapital: 50000,
    consensusThreshold: 0.60,
    basePositionPercent: 0.05,
    maxPositionPercent: 0.20,
    confidenceMultiplier: 2.0,
    breakevenActivationPercent: 0.5,
    breakevenBuffer: 0.1,
    partialProfitLevels: [
      { pnlPercent: 1.0, exitPercent: 25 },
      { pnlPercent: 1.5, exitPercent: 25 },
      { pnlPercent: 2.0, exitPercent: 25 },
    ],
    trailingActivationPercent: 1.5,
    trailingPercent: 0.5,
    emergencyStopPercent: -5.0,
    maxHoldTimeMinutes: 240,
    feePercent: 0.1,
  });
  
  console.log('\n' + '-'.repeat(60));
  console.log('BACKTESTING ETH-USD');
  console.log('-'.repeat(60));
  const ethResult = await engineETH.runBacktest('ETH-USD', ethCandles, generateAgentSignals);
  
  // Print combined results
  console.log('\n' + '='.repeat(60));
  console.log('FINAL RESULTS - A++ V3 BACKTEST');
  console.log('='.repeat(60));
  
  console.log('\n📊 BTC-USD Results:');
  console.log(`   Total Trades: ${btcResult.totalTrades}`);
  console.log(`   Win Rate: ${(btcResult.winRate * 100).toFixed(2)}%`);
  console.log(`   Total P&L: $${btcResult.totalPnl.toFixed(2)} (${btcResult.totalPnlPercent.toFixed(2)}%)`);
  console.log(`   Avg Win: $${btcResult.avgWin.toFixed(2)}`);
  console.log(`   Avg Loss: $${btcResult.avgLoss.toFixed(2)}`);
  console.log(`   Profit Factor: ${btcResult.profitFactor.toFixed(2)}`);
  console.log(`   Max Drawdown: ${btcResult.maxDrawdown.toFixed(2)}%`);
  console.log(`   Sharpe Ratio: ${btcResult.sharpeRatio.toFixed(2)}`);
  
  console.log('\n📊 ETH-USD Results:');
  console.log(`   Total Trades: ${ethResult.totalTrades}`);
  console.log(`   Win Rate: ${(ethResult.winRate * 100).toFixed(2)}%`);
  console.log(`   Total P&L: $${ethResult.totalPnl.toFixed(2)} (${ethResult.totalPnlPercent.toFixed(2)}%)`);
  console.log(`   Avg Win: $${ethResult.avgWin.toFixed(2)}`);
  console.log(`   Avg Loss: $${ethResult.avgLoss.toFixed(2)}`);
  console.log(`   Profit Factor: ${ethResult.profitFactor.toFixed(2)}`);
  console.log(`   Max Drawdown: ${ethResult.maxDrawdown.toFixed(2)}%`);
  console.log(`   Sharpe Ratio: ${ethResult.sharpeRatio.toFixed(2)}`);
  
  // Combined stats
  const combinedTrades = btcResult.totalTrades + ethResult.totalTrades;
  const combinedWins = btcResult.winningTrades + ethResult.winningTrades;
  const combinedPnl = btcResult.totalPnl + ethResult.totalPnl;
  const combinedWinRate = combinedTrades > 0 ? combinedWins / combinedTrades : 0;
  
  console.log('\n📈 COMBINED RESULTS:');
  console.log(`   Total Trades: ${combinedTrades}`);
  console.log(`   Win Rate: ${(combinedWinRate * 100).toFixed(2)}%`);
  console.log(`   Total P&L: $${combinedPnl.toFixed(2)}`);
  
  // Strategy breakdown
  console.log('\n📋 Strategy Performance:');
  const allStrategies = new Set([...Object.keys(btcResult.strategyStats), ...Object.keys(ethResult.strategyStats)]);
  for (const strategy of allStrategies) {
    const btcStats = btcResult.strategyStats[strategy] || { trades: 0, winRate: 0, pnl: 0 };
    const ethStats = ethResult.strategyStats[strategy] || { trades: 0, winRate: 0, pnl: 0 };
    const totalTrades = btcStats.trades + ethStats.trades;
    const totalPnl = btcStats.pnl + ethStats.pnl;
    const avgWinRate = totalTrades > 0 
      ? (btcStats.winRate * btcStats.trades + ethStats.winRate * ethStats.trades) / totalTrades 
      : 0;
    
    if (totalTrades > 0) {
      console.log(`   ${strategy}: ${totalTrades} trades, ${(avgWinRate * 100).toFixed(1)}% win, $${totalPnl.toFixed(2)} P&L`);
    }
  }
  
  // Regime breakdown
  console.log('\n🌡️ Regime Performance:');
  const allRegimes = new Set([...Object.keys(btcResult.regimeStats), ...Object.keys(ethResult.regimeStats)]);
  for (const regime of allRegimes) {
    const btcStats = btcResult.regimeStats[regime] || { trades: 0, winRate: 0, pnl: 0 };
    const ethStats = ethResult.regimeStats[regime] || { trades: 0, winRate: 0, pnl: 0 };
    const totalTrades = btcStats.trades + ethStats.trades;
    const totalPnl = btcStats.pnl + ethStats.pnl;
    const avgWinRate = totalTrades > 0 
      ? (btcStats.winRate * btcStats.trades + ethStats.winRate * ethStats.trades) / totalTrades 
      : 0;
    
    if (totalTrades > 0) {
      console.log(`   ${regime}: ${totalTrades} trades, ${(avgWinRate * 100).toFixed(1)}% win, $${totalPnl.toFixed(2)} P&L`);
    }
  }
  
  // Verdict
  console.log('\n' + '='.repeat(60));
  console.log('VERDICT');
  console.log('='.repeat(60));
  
  if (combinedWinRate >= 0.55 && combinedPnl > 0 && btcResult.maxDrawdown < 15 && ethResult.maxDrawdown < 15) {
    console.log('✅ A++ INSTITUTIONAL GRADE - Production Ready');
  } else if (combinedWinRate >= 0.45 && combinedPnl >= -500) {
    console.log('⚠️ NEEDS IMPROVEMENT - Close to target');
  } else {
    console.log('❌ NOT PRODUCTION READY - Further optimization needed');
  }
  
  console.log('\n' + '='.repeat(60));
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    btcResult,
    ethResult,
    combined: {
      totalTrades: combinedTrades,
      winRate: combinedWinRate,
      totalPnl: combinedPnl,
    },
  };
  
  const reportPath = `/home/ubuntu/seer/docs/BACKTEST_A++V3_REPORT_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
}

main().catch(console.error);
