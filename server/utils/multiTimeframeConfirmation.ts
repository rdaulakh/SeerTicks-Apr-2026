/**
 * Multi-Timeframe Confirmation System
 * 
 * Validates trading signals across multiple timeframes to increase confidence.
 * Implements the 4h → 1h → 5m confirmation strategy from backtest results.
 */

import { getCandleCache, type Candle } from '../WebSocketCandleCache';
import { getPatternConfig } from '../db/patternQueries';
import { detectAllPatterns } from '../agents/PatternDetection';

// Performance optimization: Cache pattern configs to avoid DB queries on every tick
const patternConfigCache = new Map<string, { config: any; timestamp: number }>();
const PATTERN_CONFIG_CACHE_TTL = 300000; // 5 minutes

// Performance optimization: Cache MTF results to avoid redundant calculations
const mtfResultCache = new Map<string, { result: MultiTimeframeResult; timestamp: number }>();
const MTF_RESULT_CACHE_TTL = 5000; // 5 seconds (enough for debounced ticks)

export interface TimeframePattern {
  timeframe: string;
  patternName: string;
  confidence: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface MultiTimeframeResult {
  primaryTimeframe: string;
  alignedTimeframes: string[];
  totalTimeframes: number;
  alignmentScore: number; // 0-1
  confidenceBoost: number; // 0-0.10 (max 10% boost)
  reasoning: string;
}

/**
 * Timeframe hierarchy for confirmation
 * Lower index = higher priority
 */
const TIMEFRAME_HIERARCHY = ['1d', '4h', '1h', '5m', '1m'];

/**
 * Major timeframes that must align for entry confirmation
 * All three must agree to reduce false breakouts
 */
const MAJOR_TIMEFRAMES = ['1d', '4h', '1h'];

/**
 * Get timeframes to check for confirmation based on primary timeframe
 * 
 * @param primaryTimeframe The timeframe where pattern was detected
 * @param requireMajorAlignment If true, always check all major timeframes (1D, 4H, 1H)
 * @returns Array of timeframes to check (including primary)
 */
function getConfirmationTimeframes(primaryTimeframe: string, requireMajorAlignment: boolean = true): string[] {
  // For entry signals, require all major timeframes to align
  if (requireMajorAlignment) {
    return MAJOR_TIMEFRAMES;
  }
  
  // Legacy behavior: check primary + adjacent timeframes
  const primaryIndex = TIMEFRAME_HIERARCHY.indexOf(primaryTimeframe);
  
  if (primaryIndex === -1) {
    return [primaryTimeframe];
  }
  
  // Check primary + 1 higher + 1 lower timeframe
  const timeframes: string[] = [primaryTimeframe];
  
  // Add higher timeframe (if exists)
  if (primaryIndex > 0) {
    timeframes.unshift(TIMEFRAME_HIERARCHY[primaryIndex - 1]);
  }
  
  // Add lower timeframe (if exists)
  if (primaryIndex < TIMEFRAME_HIERARCHY.length - 1) {
    timeframes.push(TIMEFRAME_HIERARCHY[primaryIndex + 1]);
  }
  
  return timeframes;
}

/**
 * Detect pattern on a specific timeframe
 * 
 * @param symbol Trading symbol
 * @param timeframe Candle timeframe
 * @param patternName Pattern to detect
 * @returns Pattern detection result or null
 */
async function detectPatternOnTimeframe(
  symbol: string,
  timeframe: string,
  patternName: string
): Promise<TimeframePattern | null> {
  try {
    // Get candles from cache
    const candleCache = getCandleCache();
    const candles = candleCache.getCandles(symbol, timeframe, 50);
    
    if (candles.length < 20) {
      return null;
    }
    
    // Use pre-imported pattern detection (no dynamic import on every tick)
    const detectedPatterns = detectAllPatterns(candles, timeframe);
    
    // Find matching pattern
    const match = detectedPatterns.find(p => p.name === patternName);
    
    if (!match) {
      return null;
    }
    
    // Get validated pattern config (with caching to avoid DB queries)
    const cacheKey = `${patternName}:${symbol}:${timeframe}`;
    let config = null;
    const cached = patternConfigCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < PATTERN_CONFIG_CACHE_TTL)) {
      config = cached.config;
    } else {
      config = await getPatternConfig(patternName, symbol, timeframe);
      patternConfigCache.set(cacheKey, { config, timestamp: Date.now() });
    }
    
    if (!config || config.winRate < 0.55) {
      return null;
    }
    
    // Determine signal
    const bullishPatterns = ["Double Bottom", "Bullish Engulfing", "Hammer", "Ascending Triangle"];
    const bearishPatterns = ["Double Top", "Bearish Engulfing", "Shooting Star", "Descending Triangle"];
    
    let signal: 'BUY' | 'SELL' | 'NEUTRAL';
    if (bullishPatterns.includes(patternName)) {
      signal = 'BUY';
    } else if (bearishPatterns.includes(patternName)) {
      signal = 'SELL';
    } else {
      signal = 'NEUTRAL';
    }
    
    return {
      timeframe,
      patternName,
      confidence: match.confidence * config.winRate,
      signal,
    };
  } catch (error) {
    console.error(`[MTF] Error detecting pattern on ${timeframe}:`, error);
    return null;
  }
}

/**
 * Check multi-timeframe confirmation for a pattern
 * 
 * @param symbol Trading symbol
 * @param primaryTimeframe Primary timeframe where pattern was detected
 * @param patternName Pattern name
 * @param primarySignal Primary signal (BUY/SELL)
 * @param requireMajorAlignment If true, require all major timeframes (1D, 4H, 1H) to align
 * @returns Multi-timeframe confirmation result
 */
export async function checkMultiTimeframeConfirmation(
  symbol: string,
  primaryTimeframe: string,
  patternName: string,
  primarySignal: 'BUY' | 'SELL',
  requireMajorAlignment: boolean = true
): Promise<MultiTimeframeResult> {
  try {
    // Check cache first to avoid redundant calculations
    const cacheKey = `${symbol}:${primaryTimeframe}:${patternName}:${primarySignal}`;
    const cached = mtfResultCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < MTF_RESULT_CACHE_TTL)) {
      return cached.result;
    }
    
    // Get timeframes to check
    const timeframesToCheck = getConfirmationTimeframes(primaryTimeframe, requireMajorAlignment);
    
    // Detect pattern on each timeframe
    const detections = await Promise.all(
      timeframesToCheck.map(tf => detectPatternOnTimeframe(symbol, tf, patternName))
    );
    
    // Filter out nulls and check alignment
    const validDetections = detections.filter(d => d !== null) as TimeframePattern[];
    const alignedDetections = validDetections.filter(d => d.signal === primarySignal);
    
    // Calculate alignment score
    const alignmentScore = alignedDetections.length / timeframesToCheck.length;
    
    // Calculate confidence boost
    // When requiring major alignment: +15% only if ALL 3 major timeframes align
    // Otherwise: +5% for 2 aligned, +10% for 3+ aligned
    let confidenceBoost = 0;
    if (requireMajorAlignment) {
      // Strict mode: require all major timeframes to align
      if (alignedDetections.length === MAJOR_TIMEFRAMES.length) {
        confidenceBoost = 0.15; // Higher boost for full alignment
      }
      // No partial credit in strict mode
    } else {
      // Legacy mode: partial credit for alignment
      if (alignedDetections.length === 2) {
        confidenceBoost = 0.05;
      } else if (alignedDetections.length >= 3) {
        confidenceBoost = 0.10;
      }
    }
    
    // Generate reasoning
    const alignedTimeframes = alignedDetections.map(d => d.timeframe);
    const missingTimeframes = timeframesToCheck.filter(tf => !alignedTimeframes.includes(tf));
    let reasoning = '';
    
    if (requireMajorAlignment) {
      // Strict mode: require all major timeframes
      if (alignedDetections.length === MAJOR_TIMEFRAMES.length) {
        reasoning = `✅ FULL MAJOR TIMEFRAME ALIGNMENT: ${patternName} pattern confirmed across all major timeframes (${alignedTimeframes.join(', ')}). +${(confidenceBoost * 100).toFixed(0)}% confidence boost. Entry approved.`;
      } else {
        reasoning = `❌ INSUFFICIENT ALIGNMENT: ${patternName} pattern aligned on ${alignedDetections.length}/${MAJOR_TIMEFRAMES.length} major timeframes (${alignedTimeframes.join(', ')}). Missing: ${missingTimeframes.join(', ')}. Entry blocked to reduce false breakouts.`;
      }
    } else {
      // Legacy mode: partial credit
      if (alignedDetections.length === timeframesToCheck.length) {
        reasoning = `✅ STRONG CONFIRMATION: ${patternName} pattern aligned across all ${alignedDetections.length} timeframes (${alignedTimeframes.join(', ')}). +${(confidenceBoost * 100).toFixed(0)}% confidence boost.`;
      } else if (alignedDetections.length >= 2) {
        reasoning = `✅ PARTIAL CONFIRMATION: ${patternName} pattern aligned on ${alignedDetections.length}/${timeframesToCheck.length} timeframes (${alignedTimeframes.join(', ')}). +${(confidenceBoost * 100).toFixed(0)}% confidence boost.`;
      } else {
        reasoning = `⚠️ NO CONFIRMATION: ${patternName} pattern only detected on ${primaryTimeframe}. No confidence boost applied.`;
      }
    }
    
    const result: MultiTimeframeResult = {
      primaryTimeframe,
      alignedTimeframes,
      totalTimeframes: timeframesToCheck.length,
      alignmentScore,
      confidenceBoost,
      reasoning,
    };
    
    // Cache the result
    mtfResultCache.set(cacheKey, { result, timestamp: Date.now() });
    
    return result;
  } catch (error) {
    console.error('[MTF] Error checking multi-timeframe confirmation:', error);
    return {
      primaryTimeframe,
      alignedTimeframes: [primaryTimeframe],
      totalTimeframes: 1,
      alignmentScore: 0,
      confidenceBoost: 0,
      reasoning: 'Multi-timeframe confirmation failed',
    };
  }
}

/**
 * Get optimal entry timeframe for a pattern
 * 
 * @param primaryTimeframe Primary timeframe where pattern was detected
 * @returns Optimal entry timeframe (typically 1-2 levels lower)
 */
export function getOptimalEntryTimeframe(primaryTimeframe: string): string {
  const primaryIndex = TIMEFRAME_HIERARCHY.indexOf(primaryTimeframe);
  
  if (primaryIndex === -1 || primaryIndex >= TIMEFRAME_HIERARCHY.length - 1) {
    return primaryTimeframe;
  }
  
  // Entry on 1 timeframe lower (e.g., 4h → 1h, 1h → 5m)
  return TIMEFRAME_HIERARCHY[primaryIndex + 1];
}

/**
 * Check if signal strength justifies entry
 * 
 * @param confidence Base confidence (0-1)
 * @param mtfResult Multi-timeframe confirmation result
 * @param minConfidence Minimum confidence threshold (default 0.60)
 * @param requireMajorAlignment If true, require all major timeframes to align (strict mode)
 * @returns True if signal is strong enough for entry
 */
export function shouldEnterTrade(
  confidence: number,
  mtfResult: MultiTimeframeResult,
  minConfidence: number = 0.60,
  requireMajorAlignment: boolean = true
): boolean {
  // In strict mode, require all major timeframes to align
  if (requireMajorAlignment) {
    const allMajorAligned = mtfResult.alignedTimeframes.length === MAJOR_TIMEFRAMES.length &&
                            MAJOR_TIMEFRAMES.every(tf => mtfResult.alignedTimeframes.includes(tf));
    
    if (!allMajorAligned) {
      return false; // Block entry if not all major timeframes align
    }
  }
  
  // Check confidence threshold
  const boostedConfidence = Math.min(confidence + mtfResult.confidenceBoost, 1.0);
  return boostedConfidence >= minConfidence;
}
