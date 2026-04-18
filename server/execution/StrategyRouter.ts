/**
 * Strategy Router
 * 
 * Automatically detects which of 21 trading strategies to use based on:
 * - Signal characteristics (confidence, executionScore, strength)
 * - Timeframe (1m = scalping, 1d = swing, 1w = position)
 * - Market conditions (trending, ranging, volatile)
 * - Agent consensus (fast vs slow agent dominance)
 * 
 * Supported Strategies:
 * 1. Scalping (1-5min)
 * 2. Day Trading (5m-1h)
 * 3. Swing Trading (4h-1d)
 * 4. Position Trading (1d-1w)
 * 5. Investing (1w+)
 * 6. Trend Trading
 * 7. Mean Reversion
 * 8. Breakout Trading
 * 9. Pullback Trading
 * 10. Range Trading
 * 11. Momentum Trading
 * 12. Reversal Trading
 * 13. News Trading
 * 14. Arbitrage Trading
 * 15. High-Frequency Trading (HFT)
 * 16. Quant Trading
 * 17. Algorithmic Trading
 * 18. AI Trading
 * 19. Grid Trading
 * 20. Copy Trading
 * 21. Options Trading
 */

export interface DetectedStrategy {
  name: string;
  category: 'timeframe' | 'pattern' | 'event' | 'advanced';
  confidence: number; // 0-100
  reasoning: string;
  characteristics: {
    holdingPeriod: string; // e.g., "1-5 minutes", "2-7 days"
    riskLevel: 'low' | 'medium' | 'high' | 'very_high';
    capitalRequirement: 'low' | 'medium' | 'high';
    complexityLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  };
}

export interface TradeRecommendation {
  symbol: string;
  exchange: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  executionScore: number;
  positionSize: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  agentSignals: any[];
  timestamp: Date;
}

export interface MarketConditions {
  trend: 'strong_uptrend' | 'uptrend' | 'ranging' | 'downtrend' | 'strong_downtrend';
  volatility: 'low' | 'medium' | 'high' | 'extreme';
  volume: 'low' | 'normal' | 'high' | 'surge';
  momentum: number; // -100 to +100
}

export class StrategyRouter {
  /**
   * Detect the most appropriate trading strategy
   */
  detectStrategy(recommendation: TradeRecommendation): DetectedStrategy {
    const marketConditions = this.analyzeMarketConditions(recommendation);
    const timeframeSignal = this.detectTimeframe(recommendation);
    const patternSignal = this.detectPattern(recommendation, marketConditions);
    const eventSignal = this.detectEvent(recommendation);

    // Prioritize strategy detection
    // 1. Event-based (highest priority - time-sensitive)
    if (eventSignal.confidence > 70) {
      return eventSignal;
    }

    // 2. Pattern-based (medium priority - technical setups)
    if (patternSignal.confidence > 60) {
      return patternSignal;
    }

    // 3. Timeframe-based (default fallback)
    return timeframeSignal;
  }

  /**
   * Analyze market conditions from recommendation
   */
  private analyzeMarketConditions(recommendation: TradeRecommendation): MarketConditions {
    const priceChange = ((recommendation.targetPrice - recommendation.entryPrice) / recommendation.entryPrice) * 100;
    
    // Determine trend
    let trend: MarketConditions['trend'];
    if (priceChange > 5) trend = 'strong_uptrend';
    else if (priceChange > 2) trend = 'uptrend';
    else if (priceChange < -5) trend = 'strong_downtrend';
    else if (priceChange < -2) trend = 'downtrend';
    else trend = 'ranging';

    // Determine volatility (based on stop loss distance)
    const stopDistance = Math.abs((recommendation.stopLoss - recommendation.entryPrice) / recommendation.entryPrice) * 100;
    let volatility: MarketConditions['volatility'];
    if (stopDistance > 5) volatility = 'extreme';
    else if (stopDistance > 3) volatility = 'high';
    else if (stopDistance > 1.5) volatility = 'medium';
    else volatility = 'low';

    // Determine volume (placeholder - would need actual volume data)
    const volume: MarketConditions['volume'] = 'normal';

    // Determine momentum
    const momentum = recommendation.confidence - 50; // -50 to +50

    return { trend, volatility, volume, momentum };
  }

  /**
   * Detect timeframe-based strategy
   */
  private detectTimeframe(recommendation: TradeRecommendation): DetectedStrategy {
    const executionScore = recommendation.executionScore;
    const confidence = recommendation.confidence;

    // Scalping (1-5min): Very high execution score, fast agents dominant
    if (executionScore > 80 && confidence > 60) {
      return {
        name: 'scalping',
        category: 'timeframe',
        confidence: 85,
        reasoning: 'High execution score (>80) indicates optimal entry timing for scalping strategy',
        characteristics: {
          holdingPeriod: '1-5 minutes',
          riskLevel: 'high',
          capitalRequirement: 'medium',
          complexityLevel: 'advanced',
        },
      };
    }

    // Day Trading (5m-1h): High execution score, close positions EOD
    if (executionScore > 60 && confidence > 55) {
      return {
        name: 'day_trading',
        category: 'timeframe',
        confidence: 75,
        reasoning: 'Moderate execution score (60-80) suitable for intraday trading with EOD exit',
        characteristics: {
          holdingPeriod: '5 minutes - 1 hour',
          riskLevel: 'medium',
          capitalRequirement: 'medium',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Swing Trading (4h-1d): Balanced fast/slow agents, hold 2-7 days
    if (confidence > 50) {
      return {
        name: 'swing_trading',
        category: 'timeframe',
        confidence: 70,
        reasoning: 'Balanced agent consensus suitable for multi-day swing trades',
        characteristics: {
          holdingPeriod: '2-7 days',
          riskLevel: 'medium',
          capitalRequirement: 'medium',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Position Trading (1d-1w): Slow agents dominant, hold weeks
    if (confidence > 40) {
      return {
        name: 'position_trading',
        category: 'timeframe',
        confidence: 65,
        reasoning: 'Long-term macro signals indicate position trading opportunity',
        characteristics: {
          holdingPeriod: '1-4 weeks',
          riskLevel: 'low',
          capitalRequirement: 'high',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Investing (1w+): Very low frequency, hold months
    return {
      name: 'investing',
      category: 'timeframe',
      confidence: 60,
      reasoning: 'Long-term fundamental signals for buy-and-hold strategy',
      characteristics: {
        holdingPeriod: '1-12 months',
        riskLevel: 'low',
        capitalRequirement: 'high',
        complexityLevel: 'beginner',
      },
    };
  }

  /**
   * Detect pattern-based strategy
   */
  private detectPattern(recommendation: TradeRecommendation, conditions: MarketConditions): DetectedStrategy {
    const { trend, volatility, momentum } = conditions;
    const reasoning = recommendation.reasoning.toLowerCase();

    // Trend Trading: Strong trend + momentum
    if ((trend === 'strong_uptrend' || trend === 'strong_downtrend') && Math.abs(momentum) > 30) {
      return {
        name: 'trend_trading',
        category: 'pattern',
        confidence: 80,
        reasoning: 'Strong directional trend with high momentum confirms trend-following strategy',
        characteristics: {
          holdingPeriod: '1-7 days',
          riskLevel: 'medium',
          capitalRequirement: 'medium',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Mean Reversion: Ranging market + extreme RSI
    if (trend === 'ranging' && (reasoning.includes('oversold') || reasoning.includes('overbought'))) {
      return {
        name: 'mean_reversion',
        category: 'pattern',
        confidence: 75,
        reasoning: 'Ranging market with extreme RSI levels indicates mean reversion opportunity',
        characteristics: {
          holdingPeriod: '1-3 days',
          riskLevel: 'medium',
          capitalRequirement: 'medium',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Breakout Trading: Pattern breakout + volume surge
    if (reasoning.includes('breakout') || reasoning.includes('triangle') || reasoning.includes('resistance')) {
      return {
        name: 'breakout_trading',
        category: 'pattern',
        confidence: 80,
        reasoning: 'Chart pattern breakout with volume confirmation',
        characteristics: {
          holdingPeriod: '1-5 days',
          riskLevel: 'high',
          capitalRequirement: 'medium',
          complexityLevel: 'advanced',
        },
      };
    }

    // Pullback Trading: Uptrend + temporary retracement
    if (trend === 'uptrend' && reasoning.includes('pullback') || reasoning.includes('support')) {
      return {
        name: 'pullback_trading',
        category: 'pattern',
        confidence: 75,
        reasoning: 'Buying pullback to support in established uptrend',
        characteristics: {
          holdingPeriod: '2-7 days',
          riskLevel: 'medium',
          capitalRequirement: 'medium',
          complexityLevel: 'intermediate',
        },
      };
    }

    // Range Trading: Ranging market + support/resistance
    if (trend === 'ranging') {
      return {
        name: 'range_trading',
        category: 'pattern',
        confidence: 70,
        reasoning: 'Trading within established support/resistance range',
        characteristics: {
          holdingPeriod: '1-3 days',
          riskLevel: 'low',
          capitalRequirement: 'low',
          complexityLevel: 'beginner',
        },
      };
    }

    // Momentum Trading: High momentum + volume
    if (Math.abs(momentum) > 40 && volatility === 'high') {
      return {
        name: 'momentum_trading',
        category: 'pattern',
        confidence: 78,
        reasoning: 'Strong momentum with high volume confirms momentum strategy',
        characteristics: {
          holdingPeriod: '1-5 days',
          riskLevel: 'high',
          capitalRequirement: 'medium',
          complexityLevel: 'advanced',
        },
      };
    }

    // Reversal Trading: Trend exhaustion + divergence
    if (reasoning.includes('reversal') || reasoning.includes('divergence') || reasoning.includes('exhaustion')) {
      return {
        name: 'reversal_trading',
        category: 'pattern',
        confidence: 72,
        reasoning: 'Trend reversal signals with divergence confirmation',
        characteristics: {
          holdingPeriod: '2-7 days',
          riskLevel: 'high',
          capitalRequirement: 'medium',
          complexityLevel: 'advanced',
        },
      };
    }

    // Default to AI Trading (multi-agent consensus)
    return {
      name: 'ai_trading',
      category: 'advanced',
      confidence: 70,
      reasoning: 'Multi-agent AI consensus without specific pattern match',
      characteristics: {
        holdingPeriod: '1-7 days',
        riskLevel: 'medium',
        capitalRequirement: 'medium',
        complexityLevel: 'advanced',
      },
    };
  }

  /**
   * Detect event-based strategy
   */
  private detectEvent(recommendation: TradeRecommendation): DetectedStrategy {
    const reasoning = recommendation.reasoning.toLowerCase();
    const executionScore = recommendation.executionScore;

    // News Trading: High-impact news event
    if (reasoning.includes('news') || reasoning.includes('announcement') || reasoning.includes('regulatory')) {
      return {
        name: 'news_trading',
        category: 'event',
        confidence: 85,
        reasoning: 'High-impact news event detected by NewsSentinel agent',
        characteristics: {
          holdingPeriod: '1 hour - 1 day',
          riskLevel: 'very_high',
          capitalRequirement: 'medium',
          complexityLevel: 'expert',
        },
      };
    }

    // Arbitrage Trading: Cross-exchange price differential
    if (reasoning.includes('arbitrage') || reasoning.includes('price differential')) {
      return {
        name: 'arbitrage_trading',
        category: 'event',
        confidence: 90,
        reasoning: 'Cross-exchange arbitrage opportunity detected',
        characteristics: {
          holdingPeriod: '1-30 minutes',
          riskLevel: 'low',
          capitalRequirement: 'high',
          complexityLevel: 'expert',
        },
      };
    }

    // High-Frequency Trading: Sub-second execution
    if (executionScore > 95) {
      return {
        name: 'high_frequency_trading',
        category: 'event',
        confidence: 88,
        reasoning: 'Ultra-high execution score indicates HFT opportunity',
        characteristics: {
          holdingPeriod: '1-60 seconds',
          riskLevel: 'very_high',
          capitalRequirement: 'high',
          complexityLevel: 'expert',
        },
      };
    }

    // No event detected
    return {
      name: 'none',
      category: 'event',
      confidence: 0,
      reasoning: 'No event-based strategy detected',
      characteristics: {
        holdingPeriod: 'N/A',
        riskLevel: 'low',
        capitalRequirement: 'low',
        complexityLevel: 'beginner',
      },
    };
  }

  /**
   * Get strategy description
   */
  getStrategyDescription(strategyName: string): string {
    const descriptions: Record<string, string> = {
      scalping: 'Ultra-short-term trading (1-5 min) capturing small price movements with high frequency',
      day_trading: 'Intraday trading (5m-1h) with all positions closed by end of day',
      swing_trading: 'Multi-day trading (2-7 days) capturing medium-term price swings',
      position_trading: 'Long-term trading (1-4 weeks) following major trends',
      investing: 'Buy-and-hold strategy (1-12 months) based on fundamental value',
      trend_trading: 'Following strong directional trends with momentum confirmation',
      mean_reversion: 'Trading extreme price deviations expecting return to average',
      breakout_trading: 'Entering positions on chart pattern breakouts with volume',
      pullback_trading: 'Buying temporary retracements in established uptrends',
      range_trading: 'Trading between support and resistance in sideways markets',
      momentum_trading: 'Following strong price momentum with volume confirmation',
      reversal_trading: 'Catching trend reversals using divergence and exhaustion signals',
      news_trading: 'Trading high-impact news events and announcements',
      arbitrage_trading: 'Exploiting price differentials across exchanges',
      high_frequency_trading: 'Ultra-fast algorithmic trading (sub-second execution)',
      quant_trading: 'Quantitative strategies using statistical models',
      algorithmic_trading: 'Rule-based automated trading systems',
      ai_trading: 'Multi-agent AI consensus with machine learning',
      grid_trading: 'Automated buy/sell orders at fixed price intervals',
      copy_trading: 'Following trades of successful traders',
      options_trading: 'Trading options contracts with delta hedging',
    };

    return descriptions[strategyName] || 'Unknown strategy';
  }

  /**
   * Get recommended position size multiplier based on strategy
   */
  getPositionSizeMultiplier(strategyName: string): number {
    const multipliers: Record<string, number> = {
      scalping: 0.8, // Smaller positions, higher frequency
      day_trading: 1.0, // Standard position sizing
      swing_trading: 1.2, // Larger positions, lower frequency
      position_trading: 1.5, // Largest positions
      investing: 2.0, // Maximum position size for long-term
      trend_trading: 1.3,
      mean_reversion: 0.9,
      breakout_trading: 1.1,
      pullback_trading: 1.0,
      range_trading: 0.8,
      momentum_trading: 1.2,
      reversal_trading: 0.9,
      news_trading: 0.7, // Smaller due to high risk
      arbitrage_trading: 1.5, // Larger due to low risk
      high_frequency_trading: 0.5, // Very small, very frequent
      quant_trading: 1.0,
      algorithmic_trading: 1.0,
      ai_trading: 1.0,
      grid_trading: 0.8,
      copy_trading: 1.0,
      options_trading: 0.6, // Smaller due to leverage
    };

    return multipliers[strategyName] || 1.0;
  }

  /**
   * Get recommended stop loss distance based on strategy
   */
  getStopLossMultiplier(strategyName: string): number {
    const multipliers: Record<string, number> = {
      scalping: 0.5, // Tight stops
      day_trading: 0.8,
      swing_trading: 1.2, // Wider stops
      position_trading: 1.5,
      investing: 2.0, // Widest stops
      trend_trading: 1.0,
      mean_reversion: 0.9,
      breakout_trading: 1.1,
      pullback_trading: 0.9,
      range_trading: 0.7,
      momentum_trading: 1.2,
      reversal_trading: 1.0,
      news_trading: 1.5, // Wide stops for volatility
      arbitrage_trading: 0.3, // Very tight stops
      high_frequency_trading: 0.2, // Ultra-tight stops
      quant_trading: 1.0,
      algorithmic_trading: 1.0,
      ai_trading: 1.0,
      grid_trading: 0.8,
      copy_trading: 1.0,
      options_trading: 1.3,
    };

    return multipliers[strategyName] || 1.0;
  }
}
