/**
 * Reinforcement Learning Trading Environment
 * 
 * OpenAI Gym-compatible trading environment for RL agents.
 * Provides state representation, action space, and reward calculation.
 */

export interface MarketState {
  // Price data (normalized)
  prices: number[];           // Last N prices normalized
  returns: number[];          // Price returns
  volume: number[];           // Volume normalized
  
  // Technical indicators (normalized 0-1)
  rsi: number;
  macd: number;
  macdSignal: number;
  bbPosition: number;         // Position within Bollinger Bands
  atr: number;                // Normalized ATR
  
  // Order flow indicators
  volumeDelta: number;        // Buy vs sell volume
  orderImbalance: number;     // Order book imbalance
  
  // Position state
  hasPosition: boolean;
  positionSide: number;       // -1 short, 0 none, 1 long
  positionSize: number;       // Normalized position size
  unrealizedPnL: number;      // Normalized unrealized P&L
  holdingTime: number;        // Normalized time in position
  
  // Account state
  equity: number;             // Normalized equity
  drawdown: number;           // Current drawdown percentage
  
  // Market regime
  volatilityRegime: number;   // 0=low, 0.5=medium, 1=high
  trendStrength: number;      // -1 to 1
}

export interface Action {
  type: 'hold' | 'buy' | 'sell' | 'close';
  size?: number;              // Position size (0-1)
}

export interface StepResult {
  state: MarketState;
  reward: number;
  done: boolean;
  info: {
    pnl: number;
    tradeCount: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
}

export interface EnvironmentConfig {
  lookbackPeriod: number;     // Number of candles for state
  initialBalance: number;     // Starting balance
  maxPositionSize: number;    // Maximum position size
  transactionCost: number;    // Transaction cost percentage
  slippageModel: 'fixed' | 'proportional' | 'none';
  slippageBps: number;        // Slippage in basis points
  maxSteps: number;           // Maximum steps per episode
  rewardType: 'pnl' | 'sharpe' | 'sortino' | 'calmar';
  riskFreeRate: number;       // Annual risk-free rate
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  entryTime: number;
  exitTime?: number;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  size: number;
  pnl?: number;
  holdingTime?: number;
}

export class RLTradingEnvironment {
  private config: EnvironmentConfig;
  private candles: Candle[] = [];
  private currentStep: number = 0;
  private balance: number;
  private equity: number;
  private position: Trade | null = null;
  private trades: Trade[] = [];
  private equityHistory: number[] = [];
  private maxEquity: number;
  private totalPnL: number = 0;
  
  // State dimensions
  static readonly STATE_DIM = 25;
  static readonly ACTION_DIM = 4; // hold, buy, sell, close
  
  constructor(config: Partial<EnvironmentConfig> = {}) {
    this.config = {
      lookbackPeriod: 60,
      initialBalance: 10000,
      maxPositionSize: 0.1,
      transactionCost: 0.001,
      slippageModel: 'proportional',
      slippageBps: 5,
      maxSteps: 1000,
      rewardType: 'sharpe',
      riskFreeRate: 0.02,
      ...config
    };
    
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.maxEquity = this.config.initialBalance;
  }
  
  /**
   * Load historical candle data for training/backtesting
   */
  loadData(candles: Candle[]): void {
    this.candles = candles;
    console.log(`[RLEnvironment] Loaded ${candles.length} candles`);
  }
  
  /**
   * Reset environment to initial state
   */
  reset(startIndex?: number): MarketState {
    this.currentStep = startIndex ?? this.config.lookbackPeriod;
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.maxEquity = this.config.initialBalance;
    this.position = null;
    this.trades = [];
    this.equityHistory = [this.config.initialBalance];
    this.totalPnL = 0;
    
    return this.getState();
  }
  
  /**
   * Execute action and return new state, reward, done flag
   */
  step(action: Action): StepResult {
    const prevEquity = this.equity;
    
    // Execute action
    this.executeAction(action);
    
    // Update equity
    this.updateEquity();
    this.equityHistory.push(this.equity);
    
    // Calculate reward
    const reward = this.calculateReward(prevEquity);
    
    // Advance step
    this.currentStep++;
    
    // Check if episode is done
    const done = this.isDone();
    
    return {
      state: this.getState(),
      reward,
      done,
      info: this.getEpisodeInfo()
    };
  }
  
  /**
   * Get current state observation
   */
  getState(): MarketState {
    const lookback = this.config.lookbackPeriod;
    const startIdx = Math.max(0, this.currentStep - lookback);
    const endIdx = this.currentStep;
    
    const recentCandles = this.candles.slice(startIdx, endIdx);
    const currentCandle = this.candles[this.currentStep];
    
    // Normalize prices relative to current price
    const currentPrice = currentCandle?.close ?? 0;
    const prices = recentCandles.map(c => c.close / currentPrice - 1);
    
    // Calculate returns
    const returns = this.calculateReturns(recentCandles);
    
    // Normalize volume
    const avgVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length || 1;
    const volume = recentCandles.map(c => c.volume / avgVolume - 1);
    
    // Calculate technical indicators
    const rsi = this.calculateRSI(recentCandles);
    const { macd, signal } = this.calculateMACD(recentCandles);
    const bbPosition = this.calculateBBPosition(recentCandles);
    const atr = this.calculateATR(recentCandles) / currentPrice;
    
    // Order flow indicators (simplified)
    const volumeDelta = this.calculateVolumeDelta(recentCandles);
    const orderImbalance = this.calculateOrderImbalance(recentCandles);
    
    // Position state
    const hasPosition = this.position !== null;
    const positionSide = this.position ? (this.position.side === 'long' ? 1 : -1) : 0;
    const positionSize = this.position ? this.position.size / this.config.maxPositionSize : 0;
    const unrealizedPnL = this.calculateUnrealizedPnL() / this.config.initialBalance;
    const holdingTime = this.position 
      ? Math.min((this.currentStep - this.position.entryTime) / 100, 1)
      : 0;
    
    // Account state
    const equity = this.equity / this.config.initialBalance;
    const drawdown = (this.maxEquity - this.equity) / this.maxEquity;
    
    // Market regime
    const volatilityRegime = this.calculateVolatilityRegime(recentCandles);
    const trendStrength = this.calculateTrendStrength(recentCandles);
    
    return {
      prices: this.padArray(prices, lookback),
      returns: this.padArray(returns, lookback),
      volume: this.padArray(volume, lookback),
      rsi: rsi / 100,
      macd: Math.tanh(macd * 100),
      macdSignal: Math.tanh(signal * 100),
      bbPosition,
      atr,
      volumeDelta,
      orderImbalance,
      hasPosition,
      positionSide,
      positionSize,
      unrealizedPnL,
      holdingTime,
      equity,
      drawdown,
      volatilityRegime,
      trendStrength
    };
  }
  
  /**
   * Convert state to flat array for neural network input
   */
  stateToArray(state: MarketState): number[] {
    return [
      ...state.prices.slice(-10),    // Last 10 prices
      ...state.returns.slice(-10),   // Last 10 returns
      state.rsi,
      state.macd,
      state.macdSignal,
      state.bbPosition,
      state.atr,
      state.volumeDelta,
      state.orderImbalance,
      state.hasPosition ? 1 : 0,
      state.positionSide,
      state.positionSize,
      state.unrealizedPnL,
      state.holdingTime,
      state.equity,
      state.drawdown,
      state.volatilityRegime,
      state.trendStrength
    ];
  }
  
  /**
   * Execute trading action
   */
  private executeAction(action: Action): void {
    const currentCandle = this.candles[this.currentStep];
    if (!currentCandle) return;
    
    const price = this.applySlippage(currentCandle.close, action.type);
    
    switch (action.type) {
      case 'buy':
        if (!this.position) {
          const size = (action.size ?? 1) * this.config.maxPositionSize;
          const cost = price * size * (1 + this.config.transactionCost);
          
          if (cost <= this.balance) {
            this.position = {
              entryTime: this.currentStep,
              side: 'long',
              entryPrice: price,
              size
            };
            this.balance -= cost;
          }
        }
        break;
        
      case 'sell':
        if (!this.position) {
          const size = (action.size ?? 1) * this.config.maxPositionSize;
          this.position = {
            entryTime: this.currentStep,
            side: 'short',
            entryPrice: price,
            size
          };
          // For short, we receive the value upfront (simplified)
          this.balance += price * size * (1 - this.config.transactionCost);
        }
        break;
        
      case 'close':
        if (this.position) {
          this.closePosition(price);
        }
        break;
        
      case 'hold':
      default:
        // Do nothing
        break;
    }
  }
  
  /**
   * Close current position
   */
  private closePosition(price: number): void {
    if (!this.position) return;
    
    const pnl = this.calculatePositionPnL(price);
    const cost = price * this.position.size * this.config.transactionCost;
    
    this.position.exitTime = this.currentStep;
    this.position.exitPrice = price;
    this.position.pnl = pnl - cost;
    this.position.holdingTime = this.currentStep - this.position.entryTime;
    
    if (this.position.side === 'long') {
      this.balance += price * this.position.size - cost;
    } else {
      // For short, we need to buy back
      this.balance -= price * this.position.size + cost;
    }
    
    this.totalPnL += this.position.pnl;
    this.trades.push({ ...this.position });
    this.position = null;
  }
  
  /**
   * Calculate position P&L
   */
  private calculatePositionPnL(currentPrice: number): number {
    if (!this.position) return 0;
    
    if (this.position.side === 'long') {
      return (currentPrice - this.position.entryPrice) * this.position.size;
    } else {
      return (this.position.entryPrice - currentPrice) * this.position.size;
    }
  }
  
  /**
   * Calculate unrealized P&L
   */
  private calculateUnrealizedPnL(): number {
    if (!this.position) return 0;
    
    const currentCandle = this.candles[this.currentStep];
    if (!currentCandle) return 0;
    
    return this.calculatePositionPnL(currentCandle.close);
  }
  
  /**
   * Update equity value
   */
  private updateEquity(): void {
    this.equity = this.balance + this.calculateUnrealizedPnL();
    this.maxEquity = Math.max(this.maxEquity, this.equity);
  }
  
  /**
   * Calculate reward based on configured reward type
   */
  private calculateReward(prevEquity: number): number {
    const equityReturn = (this.equity - prevEquity) / prevEquity;
    
    switch (this.config.rewardType) {
      case 'pnl':
        return equityReturn * 100; // Scale for better learning
        
      case 'sharpe':
        return this.calculateStepSharpe(equityReturn);
        
      case 'sortino':
        return this.calculateStepSortino(equityReturn);
        
      case 'calmar':
        return this.calculateStepCalmar(equityReturn);
        
      default:
        return equityReturn * 100;
    }
  }
  
  /**
   * Calculate step-wise Sharpe contribution
   */
  private calculateStepSharpe(stepReturn: number): number {
    if (this.equityHistory.length < 2) return stepReturn * 100;
    
    const returns = this.calculateEquityReturns();
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    if (stdDev === 0) return stepReturn * 100;
    
    // Annualized Sharpe (assuming daily returns)
    const sharpe = (avgReturn - this.config.riskFreeRate / 252) / stdDev * Math.sqrt(252);
    
    // Reward is the contribution to Sharpe
    return sharpe * stepReturn * 100;
  }
  
  /**
   * Calculate step-wise Sortino contribution
   */
  private calculateStepSortino(stepReturn: number): number {
    if (this.equityHistory.length < 2) return stepReturn * 100;
    
    const returns = this.calculateEquityReturns();
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return stepReturn * 100;
    
    const downside = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    );
    
    if (downside === 0) return stepReturn * 100;
    
    const sortino = (avgReturn - this.config.riskFreeRate / 252) / downside * Math.sqrt(252);
    return sortino * stepReturn * 100;
  }
  
  /**
   * Calculate step-wise Calmar contribution
   */
  private calculateStepCalmar(stepReturn: number): number {
    const maxDrawdown = (this.maxEquity - this.equity) / this.maxEquity;
    
    if (maxDrawdown === 0) return stepReturn * 100;
    
    const returns = this.calculateEquityReturns();
    const totalReturn = returns.reduce((sum, r) => sum + r, 0);
    
    const calmar = totalReturn / maxDrawdown;
    return calmar * stepReturn * 10;
  }
  
  /**
   * Calculate equity returns
   */
  private calculateEquityReturns(): number[] {
    const returns: number[] = [];
    for (let i = 1; i < this.equityHistory.length; i++) {
      returns.push((this.equityHistory[i] - this.equityHistory[i - 1]) / this.equityHistory[i - 1]);
    }
    return returns;
  }
  
  /**
   * Check if episode is done
   */
  private isDone(): boolean {
    // Out of data
    if (this.currentStep >= this.candles.length - 1) return true;
    
    // Max steps reached
    if (this.currentStep >= this.config.maxSteps) return true;
    
    // Bankrupt (equity below 10% of initial)
    if (this.equity < this.config.initialBalance * 0.1) return true;
    
    return false;
  }
  
  /**
   * Get episode summary info
   */
  private getEpisodeInfo(): StepResult['info'] {
    const returns = this.calculateEquityReturns();
    const avgReturn = returns.length > 0 
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length 
      : 0;
    const stdDev = returns.length > 0
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 1;
    
    const winningTrades = this.trades.filter(t => (t.pnl ?? 0) > 0);
    
    return {
      pnl: this.totalPnL,
      tradeCount: this.trades.length,
      sharpeRatio: stdDev > 0 ? avgReturn / stdDev * Math.sqrt(252) : 0,
      maxDrawdown: (this.maxEquity - Math.min(...this.equityHistory)) / this.maxEquity,
      winRate: this.trades.length > 0 ? winningTrades.length / this.trades.length : 0
    };
  }
  
  /**
   * Apply slippage to price
   */
  private applySlippage(price: number, actionType: string): number {
    if (this.config.slippageModel === 'none') return price;
    
    const slippageFactor = this.config.slippageBps / 10000;
    
    if (actionType === 'buy') {
      return price * (1 + slippageFactor);
    } else if (actionType === 'sell' || actionType === 'close') {
      return price * (1 - slippageFactor);
    }
    
    return price;
  }
  
  // Technical indicator calculations
  private calculateReturns(candles: Candle[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
    return returns;
  }
  
  private calculateRSI(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    
    const changes = this.calculateReturns(candles.slice(-period - 1));
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    
    const avgGain = gains.length > 0 ? gains.reduce((sum, g) => sum + g, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / period : 0;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  private calculateMACD(candles: Candle[]): { macd: number; signal: number } {
    if (candles.length < 26) return { macd: 0, signal: 0 };
    
    const prices = candles.map(c => c.close);
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    // Simplified signal line
    const signal = macd * 0.9;
    
    return { macd: macd / prices[prices.length - 1], signal: signal / prices[prices.length - 1] };
  }
  
  private calculateEMA(prices: number[], period: number): number {
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  private calculateBBPosition(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0.5;
    
    const prices = candles.slice(-period).map(c => c.close);
    const sma = prices.reduce((sum, p) => sum + p, 0) / period;
    const stdDev = Math.sqrt(
      prices.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period
    );
    
    const currentPrice = candles[candles.length - 1].close;
    const upperBand = sma + 2 * stdDev;
    const lowerBand = sma - 2 * stdDev;
    
    if (upperBand === lowerBand) return 0.5;
    
    return Math.max(0, Math.min(1, (currentPrice - lowerBand) / (upperBand - lowerBand)));
  }
  
  private calculateATR(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 0;
    
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
    
    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }
  
  private calculateVolumeDelta(candles: Candle[]): number {
    if (candles.length < 2) return 0;
    
    // Simplified: positive return = buy volume, negative = sell volume
    let buyVolume = 0;
    let sellVolume = 0;
    
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1].close) {
        buyVolume += candles[i].volume;
      } else {
        sellVolume += candles[i].volume;
      }
    }
    
    const total = buyVolume + sellVolume;
    if (total === 0) return 0;
    
    return (buyVolume - sellVolume) / total;
  }
  
  private calculateOrderImbalance(candles: Candle[]): number {
    // Simplified order imbalance based on price action
    if (candles.length < 5) return 0;
    
    const recent = candles.slice(-5);
    let upMoves = 0;
    let downMoves = 0;
    
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].close > recent[i - 1].close) upMoves++;
      else downMoves++;
    }
    
    return (upMoves - downMoves) / 4;
  }
  
  private calculateVolatilityRegime(candles: Candle[]): number {
    if (candles.length < 20) return 0.5;
    
    const returns = this.calculateReturns(candles.slice(-20));
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length
    );
    
    // Normalize: 0-2% daily vol = 0-1
    return Math.min(1, volatility / 0.02);
  }
  
  private calculateTrendStrength(candles: Candle[]): number {
    if (candles.length < 20) return 0;
    
    const prices = candles.slice(-20).map(c => c.close);
    const sma = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const currentPrice = prices[prices.length - 1];
    
    // Normalized distance from SMA
    return Math.tanh((currentPrice - sma) / sma * 10);
  }
  
  private padArray(arr: number[], length: number): number[] {
    if (arr.length >= length) return arr.slice(-length);
    return [...new Array(length - arr.length).fill(0), ...arr];
  }
  
  /**
   * Get action space size
   */
  getActionSpace(): number {
    return RLTradingEnvironment.ACTION_DIM;
  }
  
  /**
   * Get state space size
   */
  getStateSpace(): number {
    return RLTradingEnvironment.STATE_DIM;
  }
  
  /**
   * Get current candle data
   */
  getCurrentCandle(): Candle | null {
    return this.candles[this.currentStep] ?? null;
  }
  
  /**
   * Get all trades from episode
   */
  getTrades(): Trade[] {
    return [...this.trades];
  }
  
  /**
   * Get equity history
   */
  getEquityHistory(): number[] {
    return [...this.equityHistory];
  }
}

export default RLTradingEnvironment;
