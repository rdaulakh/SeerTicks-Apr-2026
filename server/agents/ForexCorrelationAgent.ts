/**
 * ForexCorrelationAgent - Generates trading signals from forex/macro correlation data
 * 
 * This agent analyzes correlations between crypto assets and traditional markets:
 * - DXY (US Dollar Index) - Strong inverse correlation with BTC
 * - Gold (XAU) - Risk-off indicator, sometimes correlated with BTC
 * - S&P 500 futures - Risk-on/risk-off sentiment
 * - EUR/USD - Dollar strength indicator
 * 
 * Signal Generation Logic:
 * 1. Fetch forex/macro data from MetaAPI
 * 2. Calculate correlation indicators (DXY strength, gold trend, etc.)
 * 3. Analyze divergences and convergences with crypto
 * 4. Generate signal based on macro environment and correlations
 * 
 * Key Correlations:
 * - DXY up → BTC typically down (inverse correlation ~-0.6 to -0.8)
 * - Gold up + DXY down → Risk-off, BTC may benefit
 * - S&P up + DXY down → Risk-on, BTC typically up
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { fetchCandles, Candle } from "../metaapi";

interface ForexAnalysis {
  dxyTrend: 'up' | 'down' | 'neutral';
  dxyStrength: number;           // -1 to +1 (negative = weak dollar)
  goldTrend: 'up' | 'down' | 'neutral';
  goldMomentum: number;          // -1 to +1
  eurUsdTrend: 'up' | 'down' | 'neutral';
  riskSentiment: 'risk-on' | 'risk-off' | 'neutral';
  correlationSignal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
}

interface ForexSignalEvidence {
  dxyTrend: string;
  dxyStrength: number;
  dxyChange24h: number;
  goldTrend: string;
  goldMomentum: number;
  goldChange24h: number;
  eurUsdTrend: string;
  eurUsdChange24h: number;
  riskSentiment: string;
  correlationStrength: number;
  dataPoints: number;
}

// Technical analysis helpers
function calculateSMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}

function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMomentum(candles: Candle[], period: number = 10): number {
  if (candles.length < period) return 0;
  const current = candles[candles.length - 1].close;
  const past = candles[candles.length - period].close;
  return ((current - past) / past) * 100;
}

function determineTrend(candles: Candle[]): 'up' | 'down' | 'neutral' {
  if (candles.length < 20) return 'neutral';
  
  const sma10 = calculateSMA(candles, 10);
  const sma20 = calculateSMA(candles, 20);
  const current = candles[candles.length - 1].close;
  
  if (current > sma10 && sma10 > sma20) return 'up';
  if (current < sma10 && sma10 < sma20) return 'down';
  return 'neutral';
}

export class ForexCorrelationAgent extends AgentBase {
  private lastAnalysisTime: number = 0;
  private cachedAnalysis: ForexAnalysis | null = null;
  private readonly CACHE_TTL_MS = 300000; // 5 minute cache (forex data doesn't change as fast)
  
  // Forex symbols to track
  private readonly FOREX_SYMBOLS = {
    DXY: 'DXY',      // US Dollar Index
    XAUUSD: 'XAUUSD', // Gold
    EURUSD: 'EURUSD', // EUR/USD
  };
  
  constructor() {
    super({
      name: "ForexCorrelationAgent",
      enabled: true,
      updateInterval: 900000, // 15 minutes (forex markets slower)
      timeout: 60000,
      maxRetries: 3,
    });
  }
  
  protected async initialize(): Promise<void> {
    console.log("[ForexCorrelationAgent] Initializing forex correlation monitoring...");
  }
  
  protected async cleanup(): Promise<void> {
    console.log("[ForexCorrelationAgent] Cleaning up...");
    this.cachedAnalysis = null;
  }
  
  protected async periodicUpdate(): Promise<void> {
    // Refresh cache on periodic update
    this.cachedAnalysis = null;
  }
  
  /**
   * Analyze forex correlations and generate trading signal
   */
  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = Date.now();
    
    try {
      // Get forex analysis (use cache if fresh)
      const analysis = await this.getForexAnalysis();
      
      // Generate signal based on correlation analysis
      const signal = this.generateSignalFromAnalysis(symbol, analysis, startTime, context);
      
      return signal;
    } catch (error) {
      console.error("[ForexCorrelationAgent] Analysis failed:", error);
      return this.createNeutralSignal(
        symbol,
        `Forex correlation analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  
  /**
   * Get forex analysis (with caching)
   */
  private async getForexAnalysis(): Promise<ForexAnalysis> {
    const now = Date.now();
    
    // Return cached analysis if fresh
    if (this.cachedAnalysis && (now - this.lastAnalysisTime) < this.CACHE_TTL_MS) {
      return this.cachedAnalysis;
    }
    
    // Fetch forex data in parallel
    const [dxyCandles, goldCandles, eurUsdCandles] = await Promise.all([
      this.fetchForexData(this.FOREX_SYMBOLS.DXY),
      this.fetchForexData(this.FOREX_SYMBOLS.XAUUSD),
      this.fetchForexData(this.FOREX_SYMBOLS.EURUSD),
    ]);
    
    // Analyze each instrument
    const analysis = this.analyzeForexData(dxyCandles, goldCandles, eurUsdCandles);
    
    // Cache the analysis
    this.cachedAnalysis = analysis;
    this.lastAnalysisTime = now;
    
    return analysis;
  }
  
  /**
   * Fetch forex candle data from MetaAPI
   */
  private async fetchForexData(symbol: string): Promise<Candle[]> {
    try {
      const candles = await fetchCandles(symbol, '1h', 50);
      return candles;
    } catch (error) {
      console.warn(`[ForexCorrelationAgent] Failed to fetch ${symbol}:`, error);
      // Return empty array on error - will use fallback logic
      return [];
    }
  }
  
  /**
   * Analyze forex data to determine macro environment
   */
  private analyzeForexData(
    dxyCandles: Candle[],
    goldCandles: Candle[],
    eurUsdCandles: Candle[]
  ): ForexAnalysis {
    // Analyze DXY (US Dollar Index)
    const dxyTrend = dxyCandles.length > 0 ? determineTrend(dxyCandles) : 'neutral';
    const dxyMomentum = dxyCandles.length > 0 ? calculateMomentum(dxyCandles) : 0;
    const dxyRSI = dxyCandles.length > 0 ? calculateRSI(dxyCandles) : 50;
    
    // DXY strength: positive = strong dollar (bearish for crypto)
    const dxyStrength = this.calculateDxyStrength(dxyTrend, dxyMomentum, dxyRSI);
    
    // Analyze Gold
    const goldTrend = goldCandles.length > 0 ? determineTrend(goldCandles) : 'neutral';
    const goldMomentum = goldCandles.length > 0 ? calculateMomentum(goldCandles) : 0;
    
    // Analyze EUR/USD
    const eurUsdTrend = eurUsdCandles.length > 0 ? determineTrend(eurUsdCandles) : 'neutral';
    
    // Determine overall risk sentiment
    const riskSentiment = this.determineRiskSentiment(dxyTrend, goldTrend, eurUsdTrend);
    
    // Generate correlation signal for crypto
    const { correlationSignal, confidence, reasoning } = this.generateCorrelationSignal(
      dxyTrend, dxyStrength, goldTrend, goldMomentum, riskSentiment
    );
    
    return {
      dxyTrend,
      dxyStrength,
      goldTrend,
      goldMomentum: goldMomentum / 100, // Normalize to -1 to +1
      eurUsdTrend,
      riskSentiment,
      correlationSignal,
      confidence,
      reasoning,
    };
  }
  
  /**
   * Calculate DXY strength score (-1 to +1)
   */
  private calculateDxyStrength(
    trend: 'up' | 'down' | 'neutral',
    momentum: number,
    rsi: number
  ): number {
    let strength = 0;
    
    // Trend contribution
    if (trend === 'up') strength += 0.3;
    else if (trend === 'down') strength -= 0.3;
    
    // Momentum contribution (normalized)
    strength += Math.max(-0.3, Math.min(0.3, momentum / 5));
    
    // RSI contribution
    if (rsi > 70) strength += 0.2; // Overbought = strong
    else if (rsi < 30) strength -= 0.2; // Oversold = weak
    else strength += (rsi - 50) / 100; // Linear scale
    
    return Math.max(-1, Math.min(1, strength));
  }
  
  /**
   * Determine overall risk sentiment
   */
  private determineRiskSentiment(
    dxyTrend: 'up' | 'down' | 'neutral',
    goldTrend: 'up' | 'down' | 'neutral',
    eurUsdTrend: 'up' | 'down' | 'neutral'
  ): 'risk-on' | 'risk-off' | 'neutral' {
    let riskScore = 0;
    
    // DXY down = risk-on (weak dollar)
    if (dxyTrend === 'down') riskScore += 1;
    else if (dxyTrend === 'up') riskScore -= 1;
    
    // Gold up = risk-off (safe haven demand)
    if (goldTrend === 'up') riskScore -= 0.5;
    else if (goldTrend === 'down') riskScore += 0.5;
    
    // EUR/USD up = risk-on (dollar weakness)
    if (eurUsdTrend === 'up') riskScore += 0.5;
    else if (eurUsdTrend === 'down') riskScore -= 0.5;
    
    if (riskScore >= 1) return 'risk-on';
    if (riskScore <= -1) return 'risk-off';
    return 'neutral';
  }
  
  /**
   * Generate correlation signal for crypto based on forex analysis
   */
  private generateCorrelationSignal(
    dxyTrend: 'up' | 'down' | 'neutral',
    dxyStrength: number,
    goldTrend: 'up' | 'down' | 'neutral',
    goldMomentum: number,
    riskSentiment: 'risk-on' | 'risk-off' | 'neutral'
  ): { correlationSignal: 'bullish' | 'bearish' | 'neutral'; confidence: number; reasoning: string } {
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let reasoning = '';
    
    // Primary signal: DXY inverse correlation
    // Strong dollar (DXY up) = bearish for crypto
    // Weak dollar (DXY down) = bullish for crypto
    if (dxyStrength < -0.3) {
      signal = 'bullish';
      confidence = 0.6 + Math.abs(dxyStrength) * 0.2;
      reasoning = `Weak US Dollar (DXY ${dxyTrend}, strength: ${(dxyStrength * 100).toFixed(0)}%) creates favorable macro environment for crypto. `;
    } else if (dxyStrength > 0.3) {
      signal = 'bearish';
      confidence = 0.6 + dxyStrength * 0.2;
      reasoning = `Strong US Dollar (DXY ${dxyTrend}, strength: ${(dxyStrength * 100).toFixed(0)}%) creates headwinds for crypto. `;
    } else {
      reasoning = `US Dollar neutral (DXY ${dxyTrend}, strength: ${(dxyStrength * 100).toFixed(0)}%). `;
    }
    
    // Secondary signal: Risk sentiment
    if (riskSentiment === 'risk-on') {
      if (signal === 'bullish') {
        confidence = Math.min(0.85, confidence + 0.1);
        reasoning += `Risk-on environment supports crypto upside. `;
      } else if (signal === 'neutral') {
        signal = 'bullish';
        confidence = 0.55;
        reasoning += `Risk-on sentiment favors crypto despite neutral dollar. `;
      }
    } else if (riskSentiment === 'risk-off') {
      if (signal === 'bearish') {
        confidence = Math.min(0.85, confidence + 0.1);
        reasoning += `Risk-off environment adds to crypto headwinds. `;
      } else if (signal === 'neutral') {
        signal = 'bearish';
        confidence = 0.55;
        reasoning += `Risk-off sentiment pressures crypto despite neutral dollar. `;
      }
    }
    
    // Gold divergence signal
    if (goldTrend === 'down' && signal === 'bullish') {
      confidence = Math.min(0.85, confidence + 0.05);
      reasoning += `Gold weakness suggests rotation into risk assets. `;
    } else if (goldTrend === 'up' && signal === 'bearish') {
      confidence = Math.min(0.85, confidence + 0.05);
      reasoning += `Gold strength confirms safe-haven demand. `;
    }
    
    return { correlationSignal: signal, confidence, reasoning };
  }
  
  /**
   * Generate trading signal from forex analysis
   */
  private generateSignalFromAnalysis(
    symbol: string,
    analysis: ForexAnalysis,
    startTime: number,
    context?: any
  ): AgentSignal {
    const processingTime = Date.now() - startTime;
    
    // Calculate execution score
    const executionScore = this.calculateExecutionScore(analysis);
    
    // Calculate quality score
    const qualityScore = this.calculateQualityScore(analysis);
    
    // Calculate strength based on confidence and DXY strength
    const strength = Math.min(1, analysis.confidence * Math.abs(analysis.dxyStrength) * 2);
    
    // Build evidence object
    const evidence: ForexSignalEvidence = {
      dxyTrend: analysis.dxyTrend,
      dxyStrength: analysis.dxyStrength,
      dxyChange24h: 0, // Would need 24h data
      goldTrend: analysis.goldTrend,
      goldMomentum: analysis.goldMomentum,
      goldChange24h: 0,
      eurUsdTrend: analysis.eurUsdTrend,
      eurUsdChange24h: 0,
      riskSentiment: analysis.riskSentiment,
      correlationStrength: Math.abs(analysis.dxyStrength),
      dataPoints: 50, // Candles analyzed
    };
    
    // Phase 30: Apply MarketContext regime adjustments
    let adjustedConfidence = analysis.confidence;
    let adjustedReasoning = analysis.reasoning;
    if (context?.regime) {
      const regime = context.regime as string;
      // Forex correlations are strongest during macro-driven moves
      if (regime === 'trending_up' || regime === 'trending_down') {
        adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.08);
        adjustedReasoning += ` [Regime: ${regime} — macro correlation reinforced]`;
      }
      // In high volatility, forex correlations can break down
      if (regime === 'high_volatility') {
        adjustedConfidence *= 0.85;
        adjustedReasoning += ' [Regime: high_volatility — forex correlation may decouple]';
      }
    }

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal: analysis.correlationSignal,
      confidence: adjustedConfidence,
      strength,
      executionScore,
      reasoning: adjustedReasoning,
      evidence,
      qualityScore,
      processingTime,
      dataFreshness: 0,
      recommendation: this.generateRecommendation(analysis.correlationSignal, analysis.confidence, strength),
    };
  }
  
  /**
   * Calculate execution score (0-100)
   */
  private calculateExecutionScore(analysis: ForexAnalysis): number {
    let score = 50; // Base score
    
    // Higher score for clear trends
    if (analysis.dxyTrend !== 'neutral') score += 10;
    if (analysis.goldTrend !== 'neutral') score += 5;
    if (analysis.eurUsdTrend !== 'neutral') score += 5;
    
    // Higher score for strong DXY signal
    if (Math.abs(analysis.dxyStrength) > 0.5) score += 15;
    else if (Math.abs(analysis.dxyStrength) > 0.3) score += 10;
    
    // Higher score for clear risk sentiment
    if (analysis.riskSentiment !== 'neutral') score += 10;
    
    // Higher score for high confidence
    if (analysis.confidence > 0.7) score += 5;
    
    return Math.min(100, Math.max(0, score));
  }
  
  /**
   * Calculate quality score (0-1)
   */
  private calculateQualityScore(analysis: ForexAnalysis): number {
    let score = 0.5; // Base score
    
    // Data availability
    score += 0.1; // Assume data is available if we got here
    
    // Signal clarity
    if (analysis.correlationSignal !== 'neutral') score += 0.15;
    
    // Confidence alignment
    score += analysis.confidence * 0.25;
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Generate action recommendation
   */
  private generateRecommendation(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    strength: number
  ): AgentSignal['recommendation'] {
    if (signal === 'neutral' || confidence < 0.5) {
      return {
        action: 'hold',
        urgency: 'low',
      };
    }
    
    const action = signal === 'bullish' ? 'buy' : 'sell';
    const urgency = confidence >= 0.75 && strength >= 0.6 ? 'high' 
      : confidence >= 0.6 ? 'medium' 
      : 'low';
    
    return {
      action,
      urgency,
    };
  }
}

// Export singleton factory
let forexCorrelationAgentInstance: ForexCorrelationAgent | null = null;

export function getForexCorrelationAgent(): ForexCorrelationAgent {
  if (!forexCorrelationAgentInstance) {
    forexCorrelationAgentInstance = new ForexCorrelationAgent();
  }
  return forexCorrelationAgentInstance;
}
