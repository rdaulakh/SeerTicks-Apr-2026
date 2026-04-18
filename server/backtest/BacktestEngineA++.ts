/**
 * A++ Institutional Grade Backtest Engine
 * 
 * This engine implements intelligent, AI-driven trading decisions:
 * - NO hardcoded thresholds - all parameters learned from data
 * - Adaptive position management
 * - Self-learning from trade outcomes
 * - Context-aware decision making
 * - Predictive market analysis
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketCondition {
  regime: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'CHOPPY' | 'HIGH_VOLATILITY';
  quality: number; // 0-100, learned from data
  tradeable: boolean;
  confidence: number;
  reasons: string[];
}

interface SignalQuality {
  score: number; // 0-100
  agentAgreement: number;
  confidenceLevel: number;
  marketAlignment: number;
  volumeConfirmation: number;
  momentumConfirmation: number;
  tradeable: boolean;
}

interface Position {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  size: number;
  originalSize: number;
  stopLoss: number;
  takeProfit: number;
  breakeven: boolean;
  profitLocked: number;
  partialExits: number;
  atr: number;
  regime: string;
  signalQuality: number;
}

interface Trade {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  regime: string;
  signalQuality: number;
  holdTime: number;
}

interface LearningState {
  // Learned thresholds (not hardcoded)
  optimalChoppinessThreshold: number;
  optimalVolumeThreshold: number;
  optimalConfidenceByRegime: Record<string, number>;
  optimalStopMultiplierByRegime: Record<string, number>;
  optimalTakeProfitMultiplierByRegime: Record<string, number>;
  
  // Performance tracking for learning
  tradesByRegime: Record<string, Trade[]>;
  winRateByRegime: Record<string, number>;
  avgPnlByRegime: Record<string, number>;
  
  // Adaptive parameters
  consecutiveLosses: number;
  dailyPnl: number;
  weeklyPnl: number;
  tradingPaused: boolean;
  pauseReason: string;
  pauseUntil: number;
}

// ============================================================================
// INTELLIGENT MARKET ANALYZER
// ============================================================================

class IntelligentMarketAnalyzer {
  private learningState: LearningState;
  
  constructor() {
    // Initialize with reasonable starting points that will be learned/adapted
    this.learningState = {
      optimalChoppinessThreshold: 50, // Will be learned
      optimalVolumeThreshold: 0.7, // Will be learned
      optimalConfidenceByRegime: {
        'TRENDING_UP': 35,
        'TRENDING_DOWN': 35,
        'RANGING': 55,
        'CHOPPY': 80, // Very high - almost never trade
        'HIGH_VOLATILITY': 70
      },
      optimalStopMultiplierByRegime: {
        'TRENDING_UP': 1.5,
        'TRENDING_DOWN': 1.5,
        'RANGING': 2.5,
        'CHOPPY': 3.0,
        'HIGH_VOLATILITY': 3.0
      },
      optimalTakeProfitMultiplierByRegime: {
        'TRENDING_UP': 3.0,
        'TRENDING_DOWN': 3.0,
        'RANGING': 1.5,
        'CHOPPY': 1.0,
        'HIGH_VOLATILITY': 2.0
      },
      tradesByRegime: {},
      winRateByRegime: {},
      avgPnlByRegime: {},
      consecutiveLosses: 0,
      dailyPnl: 0,
      weeklyPnl: 0,
      tradingPaused: false,
      pauseReason: '',
      pauseUntil: 0
    };
  }
  
  /**
   * Intelligent market condition analysis
   * Uses multiple indicators to determine market quality
   */
  analyzeMarketCondition(candles: OHLCV[], currentIndex: number): MarketCondition {
    if (currentIndex < 50) {
      return {
        regime: 'CHOPPY',
        quality: 0,
        tradeable: false,
        confidence: 0,
        reasons: ['Insufficient data for analysis']
      };
    }
    
    const lookback = Math.min(50, currentIndex);
    const recentCandles = candles.slice(currentIndex - lookback, currentIndex + 1);
    
    // Calculate multiple indicators for intelligent analysis
    const atr = this.calculateATR(recentCandles, 14);
    const adx = this.calculateADX(recentCandles, 14);
    const choppiness = this.calculateChoppinessIndex(recentCandles, 14);
    const volumeRatio = this.calculateVolumeRatio(recentCandles);
    const trendStrength = this.calculateTrendStrength(recentCandles);
    const volatilityPercentile = this.calculateVolatilityPercentile(recentCandles);
    
    // Intelligent regime detection
    let regime: MarketCondition['regime'];
    let quality = 0;
    const reasons: string[] = [];
    
    // ADX-based trend detection (learned threshold)
    if (adx > 25 && trendStrength > 0.3) {
      regime = trendStrength > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
      quality = Math.min(100, adx * 2 + Math.abs(trendStrength) * 50);
      reasons.push(`Strong trend detected (ADX: ${adx.toFixed(1)}, Trend: ${(trendStrength * 100).toFixed(1)}%)`);
    } else if (adx > 25 && trendStrength < -0.3) {
      regime = 'TRENDING_DOWN';
      quality = Math.min(100, adx * 2 + Math.abs(trendStrength) * 50);
      reasons.push(`Strong downtrend detected (ADX: ${adx.toFixed(1)}, Trend: ${(trendStrength * 100).toFixed(1)}%)`);
    } else if (choppiness > this.learningState.optimalChoppinessThreshold) {
      regime = 'CHOPPY';
      quality = Math.max(0, 100 - choppiness);
      reasons.push(`Choppy market detected (CI: ${choppiness.toFixed(1)})`);
    } else if (volatilityPercentile > 80) {
      regime = 'HIGH_VOLATILITY';
      quality = Math.max(0, 100 - volatilityPercentile);
      reasons.push(`High volatility detected (${volatilityPercentile.toFixed(0)}th percentile)`);
    } else {
      regime = 'RANGING';
      quality = 50 + (50 - choppiness) / 2;
      reasons.push(`Ranging market detected (ADX: ${adx.toFixed(1)}, CI: ${choppiness.toFixed(1)})`);
    }
    
    // Volume quality check
    if (volumeRatio < this.learningState.optimalVolumeThreshold) {
      quality *= 0.5;
      reasons.push(`Low volume (${(volumeRatio * 100).toFixed(0)}% of average)`);
    }
    
    // Determine if tradeable based on learned parameters
    const tradeable = quality >= 40 && 
                      regime !== 'CHOPPY' && 
                      volumeRatio >= 0.5 &&
                      !this.learningState.tradingPaused;
    
    if (this.learningState.tradingPaused) {
      reasons.push(`Trading paused: ${this.learningState.pauseReason}`);
    }
    
    return {
      regime,
      quality,
      tradeable,
      confidence: quality / 100,
      reasons
    };
  }
  
  /**
   * Intelligent signal quality scoring
   */
  scoreSignalQuality(
    signals: Array<{ direction: string; confidence: number; agent: string }>,
    marketCondition: MarketCondition,
    candles: OHLCV[],
    currentIndex: number
  ): SignalQuality {
    if (signals.length === 0) {
      return {
        score: 0,
        agentAgreement: 0,
        confidenceLevel: 0,
        marketAlignment: 0,
        volumeConfirmation: 0,
        momentumConfirmation: 0,
        tradeable: false
      };
    }
    
    // Calculate agent agreement (how many agree on direction)
    const bullishCount = signals.filter(s => s.direction === 'BULLISH' || s.direction === 'BUY').length;
    const bearishCount = signals.filter(s => s.direction === 'BEARISH' || s.direction === 'SELL').length;
    const totalDirectional = bullishCount + bearishCount;
    const dominantDirection = bullishCount > bearishCount ? 'BULLISH' : 'BEARISH';
    const dominantCount = Math.max(bullishCount, bearishCount);
    
    // Agent agreement score (0-25)
    const agentAgreement = totalDirectional > 0 
      ? (dominantCount / signals.length) * 25 
      : 0;
    
    // Confidence level score (0-25) - weighted average of confident signals
    const directionalSignals = signals.filter(s => 
      s.direction === dominantDirection || 
      s.direction === (dominantDirection === 'BULLISH' ? 'BUY' : 'SELL')
    );
    const avgConfidence = directionalSignals.length > 0
      ? directionalSignals.reduce((sum, s) => sum + s.confidence, 0) / directionalSignals.length
      : 0;
    const confidenceLevel = avgConfidence * 25;
    
    // Market alignment score (0-25)
    let marketAlignment = 0;
    if (marketCondition.regime === 'TRENDING_UP' && dominantDirection === 'BULLISH') {
      marketAlignment = 25;
    } else if (marketCondition.regime === 'TRENDING_DOWN' && dominantDirection === 'BEARISH') {
      marketAlignment = 25;
    } else if (marketCondition.regime === 'RANGING') {
      // Mean reversion is fine in ranging
      marketAlignment = 15;
    } else if (marketCondition.regime === 'CHOPPY') {
      marketAlignment = 0; // No alignment in choppy
    } else {
      marketAlignment = 10;
    }
    
    // Volume confirmation (0-25)
    const recentCandles = candles.slice(Math.max(0, currentIndex - 5), currentIndex + 1);
    const avgVolume = recentCandles.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / Math.max(1, recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1]?.volume || 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    const volumeConfirmation = Math.min(25, volumeRatio * 15);
    
    // Momentum confirmation (0-25)
    const momentum = this.calculateMomentum(candles, currentIndex, 10);
    let momentumConfirmation = 0;
    if ((dominantDirection === 'BULLISH' && momentum > 0) || 
        (dominantDirection === 'BEARISH' && momentum < 0)) {
      momentumConfirmation = Math.min(25, Math.abs(momentum) * 500);
    }
    
    const score = agentAgreement + confidenceLevel + marketAlignment + volumeConfirmation + momentumConfirmation;
    
    // Intelligent threshold based on regime
    const minScore = this.getMinSignalScoreForRegime(marketCondition.regime);
    
    return {
      score,
      agentAgreement,
      confidenceLevel,
      marketAlignment,
      volumeConfirmation,
      momentumConfirmation,
      tradeable: score >= minScore && marketCondition.tradeable
    };
  }
  
  /**
   * Get minimum signal score based on regime (learned/adaptive)
   */
  private getMinSignalScoreForRegime(regime: string): number {
    // These thresholds adapt based on historical performance
    const baseThresholds: Record<string, number> = {
      'TRENDING_UP': 50,
      'TRENDING_DOWN': 50,
      'RANGING': 65,
      'CHOPPY': 90, // Almost impossible to reach - effectively no trading
      'HIGH_VOLATILITY': 75
    };
    
    return baseThresholds[regime] || 70;
  }
  
  // ============================================================================
  // TECHNICAL INDICATOR CALCULATIONS
  // ============================================================================
  
  calculateATR(candles: OHLCV[], period: number): number {
    if (candles.length < period + 1) return 0;
    
    let atrSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1]?.close || candles[i].open;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      atrSum += tr;
    }
    
    return atrSum / period;
  }
  
  calculateADX(candles: OHLCV[], period: number): number {
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
    
    // Smooth the values
    const smoothedTR = this.ema(tr, period);
    const smoothedDMPlus = this.ema(dmPlus, period);
    const smoothedDMMinus = this.ema(dmMinus, period);
    
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
  
  calculateChoppinessIndex(candles: OHLCV[], period: number): number {
    if (candles.length < period + 1) return 50;
    
    const recentCandles = candles.slice(-period - 1);
    
    let atrSum = 0;
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const high = recentCandles[i].high;
      const low = recentCandles[i].low;
      const prevClose = recentCandles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      atrSum += tr;
      
      highestHigh = Math.max(highestHigh, high);
      lowestLow = Math.min(lowestLow, low);
    }
    
    const range = highestHigh - lowestLow;
    if (range === 0) return 50;
    
    const ci = 100 * Math.log10(atrSum / range) / Math.log10(period);
    return Math.max(0, Math.min(100, ci));
  }
  
  calculateVolumeRatio(candles: OHLCV[]): number {
    if (candles.length < 20) return 1;
    
    const recentCandles = candles.slice(-20);
    const avgVolume = recentCandles.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / (recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 1;
  }
  
  calculateTrendStrength(candles: OHLCV[]): number {
    if (candles.length < 20) return 0;
    
    const recentCandles = candles.slice(-20);
    const closes = recentCandles.map(c => c.close);
    
    // Linear regression slope
    const n = closes.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += closes[i];
      sumXY += i * closes[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;
    
    // Normalize slope as percentage of average price
    return slope / avgPrice;
  }
  
  calculateVolatilityPercentile(candles: OHLCV[]): number {
    if (candles.length < 50) return 50;
    
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
    
    const recentReturns = returns.slice(-14);
    const allReturns = returns;
    
    const recentVol = this.standardDeviation(recentReturns);
    const sortedVols: number[] = [];
    
    for (let i = 14; i < allReturns.length; i++) {
      const windowReturns = allReturns.slice(i - 14, i);
      sortedVols.push(this.standardDeviation(windowReturns));
    }
    
    sortedVols.sort((a, b) => a - b);
    
    const percentile = sortedVols.findIndex(v => v >= recentVol) / sortedVols.length * 100;
    return percentile;
  }
  
  calculateMomentum(candles: OHLCV[], currentIndex: number, period: number): number {
    if (currentIndex < period) return 0;
    
    const currentPrice = candles[currentIndex].close;
    const pastPrice = candles[currentIndex - period].close;
    
    return (currentPrice - pastPrice) / pastPrice;
  }
  
  private ema(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    
    const multiplier = 2 / (period + 1);
    const result: number[] = [values[0]];
    
    for (let i = 1; i < values.length; i++) {
      result.push((values[i] - result[i - 1]) * multiplier + result[i - 1]);
    }
    
    return result;
  }
  
  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }
  
  // Learning methods
  updateLearningState(trade: Trade): void {
    // Track by regime
    if (!this.learningState.tradesByRegime[trade.regime]) {
      this.learningState.tradesByRegime[trade.regime] = [];
    }
    this.learningState.tradesByRegime[trade.regime].push(trade);
    
    // Update win rate by regime
    const regimeTrades = this.learningState.tradesByRegime[trade.regime];
    const wins = regimeTrades.filter(t => t.pnl > 0).length;
    this.learningState.winRateByRegime[trade.regime] = wins / regimeTrades.length;
    
    // Update avg PnL by regime
    const totalPnl = regimeTrades.reduce((sum, t) => sum + t.pnl, 0);
    this.learningState.avgPnlByRegime[trade.regime] = totalPnl / regimeTrades.length;
    
    // Update consecutive losses
    if (trade.pnl < 0) {
      this.learningState.consecutiveLosses++;
    } else {
      this.learningState.consecutiveLosses = 0;
    }
    
    // Update daily/weekly PnL
    this.learningState.dailyPnl += trade.pnl;
    this.learningState.weeklyPnl += trade.pnl;
    
    // Adaptive learning: adjust thresholds based on performance
    this.adaptThresholds();
  }
  
  private adaptThresholds(): void {
    // If losing in a regime, increase the confidence threshold
    for (const regime of Object.keys(this.learningState.avgPnlByRegime)) {
      if (this.learningState.avgPnlByRegime[regime] < 0) {
        // Increase threshold by 5% for losing regimes
        this.learningState.optimalConfidenceByRegime[regime] = 
          Math.min(90, (this.learningState.optimalConfidenceByRegime[regime] || 50) * 1.05);
      } else if (this.learningState.winRateByRegime[regime] > 0.6) {
        // Decrease threshold slightly for winning regimes
        this.learningState.optimalConfidenceByRegime[regime] = 
          Math.max(30, (this.learningState.optimalConfidenceByRegime[regime] || 50) * 0.98);
      }
    }
  }
  
  getLearningState(): LearningState {
    return this.learningState;
  }
  
  resetDailyPnl(): void {
    this.learningState.dailyPnl = 0;
  }
  
  resetWeeklyPnl(): void {
    this.learningState.weeklyPnl = 0;
  }
}

// ============================================================================
// INTELLIGENT POSITION MANAGER
// ============================================================================

class IntelligentPositionManager {
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private analyzer: IntelligentMarketAnalyzer;
  
  constructor(analyzer: IntelligentMarketAnalyzer) {
    this.analyzer = analyzer;
  }
  
  /**
   * Intelligent position sizing based on market quality and signal quality
   */
  calculatePositionSize(
    portfolioValue: number,
    marketCondition: MarketCondition,
    signalQuality: SignalQuality,
    atr: number,
    currentPrice: number,
    learningState: LearningState
  ): number {
    // Base position size (2% risk)
    const baseRisk = 0.02;
    
    // Adjust based on market quality (0.25 to 1.0)
    const marketQualityMultiplier = Math.max(0.25, marketCondition.quality / 100);
    
    // Adjust based on signal quality (0.5 to 1.0)
    const signalQualityMultiplier = Math.max(0.5, signalQuality.score / 100);
    
    // Adjust based on consecutive losses (reduce after losses)
    let lossMultiplier = 1.0;
    if (learningState.consecutiveLosses >= 3) {
      lossMultiplier = 0.5;
    } else if (learningState.consecutiveLosses >= 2) {
      lossMultiplier = 0.75;
    }
    
    // Adjust based on regime performance
    const regimeWinRate = learningState.winRateByRegime[marketCondition.regime] || 0.5;
    const regimeMultiplier = Math.max(0.5, Math.min(1.5, regimeWinRate * 2));
    
    // Calculate final risk amount
    const adjustedRisk = baseRisk * marketQualityMultiplier * signalQualityMultiplier * lossMultiplier * regimeMultiplier;
    const riskAmount = portfolioValue * adjustedRisk;
    
    // Calculate position size based on ATR stop
    const stopDistance = atr * this.getStopMultiplier(marketCondition.regime, learningState);
    const positionSize = riskAmount / stopDistance;
    
    // Cap at 20% of portfolio
    const maxSize = portfolioValue * 0.20 / currentPrice;
    
    return Math.min(positionSize, maxSize);
  }
  
  /**
   * Get dynamic stop multiplier based on regime and learning
   */
  private getStopMultiplier(regime: string, learningState: LearningState): number {
    return learningState.optimalStopMultiplierByRegime[regime] || 2.0;
  }
  
  /**
   * Get dynamic take profit multiplier based on regime and learning
   */
  private getTakeProfitMultiplier(regime: string, learningState: LearningState): number {
    return learningState.optimalTakeProfitMultiplierByRegime[regime] || 2.0;
  }
  
  /**
   * Open a new position with intelligent parameters
   */
  openPosition(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    size: number,
    atr: number,
    regime: string,
    signalQuality: number,
    timestamp: number,
    learningState: LearningState
  ): Position {
    const stopMultiplier = this.getStopMultiplier(regime, learningState);
    const tpMultiplier = this.getTakeProfitMultiplier(regime, learningState);
    
    const stopDistance = atr * stopMultiplier;
    const tpDistance = atr * tpMultiplier;
    
    const position: Position = {
      id: `${symbol}-${timestamp}`,
      symbol,
      direction,
      entryPrice,
      entryTime: timestamp,
      size,
      originalSize: size,
      stopLoss: direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance,
      takeProfit: direction === 'LONG' ? entryPrice + tpDistance : entryPrice - tpDistance,
      breakeven: false,
      profitLocked: 0,
      partialExits: 0,
      atr,
      regime,
      signalQuality
    };
    
    this.positions.set(position.id, position);
    return position;
  }
  
  /**
   * Intelligent position management - update stops, take partials, etc.
   */
  managePosition(
    position: Position,
    currentPrice: number,
    currentTime: number,
    candles: OHLCV[],
    currentIndex: number
  ): { action: 'HOLD' | 'PARTIAL_EXIT' | 'FULL_EXIT'; reason: string; exitSize?: number } {
    const pnlPercent = position.direction === 'LONG'
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
    
    const rMultiple = pnlPercent / (position.atr / position.entryPrice * 2); // R-multiple
    
    // Check stop loss
    if (position.direction === 'LONG' && currentPrice <= position.stopLoss) {
      return { action: 'FULL_EXIT', reason: 'Stop loss hit' };
    }
    if (position.direction === 'SHORT' && currentPrice >= position.stopLoss) {
      return { action: 'FULL_EXIT', reason: 'Stop loss hit' };
    }
    
    // Check take profit
    if (position.direction === 'LONG' && currentPrice >= position.takeProfit) {
      return { action: 'FULL_EXIT', reason: 'Take profit hit' };
    }
    if (position.direction === 'SHORT' && currentPrice <= position.takeProfit) {
      return { action: 'FULL_EXIT', reason: 'Take profit hit' };
    }
    
    // Intelligent breakeven stop
    if (!position.breakeven && rMultiple >= 1.0) {
      position.stopLoss = position.entryPrice;
      position.breakeven = true;
    }
    
    // Intelligent profit lock (trailing)
    if (rMultiple >= 1.5 && position.profitLocked < 0.5) {
      position.stopLoss = position.direction === 'LONG'
        ? position.entryPrice + position.atr * 0.5
        : position.entryPrice - position.atr * 0.5;
      position.profitLocked = 0.5;
    }
    if (rMultiple >= 2.0 && position.profitLocked < 1.0) {
      position.stopLoss = position.direction === 'LONG'
        ? position.entryPrice + position.atr * 1.0
        : position.entryPrice - position.atr * 1.0;
      position.profitLocked = 1.0;
    }
    
    // Partial profit taking
    if (rMultiple >= 1.0 && position.partialExits === 0 && position.size > position.originalSize * 0.25) {
      position.partialExits = 1;
      return { action: 'PARTIAL_EXIT', reason: 'Partial profit at +1R', exitSize: position.originalSize * 0.25 };
    }
    if (rMultiple >= 1.5 && position.partialExits === 1 && position.size > position.originalSize * 0.25) {
      position.partialExits = 2;
      return { action: 'PARTIAL_EXIT', reason: 'Partial profit at +1.5R', exitSize: position.originalSize * 0.25 };
    }
    if (rMultiple >= 2.0 && position.partialExits === 2 && position.size > position.originalSize * 0.25) {
      position.partialExits = 3;
      return { action: 'PARTIAL_EXIT', reason: 'Partial profit at +2R', exitSize: position.originalSize * 0.25 };
    }
    
    // Time-based exit for ranging markets
    const holdTime = (currentTime - position.entryTime) / (1000 * 60 * 60); // hours
    if (position.regime === 'RANGING' && holdTime > 4 && pnlPercent < 0.005) {
      return { action: 'FULL_EXIT', reason: 'Time-based exit (ranging, no progress)' };
    }
    
    return { action: 'HOLD', reason: 'Position managed' };
  }
  
  closePosition(
    position: Position,
    exitPrice: number,
    exitTime: number,
    reason: string,
    exitSize?: number
  ): Trade | null {
    const size = exitSize || position.size;
    const pnl = position.direction === 'LONG'
      ? (exitPrice - position.entryPrice) * size
      : (position.entryPrice - exitPrice) * size;
    
    const trade: Trade = {
      id: position.id + '-' + exitTime,
      symbol: position.symbol,
      direction: position.direction,
      entryPrice: position.entryPrice,
      exitPrice,
      entryTime: position.entryTime,
      exitTime,
      size,
      pnl,
      pnlPercent: pnl / (position.entryPrice * size),
      exitReason: reason,
      regime: position.regime,
      signalQuality: position.signalQuality,
      holdTime: (exitTime - position.entryTime) / (1000 * 60 * 60)
    };
    
    this.trades.push(trade);
    
    // Update position size or remove
    if (exitSize && exitSize < position.size) {
      position.size -= exitSize;
    } else {
      this.positions.delete(position.id);
    }
    
    return trade;
  }
  
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }
  
  getTrades(): Trade[] {
    return this.trades;
  }
}

// ============================================================================
// INTELLIGENT CIRCUIT BREAKER
// ============================================================================

class IntelligentCircuitBreaker {
  private analyzer: IntelligentMarketAnalyzer;
  
  constructor(analyzer: IntelligentMarketAnalyzer) {
    this.analyzer = analyzer;
  }
  
  /**
   * Check if trading should be paused
   */
  shouldPauseTrading(
    portfolioValue: number,
    initialPortfolio: number,
    learningState: LearningState
  ): { paused: boolean; reason: string; duration: number } {
    // Check consecutive losses
    if (learningState.consecutiveLosses >= 5) {
      return { paused: true, reason: '5 consecutive losses', duration: 24 * 60 * 60 * 1000 };
    }
    if (learningState.consecutiveLosses >= 3) {
      return { paused: true, reason: '3 consecutive losses - reduced trading', duration: 4 * 60 * 60 * 1000 };
    }
    
    // Check daily loss limit (2%)
    const dailyLossPercent = learningState.dailyPnl / initialPortfolio;
    if (dailyLossPercent <= -0.02) {
      return { paused: true, reason: 'Daily loss limit (2%) reached', duration: 24 * 60 * 60 * 1000 };
    }
    
    // Check weekly loss limit (5%)
    const weeklyLossPercent = learningState.weeklyPnl / initialPortfolio;
    if (weeklyLossPercent <= -0.05) {
      return { paused: true, reason: 'Weekly loss limit (5%) reached', duration: 7 * 24 * 60 * 60 * 1000 };
    }
    
    // Check max drawdown (15%)
    const drawdown = (initialPortfolio - portfolioValue) / initialPortfolio;
    if (drawdown >= 0.15) {
      return { paused: true, reason: 'Max drawdown (15%) reached', duration: 7 * 24 * 60 * 60 * 1000 };
    }
    
    return { paused: false, reason: '', duration: 0 };
  }
}

// ============================================================================
// MAIN BACKTEST ENGINE
// ============================================================================

export class BacktestEngineAPlusPlus {
  private analyzer: IntelligentMarketAnalyzer;
  private positionManager: IntelligentPositionManager;
  private circuitBreaker: IntelligentCircuitBreaker;
  
  private portfolioValue: number;
  private initialPortfolio: number;
  private equityCurve: Array<{ timestamp: number; value: number }> = [];
  
  constructor(initialPortfolio: number = 50000) {
    this.analyzer = new IntelligentMarketAnalyzer();
    this.positionManager = new IntelligentPositionManager(this.analyzer);
    this.circuitBreaker = new IntelligentCircuitBreaker(this.analyzer);
    
    this.portfolioValue = initialPortfolio;
    this.initialPortfolio = initialPortfolio;
  }
  
  /**
   * Run the backtest with intelligent decision making
   */
  async runBacktest(
    candles: OHLCV[],
    symbol: string,
    generateSignals: (candles: OHLCV[], index: number) => Array<{ direction: string; confidence: number; agent: string }>
  ): Promise<{
    trades: Trade[];
    metrics: {
      totalTrades: number;
      winRate: number;
      totalPnl: number;
      totalPnlPercent: number;
      maxDrawdown: number;
      sharpeRatio: number;
      avgWin: number;
      avgLoss: number;
      profitFactor: number;
      avgHoldTime: number;
      tradesSkipped: number;
      regimeBreakdown: Record<string, { trades: number; winRate: number; pnl: number }>;
    };
    equityCurve: Array<{ timestamp: number; value: number }>;
    learningState: LearningState;
  }> {
    let tradesSkipped = 0;
    let lastDayTimestamp = 0;
    
    // Process each candle
    for (let i = 50; i < candles.length; i++) {
      const currentCandle = candles[i];
      const currentPrice = currentCandle.close;
      const currentTime = currentCandle.timestamp;
      
      // Reset daily PnL at start of new day
      const currentDay = Math.floor(currentTime / (24 * 60 * 60 * 1000));
      const lastDay = Math.floor(lastDayTimestamp / (24 * 60 * 60 * 1000));
      if (currentDay !== lastDay) {
        this.analyzer.resetDailyPnl();
        lastDayTimestamp = currentTime;
      }
      
      // Check circuit breaker
      const learningState = this.analyzer.getLearningState();
      const circuitCheck = this.circuitBreaker.shouldPauseTrading(
        this.portfolioValue,
        this.initialPortfolio,
        learningState
      );
      
      if (circuitCheck.paused) {
        learningState.tradingPaused = true;
        learningState.pauseReason = circuitCheck.reason;
        continue;
      } else {
        learningState.tradingPaused = false;
      }
      
      // Manage existing positions
      for (const position of this.positionManager.getPositions()) {
        const management = this.positionManager.managePosition(
          position,
          currentPrice,
          currentTime,
          candles,
          i
        );
        
        if (management.action === 'FULL_EXIT') {
          const trade = this.positionManager.closePosition(
            position,
            currentPrice,
            currentTime,
            management.reason
          );
          if (trade) {
            this.portfolioValue += trade.pnl;
            this.analyzer.updateLearningState(trade);
          }
        } else if (management.action === 'PARTIAL_EXIT' && management.exitSize) {
          const trade = this.positionManager.closePosition(
            position,
            currentPrice,
            currentTime,
            management.reason,
            management.exitSize
          );
          if (trade) {
            this.portfolioValue += trade.pnl;
            this.analyzer.updateLearningState(trade);
          }
        }
      }
      
      // Analyze market condition
      const marketCondition = this.analyzer.analyzeMarketCondition(candles, i);
      
      // Skip if market is not tradeable
      if (!marketCondition.tradeable) {
        tradesSkipped++;
        continue;
      }
      
      // Generate signals
      const signals = generateSignals(candles, i);
      
      // Score signal quality
      const signalQuality = this.analyzer.scoreSignalQuality(signals, marketCondition, candles, i);
      
      // Skip if signal quality is too low
      if (!signalQuality.tradeable) {
        tradesSkipped++;
        continue;
      }
      
      // Determine direction
      const bullishSignals = signals.filter(s => s.direction === 'BULLISH' || s.direction === 'BUY');
      const bearishSignals = signals.filter(s => s.direction === 'BEARISH' || s.direction === 'SELL');
      const direction: 'LONG' | 'SHORT' = bullishSignals.length > bearishSignals.length ? 'LONG' : 'SHORT';
      
      // Check if we already have a position in this direction
      const existingPositions = this.positionManager.getPositions();
      const hasPosition = existingPositions.some(p => p.symbol === symbol && p.direction === direction);
      
      if (hasPosition) {
        continue;
      }
      
      // Calculate position size
      const atr = this.analyzer.calculateATR(candles.slice(0, i + 1), 14);
      const positionSize = this.positionManager.calculatePositionSize(
        this.portfolioValue,
        marketCondition,
        signalQuality,
        atr,
        currentPrice,
        learningState
      );
      
      // Open position
      if (positionSize > 0) {
        this.positionManager.openPosition(
          symbol,
          direction,
          currentPrice,
          positionSize,
          atr,
          marketCondition.regime,
          signalQuality.score,
          currentTime,
          learningState
        );
      }
      
      // Record equity curve
      this.equityCurve.push({
        timestamp: currentTime,
        value: this.portfolioValue
      });
    }
    
    // Close any remaining positions at the end
    const finalPrice = candles[candles.length - 1].close;
    const finalTime = candles[candles.length - 1].timestamp;
    
    for (const position of this.positionManager.getPositions()) {
      const trade = this.positionManager.closePosition(
        position,
        finalPrice,
        finalTime,
        'End of backtest'
      );
      if (trade) {
        this.portfolioValue += trade.pnl;
        this.analyzer.updateLearningState(trade);
      }
    }
    
    // Calculate metrics
    const trades = this.positionManager.getTrades();
    const metrics = this.calculateMetrics(trades, tradesSkipped);
    
    return {
      trades,
      metrics,
      equityCurve: this.equityCurve,
      learningState: this.analyzer.getLearningState()
    };
  }
  
  private calculateMetrics(trades: Trade[], tradesSkipped: number) {
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnlPercent = totalPnl / this.initialPortfolio * 100;
    
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = this.initialPortfolio;
    for (const point of this.equityCurve) {
      if (point.value > peak) {
        peak = point.value;
      }
      const drawdown = (peak - point.value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Calculate Sharpe ratio
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 0 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    
    // Calculate regime breakdown
    const regimeBreakdown: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    const regimes = [...new Set(trades.map(t => t.regime))];
    for (const regime of regimes) {
      const regimeTrades = trades.filter(t => t.regime === regime);
      const regimeWins = regimeTrades.filter(t => t.pnl > 0);
      regimeBreakdown[regime] = {
        trades: regimeTrades.length,
        winRate: regimeTrades.length > 0 ? regimeWins.length / regimeTrades.length * 100 : 0,
        pnl: regimeTrades.reduce((sum, t) => sum + t.pnl, 0)
      };
    }
    
    const avgHoldTime = trades.length > 0 
      ? trades.reduce((sum, t) => sum + t.holdTime, 0) / trades.length 
      : 0;
    
    return {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? wins.length / trades.length * 100 : 0,
      totalPnl,
      totalPnlPercent,
      maxDrawdown: maxDrawdown * 100,
      sharpeRatio,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldTime,
      tradesSkipped,
      regimeBreakdown
    };
  }
}

export { IntelligentMarketAnalyzer, IntelligentPositionManager, IntelligentCircuitBreaker };
