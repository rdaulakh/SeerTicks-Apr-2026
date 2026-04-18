/**
 * Institutional Grade Backtest Engine
 * 
 * Simulates trading workflow with proper agent classification:
 * - ACTIVE: Fully replayable agents (OHLCV-only)
 * - PROXY: API-dependent agents with fallback logic
 * - SHADOW: Live-only agents (log only, no consensus influence)
 * 
 * Trading Workflow (matches live):
 * 1. Agent signal generation
 * 2. Consensus aggregation (respect agent modes)
 * 3. Trade pick selection
 * 4. Risk & position sizing
 * 5. Order execution simulation
 * 6. Position maintenance
 * 7. Exit logic
 * 8. Wallet update
 */

import { getDb } from '../db';
import { historicalCandles } from '../../drizzle/schema';
import { eq, and, gte, lte, asc } from 'drizzle-orm';

// Agent classification types
export type AgentMode = 'ACTIVE' | 'PROXY' | 'SHADOW';

export interface AgentClassification {
  name: string;
  mode: AgentMode;
  maxWeight: number; // Max consensus weight (1.0 for ACTIVE, capped for PROXY, 0 for SHADOW)
  proxyLogic?: 'volume' | 'momentum' | 'volatility' | 'correlation';
}

// Agent classifications based on analysis
export const AGENT_CLASSIFICATIONS: AgentClassification[] = [
  // Fully Replayable (ACTIVE)
  { name: 'TechnicalAnalyst', mode: 'ACTIVE', maxWeight: 1.0 },
  { name: 'PatternMatcher', mode: 'ACTIVE', maxWeight: 1.0 },
  { name: 'VolumeProfileAnalyzer', mode: 'ACTIVE', maxWeight: 1.0 },
  
  // API-Dependent (PROXY)
  { name: 'OrderFlowAnalyst', mode: 'PROXY', maxWeight: 0.15, proxyLogic: 'volume' },
  { name: 'WhaleTracker', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'volume' },
  // WhaleAlertAgent removed (Phase 14E) — WhaleTracker covers whale analysis
  { name: 'FundingRateAnalyst', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'momentum' },
  { name: 'LiquidationHeatmap', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'volatility' },
  { name: 'OnChainFlowAnalyst', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'volume' },
  { name: 'OnChainAnalyst', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'volume' },
  { name: 'ForexCorrelationAgent', mode: 'PROXY', maxWeight: 0.10, proxyLogic: 'correlation' },
  
  // Live-Only (SHADOW)
  { name: 'NewsSentinel', mode: 'SHADOW', maxWeight: 0 },
  { name: 'SentimentAnalyst', mode: 'SHADOW', maxWeight: 0 },
  { name: 'MacroAnalyst', mode: 'SHADOW', maxWeight: 0 },
];

// Candle data structure
export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Signal structure
export interface BacktestSignal {
  agentName: string;
  mode: AgentMode;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  executionScore: number;
  reasoning: string;
  timestamp: Date;
}

// Trade structure
export interface BacktestTrade {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  entryTime: Date;
  exitPrice?: number;
  exitTime?: Date;
  quantity: number;
  positionSize: number; // USD value
  stopLoss: number;
  takeProfit: number;
  pnl?: number;
  pnlPercent?: number;
  exitReason?: 'stop_loss' | 'take_profit' | 'time_exit' | 'opposite_signal' | 'trailing_stop';
  agentSignals: BacktestSignal[];
  consensusScore: number;
}

// Backtest configuration
export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  maxPositionSize: number; // Percentage of capital
  consensusThreshold: number; // Minimum consensus to enter
  minAgentAgreement: number; // Minimum agents agreeing
  stopLossPercent: number;
  takeProfitPercent: number;
  maxHoldPeriod: number; // Candles
  useTrailingStop: boolean;
  trailingStopPercent: number;
}

// Backtest results
export interface BacktestResults {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  agentPerformance: AgentPerformance[];
  monthlyPnL: MonthlyPnL[];
  drawdowns: DrawdownPeriod[];
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalPnLPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageHoldTime: number; // Candles
  finalEquity: number;
}

export interface EquityPoint {
  timestamp: Date;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
}

export interface AgentPerformance {
  agentName: string;
  mode: AgentMode;
  totalSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  neutralSignals: number;
  signalsAlignedWithWins: number;
  signalsAlignedWithLosses: number;
  alignmentRate: number;
  averageConfidence: number;
  recommendation: 'keep_active' | 'add_proxy' | 'live_validation_only' | 'needs_improvement';
}

export interface MonthlyPnL {
  month: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  winRate: number;
}

export interface DrawdownPeriod {
  startDate: Date;
  endDate: Date;
  drawdown: number;
  drawdownPercent: number;
  recoveryCandles: number;
}

/**
 * Institutional Backtest Engine
 */
export class InstitutionalBacktestEngine {
  private config: BacktestConfig;
  private candles: Candle[] = [];
  private trades: BacktestTrade[] = [];
  private equityCurve: EquityPoint[] = [];
  private currentEquity: number;
  private peakEquity: number;
  private currentPosition: BacktestTrade | null = null;
  private tradeIdCounter: number = 0;
  private agentSignalLog: Map<string, BacktestSignal[]> = new Map();
  
  // Technical indicator caches
  private rsiCache: Map<number, number> = new Map();
  private macdCache: Map<number, { value: number; signal: number; histogram: number }> = new Map();
  private smaCache: Map<string, number> = new Map();
  private atrCache: Map<number, number> = new Map();
  
  constructor(config: BacktestConfig) {
    this.config = config;
    this.currentEquity = config.initialCapital;
    this.peakEquity = config.initialCapital;
  }
  
  /**
   * Load historical candles from database
   */
  async loadCandles(): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const rows = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          eq(historicalCandles.symbol, this.config.symbol),
          eq(historicalCandles.interval, '1h'),
          gte(historicalCandles.timestamp, this.config.startDate),
          lte(historicalCandles.timestamp, this.config.endDate)
        )
      )
      .orderBy(asc(historicalCandles.timestamp));
    
    this.candles = rows.map(row => ({
      timestamp: row.timestamp,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
    }));
    
    console.log(`[Backtest] Loaded ${this.candles.length} candles for ${this.config.symbol}`);
  }
  
  /**
   * Run the backtest simulation
   */
  async run(): Promise<BacktestResults> {
    console.log(`[Backtest] Starting backtest for ${this.config.symbol}`);
    console.log(`[Backtest] Period: ${this.config.startDate.toISOString()} to ${this.config.endDate.toISOString()}`);
    
    // Load candles
    await this.loadCandles();
    
    if (this.candles.length < 200) {
      throw new Error(`Insufficient data: ${this.candles.length} candles (need at least 200)`);
    }
    
    // Initialize agent signal logs
    for (const agent of AGENT_CLASSIFICATIONS) {
      this.agentSignalLog.set(agent.name, []);
    }
    
    // Process each candle sequentially (no lookahead)
    for (let i = 200; i < this.candles.length; i++) {
      const currentCandle = this.candles[i];
      const historicalCandles = this.candles.slice(0, i + 1);
      
      // 1. Generate agent signals
      const signals = this.generateAgentSignals(historicalCandles, i);
      
      // 2. Aggregate consensus (respect agent modes)
      const consensus = this.aggregateConsensus(signals);
      
      // 3. Check position management
      if (this.currentPosition) {
        this.managePosition(currentCandle, i, consensus);
      }
      
      // 4. Check for new trade entry
      if (!this.currentPosition && consensus.shouldEnter) {
        this.enterTrade(currentCandle, consensus, signals);
      }
      
      // 5. Update equity curve
      this.updateEquityCurve(currentCandle);
    }
    
    // Close any remaining position at end
    if (this.currentPosition) {
      const lastCandle = this.candles[this.candles.length - 1];
      this.exitTrade(lastCandle, 'time_exit');
    }
    
    // Generate results
    return this.generateResults();
  }
  
  /**
   * Generate signals from all agents based on historical data
   */
  private generateAgentSignals(candles: Candle[], currentIndex: number): BacktestSignal[] {
    const signals: BacktestSignal[] = [];
    const currentCandle = candles[currentIndex];
    
    for (const agent of AGENT_CLASSIFICATIONS) {
      let signal: BacktestSignal;
      
      switch (agent.mode) {
        case 'ACTIVE':
          signal = this.generateActiveAgentSignal(agent, candles, currentIndex);
          break;
        case 'PROXY':
          signal = this.generateProxyAgentSignal(agent, candles, currentIndex);
          break;
        case 'SHADOW':
          signal = this.generateShadowAgentSignal(agent, candles, currentIndex);
          break;
      }
      
      signals.push(signal);
      
      // Log signal
      const log = this.agentSignalLog.get(agent.name) || [];
      log.push(signal);
      this.agentSignalLog.set(agent.name, log);
    }
    
    return signals;
  }
  
  /**
   * Generate signal for ACTIVE agents (full technical analysis)
   */
  private generateActiveAgentSignal(agent: AgentClassification, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    
    switch (agent.name) {
      case 'TechnicalAnalyst':
        return this.technicalAnalystSignal(candles, index);
      case 'PatternMatcher':
        return this.patternMatcherSignal(candles, index);
      case 'VolumeProfileAnalyzer':
        return this.volumeProfileSignal(candles, index);
      default:
        return this.createNeutralSignal(agent.name, 'ACTIVE', currentCandle.timestamp);
    }
  }
  
  /**
   * Generate signal for PROXY agents (using fallback logic)
   */
  private generateProxyAgentSignal(agent: AgentClassification, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    
    switch (agent.proxyLogic) {
      case 'volume':
        return this.volumeProxySignal(agent.name, candles, index);
      case 'momentum':
        return this.momentumProxySignal(agent.name, candles, index);
      case 'volatility':
        return this.volatilityProxySignal(agent.name, candles, index);
      case 'correlation':
        return this.correlationProxySignal(agent.name, candles, index);
      default:
        return this.createNeutralSignal(agent.name, 'PROXY', currentCandle.timestamp);
    }
  }
  
  /**
   * Generate signal for SHADOW agents (log only)
   */
  private generateShadowAgentSignal(agent: AgentClassification, candles: Candle[], index: number): BacktestSignal {
    // Shadow agents always return neutral with 0 confidence
    // They are logged for correlation analysis but don't influence consensus
    return this.createNeutralSignal(agent.name, 'SHADOW', candles[index].timestamp);
  }
  
  /**
   * Technical Analyst signal generation (OHLCV-based)
   */
  private technicalAnalystSignal(candles: Candle[], index: number): BacktestSignal {
    const closes = candles.slice(0, index + 1).map(c => c.close);
    const currentCandle = candles[index];
    
    // Calculate indicators
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const sma200 = this.calculateSMA(closes, 200);
    const atr = this.calculateATR(candles.slice(0, index + 1), 14);
    
    // Signal logic
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let strength = 0;
    let reasoning = '';
    
    // RSI signals
    if (rsi < 30) {
      signal = 'bullish';
      confidence += 0.3;
      reasoning += 'RSI oversold. ';
    } else if (rsi > 70) {
      signal = 'bearish';
      confidence += 0.3;
      reasoning += 'RSI overbought. ';
    }
    
    // MACD signals
    if (macd.histogram > 0 && macd.value > macd.signal) {
      if (signal !== 'bearish') {
        signal = 'bullish';
        confidence += 0.25;
        reasoning += 'MACD bullish crossover. ';
      }
    } else if (macd.histogram < 0 && macd.value < macd.signal) {
      if (signal !== 'bullish') {
        signal = 'bearish';
        confidence += 0.25;
        reasoning += 'MACD bearish crossover. ';
      }
    }
    
    // Trend signals (SMA alignment)
    const price = currentCandle.close;
    if (price > sma20 && sma20 > sma50 && sma50 > sma200) {
      if (signal !== 'bearish') {
        signal = 'bullish';
        confidence += 0.25;
        reasoning += 'Strong uptrend (price > SMA20 > SMA50 > SMA200). ';
      }
    } else if (price < sma20 && sma20 < sma50 && sma50 < sma200) {
      if (signal !== 'bullish') {
        signal = 'bearish';
        confidence += 0.25;
        reasoning += 'Strong downtrend (price < SMA20 < SMA50 < SMA200). ';
      }
    }
    
    // Calculate strength based on ATR
    const volatility = atr / price;
    strength = Math.min(volatility * 10, 1.0);
    
    // Normalize confidence
    confidence = Math.min(confidence, 0.95);
    
    // Execution score based on proximity to key levels
    const executionScore = this.calculateExecutionScore(price, sma20, sma50, rsi);
    
    return {
      agentName: 'TechnicalAnalyst',
      mode: 'ACTIVE',
      signal,
      confidence,
      strength,
      executionScore,
      reasoning: reasoning || 'No clear signal',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Pattern Matcher signal generation
   */
  private patternMatcherSignal(candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const recentCandles = candles.slice(Math.max(0, index - 20), index + 1);
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // Detect basic patterns
    const pattern = this.detectPattern(recentCandles);
    
    if (pattern.type === 'double_bottom') {
      signal = 'bullish';
      confidence = pattern.confidence;
      reasoning = 'Double bottom pattern detected';
    } else if (pattern.type === 'double_top') {
      signal = 'bearish';
      confidence = pattern.confidence;
      reasoning = 'Double top pattern detected';
    } else if (pattern.type === 'higher_highs') {
      signal = 'bullish';
      confidence = pattern.confidence * 0.8;
      reasoning = 'Higher highs pattern';
    } else if (pattern.type === 'lower_lows') {
      signal = 'bearish';
      confidence = pattern.confidence * 0.8;
      reasoning = 'Lower lows pattern';
    }
    
    return {
      agentName: 'PatternMatcher',
      mode: 'ACTIVE',
      signal,
      confidence,
      strength: confidence * 0.8,
      executionScore: confidence * 100,
      reasoning: reasoning || 'No pattern detected',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Volume Profile signal generation
   */
  private volumeProfileSignal(candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const recentCandles = candles.slice(Math.max(0, index - 50), index + 1);
    
    // Calculate VWAP
    const vwap = this.calculateVWAP(recentCandles);
    const price = currentCandle.close;
    
    // Calculate standard deviation
    const priceDeviation = (price - vwap) / vwap;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // VWAP deviation signals
    if (priceDeviation < -0.02) {
      signal = 'bullish';
      confidence = Math.min(Math.abs(priceDeviation) * 10, 0.8);
      reasoning = `Price ${(priceDeviation * 100).toFixed(1)}% below VWAP - potential bounce`;
    } else if (priceDeviation > 0.02) {
      signal = 'bearish';
      confidence = Math.min(Math.abs(priceDeviation) * 10, 0.8);
      reasoning = `Price ${(priceDeviation * 100).toFixed(1)}% above VWAP - potential pullback`;
    }
    
    return {
      agentName: 'VolumeProfileAnalyzer',
      mode: 'ACTIVE',
      signal,
      confidence,
      strength: confidence * 0.7,
      executionScore: confidence * 100,
      reasoning: reasoning || 'Price near VWAP',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Volume-based proxy signal (for WhaleTracker, OrderFlow, OnChain)
   */
  private volumeProxySignal(agentName: string, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const recentVolumes = candles.slice(Math.max(0, index - 20), index).map(c => c.volume);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    
    const volumeRatio = currentCandle.volume / avgVolume;
    const priceChange = (currentCandle.close - currentCandle.open) / currentCandle.open;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // High volume with price direction
    if (volumeRatio > 2.0) {
      if (priceChange > 0.005) {
        signal = 'bullish';
        confidence = Math.min(volumeRatio * 0.2, 0.6);
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bullish price action`;
      } else if (priceChange < -0.005) {
        signal = 'bearish';
        confidence = Math.min(volumeRatio * 0.2, 0.6);
        reasoning = `High volume (${volumeRatio.toFixed(1)}x avg) with bearish price action`;
      }
    }
    
    return {
      agentName,
      mode: 'PROXY',
      signal,
      confidence,
      strength: confidence * 0.5,
      executionScore: confidence * 80,
      reasoning: reasoning || 'Normal volume',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Momentum-based proxy signal (for FundingRateAnalyst)
   */
  private momentumProxySignal(agentName: string, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const closes = candles.slice(0, index + 1).map(c => c.close);
    
    // Calculate momentum (rate of change)
    const roc10 = (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11];
    const rsi = this.calculateRSI(closes, 14);
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // Extreme momentum suggests funding rate extremes (contrarian)
    if (rsi > 75 && roc10 > 0.05) {
      signal = 'bearish';
      confidence = 0.5;
      reasoning = 'Extreme bullish momentum - likely high positive funding (contrarian bearish)';
    } else if (rsi < 25 && roc10 < -0.05) {
      signal = 'bullish';
      confidence = 0.5;
      reasoning = 'Extreme bearish momentum - likely negative funding (contrarian bullish)';
    }
    
    return {
      agentName,
      mode: 'PROXY',
      signal,
      confidence,
      strength: confidence * 0.5,
      executionScore: confidence * 70,
      reasoning: reasoning || 'Normal momentum',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Volatility-based proxy signal (for LiquidationHeatmap)
   */
  private volatilityProxySignal(agentName: string, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const atr = this.calculateATR(candles.slice(0, index + 1), 14);
    const avgAtr = this.calculateATR(candles.slice(0, index - 13), 14);
    
    const volatilityRatio = atr / avgAtr;
    const priceChange = (currentCandle.close - currentCandle.open) / currentCandle.open;
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // High volatility suggests liquidation cascades
    if (volatilityRatio > 1.5) {
      if (priceChange < -0.02) {
        signal = 'bullish';
        confidence = 0.4;
        reasoning = 'High volatility with sharp drop - potential long liquidation cascade (bounce expected)';
      } else if (priceChange > 0.02) {
        signal = 'bearish';
        confidence = 0.4;
        reasoning = 'High volatility with sharp rise - potential short liquidation cascade (pullback expected)';
      }
    }
    
    return {
      agentName,
      mode: 'PROXY',
      signal,
      confidence,
      strength: confidence * 0.5,
      executionScore: confidence * 60,
      reasoning: reasoning || 'Normal volatility',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Correlation-based proxy signal (for ForexCorrelationAgent)
   */
  private correlationProxySignal(agentName: string, candles: Candle[], index: number): BacktestSignal {
    const currentCandle = candles[index];
    const closes = candles.slice(0, index + 1).map(c => c.close);
    
    // Use BTC's own momentum as proxy for DXY inverse correlation
    // Assumption: Strong BTC moves often correlate with DXY weakness
    const roc5 = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';
    
    // Strong BTC momentum suggests favorable macro (weak DXY)
    if (roc5 > 0.03) {
      signal = 'bullish';
      confidence = 0.3;
      reasoning = 'Strong BTC momentum - likely favorable macro conditions';
    } else if (roc5 < -0.03) {
      signal = 'bearish';
      confidence = 0.3;
      reasoning = 'Weak BTC momentum - likely unfavorable macro conditions';
    }
    
    return {
      agentName,
      mode: 'PROXY',
      signal,
      confidence,
      strength: confidence * 0.4,
      executionScore: confidence * 50,
      reasoning: reasoning || 'Neutral macro proxy',
      timestamp: currentCandle.timestamp,
    };
  }
  
  /**
   * Create neutral signal
   */
  private createNeutralSignal(agentName: string, mode: AgentMode, timestamp: Date): BacktestSignal {
    return {
      agentName,
      mode,
      signal: 'neutral',
      confidence: 0,
      strength: 0,
      executionScore: 50,
      reasoning: mode === 'SHADOW' ? 'Shadow mode - no consensus influence' : 'No signal',
      timestamp,
    };
  }
  
  /**
   * Aggregate consensus from all agent signals
   */
  private aggregateConsensus(signals: BacktestSignal[]): { 
    shouldEnter: boolean; 
    direction: 'long' | 'short' | null;
    score: number;
    agentAgreement: number;
  } {
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    
    for (const signal of signals) {
      const classification = AGENT_CLASSIFICATIONS.find(a => a.name === signal.agentName);
      if (!classification || classification.mode === 'SHADOW') continue;
      
      const weight = classification.maxWeight;
      
      if (signal.signal === 'bullish') {
        bullishScore += signal.confidence * weight;
        bullishCount++;
      } else if (signal.signal === 'bearish') {
        bearishScore += signal.confidence * weight;
        bearishCount++;
      }
      
      totalWeight += weight;
    }
    
    // Normalize scores
    const normalizedBullish = totalWeight > 0 ? bullishScore / totalWeight : 0;
    const normalizedBearish = totalWeight > 0 ? bearishScore / totalWeight : 0;
    
    // Determine direction and score
    let direction: 'long' | 'short' | null = null;
    let score = 0;
    let agentAgreement = 0;
    
    if (normalizedBullish > normalizedBearish && normalizedBullish > this.config.consensusThreshold) {
      direction = 'long';
      score = normalizedBullish;
      agentAgreement = bullishCount;
    } else if (normalizedBearish > normalizedBullish && normalizedBearish > this.config.consensusThreshold) {
      direction = 'short';
      score = normalizedBearish;
      agentAgreement = bearishCount;
    }
    
    const shouldEnter = direction !== null && agentAgreement >= this.config.minAgentAgreement;
    
    return { shouldEnter, direction, score, agentAgreement };
  }
  
  /**
   * Enter a new trade
   */
  private enterTrade(candle: Candle, consensus: any, signals: BacktestSignal[]): void {
    const entryPrice = candle.close;
    const positionSizePercent = this.calculatePositionSize(consensus.score, consensus.agentAgreement);
    const positionSize = this.currentEquity * positionSizePercent;
    const quantity = positionSize / entryPrice;
    
    // Calculate stop loss and take profit
    const stopLossDistance = entryPrice * (this.config.stopLossPercent / 100);
    const takeProfitDistance = entryPrice * (this.config.takeProfitPercent / 100);
    
    const stopLoss = consensus.direction === 'long' 
      ? entryPrice - stopLossDistance 
      : entryPrice + stopLossDistance;
    
    const takeProfit = consensus.direction === 'long'
      ? entryPrice + takeProfitDistance
      : entryPrice - takeProfitDistance;
    
    this.currentPosition = {
      id: ++this.tradeIdCounter,
      symbol: this.config.symbol,
      side: consensus.direction!,
      entryPrice,
      entryTime: candle.timestamp,
      quantity,
      positionSize,
      stopLoss,
      takeProfit,
      agentSignals: signals,
      consensusScore: consensus.score,
    };
    
    console.log(`[Backtest] ENTER ${consensus.direction?.toUpperCase()} @ ${entryPrice.toFixed(2)} | Size: $${positionSize.toFixed(2)} | Consensus: ${(consensus.score * 100).toFixed(1)}%`);
  }
  
  /**
   * Calculate position size based on consensus
   */
  private calculatePositionSize(consensusScore: number, agentAgreement: number): number {
    // Tiered position sizing based on agent agreement
    let baseSize = 0.03; // 3% base
    
    if (agentAgreement >= 4) {
      baseSize = 0.07; // 7% for 4+ agents
    } else if (agentAgreement >= 3) {
      baseSize = 0.05; // 5% for 3 agents
    }
    
    // Scale by consensus score
    const scaledSize = baseSize * (0.5 + consensusScore * 0.5);
    
    return Math.min(scaledSize, this.config.maxPositionSize / 100);
  }
  
  /**
   * Manage existing position
   */
  private managePosition(candle: Candle, index: number, consensus: any): void {
    if (!this.currentPosition) return;
    
    const currentPrice = candle.close;
    const holdPeriod = index - this.candles.findIndex(c => c.timestamp === this.currentPosition!.entryTime);
    
    // Check stop loss
    if (this.currentPosition.side === 'long' && currentPrice <= this.currentPosition.stopLoss) {
      this.exitTrade(candle, 'stop_loss');
      return;
    }
    if (this.currentPosition.side === 'short' && currentPrice >= this.currentPosition.stopLoss) {
      this.exitTrade(candle, 'stop_loss');
      return;
    }
    
    // Check take profit
    if (this.currentPosition.side === 'long' && currentPrice >= this.currentPosition.takeProfit) {
      this.exitTrade(candle, 'take_profit');
      return;
    }
    if (this.currentPosition.side === 'short' && currentPrice <= this.currentPosition.takeProfit) {
      this.exitTrade(candle, 'take_profit');
      return;
    }
    
    // Check max hold period
    if (holdPeriod >= this.config.maxHoldPeriod) {
      this.exitTrade(candle, 'time_exit');
      return;
    }
    
    // Check opposite signal
    if (consensus.shouldEnter && consensus.direction !== this.currentPosition.side) {
      this.exitTrade(candle, 'opposite_signal');
      return;
    }
    
    // Update trailing stop if enabled
    if (this.config.useTrailingStop) {
      this.updateTrailingStop(candle);
    }
  }
  
  /**
   * Update trailing stop
   */
  private updateTrailingStop(candle: Candle): void {
    if (!this.currentPosition) return;
    
    const trailingDistance = candle.close * (this.config.trailingStopPercent / 100);
    
    if (this.currentPosition.side === 'long') {
      const newStop = candle.close - trailingDistance;
      if (newStop > this.currentPosition.stopLoss) {
        this.currentPosition.stopLoss = newStop;
      }
    } else {
      const newStop = candle.close + trailingDistance;
      if (newStop < this.currentPosition.stopLoss) {
        this.currentPosition.stopLoss = newStop;
      }
    }
  }
  
  /**
   * Exit trade
   */
  private exitTrade(candle: Candle, reason: BacktestTrade['exitReason']): void {
    if (!this.currentPosition) return;
    
    const exitPrice = candle.close;
    const pnl = this.currentPosition.side === 'long'
      ? (exitPrice - this.currentPosition.entryPrice) * this.currentPosition.quantity
      : (this.currentPosition.entryPrice - exitPrice) * this.currentPosition.quantity;
    
    const pnlPercent = pnl / this.currentPosition.positionSize * 100;
    
    this.currentPosition.exitPrice = exitPrice;
    this.currentPosition.exitTime = candle.timestamp;
    this.currentPosition.pnl = pnl;
    this.currentPosition.pnlPercent = pnlPercent;
    this.currentPosition.exitReason = reason;
    
    // Update equity
    this.currentEquity += pnl;
    
    // Record trade
    this.trades.push({ ...this.currentPosition });
    
    console.log(`[Backtest] EXIT ${this.currentPosition.side.toUpperCase()} @ ${exitPrice.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | Reason: ${reason}`);
    
    this.currentPosition = null;
  }
  
  /**
   * Update equity curve
   */
  private updateEquityCurve(candle: Candle): void {
    let equity = this.currentEquity;
    
    // Add unrealized P&L if position is open
    if (this.currentPosition) {
      const unrealizedPnl = this.currentPosition.side === 'long'
        ? (candle.close - this.currentPosition.entryPrice) * this.currentPosition.quantity
        : (this.currentPosition.entryPrice - candle.close) * this.currentPosition.quantity;
      equity += unrealizedPnl;
    }
    
    // Update peak
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    
    // Calculate drawdown
    const drawdown = this.peakEquity - equity;
    const drawdownPercent = (drawdown / this.peakEquity) * 100;
    
    this.equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      drawdown,
      drawdownPercent,
    });
  }
  
  /**
   * Generate final results
   */
  private generateResults(): BacktestResults {
    const metrics = this.calculateMetrics();
    const agentPerformance = this.analyzeAgentPerformance();
    const monthlyPnL = this.calculateMonthlyPnL();
    const drawdowns = this.identifyDrawdowns();
    
    return {
      config: this.config,
      trades: this.trades,
      metrics,
      equityCurve: this.equityCurve,
      agentPerformance,
      monthlyPnL,
      drawdowns,
    };
  }
  
  /**
   * Calculate performance metrics
   */
  private calculateMetrics(): BacktestMetrics {
    const winningTrades = this.trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = this.trades.filter(t => (t.pnl || 0) < 0);
    
    const totalPnL = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalPnLPercent = (totalPnL / this.config.initialCapital) * 100;
    
    const maxDrawdown = Math.max(...this.equityCurve.map(e => e.drawdown));
    const maxDrawdownPercent = Math.max(...this.equityCurve.map(e => e.drawdownPercent));
    
    const wins = winningTrades.map(t => t.pnl || 0);
    const losses = losingTrades.map(t => Math.abs(t.pnl || 0));
    
    const averageWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const averageLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    
    const profitFactor = losses.reduce((a, b) => a + b, 0) > 0
      ? wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0)
      : wins.reduce((a, b) => a + b, 0) > 0 ? Infinity : 0;
    
    // Calculate Sharpe Ratio (simplified)
    const returns = this.trades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;
    
    return {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0,
      totalPnL,
      totalPnLPercent,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      profitFactor,
      averageWin,
      averageLoss,
      largestWin: wins.length > 0 ? Math.max(...wins) : 0,
      largestLoss: losses.length > 0 ? Math.max(...losses) : 0,
      averageHoldTime: this.trades.length > 0 
        ? this.trades.reduce((sum, t) => {
            if (t.entryTime && t.exitTime) {
              return sum + (t.exitTime.getTime() - t.entryTime.getTime()) / (1000 * 60 * 60);
            }
            return sum;
          }, 0) / this.trades.length
        : 0,
      finalEquity: this.currentEquity,
    };
  }
  
  /**
   * Analyze agent performance
   */
  private analyzeAgentPerformance(): AgentPerformance[] {
    const performance: AgentPerformance[] = [];
    
    for (const agent of AGENT_CLASSIFICATIONS) {
      const signals = this.agentSignalLog.get(agent.name) || [];
      
      const bullishSignals = signals.filter(s => s.signal === 'bullish').length;
      const bearishSignals = signals.filter(s => s.signal === 'bearish').length;
      const neutralSignals = signals.filter(s => s.signal === 'neutral').length;
      
      // Calculate alignment with winning trades
      let alignedWithWins = 0;
      let alignedWithLosses = 0;
      
      for (const trade of this.trades) {
        const tradeSignals = trade.agentSignals.filter(s => s.agentName === agent.name);
        for (const signal of tradeSignals) {
          const isWin = (trade.pnl || 0) > 0;
          const isAligned = (trade.side === 'long' && signal.signal === 'bullish') ||
                           (trade.side === 'short' && signal.signal === 'bearish');
          
          if (isAligned && isWin) alignedWithWins++;
          if (isAligned && !isWin) alignedWithLosses++;
        }
      }
      
      const totalAligned = alignedWithWins + alignedWithLosses;
      const alignmentRate = totalAligned > 0 ? alignedWithWins / totalAligned : 0;
      
      const avgConfidence = signals.length > 0
        ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
        : 0;
      
      // Determine recommendation
      let recommendation: AgentPerformance['recommendation'];
      if (agent.mode === 'SHADOW') {
        recommendation = 'live_validation_only';
      } else if (agent.mode === 'PROXY' && alignmentRate < 0.4) {
        recommendation = 'add_proxy';
      } else if (alignmentRate >= 0.5) {
        recommendation = 'keep_active';
      } else {
        recommendation = 'needs_improvement';
      }
      
      performance.push({
        agentName: agent.name,
        mode: agent.mode,
        totalSignals: signals.length,
        bullishSignals,
        bearishSignals,
        neutralSignals,
        signalsAlignedWithWins: alignedWithWins,
        signalsAlignedWithLosses: alignedWithLosses,
        alignmentRate,
        averageConfidence: avgConfidence,
        recommendation,
      });
    }
    
    return performance;
  }
  
  /**
   * Calculate monthly P&L
   */
  private calculateMonthlyPnL(): MonthlyPnL[] {
    const monthlyData: Map<string, { pnl: number; trades: BacktestTrade[] }> = new Map();
    
    for (const trade of this.trades) {
      if (!trade.exitTime) continue;
      
      const month = `${trade.exitTime.getFullYear()}-${String(trade.exitTime.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlyData.get(month) || { pnl: 0, trades: [] };
      existing.pnl += trade.pnl || 0;
      existing.trades.push(trade);
      monthlyData.set(month, existing);
    }
    
    const result: MonthlyPnL[] = [];
    for (const [month, data] of monthlyData) {
      const winningTrades = data.trades.filter(t => (t.pnl || 0) > 0).length;
      result.push({
        month,
        pnl: data.pnl,
        pnlPercent: (data.pnl / this.config.initialCapital) * 100,
        trades: data.trades.length,
        winRate: data.trades.length > 0 ? (winningTrades / data.trades.length) * 100 : 0,
      });
    }
    
    return result.sort((a, b) => a.month.localeCompare(b.month));
  }
  
  /**
   * Identify drawdown periods
   */
  private identifyDrawdowns(): DrawdownPeriod[] {
    const drawdowns: DrawdownPeriod[] = [];
    let inDrawdown = false;
    let drawdownStart: Date | null = null;
    let maxDrawdownInPeriod = 0;
    let maxDrawdownPercentInPeriod = 0;
    
    for (let i = 0; i < this.equityCurve.length; i++) {
      const point = this.equityCurve[i];
      
      if (point.drawdown > 0 && !inDrawdown) {
        inDrawdown = true;
        drawdownStart = point.timestamp;
        maxDrawdownInPeriod = point.drawdown;
        maxDrawdownPercentInPeriod = point.drawdownPercent;
      } else if (point.drawdown > maxDrawdownInPeriod) {
        maxDrawdownInPeriod = point.drawdown;
        maxDrawdownPercentInPeriod = point.drawdownPercent;
      } else if (point.drawdown === 0 && inDrawdown) {
        drawdowns.push({
          startDate: drawdownStart!,
          endDate: point.timestamp,
          drawdown: maxDrawdownInPeriod,
          drawdownPercent: maxDrawdownPercentInPeriod,
          recoveryCandles: i - this.equityCurve.findIndex(e => e.timestamp === drawdownStart),
        });
        inDrawdown = false;
        drawdownStart = null;
        maxDrawdownInPeriod = 0;
        maxDrawdownPercentInPeriod = 0;
      }
    }
    
    // Handle ongoing drawdown
    if (inDrawdown && drawdownStart) {
      const lastPoint = this.equityCurve[this.equityCurve.length - 1];
      drawdowns.push({
        startDate: drawdownStart,
        endDate: lastPoint.timestamp,
        drawdown: maxDrawdownInPeriod,
        drawdownPercent: maxDrawdownPercentInPeriod,
        recoveryCandles: -1, // Ongoing
      });
    }
    
    return drawdowns.sort((a, b) => b.drawdownPercent - a.drawdownPercent);
  }
  
  // ==================== Technical Indicator Calculations ====================
  
  private calculateRSI(closes: number[], period: number): number {
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
  
  private calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macdLine = ema12 - ema26;
    
    // Signal line (9-period EMA of MACD)
    const macdHistory: number[] = [];
    for (let i = 26; i < closes.length; i++) {
      const e12 = this.calculateEMA(closes.slice(0, i + 1), 12);
      const e26 = this.calculateEMA(closes.slice(0, i + 1), 26);
      macdHistory.push(e12 - e26);
    }
    
    const signalLine = macdHistory.length >= 9 
      ? this.calculateEMA(macdHistory, 9)
      : macdLine;
    
    return {
      value: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine,
    };
  }
  
  private calculateSMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] || 0;
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
  
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] || 0;
    
    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(values.slice(0, period), period);
    
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  private calculateATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    return this.calculateSMA(trueRanges.slice(-period), period);
  }
  
  private calculateVWAP(candles: Candle[]): number {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    
    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }
    
    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : candles[candles.length - 1].close;
  }
  
  private calculateExecutionScore(price: number, sma20: number, sma50: number, rsi: number): number {
    let score = 50;
    
    // Proximity to SMA20 (support/resistance)
    const distanceToSma20 = Math.abs(price - sma20) / price;
    if (distanceToSma20 < 0.01) score += 15;
    else if (distanceToSma20 < 0.02) score += 10;
    
    // RSI extremes
    if (rsi < 30 || rsi > 70) score += 15;
    else if (rsi < 40 || rsi > 60) score += 5;
    
    // Trend alignment
    if (price > sma20 && sma20 > sma50) score += 10;
    else if (price < sma20 && sma20 < sma50) score += 10;
    
    return Math.min(score, 100);
  }
  
  private detectPattern(candles: Candle[]): { type: string; confidence: number } {
    if (candles.length < 10) return { type: 'none', confidence: 0 };
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Simple pattern detection
    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    
    // Check for higher highs
    let higherHighs = 0;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i] > recentHighs[i - 1]) higherHighs++;
    }
    
    // Check for lower lows
    let lowerLows = 0;
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i] < recentLows[i - 1]) lowerLows++;
    }
    
    if (higherHighs >= 7) {
      return { type: 'higher_highs', confidence: 0.6 };
    }
    if (lowerLows >= 7) {
      return { type: 'lower_lows', confidence: 0.6 };
    }
    
    // Simple double bottom/top detection
    const minLow = Math.min(...recentLows);
    const maxHigh = Math.max(...recentHighs);
    const lowIndices = recentLows.map((l, i) => l === minLow ? i : -1).filter(i => i >= 0);
    const highIndices = recentHighs.map((h, i) => h === maxHigh ? i : -1).filter(i => i >= 0);
    
    if (lowIndices.length >= 2 && Math.abs(lowIndices[0] - lowIndices[lowIndices.length - 1]) >= 3) {
      return { type: 'double_bottom', confidence: 0.7 };
    }
    if (highIndices.length >= 2 && Math.abs(highIndices[0] - highIndices[highIndices.length - 1]) >= 3) {
      return { type: 'double_top', confidence: 0.7 };
    }
    
    return { type: 'none', confidence: 0 };
  }
}

/**
 * Run backtest with default configuration
 */
export async function runInstitutionalBacktest(
  symbol: string = 'BTC-USD',
  options: Partial<BacktestConfig> = {}
): Promise<BacktestResults> {
  const config: BacktestConfig = {
    symbol,
    startDate: new Date('2025-10-15'),
    endDate: new Date('2025-12-31'),
    initialCapital: 10000,
    maxPositionSize: 10, // 10% max
    consensusThreshold: 0.5, // 50% consensus required
    minAgentAgreement: 2, // At least 2 agents must agree
    stopLossPercent: 2.0,
    takeProfitPercent: 4.0,
    maxHoldPeriod: 72, // 72 hours
    useTrailingStop: true,
    trailingStopPercent: 1.5,
    ...options,
  };
  
  const engine = new InstitutionalBacktestEngine(config);
  return engine.run();
}
