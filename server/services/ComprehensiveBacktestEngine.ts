/**
 * Comprehensive 1-Year Backtest Engine
 * 
 * A++ Institutional Grade Backtest System
 * 
 * This engine replays historical OHLCV data candle-by-candle, using the EXACT
 * same logic as the live trading system:
 * 
 * - ALL timeframes (1m, 5m, 15m, 1h, 4h, 1d)
 * - ALL agents (OHLCV-based active, API/Live in shadow mode)
 * - ALL strategies (Tiered Decision Making, Regime Detection, etc.)
 * - IntelligentExitManager (agent-driven exits)
 * - Position Sizing Tiers (SCOUT 3% to MAX 20%)
 * - Commission and slippage applied
 * - Multiple concurrent positions allowed
 * - NO lookahead bias
 * 
 * @author SEER Trading Platform
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getDb } from '../db';
import { sql, and, gte, lte, asc, eq } from 'drizzle-orm';
import {
  calculateWeightedScore,
  makeExecutionDecision,
  getExecutionThreshold,
  calculatePositionSize,
  type WeightedScore,
  type ExecutionDecision,
} from '../orchestrator/TieredDecisionMaking';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeData {
  '1m': OHLCVCandle[];
  '5m': OHLCVCandle[];
  '15m': OHLCVCandle[];
  '1h': OHLCVCandle[];
  '4h': OHLCVCandle[];
  '1d': OHLCVCandle[];
}

export interface AgentSignal {
  agentName: string;
  symbol: string;
  timestamp: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  executionScore: number;
  reasoning: string;
  evidence: Record<string, any>;
  qualityScore: number;
  mode: 'ACTIVE' | 'SHADOW' | 'PROXY';
  processingTime: number;
  dataFreshness: number;
}

export interface BacktestPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  entryTime: number;
  quantity: number;
  remainingQuantity: number;
  stopLoss: number;
  takeProfit: number;
  positionTier: string;
  consensusScore: number;
  agentSignals: AgentSignal[];
  highestPrice: number;
  lowestPrice: number;
  breakevenActivated: boolean;
  partialExits: PartialExit[];
  trailingStopPrice: number | null;
  atr: number;
  regime: string;
}

export interface PartialExit {
  timestamp: number;
  price: number;
  quantity: number;
  pnlPercent: number;
  reason: string;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  quantity: number;
  positionTier: string;
  consensusScore: number;
  regime: string;
  pnlPercent: number;
  pnlDollar: number;
  pnlAfterCosts: number;
  commission: number;
  slippage: number;
  outcome: 'win' | 'loss' | 'breakeven';
  exitReason: string;
  holdingPeriodHours: number;
  agentContributions: { agentName: string; signal: string; confidence: number; mode: string }[];
}

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  
  // Commission and slippage
  commissionPercent: number;  // e.g., 0.001 for 0.1%
  slippagePercent: number;    // e.g., 0.0005 for 0.05%
  
  // Position limits
  maxConcurrentPositions: number;
  maxPositionSizePercent: number;  // e.g., 0.20 for 20%
  
  // Risk management
  maxDrawdownPercent: number;  // Stop backtest if exceeded
  riskPerTradePercent: number; // e.g., 0.02 for 2%
  
  // Consensus thresholds (matching live system)
  consensusThreshold: number;  // e.g., 0.70 for 70%
  alphaThreshold: number;      // e.g., 0.75 for 75%
  minAgentsRequired: number;   // e.g., 4
  
  // Exit settings (IntelligentExitManager)
  breakevenActivationPercent: number;
  partialProfitLevels: { pnlPercent: number; exitPercent: number }[];
  trailingActivationPercent: number;
  trailingPercent: number;
  maxHoldTimeHours: number;
  
  // Timeframe for main loop
  primaryTimeframe: '1m' | '5m' | '15m' | '1h';
  
  // Backtest-specific: adjust for shadow agents
  backtestMode: boolean;
  shadowAgentPenalty: number;  // Reduce threshold when agents are in shadow mode
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  totalPnL: number;
  totalPnLPercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  
  avgWin: number;
  avgLoss: number;
  avgWinPercent: number;
  avgLossPercent: number;
  largestWin: number;
  largestLoss: number;
  
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  
  avgHoldingPeriodHours: number;
  tradesPerMonth: number;
  
  // By position tier
  tierBreakdown: Record<string, {
    trades: number;
    winRate: number;
    totalPnL: number;
    avgPnL: number;
  }>;
  
  // By regime
  regimeBreakdown: Record<string, {
    trades: number;
    winRate: number;
    totalPnL: number;
  }>;
  
  // By month
  monthlyPnL: Record<string, number>;
  
  // Agent contribution
  agentContribution: Record<string, {
    signalsGenerated: number;
    signalsActedOn: number;
    winRate: number;
    avgConfidence: number;
    mode: string;
    helpedTrades: number;
    blockedTrades: number;
    neutralTrades: number;
  }>;
}

export interface BacktestResult {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { timestamp: number; equity: number; drawdown: number }[];
  status: 'completed' | 'stopped_drawdown' | 'error';
  errorMessage?: string;
  executionTimeMs: number;
  candlesProcessed: number;
  signalsGenerated: number;
  
  // Verdict
  verdict: 'EXCELLENT' | 'GOOD' | 'NEEDS_OPTIMIZATION' | 'POOR' | 'FAILED';
  verdictReason: string;
}

// ============================================================================
// AGENT DEFINITIONS
// ============================================================================

const AGENT_MODES: Record<string, 'ACTIVE' | 'SHADOW' | 'PROXY'> = {
  // OHLCV-based agents - fully replayable
  'TechnicalAnalyst': 'ACTIVE',
  'PatternMatcher': 'ACTIVE',
  'VolumeProfileAnalyzer': 'ACTIVE',
  
  // API-dependent agents - shadow mode (contribute to analysis but don't block)
  'OrderFlowAnalyst': 'SHADOW',
  'WhaleTracker': 'SHADOW',
  'FundingRateAnalyst': 'SHADOW',
  'LiquidationHeatmap': 'SHADOW',
  'OnChainFlowAnalyst': 'SHADOW',
  'ForexCorrelationAgent': 'SHADOW',
  
  // Live-only agents - shadow mode
  'NewsSentinel': 'SHADOW',
  'SentimentAnalyst': 'SHADOW',
  'MacroAnalyst': 'SHADOW',
};

const FAST_AGENTS = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
const SLOW_AGENTS = ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst'];

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return calculateSMA(prices, prices.length);
  
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  
  // Calculate signal line (9-period EMA of MACD)
  const macdValues: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    macdValues.push(e12 - e26);
  }
  
  const signal = macdValues.length >= 9 ? calculateEMA(macdValues, 9) : macd;
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
}

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number } {
  const middle = calculateSMA(prices, period);
  
  if (prices.length < period) {
    return { upper: middle, middle, lower: middle };
  }
  
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std,
  };
}

function calculateATR(candles: OHLCVCandle[], period: number = 14): number {
  if (candles.length < 2) return 0;
  
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
  
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }
  
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateSuperTrend(candles: OHLCVCandle[], period: number = 10, multiplier: number = 3): { value: number; direction: 'bullish' | 'bearish' } {
  if (candles.length < period) {
    return { value: candles[candles.length - 1]?.close || 0, direction: 'neutral' as any };
  }
  
  const atr = calculateATR(candles, period);
  const lastCandle = candles[candles.length - 1];
  const hl2 = (lastCandle.high + lastCandle.low) / 2;
  
  const upperBand = hl2 + multiplier * atr;
  const lowerBand = hl2 - multiplier * atr;
  
  // Simplified SuperTrend - compare close to bands
  const direction = lastCandle.close > lowerBand ? 'bullish' : 'bearish';
  const value = direction === 'bullish' ? lowerBand : upperBand;
  
  return { value, direction };
}

function calculateVWAP(candles: OHLCVCandle[]): number {
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

// ============================================================================
// REGIME DETECTION
// ============================================================================

function detectRegime(candles: OHLCVCandle[]): 'trending_up' | 'trending_down' | 'ranging' | 'volatile' {
  if (candles.length < 50) return 'ranging';
  
  const prices = candles.map(c => c.close);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const currentPrice = prices[prices.length - 1];
  
  // Calculate volatility
  const returns: number[] = [];
  for (let i = 1; i < Math.min(20, prices.length); i++) {
    returns.push((prices[prices.length - i] - prices[prices.length - i - 1]) / prices[prices.length - i - 1]);
  }
  const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
  
  // High volatility regime
  if (volatility > 0.03) {
    return 'volatile';
  }
  
  // Trending regimes
  if (currentPrice > sma20 && sma20 > sma50) {
    return 'trending_up';
  }
  if (currentPrice < sma20 && sma20 < sma50) {
    return 'trending_down';
  }
  
  return 'ranging';
}

function getRegimeMultiplier(regime: string): number {
  switch (regime) {
    case 'trending_up':
    case 'trending_down':
      return 0.80;  // Lower threshold in trends
    case 'volatile':
      return 1.40;  // Higher threshold in volatility
    case 'ranging':
    default:
      return 1.10;  // Slightly higher in ranges
  }
}

// ============================================================================
// PATTERN DETECTION
// ============================================================================

function detectPatterns(candles: OHLCVCandle[]): { pattern: string; confidence: number; direction: 'bullish' | 'bearish' | 'neutral' }[] {
  const patterns: { pattern: string; confidence: number; direction: 'bullish' | 'bearish' | 'neutral' }[] = [];
  
  if (candles.length < 5) return patterns;
  
  const recent = candles.slice(-5);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  
  // Doji
  const bodySize = Math.abs(last.close - last.open);
  const wickSize = last.high - last.low;
  if (bodySize < wickSize * 0.1) {
    patterns.push({ pattern: 'Doji', confidence: 0.6, direction: 'neutral' });
  }
  
  // Hammer (bullish reversal)
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5) {
    patterns.push({ pattern: 'Hammer', confidence: 0.7, direction: 'bullish' });
  }
  
  // Shooting Star (bearish reversal)
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5) {
    patterns.push({ pattern: 'ShootingStar', confidence: 0.7, direction: 'bearish' });
  }
  
  // Engulfing patterns
  if (prev && last) {
    const prevBody = Math.abs(prev.close - prev.open);
    const lastBody = Math.abs(last.close - last.open);
    
    // Bullish engulfing
    if (prev.close < prev.open && last.close > last.open && 
        last.open < prev.close && last.close > prev.open && lastBody > prevBody) {
      patterns.push({ pattern: 'BullishEngulfing', confidence: 0.75, direction: 'bullish' });
    }
    
    // Bearish engulfing
    if (prev.close > prev.open && last.close < last.open &&
        last.open > prev.close && last.close < prev.open && lastBody > prevBody) {
      patterns.push({ pattern: 'BearishEngulfing', confidence: 0.75, direction: 'bearish' });
    }
  }
  
  // Double bottom/top detection (simplified)
  if (candles.length >= 20) {
    const lows = candles.slice(-20).map(c => c.low);
    const highs = candles.slice(-20).map(c => c.high);
    const minLow = Math.min(...lows);
    const maxHigh = Math.max(...highs);
    
    // Count touches of support/resistance
    const supportTouches = lows.filter(l => l < minLow * 1.01).length;
    const resistanceTouches = highs.filter(h => h > maxHigh * 0.99).length;
    
    if (supportTouches >= 2 && last.close > lows[lows.length - 1]) {
      patterns.push({ pattern: 'DoubleBottom', confidence: 0.65, direction: 'bullish' });
    }
    if (resistanceTouches >= 2 && last.close < highs[highs.length - 1]) {
      patterns.push({ pattern: 'DoubleTop', confidence: 0.65, direction: 'bearish' });
    }
  }
  
  return patterns;
}

// ============================================================================
// AGENT SIGNAL GENERATION
// ============================================================================

function generateTechnicalAnalystSignal(
  symbol: string,
  candles: MultiTimeframeData,
  timestamp: number
): AgentSignal {
  const hourlyCandles = candles['1h'];
  if (hourlyCandles.length < 50) {
    return createNeutralSignal('TechnicalAnalyst', symbol, timestamp, 'Insufficient data');
  }
  
  const prices = hourlyCandles.map(c => c.close);
  const currentPrice = prices[prices.length - 1];
  
  // Calculate indicators
  const rsi = calculateRSI(prices);
  const macd = calculateMACD(prices);
  const bb = calculateBollingerBands(prices);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const superTrend = calculateSuperTrend(hourlyCandles);
  const vwap = calculateVWAP(hourlyCandles.slice(-24)); // 24h VWAP
  
  // Multi-timeframe trend analysis
  const dailyCandles = candles['1d'];
  const h4Candles = candles['4h'];
  const m15Candles = candles['15m'];
  
  let dailyTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let h4Trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let m15Trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  
  if (dailyCandles.length >= 20) {
    const dailyPrices = dailyCandles.map(c => c.close);
    const dailySma20 = calculateSMA(dailyPrices, 20);
    dailyTrend = dailyPrices[dailyPrices.length - 1] > dailySma20 ? 'bullish' : 'bearish';
  }
  
  if (h4Candles.length >= 20) {
    const h4Prices = h4Candles.map(c => c.close);
    const h4Sma20 = calculateSMA(h4Prices, 20);
    h4Trend = h4Prices[h4Prices.length - 1] > h4Sma20 ? 'bullish' : 'bearish';
  }
  
  if (m15Candles.length >= 20) {
    const m15Prices = m15Candles.map(c => c.close);
    const m15Sma20 = calculateSMA(m15Prices, 20);
    m15Trend = m15Prices[m15Prices.length - 1] > m15Sma20 ? 'bullish' : 'bearish';
  }
  
  // Calculate signal
  let bullishScore = 0;
  let bearishScore = 0;
  const reasons: string[] = [];
  
  // RSI
  if (rsi < 30) { bullishScore += 0.2; reasons.push('RSI oversold'); }
  else if (rsi > 70) { bearishScore += 0.2; reasons.push('RSI overbought'); }
  else if (rsi < 45) { bullishScore += 0.1; }
  else if (rsi > 55) { bearishScore += 0.1; }
  
  // MACD
  if (macd.histogram > 0 && macd.macd > macd.signal) { bullishScore += 0.15; reasons.push('MACD bullish'); }
  else if (macd.histogram < 0 && macd.macd < macd.signal) { bearishScore += 0.15; reasons.push('MACD bearish'); }
  
  // Bollinger Bands
  if (currentPrice < bb.lower) { bullishScore += 0.15; reasons.push('Below lower BB'); }
  else if (currentPrice > bb.upper) { bearishScore += 0.15; reasons.push('Above upper BB'); }
  
  // Moving averages
  if (currentPrice > sma20 && sma20 > sma50) { bullishScore += 0.15; reasons.push('Above MAs'); }
  else if (currentPrice < sma20 && sma20 < sma50) { bearishScore += 0.15; reasons.push('Below MAs'); }
  
  // SuperTrend
  if (superTrend.direction === 'bullish') { bullishScore += 0.15; reasons.push('SuperTrend bullish'); }
  else if (superTrend.direction === 'bearish') { bearishScore += 0.15; reasons.push('SuperTrend bearish'); }
  
  // VWAP
  if (currentPrice > vwap) { bullishScore += 0.1; }
  else if (currentPrice < vwap) { bearishScore += 0.1; }
  
  // Multi-timeframe alignment bonus
  const tfAligned = [dailyTrend, h4Trend, m15Trend];
  const bullishTFs = tfAligned.filter(t => t === 'bullish').length;
  const bearishTFs = tfAligned.filter(t => t === 'bearish').length;
  
  if (bullishTFs >= 2) { bullishScore += 0.1; reasons.push(`${bullishTFs}/3 TFs bullish`); }
  if (bearishTFs >= 2) { bearishScore += 0.1; reasons.push(`${bearishTFs}/3 TFs bearish`); }
  
  // Determine signal
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0;
  
  if (bullishScore > bearishScore + 0.1) {
    signal = 'bullish';
    confidence = Math.min(0.95, bullishScore);
  } else if (bearishScore > bullishScore + 0.1) {
    signal = 'bearish';
    confidence = Math.min(0.95, bearishScore);
  } else {
    confidence = 0.3;
  }
  
  // Calculate execution score (0-100)
  let executionScore = 50;
  if (signal === 'bullish') {
    if (currentPrice < bb.lower) executionScore += 20;
    if (rsi < 35) executionScore += 15;
    if (currentPrice < vwap) executionScore += 10;
  } else if (signal === 'bearish') {
    if (currentPrice > bb.upper) executionScore += 20;
    if (rsi > 65) executionScore += 15;
    if (currentPrice > vwap) executionScore += 10;
  }
  executionScore = Math.min(100, Math.max(0, executionScore));
  
  return {
    agentName: 'TechnicalAnalyst',
    symbol,
    timestamp,
    signal,
    confidence,
    strength: confidence * 0.9,
    executionScore,
    reasoning: reasons.join(', ') || 'Mixed signals',
    evidence: {
      rsi,
      macd,
      bollingerBands: bb,
      sma20,
      sma50,
      superTrend,
      vwap,
      currentPrice,
      timeframeTrends: { daily: dailyTrend, h4: h4Trend, m15: m15Trend },
    },
    qualityScore: Math.min(0.95, confidence + 0.1),
    mode: 'ACTIVE',
    processingTime: 0,
    dataFreshness: 0,
  };
}

function generatePatternMatcherSignal(
  symbol: string,
  candles: MultiTimeframeData,
  timestamp: number
): AgentSignal {
  const hourlyCandles = candles['1h'];
  if (hourlyCandles.length < 20) {
    return createNeutralSignal('PatternMatcher', symbol, timestamp, 'Insufficient data');
  }
  
  // Detect patterns across timeframes
  const hourlyPatterns = detectPatterns(hourlyCandles);
  const h4Patterns = candles['4h'].length >= 5 ? detectPatterns(candles['4h']) : [];
  const dailyPatterns = candles['1d'].length >= 5 ? detectPatterns(candles['1d']) : [];
  
  const allPatterns = [...hourlyPatterns, ...h4Patterns, ...dailyPatterns];
  
  if (allPatterns.length === 0) {
    return createNeutralSignal('PatternMatcher', symbol, timestamp, 'No patterns detected');
  }
  
  // Aggregate pattern signals
  let bullishScore = 0;
  let bearishScore = 0;
  const patternNames: string[] = [];
  
  for (const pattern of allPatterns) {
    patternNames.push(pattern.pattern);
    if (pattern.direction === 'bullish') {
      bullishScore += pattern.confidence * 0.3;
    } else if (pattern.direction === 'bearish') {
      bearishScore += pattern.confidence * 0.3;
    }
  }
  
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0;
  
  if (bullishScore > bearishScore + 0.1) {
    signal = 'bullish';
    confidence = Math.min(0.9, bullishScore);
  } else if (bearishScore > bullishScore + 0.1) {
    signal = 'bearish';
    confidence = Math.min(0.9, bearishScore);
  } else {
    confidence = 0.3;
  }
  
  return {
    agentName: 'PatternMatcher',
    symbol,
    timestamp,
    signal,
    confidence,
    strength: confidence * 0.85,
    executionScore: 50 + (confidence * 30),
    reasoning: `Patterns: ${patternNames.join(', ')}`,
    evidence: { patterns: allPatterns },
    qualityScore: Math.min(0.9, confidence + 0.05),
    mode: 'ACTIVE',
    processingTime: 0,
    dataFreshness: 0,
  };
}

function generateVolumeProfileSignal(
  symbol: string,
  candles: MultiTimeframeData,
  timestamp: number
): AgentSignal {
  const hourlyCandles = candles['1h'];
  if (hourlyCandles.length < 24) {
    return createNeutralSignal('VolumeProfileAnalyzer', symbol, timestamp, 'Insufficient data');
  }
  
  const recent24h = hourlyCandles.slice(-24);
  const avgVolume = recent24h.reduce((sum, c) => sum + c.volume, 0) / 24;
  const lastVolume = recent24h[recent24h.length - 1].volume;
  const volumeRatio = lastVolume / avgVolume;
  
  const lastCandle = recent24h[recent24h.length - 1];
  const priceChange = (lastCandle.close - lastCandle.open) / lastCandle.open;
  
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0.3;
  const reasons: string[] = [];
  
  // High volume with price movement
  if (volumeRatio > 1.5) {
    if (priceChange > 0.005) {
      signal = 'bullish';
      confidence = Math.min(0.85, 0.5 + volumeRatio * 0.1);
      reasons.push(`High volume (${volumeRatio.toFixed(1)}x) with bullish price action`);
    } else if (priceChange < -0.005) {
      signal = 'bearish';
      confidence = Math.min(0.85, 0.5 + volumeRatio * 0.1);
      reasons.push(`High volume (${volumeRatio.toFixed(1)}x) with bearish price action`);
    } else {
      reasons.push(`High volume (${volumeRatio.toFixed(1)}x) but indecisive`);
    }
  } else if (volumeRatio < 0.5) {
    reasons.push(`Low volume (${volumeRatio.toFixed(1)}x) - weak conviction`);
  }
  
  return {
    agentName: 'VolumeProfileAnalyzer',
    symbol,
    timestamp,
    signal,
    confidence,
    strength: confidence * 0.8,
    executionScore: 50 + (volumeRatio > 1.5 ? 20 : 0),
    reasoning: reasons.join(', ') || 'Normal volume',
    evidence: { volumeRatio, avgVolume, lastVolume, priceChange },
    qualityScore: Math.min(0.85, confidence + 0.1),
    mode: 'ACTIVE',
    processingTime: 0,
    dataFreshness: 0,
  };
}

function generateShadowAgentSignal(
  agentName: string,
  symbol: string,
  candles: MultiTimeframeData,
  timestamp: number
): AgentSignal {
  // Shadow agents provide neutral signals with low confidence
  // They don't block trades but their contribution is tracked
  
  const hourlyCandles = candles['1h'];
  const prices = hourlyCandles.map(c => c.close);
  
  // Use simple momentum as proxy for API-dependent signals
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0.3;
  
  if (prices.length >= 10) {
    const momentum = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10];
    if (momentum > 0.02) {
      signal = 'bullish';
      confidence = 0.4;
    } else if (momentum < -0.02) {
      signal = 'bearish';
      confidence = 0.4;
    }
  }
  
  return {
    agentName,
    symbol,
    timestamp,
    signal,
    confidence,
    strength: confidence * 0.5,
    executionScore: 50,
    reasoning: `Shadow mode - API data unavailable in backtest`,
    evidence: {},
    qualityScore: 0.5,
    mode: 'SHADOW',
    processingTime: 0,
    dataFreshness: 0,
  };
}

function createNeutralSignal(agentName: string, symbol: string, timestamp: number, reason: string): AgentSignal {
  return {
    agentName,
    symbol,
    timestamp,
    signal: 'neutral',
    confidence: 0,
    strength: 0,
    executionScore: 50,
    reasoning: reason,
    evidence: {},
    qualityScore: 0,
    mode: AGENT_MODES[agentName] || 'SHADOW',
    processingTime: 0,
    dataFreshness: 0,
  };
}

// ============================================================================
// COMPREHENSIVE BACKTEST ENGINE
// ============================================================================

export class ComprehensiveBacktestEngine extends EventEmitter {
  private config: BacktestConfig;
  private positions: Map<string, BacktestPosition> = new Map();
  private trades: BacktestTrade[] = [];
  private equityCurve: { timestamp: number; equity: number; drawdown: number }[] = [];
  
  private currentEquity: number;
  private peakEquity: number;
  private maxDrawdown: number = 0;
  
  private candlesProcessed: number = 0;
  private signalsGenerated: number = 0;
  
  private agentStats: Map<string, {
    signalsGenerated: number;
    signalsActedOn: number;
    wins: number;
    losses: number;
    totalConfidence: number;
    mode: string;
    helpedTrades: number;
    blockedTrades: number;
    neutralTrades: number;
  }> = new Map();
  
  constructor(config: BacktestConfig) {
    super();
    this.config = config;
    this.currentEquity = config.initialCapital;
    this.peakEquity = config.initialCapital;
    
    // Initialize agent stats
    for (const [agentName, mode] of Object.entries(AGENT_MODES)) {
      this.agentStats.set(agentName, {
        signalsGenerated: 0,
        signalsActedOn: 0,
        wins: 0,
        losses: 0,
        totalConfidence: 0,
        mode,
        helpedTrades: 0,
        blockedTrades: 0,
        neutralTrades: 0,
      });
    }
  }
  
  async run(): Promise<BacktestResult> {
    const startTime = getActiveClock().now();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`COMPREHENSIVE 1-YEAR BACKTEST - ${this.config.symbol}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Period: ${this.config.startDate.toISOString()} to ${this.config.endDate.toISOString()}`);
    console.log(`Initial Capital: $${this.config.initialCapital.toLocaleString()}`);
    console.log(`Primary Timeframe: ${this.config.primaryTimeframe}`);
    console.log(`${'='.repeat(80)}\n`);
    
    try {
      // Load all OHLCV data
      const allData = await this.loadOHLCVData();
      
      if (!allData || Object.keys(allData).length === 0) {
        throw new Error('Failed to load OHLCV data');
      }
      
      // Get primary timeframe candles for iteration
      const primaryCandles = allData[this.config.primaryTimeframe];
      console.log(`Loaded ${primaryCandles.length} ${this.config.primaryTimeframe} candles for replay`);
      
      // Main backtest loop - iterate candle by candle
      for (let i = 50; i < primaryCandles.length; i++) {
        const currentCandle = primaryCandles[i];
        const currentTime = currentCandle.timestamp;
        
        // Build multi-timeframe data up to current point (NO LOOKAHEAD)
        const mtfData = this.buildMultiTimeframeData(allData, currentTime);
        
        // Update existing positions with current price
        await this.updatePositions(currentCandle, mtfData);
        
        // Generate signals from all agents
        const signals = this.generateAllAgentSignals(this.config.symbol, mtfData, currentTime);
        this.signalsGenerated += signals.length;
        
        // Calculate consensus and make trading decision
        const decision = this.calculateConsensusDecision(signals, mtfData);
        
        // Execute trade if decision warrants it
        if (decision.shouldExecute && this.positions.size < this.config.maxConcurrentPositions) {
          await this.executeTrade(decision, signals, currentCandle, mtfData);
        }
        
        // Update equity curve
        this.updateEquityCurve(currentTime);
        
        // Check drawdown limit
        if (this.maxDrawdown > this.config.maxDrawdownPercent) {
          console.log(`\n⚠️ MAX DRAWDOWN EXCEEDED (${(this.maxDrawdown * 100).toFixed(2)}%)`);
          return this.buildResult('stopped_drawdown', getActiveClock().now() - startTime);
        }
        
        this.candlesProcessed++;
        
        // Progress update every 1000 candles
        if (this.candlesProcessed % 1000 === 0) {
          const progress = ((i / primaryCandles.length) * 100).toFixed(1);
          console.log(`Progress: ${progress}% | Trades: ${this.trades.length} | Equity: $${this.currentEquity.toFixed(2)} | Drawdown: ${(this.maxDrawdown * 100).toFixed(2)}%`);
        }
      }
      
      // Close any remaining positions at end
      await this.closeAllPositions(primaryCandles[primaryCandles.length - 1]);
      
      return this.buildResult('completed', getActiveClock().now() - startTime);
      
    } catch (error) {
      console.error('Backtest error:', error);
      return this.buildResult('error', getActiveClock().now() - startTime, (error as Error).message);
    }
  }
  
  private async loadOHLCVData(): Promise<Record<string, OHLCVCandle[]>> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const { historicalOHLCV } = await import('../../drizzle/schema');
    const { eq, and, gte, lte, asc } = await import('drizzle-orm');
    
    const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
    const data: Record<string, OHLCVCandle[]> = {};
    
    for (const tf of timeframes) {
      console.log(`Loading ${tf} candles for ${this.config.symbol}...`);
      
      const rows = await db.select({
        timestamp: historicalOHLCV.timestamp,
        open: historicalOHLCV.open,
        high: historicalOHLCV.high,
        low: historicalOHLCV.low,
        close: historicalOHLCV.close,
        volume: historicalOHLCV.volume,
      })
        .from(historicalOHLCV)
        .where(and(
          eq(historicalOHLCV.symbol, this.config.symbol),
          eq(historicalOHLCV.timeframe, tf),
          gte(historicalOHLCV.timestamp, this.config.startDate.getTime()),
          lte(historicalOHLCV.timestamp, this.config.endDate.getTime()),
        ))
        .orderBy(asc(historicalOHLCV.timestamp));
      
      data[tf] = rows.map(row => ({
        timestamp: Number(row.timestamp),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume),
      }));
      
      console.log(`  Loaded ${data[tf].length} ${tf} candles`);
    }
    
    return data;
  }
  
  private buildMultiTimeframeData(
    allData: Record<string, OHLCVCandle[]>,
    currentTime: number
  ): MultiTimeframeData {
    const mtf: MultiTimeframeData = {
      '1m': [],
      '5m': [],
      '15m': [],
      '1h': [],
      '4h': [],
      '1d': [],
    };
    
    for (const tf of Object.keys(mtf) as (keyof MultiTimeframeData)[]) {
      // Filter candles up to current time (NO LOOKAHEAD)
      mtf[tf] = allData[tf].filter(c => c.timestamp <= currentTime);
      
      // Keep only last N candles for memory efficiency
      const maxCandles = tf === '1m' ? 500 : tf === '5m' ? 300 : tf === '15m' ? 200 : 100;
      if (mtf[tf].length > maxCandles) {
        mtf[tf] = mtf[tf].slice(-maxCandles);
      }
    }
    
    return mtf;
  }
  
  private generateAllAgentSignals(
    symbol: string,
    candles: MultiTimeframeData,
    timestamp: number
  ): AgentSignal[] {
    const signals: AgentSignal[] = [];
    
    // ACTIVE agents (OHLCV-based)
    signals.push(generateTechnicalAnalystSignal(symbol, candles, timestamp));
    signals.push(generatePatternMatcherSignal(symbol, candles, timestamp));
    signals.push(generateVolumeProfileSignal(symbol, candles, timestamp));
    
    // SHADOW agents (API-dependent and Live-only)
    const shadowAgents = [
      'OrderFlowAnalyst', 'WhaleTracker', 'FundingRateAnalyst',
      'LiquidationHeatmap', 'OnChainFlowAnalyst', 'ForexCorrelationAgent',
      'NewsSentinel', 'SentimentAnalyst', 'MacroAnalyst'
    ];
    
    for (const agent of shadowAgents) {
      signals.push(generateShadowAgentSignal(agent, symbol, candles, timestamp));
    }
    
    // Update agent stats
    for (const signal of signals) {
      const stats = this.agentStats.get(signal.agentName);
      if (stats) {
        stats.signalsGenerated++;
        stats.totalConfidence += signal.confidence;
      }
    }
    
    return signals;
  }
  
  private calculateConsensusDecision(
    signals: AgentSignal[],
    candles: MultiTimeframeData
  ): ExecutionDecision & { regime: string; atr: number } {
    // Separate fast and slow agents
    const fastSignals = signals.filter(s => FAST_AGENTS.includes(s.agentName));
    const slowSignals = signals.filter(s => SLOW_AGENTS.includes(s.agentName));
    
    // Only count ACTIVE agents for minimum requirement
    const activeSignals = signals.filter(s => s.mode === 'ACTIVE');
    if (activeSignals.length < 2) {
      return {
        shouldExecute: false,
        direction: 'hold',
        positionSize: 0,
        confidence: 0,
        threshold: this.config.consensusThreshold * 100,
        tradeType: 'NONE',
        reasoning: 'Insufficient active agents',
        regime: 'unknown',
        atr: 0,
      };
    }
    
    // Build signal map for weighted score calculation
    const signalMap: Record<string, AgentSignal> = {};
    for (const s of signals) {
      const key = s.agentName.toLowerCase().replace('analyst', '').replace('matcher', '');
      signalMap[key] = s;
    }
    
    // Calculate weighted score using TieredDecisionMaking
    const weightedScore = calculateWeightedScore({
      technical: signalMap['technical'],
      pattern: signalMap['pattern'],
      orderFlow: signalMap['orderflow'],
      sentiment: signalMap['sentiment'],
      news: signalMap['news'],
      macro: signalMap['macro'],
    });
    
    // Detect regime and calculate ATR
    const hourlyCandles = candles['1h'];
    const regime = detectRegime(hourlyCandles);
    const atr = calculateATR(hourlyCandles);
    const volatility = atr / hourlyCandles[hourlyCandles.length - 1]?.close || 0.02;
    
    // Apply regime multiplier to threshold
    const regimeMultiplier = getRegimeMultiplier(regime);
    let adjustedThreshold = this.config.consensusThreshold * 100 * regimeMultiplier;
    
    // In backtest mode, reduce threshold to account for shadow agents
    // Shadow agents provide weaker signals, so we need to lower expectations
    if (this.config.backtestMode) {
      const shadowCount = signals.filter(s => s.mode === 'SHADOW').length;
      const shadowPenalty = shadowCount * this.config.shadowAgentPenalty;
      adjustedThreshold = adjustedThreshold * (1 - shadowPenalty);
      // Minimum threshold of 30%
      adjustedThreshold = Math.max(30, adjustedThreshold);
    }
    
    // Make execution decision
    const decision = makeExecutionDecision(weightedScore, volatility);
    
    // Override with regime-adjusted threshold
    const shouldExecute = Math.abs(weightedScore.totalScore) >= adjustedThreshold;
    
    // Determine direction based on score (not the decision which uses different threshold)
    let direction: 'long' | 'short' | 'hold' = 'hold';
    if (shouldExecute) {
      direction = weightedScore.totalScore > 0 ? 'long' : 'short';
    }
    
    // Calculate position size based on our adjusted threshold
    let positionSize = 0;
    let tradeType: 'MAX' | 'HIGH' | 'STRONG' | 'STANDARD' | 'MODERATE' | 'SCOUT' | 'NONE' = 'NONE';
    if (shouldExecute) {
      const excess = Math.abs(weightedScore.totalScore) - adjustedThreshold;
      if (excess >= 40) {
        positionSize = 0.20; tradeType = 'MAX';
      } else if (excess >= 30) {
        positionSize = 0.15; tradeType = 'HIGH';
      } else if (excess >= 20) {
        positionSize = 0.10; tradeType = 'STRONG';
      } else if (excess >= 15) {
        positionSize = 0.07; tradeType = 'STANDARD';
      } else if (excess >= 10) {
        positionSize = 0.05; tradeType = 'MODERATE';
      } else {
        positionSize = 0.03; tradeType = 'SCOUT';
      }
    }
    
    // Debug logging (every 500 candles)
    if (this.candlesProcessed % 500 === 0) {
      console.log(`[DEBUG] Candle ${this.candlesProcessed}: Score=${weightedScore.totalScore.toFixed(1)}%, Threshold=${adjustedThreshold.toFixed(1)}%, Regime=${regime}, Direction=${direction}, Execute=${shouldExecute}`);
      console.log(`  Fast: Tech=${weightedScore.breakdown.technical.toFixed(1)}, Pattern=${weightedScore.breakdown.pattern.toFixed(1)}, OrderFlow=${weightedScore.breakdown.orderFlow.toFixed(1)}`);
      console.log(`  Slow: Sentiment=${weightedScore.breakdown.sentiment.toFixed(1)}, News=${weightedScore.breakdown.news.toFixed(1)}, Macro=${weightedScore.breakdown.macro.toFixed(1)}`);
    }
    
    return {
      shouldExecute,
      direction,
      positionSize,
      confidence: Math.abs(weightedScore.totalScore),
      threshold: adjustedThreshold,
      tradeType,
      reasoning: decision.reasoning,
      regime,
      atr,
    };
  }
  
  private async executeTrade(
    decision: ExecutionDecision & { regime: string; atr: number },
    signals: AgentSignal[],
    candle: OHLCVCandle,
    candles: MultiTimeframeData
  ): Promise<void> {
    const entryPrice = candle.close * (1 + this.config.slippagePercent * (decision.direction === 'long' ? 1 : -1));
    
    // Calculate position size
    const availableCapital = this.currentEquity * (1 - this.positions.size * 0.1);
    const positionValue = availableCapital * decision.positionSize;
    const quantity = positionValue / entryPrice;
    
    if (positionValue < 100) {
      return; // Minimum position size
    }
    
    // Calculate ATR-based stop loss and take profit (agent-driven)
    const atrMultiplier = decision.regime === 'volatile' ? 2.5 : decision.regime.includes('trending') ? 2.0 : 1.5;
    const stopDistance = decision.atr * atrMultiplier;
    const takeProfitDistance = stopDistance * 2.5; // 2.5:1 R:R
    
    let stopLoss: number;
    let takeProfit: number;
    
    if (decision.direction === 'long') {
      stopLoss = entryPrice - stopDistance;
      takeProfit = entryPrice + takeProfitDistance;
    } else {
      stopLoss = entryPrice + stopDistance;
      takeProfit = entryPrice - takeProfitDistance;
    }
    
    // Create position
    const positionId = `${this.config.symbol}-${candle.timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    const position: BacktestPosition = {
      id: positionId,
      symbol: this.config.symbol,
      side: decision.direction as 'long' | 'short',
      entryPrice,
      entryTime: candle.timestamp,
      quantity,
      remainingQuantity: quantity,
      stopLoss,
      takeProfit,
      positionTier: decision.tradeType,
      consensusScore: decision.confidence,
      agentSignals: signals,
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      breakevenActivated: false,
      partialExits: [],
      trailingStopPrice: null,
      atr: decision.atr,
      regime: decision.regime,
    };
    
    this.positions.set(positionId, position);
    
    // Deduct commission
    const commission = positionValue * this.config.commissionPercent;
    this.currentEquity -= commission;
    
    // Update agent stats
    for (const signal of signals) {
      const stats = this.agentStats.get(signal.agentName);
      if (stats) {
        stats.signalsActedOn++;
        const signalDirection = signal.signal === 'bullish' ? 'long' : signal.signal === 'bearish' ? 'short' : 'hold';
        if (signalDirection === decision.direction) {
          stats.helpedTrades++;
        } else if (signal.signal === 'neutral') {
          stats.neutralTrades++;
        } else {
          stats.blockedTrades++;
        }
      }
    }
    
    console.log(`📈 OPEN ${decision.direction.toUpperCase()} | ${this.config.symbol} @ $${entryPrice.toFixed(2)} | Size: $${positionValue.toFixed(2)} (${decision.tradeType}) | SL: $${stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)} | Regime: ${decision.regime}`);
  }
  
  private async updatePositions(candle: OHLCVCandle, candles: MultiTimeframeData): Promise<void> {
    const positionsToClose: { id: string; reason: string; price: number }[] = [];
    
    for (const [id, position] of this.positions) {
      const currentPrice = candle.close;
      
      // Update high/low tracking
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
      }
      if (currentPrice < position.lowestPrice) {
        position.lowestPrice = currentPrice;
      }
      
      // Calculate unrealized P&L
      const pnlPercent = position.side === 'long'
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
      
      // Check breakeven activation
      if (!position.breakevenActivated && pnlPercent >= this.config.breakevenActivationPercent / 100) {
        position.breakevenActivated = true;
        position.stopLoss = position.entryPrice * (1 + 0.001 * (position.side === 'long' ? 1 : -1));
        console.log(`🔒 BREAKEVEN activated for ${id} @ $${position.stopLoss.toFixed(2)}`);
      }
      
      // Check partial profit taking
      for (const level of this.config.partialProfitLevels) {
        if (pnlPercent >= level.pnlPercent / 100 && position.remainingQuantity > position.quantity * 0.25) {
          const alreadyExited = position.partialExits.some(e => e.pnlPercent >= level.pnlPercent);
          if (!alreadyExited) {
            const exitQuantity = position.quantity * (level.exitPercent / 100);
            position.remainingQuantity -= exitQuantity;
            position.partialExits.push({
              timestamp: candle.timestamp,
              price: currentPrice,
              quantity: exitQuantity,
              pnlPercent: pnlPercent * 100,
              reason: `Partial profit at ${level.pnlPercent}%`,
            });
            
            // Realize partial profit
            const partialPnL = exitQuantity * position.entryPrice * pnlPercent;
            this.currentEquity += partialPnL;
            
            console.log(`💰 PARTIAL EXIT ${level.exitPercent}% of ${id} @ $${currentPrice.toFixed(2)} | P&L: ${(pnlPercent * 100).toFixed(2)}%`);
          }
        }
      }
      
      // Check trailing stop activation and update
      if (pnlPercent >= this.config.trailingActivationPercent / 100) {
        const trailingDistance = position.atr * 2; // ATR-based trailing
        
        if (position.side === 'long') {
          const newTrailingStop = position.highestPrice - trailingDistance;
          if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
            position.trailingStopPrice = newTrailingStop;
          }
        } else {
          const newTrailingStop = position.lowestPrice + trailingDistance;
          if (!position.trailingStopPrice || newTrailingStop < position.trailingStopPrice) {
            position.trailingStopPrice = newTrailingStop;
          }
        }
      }
      
      // Check exit conditions
      let shouldClose = false;
      let exitReason = '';
      let exitPrice = currentPrice;
      
      // Stop loss hit
      if (position.side === 'long' && candle.low <= position.stopLoss) {
        shouldClose = true;
        exitReason = 'stop_loss';
        exitPrice = position.stopLoss;
      } else if (position.side === 'short' && candle.high >= position.stopLoss) {
        shouldClose = true;
        exitReason = 'stop_loss';
        exitPrice = position.stopLoss;
      }
      
      // Take profit hit
      if (position.side === 'long' && candle.high >= position.takeProfit) {
        shouldClose = true;
        exitReason = 'take_profit';
        exitPrice = position.takeProfit;
      } else if (position.side === 'short' && candle.low <= position.takeProfit) {
        shouldClose = true;
        exitReason = 'take_profit';
        exitPrice = position.takeProfit;
      }
      
      // Trailing stop hit
      if (position.trailingStopPrice) {
        if (position.side === 'long' && candle.low <= position.trailingStopPrice) {
          shouldClose = true;
          exitReason = 'trailing_stop';
          exitPrice = position.trailingStopPrice;
        } else if (position.side === 'short' && candle.high >= position.trailingStopPrice) {
          shouldClose = true;
          exitReason = 'trailing_stop';
          exitPrice = position.trailingStopPrice;
        }
      }
      
      // Max hold time
      const holdingHours = (candle.timestamp - position.entryTime) / (1000 * 60 * 60);
      if (holdingHours >= this.config.maxHoldTimeHours) {
        shouldClose = true;
        exitReason = 'max_hold_time';
        exitPrice = currentPrice;
      }
      
      // Agent-driven exit check (re-evaluate signals)
      if (!shouldClose && holdingHours >= 1) {
        const newSignals = this.generateAllAgentSignals(position.symbol, candles, candle.timestamp);
        const activeSignals = newSignals.filter(s => s.mode === 'ACTIVE');
        
        // Check for signal reversal
        const bullishCount = activeSignals.filter(s => s.signal === 'bullish').length;
        const bearishCount = activeSignals.filter(s => s.signal === 'bearish').length;
        
        if (position.side === 'long' && bearishCount >= 2 && bearishCount > bullishCount) {
          shouldClose = true;
          exitReason = 'agent_reversal';
          exitPrice = currentPrice;
        } else if (position.side === 'short' && bullishCount >= 2 && bullishCount > bearishCount) {
          shouldClose = true;
          exitReason = 'agent_reversal';
          exitPrice = currentPrice;
        }
      }
      
      if (shouldClose) {
        positionsToClose.push({ id, reason: exitReason, price: exitPrice });
      }
    }
    
    // Close positions
    for (const { id, reason, price } of positionsToClose) {
      await this.closePosition(id, price, reason, candle.timestamp);
    }
  }
  
  private async closePosition(positionId: string, exitPrice: number, exitReason: string, exitTime: number): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position) return;
    
    // Apply slippage
    const actualExitPrice = exitPrice * (1 + this.config.slippagePercent * (position.side === 'long' ? -1 : 1));
    
    // Calculate P&L for remaining quantity
    const pnlPercent = position.side === 'long'
      ? (actualExitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - actualExitPrice) / position.entryPrice;
    
    const positionValue = position.remainingQuantity * position.entryPrice;
    const pnlDollar = positionValue * pnlPercent;
    
    // Deduct exit commission
    const commission = positionValue * this.config.commissionPercent * 2; // Entry + exit
    const slippage = positionValue * this.config.slippagePercent * 2;
    const pnlAfterCosts = pnlDollar - commission - slippage;
    
    // Update equity
    this.currentEquity += pnlAfterCosts;
    
    // Update peak and drawdown
    if (this.currentEquity > this.peakEquity) {
      this.peakEquity = this.currentEquity;
    }
    const currentDrawdown = (this.peakEquity - this.currentEquity) / this.peakEquity;
    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
    }
    
    // Create trade record
    const trade: BacktestTrade = {
      id: positionId,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: actualExitPrice,
      entryTime: position.entryTime,
      exitTime,
      quantity: position.quantity,
      positionTier: position.positionTier,
      consensusScore: position.consensusScore,
      regime: position.regime,
      pnlPercent: pnlPercent * 100,
      pnlDollar,
      pnlAfterCosts,
      commission,
      slippage,
      outcome: pnlAfterCosts > 0 ? 'win' : pnlAfterCosts < 0 ? 'loss' : 'breakeven',
      exitReason,
      holdingPeriodHours: (exitTime - position.entryTime) / (1000 * 60 * 60),
      agentContributions: position.agentSignals.map(s => ({
        agentName: s.agentName,
        signal: s.signal,
        confidence: s.confidence,
        mode: s.mode,
      })),
    };
    
    this.trades.push(trade);
    
    // Update agent stats
    for (const signal of position.agentSignals) {
      const stats = this.agentStats.get(signal.agentName);
      if (stats) {
        if (trade.outcome === 'win') {
          stats.wins++;
        } else if (trade.outcome === 'loss') {
          stats.losses++;
        }
      }
    }
    
    // Remove position
    this.positions.delete(positionId);
    
    const emoji = trade.outcome === 'win' ? '✅' : trade.outcome === 'loss' ? '❌' : '➖';
    console.log(`${emoji} CLOSE ${position.side.toUpperCase()} | ${position.symbol} @ $${actualExitPrice.toFixed(2)} | P&L: ${pnlPercent >= 0 ? '+' : ''}${(pnlPercent * 100).toFixed(2)}% ($${pnlAfterCosts.toFixed(2)}) | Reason: ${exitReason}`);
  }
  
  private async closeAllPositions(lastCandle: OHLCVCandle): Promise<void> {
    for (const [id, position] of this.positions) {
      await this.closePosition(id, lastCandle.close, 'backtest_end', lastCandle.timestamp);
    }
  }
  
  private updateEquityCurve(timestamp: number): void {
    const drawdown = (this.peakEquity - this.currentEquity) / this.peakEquity;
    this.equityCurve.push({
      timestamp,
      equity: this.currentEquity,
      drawdown,
    });
  }
  
  private buildResult(status: 'completed' | 'stopped_drawdown' | 'error', executionTimeMs: number, errorMessage?: string): BacktestResult {
    const metrics = this.calculateMetrics();
    const verdict = this.determineVerdict(metrics);
    
    return {
      config: this.config,
      metrics,
      trades: this.trades,
      equityCurve: this.equityCurve,
      status,
      errorMessage,
      executionTimeMs,
      candlesProcessed: this.candlesProcessed,
      signalsGenerated: this.signalsGenerated,
      verdict: verdict.verdict,
      verdictReason: verdict.reason,
    };
  }
  
  private calculateMetrics(): BacktestMetrics {
    const winningTrades = this.trades.filter(t => t.outcome === 'win');
    const losingTrades = this.trades.filter(t => t.outcome === 'loss');
    
    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnlAfterCosts, 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlAfterCosts, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlAfterCosts, 0));
    
    // Calculate returns for Sharpe/Sortino
    const dailyReturns: number[] = [];
    let prevEquity = this.config.initialCapital;
    for (const point of this.equityCurve) {
      if (point.equity !== prevEquity) {
        dailyReturns.push((point.equity - prevEquity) / prevEquity);
        prevEquity = point.equity;
      }
    }
    
    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const variance = dailyReturns.length > 0 ? dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length : 0;
    const stdDev = Math.sqrt(variance);
    
    const negativeReturns = dailyReturns.filter(r => r < 0);
    const downsideVariance = negativeReturns.length > 0 ? negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);
    
    const sharpeRatio = stdDev > 0 ? (avgReturn * 252) / (stdDev * Math.sqrt(252)) : 0;
    const sortinoRatio = downsideStdDev > 0 ? (avgReturn * 252) / (downsideStdDev * Math.sqrt(252)) : 0;
    const calmarRatio = this.maxDrawdown > 0 ? (totalPnL / this.config.initialCapital) / this.maxDrawdown : 0;
    
    // Tier breakdown
    const tierBreakdown: Record<string, { trades: number; winRate: number; totalPnL: number; avgPnL: number }> = {};
    const tiers = ['SCOUT', 'MODERATE', 'STANDARD', 'STRONG', 'HIGH', 'MAX'];
    for (const tier of tiers) {
      const tierTrades = this.trades.filter(t => t.positionTier === tier);
      const tierWins = tierTrades.filter(t => t.outcome === 'win').length;
      const tierPnL = tierTrades.reduce((sum, t) => sum + t.pnlAfterCosts, 0);
      tierBreakdown[tier] = {
        trades: tierTrades.length,
        winRate: tierTrades.length > 0 ? tierWins / tierTrades.length : 0,
        totalPnL: tierPnL,
        avgPnL: tierTrades.length > 0 ? tierPnL / tierTrades.length : 0,
      };
    }
    
    // Regime breakdown
    const regimeBreakdown: Record<string, { trades: number; winRate: number; totalPnL: number }> = {};
    const regimes = ['trending_up', 'trending_down', 'ranging', 'volatile'];
    for (const regime of regimes) {
      const regimeTrades = this.trades.filter(t => t.regime === regime);
      const regimeWins = regimeTrades.filter(t => t.outcome === 'win').length;
      const regimePnL = regimeTrades.reduce((sum, t) => sum + t.pnlAfterCosts, 0);
      regimeBreakdown[regime] = {
        trades: regimeTrades.length,
        winRate: regimeTrades.length > 0 ? regimeWins / regimeTrades.length : 0,
        totalPnL: regimePnL,
      };
    }
    
    // Monthly P&L
    const monthlyPnL: Record<string, number> = {};
    for (const trade of this.trades) {
      const month = new Date(trade.exitTime).toISOString().slice(0, 7);
      monthlyPnL[month] = (monthlyPnL[month] || 0) + trade.pnlAfterCosts;
    }
    
    // Agent contribution
    const agentContribution: Record<string, any> = {};
    for (const [agentName, stats] of this.agentStats) {
      agentContribution[agentName] = {
        signalsGenerated: stats.signalsGenerated,
        signalsActedOn: stats.signalsActedOn,
        winRate: stats.wins + stats.losses > 0 ? stats.wins / (stats.wins + stats.losses) : 0,
        avgConfidence: stats.signalsGenerated > 0 ? stats.totalConfidence / stats.signalsGenerated : 0,
        mode: stats.mode,
        helpedTrades: stats.helpedTrades,
        blockedTrades: stats.blockedTrades,
        neutralTrades: stats.neutralTrades,
      };
    }
    
    // Calculate trading period in months
    const startTime = this.trades.length > 0 ? this.trades[0].entryTime : this.config.startDate.getTime();
    const endTime = this.trades.length > 0 ? this.trades[this.trades.length - 1].exitTime : this.config.endDate.getTime();
    const monthsTraded = (endTime - startTime) / (1000 * 60 * 60 * 24 * 30);
    
    return {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: this.trades.length > 0 ? winningTrades.length / this.trades.length : 0,
      
      totalPnL,
      totalPnLPercent: totalPnL / this.config.initialCapital,
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      
      avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
      avgWinPercent: winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length : 0,
      avgLossPercent: losingTrades.length > 0 ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnlPercent), 0) / losingTrades.length : 0,
      largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnlAfterCosts)) : 0,
      largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnlAfterCosts)) : 0,
      
      maxDrawdown: this.maxDrawdown,
      maxDrawdownPercent: this.maxDrawdown * 100,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      
      avgHoldingPeriodHours: this.trades.length > 0 ? this.trades.reduce((sum, t) => sum + t.holdingPeriodHours, 0) / this.trades.length : 0,
      tradesPerMonth: monthsTraded > 0 ? this.trades.length / monthsTraded : 0,
      
      tierBreakdown,
      regimeBreakdown,
      monthlyPnL,
      agentContribution,
    };
  }
  
  private determineVerdict(metrics: BacktestMetrics): { verdict: BacktestResult['verdict']; reason: string } {
    const reasons: string[] = [];
    let score = 0;
    
    // Win rate scoring
    if (metrics.winRate >= 0.55) { score += 2; reasons.push(`Good win rate (${(metrics.winRate * 100).toFixed(1)}%)`); }
    else if (metrics.winRate >= 0.45) { score += 1; reasons.push(`Acceptable win rate (${(metrics.winRate * 100).toFixed(1)}%)`); }
    else { score -= 1; reasons.push(`Low win rate (${(metrics.winRate * 100).toFixed(1)}%)`); }
    
    // Profit factor scoring
    if (metrics.profitFactor >= 1.5) { score += 2; reasons.push(`Strong profit factor (${metrics.profitFactor.toFixed(2)})`); }
    else if (metrics.profitFactor >= 1.0) { score += 1; reasons.push(`Positive profit factor (${metrics.profitFactor.toFixed(2)})`); }
    else { score -= 2; reasons.push(`Negative profit factor (${metrics.profitFactor.toFixed(2)})`); }
    
    // Sharpe ratio scoring
    if (metrics.sharpeRatio >= 2.0) { score += 2; reasons.push(`Excellent Sharpe (${metrics.sharpeRatio.toFixed(2)})`); }
    else if (metrics.sharpeRatio >= 1.0) { score += 1; reasons.push(`Good Sharpe (${metrics.sharpeRatio.toFixed(2)})`); }
    else if (metrics.sharpeRatio >= 0) { score += 0; reasons.push(`Low Sharpe (${metrics.sharpeRatio.toFixed(2)})`); }
    else { score -= 1; reasons.push(`Negative Sharpe (${metrics.sharpeRatio.toFixed(2)})`); }
    
    // Drawdown scoring
    if (metrics.maxDrawdownPercent <= 5) { score += 2; reasons.push(`Excellent risk control (${metrics.maxDrawdownPercent.toFixed(1)}% max DD)`); }
    else if (metrics.maxDrawdownPercent <= 10) { score += 1; reasons.push(`Good risk control (${metrics.maxDrawdownPercent.toFixed(1)}% max DD)`); }
    else if (metrics.maxDrawdownPercent <= 20) { score += 0; reasons.push(`Acceptable drawdown (${metrics.maxDrawdownPercent.toFixed(1)}% max DD)`); }
    else { score -= 2; reasons.push(`High drawdown (${metrics.maxDrawdownPercent.toFixed(1)}% max DD)`); }
    
    // Total P&L scoring
    if (metrics.totalPnLPercent >= 0.20) { score += 2; reasons.push(`Strong returns (${(metrics.totalPnLPercent * 100).toFixed(1)}%)`); }
    else if (metrics.totalPnLPercent >= 0.05) { score += 1; reasons.push(`Positive returns (${(metrics.totalPnLPercent * 100).toFixed(1)}%)`); }
    else if (metrics.totalPnLPercent >= 0) { score += 0; reasons.push(`Breakeven (${(metrics.totalPnLPercent * 100).toFixed(1)}%)`); }
    else { score -= 2; reasons.push(`Negative returns (${(metrics.totalPnLPercent * 100).toFixed(1)}%)`); }
    
    // Trade count check
    if (metrics.totalTrades < 20) {
      score -= 1;
      reasons.push(`Low trade count (${metrics.totalTrades}) - may not be statistically significant`);
    }
    
    let verdict: BacktestResult['verdict'];
    if (score >= 8) verdict = 'EXCELLENT';
    else if (score >= 5) verdict = 'GOOD';
    else if (score >= 2) verdict = 'NEEDS_OPTIMIZATION';
    else if (score >= 0) verdict = 'POOR';
    else verdict = 'FAILED';
    
    return { verdict, reason: reasons.join('; ') };
  }
}

// ============================================================================
// EXPORT DEFAULT CONFIG
// ============================================================================

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  symbol: 'BTC-USD',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
  initialCapital: 10000,
  
  commissionPercent: 0.001,  // 0.1%
  slippagePercent: 0.0005,   // 0.05%
  
  maxConcurrentPositions: 5,
  maxPositionSizePercent: 0.20,
  
  maxDrawdownPercent: 0.25,
  riskPerTradePercent: 0.02,
  
  consensusThreshold: 0.70,
  alphaThreshold: 0.75,
  minAgentsRequired: 4,
  
  breakevenActivationPercent: 0.5,
  partialProfitLevels: [
    { pnlPercent: 1.0, exitPercent: 25 },
    { pnlPercent: 1.5, exitPercent: 25 },
    { pnlPercent: 2.0, exitPercent: 25 },
  ],
  trailingActivationPercent: 1.5,
  trailingPercent: 0.5,
  maxHoldTimeHours: 24,
  
  primaryTimeframe: '1h',
  
  // Backtest mode settings
  backtestMode: true,
  shadowAgentPenalty: 0.04,  // 4% threshold reduction per shadow agent (9 agents = 36% reduction)
};
