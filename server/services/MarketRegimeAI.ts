/**
 * MarketRegimeAI — Intent Analyzer (Layer 1 of Intent-Driven Architecture)
 * 
 * PURPOSE:
 * Detects the current market regime for each symbol and produces a MarketContext
 * object that is passed to every agent's generateSignal() call. This replaces
 * the empty `{}` context that agents previously received.
 * 
 * REGIME TYPES:
 * - trending_up:    Price > SMA50 > SMA200, ADX > 25, clear upward momentum
 * - trending_down:  Price < SMA50 < SMA200, ADX > 25, clear downward momentum
 * - range_bound:    Price oscillating, ADX < 20, no clear direction
 * - high_volatility: ATR > 1.5x average, rapid price swings
 * - breakout:       Price breaking out of consolidation with volume confirmation
 * - mean_reverting: Extended deviation from mean with reversal signals
 * 
 * OUTPUTS (MarketContext):
 * - regime: current market regime classification
 * - regimeConfidence: 0-1 how confident we are in the classification
 * - volatilityClass: 'low' | 'medium' | 'high' | 'extreme'
 * - trendStrength: 0-1 how strong the current trend is
 * - keyDrivers: string[] what's driving the current market state
 * - supportResistance: { support: number, resistance: number }
 * - volumeProfile: 'increasing' | 'decreasing' | 'stable'
 * - agentGuidance: per-agent instructions based on regime
 * 
 * INTEGRATION:
 * Called by GlobalSymbolAnalyzer BEFORE running agents.
 * Context is passed to agent.generateSignal(symbol, context).
 * 
 * DATA SOURCES:
 * - CandleCache (real-time WebSocket candles)
 * - Database candles (historical fallback)
 * - PriceFeedService (latest tick)
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getAgentWeightMultiplier } from './RegimeCalibration';

// ============================================================
// Types
// ============================================================

export type MarketRegime = 
  | 'trending_up' 
  | 'trending_down' 
  | 'range_bound' 
  | 'high_volatility' 
  | 'breakout' 
  | 'mean_reverting';

export type VolatilityClass = 'low' | 'medium' | 'high' | 'extreme';
export type VolumeProfile = 'increasing' | 'decreasing' | 'stable';

export interface MarketContext {
  // Core regime classification
  regime: MarketRegime;
  regimeConfidence: number;       // 0-1
  previousRegime: MarketRegime | null;
  regimeAge: number;              // milliseconds since regime was established
  
  // Market metrics
  volatilityClass: VolatilityClass;
  trendStrength: number;          // 0-1
  trendDirection: 'up' | 'down' | 'flat';
  volumeProfile: VolumeProfile;
  
  // Key levels
  support: number;
  resistance: number;
  currentPrice: number;
  priceVsSMA50: number;           // % above/below SMA50
  priceVsSMA200: number;          // % above/below SMA200
  
  // Technical indicators summary
  atr: number;
  atrPercent: number;             // ATR as % of price
  adx: number;
  rsi: number;
  
  // Contextual drivers
  keyDrivers: string[];
  
  // Per-agent guidance: tells each agent what to focus on
  agentGuidance: Record<string, AgentTaskDirective>;
  
  // Metadata
  timestamp: number;
  dataQuality: 'full' | 'partial' | 'minimal';
  candleCount: number;
}

export interface AgentTaskDirective {
  priority: 'high' | 'medium' | 'low' | 'skip';
  focus: string;                  // What this agent should focus on
  questions: string[];            // Specific questions the agent should answer
  weightMultiplier: number;       // Regime-based weight adjustment (0.5-2.0)
}

// ============================================================
// Constants
// ============================================================

const CACHE_TTL_MS = 30_000;      // 30 seconds — regime doesn't change every tick
const MIN_CANDLES = 50;           // Minimum candles for reliable regime detection
const IDEAL_CANDLES = 200;        // Ideal candle count for full analysis

// Agent names for guidance generation
const FAST_AGENTS = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
const SLOW_AGENTS = [
  'SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst',
  'WhaleTracker', 'FundingRateAnalyst', 'LiquidationHeatmap',
  'OnChainFlowAnalyst', 'VolumeProfileAnalyzer', 'MLPredictionAgent',
];

// ============================================================
// MarketRegimeAI Service
// ============================================================

export class MarketRegimeAI extends EventEmitter {
  private cache: Map<string, { context: MarketContext; timestamp: number }> = new Map();
  private regimeHistory: Map<string, { regime: MarketRegime; timestamp: number }[]> = new Map();
  
  constructor() {
    super();
  }

  /**
   * Get the current MarketContext for a symbol.
   * This is the main entry point — called by GlobalSymbolAnalyzer before running agents.
   */
  async getMarketContext(symbol: string): Promise<MarketContext> {
    // Check cache
    const cached = this.cache.get(symbol);
    if (cached && (getActiveClock().now() - cached.timestamp) < CACHE_TTL_MS) {
      return cached.context;
    }

    // Build fresh context
    const context = await this.buildMarketContext(symbol);
    
    // Cache it
    this.cache.set(symbol, { context, timestamp: getActiveClock().now() });
    
    // Track regime history for transition detection
    this.trackRegimeHistory(symbol, context.regime);
    
    // Emit regime change events + Phase 34: notify transition smoother
    const history = this.regimeHistory.get(symbol) || [];
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      if (prev.regime !== context.regime) {
        // Phase 34: Notify RegimeTransitionSmoother for blended parameter smoothing
        try {
          const { getRegimeTransitionSmoother } = require('./RegimeCalibration');
          getRegimeTransitionSmoother().onRegimeChange(symbol, prev.regime as any, context.regime as any);
        } catch { /* smoother is best-effort */ }

        this.emit('regime_change', {
          symbol,
          from: prev.regime,
          to: context.regime,
          confidence: context.regimeConfidence,
          timestamp: getActiveClock().now(),
        });
      }
    }

    return context;
  }

  /**
   * Force refresh context (bypass cache).
   */
  async refreshContext(symbol: string): Promise<MarketContext> {
    this.cache.delete(symbol);
    return this.getMarketContext(symbol);
  }

  /**
   * Get regime history for a symbol.
   */
  getRegimeHistory(symbol: string): { regime: MarketRegime; timestamp: number }[] {
    return this.regimeHistory.get(symbol) || [];
  }

  // ============================================================
  // PRIVATE: Build Market Context
  // ============================================================

  private async buildMarketContext(symbol: string): Promise<MarketContext> {
    // Get candle data
    const candles = await this.getCandles(symbol);
    
    if (candles.length < 20) {
      // Minimal data — return conservative default context
      return this.buildMinimalContext(symbol, candles);
    }

    // Calculate all technical indicators
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);
    const currentPrice = closes[closes.length - 1];

    // Moving averages
    const sma20 = this.sma(closes, 20);
    const sma50 = this.sma(closes, 50);
    const sma200 = candles.length >= 200 ? this.sma(closes, 200) : this.sma(closes, closes.length);

    // ATR (Average True Range)
    const atr = this.calculateATR(highs, lows, closes, 14);
    const avgATR = this.calculateATR(highs, lows, closes, Math.min(50, candles.length));
    const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    // ADX (Average Directional Index)
    const adx = this.calculateADX(highs, lows, closes, 14);

    // RSI
    const rsi = this.calculateRSI(closes, 14);

    // Bollinger Bands for mean reversion detection
    const bb = this.calculateBollingerBands(closes, 20, 2);

    // Volume analysis
    const volumeProfile = this.analyzeVolume(volumes);

    // Support/Resistance
    const { support, resistance } = this.findSupportResistance(highs, lows, closes);

    // Price vs SMAs
    const priceVsSMA50 = sma50 > 0 ? ((currentPrice - sma50) / sma50) * 100 : 0;
    const priceVsSMA200 = sma200 > 0 ? ((currentPrice - sma200) / sma200) * 100 : 0;

    // Detect regime
    const { regime, confidence, drivers } = this.classifyRegime({
      currentPrice, sma20, sma50, sma200,
      atr, avgATR, adx, rsi, bb,
      volumeProfile, volumes,
      priceVsSMA50, priceVsSMA200,
    });

    // Determine volatility class
    const volatilityClass = this.classifyVolatility(atr, avgATR, atrPercent);

    // Determine trend strength
    const trendStrength = this.calculateTrendStrength(adx, priceVsSMA50, priceVsSMA200);
    const trendDirection = priceVsSMA50 > 1 ? 'up' : priceVsSMA50 < -1 ? 'down' : 'flat';

    // Get previous regime
    const history = this.regimeHistory.get(symbol) || [];
    const previousRegime = history.length > 0 ? history[history.length - 1].regime : null;
    const regimeAge = history.length > 0 ? getActiveClock().now() - history[history.length - 1].timestamp : 0;

    // Generate agent guidance based on regime
    const agentGuidance = this.generateAgentGuidance(regime, volatilityClass, trendStrength, trendDirection);

    const context: MarketContext = {
      regime,
      regimeConfidence: confidence,
      previousRegime,
      regimeAge,
      volatilityClass,
      trendStrength,
      trendDirection,
      volumeProfile,
      support,
      resistance,
      currentPrice,
      priceVsSMA50,
      priceVsSMA200,
      atr,
      atrPercent,
      adx,
      rsi,
      keyDrivers: drivers,
      agentGuidance,
      timestamp: getActiveClock().now(),
      dataQuality: candles.length >= IDEAL_CANDLES ? 'full' : candles.length >= MIN_CANDLES ? 'partial' : 'minimal',
      candleCount: candles.length,
    };

    return context;
  }

  // ============================================================
  // PRIVATE: Regime Classification
  // ============================================================

  private classifyRegime(data: {
    currentPrice: number; sma20: number; sma50: number; sma200: number;
    atr: number; avgATR: number; adx: number; rsi: number;
    bb: { upper: number; lower: number; middle: number; bandwidth: number };
    volumeProfile: VolumeProfile; volumes: number[];
    priceVsSMA50: number; priceVsSMA200: number;
  }): { regime: MarketRegime; confidence: number; drivers: string[] } {
    const { currentPrice, sma20, sma50, sma200, atr, avgATR, adx, rsi, bb, volumeProfile, volumes, priceVsSMA50, priceVsSMA200 } = data;
    const volatilityRatio = avgATR > 0 ? atr / avgATR : 1.0;
    const drivers: string[] = [];
    
    // Score each regime candidate
    let scores: { regime: MarketRegime; score: number; drivers: string[] }[] = [];

    // --- HIGH VOLATILITY ---
    {
      let score = 0;
      const d: string[] = [];
      if (volatilityRatio > 1.5) { score += 40; d.push(`ATR ${volatilityRatio.toFixed(1)}x average`); }
      if (volatilityRatio > 2.0) { score += 20; d.push('Extreme volatility spike'); }
      if (bb.bandwidth > 0.08) { score += 15; d.push('Wide Bollinger Bands'); }
      if (adx > 40) { score += 10; d.push(`Strong directional move ADX=${adx.toFixed(0)}`); }
      if (rsi > 75 || rsi < 25) { score += 10; d.push(`RSI extreme: ${rsi.toFixed(0)}`); }
      scores.push({ regime: 'high_volatility', score, drivers: d });
    }

    // --- BREAKOUT ---
    {
      let score = 0;
      const d: string[] = [];
      // Price breaking above resistance or below support with volume
      if (currentPrice > bb.upper) { score += 25; d.push('Price above upper Bollinger Band'); }
      if (currentPrice < bb.lower) { score += 25; d.push('Price below lower Bollinger Band'); }
      if (volumeProfile === 'increasing') { score += 20; d.push('Volume increasing (breakout confirmation)'); }
      if (bb.bandwidth < 0.03 && volatilityRatio > 1.2) { score += 20; d.push('Squeeze breakout (tight bands + expanding ATR)'); }
      if (adx > 25 && adx < 40) { score += 10; d.push('ADX confirming directional move'); }
      scores.push({ regime: 'breakout', score, drivers: d });
    }

    // --- TRENDING UP ---
    {
      let score = 0;
      const d: string[] = [];
      if (currentPrice > sma50 && sma50 > sma200) { score += 30; d.push('Price > SMA50 > SMA200 (golden cross structure)'); }
      else if (currentPrice > sma50) { score += 15; d.push('Price above SMA50'); }
      if (adx > 25) { score += 20; d.push(`Strong trend ADX=${adx.toFixed(0)}`); }
      if (priceVsSMA50 > 0 && priceVsSMA50 < 10) { score += 10; d.push('Healthy trend (not overextended)'); }
      if (rsi > 50 && rsi < 70) { score += 10; d.push(`Bullish momentum RSI=${rsi.toFixed(0)}`); }
      if (volumeProfile === 'increasing') { score += 5; d.push('Volume supporting uptrend'); }
      scores.push({ regime: 'trending_up', score, drivers: d });
    }

    // --- TRENDING DOWN ---
    {
      let score = 0;
      const d: string[] = [];
      if (currentPrice < sma50 && sma50 < sma200) { score += 30; d.push('Price < SMA50 < SMA200 (death cross structure)'); }
      else if (currentPrice < sma50) { score += 15; d.push('Price below SMA50'); }
      if (adx > 25) { score += 20; d.push(`Strong trend ADX=${adx.toFixed(0)}`); }
      if (priceVsSMA50 < 0 && priceVsSMA50 > -10) { score += 10; d.push('Healthy downtrend (not overextended)'); }
      if (rsi < 50 && rsi > 30) { score += 10; d.push(`Bearish momentum RSI=${rsi.toFixed(0)}`); }
      scores.push({ regime: 'trending_down', score, drivers: d });
    }

    // --- MEAN REVERTING ---
    {
      let score = 0;
      const d: string[] = [];
      if (Math.abs(priceVsSMA50) > 5) { score += 20; d.push(`Price ${priceVsSMA50.toFixed(1)}% from SMA50 (overextended)`); }
      if (rsi > 70) { score += 20; d.push(`Overbought RSI=${rsi.toFixed(0)}`); }
      if (rsi < 30) { score += 20; d.push(`Oversold RSI=${rsi.toFixed(0)}`); }
      if (volumeProfile === 'decreasing') { score += 10; d.push('Volume declining (exhaustion)'); }
      if (currentPrice > bb.upper || currentPrice < bb.lower) { score += 15; d.push('Price outside Bollinger Bands'); }
      scores.push({ regime: 'mean_reverting', score, drivers: d });
    }

    // --- RANGE BOUND ---
    {
      let score = 0;
      const d: string[] = [];
      if (adx < 20) { score += 25; d.push(`Weak trend ADX=${adx.toFixed(0)}`); }
      if (Math.abs(priceVsSMA50) < 2) { score += 15; d.push('Price near SMA50'); }
      if (volatilityRatio < 1.0) { score += 10; d.push('Below-average volatility'); }
      if (bb.bandwidth < 0.04) { score += 10; d.push('Tight Bollinger Bands'); }
      if (rsi > 40 && rsi < 60) { score += 10; d.push(`Neutral RSI=${rsi.toFixed(0)}`); }
      scores.push({ regime: 'range_bound', score, drivers: d });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    const winner = scores[0];
    const runnerUp = scores[1];

    // Confidence = normalized gap between winner and runner-up
    const maxPossible = 100;
    const confidence = Math.min(1.0, Math.max(0.3, 
      (winner.score / maxPossible) * 0.6 + 
      ((winner.score - runnerUp.score) / maxPossible) * 0.4
    ));

    return {
      regime: winner.regime,
      confidence,
      drivers: winner.drivers,
    };
  }

  // ============================================================
  // PRIVATE: Agent Guidance Generation
  // ============================================================

  /**
   * Generate per-agent task directives based on the current regime.
   * This is the "Strategic Planner" aspect — telling each agent what to focus on.
   */
  private generateAgentGuidance(
    regime: MarketRegime,
    volatility: VolatilityClass,
    trendStrength: number,
    trendDirection: 'up' | 'down' | 'flat',
  ): Record<string, AgentTaskDirective> {
    const guidance: Record<string, AgentTaskDirective> = {};

    // Default guidance for all agents — Phase 31: use RegimeCalibration for weights
    const allAgents = [...FAST_AGENTS, ...SLOW_AGENTS];
    for (const agent of allAgents) {
      guidance[agent] = {
        priority: 'medium',
        focus: 'Standard analysis',
        questions: [],
        weightMultiplier: getAgentWeightMultiplier(regime, agent),
      };
    }

    // Regime-specific overrides
    switch (regime) {
      case 'trending_up':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Confirm trend continuation. Look for pullback entries near support.',
          questions: ['Is the uptrend accelerating or decelerating?', 'Where is the next support for a pullback entry?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['PatternMatcher'] = {
          priority: 'high',
          focus: 'Look for continuation patterns (flags, pennants, ascending triangles).',
          questions: ['Any bull flag or pennant forming?', 'Is there a measured move target?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Monitor buy-side pressure and institutional accumulation.',
          questions: ['Is buy volume increasing on pullbacks?', 'Any large bid walls forming?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        guidance['SentimentAnalyst'] = {
          priority: 'medium',
          focus: 'Watch for excessive euphoria (contrarian signal).',
          questions: ['Is sentiment becoming dangerously bullish?', 'Any signs of retail FOMO?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'SentimentAnalyst'),
        };
        guidance['WhaleTracker'] = {
          priority: 'high',
          focus: 'Track whale accumulation patterns.',
          questions: ['Are whales still buying?', 'Any large sell orders appearing?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'WhaleTracker'),
        };
        guidance['MacroAnalyst'] = {
          priority: 'medium',
          focus: 'Monitor macro headwinds that could reverse the trend.',
          questions: ['Any macro events that could trigger reversal?', 'Is the macro backdrop supportive?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'MacroAnalyst'),
        };
        guidance['FundingRateAnalyst'] = {
          priority: 'medium',
          focus: 'Monitor funding rates for overleveraged longs.',
          questions: ['Are funding rates excessively positive?', 'Risk of long squeeze?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'FundingRateAnalyst'),
        };
        guidance['MLPredictionAgent'] = {
          priority: 'high',
          focus: 'Predict trend continuation probability and target price.',
          questions: ['What is the probability of trend continuation?', 'Predicted price in 4h/24h?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'MLPredictionAgent'),
        };
        // Lower priority for less relevant agents in uptrend
        guidance['LiquidationHeatmap'] = {
          priority: 'medium',
          focus: 'Identify liquidation clusters above that could accelerate the move.',
          questions: ['Where are the nearest short liquidation clusters?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'LiquidationHeatmap'),
        };
        break;

      case 'trending_down':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Confirm downtrend continuation. Look for bounce entries near resistance.',
          questions: ['Is the downtrend accelerating?', 'Where is the next resistance for a short entry?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['PatternMatcher'] = {
          priority: 'high',
          focus: 'Look for continuation patterns (bear flags, descending triangles).',
          questions: ['Any bear flag or descending triangle?', 'Is there a measured move target?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Monitor sell-side pressure and institutional distribution.',
          questions: ['Is sell volume increasing on bounces?', 'Any large ask walls?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        guidance['SentimentAnalyst'] = {
          priority: 'medium',
          focus: 'Watch for capitulation signals (potential bottom).',
          questions: ['Is sentiment at extreme fear?', 'Any signs of capitulation?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'SentimentAnalyst'),
        };
        guidance['WhaleTracker'] = {
          priority: 'high',
          focus: 'Track whale distribution and exchange inflows.',
          questions: ['Are whales selling?', 'Large exchange deposits detected?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'WhaleTracker'),
        };
        guidance['FundingRateAnalyst'] = {
          priority: 'high',
          focus: 'Monitor funding rates for overleveraged shorts.',
          questions: ['Are funding rates excessively negative?', 'Risk of short squeeze?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'FundingRateAnalyst'),
        };
        guidance['LiquidationHeatmap'] = {
          priority: 'high',
          focus: 'Identify liquidation clusters below that could accelerate the drop.',
          questions: ['Where are the nearest long liquidation clusters?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'LiquidationHeatmap'),
        };
        break;

      case 'range_bound':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Identify range boundaries. Look for mean reversion entries.',
          questions: ['What are the exact support/resistance levels?', 'Is the range tightening (potential breakout)?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['PatternMatcher'] = {
          priority: 'medium',
          focus: 'Look for range breakout patterns (rectangles, triangles).',
          questions: ['Any breakout pattern forming?', 'Which direction is the likely breakout?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Monitor order book for range boundary defense/break.',
          questions: ['Are bids/asks accumulating at range boundaries?', 'Any signs of breakout preparation?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        guidance['SentimentAnalyst'] = {
          priority: 'low',
          focus: 'Monitor for sentiment shift that could trigger breakout.',
          questions: ['Any catalyst that could break the range?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'SentimentAnalyst'),
        };
        guidance['MacroAnalyst'] = {
          priority: 'medium',
          focus: 'Watch for macro catalysts that could end the range.',
          questions: ['Any upcoming events that could trigger a move?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'MacroAnalyst'),
        };
        // In range-bound, reduce weight of trend-following agents
        guidance['MLPredictionAgent'] = {
          priority: 'low',
          focus: 'Predict breakout direction and timing.',
          questions: ['When is the range likely to break?', 'Which direction?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'MLPredictionAgent'),
        };
        break;

      case 'high_volatility':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Focus on key levels. Use wider stops. Identify volatility-adjusted entries.',
          questions: ['What are the key levels that matter in this volatility?', 'Where should stops be placed?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Monitor for panic selling or buying. Look for exhaustion signals.',
          questions: ['Is this panic or institutional activity?', 'Any signs of exhaustion?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        guidance['LiquidationHeatmap'] = {
          priority: 'high',
          focus: 'Critical: identify cascading liquidation risk.',
          questions: ['Where are the liquidation clusters?', 'Risk of cascade?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'LiquidationHeatmap'),
        };
        guidance['FundingRateAnalyst'] = {
          priority: 'high',
          focus: 'Monitor for extreme funding rates indicating leverage flush.',
          questions: ['Are funding rates extreme?', 'Which side is overleveraged?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'FundingRateAnalyst'),
        };
        guidance['WhaleTracker'] = {
          priority: 'high',
          focus: 'Track whale movements — are they buying the dip or dumping?',
          questions: ['Whale buying or selling?', 'Exchange flow direction?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'WhaleTracker'),
        };
        // Reduce noise from less reliable agents in high vol
        guidance['SentimentAnalyst'] = {
          priority: 'low',
          focus: 'Sentiment is unreliable in high volatility. Monitor for extremes only.',
          questions: ['Is sentiment at absolute extreme?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'SentimentAnalyst'),
        };
        guidance['PatternMatcher'] = {
          priority: 'low',
          focus: 'Patterns are unreliable in high volatility. Skip unless very clear.',
          questions: [],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        break;

      case 'breakout':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Confirm breakout validity. Check for false breakout signals.',
          questions: ['Is this a genuine breakout or a fakeout?', 'What is the measured move target?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Confirm breakout with volume and order flow.',
          questions: ['Is volume confirming the breakout?', 'Any absorption at breakout level?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        guidance['VolumeProfileAnalyzer'] = {
          priority: 'high',
          focus: 'Analyze volume profile at breakout level.',
          questions: ['Is volume above average at breakout?', 'Where is the next volume node?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'VolumeProfileAnalyzer'),
        };
        guidance['PatternMatcher'] = {
          priority: 'high',
          focus: 'Identify the pattern that led to breakout and calculate target.',
          questions: ['What pattern broke?', 'What is the measured move target?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        guidance['MLPredictionAgent'] = {
          priority: 'high',
          focus: 'Predict breakout continuation probability.',
          questions: ['Probability of continuation vs. fakeout?', 'Target price?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'MLPredictionAgent'),
        };
        break;

      case 'mean_reverting':
        guidance['TechnicalAnalyst'] = {
          priority: 'high',
          focus: 'Identify reversal signals and mean reversion targets.',
          questions: ['Where is the mean to revert to?', 'Any reversal candlestick patterns?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'TechnicalAnalyst'),
        };
        guidance['SentimentAnalyst'] = {
          priority: 'high',
          focus: 'Confirm extreme sentiment (contrarian opportunity).',
          questions: ['Is sentiment at extreme?', 'Signs of sentiment reversal?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'SentimentAnalyst'),
        };
        guidance['FundingRateAnalyst'] = {
          priority: 'high',
          focus: 'Check for extreme funding rates supporting mean reversion.',
          questions: ['Are funding rates at extreme?', 'Leverage flush imminent?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'FundingRateAnalyst'),
        };
        guidance['OrderFlowAnalyst'] = {
          priority: 'high',
          focus: 'Look for order flow reversal signals.',
          questions: ['Any signs of buying/selling exhaustion?', 'Order flow shifting direction?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'OrderFlowAnalyst'),
        };
        // Trend-following agents should be cautious
        guidance['PatternMatcher'] = {
          priority: 'medium',
          focus: 'Look for reversal patterns (double top/bottom, head and shoulders).',
          questions: ['Any reversal pattern forming?'],
          weightMultiplier: getAgentWeightMultiplier(regime, 'PatternMatcher'),
        };
        break;
    }

    return guidance;
  }

  // ============================================================
  // PRIVATE: Technical Calculations
  // ============================================================

  private sma(data: number[], period: number): number {
    if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    const recent = trs.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  private calculateADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 25; // Default neutral
    
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    const trs: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trs.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }

    // Smoothed averages
    const smoothPlusDM = this.smoothedAverage(plusDMs, period);
    const smoothMinusDM = this.smoothedAverage(minusDMs, period);
    const smoothTR = this.smoothedAverage(trs, period);

    if (smoothTR === 0) return 25;

    const plusDI = (smoothPlusDM / smoothTR) * 100;
    const minusDI = (smoothMinusDM / smoothTR) * 100;
    const diSum = plusDI + minusDI;
    
    if (diSum === 0) return 25;
    
    const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;
    return dx; // Simplified ADX (single DX value from recent data)
  }

  private smoothedAverage(data: number[], period: number): number {
    if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
    const recent = data.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / period;
  }

  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50; // Default neutral
    
    let gains = 0;
    let losses = 0;
    const start = Math.max(0, closes.length - period - 1);
    
    for (let i = start + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateBollingerBands(closes: number[], period: number, stdDevMultiplier: number): {
    upper: number; lower: number; middle: number; bandwidth: number;
  } {
    const middle = this.sma(closes, period);
    const slice = closes.slice(-Math.min(period, closes.length));
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    const upper = middle + stdDev * stdDevMultiplier;
    const lower = middle - stdDev * stdDevMultiplier;
    const bandwidth = middle > 0 ? (upper - lower) / middle : 0;
    return { upper, lower, middle, bandwidth };
  }

  private analyzeVolume(volumes: number[]): VolumeProfile {
    if (volumes.length < 10) return 'stable';
    const recent5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const previous10 = volumes.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
    if (previous10 === 0) return 'stable';
    const ratio = recent5 / previous10;
    if (ratio > 1.3) return 'increasing';
    if (ratio < 0.7) return 'decreasing';
    return 'stable';
  }

  private findSupportResistance(highs: number[], lows: number[], closes: number[]): {
    support: number; resistance: number;
  } {
    if (closes.length < 20) {
      return { support: Math.min(...lows), resistance: Math.max(...highs) };
    }
    // Simple approach: recent swing lows/highs
    const recentLows = lows.slice(-20);
    const recentHighs = highs.slice(-20);
    const support = Math.min(...recentLows);
    const resistance = Math.max(...recentHighs);
    return { support, resistance };
  }

  private classifyVolatility(atr: number, avgATR: number, atrPercent: number): VolatilityClass {
    const ratio = avgATR > 0 ? atr / avgATR : 1.0;
    if (ratio > 2.0 || atrPercent > 5) return 'extreme';
    if (ratio > 1.5 || atrPercent > 3) return 'high';
    if (ratio > 0.8) return 'medium';
    return 'low';
  }

  private calculateTrendStrength(adx: number, priceVsSMA50: number, priceVsSMA200: number): number {
    // ADX contribution (0-1)
    const adxScore = Math.min(1.0, adx / 50);
    // SMA alignment contribution (0-1)
    const smaScore = Math.min(1.0, (Math.abs(priceVsSMA50) + Math.abs(priceVsSMA200)) / 20);
    return adxScore * 0.6 + smaScore * 0.4;
  }

  // ============================================================
  // PRIVATE: Data Access
  // ============================================================

  private async getCandles(symbol: string): Promise<{ open: number; high: number; low: number; close: number; volume: number; timestamp: number }[]> {
    // Try candle cache first (real-time WebSocket-aggregated)
    try {
      const { getCandleCache } = await import('../WebSocketCandleCache');
      const candleCache = getCandleCache();
      const cached = candleCache.getCandles(symbol, '1h');
      if (cached && cached.length >= MIN_CANDLES) {
        return cached;
      }
    } catch {
      // CandleCache not available
    }

    // Fallback to database candles
    try {
      const { loadCandlesFromDatabase } = await import('../db/candleStorage');
      const dbCandles = await loadCandlesFromDatabase(symbol, '1h', IDEAL_CANDLES);
      if (dbCandles && dbCandles.length >= 20) {
        return dbCandles;
      }
    } catch {
      // Database not available
    }

    // Minimal fallback — return empty
    return [];
  }

  private buildMinimalContext(symbol: string, candles: any[]): MarketContext {
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const history = this.regimeHistory.get(symbol) || [];
    
    return {
      regime: 'range_bound',
      regimeConfidence: 0.3,
      previousRegime: history.length > 0 ? history[history.length - 1].regime : null,
      regimeAge: 0,
      volatilityClass: 'medium',
      trendStrength: 0,
      trendDirection: 'flat',
      volumeProfile: 'stable',
      support: 0,
      resistance: 0,
      currentPrice,
      priceVsSMA50: 0,
      priceVsSMA200: 0,
      atr: 0,
      atrPercent: 0,
      adx: 25,
      rsi: 50,
      keyDrivers: ['Insufficient data for regime detection'],
      agentGuidance: this.generateAgentGuidance('range_bound', 'medium', 0, 'flat'),
      timestamp: getActiveClock().now(),
      dataQuality: 'minimal',
      candleCount: candles.length,
    };
  }

  private trackRegimeHistory(symbol: string, regime: MarketRegime): void {
    if (!this.regimeHistory.has(symbol)) {
      this.regimeHistory.set(symbol, []);
    }
    const history = this.regimeHistory.get(symbol)!;
    
    // Only add if regime changed or first entry
    if (history.length === 0 || history[history.length - 1].regime !== regime) {
      history.push({ regime, timestamp: getActiveClock().now() });
      // Keep last 50 regime transitions
      if (history.length > 50) {
        history.shift();
      }
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance: MarketRegimeAI | null = null;

export function getMarketRegimeAI(): MarketRegimeAI {
  if (!instance) {
    instance = new MarketRegimeAI();
  }
  return instance;
}
