/**
 * ONE-MONTH COMPREHENSIVE BACKTEST
 * 
 * Tests the complete SEER trading workflow:
 * 1. Agent Signal Generation
 * 2. Consensus Mechanism
 * 3. Trade Pick/Entry
 * 4. Trade Management
 * 5. Trade Exit
 * 
 * Benchmarks against A++ methodology requirements:
 * - Win Rate >= 65%
 * - Profit Factor >= 2.0
 * - Sharpe Ratio >= 1.5
 * - Max Drawdown <= 10%
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getDb } from '../db';
import { historicalCandles, agentSignals, trades } from '../../drizzle/schema';
import { sql, count, desc, and, gte, lte, eq, asc } from 'drizzle-orm';

// ============================================
// TYPES
// ============================================

export interface OHLCV {
  timestamp: Date;
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
  timestamp: Date;
}

export interface ConsensusResult {
  symbol: string;
  timestamp: Date;
  direction: 'buy' | 'sell' | 'hold';
  fastScore: number;
  slowBonus: number;
  totalConfidence: number;
  consensusThreshold: number;
  agentVotes: AgentSignalData[];
  regime: MarketRegime;
  isAlphaSignal: boolean;
  vetoActive: boolean;
  vetoReason?: string;
  passesQualityGate: boolean;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  entryTime: Date;
  exitPrice?: number;
  exitTime?: Date;
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
  startDate: Date;
  endDate: Date;
  symbols: string[];
  initialCapital: number;
  
  // A++ Grade Thresholds
  consensusThreshold: number;
  confidenceThreshold: number;
  minAgentsRequired: number;
  alphaThreshold: number;
  
  // Position sizing
  basePositionPercent: number;
  maxPositionPercent: number;
  confidenceMultiplier: number;
  
  // Exit strategy
  stopLossPercent: number;
  takeProfitPercent: number;
  breakevenActivationPercent: number;
  breakevenBuffer: number;
  partialProfitLevels: { pnlPercent: number; exitPercent: number }[];
  trailingActivationPercent: number;
  trailingPercent: number;
  maxHoldTimeMinutes: number;
  
  // Fees
  feePercent: number;
  
  // Regime strategies
  regimeStrategies: Record<MarketRegime, boolean>;
  
  // Macro veto
  enableMacroVeto: boolean;
}

export interface WorkflowStepResult {
  step: string;
  timestamp: Date;
  input: any;
  output: any;
  duration: number;
  success: boolean;
  notes: string[];
  gaps: string[];
  improvements: string[];
}

export interface BacktestResult {
  // Summary
  config: BacktestConfig;
  period: { start: Date; end: Date };
  initialCapital: number;
  finalCapital: number;
  totalPnl: number;
  totalPnlPercent: number;
  
  // A++ Grade Metrics
  grade: 'A++' | 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  
  // Trade stats
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  avgHoldTime: number;
  
  // Workflow Analysis
  workflowSteps: WorkflowStepResult[];
  
  // Detailed analysis
  tradesByRegime: Record<MarketRegime, { trades: number; winRate: number; pnl: number }>;
  tradesByAgent: Record<string, { trades: number; winRate: number; pnl: number; accuracy: number }>;
  tradesByHour: Record<number, { trades: number; winRate: number; pnl: number }>;
  
  // Win/Loss analysis
  winningTradeFactors: Record<string, number>;
  losingTradeFactors: Record<string, number>;
  
  // All trades
  trades: BacktestTrade[];
  
  // Equity curve
  equityCurve: { timestamp: Date; equity: number }[];
  
  // Gaps and Improvements
  gaps: string[];
  improvements: string[];
}

// ============================================
// AGENT DEFINITIONS
// ============================================

const FAST_AGENTS = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
const SLOW_AGENTS = ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'];
const DATA_AGENTS = ['WhaleTracker', 'ForexCorrelationAgent'];
const PHASE2_AGENTS = ['FundingRateAnalyst', 'LiquidationHeatmap', 'OnChainFlowAnalyst', 'VolumeProfileAnalyzer'];

const AGENT_WEIGHTS: Record<string, number> = {
  TechnicalAnalyst: 0.40,
  PatternMatcher: 0.35,
  OrderFlowAnalyst: 0.25,
  SentimentAnalyst: 0.33,
  NewsSentinel: 0.33,
  MacroAnalyst: 0.34,
  OnChainAnalyst: 0.20,
  WhaleTracker: 0.15,
  // WhaleAlertAgent removed — weight consolidated into WhaleTracker
  ForexCorrelationAgent: 0.10,
  FundingRateAnalyst: 0.15,
  LiquidationHeatmap: 0.15,
  OnChainFlowAnalyst: 0.15,
  VolumeProfileAnalyzer: 0.20,
};

// ============================================
// DEFAULT CONFIG (A++ GRADE)
// ============================================

const DEFAULT_CONFIG: BacktestConfig = {
  startDate: new Date('2025-12-01T00:00:00Z'),
  endDate: new Date('2025-12-31T00:00:00Z'),
  symbols: ['BTC-USD', 'ETH-USD'],
  initialCapital: 50000,
  
  // A++ Grade Thresholds (from methodology)
  consensusThreshold: 0.70,
  confidenceThreshold: 0.65,
  minAgentsRequired: 4,
  alphaThreshold: 0.80,
  
  // Position sizing
  basePositionPercent: 0.05,
  maxPositionPercent: 0.20,
  confidenceMultiplier: 2.0,
  
  // Exit strategy
  stopLossPercent: 0.05,
  takeProfitPercent: 0.10,
  breakevenActivationPercent: 0.5,
  breakevenBuffer: 0.1,
  partialProfitLevels: [
    { pnlPercent: 1.0, exitPercent: 25 },
    { pnlPercent: 1.5, exitPercent: 25 },
    { pnlPercent: 2.0, exitPercent: 25 },
  ],
  trailingActivationPercent: 1.5,
  trailingPercent: 0.5,
  maxHoldTimeMinutes: 240,
  
  // Fees
  feePercent: 0.1,
  
  // Regime strategies
  regimeStrategies: {
    trending_up: true,
    trending_down: true,
    ranging: true,
    volatile: true,
    choppy: false,
  },
  
  // Macro veto
  enableMacroVeto: true,
};

// ============================================
// BACKTEST ENGINE
// ============================================

export class OneMonthComprehensiveBacktest extends EventEmitter {
  private config: BacktestConfig;
  private capital: number;
  private trades: BacktestTrade[] = [];
  private openTrades: Map<string, BacktestTrade> = new Map();
  private equityCurve: { timestamp: Date; equity: number }[] = [];
  private historicalData: Map<string, OHLCV[]> = new Map();
  private workflowSteps: WorkflowStepResult[] = [];
  private gaps: string[] = [];
  private improvements: string[] = [];
  
  constructor(config?: Partial<BacktestConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capital = this.config.initialCapital;
  }

  // ============================================
  // STEP 1: FETCH HISTORICAL DATA
  // ============================================
  
  async fetchHistoricalData(): Promise<void> {
    const stepStart = getActiveClock().now();
    const notes: string[] = [];
    const stepGaps: string[] = [];
    const stepImprovements: string[] = [];
    
    console.log('\n========================================');
    console.log('STEP 1: FETCHING HISTORICAL DATA');
    console.log('========================================\n');
    
    const db = await getDb();
    if (!db) {
      throw new Error('Database connection failed');
    }
    
    for (const symbol of this.config.symbols) {
      console.log(`Fetching data for ${symbol}...`);
      
      const candles = await db.select({
        timestamp: historicalCandles.timestamp,
        open: historicalCandles.open,
        high: historicalCandles.high,
        low: historicalCandles.low,
        close: historicalCandles.close,
        volume: historicalCandles.volume,
      }).from(historicalCandles)
        .where(and(
          eq(historicalCandles.symbol, symbol),
          eq(historicalCandles.interval, '1h'),
          gte(historicalCandles.timestamp, this.config.startDate),
          lte(historicalCandles.timestamp, this.config.endDate)
        ))
        .orderBy(asc(historicalCandles.timestamp));
      
      const ohlcvData: OHLCV[] = candles.map(c => ({
        timestamp: c.timestamp,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
      }));
      
      this.historicalData.set(symbol, ohlcvData);
      console.log(`  ${symbol}: ${ohlcvData.length} hourly candles`);
      
      if (ohlcvData.length < 720) { // Less than 30 days
        stepGaps.push(`Insufficient data for ${symbol}: ${ohlcvData.length} candles (need 720+)`);
      }
      
      notes.push(`${symbol}: ${ohlcvData.length} candles from ${ohlcvData[0]?.timestamp.toISOString()} to ${ohlcvData[ohlcvData.length-1]?.timestamp.toISOString()}`);
    }
    
    this.workflowSteps.push({
      step: 'Data Fetching',
      timestamp: new Date(),
      input: { symbols: this.config.symbols, period: { start: this.config.startDate, end: this.config.endDate } },
      output: { candleCounts: Object.fromEntries([...this.historicalData.entries()].map(([k, v]) => [k, v.length])) },
      duration: getActiveClock().now() - stepStart,
      success: true,
      notes,
      gaps: stepGaps,
      improvements: stepImprovements,
    });
    
    this.gaps.push(...stepGaps);
  }

  // ============================================
  // STEP 2: SIMULATE AGENT SIGNALS
  // ============================================
  
  generateAgentSignals(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData[] {
    const signals: AgentSignalData[] = [];
    
    // Technical Analyst
    signals.push(this.generateTechnicalSignal(symbol, candle, history));
    
    // Pattern Matcher
    signals.push(this.generatePatternSignal(symbol, candle, history));
    
    // Order Flow Analyst
    signals.push(this.generateOrderFlowSignal(symbol, candle, history));
    
    // Sentiment Analyst
    signals.push(this.generateSentimentSignal(symbol, candle, history));
    
    // Macro Analyst
    signals.push(this.generateMacroSignal(symbol, candle, history));
    
    // Whale Tracker
    signals.push(this.generateWhaleSignal(symbol, candle, history));
    
    return signals;
  }

  private generateTechnicalSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 26) {
      return this.createNeutralSignal('TechnicalAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const closes = history.map(c => c.close);
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = history.length >= 50 ? this.calculateSMA(closes, 50) : sma20;
    
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
        reasoning += ', MACD bullish';
      } else if (signal === 'neutral') {
        signal = 'bullish';
        confidence = 0.55;
        reasoning = 'MACD bullish crossover';
      }
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      if (signal === 'bearish') {
        confidence += 0.1;
        reasoning += ', MACD bearish';
      } else if (signal === 'neutral') {
        signal = 'bearish';
        confidence = 0.55;
        reasoning = 'MACD bearish crossover';
      }
    }
    
    // Trend confirmation
    const currentPrice = candle.close;
    if (currentPrice > sma20 && sma20 > sma50) {
      if (signal === 'bullish') confidence += 0.05;
      reasoning += reasoning ? ', uptrend' : 'Price in uptrend';
    } else if (currentPrice < sma20 && sma20 < sma50) {
      if (signal === 'bearish') confidence += 0.05;
      reasoning += reasoning ? ', downtrend' : 'Price in downtrend';
    }
    
    return {
      agentName: 'TechnicalAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No clear signal',
      timestamp: candle.timestamp,
    };
  }

  private generatePatternSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 5) {
      return this.createNeutralSignal('PatternMatcher', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const recentCandles = history.slice(-5);
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
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
      reasoning = 'Bullish engulfing pattern';
    }
    
    // Bearish engulfing
    if (prev.close > prev.open && curr.close < curr.open &&
        curr.open >= prev.close && curr.close <= prev.open &&
        currBody > prevBody) {
      signal = 'bearish';
      confidence = 0.65;
      reasoning = 'Bearish engulfing pattern';
    }
    
    // Hammer pattern
    const lowerWick = curr.open > curr.close ? curr.close - curr.low : curr.open - curr.low;
    const upperWick = curr.open > curr.close ? curr.high - curr.open : curr.high - curr.close;
    const body = currBody;
    
    if (lowerWick > body * 2 && upperWick < body * 0.5) {
      signal = 'bullish';
      confidence = 0.60;
      reasoning = 'Hammer pattern';
    }
    
    // Shooting star
    if (upperWick > body * 2 && lowerWick < body * 0.5) {
      signal = 'bearish';
      confidence = 0.60;
      reasoning = 'Shooting star pattern';
    }
    
    return {
      agentName: 'PatternMatcher',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No clear pattern',
      timestamp: candle.timestamp,
    };
  }

  private generateOrderFlowSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 20) {
      return this.createNeutralSignal('OrderFlowAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const volumes = history.map(c => c.volume);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = candle.volume;
    const volumeRatio = currentVolume / avgVolume;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // High volume with price direction
    if (volumeRatio > 1.5) {
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.55 + Math.min(volumeRatio - 1.5, 1) * 0.2;
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bullish candle`;
      } else {
        signal = 'bearish';
        confidence = 0.55 + Math.min(volumeRatio - 1.5, 1) * 0.2;
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bearish candle`;
      }
    }
    
    // Volume divergence
    const recentPrices = history.slice(-5).map(c => c.close);
    const recentVolumes = history.slice(-5).map(c => c.volume);
    const priceUp = recentPrices[4] > recentPrices[0];
    const volumeUp = recentVolumes[4] > recentVolumes[0];
    
    if (priceUp && !volumeUp) {
      if (signal === 'neutral') {
        signal = 'bearish';
        confidence = 0.55;
        reasoning = 'Price up on declining volume (bearish divergence)';
      }
    } else if (!priceUp && volumeUp) {
      if (signal === 'neutral') {
        signal = 'bullish';
        confidence = 0.55;
        reasoning = 'Price down on increasing volume (potential reversal)';
      }
    }
    
    return {
      agentName: 'OrderFlowAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'Normal volume',
      timestamp: candle.timestamp,
    };
  }

  private generateSentimentSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    // Simulate sentiment based on recent price action
    if (history.length < 24) {
      return this.createNeutralSignal('SentimentAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const last24h = history.slice(-24);
    const priceChange = (last24h[23].close - last24h[0].close) / last24h[0].close * 100;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    if (priceChange > 3) {
      signal = 'bullish';
      confidence = 0.55 + Math.min(priceChange - 3, 5) * 0.05;
      reasoning = `Strong 24h gain (${priceChange.toFixed(1)}%) driving positive sentiment`;
    } else if (priceChange < -3) {
      signal = 'bearish';
      confidence = 0.55 + Math.min(Math.abs(priceChange) - 3, 5) * 0.05;
      reasoning = `Strong 24h loss (${priceChange.toFixed(1)}%) driving negative sentiment`;
    }
    
    return {
      agentName: 'SentimentAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'Neutral sentiment',
      timestamp: candle.timestamp,
    };
  }

  private generateMacroSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 168) { // 7 days of hourly data
      return this.createNeutralSignal('MacroAnalyst', symbol, candle.timestamp, 'Insufficient data');
    }
    
    const closes = history.map(c => c.close);
    const sma50 = this.calculateSMA(closes, 50);
    const sma200 = history.length >= 200 ? this.calculateSMA(closes, 200) : sma50;
    const currentPrice = candle.close;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Golden cross / Death cross
    if (sma50 > sma200 && currentPrice > sma50) {
      signal = 'bullish';
      confidence = 0.70;
      reasoning = 'Golden cross: SMA50 > SMA200, price above both';
    } else if (sma50 < sma200 && currentPrice < sma50) {
      signal = 'bearish';
      confidence = 0.70;
      reasoning = 'Death cross: SMA50 < SMA200, price below both';
    } else if (currentPrice > sma50) {
      signal = 'bullish';
      confidence = 0.55;
      reasoning = 'Price above SMA50';
    } else if (currentPrice < sma50) {
      signal = 'bearish';
      confidence = 0.55;
      reasoning = 'Price below SMA50';
    }
    
    return {
      agentName: 'MacroAnalyst',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'Neutral macro trend',
      timestamp: candle.timestamp,
    };
  }

  private generateWhaleSignal(symbol: string, candle: OHLCV, history: OHLCV[]): AgentSignalData {
    if (history.length < 10) {
      return this.createNeutralSignal('WhaleTracker', symbol, candle.timestamp, 'Insufficient data');
    }
    
    // Simulate whale activity based on volume spikes
    const volumes = history.map(c => c.volume);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const volumeSpike = candle.volume / avgVolume;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    if (volumeSpike > 3) {
      // Large volume spike = potential whale activity
      if (candle.close > candle.open) {
        signal = 'bullish';
        confidence = 0.60 + Math.min(volumeSpike - 3, 2) * 0.1;
        reasoning = `Whale accumulation detected (${volumeSpike.toFixed(1)}x volume)`;
      } else {
        signal = 'bearish';
        confidence = 0.60 + Math.min(volumeSpike - 3, 2) * 0.1;
        reasoning = `Whale distribution detected (${volumeSpike.toFixed(1)}x volume)`;
      }
    }
    
    return {
      agentName: 'WhaleTracker',
      symbol,
      signal,
      confidence: Math.min(confidence, 0.95),
      reasoning: reasoning || 'No significant whale activity',
      timestamp: candle.timestamp,
    };
  }

  private createNeutralSignal(agentName: string, symbol: string, timestamp: Date, reasoning: string): AgentSignalData {
    return {
      agentName,
      symbol,
      signal: 'neutral',
      confidence: 0.5,
      reasoning,
      timestamp,
    };
  }

  // ============================================
  // STEP 3: CONSENSUS MECHANISM
  // ============================================
  
  calculateConsensus(signals: AgentSignalData[], regime: MarketRegime): ConsensusResult {
    // Separate fast and slow agents
    const fastSignals = signals.filter(s => FAST_AGENTS.includes(s.agentName));
    const slowSignals = signals.filter(s => SLOW_AGENTS.includes(s.agentName));
    
    // Calculate fast score (weighted)
    let fastBullish = 0, fastBearish = 0, fastTotal = 0;
    for (const signal of fastSignals) {
      const weight = AGENT_WEIGHTS[signal.agentName] || 0.1;
      fastTotal += weight;
      if (signal.signal === 'bullish') {
        fastBullish += weight * signal.confidence;
      } else if (signal.signal === 'bearish') {
        fastBearish += weight * signal.confidence;
      }
    }
    
    const fastScore = fastTotal > 0 ? (fastBullish - fastBearish) / fastTotal : 0;
    
    // Calculate slow bonus
    let slowBullish = 0, slowBearish = 0, slowTotal = 0;
    for (const signal of slowSignals) {
      const weight = AGENT_WEIGHTS[signal.agentName] || 0.1;
      slowTotal += weight;
      if (signal.signal === 'bullish') {
        slowBullish += weight * signal.confidence;
      } else if (signal.signal === 'bearish') {
        slowBearish += weight * signal.confidence;
      }
    }
    
    const slowScore = slowTotal > 0 ? (slowBullish - slowBearish) / slowTotal : 0;
    const slowBonus = slowScore * 0.1; // 10% bonus from slow agents
    
    // Total confidence
    const totalConfidence = Math.abs(fastScore + slowBonus);
    
    // Determine direction
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    if (fastScore + slowBonus > 0) {
      direction = 'buy';
    } else if (fastScore + slowBonus < 0) {
      direction = 'sell';
    }
    
    // Check macro veto
    const macroSignal = signals.find(s => s.agentName === 'MacroAnalyst');
    let vetoActive = false;
    let vetoReason: string | undefined;
    
    if (this.config.enableMacroVeto && macroSignal) {
      if (direction === 'buy' && macroSignal.signal === 'bearish' && macroSignal.confidence > 0.65) {
        vetoActive = true;
        vetoReason = `MacroAnalyst veto: ${macroSignal.reasoning}`;
      } else if (direction === 'sell' && macroSignal.signal === 'bullish' && macroSignal.confidence > 0.65) {
        vetoActive = true;
        vetoReason = `MacroAnalyst veto: ${macroSignal.reasoning}`;
      }
    }
    
    // Check quality gate
    const agentCount = signals.filter(s => s.signal !== 'neutral').length;
    const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
    
    const passesQualityGate = 
      totalConfidence >= this.config.consensusThreshold &&
      avgConfidence >= this.config.confidenceThreshold &&
      agentCount >= this.config.minAgentsRequired &&
      !vetoActive;
    
    // Check for alpha signal
    const isAlphaSignal = totalConfidence >= this.config.alphaThreshold && agentCount >= 5;
    
    return {
      symbol: signals[0]?.symbol || '',
      timestamp: signals[0]?.timestamp || new Date(),
      direction: vetoActive ? 'hold' : direction,
      fastScore: Math.abs(fastScore),
      slowBonus: Math.abs(slowBonus),
      totalConfidence,
      consensusThreshold: this.config.consensusThreshold,
      agentVotes: signals,
      regime,
      isAlphaSignal,
      vetoActive,
      vetoReason,
      passesQualityGate,
    };
  }

  // ============================================
  // STEP 4: TRADE ENTRY
  // ============================================
  
  executeTrade(consensus: ConsensusResult, candle: OHLCV): BacktestTrade | null {
    if (!consensus.passesQualityGate) {
      return null;
    }
    
    if (consensus.direction === 'hold') {
      return null;
    }
    
    // Check regime strategy
    if (!this.config.regimeStrategies[consensus.regime]) {
      return null;
    }
    
    // Check if already have position in this symbol
    const existingTrade = [...this.openTrades.values()].find(t => t.symbol === consensus.symbol);
    if (existingTrade) {
      return null;
    }
    
    // Calculate position size
    let positionPercent = this.config.basePositionPercent;
    positionPercent *= (1 + (consensus.totalConfidence - this.config.consensusThreshold) * this.config.confidenceMultiplier);
    positionPercent = Math.min(positionPercent, this.config.maxPositionPercent);
    
    const positionValue = this.capital * positionPercent;
    const quantity = positionValue / candle.close;
    
    // Calculate stop loss and take profit
    const direction = consensus.direction === 'buy' ? 'long' : 'short';
    const stopLoss = direction === 'long' 
      ? candle.close * (1 - this.config.stopLossPercent)
      : candle.close * (1 + this.config.stopLossPercent);
    const takeProfit = direction === 'long'
      ? candle.close * (1 + this.config.takeProfitPercent)
      : candle.close * (1 - this.config.takeProfitPercent);
    
    const trade: BacktestTrade = {
      id: `${consensus.symbol}-${getActiveClock().now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: consensus.symbol,
      direction,
      entryPrice: candle.close,
      entryTime: candle.timestamp,
      quantity,
      positionValue,
      stopLoss,
      takeProfit,
      consensus: consensus.totalConfidence,
      confidence: consensus.agentVotes.reduce((sum, s) => sum + s.confidence, 0) / consensus.agentVotes.length,
      regime: consensus.regime,
      agentSignals: consensus.agentVotes,
      isAlphaSignal: consensus.isAlphaSignal,
      partialExits: [],
      breakevenActivated: false,
      highestPrice: candle.close,
      lowestPrice: candle.close,
    };
    
    // Apply entry fee
    this.capital -= positionValue * (this.config.feePercent / 100);
    
    this.openTrades.set(trade.id, trade);
    return trade;
  }

  // ============================================
  // STEP 5: TRADE MANAGEMENT
  // ============================================
  
  manageTrades(candle: OHLCV, symbol: string): void {
    for (const [tradeId, trade] of this.openTrades) {
      // Skip if not the right symbol
      if (trade.symbol !== symbol) {
        continue;
      }
      
      // Update high/low tracking
      if (trade.direction === 'long') {
        trade.highestPrice = Math.max(trade.highestPrice, candle.high);
        trade.lowestPrice = Math.min(trade.lowestPrice, candle.low);
      } else {
        trade.highestPrice = Math.max(trade.highestPrice, candle.high);
        trade.lowestPrice = Math.min(trade.lowestPrice, candle.low);
      }
      
      // Calculate current P&L
      const currentPnlPercent = trade.direction === 'long'
        ? (candle.close - trade.entryPrice) / trade.entryPrice * 100
        : (trade.entryPrice - candle.close) / trade.entryPrice * 100;
      
      // Check breakeven activation
      if (!trade.breakevenActivated && currentPnlPercent >= this.config.breakevenActivationPercent) {
        trade.breakevenActivated = true;
        trade.stopLoss = trade.entryPrice * (1 + this.config.breakevenBuffer / 100);
      }
      
      // Check partial profit taking
      for (const level of this.config.partialProfitLevels) {
        if (currentPnlPercent >= level.pnlPercent) {
          const alreadyExited = trade.partialExits.some(e => e.pnlPercent === level.pnlPercent);
          if (!alreadyExited && trade.quantity > 0) {
            const exitQuantity = trade.quantity * (level.exitPercent / 100);
            const exitValue = exitQuantity * candle.close;
            const exitPnl = trade.direction === 'long'
              ? exitValue - (exitQuantity * trade.entryPrice)
              : (exitQuantity * trade.entryPrice) - exitValue;
            
            trade.partialExits.push({
              price: candle.close,
              quantity: exitQuantity,
              pnlPercent: level.pnlPercent,
              reason: `Partial profit at ${level.pnlPercent}%`,
            });
            
            trade.quantity -= exitQuantity;
            this.capital += exitValue - (exitValue * this.config.feePercent / 100);
          }
        }
      }
    }
  }

  // ============================================
  // STEP 6: TRADE EXIT
  // ============================================
  
  checkExits(candle: OHLCV): void {
    for (const [tradeId, trade] of this.openTrades) {
      let shouldExit = false;
      let exitReason = '';
      let exitPrice = candle.close;
      
      const currentPnlPercent = trade.direction === 'long'
        ? (candle.close - trade.entryPrice) / trade.entryPrice * 100
        : (trade.entryPrice - candle.close) / trade.entryPrice * 100;
      
      // Check stop loss
      if (trade.direction === 'long' && candle.low <= trade.stopLoss) {
        shouldExit = true;
        exitReason = trade.breakevenActivated ? 'breakeven_stop' : 'stop_loss';
        exitPrice = trade.stopLoss;
      } else if (trade.direction === 'short' && candle.high >= trade.stopLoss) {
        shouldExit = true;
        exitReason = trade.breakevenActivated ? 'breakeven_stop' : 'stop_loss';
        exitPrice = trade.stopLoss;
      }
      
      // Check take profit
      if (trade.direction === 'long' && candle.high >= trade.takeProfit) {
        shouldExit = true;
        exitReason = 'take_profit';
        exitPrice = trade.takeProfit;
      } else if (trade.direction === 'short' && candle.low <= trade.takeProfit) {
        shouldExit = true;
        exitReason = 'take_profit';
        exitPrice = trade.takeProfit;
      }
      
      // Check max hold time
      const holdTimeMs = candle.timestamp.getTime() - trade.entryTime.getTime();
      if (holdTimeMs >= this.config.maxHoldTimeMinutes * 60 * 1000) {
        shouldExit = true;
        exitReason = 'max_hold_time';
      }
      
      // Check trailing stop
      if (currentPnlPercent >= this.config.trailingActivationPercent) {
        const trailingStop = trade.direction === 'long'
          ? trade.highestPrice * (1 - this.config.trailingPercent / 100)
          : trade.lowestPrice * (1 + this.config.trailingPercent / 100);
        
        if (trade.direction === 'long' && candle.close <= trailingStop) {
          shouldExit = true;
          exitReason = 'trailing_stop';
          exitPrice = trailingStop;
        } else if (trade.direction === 'short' && candle.close >= trailingStop) {
          shouldExit = true;
          exitReason = 'trailing_stop';
          exitPrice = trailingStop;
        }
      }
      
      if (shouldExit) {
        this.closeTrade(trade, exitPrice, candle.timestamp, exitReason);
      }
    }
  }

  private closeTrade(trade: BacktestTrade, exitPrice: number, exitTime: Date, exitReason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;
    trade.holdTimeMs = exitTime.getTime() - trade.entryTime.getTime();
    
    // Calculate final P&L
    const exitValue = trade.quantity * exitPrice;
    const entryValue = trade.quantity * trade.entryPrice;
    
    if (trade.direction === 'long') {
      trade.pnl = exitValue - entryValue;
    } else {
      trade.pnl = entryValue - exitValue;
    }
    
    // Add partial exit P&L
    for (const partial of trade.partialExits) {
      const partialPnl = trade.direction === 'long'
        ? partial.quantity * (partial.price - trade.entryPrice)
        : partial.quantity * (trade.entryPrice - partial.price);
      trade.pnl += partialPnl;
    }
    
    // Apply exit fee
    trade.pnl -= exitValue * (this.config.feePercent / 100);
    trade.pnlPercent = (trade.pnl / trade.positionValue) * 100;
    
    // Update capital
    this.capital += exitValue - (exitValue * this.config.feePercent / 100);
    
    // Analyze trade
    this.analyzeTrade(trade);
    
    // Move to closed trades
    this.trades.push(trade);
    this.openTrades.delete(trade.id);
  }

  private analyzeTrade(trade: BacktestTrade): void {
    trade.winningFactors = [];
    trade.losingFactors = [];
    
    const isWin = (trade.pnl || 0) > 0;
    
    // Analyze factors
    if (trade.isAlphaSignal) {
      if (isWin) trade.winningFactors.push('alpha_signal');
      else trade.losingFactors.push('alpha_signal_failed');
    }
    
    if (trade.breakevenActivated) {
      if (isWin) trade.winningFactors.push('breakeven_protected');
      else trade.losingFactors.push('breakeven_not_enough');
    }
    
    if (trade.regime === 'trending_up' || trade.regime === 'trending_down') {
      if (isWin) trade.winningFactors.push('trending_market');
      else trade.losingFactors.push('trend_reversal');
    }
    
    if (trade.consensus >= 0.80) {
      if (isWin) trade.winningFactors.push('high_consensus');
      else trade.losingFactors.push('high_consensus_wrong');
    }
    
    // Check if macro aligned
    const macroSignal = trade.agentSignals.find(s => s.agentName === 'MacroAnalyst');
    if (macroSignal) {
      const aligned = (trade.direction === 'long' && macroSignal.signal === 'bullish') ||
                     (trade.direction === 'short' && macroSignal.signal === 'bearish');
      if (aligned) {
        if (isWin) trade.winningFactors.push('macro_aligned');
        else trade.losingFactors.push('macro_aligned_wrong');
      } else {
        if (isWin) trade.winningFactors.push('counter_macro_success');
        else trade.losingFactors.push('counter_macro_failed');
      }
    }
    
    // Exit reason analysis
    if (trade.exitReason === 'take_profit') {
      trade.winningFactors.push('reached_target');
    } else if (trade.exitReason === 'stop_loss') {
      trade.losingFactors.push('hit_stop_loss');
    } else if (trade.exitReason === 'trailing_stop') {
      if (isWin) trade.winningFactors.push('trailing_protected_profit');
      else trade.losingFactors.push('trailing_triggered_loss');
    }
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  
  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
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
    
    // Signal line (9-period EMA of MACD)
    const macdValues = closes.slice(-9).map((_, i) => {
      const slice = closes.slice(0, closes.length - 9 + i + 1);
      return this.calculateEMA(slice, 12) - this.calculateEMA(slice, 26);
    });
    const signal = this.calculateEMA(macdValues, 9);
    
    return { macd, signal, histogram: macd - signal };
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

  private detectRegime(history: OHLCV[]): MarketRegime {
    if (history.length < 50) return 'ranging';
    
    const closes = history.map(c => c.close);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = closes[closes.length - 1];
    
    // Calculate volatility
    const returns = [];
    for (let i = 1; i < Math.min(20, closes.length); i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    const volatility = Math.sqrt(returns.map(r => r * r).reduce((a, b) => a + b, 0) / returns.length) * 100;
    
    // Calculate trend strength
    const priceChange = (currentPrice - closes[closes.length - 20]) / closes[closes.length - 20] * 100;
    
    if (volatility > 3) {
      return 'volatile';
    } else if (Math.abs(priceChange) < 1 && volatility < 1) {
      return 'choppy';
    } else if (priceChange > 2 && currentPrice > sma20 && sma20 > sma50) {
      return 'trending_up';
    } else if (priceChange < -2 && currentPrice < sma20 && sma20 < sma50) {
      return 'trending_down';
    } else {
      return 'ranging';
    }
  }

  // ============================================
  // MAIN BACKTEST EXECUTION
  // ============================================
  
  async run(): Promise<BacktestResult> {
    console.log('\n========================================');
    console.log('SEER PLATFORM 1-MONTH COMPREHENSIVE BACKTEST');
    console.log('========================================\n');
    console.log(`Period: ${this.config.startDate.toISOString()} to ${this.config.endDate.toISOString()}`);
    console.log(`Initial Capital: $${this.config.initialCapital.toLocaleString()}`);
    console.log(`Consensus Threshold: ${(this.config.consensusThreshold * 100).toFixed(0)}%`);
    console.log(`Confidence Threshold: ${(this.config.confidenceThreshold * 100).toFixed(0)}%`);
    console.log(`Min Agents Required: ${this.config.minAgentsRequired}`);
    console.log(`Macro Veto: ${this.config.enableMacroVeto ? 'ENABLED' : 'DISABLED'}`);
    console.log('');
    
    // Step 1: Fetch historical data
    await this.fetchHistoricalData();
    
    // Step 2-6: Process each candle
    console.log('\n========================================');
    console.log('PROCESSING CANDLES');
    console.log('========================================\n');
    
    let totalCandles = 0;
    let signalsGenerated = 0;
    let consensusCalculated = 0;
    let tradesEntered = 0;
    
    for (const [symbol, candles] of this.historicalData) {
      console.log(`\nProcessing ${symbol}...`);
      
      for (let i = 50; i < candles.length; i++) {
        const candle = candles[i];
        const history = candles.slice(0, i + 1);
        
        totalCandles++;
        
        // Step 2: Generate agent signals
        const signals = this.generateAgentSignals(symbol, candle, history);
        signalsGenerated += signals.length;
        
        // Step 3: Calculate consensus
        const regime = this.detectRegime(history);
        const consensus = this.calculateConsensus(signals, regime);
        consensusCalculated++;
        
        // Step 4: Execute trade if quality gate passes
        if (consensus.passesQualityGate) {
          const trade = this.executeTrade(consensus, candle);
          if (trade) {
            tradesEntered++;
            console.log(`  [${candle.timestamp.toISOString()}] TRADE: ${trade.direction.toUpperCase()} ${symbol} @ $${trade.entryPrice.toFixed(2)} (Consensus: ${(consensus.totalConfidence * 100).toFixed(1)}%)`);
          }
        }
        
        // Step 5: Manage open trades
        this.manageTrades(candle, symbol);
        
        // Step 6: Check exits
        this.checkExits(candle);
        
        // Update equity curve
        const openPnl = [...this.openTrades.values()].reduce((sum, t) => {
          const currentPnl = t.direction === 'long'
            ? (candle.close - t.entryPrice) * t.quantity
            : (t.entryPrice - candle.close) * t.quantity;
          return sum + currentPnl;
        }, 0);
        
        this.equityCurve.push({
          timestamp: candle.timestamp,
          equity: this.capital + openPnl,
        });
      }
    }
    
    // Close any remaining open trades at last price
    for (const [symbol, candles] of this.historicalData) {
      const lastCandle = candles[candles.length - 1];
      for (const [tradeId, trade] of this.openTrades) {
        if (trade.symbol === symbol) {
          this.closeTrade(trade, lastCandle.close, lastCandle.timestamp, 'backtest_end');
        }
      }
    }
    
    // Generate results
    return this.generateResults();
  }

  private generateResults(): BacktestResult {
    const winningTrades = this.trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = this.trades.filter(t => (t.pnl || 0) <= 0);
    
    const totalPnl = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalPnlPercent = (totalPnl / this.config.initialCapital) * 100;
    
    const winRate = this.trades.length > 0 ? winningTrades.length / this.trades.length : 0;
    
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
      : 0;
    
    const profitFactor = avgLoss > 0 ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length) : 0;
    
    // Calculate max drawdown
    let peak = this.config.initialCapital;
    let maxDrawdown = 0;
    for (const point of this.equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Calculate Sharpe ratio (simplified)
    const returns = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      returns.push((this.equityCurve[i].equity - this.equityCurve[i-1].equity) / this.equityCurve[i-1].equity);
    }
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 0
      ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / returns.length)
      : 0;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252 * 24) : 0; // Annualized for hourly data
    
    // Determine grade
    let grade: 'A++' | 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    if (winRate >= 0.65 && profitFactor >= 2.0 && sharpeRatio >= 1.5 && maxDrawdown <= 0.10) {
      grade = 'A++';
    } else if (winRate >= 0.60 && profitFactor >= 1.5 && sharpeRatio >= 1.0 && maxDrawdown <= 0.15) {
      grade = 'A+';
    } else if (winRate >= 0.55 && profitFactor >= 1.2 && sharpeRatio >= 0.5 && maxDrawdown <= 0.20) {
      grade = 'A';
    } else if (winRate >= 0.50 && profitFactor >= 1.0 && maxDrawdown <= 0.25) {
      grade = 'B';
    } else if (winRate >= 0.45 && profitFactor >= 0.8) {
      grade = 'C';
    } else if (winRate >= 0.40) {
      grade = 'D';
    } else {
      grade = 'F';
    }
    
    // Analyze by regime
    const tradesByRegime: Record<MarketRegime, { trades: number; winRate: number; pnl: number }> = {
      trending_up: { trades: 0, winRate: 0, pnl: 0 },
      trending_down: { trades: 0, winRate: 0, pnl: 0 },
      ranging: { trades: 0, winRate: 0, pnl: 0 },
      volatile: { trades: 0, winRate: 0, pnl: 0 },
      choppy: { trades: 0, winRate: 0, pnl: 0 },
    };
    
    for (const trade of this.trades) {
      const regime = trade.regime;
      tradesByRegime[regime].trades++;
      tradesByRegime[regime].pnl += trade.pnl || 0;
      if ((trade.pnl || 0) > 0) {
        tradesByRegime[regime].winRate++;
      }
    }
    
    for (const regime of Object.keys(tradesByRegime) as MarketRegime[]) {
      if (tradesByRegime[regime].trades > 0) {
        tradesByRegime[regime].winRate /= tradesByRegime[regime].trades;
      }
    }
    
    // Analyze by agent
    const tradesByAgent: Record<string, { trades: number; winRate: number; pnl: number; accuracy: number }> = {};
    
    for (const trade of this.trades) {
      for (const signal of trade.agentSignals) {
        if (!tradesByAgent[signal.agentName]) {
          tradesByAgent[signal.agentName] = { trades: 0, winRate: 0, pnl: 0, accuracy: 0 };
        }
        tradesByAgent[signal.agentName].trades++;
        tradesByAgent[signal.agentName].pnl += trade.pnl || 0;
        
        // Check if agent was correct
        const agentCorrect = (trade.direction === 'long' && signal.signal === 'bullish' && (trade.pnl || 0) > 0) ||
                           (trade.direction === 'short' && signal.signal === 'bearish' && (trade.pnl || 0) > 0) ||
                           (signal.signal === 'neutral');
        if (agentCorrect) {
          tradesByAgent[signal.agentName].accuracy++;
        }
        if ((trade.pnl || 0) > 0) {
          tradesByAgent[signal.agentName].winRate++;
        }
      }
    }
    
    for (const agent of Object.keys(tradesByAgent)) {
      if (tradesByAgent[agent].trades > 0) {
        tradesByAgent[agent].winRate /= tradesByAgent[agent].trades;
        tradesByAgent[agent].accuracy /= tradesByAgent[agent].trades;
      }
    }
    
    // Analyze by hour
    const tradesByHour: Record<number, { trades: number; winRate: number; pnl: number }> = {};
    for (let h = 0; h < 24; h++) {
      tradesByHour[h] = { trades: 0, winRate: 0, pnl: 0 };
    }
    
    for (const trade of this.trades) {
      const hour = trade.entryTime.getUTCHours();
      tradesByHour[hour].trades++;
      tradesByHour[hour].pnl += trade.pnl || 0;
      if ((trade.pnl || 0) > 0) {
        tradesByHour[hour].winRate++;
      }
    }
    
    for (const hour of Object.keys(tradesByHour)) {
      if (tradesByHour[Number(hour)].trades > 0) {
        tradesByHour[Number(hour)].winRate /= tradesByHour[Number(hour)].trades;
      }
    }
    
    // Collect winning/losing factors
    const winningTradeFactors: Record<string, number> = {};
    const losingTradeFactors: Record<string, number> = {};
    
    for (const trade of this.trades) {
      for (const factor of trade.winningFactors || []) {
        winningTradeFactors[factor] = (winningTradeFactors[factor] || 0) + 1;
      }
      for (const factor of trade.losingFactors || []) {
        losingTradeFactors[factor] = (losingTradeFactors[factor] || 0) + 1;
      }
    }
    
    // Identify gaps and improvements
    this.identifyGapsAndImprovements(winRate, profitFactor, sharpeRatio, maxDrawdown, tradesByAgent);
    
    return {
      config: this.config,
      period: { start: this.config.startDate, end: this.config.endDate },
      initialCapital: this.config.initialCapital,
      finalCapital: this.capital,
      totalPnl,
      totalPnlPercent,
      
      grade,
      winRate,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgWin,
      avgLoss,
      avgHoldTime: this.trades.length > 0
        ? this.trades.reduce((sum, t) => sum + (t.holdTimeMs || 0), 0) / this.trades.length / 1000 / 60
        : 0,
      
      workflowSteps: this.workflowSteps,
      
      tradesByRegime,
      tradesByAgent,
      tradesByHour,
      
      winningTradeFactors,
      losingTradeFactors,
      
      trades: this.trades,
      equityCurve: this.equityCurve,
      
      gaps: this.gaps,
      improvements: this.improvements,
    };
  }

  private identifyGapsAndImprovements(
    winRate: number,
    profitFactor: number,
    sharpeRatio: number,
    maxDrawdown: number,
    tradesByAgent: Record<string, { trades: number; winRate: number; pnl: number; accuracy: number }>
  ): void {
    // A++ Grade Requirements
    const A_PLUS_PLUS_WIN_RATE = 0.65;
    const A_PLUS_PLUS_PROFIT_FACTOR = 2.0;
    const A_PLUS_PLUS_SHARPE = 1.5;
    const A_PLUS_PLUS_MAX_DD = 0.10;
    
    // Win Rate Gap
    if (winRate < A_PLUS_PLUS_WIN_RATE) {
      this.gaps.push(`Win rate ${(winRate * 100).toFixed(1)}% below A++ target of ${A_PLUS_PLUS_WIN_RATE * 100}%`);
      this.improvements.push('Increase consensus threshold to filter low-quality signals');
      this.improvements.push('Implement stronger trend confirmation before entry');
    }
    
    // Profit Factor Gap
    if (profitFactor < A_PLUS_PLUS_PROFIT_FACTOR) {
      this.gaps.push(`Profit factor ${profitFactor.toFixed(2)} below A++ target of ${A_PLUS_PLUS_PROFIT_FACTOR}`);
      this.improvements.push('Implement dynamic take-profit based on volatility');
      this.improvements.push('Use ATR-based stop loss instead of fixed percentage');
    }
    
    // Sharpe Ratio Gap
    if (sharpeRatio < A_PLUS_PLUS_SHARPE) {
      this.gaps.push(`Sharpe ratio ${sharpeRatio.toFixed(2)} below A++ target of ${A_PLUS_PLUS_SHARPE}`);
      this.improvements.push('Reduce position sizing in volatile regimes');
      this.improvements.push('Implement regime-specific strategy selection');
    }
    
    // Max Drawdown Gap
    if (maxDrawdown > A_PLUS_PLUS_MAX_DD) {
      this.gaps.push(`Max drawdown ${(maxDrawdown * 100).toFixed(1)}% exceeds A++ limit of ${A_PLUS_PLUS_MAX_DD * 100}%`);
      this.improvements.push('Implement portfolio-level circuit breaker');
      this.improvements.push('Add correlation-based position sizing');
    }
    
    // Agent Performance Analysis
    for (const [agent, stats] of Object.entries(tradesByAgent)) {
      if (stats.accuracy < 0.5) {
        this.gaps.push(`${agent} accuracy ${(stats.accuracy * 100).toFixed(1)}% below 50%`);
        this.improvements.push(`Retrain or recalibrate ${agent} signals`);
      }
    }
    
    // Methodology Gaps
    this.gaps.push('No real-time whale alert integration in backtest');
    this.gaps.push('Sentiment analysis simulated from price action, not real social data');
    this.gaps.push('No on-chain data integration (exchange flows, stablecoin supply)');
    
    this.improvements.push('Integrate real Whale Alert API data for backtest');
    this.improvements.push('Add Fear & Greed Index historical data');
    this.improvements.push('Implement interteam memory sharing between agents');
    this.improvements.push('Add reinforcement learning for parameter optimization');
  }
}

// ============================================
// RUN BACKTEST
// ============================================

export async function runOneMonthBacktest(config?: Partial<BacktestConfig>): Promise<BacktestResult> {
  const backtest = new OneMonthComprehensiveBacktest(config);
  return await backtest.run();
}
