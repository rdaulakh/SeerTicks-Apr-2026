/**
 * Comprehensive Backtest Engine
 * 
 * Tests the complete SEER trading workflow:
 * 1. Fetches 2 months of historical OHLCV data from Coinbase
 * 2. Replays data through agent signal generation
 * 3. Simulates consensus mechanism
 * 4. Executes trades based on consensus
 * 5. Manages positions with intelligent exits
 * 6. Analyzes winning vs losing trades
 * 7. Audits all services and strategies
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getDb } from '../db';
import { winningPatterns, agentSignals } from '../../drizzle/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';

// Types
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AgentSignalData {
  agentName: string;
  symbol: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
  executionScore: number;
  timestamp: number;
}

export interface ConsensusResult {
  symbol: string;
  timestamp: number;
  direction: 'buy' | 'sell' | 'hold';
  consensus: number;
  confidence: number;
  agentVotes: AgentSignalData[];
  regime: MarketRegime;
  isAlphaSignal: boolean;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  quantity: number;
  positionValue: number;
  stopLoss: number;
  takeProfit: number;
  consensus: number;
  confidence: number;
  regime: MarketRegime;
  agentSignals: AgentSignalData[];
  isAlphaSignal: boolean;
  
  // Exit tracking
  partialExits: { price: number; quantity: number; pnlPercent: number; reason: string }[];
  breakevenActivated: boolean;
  highestPrice: number;
  lowestPrice: number;
  
  // Results
  pnl?: number;
  pnlPercent?: number;
  exitReason?: string;
  holdTimeMs?: number;
  
  // Analysis
  winningFactors?: string[];
  losingFactors?: string[];
}

export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'choppy';

export interface BacktestConfig {
  // Period
  startDate: Date;
  endDate: Date;
  symbols: string[];
  
  // Capital
  initialCapital: number;
  
  // Consensus thresholds
  consensusThreshold: number;
  alphaThreshold: number;
  minAgentsRequired: number;
  
  // Position sizing
  basePositionPercent: number;
  maxPositionPercent: number;
  confidenceMultiplier: number;
  
  // Exit strategy
  breakevenActivationPercent: number;
  breakevenBuffer: number;
  partialProfitLevels: { pnlPercent: number; exitPercent: number }[];
  trailingActivationPercent: number;
  trailingPercent: number;
  emergencyStopPercent: number;
  maxHoldTimeMinutes: number;
  
  // Fees
  feePercent: number;
  
  // Regime strategies
  regimeStrategies: Record<MarketRegime, boolean>;
}

export interface BacktestResult {
  // Summary
  symbol: string;
  period: { start: Date; end: Date };
  initialCapital: number;
  finalCapital: number;
  totalPnl: number;
  totalPnlPercent: number;
  
  // Trade stats
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  
  // Detailed analysis
  tradesByRegime: Record<MarketRegime, { trades: number; winRate: number; pnl: number }>;
  tradesByAgent: Record<string, { trades: number; winRate: number; pnl: number }>;
  tradesByHour: Record<number, { trades: number; winRate: number; pnl: number }>;
  
  // Win/Loss analysis
  winningTradeFactors: Record<string, number>;
  losingTradeFactors: Record<string, number>;
  
  // All trades
  trades: BacktestTrade[];
  
  // Equity curve
  equityCurve: { timestamp: number; equity: number }[];
}

const DEFAULT_CONFIG: BacktestConfig = {
  startDate: new Date(getActiveClock().now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
  endDate: new Date(),
  symbols: ['BTC-USD', 'ETH-USD'],
  
  initialCapital: 50000,
  
  consensusThreshold: 0.60,
  alphaThreshold: 0.70,
  minAgentsRequired: 3,
  
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
  
  regimeStrategies: {
    trending_up: true,
    trending_down: true,
    ranging: true,
    volatile: true,
    choppy: false,
  },
};

// Agent definitions
const FAST_AGENTS = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
const SLOW_AGENTS = ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'];
const PHASE2_AGENTS = ['WhaleTracker', 'FundingRateAnalyst', 'LiquidationHeatmap', 'OnChainFlowAnalyst', 'VolumeProfileAnalyzer'];

// Agent weights (from production config)
const AGENT_WEIGHTS: Record<string, number> = {
  TechnicalAnalyst: 0.40,
  PatternMatcher: 0.35,
  OrderFlowAnalyst: 0.25,
  SentimentAnalyst: 0.33,
  NewsSentinel: 0.33,
  MacroAnalyst: 0.34,
  OnChainAnalyst: 0.20,
  WhaleTracker: 0.15,
  FundingRateAnalyst: 0.15,
  LiquidationHeatmap: 0.15,
  OnChainFlowAnalyst: 0.15,
  VolumeProfileAnalyzer: 0.20,
};

export class ComprehensiveBacktestEngine extends EventEmitter {
  private config: BacktestConfig;
  private capital: number;
  private trades: BacktestTrade[] = [];
  private openTrades: Map<string, BacktestTrade> = new Map();
  private equityCurve: { timestamp: number; equity: number }[] = [];
  private historicalData: Map<string, OHLCV[]> = new Map();
  
  constructor(config?: Partial<BacktestConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capital = this.config.initialCapital;
  }

  /**
   * Fetch historical OHLCV data from Coinbase API
   */
  async fetchHistoricalData(symbol: string, granularity: number = 3600): Promise<OHLCV[]> {
    console.log(`[Backtest] Fetching historical data for ${symbol}...`);
    
    const candles: OHLCV[] = [];
    const endTime = Math.floor(this.config.endDate.getTime() / 1000);
    const startTime = Math.floor(this.config.startDate.getTime() / 1000);
    
    // Coinbase API limits to 300 candles per request
    const maxCandles = 300;
    let currentEnd = endTime;
    
    while (currentEnd > startTime) {
      const currentStart = Math.max(startTime, currentEnd - (maxCandles * granularity));
      
      try {
        const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?start=${currentStart}&end=${currentEnd}&granularity=${granularity}`;
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SEER-Backtest/1.0',
          },
        });
        
        if (!response.ok) {
          console.warn(`[Backtest] API error: ${response.status} ${response.statusText}`);
          break;
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
          break;
        }
        
        // Coinbase returns [timestamp, low, high, open, close, volume]
        for (const candle of data) {
          candles.push({
            timestamp: candle[0] * 1000,
            open: parseFloat(candle[3]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[1]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
          });
        }
        
        currentEnd = currentStart - 1;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`[Backtest] Error fetching data:`, error);
        break;
      }
    }
    
    // Sort by timestamp ascending
    candles.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`[Backtest] Fetched ${candles.length} candles for ${symbol}`);
    console.log(`[Backtest] Date range: ${new Date(candles[0]?.timestamp).toISOString()} to ${new Date(candles[candles.length - 1]?.timestamp).toISOString()}`);
    
    return candles;
  }

  /**
   * Generate agent signals from candle data
   * Simulates what each agent would have produced at that point in time
   */
  generateAgentSignals(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData[] {
    const signals: AgentSignalData[] = [];
    
    // Technical Analyst - RSI, MACD, Moving Averages
    const technicalSignal = this.generateTechnicalSignal(symbol, candle, history);
    signals.push(technicalSignal);
    
    // Pattern Matcher - Candlestick patterns
    const patternSignal = this.generatePatternSignal(symbol, candle, history);
    signals.push(patternSignal);
    
    // Order Flow Analyst - Volume analysis
    const orderFlowSignal = this.generateOrderFlowSignal(symbol, candle, history);
    signals.push(orderFlowSignal);
    
    // Sentiment Analyst - Market sentiment (simulated)
    const sentimentSignal = this.generateSentimentSignal(symbol, candle, history);
    signals.push(sentimentSignal);
    
    // Macro Analyst - Trend analysis
    const macroSignal = this.generateMacroSignal(symbol, candle, history);
    signals.push(macroSignal);
    
    // Whale Tracker - Large volume detection
    const whaleSignal = this.generateWhaleSignal(symbol, candle, history);
    signals.push(whaleSignal);
    
    return signals;
  }

  /**
   * Technical Analyst signal generation
   */
  private generateTechnicalSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 26) {
      return this.createNeutralSignal('TechnicalAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const closes = history.map(c => c.close);
    
    // RSI calculation
    const rsi = this.calculateRSI(closes, 14);
    
    // MACD calculation
    const macd = this.calculateMACD(closes);
    
    // Moving averages
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = history.length >= 50 ? this.calculateSMA(closes, 50) : sma20;
    
    // Determine signal
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // RSI signals
    if (rsi < 30) {
      signal = 'bullish';
      confidence = 0.6 + (30 - rsi) / 100;
      reasoning = `RSI oversold at ${rsi.toFixed(1)}`;
    } else if (rsi > 70) {
      signal = 'bearish';
      confidence = 0.6 + (rsi - 70) / 100;
      reasoning = `RSI overbought at ${rsi.toFixed(1)}`;
    }
    
    // MACD confirmation
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      if (signal === 'bullish') {
        confidence += 0.1;
        reasoning += ', MACD bullish crossover';
      } else if (signal === 'neutral') {
        signal = 'bullish';
        confidence = 0.55;
        reasoning = 'MACD bullish crossover';
      }
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      if (signal === 'bearish') {
        confidence += 0.1;
        reasoning += ', MACD bearish crossover';
      } else if (signal === 'neutral') {
        signal = 'bearish';
        confidence = 0.55;
        reasoning = 'MACD bearish crossover';
      }
    }
    
    // Moving average trend
    const currentPrice = candle.close;
    if (currentPrice > sma20 && sma20 > sma50) {
      if (signal === 'bullish') confidence += 0.05;
      reasoning += reasoning ? ', uptrend confirmed' : 'Price above MAs in uptrend';
    } else if (currentPrice < sma20 && sma20 < sma50) {
      if (signal === 'bearish') confidence += 0.05;
      reasoning += reasoning ? ', downtrend confirmed' : 'Price below MAs in downtrend';
    }
    
    return {
      agentName: 'TechnicalAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No clear signal',
      executionScore: this.calculateExecutionScore(confidence, rsi, macd),
      timestamp: candle.timestamp,
    };
  }

  /**
   * Pattern Matcher signal generation
   */
  private generatePatternSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 5) {
      return this.createNeutralSignal('PatternMatcher', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const recentCandles = history.slice(-5);
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Check for engulfing patterns
    const prev = recentCandles[recentCandles.length - 2];
    const curr = recentCandles[recentCandles.length - 1];
    
    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    
    // Bullish engulfing
    if (prev.close < prev.open && curr.close > curr.open && 
        curr.open <= prev.close && curr.close >= prev.open &&
        currBody > prevBody) {
      signal = 'bullish';
      confidence = 0.65;
      reasoning = 'Bullish engulfing pattern detected';
    }
    
    // Bearish engulfing
    if (prev.close > prev.open && curr.close < curr.open &&
        curr.open >= prev.close && curr.close <= prev.open &&
        currBody > prevBody) {
      signal = 'bearish';
      confidence = 0.65;
      reasoning = 'Bearish engulfing pattern detected';
    }
    
    // Hammer pattern (bullish reversal)
    const lowerWick = curr.open > curr.close ? curr.close - curr.low : curr.open - curr.low;
    const upperWick = curr.open > curr.close ? curr.high - curr.open : curr.high - curr.close;
    const body = currBody;
    
    if (lowerWick > body * 2 && upperWick < body * 0.5) {
      signal = 'bullish';
      confidence = 0.60;
      reasoning = 'Hammer pattern detected';
    }
    
    // Shooting star (bearish reversal)
    if (upperWick > body * 2 && lowerWick < body * 0.5) {
      signal = 'bearish';
      confidence = 0.60;
      reasoning = 'Shooting star pattern detected';
    }
    
    // Double top/bottom detection (simplified)
    if (history.length >= 20) {
      const highs = history.slice(-20).map(c => c.high);
      const lows = history.slice(-20).map(c => c.low);
      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);
      
      // Check if current high is near previous high (double top)
      const nearMaxCount = highs.filter(h => h >= maxHigh * 0.99).length;
      if (nearMaxCount >= 2 && curr.high >= maxHigh * 0.99) {
        signal = 'bearish';
        confidence = 0.70;
        reasoning = 'Double top pattern detected';
      }
      
      // Check if current low is near previous low (double bottom)
      const nearMinCount = lows.filter(l => l <= minLow * 1.01).length;
      if (nearMinCount >= 2 && curr.low <= minLow * 1.01) {
        signal = 'bullish';
        confidence = 0.70;
        reasoning = 'Double bottom pattern detected';
      }
    }
    
    return {
      agentName: 'PatternMatcher',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No clear pattern',
      executionScore: Math.round(confidence * 100),
      timestamp: candle.timestamp,
    };
  }

  /**
   * Order Flow Analyst signal generation
   */
  private generateOrderFlowSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 20) {
      return this.createNeutralSignal('OrderFlowAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const volumes = history.map(c => c.volume);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = candle.volume;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Volume spike detection
    const volumeRatio = currentVolume / avgVolume;
    
    if (volumeRatio > 2) {
      // High volume - check price direction
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.6 + Math.min(volumeRatio - 2, 1) * 0.2;
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bullish price action`;
      } else {
        signal = 'bearish';
        confidence = 0.6 + Math.min(volumeRatio - 2, 1) * 0.2;
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bearish price action`;
      }
    } else if (volumeRatio > 1.5) {
      // Moderate volume increase
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.55;
        reasoning = `Above average volume (${volumeRatio.toFixed(1)}x) with bullish candle`;
      } else {
        signal = 'bearish';
        confidence = 0.55;
        reasoning = `Above average volume (${volumeRatio.toFixed(1)}x) with bearish candle`;
      }
    }
    
    // Volume trend analysis
    const recentVolumes = volumes.slice(-5);
    const volumeTrend = recentVolumes[4] > recentVolumes[0] ? 'increasing' : 'decreasing';
    
    if (volumeTrend === 'increasing' && signal !== 'neutral') {
      confidence += 0.05;
      reasoning += ', volume trend increasing';
    }
    
    return {
      agentName: 'OrderFlowAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'Normal volume, no clear signal',
      executionScore: Math.round(confidence * 100),
      timestamp: candle.timestamp,
    };
  }

  /**
   * Sentiment Analyst signal generation (simulated based on price momentum)
   */
  private generateSentimentSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 10) {
      return this.createNeutralSignal('SentimentAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    // Simulate sentiment based on recent price momentum
    const closes = history.slice(-10).map(c => c.close);
    const momentum = (closes[closes.length - 1] - closes[0]) / closes[0];
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    if (momentum > 0.02) {
      signal = 'bullish';
      confidence = 0.55 + Math.min(momentum, 0.1) * 2;
      reasoning = `Positive momentum (${(momentum * 100).toFixed(2)}%) suggesting bullish sentiment`;
    } else if (momentum < -0.02) {
      signal = 'bearish';
      confidence = 0.55 + Math.min(Math.abs(momentum), 0.1) * 2;
      reasoning = `Negative momentum (${(momentum * 100).toFixed(2)}%) suggesting bearish sentiment`;
    } else {
      reasoning = 'Neutral momentum, mixed sentiment';
    }
    
    return {
      agentName: 'SentimentAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning,
      executionScore: Math.round(confidence * 80), // Slow agent, lower execution score
      timestamp: candle.timestamp,
    };
  }

  /**
   * Macro Analyst signal generation
   */
  private generateMacroSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 50) {
      return this.createNeutralSignal('MacroAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const closes = history.map(c => c.close);
    const sma50 = this.calculateSMA(closes, 50);
    const sma20 = this.calculateSMA(closes, 20);
    const currentPrice = candle.close;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Long-term trend analysis
    if (currentPrice > sma50 && sma20 > sma50) {
      signal = 'bullish';
      confidence = 0.60;
      reasoning = 'Price above 50 SMA with 20 SMA above 50 SMA - bullish macro trend';
    } else if (currentPrice < sma50 && sma20 < sma50) {
      signal = 'bearish';
      confidence = 0.60;
      reasoning = 'Price below 50 SMA with 20 SMA below 50 SMA - bearish macro trend';
    } else {
      reasoning = 'Mixed signals - no clear macro trend';
    }
    
    // Trend strength
    const trendStrength = Math.abs(currentPrice - sma50) / sma50;
    if (trendStrength > 0.05) {
      confidence += 0.1;
      reasoning += `, strong trend (${(trendStrength * 100).toFixed(1)}% from 50 SMA)`;
    }
    
    return {
      agentName: 'MacroAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning,
      executionScore: Math.round(confidence * 70), // Slow agent
      timestamp: candle.timestamp,
    };
  }

  /**
   * Whale Tracker signal generation
   */
  private generateWhaleSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 20) {
      return this.createNeutralSignal('WhaleTracker', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const volumes = history.map(c => c.volume);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(volumes.slice(-20).reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / 20);
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Detect whale activity (volume > 3 std dev from mean)
    const zScore = (candle.volume - avgVolume) / stdDev;
    
    if (zScore > 3) {
      // Whale activity detected
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.70 + Math.min(zScore - 3, 2) * 0.1;
        reasoning = `Whale accumulation detected (${zScore.toFixed(1)} std dev volume spike, bullish)`;
      } else {
        signal = 'bearish';
        confidence = 0.70 + Math.min(zScore - 3, 2) * 0.1;
        reasoning = `Whale distribution detected (${zScore.toFixed(1)} std dev volume spike, bearish)`;
      }
    } else if (zScore > 2) {
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.55;
        reasoning = `Possible whale activity (${zScore.toFixed(1)} std dev volume)`;
      } else {
        signal = 'bearish';
        confidence = 0.55;
        reasoning = `Possible whale activity (${zScore.toFixed(1)} std dev volume)`;
      }
    }
    
    return {
      agentName: 'WhaleTracker',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No significant whale activity detected',
      executionScore: Math.round(confidence * 85),
      timestamp: candle.timestamp,
    };
  }

  /**
   * Create neutral signal helper
   */
  private createNeutralSignal(agentName: string, symbol: string, timestamp: number, reasoning: string): AgentSignalData {
    return {
      agentName,
      symbol,
      signal: 'neutral',
      confidence: 0.5,
      reasoning,
      executionScore: 50,
      timestamp,
    };
  }

  /**
   * Calculate consensus from agent signals
   */
  calculateConsensus(signals: AgentSignalData[], regime: MarketRegime): ConsensusResult {
    const symbol = signals[0]?.symbol || 'UNKNOWN';
    const timestamp = signals[0]?.timestamp || getActiveClock().now();
    
    // Separate fast and slow agents
    const fastSignals = signals.filter(s => FAST_AGENTS.includes(s.agentName));
    const slowSignals = signals.filter(s => SLOW_AGENTS.includes(s.agentName));
    const phase2Signals = signals.filter(s => PHASE2_AGENTS.includes(s.agentName));
    
    // Calculate weighted scores
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    
    // Fast agents (100% weight)
    for (const signal of fastSignals) {
      const weight = AGENT_WEIGHTS[signal.agentName] || 0.25;
      totalWeight += weight;
      
      if (signal.signal === 'bullish') {
        bullishScore += weight * signal.confidence;
      } else if (signal.signal === 'bearish') {
        bearishScore += weight * signal.confidence;
      }
    }
    
    // Slow agents (20% bonus weight)
    const slowBonus = 0.20;
    for (const signal of slowSignals) {
      const weight = (AGENT_WEIGHTS[signal.agentName] || 0.33) * slowBonus;
      totalWeight += weight;
      
      if (signal.signal === 'bullish') {
        bullishScore += weight * signal.confidence;
      } else if (signal.signal === 'bearish') {
        bearishScore += weight * signal.confidence;
      }
    }
    
    // Phase 2 agents (50% weight)
    const phase2Weight = 0.50;
    for (const signal of phase2Signals) {
      const weight = (AGENT_WEIGHTS[signal.agentName] || 0.15) * phase2Weight;
      totalWeight += weight;
      
      if (signal.signal === 'bullish') {
        bullishScore += weight * signal.confidence;
      } else if (signal.signal === 'bearish') {
        bearishScore += weight * signal.confidence;
      }
    }
    
    // Normalize scores
    const normalizedBullish = totalWeight > 0 ? bullishScore / totalWeight : 0;
    const normalizedBearish = totalWeight > 0 ? bearishScore / totalWeight : 0;
    
    // Calculate consensus
    const consensus = normalizedBullish - normalizedBearish;
    const confidence = Math.max(normalizedBullish, normalizedBearish);
    
    // Determine direction
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    
    // Apply regime-aware threshold
    const regimeMultiplier = this.getRegimeMultiplier(regime);
    const effectiveThreshold = this.config.consensusThreshold * regimeMultiplier;
    
    if (consensus > effectiveThreshold) {
      direction = 'buy';
    } else if (consensus < -effectiveThreshold) {
      direction = 'sell';
    }
    
    // Check for alpha signal
    const isAlphaSignal = Math.abs(consensus) >= this.config.alphaThreshold;
    
    return {
      symbol,
      timestamp,
      direction,
      consensus,
      confidence,
      agentVotes: signals,
      regime,
      isAlphaSignal,
    };
  }

  /**
   * Get regime multiplier for threshold adjustment
   */
  private getRegimeMultiplier(regime: MarketRegime): number {
    switch (regime) {
      case 'trending_up':
      case 'trending_down':
        return 0.80; // More aggressive in trends
      case 'volatile':
        return 1.40; // More conservative in volatility
      case 'ranging':
        return 1.10;
      case 'choppy':
        return 2.00; // Very conservative
      default:
        return 1.00;
    }
  }

  /**
   * Detect market regime from price history
   */
  detectRegime(candles: OHLCV[]): MarketRegime {
    if (candles.length < 50) return 'ranging';
    
    const closes = candles.map(c => c.close);
    const recent = closes.slice(-20);
    
    // Calculate SMA
    const sma20 = recent.reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    
    // Calculate ATR%
    const atrPercent = this.calculateATRPercent(candles.slice(-14));
    
    // Calculate price range
    const priceRange = (Math.max(...recent) - Math.min(...recent)) / recent[0] * 100;
    
    // Calculate trend strength
    const currentPrice = closes[closes.length - 1];
    const trendStrength = Math.abs(currentPrice - sma50) / sma50 * 100;
    
    // Determine regime
    if (atrPercent > 3) {
      return 'volatile';
    }
    
    if (trendStrength > 3) {
      if (currentPrice > sma20 && sma20 > sma50) {
        return 'trending_up';
      } else if (currentPrice < sma20 && sma20 < sma50) {
        return 'trending_down';
      }
    }
    
    if (priceRange < 2 && atrPercent < 1.5) {
      return 'choppy';
    }
    
    return 'ranging';
  }

  /**
   * Run the comprehensive backtest
   */
  async runBacktest(): Promise<BacktestResult[]> {
    console.log('\n========================================');
    console.log('   COMPREHENSIVE BACKTEST ENGINE');
    console.log('========================================');
    console.log(`Period: ${this.config.startDate.toISOString()} to ${this.config.endDate.toISOString()}`);
    console.log(`Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`Initial Capital: $${this.config.initialCapital.toLocaleString()}`);
    console.log(`Consensus Threshold: ${(this.config.consensusThreshold * 100).toFixed(0)}%`);
    console.log('========================================\n');
    
    const results: BacktestResult[] = [];
    
    for (const symbol of this.config.symbols) {
      console.log(`\n--- Processing ${symbol} ---\n`);
      
      // Fetch historical data
      const candles = await this.fetchHistoricalData(symbol);
      
      if (candles.length < 100) {
        console.warn(`[Backtest] Insufficient data for ${symbol}, skipping...`);
        continue;
      }
      
      this.historicalData.set(symbol, candles);
      
      // Reset state for this symbol
      this.capital = this.config.initialCapital;
      this.trades = [];
      this.openTrades.clear();
      this.equityCurve = [{ timestamp: candles[0].timestamp, equity: this.capital }];
      
      // Run simulation
      const result = await this.simulateTrading(symbol, candles);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Simulate trading on historical data
   */
  private async simulateTrading(symbol: string, candles: OHLCV[]): Promise<BacktestResult> {
    let signalsGenerated = 0;
    let tradesOpened = 0;
    let tradesClosed = 0;
    
    // Start from candle 50 to have enough history
    for (let i = 50; i < candles.length; i++) {
      const candle = candles[i];
      const history = candles.slice(0, i + 1);
      
      // 1. Update open positions
      this.updateOpenPositions(candle);
      
      // 2. Generate agent signals
      const signals = this.generateAgentSignals(symbol, candle, history);
      signalsGenerated++;
      
      // 3. Detect market regime
      const regime = this.detectRegime(history);
      
      // 4. Calculate consensus
      const consensus = this.calculateConsensus(signals, regime);
      
      // 5. Check if we should trade
      if (this.openTrades.size === 0 && this.config.regimeStrategies[regime]) {
        if (consensus.direction !== 'hold' && 
            signals.filter(s => s.signal !== 'neutral').length >= this.config.minAgentsRequired) {
          
          this.openTrade(symbol, consensus, candle);
          tradesOpened++;
        }
      }
      
      // Update equity curve
      if (i % 10 === 0) {
        this.equityCurve.push({
          timestamp: candle.timestamp,
          equity: this.calculateCurrentEquity(candle.close),
        });
      }
    }
    
    // Close any remaining open positions
    const lastCandle = candles[candles.length - 1];
    for (const [tradeId] of this.openTrades) {
      this.closeTrade(tradeId, lastCandle.close, 'backtest_end');
      tradesClosed++;
    }
    
    console.log(`\n[${symbol}] Backtest Complete:`);
    console.log(`  Signals Generated: ${signalsGenerated}`);
    console.log(`  Trades Opened: ${tradesOpened}`);
    console.log(`  Trades Closed: ${tradesClosed}`);
    
    // Calculate results
    return this.calculateResults(symbol);
  }

  /**
   * Open a new trade
   */
  private openTrade(symbol: string, consensus: ConsensusResult, candle: OHLCV): void {
    const direction = consensus.direction === 'buy' ? 'long' : 'short';
    
    // Calculate position size based on confidence
    const confidenceMultiplier = 1 + (consensus.confidence - 0.5) * this.config.confidenceMultiplier;
    let positionPercent = this.config.basePositionPercent * confidenceMultiplier;
    
    // Alpha signal gets max position
    if (consensus.isAlphaSignal) {
      positionPercent = this.config.maxPositionPercent;
    }
    
    positionPercent = Math.min(positionPercent, this.config.maxPositionPercent);
    
    const positionValue = this.capital * positionPercent;
    const quantity = positionValue / candle.close;
    
    // Calculate stop loss and take profit
    const atr = this.calculateATRPercent(this.historicalData.get(symbol)?.slice(-14) || []);
    const stopLossPercent = Math.max(atr * 1.5, 2); // At least 2%
    const takeProfitPercent = stopLossPercent * 2; // 2:1 R:R minimum
    
    const stopLoss = direction === 'long' 
      ? candle.close * (1 - stopLossPercent / 100)
      : candle.close * (1 + stopLossPercent / 100);
    
    const takeProfit = direction === 'long'
      ? candle.close * (1 + takeProfitPercent / 100)
      : candle.close * (1 - takeProfitPercent / 100);
    
    const trade: BacktestTrade = {
      id: `${symbol}-${getActiveClock().now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      direction,
      entryPrice: candle.close,
      entryTime: candle.timestamp,
      quantity,
      positionValue,
      stopLoss,
      takeProfit,
      consensus: consensus.consensus,
      confidence: consensus.confidence,
      regime: consensus.regime,
      agentSignals: consensus.agentVotes,
      isAlphaSignal: consensus.isAlphaSignal,
      partialExits: [],
      breakevenActivated: false,
      highestPrice: candle.close,
      lowestPrice: candle.close,
    };
    
    this.openTrades.set(trade.id, trade);
    this.trades.push(trade);
    
    // Deduct position value from capital
    this.capital -= positionValue;
    
    console.log(`📈 TRADE OPENED: ${trade.id}`);
    console.log(`   ${direction.toUpperCase()} ${symbol} @ $${candle.close.toFixed(2)}`);
    console.log(`   Size: $${positionValue.toFixed(2)} (${(positionPercent * 100).toFixed(1)}%)`);
    console.log(`   Consensus: ${(consensus.consensus * 100).toFixed(1)}% | Confidence: ${(consensus.confidence * 100).toFixed(1)}%`);
    console.log(`   Regime: ${consensus.regime} | Alpha: ${consensus.isAlphaSignal}`);
  }

  /**
   * Update open positions with new price
   */
  private updateOpenPositions(candle: OHLCV): void {
    for (const [tradeId, trade] of this.openTrades) {
      // Update high/low tracking
      trade.highestPrice = Math.max(trade.highestPrice, candle.high);
      trade.lowestPrice = Math.min(trade.lowestPrice, candle.low);
      
      // Calculate current P&L
      const pnlPercent = trade.direction === 'long'
        ? ((candle.close - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - candle.close) / trade.entryPrice) * 100;
      
      // 1. Emergency stop (catastrophic loss protection)
      if (pnlPercent <= this.config.emergencyStopPercent) {
        this.closeTrade(tradeId, candle.close, `emergency_stop_${pnlPercent.toFixed(2)}%`);
        continue;
      }
      
      // 2. Take profit hit
      if ((trade.direction === 'long' && candle.high >= trade.takeProfit) ||
          (trade.direction === 'short' && candle.low <= trade.takeProfit)) {
        this.closeTrade(tradeId, trade.takeProfit, 'take_profit');
        continue;
      }
      
      // 3. Breakeven activation
      if (!trade.breakevenActivated && pnlPercent >= this.config.breakevenActivationPercent) {
        trade.breakevenActivated = true;
        trade.stopLoss = trade.direction === 'long'
          ? trade.entryPrice * (1 + this.config.breakevenBuffer / 100)
          : trade.entryPrice * (1 - this.config.breakevenBuffer / 100);
        console.log(`   🔒 Breakeven activated for ${tradeId}`);
      }
      
      // 4. Stop loss hit (including breakeven)
      if ((trade.direction === 'long' && candle.low <= trade.stopLoss) ||
          (trade.direction === 'short' && candle.high >= trade.stopLoss)) {
        const reason = trade.breakevenActivated ? 'breakeven_stop' : 'stop_loss';
        this.closeTrade(tradeId, trade.stopLoss, reason);
        continue;
      }
      
      // 5. Partial profit taking
      const remainingPercent = (trade.quantity - trade.partialExits.reduce((sum, e) => sum + e.quantity, 0)) / trade.quantity * 100;
      
      for (const level of this.config.partialProfitLevels) {
        if (pnlPercent >= level.pnlPercent && remainingPercent > 25) {
          const alreadyTaken = trade.partialExits.some(e => Math.abs(e.pnlPercent - level.pnlPercent) < 0.5);
          
          if (!alreadyTaken) {
            const exitQuantity = trade.quantity * (level.exitPercent / 100);
            const exitValue = exitQuantity * candle.close;
            const fee = exitValue * (this.config.feePercent / 100);
            
            let partialPnl: number;
            if (trade.direction === 'long') {
              partialPnl = (candle.close - trade.entryPrice) * exitQuantity - fee;
            } else {
              partialPnl = (trade.entryPrice - candle.close) * exitQuantity - fee;
            }
            
            this.capital += partialPnl + (exitQuantity * trade.entryPrice);
            
            trade.partialExits.push({
              price: candle.close,
              quantity: exitQuantity,
              pnlPercent,
              reason: `partial_${level.pnlPercent}%`,
            });
            
            console.log(`   💰 Partial exit ${tradeId}: ${level.exitPercent}% @ +${pnlPercent.toFixed(2)}%`);
          }
        }
      }
      
      // 6. Trailing stop
      if (pnlPercent >= this.config.trailingActivationPercent) {
        const peakPnl = trade.direction === 'long'
          ? ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.lowestPrice) / trade.entryPrice) * 100;
        
        const drawdownFromPeak = peakPnl - pnlPercent;
        
        if (drawdownFromPeak >= this.config.trailingPercent) {
          this.closeTrade(tradeId, candle.close, `trailing_stop_from_peak_${peakPnl.toFixed(2)}%`);
          continue;
        }
      }
      
      // 7. Time-based exit
      const holdTimeMinutes = (candle.timestamp - trade.entryTime) / (1000 * 60);
      if (holdTimeMinutes >= this.config.maxHoldTimeMinutes) {
        if (pnlPercent >= 0) {
          this.closeTrade(tradeId, candle.close, `time_exit_profitable_${pnlPercent.toFixed(2)}%`);
        } else if (holdTimeMinutes >= this.config.maxHoldTimeMinutes * 1.5) {
          this.closeTrade(tradeId, candle.close, `time_exit_extended_${pnlPercent.toFixed(2)}%`);
        }
      }
    }
  }

  /**
   * Close a trade
   */
  private closeTrade(tradeId: string, exitPrice: number, reason: string): void {
    const trade = this.openTrades.get(tradeId);
    if (!trade) return;
    
    // Calculate remaining quantity
    const exitedQuantity = trade.partialExits.reduce((sum, e) => sum + e.quantity, 0);
    const remainingQuantity = trade.quantity - exitedQuantity;
    
    if (remainingQuantity <= 0) {
      this.openTrades.delete(tradeId);
      return;
    }
    
    // Calculate P&L
    const exitValue = remainingQuantity * exitPrice;
    const fee = exitValue * (this.config.feePercent / 100);
    
    let remainingPnl: number;
    if (trade.direction === 'long') {
      remainingPnl = (exitPrice - trade.entryPrice) * remainingQuantity - fee;
    } else {
      remainingPnl = (trade.entryPrice - exitPrice) * remainingQuantity - fee;
    }
    
    // Add partial exit P&Ls
    const partialPnl = trade.partialExits.reduce((sum, e) => {
      if (trade.direction === 'long') {
        return sum + (e.price - trade.entryPrice) * e.quantity;
      } else {
        return sum + (trade.entryPrice - e.price) * e.quantity;
      }
    }, 0);
    
    const totalPnl = remainingPnl + partialPnl;
    const totalPnlPercent = (totalPnl / trade.positionValue) * 100;
    
    // Update capital
    this.capital += remainingPnl + (remainingQuantity * trade.entryPrice);
    
    // Update trade record
    trade.exitPrice = exitPrice;
    trade.exitTime = getActiveClock().now();
    trade.pnl = totalPnl;
    trade.pnlPercent = totalPnlPercent;
    trade.exitReason = reason;
    trade.holdTimeMs = trade.exitTime - trade.entryTime;
    
    // Analyze trade
    this.analyzeTradeFactors(trade);
    
    this.openTrades.delete(tradeId);
    
    const emoji = totalPnl >= 0 ? '✅' : '❌';
    console.log(`${emoji} TRADE CLOSED: ${tradeId}`);
    console.log(`   Exit @ $${exitPrice.toFixed(2)} | Reason: ${reason}`);
    console.log(`   P&L: $${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}%)`);
  }

  /**
   * Analyze factors that contributed to trade outcome
   */
  private analyzeTradeFactors(trade: BacktestTrade): void {
    const factors: string[] = [];
    
    if ((trade.pnl || 0) > 0) {
      // Winning trade factors
      if (trade.consensus > 0.7) factors.push('high_consensus');
      if (trade.confidence > 0.7) factors.push('high_confidence');
      if (trade.isAlphaSignal) factors.push('alpha_signal');
      if (trade.regime === 'trending_up' || trade.regime === 'trending_down') factors.push('trending_market');
      if (trade.partialExits.length > 0) factors.push('partial_profit_taking');
      if (trade.breakevenActivated) factors.push('breakeven_protected');
      
      // Check agent agreement
      const bullishAgents = trade.agentSignals.filter(s => s.signal === 'bullish').length;
      const bearishAgents = trade.agentSignals.filter(s => s.signal === 'bearish').length;
      if (bullishAgents >= 4 || bearishAgents >= 4) factors.push('strong_agent_agreement');
      
      trade.winningFactors = factors;
    } else {
      // Losing trade factors
      if (trade.consensus < 0.5) factors.push('weak_consensus');
      if (trade.confidence < 0.6) factors.push('low_confidence');
      if (trade.regime === 'choppy') factors.push('choppy_market');
      if (trade.regime === 'volatile') factors.push('volatile_market');
      if (trade.exitReason?.includes('emergency')) factors.push('emergency_stop');
      if (trade.exitReason?.includes('stop_loss')) factors.push('stop_loss_hit');
      
      // Check agent disagreement
      const signals = trade.agentSignals.map(s => s.signal);
      const uniqueSignals = new Set(signals);
      if (uniqueSignals.size === 3) factors.push('agent_disagreement');
      
      trade.losingFactors = factors;
    }
  }

  /**
   * Calculate current equity
   */
  private calculateCurrentEquity(currentPrice: number): number {
    let equity = this.capital;
    
    for (const [, trade] of this.openTrades) {
      const unrealizedPnl = trade.direction === 'long'
        ? (currentPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - currentPrice) * trade.quantity;
      equity += trade.positionValue + unrealizedPnl;
    }
    
    return equity;
  }

  /**
   * Calculate final backtest results
   */
  private calculateResults(symbol: string): BacktestResult {
    const completedTrades = this.trades.filter(t => t.exitPrice !== undefined);
    const winningTrades = completedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = completedTrades.filter(t => (t.pnl || 0) <= 0);
    
    const totalPnl = completedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalPnlPercent = (totalPnl / this.config.initialCapital) * 100;
    
    const winRate = completedTrades.length > 0 ? winningTrades.length / completedTrades.length : 0;
    
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
      : 0;
    
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
      : 0;
    
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
    
    // Calculate max drawdown
    let peak = this.config.initialCapital;
    let maxDrawdown = 0;
    
    for (const point of this.equityCurve) {
      peak = Math.max(peak, point.equity);
      const drawdown = (peak - point.equity) / peak * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Calculate Sharpe ratio
    const returns = completedTrades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // Analyze by regime
    const tradesByRegime: Record<MarketRegime, { trades: number; winRate: number; pnl: number }> = {
      trending_up: { trades: 0, winRate: 0, pnl: 0 },
      trending_down: { trades: 0, winRate: 0, pnl: 0 },
      ranging: { trades: 0, winRate: 0, pnl: 0 },
      volatile: { trades: 0, winRate: 0, pnl: 0 },
      choppy: { trades: 0, winRate: 0, pnl: 0 },
    };
    
    for (const trade of completedTrades) {
      const regime = trade.regime;
      tradesByRegime[regime].trades++;
      tradesByRegime[regime].pnl += (trade.pnl || 0);
      if ((trade.pnl || 0) > 0) {
        tradesByRegime[regime].winRate++;
      }
    }
    
    for (const regime in tradesByRegime) {
      if (tradesByRegime[regime as MarketRegime].trades > 0) {
        tradesByRegime[regime as MarketRegime].winRate /= tradesByRegime[regime as MarketRegime].trades;
      }
    }
    
    // Analyze by agent
    const tradesByAgent: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    
    for (const trade of completedTrades) {
      for (const signal of trade.agentSignals) {
        if (!tradesByAgent[signal.agentName]) {
          tradesByAgent[signal.agentName] = { trades: 0, winRate: 0, pnl: 0 };
        }
        tradesByAgent[signal.agentName].trades++;
        tradesByAgent[signal.agentName].pnl += (trade.pnl || 0);
        if ((trade.pnl || 0) > 0) {
          tradesByAgent[signal.agentName].winRate++;
        }
      }
    }
    
    for (const agent in tradesByAgent) {
      if (tradesByAgent[agent].trades > 0) {
        tradesByAgent[agent].winRate /= tradesByAgent[agent].trades;
      }
    }
    
    // Analyze by hour
    const tradesByHour: Record<number, { trades: number; winRate: number; pnl: number }> = {};
    
    for (const trade of completedTrades) {
      const hour = new Date(trade.entryTime).getUTCHours();
      if (!tradesByHour[hour]) {
        tradesByHour[hour] = { trades: 0, winRate: 0, pnl: 0 };
      }
      tradesByHour[hour].trades++;
      tradesByHour[hour].pnl += (trade.pnl || 0);
      if ((trade.pnl || 0) > 0) {
        tradesByHour[hour].winRate++;
      }
    }
    
    for (const hour in tradesByHour) {
      if (tradesByHour[parseInt(hour)].trades > 0) {
        tradesByHour[parseInt(hour)].winRate /= tradesByHour[parseInt(hour)].trades;
      }
    }
    
    // Aggregate winning/losing factors
    const winningTradeFactors: Record<string, number> = {};
    const losingTradeFactors: Record<string, number> = {};
    
    for (const trade of winningTrades) {
      for (const factor of trade.winningFactors || []) {
        winningTradeFactors[factor] = (winningTradeFactors[factor] || 0) + 1;
      }
    }
    
    for (const trade of losingTrades) {
      for (const factor of trade.losingFactors || []) {
        losingTradeFactors[factor] = (losingTradeFactors[factor] || 0) + 1;
      }
    }
    
    return {
      symbol,
      period: { start: this.config.startDate, end: this.config.endDate },
      initialCapital: this.config.initialCapital,
      finalCapital: this.capital,
      totalPnl,
      totalPnlPercent,
      totalTrades: completedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      sharpeRatio,
      tradesByRegime,
      tradesByAgent,
      tradesByHour,
      winningTradeFactors,
      losingTradeFactors,
      trades: completedTrades,
      equityCurve: this.equityCurve,
    };
  }

  // Helper functions
  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macd = ema12 - ema26;
    
    // Calculate signal line (9-period EMA of MACD)
    const macdHistory: number[] = [];
    for (let i = 26; i < closes.length; i++) {
      const e12 = this.calculateEMA(closes.slice(0, i + 1), 12);
      const e26 = this.calculateEMA(closes.slice(0, i + 1), 26);
      macdHistory.push(e12 - e26);
    }
    
    const signal = macdHistory.length >= 9 ? this.calculateEMA(macdHistory, 9) : macd;
    
    return {
      macd,
      signal,
      histogram: macd - signal,
    };
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private calculateATRPercent(candles: OHLCV[]): number {
    if (candles.length < 2) return 0;
    
    let atr = 0;
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      atr += tr;
    }
    atr /= (candles.length - 1);
    
    return (atr / candles[candles.length - 1].close) * 100;
  }

  private calculateExecutionScore(confidence: number, rsi: number, macd: { histogram: number }): number {
    let score = confidence * 50;
    
    // RSI extremes boost score
    if (rsi < 30 || rsi > 70) score += 20;
    else if (rsi < 40 || rsi > 60) score += 10;
    
    // MACD momentum
    if (Math.abs(macd.histogram) > 0) score += 15;
    
    return Math.min(Math.round(score), 100);
  }
}

export default ComprehensiveBacktestEngine;
