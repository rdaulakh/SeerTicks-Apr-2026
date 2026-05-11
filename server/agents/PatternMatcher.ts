import { AgentBase, type AgentConfig, type AgentSignal } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { ExchangeInterface } from "../exchanges/ExchangeInterface";
import { getCandleCache } from '../WebSocketCandleCache';
import { getValidatedPatterns, getPatternConfig, type ValidatedPattern } from '../db/patternQueries';
import { checkMultiTimeframeConfirmation, getOptimalEntryTimeframe, shouldEnterTrade } from '../utils/multiTimeframeConfirmation';
import { getDb } from '../db';
import { winningPatterns } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { detectAllPatterns } from './PatternDetection';

/**
 * Phase 18 — pure helper for unvalidated-pattern confidence discount.
 *
 * Production log evidence (every few seconds for days):
 *   `[PatternMatcher] No validated patterns found, using detected patterns
 *    with reduced confidence`
 *
 * The fallback path fires constantly because the `winningPatterns` table
 * is empty (the validation pipeline was never wired). The OLD discount
 * was `c * 0.5` — halving even a 0.9-confidence detection to 0.45, which
 * combined with downstream damping (overextension/regime/MTF) pinned this
 * agent below every consensus threshold every time.
 *
 * Phase 16's backtest confirmed: 0% pass rate at 0.50 across 1,182
 * production rows. Fix: replace the 50% chop with a modest 15% discount.
 * The PatternDetection.ts confidence is already a calibrated estimate
 * (it accounts for pattern quality, breakout strength, etc.) — applying
 * an extra 50% penalty for "no historical validation" is double-counting
 * a risk the detection algo already factors in.
 *
 * Once Phase 23 (pattern-validation loop) ships and `winningPatterns`
 * actually populates, the validated-path branch will replace this with
 * `dynamicConfidence + historicalBoost`. Until then this is the bridge.
 */
export function computeUnvalidatedPatternConfidence(
  detectedConfidence: number,
): number {
  if (!Number.isFinite(detectedConfidence) || detectedConfidence <= 0) return 0.05;
  return Math.max(0.05, Math.min(0.95, detectedConfidence * 0.85));
}

/**
 * Pattern Matcher Agent
 * Recognizes historical patterns and matches current market conditions
 * Monitors alpha decay to identify when patterns stop working
 * 
 * Pattern Library:
 * - Winning patterns from database (learned from successful trades)
 * - Classic chart patterns (head & shoulders, double top/bottom, etc.)
 * - Custom patterns with specific market conditions
 * 
 * Alpha Decay:
 * - Tracks pattern performance over time
 * - Identifies when a pattern's edge diminishes
 * - Automatically reduces weight of decayed patterns
 */

interface Pattern extends ValidatedPattern {
  alphaScore: number; // 0-1, decays over time
  timeframe: string;
}

interface PatternMatch {
  pattern: Pattern;
  similarity: number; // 0-1
  confidence: number;
}

export class PatternMatcher extends AgentBase {
  private exchange: ExchangeInterface | null = null;
  private patterns: Pattern[] = [];
  private lastPatternLoad: number = 0;
  private readonly PATTERN_RELOAD_INTERVAL = 3600000; // 1 hour
  private currentPrice: number = 0; // Live price from WebSocket for tick-level updates

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "PatternMatcher",
      enabled: true,
      updateInterval: 0, // Event-driven, not periodic
      timeout: 10000,
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

  /**
   * Update current price from WebSocket for tick-level confidence updates
   */
  setCurrentPrice(price: number): void {
    this.currentPrice = price;
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Loading pattern library...`);
    await this.loadPatterns();
  }

  protected async cleanup(): Promise<void> {
    this.patterns = [];
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Reload patterns if needed
      if (getActiveClock().now() - this.lastPatternLoad > this.PATTERN_RELOAD_INTERVAL) {
        await this.loadPatterns();
      }

      // Note: exchange is optional — agents use CandleCache (from WebSocket ticks)
      // and database fallback for candle data. No REST API calls needed.

      // Fetch market data for multiple timeframes from WebSocket cache (no REST API calls)
      const candleCache = getCandleCache();
      const cached1h = candleCache.getCandles(symbol, '1h', 100); // Primary timeframe (always available)
      const cached1m = candleCache.getCandles(symbol, '1m', 100); // Secondary timeframe (always available)
      const cached1d = candleCache.getCandles(symbol, '1d', 50);
      const cached4h = candleCache.getCandles(symbol, '4h', 50);
      const cached5m = candleCache.getCandles(symbol, '5m', 50);
      
      // Convert to exchange format
      let candles1h = cached1h.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      let candles1m = cached1m.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      let candles1d = cached1d.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      let candles4h = cached4h.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      let candles5m = cached5m.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      
      // Try database fallback for missing timeframes
      try {
        const { loadCandlesFromDatabase } = await import('../db/candleStorage');
        
        // Primary timeframes (1h, 1m) - REQUIRED
        if (candles1h.length < 20) {
          const dbCandles = await loadCandlesFromDatabase(symbol, '1h', 100);
          if (dbCandles.length >= 20) {
            candles1h = dbCandles;
            console.log(`[PatternMatcher] ✅ Loaded ${dbCandles.length} 1h candles from database`);
          }
        }
        if (candles1m.length < 20) {
          const dbCandles = await loadCandlesFromDatabase(symbol, '1m', 100);
          if (dbCandles.length >= 20) {
            candles1m = dbCandles;
            console.log(`[PatternMatcher] ✅ Loaded ${dbCandles.length} 1m candles from database`);
          }
        }
        
        // Secondary timeframes (1d, 4h, 5m) - OPTIONAL, use 1h as fallback
        if (candles1d.length < 20) {
          const dbCandles = await loadCandlesFromDatabase(symbol, '1d', 50);
          if (dbCandles.length >= 20) {
            candles1d = dbCandles;
          } else {
            // Use 1h candles as fallback for daily patterns (last 24 candles = 1 day)
            candles1d = candles1h.slice(-24);
            console.log(`[PatternMatcher] ⚠️ Using 1h candles as 1d fallback (${candles1d.length} candles)`);
          }
        }
        if (candles4h.length < 20) {
          const dbCandles = await loadCandlesFromDatabase(symbol, '4h', 50);
          if (dbCandles.length >= 20) {
            candles4h = dbCandles;
          } else {
            // Use 1h candles as fallback for 4h patterns (every 4th candle)
            candles4h = candles1h.filter((_, i) => i % 4 === 0).slice(-50);
            console.log(`[PatternMatcher] ⚠️ Using 1h candles as 4h fallback (${candles4h.length} candles)`);
          }
        }
        if (candles5m.length < 20) {
          const dbCandles = await loadCandlesFromDatabase(symbol, '5m', 50);
          if (dbCandles.length >= 20) {
            candles5m = dbCandles;
          } else {
            // Use 1m candles as fallback for 5m patterns (every 5th candle)
            candles5m = candles1m.filter((_, i) => i % 5 === 0).slice(-50);
            console.log(`[PatternMatcher] ⚠️ Using 1m candles as 5m fallback (${candles5m.length} candles)`);
          }
        }
      } catch (dbError) {
        console.warn(`[PatternMatcher] Database fallback failed:`, dbError);
      }
      
      // Check ONLY primary timeframes (1h, 1m) - these are required
      if (candles1h.length < 20 || candles1m.length < 20) {
        return this.createNeutralSignal(symbol, `Insufficient primary candles (1h:${candles1h.length}, 1m:${candles1m.length}) - waiting for WebSocket to populate cache`);
      }
      
      console.log(`[PatternMatcher] ✅ Data ready for ${symbol}: 1h=${candles1h.length}, 1m=${candles1m.length}, 1d=${candles1d.length}, 4h=${candles4h.length}, 5m=${candles5m.length}`);
      

      // Get current live price for tick-level confidence updates
      const currentPrice = this.currentPrice || candles1m[candles1m.length - 1]?.close || 0;
      
      // Detect patterns in real-time (using pre-imported function for performance)
      const detectedPatterns = [
        ...detectAllPatterns(candles1d, "1d", currentPrice),
        ...detectAllPatterns(candles4h, "4h", currentPrice),
        ...detectAllPatterns(candles5m, "5m", currentPrice),
        ...detectAllPatterns(candles1m, "1m", currentPrice), // Add 1m patterns for faster updates
      ];

      console.log(`[PatternMatcher] Detected ${detectedPatterns.length} patterns:`, detectedPatterns.map(p => `${p.name} (${p.timeframe}, conf=${(p.confidence * 100).toFixed(1)}%)`));
      console.log(`[PatternMatcher] Loaded ${this.patterns.length} validated patterns from database`);
      console.log(`[PatternMatcher] Validated patterns:`, this.patterns.map(p => `${p.patternName} (${p.timeframe}, WR=${(p.winRate * 100).toFixed(1)}%)`));

      if (detectedPatterns.length === 0) {
        return this.createNeutralSignal(symbol, "No patterns detected in current market conditions");
      }

      // Match detected patterns with validated patterns from database (winRate > 50%)
      // Lowered from 55% to 50% to allow more patterns through
      console.log(`[${this.config.name}] Detected ${detectedPatterns.length} patterns:`, detectedPatterns.map(p => `${p.name} (${p.timeframe})`));
      console.log(`[${this.config.name}] Available validated patterns: ${this.patterns.length}`);
      
      const validatedMatches = detectedPatterns
        .map(detected => {
          const validated = this.patterns.find(
            p => p.patternName === detected.name && p.timeframe === detected.timeframe && p.winRate >= 0.50
          );
          if (!validated) {
            console.log(`[${this.config.name}] No match for ${detected.name} (${detected.timeframe}) - Available: ${this.patterns.map(p => `${p.patternName}/${p.timeframe}`).join(', ')}`);
          }
          return validated ? { detected, validated } : null;
        })
        .filter(m => m !== null);

      if (validatedMatches.length === 0) {
        // FALLBACK: If no validated patterns, use detected patterns with reduced confidence
        console.warn(`[PatternMatcher] No validated patterns found, using detected patterns with reduced confidence`);
        
        // Sort detected patterns by confidence
        const bestDetected = detectedPatterns.sort((a, b) => b.confidence - a.confidence)[0];
        
        if (!bestDetected) {
          return this.createNeutralSignal(symbol, `No patterns detected`);
        }
        
        // Determine signal based on pattern type
        // FIXED: Complete list of all 19 detected patterns properly classified
        const bullishPatterns = [
          "Double Bottom", "Bullish Engulfing", "Hammer", "Ascending Triangle",
          "Inverse Head and Shoulders", "Cup and Handle", "Bullish Flag",
          "Triple Bottom", "Falling Wedge", "Bullish Pennant"
        ];
        const bearishPatterns = [
          "Double Top", "Bearish Engulfing", "Shooting Star", "Descending Triangle",
          "Head and Shoulders", "Bearish Flag", "Triple Top",
          "Rising Wedge", "Bearish Pennant"
        ];
        
        let signal: "bullish" | "bearish" | "neutral";
        if (bullishPatterns.includes(bestDetected.name)) {
          signal = "bullish";
        } else if (bearishPatterns.includes(bestDetected.name)) {
          signal = "bearish";
        } else {
          signal = "neutral";
        }
        
        // Phase 18 — apply a 15% unvalidated-pattern discount instead of the
        // old 50% halving. The detection-side confidence is already a
        // calibrated quality estimate; halving it on top of every downstream
        // damping factor mathematically pinned the agent below 0.50 forever
        // (verified by Phase 16 backtest, 0% pass rate across 1,182 prod
        // rows). The new discount keeps a real-but-small penalty for lack of
        // historical validation while letting strong detections contribute.
        const confidence = computeUnvalidatedPatternConfidence(bestDetected.confidence);
        const strength = confidence * 0.8; // Lower strength for unvalidated patterns
        
        const reasoning = `Detected ${bestDetected.name} pattern on ${bestDetected.timeframe} timeframe (UNVALIDATED). ${bestDetected.description}. Confidence reduced to ${(confidence * 100).toFixed(1)}% due to lack of historical validation.`;
        
        return {
          agentName: this.config.name,
          symbol,
          timestamp: getActiveClock().now(),
          signal,
          confidence,
          strength,
          executionScore: 30, // Low execution score for unvalidated patterns
          reasoning,
          evidence: {
            matchedPattern: bestDetected.name,
            timeframe: bestDetected.timeframe,
            detectionConfidence: bestDetected.confidence,
            validated: false,
            totalDetected: detectedPatterns.length,
            allDetected: detectedPatterns.map(p => `${p.name} (${p.timeframe})`).join(", "),
          },
          qualityScore: 0.4, // Lower quality for unvalidated
          processingTime: getActiveClock().now() - startTime,
          dataFreshness: 0,
          recommendation: undefined,
        };
      }

      // Get best match (highest confidence × win rate × profit factor)
      const bestMatch = validatedMatches.sort((a, b) => {
        const scoreA = a!.detected.confidence * a!.validated.winRate * a!.validated.profitFactor;
        const scoreB = b!.detected.confidence * b!.validated.winRate * b!.validated.profitFactor;
        return scoreB - scoreA;
      })[0]!;

      // Determine signal based on pattern type and validated success rate
      const detected = bestMatch.detected;
      const validated = bestMatch.validated;
      
      // FIXED: Complete list of all 19 detected patterns properly classified
      const bullishPatterns = [
        "Double Bottom", "Bullish Engulfing", "Hammer", "Ascending Triangle",
        "Inverse Head and Shoulders", "Cup and Handle", "Bullish Flag",
        "Triple Bottom", "Falling Wedge", "Bullish Pennant"
      ];
      const bearishPatterns = [
        "Double Top", "Bearish Engulfing", "Shooting Star", "Descending Triangle",
        "Head and Shoulders", "Bearish Flag", "Triple Top",
        "Rising Wedge", "Bearish Pennant"
      ];
      
      let signal: "bullish" | "bearish" | "neutral";
      if (bullishPatterns.includes(detected.name)) {
        signal = "bullish";
      } else if (bearishPatterns.includes(detected.name)) {
        signal = "bearish";
      } else {
        signal = "neutral";
      }

      // Check multi-timeframe confirmation
      const primarySignal = signal === 'bullish' ? 'BUY' : signal === 'bearish' ? 'SELL' : 'NEUTRAL';
      const mtfResult = await checkMultiTimeframeConfirmation(
        symbol,
        detected.timeframe,
        detected.name,
        primarySignal as 'BUY' | 'SELL'
      );

      // Confidence = dynamic pattern confidence (updates every tick) + historical validation boost + MTF boost
      // Use weighted average: 70% current pattern confidence + 30% historical win rate
      // This preserves tick-by-tick updates while incorporating historical performance
      const dynamicConfidence = detected.confidence; // Already updates with price/volume/momentum
      const historicalBoost = (validated.winRate - 0.5) * 0.3; // Scale historical data to ±15% boost
      const baseConfidence = Math.max(0.05, Math.min(0.95, dynamicConfidence + historicalBoost));
      const confidence = Math.min(baseConfidence + mtfResult.confidenceBoost, 1.0);
      const strength = Math.min(confidence * validated.profitFactor, 1.0);

      // Calculate execution score (0-100) - tactical timing quality for pattern-based trades
      const executionScore = this.calculateExecutionScore(
        detected,
        validated,
        mtfResult,
        candles1d,
        candles4h,
        candles5m
      );

      // Get optimal entry timeframe
      const entryTimeframe = getOptimalEntryTimeframe(detected.timeframe);

      // Debug log execution score
      console.log(`[PatternMatcher] ${symbol} - Execution Score: ${executionScore}/100 (Pattern: ${detected.name}, Confidence: ${(confidence * 100).toFixed(1)}%, WinRate: ${(validated.winRate * 100).toFixed(1)}%)`);

      let reasoning = `Detected ${detected.name} pattern on ${detected.timeframe} timeframe. ${detected.description}. Historical win rate: ${(validated.winRate * 100).toFixed(1)}% (${validated.totalTrades} trades, PF: ${validated.profitFactor.toFixed(2)}). Stop-loss: ${(validated.stopLoss * 100).toFixed(2)}%, Take-profit: ${(validated.takeProfit * 100).toFixed(2)}%. ${mtfResult.reasoning} Optimal entry: ${entryTimeframe} timeframe.`;

      // Phase 30: Apply MarketContext regime adjustments
      let adjustedConfidence = confidence;
      if (context?.regime) {
        const regime = context.regime as string;
        // Patterns are less reliable in high volatility (false breakouts)
        if (regime === 'high_volatility') {
          adjustedConfidence *= 0.80;
          reasoning += ' [Regime: high_volatility — pattern reliability reduced]';
        }
        // Breakout patterns are more reliable during actual breakouts
        if (regime === 'breakout' && ['Ascending Triangle', 'Descending Triangle', 'Cup and Handle', 'Bullish Flag', 'Bearish Flag'].includes(detected.name)) {
          adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.15);
          reasoning += ' [Regime: breakout — breakout pattern confirmed]';
        }
        // Range-bound: reversal patterns are more reliable
        if (regime === 'range_bound' && ['Double Bottom', 'Double Top', 'Head and Shoulders', 'Inverse Head and Shoulders'].includes(detected.name)) {
          adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.10);
          reasoning += ' [Regime: range_bound — reversal pattern boosted]';
        }
      }

      const processingTime = getActiveClock().now() - startTime;

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence: adjustedConfidence,
        strength,
        executionScore,
        reasoning,
        evidence: {
          matchedPattern: detected.name,
          timeframe: detected.timeframe,
          detectionConfidence: detected.confidence,
          patternWinRate: validated.winRate,
          patternProfitFactor: validated.profitFactor,
          patternTotalTrades: validated.totalTrades,
          stopLossPercent: validated.stopLoss,
          takeProfitPercent: validated.takeProfit,
          maxHoldPeriod: validated.maxHold,
          patternDescription: detected.description,
          totalDetected: detectedPatterns.length,
          totalValidated: validatedMatches.length,
          allDetected: detectedPatterns.map(p => `${p.name} (${p.timeframe})`).join(", "),
          // Multi-timeframe confirmation
          mtfAlignedTimeframes: mtfResult.alignedTimeframes,
          mtfTotalTimeframes: mtfResult.totalTimeframes,
          mtfAlignmentScore: mtfResult.alignmentScore,
          mtfConfidenceBoost: mtfResult.confidenceBoost,
          optimalEntryTimeframe: entryTimeframe,
        },
        qualityScore: confidence,
        processingTime,
        dataFreshness: 0,
        recommendation: {
          action: signal === "bullish" ? "buy" : signal === "bearish" ? "sell" : "hold",
          urgency: confidence > 0.8 ? "high" : confidence > 0.6 ? "medium" : "low",
        },
        exitRecommendation: this.calculateExitRecommendation(signal, confidence, detected, validated),
      };
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      return this.createNeutralSignal(symbol, `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async periodicUpdate(): Promise<void> {
    // Not used for this agent (event-driven)
  }

  /**
   * Load patterns from database
   */
  private async loadPatterns(): Promise<void> {
    try {
      // Load validated patterns with win rate >= 0.50 (lowered from 0.55 to match more patterns)
      const dbPatterns = await getValidatedPatterns(0.50);

      this.patterns = dbPatterns.map(p => {
        // Calculate alpha score from win rate and profit factor
        const alphaScore = p.winRate * p.profitFactor * (p.isActive ? 1.0 : 0.5);
        
        return {
          ...p,
          alphaScore,
        };
      });

      this.lastPatternLoad = getActiveClock().now();
      console.log(`[${this.config.name}] Loaded ${this.patterns.length} validated patterns (WR >= 50%)`);
      if (this.patterns.length > 0) {
        console.log(`[${this.config.name}] Sample patterns:`, this.patterns.slice(0, 3).map(p => `${p.patternName} (${p.timeframe}, WR=${(p.winRate * 100).toFixed(1)}%)`))
      }
    } catch (error) {
      console.error(`[${this.config.name}] Failed to load patterns:`, error);
    }
  }

  /**
   * Calculate execution score (0-100) - Institutional-grade timing layer for pattern-based trades
   * Measures tactical entry/exit quality based on:
   * - Pattern detection confidence (how clear the pattern is)
   * - Historical win rate (validated performance)
   * - Multi-timeframe alignment (confirmation strength)
   * - Pattern freshness (time since formation)
   * - Volume confirmation (institutional participation)
   */
  private calculateExecutionScore(
    detected: any,
    validated: ValidatedPattern,
    mtfResult: any,
    candles1d: any[],
    candles4h: any[],
    candles5m: any[]
  ): number {
    let score = 50; // Base score (neutral)

    // 1. Pattern Detection Confidence (0-25 points)
    // Higher confidence = clearer pattern formation
    if (detected.confidence > 0.90) {
      score += 25; // Very high confidence (>90%)
    } else if (detected.confidence > 0.75) {
      score += 18; // High confidence (75-90%)
    } else if (detected.confidence > 0.60) {
      score += 10; // Moderate confidence (60-75%)
    } else if (detected.confidence > 0.50) {
      score += 5; // Low confidence (50-60%)
    }

    // 2. Historical Win Rate (0-25 points)
    // Validated performance from database
    if (validated.winRate > 0.75) {
      score += 25; // Excellent win rate (>75%)
    } else if (validated.winRate > 0.65) {
      score += 18; // Good win rate (65-75%)
    } else if (validated.winRate > 0.55) {
      score += 10; // Acceptable win rate (55-65%)
    }

    // 3. Multi-Timeframe Alignment (0-25 points)
    // Stronger alignment = higher conviction
    const alignmentRatio = mtfResult.alignedTimeframes / mtfResult.totalTimeframes;
    if (alignmentRatio >= 1.0) {
      score += 25; // Perfect alignment (all timeframes)
    } else if (alignmentRatio >= 0.67) {
      score += 18; // Strong alignment (2/3 timeframes)
    } else if (alignmentRatio >= 0.50) {
      score += 10; // Moderate alignment (1/2 timeframes)
    } else if (alignmentRatio > 0) {
      score += 5; // Weak alignment
    }

    // 4. Pattern Freshness (0-15 points)
    // Recent patterns are more actionable
    // Patterns are detected on most recent candles, so this is always high
    // We check if the pattern is still forming (not completed yet)
    const timeframe = detected.timeframe;
    let candlesSinceFormation = 0;
    
    if (timeframe === '1d') {
      candlesSinceFormation = 1; // Daily patterns are fresh for 1-2 days
    } else if (timeframe === '4h') {
      candlesSinceFormation = 1; // 4h patterns are fresh for 4-8 hours
    } else if (timeframe === '5m') {
      candlesSinceFormation = 1; // 5m patterns are fresh for 5-15 minutes
    }

    if (candlesSinceFormation <= 2) {
      score += 15; // Very fresh (just formed)
    } else if (candlesSinceFormation <= 5) {
      score += 10; // Fresh (recent)
    } else if (candlesSinceFormation <= 10) {
      score += 5; // Moderate (still valid)
    }

    // 5. Volume Confirmation (0-10 points)
    // Check if volume is increasing (confirms institutional participation)
    const candles = timeframe === '1d' ? candles1d : timeframe === '4h' ? candles4h : candles5m;
    if (candles.length >= 10) {
      const recentVolume = candles.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
      const historicalVolume = candles.slice(-20, -5).reduce((sum, c) => sum + c.volume, 0) / 15;
      const volumeChange = (recentVolume - historicalVolume) / historicalVolume;

      if (volumeChange > 0.50) {
        score += 10; // Strong volume increase (>50%)
      } else if (volumeChange > 0.20) {
        score += 6; // Moderate volume increase (20-50%)
      } else if (volumeChange > 0) {
        score += 3; // Slight volume increase
      } else if (volumeChange < -0.30) {
        score -= 10; // Low volume (weak signal)
      }
    }

    // 6. Profit Factor Bonus (0-10 points)
    // Higher profit factor = better risk/reward
    if (validated.profitFactor > 2.5) {
      score += 10; // Excellent profit factor (>2.5)
    } else if (validated.profitFactor > 2.0) {
      score += 6; // Good profit factor (2.0-2.5)
    } else if (validated.profitFactor > 1.5) {
      score += 3; // Acceptable profit factor (1.5-2.0)
    }

    // 7. Sample Size Penalty
    // Penalize patterns with insufficient historical data
    if (validated.totalTrades < 10) {
      score -= 15; // Very low sample size (<10 trades)
    } else if (validated.totalTrades < 20) {
      score -= 10; // Low sample size (10-20 trades)
    } else if (validated.totalTrades < 30) {
      score -= 5; // Moderate sample size (20-30 trades)
    }

    // 8. Real-Time Price Deviation (±10 points)
    // Adjust score based on current price position relative to pattern levels
    const currentPrice = candles[candles.length - 1].close;
    const patternName = detected.name;
    
    if (patternName === 'Double Bottom' || patternName === 'Ascending Triangle') {
      // Bullish patterns - higher score when price is near support
      const recentLow = Math.min(...candles.slice(-10).map(c => c.low));
      const recentHigh = Math.max(...candles.slice(-10).map(c => c.high));
      const range = recentHigh - recentLow;
      const positionInRange = (currentPrice - recentLow) / range; // 0-1
      
      if (positionInRange < 0.3) {
        score += 10; // Near support (optimal entry)
      } else if (positionInRange < 0.5) {
        score += 5; // Mid-range (acceptable)
      } else if (positionInRange > 0.8) {
        score -= 10; // Near resistance (poor entry)
      }
    } else if (patternName === 'Double Top' || patternName === 'Descending Triangle') {
      // Bearish patterns - higher score when price is near resistance
      const recentLow = Math.min(...candles.slice(-10).map(c => c.low));
      const recentHigh = Math.max(...candles.slice(-10).map(c => c.high));
      const range = recentHigh - recentLow;
      const positionInRange = (currentPrice - recentLow) / range;
      
      if (positionInRange > 0.7) {
        score += 10; // Near resistance (optimal entry)
      } else if (positionInRange > 0.5) {
        score += 5; // Mid-range (acceptable)
      } else if (positionInRange < 0.2) {
        score -= 10; // Near support (poor entry)
      }
    }

    // 9. Tick-Level Momentum Acceleration (±10 points)
    // Check if momentum is accelerating in the expected direction
    if (candles.length >= 10) {
      const prices = candles.slice(-10).map(c => c.close);
      const momentum1 = (prices[prices.length - 1] - prices[prices.length - 3]) / prices[prices.length - 3];
      const momentum2 = (prices[prices.length - 3] - prices[prices.length - 6]) / prices[prices.length - 6];
      const momentumAcceleration = momentum1 - momentum2;
      
      const isBullish = patternName === 'Double Bottom' || patternName === 'Ascending Triangle';
      const isBearish = patternName === 'Double Top' || patternName === 'Descending Triangle';
      
      if (isBullish && momentumAcceleration > 0.005) {
        score += 10; // Accelerating upward momentum
      } else if (isBullish && momentumAcceleration > 0.002) {
        score += 5; // Moderate upward acceleration
      } else if (isBullish && momentumAcceleration < -0.005) {
        score -= 10; // Decelerating (losing momentum)
      }
      
      if (isBearish && momentumAcceleration < -0.005) {
        score += 10; // Accelerating downward momentum
      } else if (isBearish && momentumAcceleration < -0.002) {
        score += 5; // Moderate downward acceleration
      } else if (isBearish && momentumAcceleration > 0.005) {
        score -= 10; // Decelerating (losing momentum)
      }
    }

    // 10. Volatility Regime Adjustment (±5 points)
    // High volatility = higher risk, lower execution score
    if (candles.length >= 20) {
      const returns = [];
      for (let i = 1; i < candles.length; i++) {
        returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
      }
      const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
      
      if (volatility > 0.03) {
        score -= 5; // High volatility (risky)
      } else if (volatility < 0.01) {
        score += 5; // Low volatility (stable)
      }
    }

    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Extract current market conditions from context
   */
  private extractConditions(context: any): Record<string, any> {
    if (!context) return {};

    return {
      rsi: context.rsi,
      macd: context.macd,
      price: context.currentPrice,
      volume: context.volume,
      trend: context.trend,
      volatility: context.volatility,
      fearGreed: context.fearGreed,
      sentiment: context.sentiment,
      // Add more conditions as needed
    };
  }

  /**
   * Find patterns that match current conditions
   */
  private findMatchingPatterns(currentConditions: Record<string, any>): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const pattern of this.patterns) {
      // Match based on pattern name relevance to current market conditions
      const similarity = this.calculatePatternRelevance(pattern, currentConditions);

      if (similarity > 0.6) {
        // Only consider patterns with >60% relevance
        const confidence = similarity * pattern.alphaScore * pattern.winRate;
        matches.push({ pattern, similarity, confidence });
      }
    }

    // Sort by confidence (descending)
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches;
  }

  /**
   * Calculate how relevant a validated pattern is to current market conditions.
   * Uses pattern name, trend alignment, and volatility regime to score relevance.
   */
  private calculatePatternRelevance(
    pattern: Pattern,
    currentConditions: Record<string, any>
  ): number {
    let relevance = 0.5; // Base relevance

    const name = pattern.patternName?.toLowerCase() || '';
    const trend = currentConditions.trend?.toLowerCase() || '';
    const volatility = currentConditions.volatility || 0;

    // Bullish patterns are more relevant in bullish/neutral trends
    const bullishPatterns = ['double bottom', 'bullish engulfing', 'hammer', 'ascending triangle', 'morning star', 'inverse head and shoulders'];
    const bearishPatterns = ['double top', 'bearish engulfing', 'shooting star', 'descending triangle', 'evening star', 'head and shoulders'];

    const isBullishPattern = bullishPatterns.some(p => name.includes(p));
    const isBearishPattern = bearishPatterns.some(p => name.includes(p));

    // Trend alignment: patterns are more relevant when they align with current trend
    if (isBullishPattern && (trend.includes('up') || trend.includes('bullish'))) {
      relevance += 0.15; // Continuation pattern in uptrend
    } else if (isBullishPattern && (trend.includes('down') || trend.includes('bearish'))) {
      relevance += 0.25; // Reversal pattern - higher relevance
    } else if (isBearishPattern && (trend.includes('down') || trend.includes('bearish'))) {
      relevance += 0.15; // Continuation pattern in downtrend
    } else if (isBearishPattern && (trend.includes('up') || trend.includes('bullish'))) {
      relevance += 0.25; // Reversal pattern - higher relevance
    }

    // Win rate boost: proven patterns get higher relevance
    if (pattern.winRate > 0.65) {
      relevance += 0.1;
    }
    if (pattern.totalTrades >= 10) {
      relevance += 0.05; // Statistically significant sample
    }

    // Alpha decay: reduce relevance for flagged patterns
    if (pattern.alphaDecayFlag) {
      relevance *= 0.7;
    }

    // Volatility consideration: some patterns work better in high/low vol
    if (volatility > 0.05) {
      // High volatility: reversal patterns are more meaningful
      if (name.includes('engulfing') || name.includes('hammer') || name.includes('shooting star')) {
        relevance += 0.1;
      }
    }

    return Math.max(0, Math.min(1, relevance));
  }

  /**
   * Calculate similarity between pattern conditions and current conditions
   */
  private calculateSimilarity(
    patternConditions: Record<string, any>,
    currentConditions: Record<string, any>
  ): number {
    const keys = Object.keys(patternConditions);
    if (keys.length === 0) return 0;

    let totalSimilarity = 0;
    let validKeys = 0;

    for (const key of keys) {
      if (!(key in currentConditions)) continue;

      const patternValue = patternConditions[key];
      const currentValue = currentConditions[key];

      // Calculate similarity based on value type
      if (typeof patternValue === 'number' && typeof currentValue === 'number') {
        // Numeric similarity (percentage difference)
        const diff = Math.abs(patternValue - currentValue);
        const avg = (Math.abs(patternValue) + Math.abs(currentValue)) / 2;
        const similarity = avg > 0 ? 1 - Math.min(diff / avg, 1) : 1;
        totalSimilarity += similarity;
        validKeys++;
      } else if (typeof patternValue === 'string' && typeof currentValue === 'string') {
        // String similarity (exact match)
        totalSimilarity += patternValue === currentValue ? 1 : 0;
        validKeys++;
      } else if (typeof patternValue === 'object' && typeof currentValue === 'object') {
        // Nested object similarity (recursive)
        const nestedSimilarity = this.calculateSimilarity(patternValue, currentValue);
        totalSimilarity += nestedSimilarity;
        validKeys++;
      }
    }

    return validKeys > 0 ? totalSimilarity / validKeys : 0;
  }



  /**
   * Calculate signal from pattern match
   */
  private calculateSignalFromPattern(
    bestMatch: PatternMatch,
    allMatches: PatternMatch[],
    analysis: string
  ): {
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    strength: number;
    reasoning: string;
  } {
    const pattern = bestMatch.pattern;

    // Signal based on pattern name (bullish/bearish patterns)
    const signal: "bullish" | "bearish" | "neutral" = pattern.patternName.toLowerCase().includes('bullish') || pattern.patternName.toLowerCase().includes('bottom') || pattern.patternName.toLowerCase().includes('hammer') || pattern.patternName.toLowerCase().includes('ascending') ? 'bullish' : pattern.patternName.toLowerCase().includes('bearish') || pattern.patternName.toLowerCase().includes('top') || pattern.patternName.toLowerCase().includes('shooting') || pattern.patternName.toLowerCase().includes('descending') ? 'bearish' : 'neutral';

    // Confidence based on similarity, win rate, and alpha
    const confidence = Math.min(
      bestMatch.similarity * 0.4 +
      pattern.winRate * 0.3 +
      pattern.alphaScore * 0.3,
      0.9
    );

    // Strength based on profit factor and alpha
    const strength = Math.min(
      (pattern.profitFactor - 1) * 0.5 * pattern.alphaScore,
      1.0
    );

    // Check if multiple patterns agree
    const agreeingPatterns = allMatches.filter(
      m => {
        const mSignal: "bullish" | "bearish" | "neutral" = m.pattern.patternName.toLowerCase().includes('bullish') || m.pattern.patternName.toLowerCase().includes('bottom') || m.pattern.patternName.toLowerCase().includes('hammer') || m.pattern.patternName.toLowerCase().includes('ascending') ? 'bullish' : m.pattern.patternName.toLowerCase().includes('bearish') || m.pattern.patternName.toLowerCase().includes('top') || m.pattern.patternName.toLowerCase().includes('shooting') || m.pattern.patternName.toLowerCase().includes('descending') ? 'bearish' : 'neutral';
        return mSignal === signal;
      }
    ).length;

    const reasoning = `Pattern match: "${pattern.patternName}" (${(bestMatch.similarity * 100).toFixed(0)}% similar). Win rate: ${(pattern.winRate * 100).toFixed(0)}%, Alpha: ${pattern.alphaScore.toFixed(2)}, Profit factor: ${pattern.profitFactor.toFixed(2)}. ${agreeingPatterns} of ${allMatches.length} top patterns agree. ${analysis}`;

    return { signal, confidence, strength, reasoning };
  }

  /**
   * Helper method to derive signal from pattern name
   */
  private getSignalFromPatternName(patternName: string): "bullish" | "bearish" | "neutral" {
    const lowerName = patternName.toLowerCase();
    if (lowerName.includes('bullish') || lowerName.includes('bottom') || lowerName.includes('hammer') || lowerName.includes('ascending')) {
      return 'bullish';
    } else if (lowerName.includes('bearish') || lowerName.includes('top') || lowerName.includes('shooting') || lowerName.includes('descending')) {
      return 'bearish';
    }
    return 'neutral';
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(bestMatch: PatternMatch, allMatches: PatternMatch[]): number {
    const similarityScore = bestMatch.similarity;
    const alphaScore = bestMatch.pattern.alphaScore;
    
    // Derive signal from pattern name for consensus calculation
    const bestSignal = this.getSignalFromPatternName(bestMatch.pattern.patternName);
    const consensusScore = allMatches.filter(
      m => this.getSignalFromPatternName(m.pattern.patternName) === bestSignal
    ).length / Math.max(allMatches.length, 1);

    return (similarityScore * 0.4 + alphaScore * 0.4 + consensusScore * 0.2);
  }

  /**
   * Get recommendation
   */
  private getRecommendation(
    signal: "bullish" | "bearish" | "neutral",
    confidence: number,
    strength: number,
    match: PatternMatch
  ): AgentSignal["recommendation"] {
    if (signal === "neutral" || confidence < 0.6) {
      return {
        action: "hold",
        urgency: "low",
      };
    }

    // Higher urgency for high-alpha patterns
    const urgency = match.pattern.alphaScore > 0.7 ? "high" : match.pattern.alphaScore > 0.5 ? "medium" : "low";

    if (signal === "bullish") {
      return {
        action: confidence > 0.7 ? "buy" : "hold",
        urgency,
      };
    } else {
      return {
        action: confidence > 0.7 ? "sell" : "reduce",
        urgency,
      };
    }
  }

  /**
   * Update pattern after trade completion (called by learning system)
   */
  async updatePattern(patternId: number, wasSuccessful: boolean, actualReturn: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      const pattern = this.patterns.find(p => p.id === patternId);
      if (!pattern) return;

      // Update win rate (exponential moving average)
      const alpha = 0.1;
      const newWinRate = alpha * (wasSuccessful ? 1 : 0) + (1 - alpha) * pattern.winRate;

      // Update profit factor based on actual return
      const newProfitFactor = alpha * (1 + actualReturn) + (1 - alpha) * pattern.profitFactor;

      // Calculate alpha decay (pattern effectiveness over time)
      // Use totalTrades as proxy for activity - low trade count = older/stale pattern
      const tradesPerMonth = pattern.totalTrades / 6; // Assume ~6 months of data
      const activityScore = Math.min(tradesPerMonth / 5, 1.0); // Normalize: 5+ trades/month = full score
      const decayFactor = 0.5 + activityScore * 0.5; // Range: 0.5 to 1.0 based on activity
      const newAlphaScore = Math.min(
        newWinRate * decayFactor,
        pattern.alphaScore
      );

      // Update database
      const newWinningTrades = wasSuccessful ? pattern.winningTrades + 1 : pattern.winningTrades;
      const newTotalTrades = pattern.totalTrades + 1;
      const finalWinRate = newWinningTrades / newTotalTrades;
      
      await db
        .update(winningPatterns)
        .set({
          winRate: finalWinRate.toString(),
          profitFactor: newProfitFactor.toString(),
          alphaDecayFlag: newAlphaScore < 0.3,
          totalTrades: newTotalTrades,
          winningTrades: newWinningTrades,
        })
        .where(eq(winningPatterns.id, patternId));

      console.log(`[${this.config.name}] Updated pattern ${pattern.patternName}: winRate=${newWinRate.toFixed(2)}, alpha=${newAlphaScore.toFixed(2)}`);
    } catch (error) {
      console.error(`[${this.config.name}] Failed to update pattern:`, error);
    }
  }

  /**
   * Calculate exit recommendation for open positions (Phase 3 Enhancement)
   * 
   * Provides intelligent exit signals based on:
   * - Pattern completion/invalidation
   * - Historical pattern performance
   * - Target price proximity
   * - Stop-loss proximity
   */
  private calculateExitRecommendation(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    detected: { name: string; timeframe: string; confidence: number; description: string },
    validated: Pattern
  ): {
    action: 'hold' | 'partial_exit' | 'full_exit';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    exitPercent?: number;
    confidence: number;
  } {
    const reasons: string[] = [];
    let exitScore = 0; // 0-100 scale, higher = more urgent exit
    
    // 1. Pattern signal reversal
    // If pattern is now signaling opposite direction, consider exit
    if (signal === 'bearish' && confidence > 0.6) {
      exitScore += 30;
      reasons.push(`Pattern now bearish (${(confidence * 100).toFixed(0)}% confidence)`);
    } else if (signal === 'bullish' && confidence > 0.6) {
      exitScore += 30;
      reasons.push(`Pattern now bullish (${(confidence * 100).toFixed(0)}% confidence)`);
    }
    
    // 2. Pattern alpha decay
    // If pattern's historical edge is diminishing, consider exit
    if (validated.alphaScore < 0.3) {
      exitScore += 25;
      reasons.push(`Pattern alpha decayed (${(validated.alphaScore * 100).toFixed(0)}%)`);
    } else if (validated.alphaScore < 0.5) {
      exitScore += 15;
      reasons.push(`Pattern alpha weakening (${(validated.alphaScore * 100).toFixed(0)}%)`);
    }
    
    // 3. Historical win rate declining
    if (validated.winRate < 0.45) {
      exitScore += 20;
      reasons.push(`Pattern win rate low (${(validated.winRate * 100).toFixed(0)}%)`);
    } else if (validated.winRate < 0.55) {
      exitScore += 10;
      reasons.push(`Pattern win rate marginal (${(validated.winRate * 100).toFixed(0)}%)`);
    }
    
    // 4. Detection confidence dropping
    if (detected.confidence < 0.4) {
      exitScore += 20;
      reasons.push(`Pattern confidence dropped (${(detected.confidence * 100).toFixed(0)}%)`);
    } else if (detected.confidence < 0.6) {
      exitScore += 10;
      reasons.push(`Pattern confidence weakening (${(detected.confidence * 100).toFixed(0)}%)`);
    }
    
    // 5. Max hold period approaching
    // Note: This would need position entry time to calculate properly
    // For now, we flag if pattern has short max hold
    if (validated.maxHold && validated.maxHold < 4) {
      exitScore += 15;
      reasons.push(`Pattern has short max hold (${validated.maxHold}h)`);
    }
    
    // Determine action based on exit score
    let action: 'hold' | 'partial_exit' | 'full_exit' = 'hold';
    let urgency: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let exitPercent: number | undefined;
    
    if (exitScore >= 70) {
      action = 'full_exit';
      urgency = 'critical';
    } else if (exitScore >= 50) {
      action = 'full_exit';
      urgency = 'high';
    } else if (exitScore >= 35) {
      action = 'partial_exit';
      urgency = 'medium';
      exitPercent = 50;
    } else if (exitScore >= 20) {
      action = 'partial_exit';
      urgency = 'low';
      exitPercent = 25;
    }
    
    return {
      action,
      urgency,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Pattern holding steady',
      exitPercent,
      confidence: Math.min(exitScore / 100, 1.0),
    };
  }
}
