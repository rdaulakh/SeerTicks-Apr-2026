/**
 * Phase 1 A++ Backtest Runner
 * 
 * Runs the A++ Institutional Grade backtest with real Coinbase data
 */

import { BacktestEngineAPlusPlus } from './BacktestEngineA++';

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// FETCH REAL COINBASE DATA
// ============================================================================

async function fetchCoinbaseCandles(
  symbol: string,
  startTime: Date,
  endTime: Date,
  granularity: number = 3600 // 1 hour
): Promise<OHLCV[]> {
  const productId = symbol.replace('/', '-');
  const allCandles: OHLCV[] = [];
  
  let currentStart = startTime.getTime() / 1000;
  const endTimestamp = endTime.getTime() / 1000;
  
  console.log(`Fetching ${productId} candles from ${startTime.toISOString()} to ${endTime.toISOString()}`);
  
  while (currentStart < endTimestamp) {
    const batchEnd = Math.min(currentStart + granularity * 300, endTimestamp);
    
    const url = `https://api.exchange.coinbase.com/products/${productId}/candles?start=${new Date(currentStart * 1000).toISOString()}&end=${new Date(batchEnd * 1000).toISOString()}&granularity=${granularity}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEER-Backtest/1.0'
        }
      });
      
      if (!response.ok) {
        console.error(`API error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        const candles = data.map((candle: number[]) => ({
          timestamp: candle[0] * 1000,
          low: candle[1],
          high: candle[2],
          open: candle[3],
          close: candle[4],
          volume: candle[5]
        }));
        
        allCandles.push(...candles);
      }
      
      currentStart = batchEnd;
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Error fetching candles: ${error}`);
      break;
    }
  }
  
  // Sort by timestamp ascending
  allCandles.sort((a, b) => a.timestamp - b.timestamp);
  
  // Remove duplicates
  const uniqueCandles = allCandles.filter((candle, index, self) =>
    index === self.findIndex(c => c.timestamp === candle.timestamp)
  );
  
  console.log(`Fetched ${uniqueCandles.length} candles for ${productId}`);
  return uniqueCandles;
}

// ============================================================================
// INTELLIGENT SIGNAL GENERATOR
// ============================================================================

function generateIntelligentSignals(
  candles: OHLCV[],
  currentIndex: number
): Array<{ direction: string; confidence: number; agent: string }> {
  const signals: Array<{ direction: string; confidence: number; agent: string }> = [];
  
  if (currentIndex < 50) return signals;
  
  const recentCandles = candles.slice(currentIndex - 50, currentIndex + 1);
  const currentPrice = recentCandles[recentCandles.length - 1].close;
  
  // ============================================================================
  // AGENT 1: RSI AGENT (Mean Reversion)
  // ============================================================================
  const rsi = calculateRSI(recentCandles, 14);
  if (rsi < 30) {
    signals.push({ direction: 'BULLISH', confidence: (30 - rsi) / 30, agent: 'RSI_Agent' });
  } else if (rsi > 70) {
    signals.push({ direction: 'BEARISH', confidence: (rsi - 70) / 30, agent: 'RSI_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'RSI_Agent' });
  }
  
  // ============================================================================
  // AGENT 2: MACD AGENT (Momentum)
  // ============================================================================
  const macd = calculateMACD(recentCandles);
  if (macd.histogram > 0 && macd.histogram > macd.prevHistogram) {
    signals.push({ direction: 'BULLISH', confidence: Math.min(1, Math.abs(macd.histogram) / currentPrice * 1000), agent: 'MACD_Agent' });
  } else if (macd.histogram < 0 && macd.histogram < macd.prevHistogram) {
    signals.push({ direction: 'BEARISH', confidence: Math.min(1, Math.abs(macd.histogram) / currentPrice * 1000), agent: 'MACD_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'MACD_Agent' });
  }
  
  // ============================================================================
  // AGENT 3: BOLLINGER BANDS AGENT (Volatility)
  // ============================================================================
  const bb = calculateBollingerBands(recentCandles, 20, 2);
  const bbPosition = (currentPrice - bb.lower) / (bb.upper - bb.lower);
  if (bbPosition < 0.2) {
    signals.push({ direction: 'BULLISH', confidence: 1 - bbPosition * 5, agent: 'BB_Agent' });
  } else if (bbPosition > 0.8) {
    signals.push({ direction: 'BEARISH', confidence: (bbPosition - 0.8) * 5, agent: 'BB_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'BB_Agent' });
  }
  
  // ============================================================================
  // AGENT 4: EMA CROSSOVER AGENT (Trend)
  // ============================================================================
  const ema9 = calculateEMA(recentCandles.map(c => c.close), 9);
  const ema21 = calculateEMA(recentCandles.map(c => c.close), 21);
  const ema9Current = ema9[ema9.length - 1];
  const ema21Current = ema21[ema21.length - 1];
  const ema9Prev = ema9[ema9.length - 2];
  const ema21Prev = ema21[ema21.length - 2];
  
  if (ema9Current > ema21Current && ema9Prev <= ema21Prev) {
    signals.push({ direction: 'BULLISH', confidence: 0.8, agent: 'EMA_Crossover_Agent' });
  } else if (ema9Current < ema21Current && ema9Prev >= ema21Prev) {
    signals.push({ direction: 'BEARISH', confidence: 0.8, agent: 'EMA_Crossover_Agent' });
  } else if (ema9Current > ema21Current) {
    signals.push({ direction: 'BULLISH', confidence: 0.5, agent: 'EMA_Crossover_Agent' });
  } else {
    signals.push({ direction: 'BEARISH', confidence: 0.5, agent: 'EMA_Crossover_Agent' });
  }
  
  // ============================================================================
  // AGENT 5: VOLUME AGENT (Confirmation)
  // ============================================================================
  const avgVolume = recentCandles.slice(-20, -1).reduce((sum, c) => sum + c.volume, 0) / 19;
  const currentVolume = recentCandles[recentCandles.length - 1].volume;
  const volumeRatio = currentVolume / avgVolume;
  const priceChange = (currentPrice - recentCandles[recentCandles.length - 2].close) / recentCandles[recentCandles.length - 2].close;
  
  if (volumeRatio > 1.5 && priceChange > 0) {
    signals.push({ direction: 'BULLISH', confidence: Math.min(1, volumeRatio / 3), agent: 'Volume_Agent' });
  } else if (volumeRatio > 1.5 && priceChange < 0) {
    signals.push({ direction: 'BEARISH', confidence: Math.min(1, volumeRatio / 3), agent: 'Volume_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'Volume_Agent' });
  }
  
  // ============================================================================
  // AGENT 6: SUPPORT/RESISTANCE AGENT (Price Action)
  // ============================================================================
  const { support, resistance } = calculateSupportResistance(recentCandles);
  const distanceToSupport = (currentPrice - support) / currentPrice;
  const distanceToResistance = (resistance - currentPrice) / currentPrice;
  
  if (distanceToSupport < 0.01) {
    signals.push({ direction: 'BULLISH', confidence: 0.7, agent: 'SR_Agent' });
  } else if (distanceToResistance < 0.01) {
    signals.push({ direction: 'BEARISH', confidence: 0.7, agent: 'SR_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'SR_Agent' });
  }
  
  // ============================================================================
  // AGENT 7: ADX TREND STRENGTH AGENT
  // ============================================================================
  const adx = calculateADX(recentCandles, 14);
  const plusDI = calculatePlusDI(recentCandles, 14);
  const minusDI = calculateMinusDI(recentCandles, 14);
  
  if (adx > 25) {
    if (plusDI > minusDI) {
      signals.push({ direction: 'BULLISH', confidence: Math.min(1, adx / 50), agent: 'ADX_Agent' });
    } else {
      signals.push({ direction: 'BEARISH', confidence: Math.min(1, adx / 50), agent: 'ADX_Agent' });
    }
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'ADX_Agent' });
  }
  
  // ============================================================================
  // AGENT 8: MOMENTUM AGENT
  // ============================================================================
  const momentum = calculateMomentum(recentCandles, 10);
  if (momentum > 0.02) {
    signals.push({ direction: 'BULLISH', confidence: Math.min(1, momentum * 20), agent: 'Momentum_Agent' });
  } else if (momentum < -0.02) {
    signals.push({ direction: 'BEARISH', confidence: Math.min(1, Math.abs(momentum) * 20), agent: 'Momentum_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'Momentum_Agent' });
  }
  
  // ============================================================================
  // AGENT 9: VWAP AGENT
  // ============================================================================
  const vwap = calculateVWAP(recentCandles.slice(-24)); // 24-hour VWAP
  const vwapDeviation = (currentPrice - vwap) / vwap;
  
  if (vwapDeviation < -0.02) {
    signals.push({ direction: 'BULLISH', confidence: Math.min(1, Math.abs(vwapDeviation) * 20), agent: 'VWAP_Agent' });
  } else if (vwapDeviation > 0.02) {
    signals.push({ direction: 'BEARISH', confidence: Math.min(1, vwapDeviation * 20), agent: 'VWAP_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'VWAP_Agent' });
  }
  
  // ============================================================================
  // AGENT 10: PATTERN RECOGNITION AGENT
  // ============================================================================
  const pattern = detectPattern(recentCandles);
  if (pattern.type === 'BULLISH') {
    signals.push({ direction: 'BULLISH', confidence: pattern.confidence, agent: 'Pattern_Agent' });
  } else if (pattern.type === 'BEARISH') {
    signals.push({ direction: 'BEARISH', confidence: pattern.confidence, agent: 'Pattern_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'Pattern_Agent' });
  }
  
  // ============================================================================
  // AGENT 11: FIBONACCI AGENT
  // ============================================================================
  const fib = calculateFibonacciLevels(recentCandles);
  const fibLevel = findNearestFibLevel(currentPrice, fib);
  
  if (fibLevel.level <= 0.382 && fibLevel.distance < 0.01) {
    signals.push({ direction: 'BULLISH', confidence: 0.7, agent: 'Fibonacci_Agent' });
  } else if (fibLevel.level >= 0.618 && fibLevel.distance < 0.01) {
    signals.push({ direction: 'BEARISH', confidence: 0.7, agent: 'Fibonacci_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'Fibonacci_Agent' });
  }
  
  // ============================================================================
  // AGENT 12: STOCHASTIC AGENT
  // ============================================================================
  const stoch = calculateStochastic(recentCandles, 14, 3, 3);
  if (stoch.k < 20 && stoch.k > stoch.d) {
    signals.push({ direction: 'BULLISH', confidence: (20 - stoch.k) / 20, agent: 'Stochastic_Agent' });
  } else if (stoch.k > 80 && stoch.k < stoch.d) {
    signals.push({ direction: 'BEARISH', confidence: (stoch.k - 80) / 20, agent: 'Stochastic_Agent' });
  } else {
    signals.push({ direction: 'NEUTRAL', confidence: 0.3, agent: 'Stochastic_Agent' });
  }
  
  return signals;
}

// ============================================================================
// TECHNICAL INDICATOR CALCULATIONS
// ============================================================================

function calculateRSI(candles: OHLCV[], period: number): number {
  if (candles.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(candles: OHLCV[]): { macd: number; signal: number; histogram: number; prevHistogram: number } {
  const closes = candles.map(c => c.close);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  
  const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
  const prevHistogram = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
  
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram,
    prevHistogram
  };
}

function calculateBollingerBands(candles: OHLCV[], period: number, stdDev: number): { upper: number; middle: number; lower: number } {
  const closes = candles.slice(-period).map(c => c.close);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  
  const squaredDiffs = closes.map(c => Math.pow(c - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / closes.length;
  const std = Math.sqrt(variance);
  
  return {
    upper: sma + stdDev * std,
    middle: sma,
    lower: sma - stdDev * std
  };
}

function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  
  const multiplier = 2 / (period + 1);
  const result: number[] = [values[0]];
  
  for (let i = 1; i < values.length; i++) {
    result.push((values[i] - result[i - 1]) * multiplier + result[i - 1]);
  }
  
  return result;
}

function calculateSupportResistance(candles: OHLCV[]): { support: number; resistance: number } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  const resistance = Math.max(...highs.slice(-20));
  const support = Math.min(...lows.slice(-20));
  
  return { support, resistance };
}

function calculateADX(candles: OHLCV[], period: number): number {
  if (candles.length < period * 2) return 0;
  
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;
    
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    
    tr.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }
  
  const smoothedTR = calculateEMA(tr, period);
  const smoothedDMPlus = calculateEMA(dmPlus, period);
  const smoothedDMMinus = calculateEMA(dmMinus, period);
  
  if (smoothedTR.length === 0) return 0;
  
  const lastTR = smoothedTR[smoothedTR.length - 1];
  const lastDMPlus = smoothedDMPlus[smoothedDMPlus.length - 1];
  const lastDMMinus = smoothedDMMinus[smoothedDMMinus.length - 1];
  
  if (lastTR === 0) return 0;
  
  const diPlus = (lastDMPlus / lastTR) * 100;
  const diMinus = (lastDMMinus / lastTR) * 100;
  
  const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus + 0.0001) * 100;
  
  return dx;
}

function calculatePlusDI(candles: OHLCV[], period: number): number {
  if (candles.length < period) return 0;
  
  const dmPlus: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  
  const smoothedTR = calculateEMA(tr, period);
  const smoothedDMPlus = calculateEMA(dmPlus, period);
  
  const lastTR = smoothedTR[smoothedTR.length - 1];
  const lastDMPlus = smoothedDMPlus[smoothedDMPlus.length - 1];
  
  return lastTR > 0 ? (lastDMPlus / lastTR) * 100 : 0;
}

function calculateMinusDI(candles: OHLCV[], period: number): number {
  if (candles.length < period) return 0;
  
  const dmMinus: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  
  const smoothedTR = calculateEMA(tr, period);
  const smoothedDMMinus = calculateEMA(dmMinus, period);
  
  const lastTR = smoothedTR[smoothedTR.length - 1];
  const lastDMMinus = smoothedDMMinus[smoothedDMMinus.length - 1];
  
  return lastTR > 0 ? (lastDMMinus / lastTR) * 100 : 0;
}

function calculateMomentum(candles: OHLCV[], period: number): number {
  if (candles.length < period + 1) return 0;
  
  const currentPrice = candles[candles.length - 1].close;
  const pastPrice = candles[candles.length - 1 - period].close;
  
  return (currentPrice - pastPrice) / pastPrice;
}

function calculateVWAP(candles: OHLCV[]): number {
  if (candles.length === 0) return 0;
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }
  
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : candles[candles.length - 1].close;
}

function detectPattern(candles: OHLCV[]): { type: string; confidence: number } {
  if (candles.length < 5) return { type: 'NEUTRAL', confidence: 0.3 };
  
  const recent = candles.slice(-5);
  
  // Bullish engulfing
  if (recent[3].close < recent[3].open && // Previous red
      recent[4].close > recent[4].open && // Current green
      recent[4].open < recent[3].close && // Opens below previous close
      recent[4].close > recent[3].open) { // Closes above previous open
    return { type: 'BULLISH', confidence: 0.75 };
  }
  
  // Bearish engulfing
  if (recent[3].close > recent[3].open && // Previous green
      recent[4].close < recent[4].open && // Current red
      recent[4].open > recent[3].close && // Opens above previous close
      recent[4].close < recent[3].open) { // Closes below previous open
    return { type: 'BEARISH', confidence: 0.75 };
  }
  
  // Hammer (bullish)
  const body = Math.abs(recent[4].close - recent[4].open);
  const lowerWick = Math.min(recent[4].open, recent[4].close) - recent[4].low;
  const upperWick = recent[4].high - Math.max(recent[4].open, recent[4].close);
  
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    return { type: 'BULLISH', confidence: 0.65 };
  }
  
  // Shooting star (bearish)
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    return { type: 'BEARISH', confidence: 0.65 };
  }
  
  return { type: 'NEUTRAL', confidence: 0.3 };
}

function calculateFibonacciLevels(candles: OHLCV[]): { level: number; price: number }[] {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const range = high - low;
  
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  
  return levels.map(level => ({
    level,
    price: high - range * level
  }));
}

function findNearestFibLevel(price: number, fibLevels: { level: number; price: number }[]): { level: number; distance: number } {
  let nearest = { level: 0.5, distance: Infinity };
  
  for (const fib of fibLevels) {
    const distance = Math.abs(price - fib.price) / price;
    if (distance < nearest.distance) {
      nearest = { level: fib.level, distance };
    }
  }
  
  return nearest;
}

function calculateStochastic(candles: OHLCV[], kPeriod: number, kSmooth: number, dPeriod: number): { k: number; d: number } {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  
  const kValues: number[] = [];
  
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...periodCandles.map(c => c.high));
    const low = Math.min(...periodCandles.map(c => c.low));
    const close = periodCandles[periodCandles.length - 1].close;
    
    const k = high !== low ? ((close - low) / (high - low)) * 100 : 50;
    kValues.push(k);
  }
  
  // Smooth K
  const smoothedK = calculateEMA(kValues, kSmooth);
  
  // Calculate D (signal line)
  const dValues = calculateEMA(smoothedK, dPeriod);
  
  return {
    k: smoothedK[smoothedK.length - 1],
    d: dValues[dValues.length - 1]
  };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runPhase1APlusPlus() {
  console.log('='.repeat(80));
  console.log('PHASE 1 A++ INSTITUTIONAL GRADE BACKTEST');
  console.log('='.repeat(80));
  console.log('');
  
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7); // 1 week ago
  const endTime = new Date();
  
  console.log(`Period: ${startTime.toISOString()} to ${endTime.toISOString()}`);
  console.log('');
  
  // Fetch real data
  console.log('Fetching real Coinbase data...');
  const btcCandles = await fetchCoinbaseCandles('BTC-USD', startTime, endTime, 3600);
  const ethCandles = await fetchCoinbaseCandles('ETH-USD', startTime, endTime, 3600);
  
  if (btcCandles.length < 50 || ethCandles.length < 50) {
    console.error('Insufficient data fetched. Need at least 50 candles.');
    return;
  }
  
  console.log('');
  console.log('Running A++ Backtest...');
  console.log('');
  
  // Run backtest for BTC
  const btcEngine = new BacktestEngineAPlusPlus(50000);
  const btcResults = await btcEngine.runBacktest(btcCandles, 'BTC-USD', generateIntelligentSignals);
  
  // Run backtest for ETH
  const ethEngine = new BacktestEngineAPlusPlus(50000);
  const ethResults = await ethEngine.runBacktest(ethCandles, 'ETH-USD', generateIntelligentSignals);
  
  // Combined results
  const combinedTrades = [...btcResults.trades, ...ethResults.trades];
  const combinedPnl = btcResults.metrics.totalPnl + ethResults.metrics.totalPnl;
  const combinedWins = combinedTrades.filter(t => t.pnl > 0).length;
  const combinedWinRate = combinedTrades.length > 0 ? combinedWins / combinedTrades.length * 100 : 0;
  
  // Print results
  console.log('='.repeat(80));
  console.log('A++ BACKTEST RESULTS');
  console.log('='.repeat(80));
  console.log('');
  
  console.log('BTC-USD Results:');
  console.log('-'.repeat(40));
  console.log(`  Total Trades: ${btcResults.metrics.totalTrades}`);
  console.log(`  Win Rate: ${btcResults.metrics.winRate.toFixed(2)}%`);
  console.log(`  Total P&L: $${btcResults.metrics.totalPnl.toFixed(2)} (${btcResults.metrics.totalPnlPercent.toFixed(2)}%)`);
  console.log(`  Max Drawdown: ${btcResults.metrics.maxDrawdown.toFixed(2)}%`);
  console.log(`  Sharpe Ratio: ${btcResults.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Profit Factor: ${btcResults.metrics.profitFactor.toFixed(2)}`);
  console.log(`  Avg Win: $${btcResults.metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss: $${btcResults.metrics.avgLoss.toFixed(2)}`);
  console.log(`  Trades Skipped (Bad Conditions): ${btcResults.metrics.tradesSkipped}`);
  console.log('');
  
  console.log('ETH-USD Results:');
  console.log('-'.repeat(40));
  console.log(`  Total Trades: ${ethResults.metrics.totalTrades}`);
  console.log(`  Win Rate: ${ethResults.metrics.winRate.toFixed(2)}%`);
  console.log(`  Total P&L: $${ethResults.metrics.totalPnl.toFixed(2)} (${ethResults.metrics.totalPnlPercent.toFixed(2)}%)`);
  console.log(`  Max Drawdown: ${ethResults.metrics.maxDrawdown.toFixed(2)}%`);
  console.log(`  Sharpe Ratio: ${ethResults.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Profit Factor: ${ethResults.metrics.profitFactor.toFixed(2)}`);
  console.log(`  Avg Win: $${ethResults.metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss: $${ethResults.metrics.avgLoss.toFixed(2)}`);
  console.log(`  Trades Skipped (Bad Conditions): ${ethResults.metrics.tradesSkipped}`);
  console.log('');
  
  console.log('COMBINED RESULTS:');
  console.log('='.repeat(40));
  console.log(`  Total Trades: ${combinedTrades.length}`);
  console.log(`  Win Rate: ${combinedWinRate.toFixed(2)}%`);
  console.log(`  Total P&L: $${combinedPnl.toFixed(2)}`);
  console.log('');
  
  // Regime breakdown
  console.log('REGIME BREAKDOWN:');
  console.log('-'.repeat(40));
  const allRegimes = new Set([
    ...Object.keys(btcResults.metrics.regimeBreakdown),
    ...Object.keys(ethResults.metrics.regimeBreakdown)
  ]);
  
  for (const regime of allRegimes) {
    const btcRegime = btcResults.metrics.regimeBreakdown[regime] || { trades: 0, winRate: 0, pnl: 0 };
    const ethRegime = ethResults.metrics.regimeBreakdown[regime] || { trades: 0, winRate: 0, pnl: 0 };
    
    console.log(`  ${regime}:`);
    console.log(`    Trades: ${btcRegime.trades + ethRegime.trades}`);
    console.log(`    Win Rate: ${((btcRegime.winRate + ethRegime.winRate) / 2).toFixed(2)}%`);
    console.log(`    P&L: $${(btcRegime.pnl + ethRegime.pnl).toFixed(2)}`);
  }
  console.log('');
  
  // Learning state
  console.log('ADAPTIVE LEARNING STATE:');
  console.log('-'.repeat(40));
  const btcLearning = btcResults.learningState;
  console.log(`  Consecutive Losses: ${btcLearning.consecutiveLosses}`);
  console.log(`  Trading Paused: ${btcLearning.tradingPaused}`);
  console.log(`  Learned Confidence Thresholds:`);
  for (const [regime, threshold] of Object.entries(btcLearning.optimalConfidenceByRegime)) {
    console.log(`    ${regime}: ${threshold.toFixed(1)}%`);
  }
  console.log('');
  
  // Trade log
  console.log('TRADE LOG (Last 10):');
  console.log('-'.repeat(80));
  const lastTrades = combinedTrades.slice(-10);
  for (const trade of lastTrades) {
    const pnlSign = trade.pnl >= 0 ? '+' : '';
    console.log(`  ${trade.symbol} | ${trade.direction} | Entry: $${trade.entryPrice.toFixed(2)} | Exit: $${trade.exitPrice.toFixed(2)} | P&L: ${pnlSign}$${trade.pnl.toFixed(2)} | ${trade.exitReason} | ${trade.regime}`);
  }
  console.log('');
  
  // Verdict
  console.log('='.repeat(80));
  console.log('VERDICT:');
  console.log('='.repeat(80));
  
  let verdict = '';
  let reasons: string[] = [];
  
  if (combinedWinRate >= 55 && combinedPnl > 0 && btcResults.metrics.maxDrawdown < 15) {
    verdict = '✅ A++ INSTITUTIONAL GRADE';
    reasons.push('Win rate above 55%');
    reasons.push('Positive P&L');
    reasons.push('Drawdown under 15%');
  } else if (combinedWinRate >= 45 && combinedPnl > -500) {
    verdict = '⚠️ NEEDS IMPROVEMENT';
    if (combinedWinRate < 55) reasons.push(`Win rate ${combinedWinRate.toFixed(1)}% below 55%`);
    if (combinedPnl <= 0) reasons.push(`P&L negative: $${combinedPnl.toFixed(2)}`);
  } else {
    verdict = '❌ NOT PRODUCTION-READY';
    if (combinedWinRate < 45) reasons.push(`Win rate ${combinedWinRate.toFixed(1)}% below 45%`);
    if (combinedPnl < -500) reasons.push(`Significant losses: $${combinedPnl.toFixed(2)}`);
    if (btcResults.metrics.maxDrawdown >= 15) reasons.push(`Drawdown ${btcResults.metrics.maxDrawdown.toFixed(1)}% exceeds 15%`);
  }
  
  console.log(`\n${verdict}\n`);
  console.log('Reasons:');
  for (const reason of reasons) {
    console.log(`  - ${reason}`);
  }
  console.log('');
  
  // Key improvements from A++ engine
  console.log('A++ INTELLIGENCE FEATURES ACTIVE:');
  console.log('-'.repeat(40));
  console.log('  ✅ Market Condition Filter (skips choppy/low-volume)');
  console.log('  ✅ Intelligent Signal Quality Scoring');
  console.log('  ✅ Breakeven Stop Mechanism');
  console.log('  ✅ Profit Lock Trailing Stops');
  console.log('  ✅ Partial Profit Taking (25% at +1R, +1.5R, +2R)');
  console.log('  ✅ Circuit Breaker (pause after consecutive losses)');
  console.log('  ✅ Adaptive Learning (adjusts thresholds based on performance)');
  console.log('  ✅ Regime-Aware Position Sizing');
  console.log('  ✅ Time-Based Exit for Stale Trades');
  console.log('  ✅ 12 Intelligent Agents');
  console.log('');
  
  // Save report
  const reportPath = `/home/ubuntu/seer/docs/PHASE1_A++_REPORT_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  const fs = await import('fs');
  
  const report = `
A++ INSTITUTIONAL GRADE BACKTEST REPORT
=======================================
Generated: ${new Date().toISOString()}
Period: ${startTime.toISOString()} to ${endTime.toISOString()}

COMBINED RESULTS
================
Total Trades: ${combinedTrades.length}
Win Rate: ${combinedWinRate.toFixed(2)}%
Total P&L: $${combinedPnl.toFixed(2)}

BTC-USD
-------
Trades: ${btcResults.metrics.totalTrades}
Win Rate: ${btcResults.metrics.winRate.toFixed(2)}%
P&L: $${btcResults.metrics.totalPnl.toFixed(2)} (${btcResults.metrics.totalPnlPercent.toFixed(2)}%)
Max Drawdown: ${btcResults.metrics.maxDrawdown.toFixed(2)}%
Sharpe: ${btcResults.metrics.sharpeRatio.toFixed(2)}
Profit Factor: ${btcResults.metrics.profitFactor.toFixed(2)}
Trades Skipped: ${btcResults.metrics.tradesSkipped}

ETH-USD
-------
Trades: ${ethResults.metrics.totalTrades}
Win Rate: ${ethResults.metrics.winRate.toFixed(2)}%
P&L: $${ethResults.metrics.totalPnl.toFixed(2)} (${ethResults.metrics.totalPnlPercent.toFixed(2)}%)
Max Drawdown: ${ethResults.metrics.maxDrawdown.toFixed(2)}%
Sharpe: ${ethResults.metrics.sharpeRatio.toFixed(2)}
Profit Factor: ${ethResults.metrics.profitFactor.toFixed(2)}
Trades Skipped: ${ethResults.metrics.tradesSkipped}

VERDICT: ${verdict}
Reasons: ${reasons.join(', ')}

A++ FEATURES ACTIVE:
- Market Condition Filter
- Intelligent Signal Quality Scoring
- Breakeven Stop Mechanism
- Profit Lock Trailing Stops
- Partial Profit Taking
- Circuit Breaker
- Adaptive Learning
- Regime-Aware Position Sizing
- Time-Based Exit
- 12 Intelligent Agents
`;

  fs.writeFileSync(reportPath, report);
  console.log(`Report saved to: ${reportPath}`);
}

// Run the backtest
runPhase1APlusPlus().catch(console.error);
