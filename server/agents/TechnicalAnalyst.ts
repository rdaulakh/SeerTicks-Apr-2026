import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { ExchangeInterface, MarketData } from "../exchanges";
import { getCandleCache, type Candle } from '../WebSocketCandleCache';
import { getIndicatorCache, calculateRSI, calculateMACD, calculateBollingerBands } from '../utils/IndicatorCache';
import { getDuneProvider, OnChainSignal } from './DuneAnalyticsProvider';
import { agentLogger } from '../utils/logger';

/**
 * Phase 17 — pure confidence math, extracted for testability.
 *
 * The fix: normalize conviction by ACTIVE voting indicators (bullish +
 * bearish) instead of total possible indicators. Reward breadth with a
 * soft activity bonus that keeps "3 of 3 active agree" above "2 of 5
 * active agree" without crushing typical-market confidence.
 *
 * Returns the unclamped-by-adjustments base confidence; downstream logic
 * in `calculateSignalFromTechnicals` still applies overextension / volume
 * / regime modifiers on top.
 */
export function computeTechnicalAnalystConfidence(
  bullishSignals: number,
  bearishSignals: number,
  totalSignals: number,
): number {
  if (totalSignals <= 0) return 0.1;
  const activeVotes = Math.max(bullishSignals, 0) + Math.max(bearishSignals, 0);
  const convictionRatio =
    activeVotes > 0
      ? Math.abs(bullishSignals - bearishSignals) / activeVotes
      : 0;
  const activityBonus = activeVotes / totalSignals; // 0..1
  return Math.min(
    Math.max(convictionRatio * 1.4 * (0.7 + 0.3 * activityBonus), 0.1),
    0.9,
  );
}

/**
 * Technical Analyst Agent
 * Analyzes price patterns, technical indicators, and chart formations
 * 
 * Indicators:
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - Bollinger Bands
 * - Support/Resistance levels
 * - Volume analysis
 * - Trend identification
 */

interface TimeframeTrends {
  '1d': 'bullish' | 'bearish' | 'neutral';
  '4h': 'bullish' | 'bearish' | 'neutral';
  '5m': 'bullish' | 'bearish' | 'neutral';
}

interface TechnicalIndicators {
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number; pctB?: number };
  sma20: number;
  sma50: number;
  sma200: number; // For regime detection
  ema12: number;
  ema26: number;
  volume24h: number;
  volumeChange: number; // percentage
  atr: number; // Average True Range for stop-loss calculation
  avgATR: number; // Average ATR for regime detection
  superTrend: { value: number; direction: 'bullish' | 'bearish'; upperBand: number; lowerBand: number }; // SuperTrend indicator
  vwap: number; // Volume Weighted Average Price
}

interface SupportResistance {
  support: number[];
  resistance: number[];
}

export class TechnicalAnalyst extends AgentBase {
  private exchange: ExchangeInterface | null = null;
  private indicatorCache: Map<string, { indicators: TechnicalIndicators; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute
  private onChainSignalCache: { signal: OnChainSignal; timestamp: number } | null = null;
  private readonly ONCHAIN_CACHE_TTL = 300000; // 5 minutes for on-chain data

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "TechnicalAnalyst",
      enabled: true,
      updateInterval: 0, // Event-driven (triggered by WebSocket trades)
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
  }

  /**
   * Set the exchange adapter for market data
   */
  setExchange(exchange: ExchangeInterface): void {
    this.exchange = exchange;
  }

  protected async initialize(): Promise<void> {
    agentLogger.info('Initializing technical analysis engine', { agent: this.config.name });
  }

  protected async cleanup(): Promise<void> {
    this.indicatorCache.clear();
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    // Note: exchange is optional — agents use CandleCache (from WebSocket ticks)
    // and database fallback for candle data. No REST API calls needed.

    try {
      // Fetch market data from WebSocket cache (no REST API calls)
      const candleCache = getCandleCache();
      const cachedCandles = candleCache.getCandles(symbol, '1h', 200);
      
      // Candles will be assigned in the fallback logic below
      
      // Check if we have enough data
      let candles = cachedCandles.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      
      if (candles.length < 50) {
        agentLogger.warn('Cache insufficient, trying database fallback', { agent: 'TechnicalAnalyst', candleCount: candles.length, required: 50, symbol });
        
        // ONLY use database fallback - NO REST API calls to avoid rate limits
        // WebSocket + TickToCandleAggregator will populate cache over time
        try {
          const { loadCandlesFromDatabase } = await import('../db/candleStorage');
          const dbCandles = await loadCandlesFromDatabase(symbol, '1h', 200);
          if (dbCandles.length >= 50) {
            agentLogger.info('Loaded candles from database', { agent: 'TechnicalAnalyst', count: dbCandles.length, symbol });
            candles = dbCandles;
            
            // Seed the WebSocket cache for future use
            for (const candle of dbCandles) {
              candleCache.addCandle(symbol, '1h', candle, true);
            }
            agentLogger.info('Seeded candles to cache from database', { agent: 'TechnicalAnalyst', count: dbCandles.length });
          }
        } catch (dbError) {
          agentLogger.warn('Database fallback failed', { agent: 'TechnicalAnalyst', error: dbError instanceof Error ? dbError.message : String(dbError) });
        }
        
        // If still not enough data, return neutral signal with explanation
        // TickToCandleAggregator will build candles from WebSocket ticks over time
        if (candles.length < 50) {
          return this.createNeutralSignal(symbol, `Insufficient candles (${candles.length}/50) - waiting for WebSocket to populate cache`);
        }
      }

      // Fetch multi-timeframe data for trend analysis
      const timeframeTrends = await this.analyzeMultipleTimeframes(symbol);

      // Calculate technical indicators
      const indicators = this.calculateIndicators(candles, symbol);

      // Identify support/resistance
      const sr = this.findSupportResistance(candles);

      // Get current price
      const currentPrice = candles[candles.length - 1].close;

      // Calculate signal (NO LLM - pure math for millisecond response)
      let { signal, confidence, strength, reasoning } = this.calculateSignalFromTechnicals(
        indicators,
        sr,
        currentPrice,
        "" // No LLM analysis for fast agents
      );

      // Apply real-time price deviation adjustment (micro-adjustments for live feel)
      // This gives small confidence changes as price moves, while respecting core indicators
      const priceDeviationAdjustment = this.calculatePriceDeviationAdjustment(
        currentPrice,
        indicators,
        sr,
        signal
      );
      // Phase 96 — cap stacked bonuses at 0.85 (was 0.95). Forensic audit
      // found 55% of signals saturating near 0.95 due to Dune+MTF+regime
      // bonuses stacking on top of the 0.9 base cap from
      // computeTechnicalAnalystConfidence. Hard ceiling at 0.85 across all
      // bonus stages prevents the saturation.
      confidence = Math.max(0.05, Math.min(0.85, confidence + priceDeviationAdjustment));

      // Apply multi-timeframe bonus
      const bonusResult = this.applyTimeframeBonus(confidence, signal, timeframeTrends, reasoning);
      confidence = Math.min(0.85, bonusResult.confidence);
      reasoning = bonusResult.reasoning;

      // Apply Dune Analytics on-chain signal integration
      const onChainResult = await this.applyOnChainSignalBonus(signal, confidence, strength, reasoning);
      signal = onChainResult.signal;
      // Phase 96 — clamp post-Dune confidence to 0.85 stacked ceiling.
      confidence = Math.min(0.85, onChainResult.confidence);
      strength = onChainResult.strength;
      reasoning = onChainResult.reasoning;

      // Phase 30: Apply MarketContext regime adjustments
      // TechnicalAnalyst uses regime to adjust signal interpretation
      if (context?.regime) {
        const regime = context.regime as string;
        const regimeConfidence = (context.regimeConfidence as number) || 0.5;
        
        // In trending markets: boost trend-following signals, dampen counter-trend
        if ((regime === 'trending_up' && signal === 'bullish') || (regime === 'trending_down' && signal === 'bearish')) {
          confidence = Math.min(0.85, confidence * (1 + 0.1 * regimeConfidence));
          reasoning += ` [Regime: ${regime} confirms direction, confidence boosted]`;
        } else if ((regime === 'trending_up' && signal === 'bearish') || (regime === 'trending_down' && signal === 'bullish')) {
          // Counter-trend signal in strong trend — reduce confidence
          confidence *= (1 - 0.15 * regimeConfidence);
          reasoning += ` [Regime: ${regime} contradicts signal, confidence reduced]`;
        }
        
        // In high volatility: widen neutral zone, require stronger signals
        if (regime === 'high_volatility' && signal !== 'neutral') {
          confidence *= 0.85;
          reasoning += ' [High volatility regime: confidence dampened]';
        }
        
        // In range-bound: boost mean-reversion signals near boundaries
        if (regime === 'range_bound' && context.support && context.resistance) {
          const range = (context.resistance as number) - (context.support as number);
          const posInRange = range > 0 ? (currentPrice - (context.support as number)) / range : 0.5;
          if (signal === 'bullish' && posInRange < 0.25) {
            confidence = Math.min(0.85, confidence * 1.15);
            reasoning += ' [Near range support: bullish signal boosted]';
          } else if (signal === 'bearish' && posInRange > 0.75) {
            confidence = Math.min(0.85, confidence * 1.15);
            reasoning += ' [Near range resistance: bearish signal boosted]';
          }
        }
      }

      // Phase 33: Incorporate task-specific questions from MarketRegimeAI
      // These questions guide the agent's analysis focus based on current regime
      if (context?.taskQuestions?.length > 0) {
        const taskAnswers: string[] = [];
        for (const question of context.taskQuestions as string[]) {
          const answer = this.answerTaskQuestion(question, indicators, sr, currentPrice, signal, timeframeTrends);
          if (answer) taskAnswers.push(answer);
        }
        if (taskAnswers.length > 0) {
          reasoning += ` [Task Analysis: ${taskAnswers.join('; ')}]`;
        }
      }
      if (context?.taskFocus) {
        reasoning += ` [Focus: ${context.taskFocus}]`;
      }

      // Calculate execution score (0-100) - tactical timing quality
      const executionScore = this.calculateExecutionScore(
        currentPrice,
        indicators,
        sr,
        signal
      );

      const processingTime = getActiveClock().now() - startTime;
      const dataFreshness = (getActiveClock().now() - candles[candles.length - 1].timestamp) / 1000;

      // Phase 96 — final hard cap at 0.85 to defend against any future bonus
      // stages that might push above the stacked ceiling.
      confidence = Math.max(0.05, Math.min(0.85, confidence));

      // Debug log execution score
      agentLogger.debug('Execution score calculated', { agent: 'TechnicalAnalyst', symbol, executionScore, signal, confidence: (confidence * 100).toFixed(1) + '%' });

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence,
        strength,
        executionScore,
        reasoning,
        evidence: {
          rsi: indicators.rsi,
          macd: indicators.macd,
          bollingerBands: indicators.bollingerBands,
          // Phase 93.18 — surface bbPctB at the top level so SensorWiring's
          // `ev.bbPctB` lookup actually populates Sensorium (was always 0.5).
          // Fall back to deriving from band edges if the cache doesn't carry it.
          bbPctB: typeof (indicators.bollingerBands as any)?.pctB === 'number'
            ? (indicators.bollingerBands as any).pctB
            : (() => {
                const w = indicators.bollingerBands.upper - indicators.bollingerBands.lower;
                return w > 0 ? (currentPrice - indicators.bollingerBands.lower) / w : 0.5;
              })(),
          superTrend: indicators.superTrend,
          // Phase 93.18 — VWAP is stored as a price number; deviation is
          // computed against the spot price. SensorWiring reads
          // `ev.vwapDeviation` for `technical.vwapDevPct`.
          vwap: indicators.vwap,
          vwapDeviation:
            indicators.vwap && indicators.vwap > 0
              ? ((currentPrice - indicators.vwap) / indicators.vwap) * 100
              : 0,
          ema: {
            trend:
              indicators.ema12 > indicators.ema26
                ? 'up'
                : indicators.ema12 < indicators.ema26
                  ? 'down'
                  : 'flat',
            ema12: indicators.ema12,
            ema26: indicators.ema26,
          },
          currentPrice,
          sma20: indicators.sma20,
          sma50: indicators.sma50,
          support: sr.support,
          resistance: sr.resistance,
          volumeChange: indicators.volumeChange,
          timeframeTrends,
          atr: indicators.atr,
          avgATR: indicators.avgATR,
        },
        qualityScore: this.calculateQualityScore(candles, dataFreshness),
        processingTime,
        dataFreshness,
        recommendation: this.getRecommendation(signal, confidence, strength, currentPrice, sr),
        exitRecommendation: this.calculateExitRecommendation(signal, confidence, indicators, currentPrice, sr),
      };
    } catch (error) {
      agentLogger.error('Analysis failed', { agent: this.config.name, error: error instanceof Error ? error.message : String(error) });
      return this.createNeutralSignal(symbol, `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Phase 33: Answer regime-specific task questions using available indicators.
   * Returns a concise answer string or null if the question can't be answered.
   */
  private answerTaskQuestion(
    question: string,
    indicators: TechnicalIndicators,
    sr: SupportResistance,
    currentPrice: number,
    signal: 'bullish' | 'bearish' | 'neutral',
    timeframeTrends: TimeframeTrends
  ): string | null {
    const q = question.toLowerCase();

    // Trend continuation/deceleration questions
    if (q.includes('accelerat') || q.includes('decelerat')) {
      const macdTrend = indicators.macd.histogram > 0 ? 'accelerating' : 'decelerating';
      return `Trend ${macdTrend} (MACD histogram: ${indicators.macd.histogram.toFixed(2)})`;
    }

    // Support/resistance level questions
    if (q.includes('support') || q.includes('resistance') || q.includes('key level')) {
      const nearestSupport = sr.support[0] || 0;
      const nearestResistance = sr.resistance[0] || 0;
      return `Support: $${nearestSupport.toFixed(2)}, Resistance: $${nearestResistance.toFixed(2)}`;
    }

    // Pullback entry questions
    if (q.includes('pullback') || q.includes('entry')) {
      const distToSMA20 = ((currentPrice - indicators.sma20) / indicators.sma20 * 100).toFixed(1);
      return `Price ${parseFloat(distToSMA20) > 0 ? 'above' : 'below'} SMA20 by ${distToSMA20}%`;
    }

    // Stop placement questions
    if (q.includes('stop') || q.includes('where should')) {
      const atrStop = signal === 'bullish'
        ? currentPrice - indicators.atr * 2
        : currentPrice + indicators.atr * 2;
      return `ATR-based stop: $${atrStop.toFixed(2)} (2x ATR: $${(indicators.atr * 2).toFixed(2)})`;
    }

    // Breakout/fakeout questions
    if (q.includes('breakout') || q.includes('fakeout') || q.includes('genuine')) {
      const volumeConfirm = indicators.volumeChange > 20 ? 'Volume confirms' : 'Volume weak';
      const adxConfirm = indicators.avgATR > 0 && indicators.atr / indicators.avgATR > 1.2 ? 'ATR expanding' : 'ATR normal';
      return `${volumeConfirm}, ${adxConfirm}`;
    }

    // Pattern questions
    if (q.includes('pattern') || q.includes('flag') || q.includes('pennant') || q.includes('triangle')) {
      const bb = indicators.bollingerBands;
      const bandwidth = bb.upper > 0 ? ((bb.upper - bb.lower) / bb.middle * 100).toFixed(1) : '0';
      return `BB bandwidth: ${bandwidth}% (${parseFloat(bandwidth) < 5 ? 'squeeze/consolidation' : 'expanding'})`;
    }

    // Reversal questions
    if (q.includes('reversal') || q.includes('mean') || q.includes('revert')) {
      const rsiExtreme = indicators.rsi > 70 ? 'overbought' : indicators.rsi < 30 ? 'oversold' : 'neutral';
      return `RSI: ${indicators.rsi.toFixed(1)} (${rsiExtreme}), Mean target: $${indicators.sma50.toFixed(2)}`;
    }

    // Measured move / target questions
    if (q.includes('target') || q.includes('measured move')) {
      const range = (sr.resistance[0] || currentPrice) - (sr.support[0] || currentPrice);
      const target = signal === 'bullish'
        ? currentPrice + range
        : currentPrice - range;
      return `Measured move target: $${target.toFixed(2)}`;
    }

    // Exhaustion questions
    if (q.includes('exhaust')) {
      const rsiExtreme = indicators.rsi > 75 || indicators.rsi < 25;
      const volumeDecline = indicators.volumeChange < -10;
      return `${rsiExtreme ? 'RSI at extreme' : 'RSI normal'}, ${volumeDecline ? 'Volume declining (possible exhaustion)' : 'Volume stable'}`;
    }

    // Timeframe alignment
    if (q.includes('timeframe') || q.includes('multi-timeframe')) {
      return `1D: ${timeframeTrends['1d']}, 4H: ${timeframeTrends['4h']}, 5M: ${timeframeTrends['5m']}`;
    }

    return null;
  }

  protected async periodicUpdate(): Promise<void> {
    // Clear old cache entries
    const now = getActiveClock().now();
    for (const [key, value] of Array.from(this.indicatorCache.entries())) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.indicatorCache.delete(key);
      }
    }
  }

  /**
   * Calculate all technical indicators with caching
   * Only recalculates when new candle closes (10× performance improvement)
   */
  private calculateIndicators(candles: MarketData[], symbolParam?: string): TechnicalIndicators {
    if (candles.length === 0) {
      throw new Error('No candles available for indicator calculation');
    }

    // Check indicator cache first
    const indicatorCache = getIndicatorCache();
    const latestCandleTimestamp = candles[candles.length - 1].timestamp;
    const symbol = symbolParam || 'BTCUSDT';
    const interval = '1h';

    // Try to get from cache
    const cached = indicatorCache.get(symbol, interval, latestCandleTimestamp);
    if (cached) {
      agentLogger.debug('Using cached indicators', { agent: 'TechnicalAnalyst', interval });
      // Still need to calculate other indicators not in cache
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);
      const atr = this.calculateATR(candles, 14);
      const avgATR = this.calculateATR(candles.slice(-50), 14);
      const superTrend = this.calculateSuperTrend(candles, 10, 2.5); // Reduced from 3.0 for more responsive trend detection
      const vwap = this.calculateVWAP(candles);

      return {
        rsi: cached.rsi,
        macd: { value: cached.macd.macd, signal: cached.macd.signal, histogram: cached.macd.histogram },
        bollingerBands: cached.bollingerBands,
        sma20: this.calculateSMA(closes, 20),
        sma50: this.calculateSMA(closes, 50),
        sma200: candles.length >= 200 ? this.calculateSMA(closes, 200) : this.calculateSMA(closes, Math.min(closes.length, 50)),
        ema12: this.calculateEMA(closes, 12),
        ema26: this.calculateEMA(closes, 26),
        volume24h: volumes.slice(-24).reduce((sum, v) => sum + v, 0),
        volumeChange: this.calculateVolumeChange(volumes),
        atr,
        avgATR,
        superTrend,
        vwap,
      };
    }

    // Cache miss - calculate fresh
    agentLogger.debug('Calculating fresh indicators', { agent: 'TechnicalAnalyst', interval });
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // Calculate ATR (Average True Range)
    const atr = this.calculateATR(candles, 14);
    const avgATR = this.calculateATR(candles.slice(-50), 14);

    // Convert to Candle format for indicator functions
    const candleFormat = candles.map(c => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Calculate and cache expensive indicators
    const rsi = calculateRSI(candleFormat, 14);
    const macd = calculateMACD(candleFormat, 12, 26, 9);
    const bollingerBands = calculateBollingerBands(candleFormat, 20, 2);

    // Store in cache
    indicatorCache.set(symbol, interval, {
      rsi,
      macd,
      bollingerBands,
      lastCandleTimestamp: latestCandleTimestamp,
    });

    // Calculate SuperTrend and VWAP
    const superTrend = this.calculateSuperTrend(candles, 10, 2.5); // Reduced from 3.0 for more responsive trend detection
    const vwap = this.calculateVWAP(candles);

    return {
      rsi,
      macd: { value: macd.macd, signal: macd.signal, histogram: macd.histogram },
      bollingerBands,
      sma20: this.calculateSMA(closes, 20),
      sma50: this.calculateSMA(closes, 50),
      sma200: candles.length >= 200 ? this.calculateSMA(closes, 200) : this.calculateSMA(closes, Math.min(closes.length, 50)),
      ema12: this.calculateEMA(closes, 12),
      ema26: this.calculateEMA(closes, 26),
      volume24h: volumes.slice(-24).reduce((sum, v) => sum + v, 0),
      volumeChange: this.calculateVolumeChange(volumes),
      atr,
      avgATR,
      superTrend,
      vwap,
    };
  }

  /**
   * Calculate RSI
   */
  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate MACD
   */
  private calculateMACD(prices: number[]): { value: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    const macdValues = prices.slice(-26).map((_, i) => {
      const slice = prices.slice(0, prices.length - 26 + i + 1);
      const e12 = this.calculateEMA(slice, 12);
      const e26 = this.calculateEMA(slice, 26);
      return e12 - e26;
    });

    const signalLine = this.calculateEMA(macdValues, 9);
    const histogram = macdLine - signalLine;

    return {
      value: macdLine,
      signal: signalLine,
      histogram,
    };
  }

  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(
    prices: number[],
    period: number,
    stdDev: number
  ): { upper: number; middle: number; lower: number } {
    const sma = this.calculateSMA(prices, period);
    const slice = prices.slice(-period);
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);

    return {
      upper: sma + (sd * stdDev),
      middle: sma,
      lower: sma - (sd * stdDev),
    };
  }

  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    const slice = prices.slice(-period);
    return slice.reduce((sum, price) => sum + price, 0) / period;
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(0, period), period);

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate volume change percentage
   */
  private calculateVolumeChange(volumes: number[]): number {
    if (volumes.length < 2) return 0;

    const recent = volumes.slice(-10).reduce((sum, v) => sum + v, 0) / 10;
    const previous = volumes.slice(-20, -10).reduce((sum, v) => sum + v, 0) / 10;

    return ((recent - previous) / previous) * 100;
  }

  /**
   * Find support and resistance levels
   */
  private findSupportResistance(candles: MarketData[]): SupportResistance {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Simple pivot point calculation
    const currentPrice = candles[candles.length - 1].close;
    const recentHigh = Math.max(...highs.slice(-50));
    const recentLow = Math.min(...lows.slice(-50));

    const pivot = (recentHigh + recentLow + currentPrice) / 3;

    return {
      resistance: [
        pivot + (recentHigh - recentLow),
        pivot + (recentHigh - recentLow) * 0.618,
        recentHigh,
      ].sort((a, b) => a - b),
      support: [
        pivot - (recentHigh - recentLow),
        pivot - (recentHigh - recentLow) * 0.618,
        recentLow,
      ].sort((a, b) => b - a),
    };
  }

  // LLM analysis removed - TechnicalAnalyst uses pure math for millisecond response times

  /**
   * Calculate signal from technicals
   */
  private calculateSignalFromTechnicals(
    indicators: TechnicalIndicators,
    sr: SupportResistance,
    currentPrice: number,
    analysis: string
  ): {
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    strength: number;
    reasoning: string;
  } {
    let bullishSignals = 0;
    let bearishSignals = 0;
    let totalSignals = 0;

    // RSI analysis
    // Phase 47 fix — thresholds were 25/75 which almost never fire on
    // 15-min crypto bars (live audit found 100% neutral output). Backtest
    // stub used 30/70 and matched the +20%-return champion. Aligning.
    totalSignals++;
    if (indicators.rsi < 30) bullishSignals++; // Oversold
    else if (indicators.rsi > 70) bearishSignals++; // Overbought

    // MACD analysis
    totalSignals++;
    if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
      bullishSignals++;
    } else if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
      bearishSignals++;
    }

    // Moving average analysis
    totalSignals++;
    if (currentPrice > indicators.sma20 && indicators.sma20 > indicators.sma50) {
      bullishSignals++;
    } else if (currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) {
      bearishSignals++;
    }

    // Bollinger Bands analysis
    totalSignals++;
    if (currentPrice < indicators.bollingerBands.lower) bullishSignals++; // Oversold
    else if (currentPrice > indicators.bollingerBands.upper) bearishSignals++; // Overbought

    // SuperTrend analysis (strong trend-following signal)
    totalSignals++;
    if (indicators.superTrend.direction === 'bullish' && currentPrice > indicators.superTrend.value) {
      bullishSignals++;
    } else if (indicators.superTrend.direction === 'bearish' && currentPrice < indicators.superTrend.value) {
      bearishSignals++;
    }

    // VWAP analysis (institutional benchmark)
    totalSignals++;
    const vwapDeviation = ((currentPrice - indicators.vwap) / indicators.vwap) * 100;
    if (currentPrice > indicators.vwap && vwapDeviation > 0.5) {
      bullishSignals++; // Price above VWAP = bullish bias
    } else if (currentPrice < indicators.vwap && vwapDeviation < -0.5) {
      bearishSignals++; // Price below VWAP = bearish bias
    }

    // Volume analysis (institutional requirement: volume must confirm trend)
    totalSignals++;
    let volumeConfirmation = false;
    if (indicators.volumeChange > 20) {
      // High volume supports the trend
      volumeConfirmation = true;
      if (bullishSignals > bearishSignals) bullishSignals++;
      else if (bearishSignals > bullishSignals) bearishSignals++;
    } else if (indicators.volumeChange < -20) {
      // Low volume weakens the trend (reduce confidence later)
      volumeConfirmation = false;
    }

    // Determine signal with TREND CONFIRMATION FILTER.
    // `netSignal` — normalized over ALL 7 indicators — stays the gate for
    // directional call (bullish/bearish/neutral) because the whole-slate
    // framing is the right bar to clear for the decision: we DO want to
    // stay neutral when most indicators are quiet, even if the few that
    // spoke up agree.
    const netSignal = (bullishSignals - bearishSignals) / totalSignals;
    let signal: "bullish" | "bearish" | "neutral";

    // TREND CONFIRMATION:
    // Phase 47 fix — old `MIN_CONFIRMING_SIGNALS=2 + |netSignal|>0.20`
    // gates required 2-of-7 indicators agreeing AND a 2-vote net spread.
    // On normal RSI (35-65) range most indicators stay silent so a typical
    // bar yields 1 bull + 1 bear → tied → neutral. Live audit found 100%
    // neutral output. Backtest stub (which produced the +20% champion)
    // required only ONE confirming signal at netSignal>0.10. Aligning.
    const MIN_CONFIRMING_SIGNALS = 1;

    if (netSignal > 0.10 && bullishSignals >= MIN_CONFIRMING_SIGNALS) {
      signal = "bullish";
    } else if (netSignal < -0.10 && bearishSignals >= MIN_CONFIRMING_SIGNALS) {
      signal = "bearish";
    } else {
      signal = "neutral";
    }

    // Phase 17 — confidence must reflect CONVICTION among voting indicators,
    // not fraction of ALL possible indicators. On a typical bar, most
    // indicators stay silent (RSI between 25-75, price inside Bollinger, no
    // SuperTrend flip, etc.) so only 2-4 of the 7 actually commit to a
    // direction. The old formula `abs(netSignal) * 1.4` where netSignal was
    // `(bull-bear)/7` collapsed confidence on real setups:
    //
    //    3 bullish, 1 bearish, 3 silent  →  netSignal = 2/7 = 0.286
    //      → confidence = 0.40  ← below the 0.65 consensus bar every time.
    //
    // This is why Phase 16's backtest showed TechnicalAnalyst at 0% pass rate
    // against threshold 0.50 — the agent was producing directionally correct
    // signals but mathematically pinned below the bar. The fix: compute a
    // conviction ratio among active voters, use that for confidence. Keep a
    // small `activityBonus` so "3 of 3 active agree" scores higher than
    // "2 of 5 active agree" — we still reward breadth, just without
    // penalizing normal silence.
    //
    //    3 bullish, 1 bearish, 3 silent  →  convictionRatio = 2/4 = 0.50,
    //      activeVotes = 4/7 = 0.57  →  confidence = 0.50×1.4×(0.7+0.3×0.57)
    //      ≈ 0.61  ← clears threshold; still conservative vs unanimous.
    //    4 bullish, 0 bearish, 3 silent  →  confidence ≈ 0.83
    //    5 bullish, 0 bearish, 2 silent  →  confidence ≈ 0.90 (capped)
    //    2 bullish, 1 bearish, 4 silent  →  convictionRatio = 1/3 = 0.33
    //      activeVotes = 3/7 = 0.43  →  confidence ≈ 0.37 (still low — good;
    //      weak conviction stays low-confidence)
    let confidence = computeTechnicalAnalystConfidence(
      bullishSignals,
      bearishSignals,
      totalSignals,
    );
    const strength = Math.min(Math.abs(netSignal) * 1.5, 1.0);

    // OVEREXTENSION → MEAN REVERSION CALL (Phase 96 fix for F5)
    //
    // Forensic finding: previous logic silenced bullish-at-top by downgrading
    // to NEUTRAL with `confidence *= 0.6`. Result: 0 bearish signals in 3h of
    // production data, 41.5% of output stacked at exactly conf=0.4608.
    //
    // The market being overbought is itself a BEARISH (mean-reversion) signal,
    // not a reason to be silent. Symmetric for oversold → bullish reversal.
    //
    // Strong evidence (3 of 3): emit the opposite-direction reversal call.
    // Mild (1-2 of 3): keep neutral but with a flat low confidence (0.4),
    // not multiplied off a saturated ceiling.
    //
    // We derive bbPctB from the band edges to apply the threshold uniformly
    // regardless of whether the indicator pipeline pre-populated it.
    const bbWidth = indicators.bollingerBands.upper - indicators.bollingerBands.lower;
    const bbPctB =
      typeof (indicators.bollingerBands as any)?.pctB === 'number'
        ? (indicators.bollingerBands as any).pctB as number
        : bbWidth > 0
          ? (currentPrice - indicators.bollingerBands.lower) / bbWidth
          : 0.5;

    if (signal === "bullish") {
      const overboughtRsi = indicators.rsi > 70;
      const overboughtBb = bbPctB > 1.05;
      const overboughtVwap = vwapDeviation > 1.5;
      const overboughtVotes = (overboughtRsi ? 1 : 0) + (overboughtBb ? 1 : 0) + (overboughtVwap ? 1 : 0);
      if (overboughtVotes === 3) {
        // Strong mean-reversion: flip to BEARISH reversal call
        const reversalConfidence = Math.max(0.5, confidence * 0.7);
        signal = "bearish";
        confidence = reversalConfidence;
        agentLogger.debug('Overextension → bearish reversal call', {
          agent: 'TechnicalAnalyst',
          rsi: indicators.rsi.toFixed(1),
          bbPctB: bbPctB.toFixed(3),
          vwapDev: vwapDeviation.toFixed(2),
          confidence: reversalConfidence.toFixed(3),
        });
      } else if (overboughtVotes >= 1) {
        // Mild overextension: neutral with flat low confidence (not ceiling × 0.6)
        signal = "neutral";
        confidence = 0.4;
      }
    } else if (signal === "bearish") {
      const oversoldRsi = indicators.rsi < 30;
      const oversoldBb = bbPctB < -0.05;
      const oversoldVwap = vwapDeviation < -1.5;
      const oversoldVotes = (oversoldRsi ? 1 : 0) + (oversoldBb ? 1 : 0) + (oversoldVwap ? 1 : 0);
      if (oversoldVotes === 3) {
        const reversalConfidence = Math.max(0.5, confidence * 0.7);
        signal = "bullish";
        confidence = reversalConfidence;
        agentLogger.debug('Oversold → bullish reversal call', {
          agent: 'TechnicalAnalyst',
          rsi: indicators.rsi.toFixed(1),
          bbPctB: bbPctB.toFixed(3),
          vwapDev: vwapDeviation.toFixed(2),
          confidence: reversalConfidence.toFixed(3),
        });
      } else if (oversoldVotes >= 1) {
        signal = "neutral";
        confidence = 0.4;
      }
    }
    
    // Reduce confidence if volume doesn't confirm trend (institutional standard)
    if (!volumeConfirmation && signal !== 'neutral') {
      confidence = confidence * 0.85; // -15% penalty for lack of volume confirmation
    }

    const vwapPosition = currentPrice > indicators.vwap ? 'above' : 'below';
    const vwapDevPct = (((currentPrice - indicators.vwap) / indicators.vwap) * 100).toFixed(2);
    const reasoning = `Technical analysis: RSI=${indicators.rsi.toFixed(0)}, MACD ${indicators.macd.histogram > 0 ? 'bullish' : 'bearish'}, SuperTrend ${indicators.superTrend.direction}, Price ${currentPrice > indicators.sma20 ? 'above' : 'below'} SMA(20) and ${vwapPosition} VWAP (${vwapDevPct}%). ${bullishSignals} bullish signals, ${bearishSignals} bearish signals. ${analysis}`;

    return { signal, confidence, strength, reasoning };
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(candles: MarketData[], dataFreshness: number): number {
    const dataVolumeScore = Math.min(candles.length / 200, 1.0);
    const freshnessScore = Math.max(1 - (dataFreshness / 300), 0); // Decay over 5 minutes

    return (dataVolumeScore * 0.6 + freshnessScore * 0.4);
  }

  /**
   * Get recommendation
   */
  private getRecommendation(
    signal: "bullish" | "bearish" | "neutral",
    confidence: number,
    strength: number,
    currentPrice: number,
    sr: SupportResistance
  ): AgentSignal["recommendation"] {
    if (signal === "neutral" || confidence < 0.5) {
      return {
        action: "hold",
        urgency: "low",
      };
    }

    const urgency = strength > 0.7 ? "high" : strength > 0.4 ? "medium" : "low";

    if (signal === "bullish") {
      return {
        action: confidence > 0.7 ? "buy" : "hold",
        urgency,
        targetPrice: sr.resistance[0],
        stopLoss: sr.support[0],
      };
    } else {
      return {
        action: confidence > 0.7 ? "sell" : "reduce",
        urgency,
        targetPrice: sr.support[0],
        stopLoss: sr.resistance[0],
      };
    }
  }

  /**
   * Analyze multiple timeframes for trend confirmation
   * Fetches 1D, 4H, 5M candles and determines trend for each
   */
  private async analyzeMultipleTimeframes(symbol: string): Promise<TimeframeTrends> {
    try {
      // Fetch candles for each timeframe from WebSocket cache (no REST API calls)
      const candleCache = getCandleCache();
      const cached1d = candleCache.getCandles(symbol, '1d', 50);
      const cached4h = candleCache.getCandles(symbol, '4h', 100);
      const cached5m = candleCache.getCandles(symbol, '5m', 100);
      
      // Convert to exchange format
      const candles1d = cached1d.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      const candles4h = cached4h.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      const candles5m = cached5m.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));

      return {
        '1d': this.determineTrend(candles1d),
        '4h': this.determineTrend(candles4h),
        '5m': this.determineTrend(candles5m),
      };
    } catch (error) {
      agentLogger.error('Multi-timeframe analysis failed', { agent: this.config.name, error: error instanceof Error ? error.message : String(error) });
      return { '1d': 'neutral', '4h': 'neutral', '5m': 'neutral' };
    }
  }

  /**
   * Determine trend for a timeframe using SMA crossover and momentum
   */
  private determineTrend(candles: MarketData[]): 'bullish' | 'bearish' | 'neutral' {
    if (candles.length < 50) {
      return 'neutral';
    }

    const closes = candles.map(c => c.close);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = closes[closes.length - 1];

    // Calculate momentum (last 10 candles)
    const recentCloses = closes.slice(-10);
    const momentum = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];

    // Bullish: SMA(20) > SMA(50), price > SMA(20), positive momentum
    const bullishConditions = [
      sma20 > sma50,
      currentPrice > sma20,
      momentum > 0,
    ];

    // Bearish: SMA(20) < SMA(50), price < SMA(20), negative momentum
    const bearishConditions = [
      sma20 < sma50,
      currentPrice < sma20,
      momentum < 0,
    ];

    const bullishCount = bullishConditions.filter(Boolean).length;
    const bearishCount = bearishConditions.filter(Boolean).length;

    if (bullishCount >= 2) return 'bullish';
    if (bearishCount >= 2) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate real-time price deviation adjustment
   * Applies micro-adjustments (+/- 5%) based on current price movement relative to key levels
   * This creates natural variation while maintaining indicator-based signals
   */
  private calculatePriceDeviationAdjustment(
    currentPrice: number,
    indicators: TechnicalIndicators,
    sr: SupportResistance,
    signal: 'bullish' | 'bearish' | 'neutral'
  ): number {
    if (signal === 'neutral') return 0;

    // Calculate distance from Bollinger Bands (normalized to 0-1)
    const bbRange = indicators.bollingerBands.upper - indicators.bollingerBands.lower;
    const distanceFromMiddle = (currentPrice - indicators.bollingerBands.middle) / bbRange;

    // Calculate distance from support/resistance
    const nearestSupport = sr.support[0] || currentPrice * 0.95;
    const nearestResistance = sr.resistance[0] || currentPrice * 1.05;
    const srRange = nearestResistance - nearestSupport;
    const distanceFromSupport = (currentPrice - nearestSupport) / srRange;

    // For bullish signals: increase confidence as price moves up toward resistance
    // For bearish signals: increase confidence as price moves down toward support
    let adjustment = 0;

    if (signal === 'bullish') {
      // Bullish: higher confidence when price is near support (bounce opportunity)
      // or breaking through resistance (momentum)
      if (distanceFromSupport < 0.3) {
        adjustment = 0.03; // +3% near support
      } else if (distanceFromSupport > 0.7) {
        adjustment = 0.05; // +5% near resistance (breakout)
      }
      // Add Bollinger Band factor
      if (distanceFromMiddle < -0.5) {
        adjustment += 0.02; // +2% in lower BB (oversold)
      }
    } else if (signal === 'bearish') {
      // Bearish: higher confidence when price is near resistance (rejection)
      // or breaking through support (breakdown)
      if (distanceFromSupport > 0.7) {
        adjustment = 0.03; // +3% near resistance
      } else if (distanceFromSupport < 0.3) {
        adjustment = 0.05; // +5% near support (breakdown)
      }
      // Add Bollinger Band factor
      if (distanceFromMiddle > 0.5) {
        adjustment += 0.02; // +2% in upper BB (overbought)
      }
    }

    // Add small deterministic variation based on timestamp
    // Uses sine wave to create natural-looking variation without randomness
    const timeVariation = Math.sin(getActiveClock().now() / 60000) * 0.01; // ±1% oscillation over ~1 min

    return adjustment + timeVariation;
  }

  /**
   * Apply timeframe alignment bonus to confidence
   * Returns +10% bonus when all timeframes align with signal direction
   */
  private applyTimeframeBonus(
    confidence: number,
    signal: 'bullish' | 'bearish' | 'neutral',
    timeframeTrends: TimeframeTrends,
    reasoning: string
  ): { confidence: number; reasoning: string } {
    if (signal === 'neutral') {
      return { confidence, reasoning };
    }

    const trends = [timeframeTrends['1d'], timeframeTrends['4h'], timeframeTrends['5m']];
    const alignedCount = trends.filter(t => t === signal).length;

    let bonus = 0;
    let bonusReasoning = '';

    if (alignedCount === 3) {
      // All 3 timeframes aligned
      bonus = 0.10; // +10% bonus
      bonusReasoning = `🎯 Multi-timeframe alignment: All 3 timeframes ${signal} (+10% bonus). `;
    } else if (alignedCount === 2) {
      // 2 timeframes aligned
      bonus = 0.05; // +5% bonus
      bonusReasoning = `Multi-timeframe: 2/3 timeframes ${signal} (+5% bonus). `;
    } else {
      bonusReasoning = `Timeframes: 1D ${timeframeTrends['1d']}, 4H ${timeframeTrends['4h']}, 5M ${timeframeTrends['5m']}. `;
    }

    const newConfidence = Math.min(confidence + bonus, 1.0); // Cap at 100%

    return {
      confidence: newConfidence,
      reasoning: bonusReasoning + reasoning,
    };
  }

  /**
   * Calculate execution score (0-100) - Institutional-grade timing layer
   * Measures tactical entry/exit quality based on:
   * - Proximity to key support/resistance levels
   * - Volume confirmation
   * - Momentum acceleration
   * - Volatility regime
   */
  private calculateExecutionScore(
    currentPrice: number,
    indicators: TechnicalIndicators,
    sr: SupportResistance,
    signal: 'bullish' | 'bearish' | 'neutral'
  ): number {
    let score = 50; // Base score (neutral)

    // 1. Proximity to Key Levels (0-30 points)
    const allLevels = [...sr.support, ...sr.resistance];
    if (allLevels.length > 0) {
      const closestLevel = allLevels.reduce((closest, level) => {
        const distance = Math.abs(currentPrice - level);
        const closestDistance = Math.abs(currentPrice - closest);
        return distance < closestDistance ? level : closest;
      });
      
      const distancePercent = Math.abs((currentPrice - closestLevel) / currentPrice) * 100;
      
      // Closer to key level = higher urgency
      if (distancePercent < 0.5) {
        score += 30; // Very close (< 0.5%)
      } else if (distancePercent < 1.0) {
        score += 20; // Close (0.5-1%)
      } else if (distancePercent < 2.0) {
        score += 10; // Moderate (1-2%)
      }
    }

    // 2. Volume Confirmation (0-25 points)
    if (indicators.volumeChange > 50) {
      score += 25; // Strong volume spike
    } else if (indicators.volumeChange > 20) {
      score += 15; // Moderate volume increase
    } else if (indicators.volumeChange > 0) {
      score += 5; // Slight volume increase
    } else if (indicators.volumeChange < -30) {
      score -= 15; // Low volume (weak signal)
    }

    // 3. Momentum Acceleration (0-25 points)
    const macdStrength = Math.abs(indicators.macd.histogram);
    if (macdStrength > 500) {
      score += 25; // Strong momentum
    } else if (macdStrength > 200) {
      score += 15; // Moderate momentum
    } else if (macdStrength > 50) {
      score += 5; // Weak momentum
    }

    // 4. Volatility Regime (0-20 points)
    const volatilityRatio = indicators.atr / indicators.avgATR;
    if (volatilityRatio > 1.5) {
      score += 20; // High volatility = more opportunity
    } else if (volatilityRatio > 1.2) {
      score += 10; // Moderate volatility
    } else if (volatilityRatio < 0.7) {
      score -= 10; // Low volatility = less opportunity
    }

    // 5. SuperTrend Alignment (0-15 points)
    // Strong trend confirmation when SuperTrend direction matches signal
    if (signal === 'bullish' && indicators.superTrend.direction === 'bullish') {
      const distanceFromST = ((currentPrice - indicators.superTrend.value) / currentPrice) * 100;
      if (distanceFromST > 0 && distanceFromST < 2) {
        score += 15; // Price just above SuperTrend (strong bullish setup)
      } else if (distanceFromST > 0) {
        score += 10; // Price above SuperTrend (bullish)
      }
    } else if (signal === 'bearish' && indicators.superTrend.direction === 'bearish') {
      const distanceFromST = ((indicators.superTrend.value - currentPrice) / currentPrice) * 100;
      if (distanceFromST > 0 && distanceFromST < 2) {
        score += 15; // Price just below SuperTrend (strong bearish setup)
      } else if (distanceFromST > 0) {
        score += 10; // Price below SuperTrend (bearish)
      }
    } else if (signal !== 'neutral') {
      score -= 10; // Signal conflicts with SuperTrend direction
    }

    // 6. VWAP Position (0-10 points)
    // Institutional benchmark - price above/below VWAP indicates strength/weakness
    const vwapDeviation = ((currentPrice - indicators.vwap) / indicators.vwap) * 100;
    if (signal === 'bullish' && vwapDeviation > 0.5) {
      score += 10; // Bullish signal with price above VWAP (institutional support)
    } else if (signal === 'bearish' && vwapDeviation < -0.5) {
      score += 10; // Bearish signal with price below VWAP (institutional resistance)
    } else if (signal === 'bullish' && vwapDeviation < -1.0) {
      score -= 5; // Bullish signal but price well below VWAP (weak)
    } else if (signal === 'bearish' && vwapDeviation > 1.0) {
      score -= 5; // Bearish signal but price well above VWAP (weak)
    }

    // 7. Signal Alignment Penalty
    // If price is moving against signal direction, reduce score
    if (signal === 'bullish') {
      const nearResistance = sr.resistance.some(r => Math.abs((currentPrice - r) / currentPrice) < 0.01);
      if (nearResistance) score -= 15; // Bullish but near resistance
    } else if (signal === 'bearish') {
      const nearSupport = sr.support.some(s => Math.abs((currentPrice - s) / currentPrice) < 0.01);
      if (nearSupport) score -= 15; // Bearish but near support
    }

    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(candles: MarketData[], period: number = 14): number {
    if (candles.length < period + 1) {
      return 0;
    }

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

    // Calculate initial ATR (simple average of first N true ranges)
    let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

    // Calculate exponential moving average for remaining periods
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return atr;
  }

  /**
   * Calculate SuperTrend indicator
   * SuperTrend = ATR-based trend-following indicator
   * Direction: bullish when price > SuperTrend, bearish when price < SuperTrend
   * 
   * @param candles - Market data
   * @param period - ATR period (default: 10)
   * @param multiplier - ATR multiplier (default: 3.0)
   */
  private calculateSuperTrend(
    candles: MarketData[],
    period: number = 10,
    multiplier: number = 2.5
  ): { value: number; direction: 'bullish' | 'bearish'; upperBand: number; lowerBand: number } {
    if (candles.length < period + 1) {
      // Phase 93.20 — neutral seed: pick direction from current candle body
      // instead of hard-coding 'bullish'. The old hard-coded default leaked
      // a long bias into every cold-start call (e.g., on insufficient data).
      const currentCandle = candles[candles.length - 1];
      const currentPrice = currentCandle?.close || 0;
      const seedDirection: 'bullish' | 'bearish' =
        currentCandle && currentCandle.close >= currentCandle.open ? 'bullish' : 'bearish';
      return {
        value: currentPrice,
        direction: seedDirection,
        upperBand: currentPrice * 1.05,
        lowerBand: currentPrice * 0.95,
      };
    }

    // Phase 93.20 — REWRITE: proper SuperTrend with iterative band tracking.
    //
    // OLD BUG (root cause of 0 bearish TechnicalAnalyst signals across 1,393
    // observations): only the LAST two candles were used to determine
    // direction, and the gate was `close > lowerBand` (lowerBand sits ~2.5
    // ATRs BELOW price, so this is true ~100% of the time). Direction was
    // therefore hard-stuck on 'bullish' — the bearish branch could only fire
    // in the rare window where price was simultaneously below BOTH bands,
    // which never happens by construction. Result: SuperTrend.direction was
    // structurally 'bullish' regardless of market state, which biased every
    // downstream consumer (signal count, execution score, exit recs).
    //
    // FIX: implement the canonical iterative SuperTrend:
    //   1. Compute basic upper/lower bands for every candle.
    //   2. "Lock" the bands — upper only moves down (or stays), lower only
    //      moves up (or stays), unless the prior close breaks through.
    //   3. Direction flips ONLY when close crosses the active band:
    //        bullish→bearish if close < prevSuperTrend (was lowerBand)
    //        bearish→bullish if close > prevSuperTrend (was upperBand)
    //   This makes flipping symmetric — bullish and bearish are equally
    //   reachable, depending on price vs the locked band.
    const lookback = Math.min(candles.length, period * 5 + 1);
    const slice = candles.slice(-lookback);

    // Build per-candle ATR series (running ATR is fine for SuperTrend purposes)
    const trueRanges: number[] = [];
    for (let i = 1; i < slice.length; i++) {
      const h = slice[i].high;
      const l = slice[i].low;
      const pc = slice[i - 1].close;
      trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trueRanges.length < period) {
      // Fall back to a single-bar read using current ATR
      const atr = this.calculateATR(slice, period);
      const cc = slice[slice.length - 1];
      const hl2 = (cc.high + cc.low) / 2;
      const upperBand = hl2 + multiplier * atr;
      const lowerBand = hl2 - multiplier * atr;
      const seedDirection: 'bullish' | 'bearish' = cc.close >= cc.open ? 'bullish' : 'bearish';
      return {
        value: seedDirection === 'bullish' ? lowerBand : upperBand,
        direction: seedDirection,
        upperBand,
        lowerBand,
      };
    }

    // Seed ATR over the first `period` true ranges, then Wilder-smooth forward
    let runningATR = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
    // Index alignment: trueRanges[i] corresponds to slice[i+1].
    // Start band tracking from the first candle that has a finished ATR
    // (slice index = period).
    let prevUpperBand = 0;
    let prevLowerBand = 0;
    let prevFinalUpper = 0;
    let prevFinalLower = 0;
    let prevSuperTrend = 0;
    // Seed direction from the first usable candle's body
    const seedCandle = slice[period];
    let direction: 'bullish' | 'bearish' = seedCandle.close >= seedCandle.open ? 'bullish' : 'bearish';

    let upperBand = 0;
    let lowerBand = 0;
    let superTrendValue = 0;

    for (let i = period; i < slice.length; i++) {
      if (i > period) {
        runningATR = (runningATR * (period - 1) + trueRanges[i - 1]) / period;
      }
      const candle = slice[i];
      const hl2 = (candle.high + candle.low) / 2;
      upperBand = hl2 + multiplier * runningATR;
      lowerBand = hl2 - multiplier * runningATR;

      // Lock bands: upper only moves down (or stays) unless prevClose pierced
      // it; lower only moves up (or stays) unless prevClose broke it.
      const prevClose = slice[i - 1].close;
      const finalUpper =
        i === period
          ? upperBand
          : upperBand < prevFinalUpper || prevClose > prevFinalUpper
            ? upperBand
            : prevFinalUpper;
      const finalLower =
        i === period
          ? lowerBand
          : lowerBand > prevFinalLower || prevClose < prevFinalLower
            ? lowerBand
            : prevFinalLower;

      // Direction flip is gated by the ACTIVE band (the one acting as
      // support/resistance for the current trend). This is the symmetric
      // rule the old code was missing.
      if (i === period) {
        superTrendValue = direction === 'bullish' ? finalLower : finalUpper;
      } else {
        if (direction === 'bullish') {
          // In an uptrend, the lower band is the trailing stop. Close
          // breaking BELOW it flips to bearish.
          if (candle.close < prevSuperTrend) {
            direction = 'bearish';
            superTrendValue = finalUpper;
          } else {
            superTrendValue = finalLower;
          }
        } else {
          // In a downtrend, the upper band is the trailing stop. Close
          // breaking ABOVE it flips to bullish.
          if (candle.close > prevSuperTrend) {
            direction = 'bullish';
            superTrendValue = finalLower;
          } else {
            superTrendValue = finalUpper;
          }
        }
      }

      prevUpperBand = upperBand;
      prevLowerBand = lowerBand;
      prevFinalUpper = finalUpper;
      prevFinalLower = finalLower;
      prevSuperTrend = superTrendValue;
    }

    // Suppress unused-var warnings on accumulators we keep for clarity
    void prevUpperBand;
    void prevLowerBand;

    return {
      value: superTrendValue,
      direction,
      upperBand,
      lowerBand,
    };
  }

  /**
   * Calculate VWAP (Volume Weighted Average Price)
   * VWAP = Sum(Price × Volume) / Sum(Volume)
   * 
   * For intraday: use candles from current trading day
   * For crypto (24/7): use last 24 hours of data
   * 
   * @param candles - Market data (should be intraday or last 24h)
   */
  private calculateVWAP(candles: MarketData[]): number {
    if (candles.length === 0) {
      return 0;
    }
    
    // For crypto, use last 24 candles (24 hours of 1h data)
    // For higher frequency data, adjust accordingly
    const vwapCandles = candles.slice(-24);
    
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;
    
    for (const candle of vwapCandles) {
      // Typical price = (High + Low + Close) / 3
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      
      cumulativePriceVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }
    
    if (cumulativeVolume === 0) {
      // Fallback to simple average if no volume data
      return vwapCandles.reduce((sum, c) => sum + c.close, 0) / vwapCandles.length;
    }
    
    return cumulativePriceVolume / cumulativeVolume;
  }

  /**
   * Apply Dune Analytics on-chain signal bonus to technical analysis
   * Integrates exchange flows and whale activity for enhanced accuracy
   */
  private async applyOnChainSignalBonus(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    strength: number,
    reasoning: string
  ): Promise<{ signal: 'bullish' | 'bearish' | 'neutral'; confidence: number; strength: number; reasoning: string }> {
    try {
      // Check cache first
      if (this.onChainSignalCache && getActiveClock().now() - this.onChainSignalCache.timestamp < this.ONCHAIN_CACHE_TTL) {
        return this.processOnChainSignal(signal, confidence, strength, reasoning, this.onChainSignalCache.signal);
      }

      // Fetch fresh on-chain signal
      const duneProvider = getDuneProvider();
      if (!duneProvider.isConfigured()) {
        // No Dune API key, return unchanged
        return { signal, confidence, strength, reasoning };
      }

      const onChainSignal = await duneProvider.getQuickSignal('BTC');
      
      // Cache the signal
      this.onChainSignalCache = { signal: onChainSignal, timestamp: getActiveClock().now() };

      return this.processOnChainSignal(signal, confidence, strength, reasoning, onChainSignal);
    } catch (error) {
      agentLogger.warn('On-chain signal fetch failed', { agent: 'TechnicalAnalyst', error: error instanceof Error ? error.message : String(error) });
      return { signal, confidence, strength, reasoning };
    }
  }

  /**
   * Process on-chain signal and apply adjustments
   */
  private processOnChainSignal(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    strength: number,
    reasoning: string,
    onChainSignal: OnChainSignal
  ): { signal: 'bullish' | 'bearish' | 'neutral'; confidence: number; strength: number; reasoning: string } {
    let adjustedSignal = signal;
    let adjustedConfidence = confidence;
    let adjustedStrength = strength;
    let adjustedReasoning = reasoning;

    // Check signal alignment
    const signalsAligned = onChainSignal.signal === signal;
    const signalsConflict = 
      (onChainSignal.signal === 'bullish' && signal === 'bearish') ||
      (onChainSignal.signal === 'bearish' && signal === 'bullish');

    // Apply adjustments based on on-chain data
    if (signalsAligned && onChainSignal.confidence > 0.55) {
      // On-chain confirms technical signal - boost confidence
      const boost = Math.min(0.10, onChainSignal.confidence * 0.12);
      adjustedConfidence = Math.min(0.95, confidence + boost);
      adjustedStrength = Math.min(1.0, strength + boost * 0.8);
      adjustedReasoning = `🔗 On-chain CONFIRMS ${signal} (exchange flow: ${onChainSignal.metrics.exchangeNetFlow24h.toFixed(0)} BTC, +${(boost * 100).toFixed(1)}% boost). ` + reasoning;
      agentLogger.info('On-chain confirms signal', { agent: 'TechnicalAnalyst', signal, boost: (boost * 100).toFixed(1) + '%' });
    } else if (signalsConflict && onChainSignal.confidence > 0.60) {
      // On-chain conflicts with technical signal - reduce confidence
      const penalty = Math.min(0.15, onChainSignal.confidence * 0.18);
      adjustedConfidence = Math.max(0.25, confidence - penalty);
      adjustedStrength = Math.max(0.2, strength - penalty * 0.8);
      adjustedReasoning = `⚠️ On-chain CONFLICTS (${onChainSignal.signal}, -${(penalty * 100).toFixed(1)}%). ` + reasoning;
      agentLogger.info('On-chain conflicts with signal', { agent: 'TechnicalAnalyst', signal, penalty: (penalty * 100).toFixed(1) + '%' });
      
      // Strong on-chain signal can override weak technical signal
      if (onChainSignal.confidence > 0.75 && confidence < 0.50) {
        adjustedSignal = onChainSignal.signal;
        adjustedConfidence = Math.max(0.45, onChainSignal.confidence * 0.65);
        adjustedReasoning = `🔄 Signal OVERRIDDEN to ${adjustedSignal} by strong on-chain data. ` + reasoning;
        agentLogger.info('Signal overridden by strong on-chain data', { agent: 'TechnicalAnalyst', newSignal: adjustedSignal });
      }
    } else if (signal === 'neutral' && onChainSignal.signal !== 'neutral' && onChainSignal.confidence > 0.65) {
      // Technical is neutral but on-chain has strong signal - adopt on-chain direction
      adjustedSignal = onChainSignal.signal;
      adjustedConfidence = Math.max(0.45, onChainSignal.confidence * 0.6);
      adjustedStrength = onChainSignal.strength * 0.7;
      adjustedReasoning = `📊 On-chain ${onChainSignal.signal} signal adopted (technical neutral). ` + reasoning;
      agentLogger.info('Adopted on-chain signal', { agent: 'TechnicalAnalyst', adoptedSignal: onChainSignal.signal, reason: 'technical was neutral' });
    }

    // Add exchange flow info to reasoning if significant
    const netFlow = onChainSignal.metrics.exchangeNetFlow24h;
    if (Math.abs(netFlow) > 1000) {
      const flowDirection = netFlow < 0 ? 'outflows' : 'inflows';
      const flowSignal = netFlow < 0 ? 'bullish' : 'bearish';
      if (!adjustedReasoning.includes('On-chain')) {
        adjustedReasoning = `Exchange ${flowDirection}: ${Math.abs(netFlow).toFixed(0)} BTC/24h (${flowSignal}). ` + adjustedReasoning;
      }
    }

    return {
      signal: adjustedSignal,
      confidence: adjustedConfidence,
      strength: adjustedStrength,
      reasoning: adjustedReasoning,
    };
  }

  /**
   * Calculate exit recommendation for open positions (Phase 3 Enhancement)
   * 
   * Provides intelligent exit signals based on:
   * - RSI overbought/oversold conditions
   * - MACD divergence and crossovers
   * - Bollinger Band breakouts
   * - SuperTrend direction changes
   * - Support/Resistance proximity
   */
  private calculateExitRecommendation(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    indicators: TechnicalIndicators,
    currentPrice: number,
    sr: SupportResistance
  ): {
    action: 'hold' | 'partial_exit' | 'full_exit';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    exitPercent?: number;
    confidence: number;
  } {
    const reasons: string[] = [];
    let exitScore = 0; // 0-100 scale, higher = more urgent exit
    
    // 1. RSI extremes (overbought/oversold)
    if (indicators.rsi > 80) {
      exitScore += 30;
      reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`);
    } else if (indicators.rsi > 70) {
      exitScore += 15;
      reasons.push(`RSI elevated (${indicators.rsi.toFixed(1)})`);
    } else if (indicators.rsi < 20) {
      exitScore += 30;
      reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
    } else if (indicators.rsi < 30) {
      exitScore += 15;
      reasons.push(`RSI low (${indicators.rsi.toFixed(1)})`);
    }
    
    // 2. MACD crossover (bearish for longs, bullish for shorts)
    if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
      exitScore += 20;
      reasons.push('MACD bearish crossover');
    } else if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
      exitScore += 20;
      reasons.push('MACD bullish crossover');
    }
    
    // 3. Bollinger Band extremes
    const bbPosition = (currentPrice - indicators.bollingerBands.lower) / 
                       (indicators.bollingerBands.upper - indicators.bollingerBands.lower);
    if (bbPosition > 0.95) {
      exitScore += 25;
      reasons.push('Price at upper Bollinger Band');
    } else if (bbPosition < 0.05) {
      exitScore += 25;
      reasons.push('Price at lower Bollinger Band');
    }
    
    // 4. SuperTrend direction change
    if (indicators.superTrend.direction === 'bearish' && signal === 'bearish') {
      exitScore += 15;
      reasons.push('SuperTrend confirms bearish');
    } else if (indicators.superTrend.direction === 'bullish' && signal === 'bullish') {
      exitScore += 15;
      reasons.push('SuperTrend confirms bullish');
    }
    
    // 5. Near resistance (for longs) or support (for shorts)
    const nearestResistance = sr.resistance[0] || currentPrice * 1.05;
    const nearestSupport = sr.support[0] || currentPrice * 0.95;
    const distanceToResistance = (nearestResistance - currentPrice) / currentPrice;
    const distanceToSupport = (currentPrice - nearestSupport) / currentPrice;
    
    if (distanceToResistance < 0.01) {
      exitScore += 20;
      reasons.push(`Near resistance ($${nearestResistance.toFixed(2)})`);
    }
    if (distanceToSupport < 0.01) {
      exitScore += 20;
      reasons.push(`Near support ($${nearestSupport.toFixed(2)})`);
    }
    
    // 6. Signal reversal (bearish signal on long, bullish on short)
    if (signal === 'bearish' && confidence > 0.6) {
      exitScore += 25;
      reasons.push(`Bearish signal (${(confidence * 100).toFixed(0)}% confidence)`);
    } else if (signal === 'bullish' && confidence > 0.6) {
      exitScore += 25;
      reasons.push(`Bullish signal (${(confidence * 100).toFixed(0)}% confidence)`);
    }
    
    // Determine action based on exit score
    let action: 'hold' | 'partial_exit' | 'full_exit' = 'hold';
    let urgency: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let exitPercent: number | undefined;
    
    if (exitScore >= 80) {
      action = 'full_exit';
      urgency = 'critical';
    } else if (exitScore >= 60) {
      action = 'full_exit';
      urgency = 'high';
    } else if (exitScore >= 45) {
      action = 'partial_exit';
      urgency = 'medium';
      exitPercent = 50; // Exit 50%
    } else if (exitScore >= 30) {
      action = 'partial_exit';
      urgency = 'low';
      exitPercent = 25; // Exit 25%
    }
    
    return {
      action,
      urgency,
      reason: reasons.length > 0 ? reasons.join('; ') : 'No exit signals',
      exitPercent,
      confidence: Math.min(exitScore / 100, 1.0),
    };
  }
}
