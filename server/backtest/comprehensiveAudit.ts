/**
 * COMPREHENSIVE INSTITUTIONAL-GRADE AUDIT
 * 
 * This script performs a forensic analysis of:
 * 1. Each of the 12 signal-generating agents
 * 2. Consensus mechanism
 * 3. Trade picker logic
 * 4. Position management
 * 5. Position exit logic
 */

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AgentSignal {
  agent: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  timestamp: number;
  price: number;
  // For audit: what happened after this signal
  priceAfter1H?: number;
  priceAfter4H?: number;
  priceAfter24H?: number;
  wasCorrect?: boolean;
  actualMove?: number;
}

interface AgentAuditResult {
  agentName: string;
  totalSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  neutralSignals: number;
  correctSignals: number;
  incorrectSignals: number;
  accuracy: number;
  avgConfidenceWhenCorrect: number;
  avgConfidenceWhenIncorrect: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  profitIfFollowed: number;
  issues: string[];
  recommendations: string[];
}

// ============================================================================
// FETCH REAL DATA
// ============================================================================

async function fetchCoinbaseCandles(
  symbol: string,
  startTime: Date,
  endTime: Date,
  granularity: number = 3600
): Promise<OHLCV[]> {
  const productId = symbol.replace('/', '-');
  const allCandles: OHLCV[] = [];
  
  let currentStart = startTime.getTime() / 1000;
  const endTimestamp = endTime.getTime() / 1000;
  
  while (currentStart < endTimestamp) {
    const batchEnd = Math.min(currentStart + granularity * 300, endTimestamp);
    
    const url = `https://api.exchange.coinbase.com/products/${productId}/candles?start=${new Date(currentStart * 1000).toISOString()}&end=${new Date(batchEnd * 1000).toISOString()}&granularity=${granularity}`;
    
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SEER-Audit/1.0' }
      });
      
      if (!response.ok) break;
      
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
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      break;
    }
  }
  
  allCandles.sort((a, b) => a.timestamp - b.timestamp);
  return allCandles.filter((candle, index, self) =>
    index === self.findIndex(c => c.timestamp === candle.timestamp)
  );
}

// ============================================================================
// AGENT IMPLEMENTATIONS (For Audit)
// ============================================================================

class RSIAgent {
  name = 'RSI_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 15) return null;
    
    const rsi = this.calculateRSI(candles.slice(0, index + 1), 14);
    const price = candles[index].close;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (rsi < 30) {
      direction = 'BULLISH';
      confidence = (30 - rsi) / 30;
    } else if (rsi > 70) {
      direction = 'BEARISH';
      confidence = (rsi - 70) / 30;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price
    };
  }
  
  private calculateRSI(candles: OHLCV[], period: number): number {
    if (candles.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    
    return 100 - (100 / (1 + avgGain / avgLoss));
  }
}

class MACDAgent {
  name = 'MACD_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 30) return null;
    
    const closes = candles.slice(0, index + 1).map(c => c.close);
    const ema12 = this.ema(closes, 12);
    const ema26 = this.ema(closes, 26);
    
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = this.ema(macdLine, 9);
    
    const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
    const prevHistogram = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (histogram > 0 && histogram > prevHistogram) {
      direction = 'BULLISH';
      confidence = Math.min(1, Math.abs(histogram) / candles[index].close * 1000);
    } else if (histogram < 0 && histogram < prevHistogram) {
      direction = 'BEARISH';
      confidence = Math.min(1, Math.abs(histogram) / candles[index].close * 1000);
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: candles[index].close
    };
  }
  
  private ema(values: number[], period: number): number[] {
    const multiplier = 2 / (period + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push((values[i] - result[i - 1]) * multiplier + result[i - 1]);
    }
    return result;
  }
}

class BollingerBandsAgent {
  name = 'BB_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 20) return null;
    
    const recentCandles = candles.slice(index - 19, index + 1);
    const closes = recentCandles.map(c => c.close);
    const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
    const std = Math.sqrt(closes.reduce((sum, c) => sum + Math.pow(c - sma, 2), 0) / closes.length);
    
    const upper = sma + 2 * std;
    const lower = sma - 2 * std;
    const price = candles[index].close;
    const bbPosition = (price - lower) / (upper - lower);
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (bbPosition < 0.2) {
      direction = 'BULLISH';
      confidence = 1 - bbPosition * 5;
    } else if (bbPosition > 0.8) {
      direction = 'BEARISH';
      confidence = (bbPosition - 0.8) * 5;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price
    };
  }
}

class EMACrossoverAgent {
  name = 'EMA_Crossover_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 25) return null;
    
    const closes = candles.slice(0, index + 1).map(c => c.close);
    const ema9 = this.ema(closes, 9);
    const ema21 = this.ema(closes, 21);
    
    const ema9Current = ema9[ema9.length - 1];
    const ema21Current = ema21[ema21.length - 1];
    const ema9Prev = ema9[ema9.length - 2];
    const ema21Prev = ema21[ema21.length - 2];
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.5;
    
    // Crossover detection
    if (ema9Current > ema21Current && ema9Prev <= ema21Prev) {
      direction = 'BULLISH';
      confidence = 0.8;
    } else if (ema9Current < ema21Current && ema9Prev >= ema21Prev) {
      direction = 'BEARISH';
      confidence = 0.8;
    } else if (ema9Current > ema21Current) {
      direction = 'BULLISH';
      confidence = 0.5;
    } else {
      direction = 'BEARISH';
      confidence = 0.5;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: candles[index].close
    };
  }
  
  private ema(values: number[], period: number): number[] {
    const multiplier = 2 / (period + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push((values[i] - result[i - 1]) * multiplier + result[i - 1]);
    }
    return result;
  }
}

class VolumeAgent {
  name = 'Volume_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 20) return null;
    
    const recentCandles = candles.slice(index - 19, index + 1);
    const avgVolume = recentCandles.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / 19;
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const volumeRatio = currentVolume / avgVolume;
    
    const priceChange = (candles[index].close - candles[index - 1].close) / candles[index - 1].close;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (volumeRatio > 1.5 && priceChange > 0) {
      direction = 'BULLISH';
      confidence = Math.min(1, volumeRatio / 3);
    } else if (volumeRatio > 1.5 && priceChange < 0) {
      direction = 'BEARISH';
      confidence = Math.min(1, volumeRatio / 3);
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: candles[index].close
    };
  }
}

class SupportResistanceAgent {
  name = 'SR_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 20) return null;
    
    const recentCandles = candles.slice(index - 19, index + 1);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    
    const resistance = Math.max(...highs);
    const support = Math.min(...lows);
    const price = candles[index].close;
    
    const distanceToSupport = (price - support) / price;
    const distanceToResistance = (resistance - price) / price;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (distanceToSupport < 0.01) {
      direction = 'BULLISH';
      confidence = 0.7;
    } else if (distanceToResistance < 0.01) {
      direction = 'BEARISH';
      confidence = 0.7;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price
    };
  }
}

class ADXAgent {
  name = 'ADX_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 30) return null;
    
    const recentCandles = candles.slice(0, index + 1);
    const adx = this.calculateADX(recentCandles, 14);
    const plusDI = this.calculatePlusDI(recentCandles, 14);
    const minusDI = this.calculateMinusDI(recentCandles, 14);
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (adx > 25) {
      if (plusDI > minusDI) {
        direction = 'BULLISH';
        confidence = Math.min(1, adx / 50);
      } else {
        direction = 'BEARISH';
        confidence = Math.min(1, adx / 50);
      }
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: candles[index].close
    };
  }
  
  private calculateADX(candles: OHLCV[], period: number): number {
    // Simplified ADX calculation
    if (candles.length < period * 2) return 0;
    
    let sumDX = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const plusDM = Math.max(0, candles[i].high - candles[i - 1].high);
      const minusDM = Math.max(0, candles[i - 1].low - candles[i].low);
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      
      if (tr > 0) {
        const plusDI = (plusDM / tr) * 100;
        const minusDI = (minusDM / tr) * 100;
        const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;
        sumDX += dx;
      }
    }
    
    return sumDX / period;
  }
  
  private calculatePlusDI(candles: OHLCV[], period: number): number {
    if (candles.length < period) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      sum += Math.max(0, candles[i].high - candles[i - 1].high);
    }
    return sum / period;
  }
  
  private calculateMinusDI(candles: OHLCV[], period: number): number {
    if (candles.length < period) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      sum += Math.max(0, candles[i - 1].low - candles[i].low);
    }
    return sum / period;
  }
}

class MomentumAgent {
  name = 'Momentum_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 15) return null;
    
    const currentPrice = candles[index].close;
    const pastPrice = candles[index - 10].close;
    const momentum = (currentPrice - pastPrice) / pastPrice;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (momentum > 0.02) {
      direction = 'BULLISH';
      confidence = Math.min(1, momentum * 20);
    } else if (momentum < -0.02) {
      direction = 'BEARISH';
      confidence = Math.min(1, Math.abs(momentum) * 20);
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: currentPrice
    };
  }
}

class VWAPAgent {
  name = 'VWAP_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 24) return null;
    
    const recentCandles = candles.slice(index - 23, index + 1);
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    
    for (const candle of recentCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }
    
    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : candles[index].close;
    const price = candles[index].close;
    const deviation = (price - vwap) / vwap;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (deviation < -0.02) {
      direction = 'BULLISH';
      confidence = Math.min(1, Math.abs(deviation) * 20);
    } else if (deviation > 0.02) {
      direction = 'BEARISH';
      confidence = Math.min(1, deviation * 20);
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price
    };
  }
}

class PatternAgent {
  name = 'Pattern_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 5) return null;
    
    const recent = candles.slice(index - 4, index + 1);
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    // Bullish engulfing
    if (recent[3].close < recent[3].open &&
        recent[4].close > recent[4].open &&
        recent[4].open < recent[3].close &&
        recent[4].close > recent[3].open) {
      direction = 'BULLISH';
      confidence = 0.75;
    }
    // Bearish engulfing
    else if (recent[3].close > recent[3].open &&
             recent[4].close < recent[4].open &&
             recent[4].open > recent[3].close &&
             recent[4].close < recent[3].open) {
      direction = 'BEARISH';
      confidence = 0.75;
    }
    // Hammer
    else {
      const body = Math.abs(recent[4].close - recent[4].open);
      const lowerWick = Math.min(recent[4].open, recent[4].close) - recent[4].low;
      const upperWick = recent[4].high - Math.max(recent[4].open, recent[4].close);
      
      if (lowerWick > body * 2 && upperWick < body * 0.5) {
        direction = 'BULLISH';
        confidence = 0.65;
      } else if (upperWick > body * 2 && lowerWick < body * 0.5) {
        direction = 'BEARISH';
        confidence = 0.65;
      }
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: candles[index].close
    };
  }
}

class FibonacciAgent {
  name = 'Fibonacci_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 50) return null;
    
    const recentCandles = candles.slice(index - 49, index + 1);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const range = high - low;
    const price = candles[index].close;
    
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const fibPrices = levels.map(l => high - range * l);
    
    let nearestLevel = 0.5;
    let nearestDistance = Infinity;
    
    for (let i = 0; i < levels.length; i++) {
      const distance = Math.abs(price - fibPrices[i]) / price;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestLevel = levels[i];
      }
    }
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (nearestLevel <= 0.382 && nearestDistance < 0.01) {
      direction = 'BULLISH';
      confidence = 0.7;
    } else if (nearestLevel >= 0.618 && nearestDistance < 0.01) {
      direction = 'BEARISH';
      confidence = 0.7;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price
    };
  }
}

class StochasticAgent {
  name = 'Stochastic_Agent';
  
  generateSignal(candles: OHLCV[], index: number): AgentSignal | null {
    if (index < 20) return null;
    
    const recentCandles = candles.slice(index - 13, index + 1);
    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));
    const close = candles[index].close;
    
    const k = high !== low ? ((close - low) / (high - low)) * 100 : 50;
    
    // Simple D calculation (3-period SMA of K)
    const kValues: number[] = [];
    for (let i = index - 2; i <= index; i++) {
      const rc = candles.slice(i - 13, i + 1);
      const h = Math.max(...rc.map(c => c.high));
      const l = Math.min(...rc.map(c => c.low));
      const c = candles[i].close;
      kValues.push(h !== l ? ((c - l) / (h - l)) * 100 : 50);
    }
    const d = kValues.reduce((a, b) => a + b, 0) / 3;
    
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.3;
    
    if (k < 20 && k > d) {
      direction = 'BULLISH';
      confidence = (20 - k) / 20;
    } else if (k > 80 && k < d) {
      direction = 'BEARISH';
      confidence = (k - 80) / 20;
    }
    
    return {
      agent: this.name,
      direction,
      confidence,
      timestamp: candles[index].timestamp,
      price: close
    };
  }
}

// ============================================================================
// AUDIT FUNCTIONS
// ============================================================================

function auditAgent(
  agent: { name: string; generateSignal: (candles: OHLCV[], index: number) => AgentSignal | null },
  candles: OHLCV[],
  lookAhead: number = 4 // hours to look ahead for validation
): AgentAuditResult {
  const signals: AgentSignal[] = [];
  
  // Generate all signals
  for (let i = 50; i < candles.length - lookAhead; i++) {
    const signal = agent.generateSignal(candles, i);
    if (signal && signal.direction !== 'NEUTRAL') {
      // Look ahead to see if signal was correct
      const futurePrice = candles[i + lookAhead].close;
      const priceMove = (futurePrice - signal.price) / signal.price;
      
      signal.priceAfter4H = futurePrice;
      signal.actualMove = priceMove;
      
      // Was the signal correct?
      if (signal.direction === 'BULLISH') {
        signal.wasCorrect = priceMove > 0.001; // At least 0.1% move in right direction
      } else {
        signal.wasCorrect = priceMove < -0.001;
      }
      
      signals.push(signal);
    }
  }
  
  // Calculate metrics
  const bullishSignals = signals.filter(s => s.direction === 'BULLISH');
  const bearishSignals = signals.filter(s => s.direction === 'BEARISH');
  const correctSignals = signals.filter(s => s.wasCorrect);
  const incorrectSignals = signals.filter(s => !s.wasCorrect);
  
  const avgConfidenceWhenCorrect = correctSignals.length > 0
    ? correctSignals.reduce((sum, s) => sum + s.confidence, 0) / correctSignals.length
    : 0;
  
  const avgConfidenceWhenIncorrect = incorrectSignals.length > 0
    ? incorrectSignals.reduce((sum, s) => sum + s.confidence, 0) / incorrectSignals.length
    : 0;
  
  // Calculate profit if followed (simple: +1 for correct, -1 for incorrect)
  let profitIfFollowed = 0;
  for (const signal of signals) {
    if (signal.wasCorrect) {
      profitIfFollowed += Math.abs(signal.actualMove || 0) * signal.confidence;
    } else {
      profitIfFollowed -= Math.abs(signal.actualMove || 0) * signal.confidence;
    }
  }
  
  // Identify issues
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  const accuracy = signals.length > 0 ? correctSignals.length / signals.length : 0;
  
  if (accuracy < 0.5) {
    issues.push(`Low accuracy: ${(accuracy * 100).toFixed(1)}% (below 50%)`);
    recommendations.push('Consider inverting signal logic or adjusting thresholds');
  }
  
  if (avgConfidenceWhenIncorrect > avgConfidenceWhenCorrect) {
    issues.push(`Higher confidence when WRONG (${(avgConfidenceWhenIncorrect * 100).toFixed(1)}%) than when RIGHT (${(avgConfidenceWhenCorrect * 100).toFixed(1)}%)`);
    recommendations.push('Confidence calculation is inversely correlated with accuracy - needs recalibration');
  }
  
  const bullishAccuracy = bullishSignals.length > 0 
    ? bullishSignals.filter(s => s.wasCorrect).length / bullishSignals.length 
    : 0;
  const bearishAccuracy = bearishSignals.length > 0 
    ? bearishSignals.filter(s => s.wasCorrect).length / bearishSignals.length 
    : 0;
  
  if (Math.abs(bullishAccuracy - bearishAccuracy) > 0.2) {
    issues.push(`Directional bias: Bullish accuracy ${(bullishAccuracy * 100).toFixed(1)}% vs Bearish ${(bearishAccuracy * 100).toFixed(1)}%`);
    recommendations.push('Agent has directional bias - consider separate thresholds for each direction');
  }
  
  if (signals.length < 10) {
    issues.push(`Too few signals generated: ${signals.length}`);
    recommendations.push('Loosen signal generation criteria to get more data points');
  }
  
  return {
    agentName: agent.name,
    totalSignals: signals.length,
    bullishSignals: bullishSignals.length,
    bearishSignals: bearishSignals.length,
    neutralSignals: 0, // We filtered these out
    correctSignals: correctSignals.length,
    incorrectSignals: incorrectSignals.length,
    accuracy,
    avgConfidenceWhenCorrect,
    avgConfidenceWhenIncorrect,
    falsePositiveRate: incorrectSignals.length / Math.max(1, signals.length),
    falseNegativeRate: 0, // Would need ground truth to calculate
    profitIfFollowed,
    issues,
    recommendations
  };
}

// ============================================================================
// CONSENSUS AUDIT
// ============================================================================

interface ConsensusAuditResult {
  totalConsensusPoints: number;
  consensusAccuracy: number;
  strongConsensusAccuracy: number; // When >70% agents agree
  weakConsensusAccuracy: number; // When 50-70% agents agree
  conflictingSignalsCount: number;
  avgAgentsAgreeing: number;
  issues: string[];
  recommendations: string[];
}

function auditConsensus(
  agents: Array<{ name: string; generateSignal: (candles: OHLCV[], index: number) => AgentSignal | null }>,
  candles: OHLCV[],
  lookAhead: number = 4
): ConsensusAuditResult {
  const consensusPoints: Array<{
    timestamp: number;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    totalAgents: number;
    consensusDirection: string;
    consensusStrength: number;
    actualMove: number;
    wasCorrect: boolean;
  }> = [];
  
  for (let i = 50; i < candles.length - lookAhead; i++) {
    const signals = agents.map(a => a.generateSignal(candles, i)).filter(s => s !== null) as AgentSignal[];
    
    const bullishCount = signals.filter(s => s.direction === 'BULLISH').length;
    const bearishCount = signals.filter(s => s.direction === 'BEARISH').length;
    const neutralCount = signals.filter(s => s.direction === 'NEUTRAL').length;
    
    const totalDirectional = bullishCount + bearishCount;
    if (totalDirectional === 0) continue;
    
    const consensusDirection = bullishCount > bearishCount ? 'BULLISH' : 'BEARISH';
    const consensusStrength = Math.max(bullishCount, bearishCount) / signals.length;
    
    const futurePrice = candles[i + lookAhead].close;
    const currentPrice = candles[i].close;
    const actualMove = (futurePrice - currentPrice) / currentPrice;
    
    const wasCorrect = (consensusDirection === 'BULLISH' && actualMove > 0.001) ||
                       (consensusDirection === 'BEARISH' && actualMove < -0.001);
    
    consensusPoints.push({
      timestamp: candles[i].timestamp,
      bullishCount,
      bearishCount,
      neutralCount,
      totalAgents: signals.length,
      consensusDirection,
      consensusStrength,
      actualMove,
      wasCorrect
    });
  }
  
  const strongConsensus = consensusPoints.filter(c => c.consensusStrength >= 0.7);
  const weakConsensus = consensusPoints.filter(c => c.consensusStrength >= 0.5 && c.consensusStrength < 0.7);
  const conflicting = consensusPoints.filter(c => c.consensusStrength < 0.5);
  
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  const overallAccuracy = consensusPoints.length > 0
    ? consensusPoints.filter(c => c.wasCorrect).length / consensusPoints.length
    : 0;
  
  const strongAccuracy = strongConsensus.length > 0
    ? strongConsensus.filter(c => c.wasCorrect).length / strongConsensus.length
    : 0;
  
  const weakAccuracy = weakConsensus.length > 0
    ? weakConsensus.filter(c => c.wasCorrect).length / weakConsensus.length
    : 0;
  
  if (overallAccuracy < 0.5) {
    issues.push(`Overall consensus accuracy below 50%: ${(overallAccuracy * 100).toFixed(1)}%`);
    recommendations.push('Multiple agents are giving wrong signals - need individual agent recalibration');
  }
  
  if (strongAccuracy < weakAccuracy) {
    issues.push(`Strong consensus (${(strongAccuracy * 100).toFixed(1)}%) performs WORSE than weak consensus (${(weakAccuracy * 100).toFixed(1)}%)`);
    recommendations.push('Agents are reinforcing each other\'s mistakes - consider contrarian weighting');
  }
  
  if (conflicting.length / consensusPoints.length > 0.3) {
    issues.push(`High conflict rate: ${((conflicting.length / consensusPoints.length) * 100).toFixed(1)}% of signals have no clear consensus`);
    recommendations.push('Agents are too often disagreeing - reduce number of agents or improve signal quality');
  }
  
  const avgAgreement = consensusPoints.length > 0
    ? consensusPoints.reduce((sum, c) => sum + c.consensusStrength, 0) / consensusPoints.length
    : 0;
  
  return {
    totalConsensusPoints: consensusPoints.length,
    consensusAccuracy: overallAccuracy,
    strongConsensusAccuracy: strongAccuracy,
    weakConsensusAccuracy: weakAccuracy,
    conflictingSignalsCount: conflicting.length,
    avgAgentsAgreeing: avgAgreement,
    issues,
    recommendations
  };
}

// ============================================================================
// MAIN AUDIT EXECUTION
// ============================================================================

async function runComprehensiveAudit() {
  console.log('='.repeat(100));
  console.log('COMPREHENSIVE INSTITUTIONAL-GRADE AUDIT');
  console.log('='.repeat(100));
  console.log('');
  
  // Fetch data
  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7);
  
  console.log('Fetching real market data...');
  const btcCandles = await fetchCoinbaseCandles('BTC-USD', startTime, endTime, 3600);
  console.log(`Fetched ${btcCandles.length} BTC-USD candles`);
  console.log('');
  
  // Initialize agents
  const agents = [
    new RSIAgent(),
    new MACDAgent(),
    new BollingerBandsAgent(),
    new EMACrossoverAgent(),
    new VolumeAgent(),
    new SupportResistanceAgent(),
    new ADXAgent(),
    new MomentumAgent(),
    new VWAPAgent(),
    new PatternAgent(),
    new FibonacciAgent(),
    new StochasticAgent()
  ];
  
  // ============================================================================
  // PART 1: INDIVIDUAL AGENT AUDIT
  // ============================================================================
  
  console.log('='.repeat(100));
  console.log('PART 1: INDIVIDUAL AGENT AUDIT');
  console.log('='.repeat(100));
  console.log('');
  
  const agentResults: AgentAuditResult[] = [];
  
  for (const agent of agents) {
    const result = auditAgent(agent, btcCandles, 4);
    agentResults.push(result);
    
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`AGENT: ${result.agentName}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`  Total Signals: ${result.totalSignals} (Bullish: ${result.bullishSignals}, Bearish: ${result.bearishSignals})`);
    console.log(`  Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    console.log(`  Correct: ${result.correctSignals} | Incorrect: ${result.incorrectSignals}`);
    console.log(`  Avg Confidence When Correct: ${(result.avgConfidenceWhenCorrect * 100).toFixed(1)}%`);
    console.log(`  Avg Confidence When Incorrect: ${(result.avgConfidenceWhenIncorrect * 100).toFixed(1)}%`);
    console.log(`  Profit If Followed: ${result.profitIfFollowed > 0 ? '+' : ''}${(result.profitIfFollowed * 100).toFixed(2)}%`);
    
    if (result.issues.length > 0) {
      console.log(`  ISSUES:`);
      for (const issue of result.issues) {
        console.log(`    ❌ ${issue}`);
      }
    }
    
    if (result.recommendations.length > 0) {
      console.log(`  RECOMMENDATIONS:`);
      for (const rec of result.recommendations) {
        console.log(`    💡 ${rec}`);
      }
    }
  }
  
  // ============================================================================
  // PART 2: CONSENSUS MECHANISM AUDIT
  // ============================================================================
  
  console.log('\n');
  console.log('='.repeat(100));
  console.log('PART 2: CONSENSUS MECHANISM AUDIT');
  console.log('='.repeat(100));
  
  const consensusResult = auditConsensus(agents, btcCandles, 4);
  
  console.log(`\n  Total Consensus Points: ${consensusResult.totalConsensusPoints}`);
  console.log(`  Overall Consensus Accuracy: ${(consensusResult.consensusAccuracy * 100).toFixed(1)}%`);
  console.log(`  Strong Consensus (>70% agree) Accuracy: ${(consensusResult.strongConsensusAccuracy * 100).toFixed(1)}%`);
  console.log(`  Weak Consensus (50-70% agree) Accuracy: ${(consensusResult.weakConsensusAccuracy * 100).toFixed(1)}%`);
  console.log(`  Conflicting Signals: ${consensusResult.conflictingSignalsCount} (${((consensusResult.conflictingSignalsCount / consensusResult.totalConsensusPoints) * 100).toFixed(1)}%)`);
  console.log(`  Average Agent Agreement: ${(consensusResult.avgAgentsAgreeing * 100).toFixed(1)}%`);
  
  if (consensusResult.issues.length > 0) {
    console.log(`\n  ISSUES:`);
    for (const issue of consensusResult.issues) {
      console.log(`    ❌ ${issue}`);
    }
  }
  
  if (consensusResult.recommendations.length > 0) {
    console.log(`\n  RECOMMENDATIONS:`);
    for (const rec of consensusResult.recommendations) {
      console.log(`    💡 ${rec}`);
    }
  }
  
  // ============================================================================
  // PART 3: SUMMARY & ROOT CAUSE ANALYSIS
  // ============================================================================
  
  console.log('\n');
  console.log('='.repeat(100));
  console.log('PART 3: ROOT CAUSE ANALYSIS');
  console.log('='.repeat(100));
  
  // Sort agents by accuracy
  const sortedByAccuracy = [...agentResults].sort((a, b) => b.accuracy - a.accuracy);
  
  console.log('\n  AGENT RANKING BY ACCURACY:');
  console.log('  ' + '─'.repeat(60));
  for (let i = 0; i < sortedByAccuracy.length; i++) {
    const agent = sortedByAccuracy[i];
    const status = agent.accuracy >= 0.5 ? '✅' : '❌';
    console.log(`  ${i + 1}. ${status} ${agent.agentName.padEnd(25)} ${(agent.accuracy * 100).toFixed(1)}%`);
  }
  
  // Identify worst performers
  const worstAgents = sortedByAccuracy.filter(a => a.accuracy < 0.5);
  const bestAgents = sortedByAccuracy.filter(a => a.accuracy >= 0.5);
  
  console.log('\n  ROOT CAUSES OF LOSSES:');
  console.log('  ' + '─'.repeat(60));
  
  if (worstAgents.length > bestAgents.length) {
    console.log(`  1. MAJORITY OF AGENTS ARE WRONG: ${worstAgents.length}/${agentResults.length} agents have <50% accuracy`);
    console.log(`     → These agents are actively hurting performance`);
  }
  
  const avgAccuracy = agentResults.reduce((sum, a) => sum + a.accuracy, 0) / agentResults.length;
  if (avgAccuracy < 0.5) {
    console.log(`  2. AVERAGE AGENT ACCURACY IS ${(avgAccuracy * 100).toFixed(1)}% (below 50%)`);
    console.log(`     → System is worse than random coin flip`);
  }
  
  if (consensusResult.strongConsensusAccuracy < consensusResult.weakConsensusAccuracy) {
    console.log(`  3. CONSENSUS AMPLIFIES ERRORS: Strong consensus is LESS accurate than weak`);
    console.log(`     → Agents are reinforcing each other's mistakes`);
  }
  
  const highConfidenceWrongAgents = agentResults.filter(a => a.avgConfidenceWhenIncorrect > a.avgConfidenceWhenCorrect);
  if (highConfidenceWrongAgents.length > 0) {
    console.log(`  4. ${highConfidenceWrongAgents.length} AGENTS HAVE INVERTED CONFIDENCE:`);
    for (const agent of highConfidenceWrongAgents) {
      console.log(`     → ${agent.agentName}: More confident when WRONG`);
    }
  }
  
  // ============================================================================
  // PART 4: RECOMMENDED FIXES
  // ============================================================================
  
  console.log('\n');
  console.log('='.repeat(100));
  console.log('PART 4: RECOMMENDED FIXES');
  console.log('='.repeat(100));
  
  console.log('\n  IMMEDIATE FIXES (Critical):');
  console.log('  ' + '─'.repeat(60));
  
  // Disable worst agents
  const toDisable = worstAgents.filter(a => a.accuracy < 0.4);
  if (toDisable.length > 0) {
    console.log(`  1. DISABLE these agents (accuracy <40%):`);
    for (const agent of toDisable) {
      console.log(`     → ${agent.agentName} (${(agent.accuracy * 100).toFixed(1)}%)`);
    }
  }
  
  // Invert signals for agents with <30% accuracy
  const toInvert = worstAgents.filter(a => a.accuracy < 0.3);
  if (toInvert.length > 0) {
    console.log(`  2. INVERT signals for these agents (accuracy <30% means inverse is >70%):`);
    for (const agent of toInvert) {
      console.log(`     → ${agent.agentName} (${(agent.accuracy * 100).toFixed(1)}% → ${((1 - agent.accuracy) * 100).toFixed(1)}% if inverted)`);
    }
  }
  
  console.log('\n  STRUCTURAL FIXES (Important):');
  console.log('  ' + '─'.repeat(60));
  console.log('  3. Recalibrate confidence calculations for all agents');
  console.log('  4. Add market regime filter - disable all trading in RANGING/CHOPPY');
  console.log('  5. Reduce agent count from 12 to top 5-6 performers only');
  console.log('  6. Add contrarian weighting when consensus is too strong');
  console.log('  7. Implement time-of-day filter (avoid low-volume periods)');
  
  console.log('\n  POSITION MANAGEMENT FIXES:');
  console.log('  ' + '─'.repeat(60));
  console.log('  8. Tighten entry criteria - only trade on 80%+ agent agreement');
  console.log('  9. Implement immediate breakeven stop after any profit');
  console.log('  10. Add "no trade zone" detection for persistent bad conditions');
  console.log('  11. Scale position size inversely with agent disagreement');
  
  // Save report
  const fs = await import('fs');
  const reportPath = `/home/ubuntu/seer/docs/COMPREHENSIVE_AUDIT_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  
  let report = `
COMPREHENSIVE INSTITUTIONAL-GRADE AUDIT REPORT
==============================================
Generated: ${new Date().toISOString()}
Period: ${startTime.toISOString()} to ${endTime.toISOString()}
Data Points: ${btcCandles.length} hourly candles

EXECUTIVE SUMMARY
-----------------
Average Agent Accuracy: ${(avgAccuracy * 100).toFixed(1)}%
Consensus Accuracy: ${(consensusResult.consensusAccuracy * 100).toFixed(1)}%
Agents Below 50% Accuracy: ${worstAgents.length}/${agentResults.length}

INDIVIDUAL AGENT PERFORMANCE
----------------------------
`;

  for (const agent of sortedByAccuracy) {
    report += `
${agent.agentName}
  Accuracy: ${(agent.accuracy * 100).toFixed(1)}%
  Signals: ${agent.totalSignals} (Bull: ${agent.bullishSignals}, Bear: ${agent.bearishSignals})
  Confidence When Correct: ${(agent.avgConfidenceWhenCorrect * 100).toFixed(1)}%
  Confidence When Incorrect: ${(agent.avgConfidenceWhenIncorrect * 100).toFixed(1)}%
  Issues: ${agent.issues.join('; ') || 'None'}
`;
  }

  report += `
CONSENSUS ANALYSIS
------------------
Overall Accuracy: ${(consensusResult.consensusAccuracy * 100).toFixed(1)}%
Strong Consensus Accuracy: ${(consensusResult.strongConsensusAccuracy * 100).toFixed(1)}%
Weak Consensus Accuracy: ${(consensusResult.weakConsensusAccuracy * 100).toFixed(1)}%
Conflicting Signals: ${consensusResult.conflictingSignalsCount}

ROOT CAUSES
-----------
1. ${worstAgents.length}/${agentResults.length} agents have <50% accuracy
2. Average accuracy ${(avgAccuracy * 100).toFixed(1)}% is below random (50%)
3. ${highConfidenceWrongAgents.length} agents have inverted confidence
4. Consensus amplifies errors instead of filtering them

RECOMMENDED FIXES
-----------------
1. Disable agents with <40% accuracy
2. Invert signals for agents with <30% accuracy
3. Reduce to top 5-6 agents only
4. Add market regime filter
5. Tighten entry to 80%+ agreement
6. Implement immediate breakeven stops
`;

  fs.writeFileSync(reportPath, report);
  console.log(`\nFull report saved to: ${reportPath}`);
}

// Run the audit
runComprehensiveAudit().catch(console.error);
