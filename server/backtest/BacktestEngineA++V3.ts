/**
 * A++ Institutional Grade Backtest Engine V3
 * 
 * Integrates all fixes:
 * 1. Agent-driven intelligent exit (no static stop-loss)
 * 2. 60% consensus threshold
 * 3. HFT/Scalping integration
 * 4. Dynamic position sizing based on confidence
 * 5. Partial profit taking
 * 6. Strategy-regime matching
 * 7. Breakeven protection
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

// Types
export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'choppy';
export type StrategyType = 'scalping' | 'momentum' | 'mean_reversion' | 'trend_following' | 'breakout' | 'swing' | 'range_trading';
export type TradeDirection = 'long' | 'short';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AgentSignal {
  agentName: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
}

export interface Trade {
  id: string;
  symbol: string;
  direction: TradeDirection;
  strategy: StrategyType;
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  quantity: number;
  positionValue: number;
  stopLoss?: number;  // Only for emergency, not used normally
  takeProfit?: number;
  
  // A++ Features
  consensus: number;
  agentSignals: AgentSignal[];
  regime: MarketRegime;
  breakevenActivated: boolean;
  partialExits: { price: number; quantity: number; pnlPercent: number; reason: string }[];
  highestPrice: number;
  lowestPrice: number;
  
  // Results
  pnl?: number;
  pnlPercent?: number;
  exitReason?: string;
  holdTimeMs?: number;
}

export interface BacktestConfig {
  // Capital
  initialCapital: number;
  
  // Consensus
  consensusThreshold: number;  // 60% minimum
  
  // Position sizing
  basePositionPercent: number;  // Base position size as % of capital
  maxPositionPercent: number;   // Maximum position size
  confidenceMultiplier: number; // How much confidence affects size
  
  // Intelligent exit (no static SL)
  breakevenActivationPercent: number;  // Activate breakeven at this profit
  breakevenBuffer: number;             // Buffer above entry
  
  // Partial profit taking
  partialProfitLevels: { pnlPercent: number; exitPercent: number }[];
  
  // Trailing stop (for remaining position)
  trailingActivationPercent: number;
  trailingPercent: number;
  
  // Emergency stop (only for catastrophic loss)
  emergencyStopPercent: number;  // e.g., -5%
  
  // Time-based exit
  maxHoldTimeMinutes: number;
  
  // Strategy-regime matching
  regimeStrategies: Record<MarketRegime, StrategyType[]>;
  
  // Agent specializations
  agentStrategies: Record<string, StrategyType[]>;
  
  // Fees
  feePercent: number;
}

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 50000,
  
  consensusThreshold: 0.60,  // 60% consensus required
  
  basePositionPercent: 0.05,  // 5% base
  maxPositionPercent: 0.20,   // 20% max
  confidenceMultiplier: 2.0,  // 2x at 100% confidence
  
  breakevenActivationPercent: 0.5,  // Breakeven at +0.5%
  breakevenBuffer: 0.1,             // 0.1% buffer
  
  partialProfitLevels: [
    { pnlPercent: 1.0, exitPercent: 25 },
    { pnlPercent: 1.5, exitPercent: 25 },
    { pnlPercent: 2.0, exitPercent: 25 },
  ],
  
  trailingActivationPercent: 1.5,
  trailingPercent: 0.5,
  
  emergencyStopPercent: -5.0,  // Only emergency at -5%
  
  maxHoldTimeMinutes: 240,  // 4 hours max
  
  regimeStrategies: {
    trending_up: ['trend_following', 'momentum', 'breakout', 'swing'],
    trending_down: ['trend_following', 'momentum', 'breakout', 'swing'],
    ranging: ['mean_reversion', 'range_trading', 'scalping'],
    volatile: ['scalping'],
    choppy: [],  // No trading
  },
  
  agentStrategies: {
    'TechnicalAnalyst': ['trend_following', 'momentum', 'swing'],
    'PatternMatcher': ['breakout', 'swing', 'trend_following'],
    'OrderFlowAnalyst': ['scalping', 'momentum', 'breakout'],
    'SentimentAnalyst': ['swing', 'trend_following'],
    'WhaleTracker': ['momentum', 'breakout', 'swing'],
    'FundingRateAnalyst': ['mean_reversion', 'range_trading'],
    'LiquidationHeatmap': ['breakout', 'momentum'],
    'OnChainFlowAnalyst': ['swing', 'trend_following'],
    'VolumeProfileAnalyzer': ['range_trading', 'mean_reversion', 'breakout'],
    'MacroAnalyst': ['swing', 'trend_following'],
    'NewsSentinel': ['momentum', 'scalping'],
    'OnChainAnalyst': ['swing', 'trend_following'],
  },
  
  feePercent: 0.1,  // 0.1% per trade
};

export class BacktestEngineAPlusPlusV3 extends EventEmitter {
  private config: BacktestConfig;
  private capital: number;
  private trades: Trade[] = [];
  private openTrades: Map<string, Trade> = new Map();
  private currentCandle: Candle | null = null;
  private candles: Candle[] = [];
  
  constructor(config?: Partial<BacktestConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capital = this.config.initialCapital;
  }

  /**
   * Run backtest on historical data
   */
  async runBacktest(
    symbol: string,
    candles: Candle[],
    generateSignals: (candle: Candle, history: Candle[]) => AgentSignal[]
  ): Promise<BacktestResult> {
    console.log(`\n========== A++ BACKTEST V3 ==========`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Period: ${new Date(candles[0].timestamp).toISOString()} to ${new Date(candles[candles.length - 1].timestamp).toISOString()}`);
    console.log(`Candles: ${candles.length}`);
    console.log(`Initial Capital: $${this.config.initialCapital.toLocaleString()}`);
    console.log(`Consensus Threshold: ${(this.config.consensusThreshold * 100).toFixed(0)}%`);
    console.log(`======================================\n`);
    
    this.candles = candles;
    this.capital = this.config.initialCapital;
    this.trades = [];
    this.openTrades.clear();
    
    let signalsGenerated = 0;
    let signalsRejected = 0;
    let tradesOpened = 0;
    let tradesClosed = 0;
    
    for (let i = 20; i < candles.length; i++) {
      this.currentCandle = candles[i];
      const history = candles.slice(0, i + 1);
      
      // 1. Update open positions with new price
      await this.updateOpenPositions(candles[i]);
      
      // 2. Generate agent signals
      const signals = generateSignals(candles[i], history);
      signalsGenerated++;
      
      // 3. Detect market regime
      const regime = this.detectRegime(history);
      
      // 4. Check if we should trade
      if (this.openTrades.size === 0) {  // Only one position at a time for simplicity
        const tradeDecision = this.evaluateTradeEntry(signals, regime, candles[i]);
        
        if (tradeDecision.shouldTrade && tradeDecision.direction && tradeDecision.strategy && tradeDecision.consensus !== undefined) {
          await this.openTrade(symbol, { direction: tradeDecision.direction, strategy: tradeDecision.strategy, consensus: tradeDecision.consensus }, candles[i], signals, regime);
          tradesOpened++;
        } else {
          signalsRejected++;
        }
      }
    }
    
    // Close any remaining open positions
    for (const [tradeId, trade] of this.openTrades) {
      await this.closeTrade(tradeId, this.candles[this.candles.length - 1].close, 'backtest_end');
      tradesClosed++;
    }
    
    // Calculate results
    const result = this.calculateResults(symbol);
    
    console.log(`\n========== BACKTEST COMPLETE ==========`);
    console.log(`Signals Generated: ${signalsGenerated}`);
    console.log(`Signals Rejected: ${signalsRejected}`);
    console.log(`Trades Opened: ${tradesOpened}`);
    console.log(`Trades Closed: ${tradesClosed}`);
    console.log(`=======================================\n`);
    
    return result;
  }

  /**
   * Detect market regime from price history
   */
  private detectRegime(candles: Candle[]): MarketRegime {
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
    
    // Calculate trend strength (simplified ADX)
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
   * Calculate ATR as percentage
   */
  private calculateATRPercent(candles: Candle[]): number {
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

  /**
   * Evaluate whether to enter a trade
   */
  private evaluateTradeEntry(
    signals: AgentSignal[],
    regime: MarketRegime,
    candle: Candle
  ): { shouldTrade: boolean; direction?: TradeDirection; strategy?: StrategyType; consensus?: number; reason: string } {
    // Check if trading is allowed in this regime
    const allowedStrategies = this.config.regimeStrategies[regime];
    if (allowedStrategies.length === 0) {
      return { shouldTrade: false, reason: `No trading in ${regime} regime` };
    }
    
    // Calculate consensus
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    
    for (const signal of signals) {
      const weight = signal.confidence;
      totalWeight += weight;
      
      if (signal.direction === 'bullish') {
        bullishScore += weight;
      } else if (signal.direction === 'bearish') {
        bearishScore += weight;
      }
    }
    
    const bullishConsensus = totalWeight > 0 ? bullishScore / totalWeight : 0;
    const bearishConsensus = totalWeight > 0 ? bearishScore / totalWeight : 0;
    
    // Determine direction and consensus
    let direction: TradeDirection;
    let consensus: number;
    
    if (bullishConsensus > bearishConsensus) {
      direction = 'long';
      consensus = bullishConsensus;
    } else {
      direction = 'short';
      consensus = bearishConsensus;
    }
    
    // Check consensus threshold
    if (consensus < this.config.consensusThreshold) {
      return { 
        shouldTrade: false, 
        reason: `Consensus ${(consensus * 100).toFixed(1)}% below threshold ${(this.config.consensusThreshold * 100).toFixed(0)}%` 
      };
    }
    
    // Select best strategy for regime
    const strategy = this.selectStrategy(signals, regime, allowedStrategies);
    if (!strategy) {
      return { shouldTrade: false, reason: 'No suitable strategy for current conditions' };
    }
    
    return {
      shouldTrade: true,
      direction,
      strategy,
      consensus,
      reason: `${direction.toUpperCase()} signal with ${(consensus * 100).toFixed(1)}% consensus using ${strategy}`,
    };
  }

  /**
   * Select the best strategy based on agent specializations
   */
  private selectStrategy(
    signals: AgentSignal[],
    regime: MarketRegime,
    allowedStrategies: StrategyType[]
  ): StrategyType | null {
    const strategyScores: Map<StrategyType, number> = new Map();
    
    for (const strategy of allowedStrategies) {
      let score = 0;
      let count = 0;
      
      for (const signal of signals) {
        const agentStrategies = this.config.agentStrategies[signal.agentName] || [];
        if (agentStrategies.includes(strategy)) {
          score += signal.confidence;
          count++;
        }
      }
      
      if (count > 0) {
        strategyScores.set(strategy, score / count);
      }
    }
    
    // Find best strategy
    let bestStrategy: StrategyType | null = null;
    let bestScore = 0;
    
    for (const [strategy, score] of strategyScores) {
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }
    
    return bestStrategy;
  }

  /**
   * Open a new trade
   */
  private async openTrade(
    symbol: string,
    decision: { direction: TradeDirection; strategy: StrategyType; consensus: number },
    candle: Candle,
    signals: AgentSignal[],
    regime: MarketRegime
  ): Promise<void> {
    // Calculate position size based on confidence
    const confidenceMultiplier = 1 + (decision.consensus - 0.5) * this.config.confidenceMultiplier;
    const positionPercent = Math.min(
      this.config.basePositionPercent * confidenceMultiplier,
      this.config.maxPositionPercent
    );
    const positionValue = this.capital * positionPercent;
    const quantity = positionValue / candle.close;
    
    // Apply fees
    const fee = positionValue * (this.config.feePercent / 100);
    this.capital -= fee;
    
    const trade: Trade = {
      id: `trade_${getActiveClock().now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      direction: decision.direction,
      strategy: decision.strategy,
      entryPrice: candle.close,
      entryTime: candle.timestamp,
      quantity,
      positionValue,
      consensus: decision.consensus,
      agentSignals: signals,
      regime,
      breakevenActivated: false,
      partialExits: [],
      highestPrice: candle.close,
      lowestPrice: candle.close,
    };
    
    this.openTrades.set(trade.id, trade);
    this.trades.push(trade);
    
    console.log(`📈 TRADE OPENED: ${trade.id}`);
    console.log(`   ${decision.direction.toUpperCase()} ${symbol} @ $${candle.close.toFixed(2)}`);
    console.log(`   Strategy: ${decision.strategy} | Regime: ${regime}`);
    console.log(`   Consensus: ${(decision.consensus * 100).toFixed(1)}%`);
    console.log(`   Position: $${positionValue.toFixed(2)} (${(positionPercent * 100).toFixed(1)}%)`);
  }

  /**
   * Update open positions with new price - INTELLIGENT EXIT LOGIC
   */
  private async updateOpenPositions(candle: Candle): Promise<void> {
    for (const [tradeId, trade] of this.openTrades) {
      // Update price tracking
      trade.highestPrice = Math.max(trade.highestPrice, candle.high);
      trade.lowestPrice = Math.min(trade.lowestPrice, candle.low);
      
      // Calculate current P&L
      let pnlPercent: number;
      if (trade.direction === 'long') {
        pnlPercent = ((candle.close - trade.entryPrice) / trade.entryPrice) * 100;
      } else {
        pnlPercent = ((trade.entryPrice - candle.close) / trade.entryPrice) * 100;
      }
      
      // ========== INTELLIGENT EXIT LOGIC ==========
      
      // 1. Emergency stop (only for catastrophic loss)
      if (pnlPercent <= this.config.emergencyStopPercent) {
        await this.closeTrade(tradeId, candle.close, `emergency_stop_${pnlPercent.toFixed(2)}%`);
        continue;
      }
      
      // 2. Breakeven activation
      if (!trade.breakevenActivated && pnlPercent >= this.config.breakevenActivationPercent) {
        trade.breakevenActivated = true;
        console.log(`   🛡️ Breakeven activated for ${tradeId} at +${pnlPercent.toFixed(2)}%`);
      }
      
      // 3. Breakeven exit (never let winner become loser)
      if (trade.breakevenActivated && pnlPercent <= this.config.breakevenBuffer) {
        await this.closeTrade(tradeId, candle.close, `breakeven_exit`);
        continue;
      }
      
      // 4. Partial profit taking
      const remainingQuantityPercent = (trade.quantity - trade.partialExits.reduce((sum, e) => sum + e.quantity, 0)) / trade.quantity * 100;
      
      for (const level of this.config.partialProfitLevels) {
        if (pnlPercent >= level.pnlPercent && remainingQuantityPercent > 25) {
          const alreadyTaken = trade.partialExits.some(e => Math.abs(e.pnlPercent - level.pnlPercent) < 0.5);
          
          if (!alreadyTaken) {
            const exitQuantity = trade.quantity * (level.exitPercent / 100);
            const exitValue = exitQuantity * candle.close;
            const fee = exitValue * (this.config.feePercent / 100);
            
            // Calculate P&L for this partial
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
            
            console.log(`   💰 Partial exit ${tradeId}: ${level.exitPercent}% @ +${pnlPercent.toFixed(2)}% (+$${partialPnl.toFixed(2)})`);
          }
        }
      }
      
      // 5. Trailing stop for remaining position
      if (pnlPercent >= this.config.trailingActivationPercent) {
        const peakPnl = trade.direction === 'long'
          ? ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.lowestPrice) / trade.entryPrice) * 100;
        
        const drawdownFromPeak = peakPnl - pnlPercent;
        
        if (drawdownFromPeak >= this.config.trailingPercent) {
          await this.closeTrade(tradeId, candle.close, `trailing_stop_from_peak_${peakPnl.toFixed(2)}%`);
          continue;
        }
      }
      
      // 6. Time-based exit
      const holdTimeMinutes = (candle.timestamp - trade.entryTime) / (1000 * 60);
      if (holdTimeMinutes >= this.config.maxHoldTimeMinutes) {
        if (pnlPercent >= 0) {
          await this.closeTrade(tradeId, candle.close, `time_exit_profitable_${pnlPercent.toFixed(2)}%`);
        } else {
          // Hold a bit longer if losing but not catastrophic
          if (holdTimeMinutes >= this.config.maxHoldTimeMinutes * 1.5) {
            await this.closeTrade(tradeId, candle.close, `time_exit_extended_${pnlPercent.toFixed(2)}%`);
          }
        }
      }
    }
  }

  /**
   * Close a trade
   */
  private async closeTrade(tradeId: string, exitPrice: number, reason: string): Promise<void> {
    const trade = this.openTrades.get(tradeId);
    if (!trade) return;
    
    // Calculate remaining quantity after partial exits
    const exitedQuantity = trade.partialExits.reduce((sum, e) => sum + e.quantity, 0);
    const remainingQuantity = trade.quantity - exitedQuantity;
    
    if (remainingQuantity <= 0) {
      this.openTrades.delete(tradeId);
      return;
    }
    
    // Calculate P&L for remaining position
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
    trade.exitTime = this.currentCandle?.timestamp || getActiveClock().now();
    trade.pnl = totalPnl;
    trade.pnlPercent = totalPnlPercent;
    trade.exitReason = reason;
    trade.holdTimeMs = trade.exitTime - trade.entryTime;
    
    this.openTrades.delete(tradeId);
    
    const emoji = totalPnl >= 0 ? '✅' : '❌';
    console.log(`${emoji} TRADE CLOSED: ${tradeId}`);
    console.log(`   Exit @ $${exitPrice.toFixed(2)} | Reason: ${reason}`);
    console.log(`   P&L: $${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}%)`);
    console.log(`   Partial Exits: ${trade.partialExits.length}`);
    console.log(`   Hold Time: ${((trade.holdTimeMs || 0) / 60000).toFixed(1)} min`);
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
    let runningCapital = this.config.initialCapital;
    
    for (const trade of completedTrades) {
      runningCapital += (trade.pnl || 0);
      peak = Math.max(peak, runningCapital);
      const drawdown = (peak - runningCapital) / peak * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Calculate Sharpe-like ratio
    const returns = completedTrades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // Analyze by strategy
    const strategyStats: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    for (const trade of completedTrades) {
      if (!strategyStats[trade.strategy]) {
        strategyStats[trade.strategy] = { trades: 0, winRate: 0, pnl: 0 };
      }
      strategyStats[trade.strategy].trades++;
      strategyStats[trade.strategy].pnl += (trade.pnl || 0);
      if ((trade.pnl || 0) > 0) {
        strategyStats[trade.strategy].winRate++;
      }
    }
    
    for (const strategy in strategyStats) {
      strategyStats[strategy].winRate = strategyStats[strategy].winRate / strategyStats[strategy].trades;
    }
    
    // Analyze by regime
    const regimeStats: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    for (const trade of completedTrades) {
      if (!regimeStats[trade.regime]) {
        regimeStats[trade.regime] = { trades: 0, winRate: 0, pnl: 0 };
      }
      regimeStats[trade.regime].trades++;
      regimeStats[trade.regime].pnl += (trade.pnl || 0);
      if ((trade.pnl || 0) > 0) {
        regimeStats[trade.regime].winRate++;
      }
    }
    
    for (const regime in regimeStats) {
      regimeStats[regime].winRate = regimeStats[regime].winRate / regimeStats[regime].trades;
    }
    
    return {
      symbol,
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
      strategyStats,
      regimeStats,
      trades: completedTrades,
    };
  }
}

export interface BacktestResult {
  symbol: string;
  initialCapital: number;
  finalCapital: number;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  strategyStats: Record<string, { trades: number; winRate: number; pnl: number }>;
  regimeStats: Record<string, { trades: number; winRate: number; pnl: number }>;
  trades: Trade[];
}
