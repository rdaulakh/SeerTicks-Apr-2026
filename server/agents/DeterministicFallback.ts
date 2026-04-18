/**
 * Deterministic Fallback System
 * 
 * Provides rule-based fallbacks for LLM-dependent agents when:
 * - LLM calls timeout or fail
 * - Network connectivity issues
 * - Rate limiting occurs
 * 
 * This ensures signal reproducibility and determinism for the trading system.
 * Target: +20 points to Determinism score
 */

import { AgentSignal } from './AgentBase';

export interface DeterministicFallbackConfig {
  name: string;
  timeout: number; // Max time before fallback activates (ms)
  enabled: boolean;
}

export interface FallbackResult {
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  reasoning: string;
  isDeterministic: boolean;
  fallbackReason?: string;
}

/**
 * Base class for deterministic fallbacks
 * All fallbacks must implement pure mathematical/rule-based logic
 */
export abstract class DeterministicFallback {
  protected config: DeterministicFallbackConfig;

  constructor(config: DeterministicFallbackConfig) {
    this.config = config;
  }

  /**
   * Generate a deterministic signal based on rule-based logic
   * Must not use any LLM or external API calls
   */
  abstract generateFallbackSignal(
    symbol: string,
    marketData: MarketDataInput
  ): FallbackResult;

  /**
   * Check if fallback should be activated
   */
  shouldActivate(llmStartTime: number): boolean {
    return Date.now() - llmStartTime > this.config.timeout;
  }
}

export interface MarketDataInput {
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  priceHistory?: number[]; // Last N prices
  volumeHistory?: number[]; // Last N volumes
  fearGreedIndex?: number; // 0-100
  rsi?: number; // 0-100
  macd?: { value: number; signal: number; histogram: number };
}

/**
 * Sentiment Analyst Deterministic Fallback
 * Uses Fear/Greed Index and price momentum for signal generation
 */
export class SentimentDeterministicFallback extends DeterministicFallback {
  constructor() {
    super({
      name: 'SentimentDeterministicFallback',
      timeout: 10000, // 10 second timeout
      enabled: true,
    });
  }

  generateFallbackSignal(symbol: string, data: MarketDataInput): FallbackResult {
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    let strength = 0.5;
    const reasons: string[] = [];

    // Fear/Greed Index Analysis (Contrarian Strategy)
    if (data.fearGreedIndex !== undefined) {
      if (data.fearGreedIndex <= 20) {
        // Extreme Fear - Contrarian Buy
        signal = 'bullish';
        confidence += 0.2;
        strength += 0.15;
        reasons.push(`Extreme Fear (${data.fearGreedIndex}) - contrarian buy signal`);
      } else if (data.fearGreedIndex <= 35) {
        // Fear - Mild Buy
        signal = 'bullish';
        confidence += 0.1;
        strength += 0.08;
        reasons.push(`Fear zone (${data.fearGreedIndex}) - accumulation opportunity`);
      } else if (data.fearGreedIndex >= 80) {
        // Extreme Greed - Contrarian Sell
        signal = 'bearish';
        confidence += 0.2;
        strength += 0.15;
        reasons.push(`Extreme Greed (${data.fearGreedIndex}) - contrarian sell signal`);
      } else if (data.fearGreedIndex >= 65) {
        // Greed - Mild Sell
        signal = 'bearish';
        confidence += 0.1;
        strength += 0.08;
        reasons.push(`Greed zone (${data.fearGreedIndex}) - distribution warning`);
      } else {
        reasons.push(`Neutral sentiment zone (${data.fearGreedIndex})`);
      }
    }

    // Price Momentum Analysis
    if (data.priceChange24h !== undefined) {
      const absChange = Math.abs(data.priceChange24h);
      
      if (data.priceChange24h > 5) {
        // Strong upward momentum
        if (signal === 'bullish') {
          confidence += 0.1;
          strength += 0.1;
          reasons.push(`Strong upward momentum (+${data.priceChange24h.toFixed(2)}%) confirms bullish sentiment`);
        } else if (signal === 'bearish') {
          // Divergence - reduce confidence
          confidence -= 0.1;
          reasons.push(`Price momentum diverges from bearish sentiment`);
        }
      } else if (data.priceChange24h < -5) {
        // Strong downward momentum
        if (signal === 'bearish') {
          confidence += 0.1;
          strength += 0.1;
          reasons.push(`Strong downward momentum (${data.priceChange24h.toFixed(2)}%) confirms bearish sentiment`);
        } else if (signal === 'bullish') {
          // Divergence - reduce confidence
          confidence -= 0.1;
          reasons.push(`Price momentum diverges from bullish sentiment`);
        }
      }
    }

    // Volume Analysis
    if (data.volumeHistory && data.volumeHistory.length >= 5) {
      const recentVolume = data.volumeHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const historicalVolume = data.volumeHistory.slice(0, -3).reduce((a, b) => a + b, 0) / (data.volumeHistory.length - 3);
      const volumeRatio = recentVolume / historicalVolume;

      if (volumeRatio > 1.5) {
        confidence += 0.05;
        reasons.push(`High volume activity (${(volumeRatio * 100).toFixed(0)}% of average)`);
      }
    }

    // Clamp values
    confidence = Math.max(0.1, Math.min(0.85, confidence));
    strength = Math.max(0.1, Math.min(0.85, strength));

    return {
      signal,
      confidence,
      strength,
      reasoning: `[DETERMINISTIC FALLBACK] ${reasons.join('. ')}`,
      isDeterministic: true,
      fallbackReason: 'LLM timeout or failure - using rule-based sentiment analysis',
    };
  }
}

/**
 * News Sentinel Deterministic Fallback
 * Uses price action and volatility for signal generation
 */
export class NewsDeterministicFallback extends DeterministicFallback {
  constructor() {
    super({
      name: 'NewsDeterministicFallback',
      timeout: 15000, // 15 second timeout
      enabled: true,
    });
  }

  generateFallbackSignal(symbol: string, data: MarketDataInput): FallbackResult {
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.4; // Lower base confidence without news
    let strength = 0.4;
    const reasons: string[] = [];

    // Volatility-based news proxy
    // High volatility often indicates news events
    if (data.high24h && data.low24h && data.currentPrice) {
      const range = data.high24h - data.low24h;
      const rangePercent = (range / data.currentPrice) * 100;

      if (rangePercent > 10) {
        // Extreme volatility - likely news event
        reasons.push(`High volatility detected (${rangePercent.toFixed(1)}% range) - possible news event`);
        
        // Determine direction from price position in range
        const positionInRange = (data.currentPrice - data.low24h) / range;
        
        if (positionInRange > 0.7) {
          signal = 'bullish';
          confidence += 0.15;
          strength += 0.1;
          reasons.push('Price near high of range - positive news reaction');
        } else if (positionInRange < 0.3) {
          signal = 'bearish';
          confidence += 0.15;
          strength += 0.1;
          reasons.push('Price near low of range - negative news reaction');
        }
      } else if (rangePercent > 5) {
        reasons.push(`Moderate volatility (${rangePercent.toFixed(1)}% range)`);
      } else {
        reasons.push(`Low volatility (${rangePercent.toFixed(1)}% range) - no significant news detected`);
      }
    }

    // Price momentum as news proxy
    if (data.priceHistory && data.priceHistory.length >= 10) {
      const recentPrices = data.priceHistory.slice(-5);
      const olderPrices = data.priceHistory.slice(-10, -5);
      
      const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
      const momentumChange = ((recentAvg - olderAvg) / olderAvg) * 100;

      if (Math.abs(momentumChange) > 3) {
        if (momentumChange > 0) {
          if (signal !== 'bearish') {
            signal = 'bullish';
            confidence += 0.1;
          }
          reasons.push(`Positive momentum shift (+${momentumChange.toFixed(2)}%)`);
        } else {
          if (signal !== 'bullish') {
            signal = 'bearish';
            confidence += 0.1;
          }
          reasons.push(`Negative momentum shift (${momentumChange.toFixed(2)}%)`);
        }
      }
    }

    // Clamp values
    confidence = Math.max(0.1, Math.min(0.75, confidence)); // Lower max for news fallback
    strength = Math.max(0.1, Math.min(0.75, strength));

    return {
      signal,
      confidence,
      strength,
      reasoning: `[DETERMINISTIC FALLBACK] ${reasons.join('. ')}`,
      isDeterministic: true,
      fallbackReason: 'News API unavailable - using volatility-based analysis',
    };
  }
}

/**
 * Macro Analyst Deterministic Fallback
 * Uses technical indicators and market structure for signal generation
 */
export class MacroDeterministicFallback extends DeterministicFallback {
  constructor() {
    super({
      name: 'MacroDeterministicFallback',
      timeout: 20000, // 20 second timeout
      enabled: true,
    });
  }

  generateFallbackSignal(symbol: string, data: MarketDataInput): FallbackResult {
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.45;
    let strength = 0.45;
    const reasons: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;

    // RSI Analysis
    if (data.rsi !== undefined) {
      if (data.rsi <= 30) {
        bullishScore += 2;
        reasons.push(`RSI oversold (${data.rsi.toFixed(1)}) - bullish`);
      } else if (data.rsi <= 40) {
        bullishScore += 1;
        reasons.push(`RSI approaching oversold (${data.rsi.toFixed(1)})`);
      } else if (data.rsi >= 70) {
        bearishScore += 2;
        reasons.push(`RSI overbought (${data.rsi.toFixed(1)}) - bearish`);
      } else if (data.rsi >= 60) {
        bearishScore += 1;
        reasons.push(`RSI approaching overbought (${data.rsi.toFixed(1)})`);
      } else {
        reasons.push(`RSI neutral (${data.rsi.toFixed(1)})`);
      }
    }

    // MACD Analysis
    if (data.macd) {
      if (data.macd.histogram > 0 && data.macd.value > data.macd.signal) {
        bullishScore += 1;
        reasons.push('MACD bullish crossover');
      } else if (data.macd.histogram < 0 && data.macd.value < data.macd.signal) {
        bearishScore += 1;
        reasons.push('MACD bearish crossover');
      }

      // Histogram momentum
      if (Math.abs(data.macd.histogram) > 0.5) {
        if (data.macd.histogram > 0) {
          bullishScore += 0.5;
          reasons.push('Strong MACD histogram momentum');
        } else {
          bearishScore += 0.5;
          reasons.push('Strong negative MACD histogram');
        }
      }
    }

    // Price trend analysis
    if (data.priceHistory && data.priceHistory.length >= 20) {
      // Calculate simple moving averages
      const sma10 = data.priceHistory.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const sma20 = data.priceHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;

      if (data.currentPrice > sma10 && sma10 > sma20) {
        bullishScore += 1.5;
        reasons.push('Price above rising SMAs - uptrend');
      } else if (data.currentPrice < sma10 && sma10 < sma20) {
        bearishScore += 1.5;
        reasons.push('Price below falling SMAs - downtrend');
      } else if (data.currentPrice > sma20) {
        bullishScore += 0.5;
        reasons.push('Price above SMA20');
      } else {
        bearishScore += 0.5;
        reasons.push('Price below SMA20');
      }
    }

    // Volume trend
    if (data.volumeHistory && data.volumeHistory.length >= 10) {
      const recentVol = data.volumeHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const olderVol = data.volumeHistory.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
      
      if (recentVol > olderVol * 1.3) {
        // Increasing volume
        if (data.priceChange24h && data.priceChange24h > 0) {
          bullishScore += 0.5;
          reasons.push('Rising volume with rising price');
        } else if (data.priceChange24h && data.priceChange24h < 0) {
          bearishScore += 0.5;
          reasons.push('Rising volume with falling price');
        }
      }
    }

    // Determine final signal
    const netScore = bullishScore - bearishScore;
    
    if (netScore >= 2) {
      signal = 'bullish';
      confidence += Math.min(netScore * 0.08, 0.3);
      strength += Math.min(netScore * 0.06, 0.25);
    } else if (netScore <= -2) {
      signal = 'bearish';
      confidence += Math.min(Math.abs(netScore) * 0.08, 0.3);
      strength += Math.min(Math.abs(netScore) * 0.06, 0.25);
    } else {
      reasons.push('Mixed signals - neutral stance');
    }

    // Clamp values
    confidence = Math.max(0.1, Math.min(0.8, confidence));
    strength = Math.max(0.1, Math.min(0.8, strength));

    return {
      signal,
      confidence,
      strength,
      reasoning: `[DETERMINISTIC FALLBACK] ${reasons.join('. ')}`,
      isDeterministic: true,
      fallbackReason: 'Macro data unavailable - using technical indicator analysis',
    };
  }
}

/**
 * Fallback Manager
 * Coordinates fallback activation and signal generation
 */
export class FallbackManager {
  private sentimentFallback: SentimentDeterministicFallback;
  private newsFallback: NewsDeterministicFallback;
  private macroFallback: MacroDeterministicFallback;
  private fallbackStats: Map<string, { activations: number; lastActivation: number }>;

  constructor() {
    this.sentimentFallback = new SentimentDeterministicFallback();
    this.newsFallback = new NewsDeterministicFallback();
    this.macroFallback = new MacroDeterministicFallback();
    this.fallbackStats = new Map();
  }

  /**
   * Get sentiment fallback signal
   */
  getSentimentFallback(symbol: string, data: MarketDataInput): FallbackResult {
    this.recordActivation('sentiment');
    return this.sentimentFallback.generateFallbackSignal(symbol, data);
  }

  /**
   * Get news fallback signal
   */
  getNewsFallback(symbol: string, data: MarketDataInput): FallbackResult {
    this.recordActivation('news');
    return this.newsFallback.generateFallbackSignal(symbol, data);
  }

  /**
   * Get macro fallback signal
   */
  getMacroFallback(symbol: string, data: MarketDataInput): FallbackResult {
    this.recordActivation('macro');
    return this.macroFallback.generateFallbackSignal(symbol, data);
  }

  /**
   * Check if fallback should activate based on timeout
   */
  shouldActivateFallback(agentType: 'sentiment' | 'news' | 'macro', startTime: number): boolean {
    const timeouts = {
      sentiment: 10000,
      news: 15000,
      macro: 20000,
    };
    return Date.now() - startTime > timeouts[agentType];
  }

  /**
   * Record fallback activation for monitoring
   */
  private recordActivation(type: string): void {
    const stats = this.fallbackStats.get(type) || { activations: 0, lastActivation: 0 };
    stats.activations++;
    stats.lastActivation = Date.now();
    this.fallbackStats.set(type, stats);
  }

  /**
   * Get fallback statistics
   */
  getStats(): Record<string, { activations: number; lastActivation: number }> {
    const result: Record<string, { activations: number; lastActivation: number }> = {};
    this.fallbackStats.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

// Export singleton instance
export const fallbackManager = new FallbackManager();
