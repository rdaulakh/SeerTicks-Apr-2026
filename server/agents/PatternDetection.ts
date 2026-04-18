import { MarketData } from "../exchanges";

export interface DetectedPattern {
  name: string;
  timeframe: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
  description: string;
}

/**
 * Pattern Detection Algorithms
 * Implements institutional-grade chart pattern recognition
 */

/**
 * Detect Double Bottom pattern
 * Two distinct lows at similar price levels with a peak in between
 */
export function detectDoubleBottom(candles: MarketData[], tolerance: number = 0.02): DetectedPattern | null {
  if (candles.length < 20) return null;

  const recentCandles = candles.slice(-50); // Look at last 50 candles
  
  // Find local minima
  const minima: { index: number; price: number }[] = [];
  for (let i = 2; i < recentCandles.length - 2; i++) {
    const current = recentCandles[i].low;
    const prev1 = recentCandles[i - 1].low;
    const prev2 = recentCandles[i - 2].low;
    const next1 = recentCandles[i + 1].low;
    const next2 = recentCandles[i + 2].low;
    
    if (current < prev1 && current < prev2 && current < next1 && current < next2) {
      minima.push({ index: i, price: current });
    }
  }

  // Need at least 2 minima for double bottom
  if (minima.length < 2) return null;

  // Find pairs of minima at similar price levels
  for (let i = 0; i < minima.length - 1; i++) {
    for (let j = i + 1; j < minima.length; j++) {
      const first = minima[i];
      const second = minima[j];
      
      // Check if prices are similar (within tolerance)
      const priceDiff = Math.abs(first.price - second.price) / first.price;
      if (priceDiff > tolerance) continue;
      
      // Check if there's a peak between them
      const between = recentCandles.slice(first.index, second.index + 1);
      const peak = Math.max(...between.map(c => c.high));
      const avgBottom = (first.price + second.price) / 2;
      
      // Peak should be significantly higher than bottoms
      if (peak < avgBottom * 1.03) continue;
      
      // Check if price is breaking above the peak (confirmation)
      const currentPrice = recentCandles[recentCandles.length - 1].close;
      const currentVolume = recentCandles[recentCandles.length - 1].volume;
      const isConfirmed = currentPrice > peak;
      
      // Dynamic confidence calculation (updates every tick)
      let confidence = 0.5; // Base confidence
      
      // 1. Pattern Formation Quality (+0-0.25)
      // How similar are the two bottoms?
      const formationQuality = 1 - priceDiff; // 0-1 (lower diff = higher quality)
      confidence += formationQuality * 0.25;
      
      // 2. Breakout Progress (+0-0.30)
      // How far has price moved from pattern formation?
      if (isConfirmed) {
        const breakoutDistance = (currentPrice - peak) / peak;
        const breakoutScore = Math.min(breakoutDistance / 0.05, 1.0); // Max at 5% breakout
        confidence += breakoutScore * 0.30;
      } else {
        // Price approaching peak but not broken yet
        const approachDistance = (currentPrice - avgBottom) / (peak - avgBottom);
        confidence += Math.max(0, approachDistance - 0.5) * 0.15; // Bonus for being close
      }
      
      // 3. Volume Confirmation (+0-0.20)
      // Is volume increasing during breakout?
      const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
      const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const historicalVolumes = recentCandles.slice(-20, -5).map(c => c.volume);
      const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
      const volumeRatio = avgRecentVolume / avgHistoricalVolume;
      
      if (volumeRatio > 1.5) {
        confidence += 0.20; // Strong volume confirmation
      } else if (volumeRatio > 1.2) {
        confidence += 0.12; // Moderate volume
      } else if (volumeRatio > 1.0) {
        confidence += 0.05; // Slight volume increase
      }
      
      // 4. Pattern Age Decay (-0-0.10)
      // Older patterns are less reliable
      const patternAge = recentCandles.length - second.index;
      const ageDecay = Math.min(patternAge / 20, 0.10); // Max 10% decay
      confidence -= ageDecay;
      
      // 5. Price Momentum (+0-0.15)
      // Is price accelerating in the expected direction?
      const priceChange5 = (currentPrice - recentCandles[recentCandles.length - 6].close) / recentCandles[recentCandles.length - 6].close;
      if (priceChange5 > 0.02) {
        confidence += 0.15; // Strong upward momentum
      } else if (priceChange5 > 0.01) {
        confidence += 0.08; // Moderate momentum
      } else if (priceChange5 > 0) {
        confidence += 0.03; // Slight momentum
      }
      
      // Clamp to 0.05-0.95 range (never 0 or 1)
      confidence = Math.max(0.05, Math.min(0.95, confidence));
      
      return {
        name: "Double Bottom",
        timeframe: "unknown", // Will be set by caller
        confidence,
        startIndex: first.index,
        endIndex: second.index,
        description: `Double bottom at $${avgBottom.toFixed(2)} with peak at $${peak.toFixed(2)}${isConfirmed ? ' (confirmed breakout)' : ''} - Confidence: ${(confidence * 100).toFixed(1)}%`,
      };
    }
  }

  return null;
}

/**
 * Detect Double Top pattern
 * Two distinct highs at similar price levels with a trough in between
 */
export function detectDoubleTop(candles: MarketData[], tolerance: number = 0.02): DetectedPattern | null {
  if (candles.length < 20) return null;

  const recentCandles = candles.slice(-50);
  
  // Find local maxima
  const maxima: { index: number; price: number }[] = [];
  for (let i = 2; i < recentCandles.length - 2; i++) {
    const current = recentCandles[i].high;
    const prev1 = recentCandles[i - 1].high;
    const prev2 = recentCandles[i - 2].high;
    const next1 = recentCandles[i + 1].high;
    const next2 = recentCandles[i + 2].high;
    
    if (current > prev1 && current > prev2 && current > next1 && current > next2) {
      maxima.push({ index: i, price: current });
    }
  }

  if (maxima.length < 2) return null;

  for (let i = 0; i < maxima.length - 1; i++) {
    for (let j = i + 1; j < maxima.length; j++) {
      const first = maxima[i];
      const second = maxima[j];
      
      const priceDiff = Math.abs(first.price - second.price) / first.price;
      if (priceDiff > tolerance) continue;
      
      const between = recentCandles.slice(first.index, second.index + 1);
      const trough = Math.min(...between.map(c => c.low));
      const avgTop = (first.price + second.price) / 2;
      
      if (trough > avgTop * 0.97) continue;
      
      const currentPrice = recentCandles[recentCandles.length - 1].close;
      const currentVolume = recentCandles[recentCandles.length - 1].volume;
      const isConfirmed = currentPrice < trough;
      
      // Dynamic confidence calculation (updates every tick)
      let confidence = 0.5; // Base confidence
      
      // 1. Pattern Formation Quality (+0-0.25)
      const formationQuality = 1 - priceDiff;
      confidence += formationQuality * 0.25;
      
      // 2. Breakdown Progress (+0-0.30)
      if (isConfirmed) {
        const breakdownDistance = (trough - currentPrice) / trough;
        const breakdownScore = Math.min(breakdownDistance / 0.05, 1.0); // Max at 5% breakdown
        confidence += breakdownScore * 0.30;
      } else {
        // Price approaching trough but not broken yet
        const approachDistance = (avgTop - currentPrice) / (avgTop - trough);
        confidence += Math.max(0, approachDistance - 0.5) * 0.15;
      }
      
      // 3. Volume Confirmation (+0-0.20)
      const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
      const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const historicalVolumes = recentCandles.slice(-20, -5).map(c => c.volume);
      const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
      const volumeRatio = avgRecentVolume / avgHistoricalVolume;
      
      if (volumeRatio > 1.5) {
        confidence += 0.20;
      } else if (volumeRatio > 1.2) {
        confidence += 0.12;
      } else if (volumeRatio > 1.0) {
        confidence += 0.05;
      }
      
      // 4. Pattern Age Decay (-0-0.10)
      const patternAge = recentCandles.length - second.index;
      const ageDecay = Math.min(patternAge / 20, 0.10);
      confidence -= ageDecay;
      
      // 5. Price Momentum (+0-0.15)
      const priceChange5 = (recentCandles[recentCandles.length - 6].close - currentPrice) / recentCandles[recentCandles.length - 6].close;
      if (priceChange5 > 0.02) {
        confidence += 0.15; // Strong downward momentum
      } else if (priceChange5 > 0.01) {
        confidence += 0.08;
      } else if (priceChange5 > 0) {
        confidence += 0.03;
      }
      
      // Clamp to 0.05-0.95 range
      confidence = Math.max(0.05, Math.min(0.95, confidence));
      
      return {
        name: "Double Top",
        timeframe: "unknown",
        confidence,
        startIndex: first.index,
        endIndex: second.index,
        description: `Double top at $${avgTop.toFixed(2)} with trough at $${trough.toFixed(2)}${isConfirmed ? ' (confirmed breakdown)' : ''} - Confidence: ${(confidence * 100).toFixed(1)}%`,
      };
    }
  }

  return null;
}

/**
 * Detect Bullish Engulfing pattern
 * Large green candle completely engulfs previous red candle
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectBullishEngulfing(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 2) return null;

  const prev = candles[candles.length - 2];
  const current = candles[candles.length - 1];

  // Previous candle must be bearish (red)
  if (prev.close >= prev.open) return null;

  // Current candle must be bullish (green)
  if (current.close <= current.open) return null;

  // Current candle must engulf previous candle
  const engulfs = current.open <= prev.close && current.close >= prev.open;
  if (!engulfs) return null;

  // Dynamic confidence calculation
  const prevSize = Math.abs(prev.close - prev.open);
  const currentSize = Math.abs(current.close - current.open);
  const sizeRatio = currentSize / prevSize;
  
  let confidence = 0.5; // Base confidence
  
  // 1. Engulfing Size (+0-0.30)
  if (sizeRatio > 2.0) {
    confidence += 0.30; // Very strong engulfing (>2x)
  } else if (sizeRatio > 1.5) {
    confidence += 0.20; // Strong engulfing (1.5-2x)
  } else if (sizeRatio > 1.2) {
    confidence += 0.10; // Moderate engulfing (1.2-1.5x)
  }
  
  // 2. Volume Confirmation (+0-0.20)
  if (candles.length >= 10) {
    const recentVolumes = candles.slice(-5).map(c => c.volume);
    const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const historicalVolumes = candles.slice(-20, -5).map(c => c.volume);
    const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
    const volumeRatio = avgRecentVolume / avgHistoricalVolume;
    
    if (volumeRatio > 1.5) {
      confidence += 0.20;
    } else if (volumeRatio > 1.2) {
      confidence += 0.12;
    } else if (volumeRatio > 1.0) {
      confidence += 0.05;
    }
  }
  
  // 3. Follow-through (+0-0.25)
  // Use live price if provided to measure continuation
  const price = currentPrice !== undefined ? currentPrice : current.close;
  const followThrough = (price - current.close) / current.close;
  if (followThrough > 0.01) {
    confidence += 0.25; // Strong continuation (>1%)
  } else if (followThrough > 0.005) {
    confidence += 0.15; // Moderate continuation (0.5-1%)
  } else if (followThrough > 0) {
    confidence += 0.05; // Slight continuation
  } else if (followThrough < -0.01) {
    confidence -= 0.15; // Failed pattern (price reversing)
  }
  
  // Clamp to 0.05-0.95 range
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Bullish Engulfing",
    timeframe: "unknown",
    confidence,
    startIndex: candles.length - 2,
    endIndex: candles.length - 1,
    description: `Bullish engulfing: green candle engulfs previous red candle (${(sizeRatio * 100).toFixed(0)}% larger) - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Bearish Engulfing pattern
 * Large red candle completely engulfs previous green candle
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectBearishEngulfing(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 2) return null;

  const prev = candles[candles.length - 2];
  const current = candles[candles.length - 1];

  // Previous candle must be bullish (green)
  if (prev.close <= prev.open) return null;

  // Current candle must be bearish (red)
  if (current.close >= current.open) return null;

  // Current candle must engulf previous candle
  const engulfs = current.open >= prev.close && current.close <= prev.open;
  if (!engulfs) return null;

  // Dynamic confidence calculation
  const prevSize = Math.abs(prev.close - prev.open);
  const currentSize = Math.abs(current.close - current.open);
  const sizeRatio = currentSize / prevSize;
  
  let confidence = 0.5;
  
  // 1. Engulfing Size (+0-0.30)
  if (sizeRatio > 2.0) confidence += 0.30;
  else if (sizeRatio > 1.5) confidence += 0.20;
  else if (sizeRatio > 1.2) confidence += 0.10;
  
  // 2. Volume Confirmation (+0-0.20)
  if (candles.length >= 10) {
    const recentVolumes = candles.slice(-5).map(c => c.volume);
    const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const historicalVolumes = candles.slice(-20, -5).map(c => c.volume);
    const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
    const volumeRatio = avgRecentVolume / avgHistoricalVolume;
    if (volumeRatio > 1.5) confidence += 0.20;
    else if (volumeRatio > 1.2) confidence += 0.12;
    else if (volumeRatio > 1.0) confidence += 0.05;
  }
  
  // 3. Follow-through (+0-0.25)
  const price = currentPrice !== undefined ? currentPrice : current.close;
  const followThrough = (price - current.close) / current.close;
  if (followThrough < -0.01) confidence += 0.25;
  else if (followThrough < -0.005) confidence += 0.15;
  else if (followThrough < 0) confidence += 0.05;
  else if (followThrough > 0.01) confidence -= 0.15;
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Bearish Engulfing",
    timeframe: "unknown",
    confidence,
    startIndex: candles.length - 2,
    endIndex: candles.length - 1,
    description: `Bearish engulfing: red candle engulfs previous green candle (${(sizeRatio * 100).toFixed(0)}% larger) - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Hammer pattern
 * Small body at top, long lower shadow, little to no upper shadow
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectHammer(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 1) return null;

  const candle = candles[candles.length - 1];
  const body = Math.abs(candle.close - candle.open);
  const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
  const upperShadow = candle.high - Math.max(candle.open, candle.close);
  const totalRange = candle.high - candle.low;

  // Body should be small (< 30% of total range)
  if (body > totalRange * 0.3) return null;

  // Lower shadow should be at least 2x the body
  if (lowerShadow < body * 2) return null;

  // Upper shadow should be small (< 10% of total range)
  if (upperShadow > totalRange * 0.1) return null;

  // Dynamic confidence calculation
  let confidence = 0.5;
  
  // 1. Shadow-to-body ratio (+0-0.25)
  const shadowRatio = lowerShadow / body;
  if (shadowRatio > 4) confidence += 0.25;
  else if (shadowRatio > 3) confidence += 0.18;
  else if (shadowRatio > 2) confidence += 0.10;
  
  // 2. Follow-through (+0-0.25)
  const price = currentPrice !== undefined ? currentPrice : candle.close;
  const followThrough = (price - candle.close) / candle.close;
  if (followThrough > 0.01) confidence += 0.25;
  else if (followThrough > 0.005) confidence += 0.15;
  else if (followThrough > 0) confidence += 0.05;
  else if (followThrough < -0.01) confidence -= 0.15;
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Hammer",
    timeframe: "unknown",
    confidence,
    startIndex: candles.length - 1,
    endIndex: candles.length - 1,
    description: `Hammer pattern: long lower shadow (${shadowRatio.toFixed(1)}x body size) - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Shooting Star pattern
 * Small body at bottom, long upper shadow, little to no lower shadow
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectShootingStar(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 1) return null;

  const candle = candles[candles.length - 1];
  const body = Math.abs(candle.close - candle.open);
  const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
  const upperShadow = candle.high - Math.max(candle.open, candle.close);
  const totalRange = candle.high - candle.low;

  if (body > totalRange * 0.3) return null;
  if (upperShadow < body * 2) return null;
  if (lowerShadow > totalRange * 0.1) return null;

  // Dynamic confidence calculation
  let confidence = 0.5;
  
  // 1. Shadow-to-body ratio (+0-0.25)
  const shadowRatio = upperShadow / body;
  if (shadowRatio > 4) confidence += 0.25;
  else if (shadowRatio > 3) confidence += 0.18;
  else if (shadowRatio > 2) confidence += 0.10;
  
  // 2. Follow-through (+0-0.25)
  const price = currentPrice !== undefined ? currentPrice : candle.close;
  const followThrough = (price - candle.close) / candle.close;
  if (followThrough < -0.01) confidence += 0.25;
  else if (followThrough < -0.005) confidence += 0.15;
  else if (followThrough < 0) confidence += 0.05;
  else if (followThrough > 0.01) confidence -= 0.15;
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Shooting Star",
    timeframe: "unknown",
    confidence,
    startIndex: candles.length - 1,
    endIndex: candles.length - 1,
    description: `Shooting star pattern: long upper shadow (${(upperShadow / body).toFixed(1)}x body size) - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Ascending Triangle pattern
 * Flat resistance line with rising support line
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectAscendingTriangle(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-40);
  
  // Find resistance level (should be relatively flat)
  const highs = recentCandles.map(c => c.high);
  const resistanceLevel = Math.max(...highs.slice(-20));
  const touchingResistance = highs.filter(h => Math.abs(h - resistanceLevel) / resistanceLevel < 0.01).length;
  
  if (touchingResistance < 2) return null;

  // Find rising support (lows should be increasing)
  const lows = recentCandles.map(c => c.low);
  const firstHalfLows = lows.slice(0, 20);
  const secondHalfLows = lows.slice(20);
  const avgFirstHalfLow = firstHalfLows.reduce((a, b) => a + b, 0) / firstHalfLows.length;
  const avgSecondHalfLow = secondHalfLows.reduce((a, b) => a + b, 0) / secondHalfLows.length;
  
  // Support should be rising
  if (avgSecondHalfLow <= avgFirstHalfLow) return null;

  // Use live price if provided, otherwise use last candle close
  const price = currentPrice !== undefined ? currentPrice : recentCandles[recentCandles.length - 1].close;
  const isBreakout = price > resistanceLevel;

  // Dynamic confidence calculation (updates every tick)
  let confidence = 0.5; // Base confidence
  
  // 1. Pattern Formation Quality (+0-0.25)
  // How many times price touched resistance?
  const touchQuality = Math.min(touchingResistance / 4, 1.0); // Max at 4 touches
  confidence += touchQuality * 0.25;
  
  // 2. Breakout Progress (+0-0.35)
  if (isBreakout) {
    const breakoutDistance = (price - resistanceLevel) / resistanceLevel;
    const breakoutScore = Math.min(breakoutDistance / 0.03, 1.0); // Max at 3% breakout
    confidence += breakoutScore * 0.35;
  } else {
    // Price approaching resistance but not broken yet
    const approachDistance = (price - avgSecondHalfLow) / (resistanceLevel - avgSecondHalfLow);
    confidence += Math.max(0, approachDistance - 0.5) * 0.20; // Bonus for being close
  }
  
  // 3. Volume Confirmation (+0-0.20)
  const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
  const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const historicalVolumes = recentCandles.slice(-20, -5).map(c => c.volume);
  const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
  const volumeRatio = avgRecentVolume / avgHistoricalVolume;
  
  if (volumeRatio > 1.5) {
    confidence += 0.20; // Strong volume confirmation
  } else if (volumeRatio > 1.2) {
    confidence += 0.12; // Moderate volume
  } else if (volumeRatio > 1.0) {
    confidence += 0.05; // Slight volume increase
  }
  
  // 4. Support Strength (+0-0.15)
  // How strong is the rising support trend?
  const supportSlope = (avgSecondHalfLow - avgFirstHalfLow) / avgFirstHalfLow;
  if (supportSlope > 0.05) {
    confidence += 0.15; // Strong rising support
  } else if (supportSlope > 0.03) {
    confidence += 0.10; // Moderate rising support
  } else if (supportSlope > 0.01) {
    confidence += 0.05; // Weak rising support
  }
  
  // 5. Price Momentum (+0-0.10)
  const priceChange5 = (price - recentCandles[recentCandles.length - 6].close) / recentCandles[recentCandles.length - 6].close;
  if (priceChange5 > 0.02) {
    confidence += 0.10; // Strong upward momentum
  } else if (priceChange5 > 0.01) {
    confidence += 0.05; // Moderate momentum
  }
  
  // Clamp to 0.05-0.95 range
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Ascending Triangle",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Ascending triangle: resistance at $${resistanceLevel.toFixed(2)}, rising support${isBreakout ? ' (confirmed breakout)' : ''} - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Descending Triangle pattern
 * Flat support line with declining resistance line
 * @param candles Historical candle data
 * @param currentPrice Optional live price for tick-level confidence updates
 */
export function detectDescendingTriangle(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-40);
  
  // Find support level (should be relatively flat)
  const lows = recentCandles.map(c => c.low);
  const supportLevel = Math.min(...lows.slice(-20));
  const touchingSupport = lows.filter(l => Math.abs(l - supportLevel) / supportLevel < 0.01).length;
  
  if (touchingSupport < 2) return null;

  // Find declining resistance (highs should be decreasing)
  const highs = recentCandles.map(c => c.high);
  const firstHalfHighs = highs.slice(0, 20);
  const secondHalfHighs = highs.slice(20);
  const avgFirstHalfHigh = firstHalfHighs.reduce((a, b) => a + b, 0) / firstHalfHighs.length;
  const avgSecondHalfHigh = secondHalfHighs.reduce((a, b) => a + b, 0) / secondHalfHighs.length;
  
  // Resistance should be declining
  if (avgSecondHalfHigh >= avgFirstHalfHigh) return null;

  // Use live price if provided, otherwise use last candle close
  const price = currentPrice !== undefined ? currentPrice : recentCandles[recentCandles.length - 1].close;
  const isBreakdown = price < supportLevel;

  // Dynamic confidence calculation (updates every tick)
  let confidence = 0.5; // Base confidence
  
  // 1. Pattern Formation Quality (+0-0.25)
  const touchQuality = Math.min(touchingSupport / 4, 1.0); // Max at 4 touches
  confidence += touchQuality * 0.25;
  
  // 2. Breakdown Progress (+0-0.35)
  if (isBreakdown) {
    const breakdownDistance = (supportLevel - price) / supportLevel;
    const breakdownScore = Math.min(breakdownDistance / 0.03, 1.0); // Max at 3% breakdown
    confidence += breakdownScore * 0.35;
  } else {
    // Price approaching support but not broken yet
    const approachDistance = (avgFirstHalfHigh - price) / (avgFirstHalfHigh - supportLevel);
    confidence += Math.max(0, approachDistance - 0.5) * 0.20;
  }
  
  // 3. Volume Confirmation (+0-0.20)
  const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
  const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const historicalVolumes = recentCandles.slice(-20, -5).map(c => c.volume);
  const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
  const volumeRatio = avgRecentVolume / avgHistoricalVolume;
  
  if (volumeRatio > 1.5) {
    confidence += 0.20;
  } else if (volumeRatio > 1.2) {
    confidence += 0.12;
  } else if (volumeRatio > 1.0) {
    confidence += 0.05;
  }
  
  // 4. Resistance Decline Strength (+0-0.15)
  const resistanceSlope = (avgFirstHalfHigh - avgSecondHalfHigh) / avgFirstHalfHigh;
  if (resistanceSlope > 0.05) {
    confidence += 0.15;
  } else if (resistanceSlope > 0.03) {
    confidence += 0.10;
  } else if (resistanceSlope > 0.01) {
    confidence += 0.05;
  }
  
  // 5. Price Momentum (+0-0.10)
  const priceChange5 = (price - recentCandles[recentCandles.length - 6].close) / recentCandles[recentCandles.length - 6].close;
  if (priceChange5 < -0.02) {
    confidence += 0.10; // Strong downward momentum
  } else if (priceChange5 < -0.01) {
    confidence += 0.05;
  }
  
  // Clamp to 0.05-0.95 range
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  return {
    name: "Descending Triangle",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Descending triangle: support at $${supportLevel.toFixed(2)}, declining resistance${isBreakdown ? ' (confirmed breakdown)' : ''} - Confidence: ${(confidence * 100).toFixed(1)}%`,
  };
}

/**
 * Detect all patterns in candle data
 * @param candles Historical candle data
 * @param timeframe Timeframe string (1d, 4h, 5m, 1m)
 * @param currentPrice Optional live price for tick-level confidence updates (overrides last candle close)
 */
/**
 * Detect Head and Shoulders pattern
 * Bearish reversal pattern with three peaks, middle peak highest
 */
export function detectHeadAndShoulders(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-60);
  
  // Find local maxima (peaks)
  const peaks: { index: number; price: number }[] = [];
  for (let i = 3; i < recentCandles.length - 3; i++) {
    const current = recentCandles[i].high;
    const prev = recentCandles.slice(i - 3, i).map(c => c.high);
    const next = recentCandles.slice(i + 1, i + 4).map(c => c.high);
    
    if (current > Math.max(...prev) && current > Math.max(...next)) {
      peaks.push({ index: i, price: current });
    }
  }

  if (peaks.length < 3) return null;

  // Look for pattern: left shoulder < head > right shoulder
  for (let i = 0; i < peaks.length - 2; i++) {
    const leftShoulder = peaks[i];
    const head = peaks[i + 1];
    const rightShoulder = peaks[i + 2];
    
    // Head should be highest
    if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) continue;
    
    // Shoulders should be similar height (within 5%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.05) continue;
    
    // Find neckline (support level connecting the lows between peaks)
    const between1 = recentCandles.slice(leftShoulder.index, head.index);
    const between2 = recentCandles.slice(head.index, rightShoulder.index);
    const low1 = Math.min(...between1.map(c => c.low));
    const low2 = Math.min(...between2.map(c => c.low));
    const neckline = (low1 + low2) / 2;
    
    const current = currentPrice || recentCandles[recentCandles.length - 1].close;
    const isConfirmed = current < neckline;
    
    // Dynamic confidence
    let confidence = 0.55; // Base confidence
    
    // Pattern symmetry
    confidence += (1 - shoulderDiff) * 0.15;
    
    // Neckline break
    if (isConfirmed) {
      const breakDistance = (neckline - current) / neckline;
      confidence += Math.min(breakDistance / 0.03, 1.0) * 0.25;
    }
    
    // Volume confirmation
    const recentVolume = recentCandles.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
    const historicalVolume = recentCandles.slice(-20, -5).reduce((sum, c) => sum + c.volume, 0) / 15;
    if (recentVolume > historicalVolume * 1.3) {
      confidence += 0.15;
    }
    
    confidence = Math.min(0.95, confidence);
    
    return {
      name: "Head and Shoulders",
      timeframe: "",
      confidence,
      startIndex: leftShoulder.index,
      endIndex: rightShoulder.index,
      description: `Bearish reversal pattern with head at $${head.price.toFixed(2)}, neckline at $${neckline.toFixed(2)}${isConfirmed ? ' (CONFIRMED BREAK)' : ''}`
    };
  }

  return null;
}

/**
 * Detect Inverse Head and Shoulders pattern
 * Bullish reversal pattern with three troughs, middle trough lowest
 */
export function detectInverseHeadAndShoulders(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-60);
  
  // Find local minima (troughs)
  const troughs: { index: number; price: number }[] = [];
  for (let i = 3; i < recentCandles.length - 3; i++) {
    const current = recentCandles[i].low;
    const prev = recentCandles.slice(i - 3, i).map(c => c.low);
    const next = recentCandles.slice(i + 1, i + 4).map(c => c.low);
    
    if (current < Math.min(...prev) && current < Math.min(...next)) {
      troughs.push({ index: i, price: current });
    }
  }

  if (troughs.length < 3) return null;

  // Look for pattern: left shoulder > head < right shoulder
  for (let i = 0; i < troughs.length - 2; i++) {
    const leftShoulder = troughs[i];
    const head = troughs[i + 1];
    const rightShoulder = troughs[i + 2];
    
    // Head should be lowest
    if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) continue;
    
    // Shoulders should be similar height (within 5%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.05) continue;
    
    // Find neckline (resistance level connecting the highs between troughs)
    const between1 = recentCandles.slice(leftShoulder.index, head.index);
    const between2 = recentCandles.slice(head.index, rightShoulder.index);
    const high1 = Math.max(...between1.map(c => c.high));
    const high2 = Math.max(...between2.map(c => c.high));
    const neckline = (high1 + high2) / 2;
    
    const current = currentPrice || recentCandles[recentCandles.length - 1].close;
    const isConfirmed = current > neckline;
    
    // Dynamic confidence
    let confidence = 0.55;
    
    confidence += (1 - shoulderDiff) * 0.15;
    
    if (isConfirmed) {
      const breakDistance = (current - neckline) / neckline;
      confidence += Math.min(breakDistance / 0.03, 1.0) * 0.25;
    }
    
    const recentVolume = recentCandles.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
    const historicalVolume = recentCandles.slice(-20, -5).reduce((sum, c) => sum + c.volume, 0) / 15;
    if (recentVolume > historicalVolume * 1.3) {
      confidence += 0.15;
    }
    
    confidence = Math.min(0.95, confidence);
    
    return {
      name: "Inverse Head and Shoulders",
      timeframe: "",
      confidence,
      startIndex: leftShoulder.index,
      endIndex: rightShoulder.index,
      description: `Bullish reversal pattern with head at $${head.price.toFixed(2)}, neckline at $${neckline.toFixed(2)}${isConfirmed ? ' (CONFIRMED BREAK)' : ''}`
    };
  }

  return null;
}

/**
 * Detect Cup and Handle pattern
 * Bullish continuation pattern with U-shaped cup and small downward handle
 */
export function detectCupAndHandle(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 40) return null;

  const recentCandles = candles.slice(-80);
  const midpoint = Math.floor(recentCandles.length / 2);
  
  // Find the cup: U-shaped bottom
  const firstHalf = recentCandles.slice(0, midpoint);
  const secondHalf = recentCandles.slice(midpoint);
  
  const cupStart = firstHalf[0].high;
  const cupBottom = Math.min(...recentCandles.slice(0, midpoint + 10).map(c => c.low));
  const cupEnd = secondHalf[secondHalf.length - 1].high;
  
  // Cup should be U-shaped (both sides at similar height)
  const cupSymmetry = Math.abs(cupStart - cupEnd) / cupStart;
  if (cupSymmetry > 0.05) return null;
  
  // Cup depth should be significant (10-30%)
  const cupDepth = (cupStart - cupBottom) / cupStart;
  if (cupDepth < 0.10 || cupDepth > 0.30) return null;
  
  // Look for handle: small pullback after cup
  const handleCandles = recentCandles.slice(-15);
  const handleHigh = Math.max(...handleCandles.slice(0, 5).map(c => c.high));
  const handleLow = Math.min(...handleCandles.map(c => c.low));
  
  // Handle should be shallow (3-10% pullback)
  const handleDepth = (handleHigh - handleLow) / handleHigh;
  if (handleDepth < 0.03 || handleDepth > 0.10) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const breakoutLevel = cupEnd;
  const isConfirmed = current > breakoutLevel;
  
  // Dynamic confidence
  let confidence = 0.60;
  
  // Cup symmetry
  confidence += (1 - cupSymmetry) * 0.15;
  
  // Breakout confirmation
  if (isConfirmed) {
    const breakDistance = (current - breakoutLevel) / breakoutLevel;
    confidence += Math.min(breakDistance / 0.05, 1.0) * 0.20;
  }
  
  // Volume pattern (should increase on breakout)
  const breakoutVolume = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  const cupVolume = recentCandles.slice(-40, -15).reduce((sum, c) => sum + c.volume, 0) / 25;
  if (breakoutVolume > cupVolume * 1.5) {
    confidence += 0.15;
  }
  
  confidence = Math.min(0.95, confidence);
  
  return {
    name: "Cup and Handle",
    timeframe: "",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Bullish continuation pattern with cup depth ${(cupDepth * 100).toFixed(1)}%, breakout at $${breakoutLevel.toFixed(2)}${isConfirmed ? ' (CONFIRMED)' : ''}`
  };
}

/**
 * Detect Bullish Flag pattern
 * Continuation pattern with strong uptrend followed by consolidation
 */
export function detectBullishFlag(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 25) return null;

  const recentCandles = candles.slice(-40);
  
  // Identify flagpole: strong upward move
  const poleStart = recentCandles[0].close;
  const poleEnd = Math.max(...recentCandles.slice(0, 15).map(c => c.high));
  const poleGain = (poleEnd - poleStart) / poleStart;
  
  // Flagpole should be strong (>8% gain)
  if (poleGain < 0.08) return null;
  
  // Identify flag: downward sloping consolidation
  const flagCandles = recentCandles.slice(15, 35);
  if (flagCandles.length < 10) return null;
  
  const flagStart = flagCandles[0].high;
  const flagEnd = flagCandles[flagCandles.length - 1].low;
  const flagSlope = (flagEnd - flagStart) / flagStart;
  
  // Flag should slope down slightly (-2% to -8%)
  if (flagSlope > -0.02 || flagSlope < -0.08) return null;
  
  // Flag should be narrow (consolidation)
  const flagRange = (Math.max(...flagCandles.map(c => c.high)) - Math.min(...flagCandles.map(c => c.low))) / flagStart;
  if (flagRange > 0.10) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const breakoutLevel = Math.max(...flagCandles.map(c => c.high));
  const isConfirmed = current > breakoutLevel;
  
  // Dynamic confidence
  let confidence = 0.55;
  
  // Flagpole strength
  confidence += Math.min(poleGain / 0.15, 1.0) * 0.15;
  
  // Flag tightness
  confidence += (1 - flagRange / 0.10) * 0.10;
  
  // Breakout confirmation
  if (isConfirmed) {
    const breakDistance = (current - breakoutLevel) / breakoutLevel;
    confidence += Math.min(breakDistance / 0.03, 1.0) * 0.25;
  }
  
  // Volume (should decrease in flag, increase on breakout)
  const flagVolume = flagCandles.reduce((sum, c) => sum + c.volume, 0) / flagCandles.length;
  const poleVolume = recentCandles.slice(0, 15).reduce((sum, c) => sum + c.volume, 0) / 15;
  const recentVolume = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  
  if (flagVolume < poleVolume * 0.7 && recentVolume > flagVolume * 1.3) {
    confidence += 0.15;
  }
  
  confidence = Math.min(0.95, confidence);
  
  return {
    name: "Bullish Flag",
    timeframe: "",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Bullish continuation with ${(poleGain * 100).toFixed(1)}% flagpole, breakout at $${breakoutLevel.toFixed(2)}${isConfirmed ? ' (CONFIRMED)' : ''}`
  };
}

/**
 * Detect Bearish Flag pattern
 * Continuation pattern with strong downtrend followed by consolidation
 */
export function detectBearishFlag(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 25) return null;

  const recentCandles = candles.slice(-40);
  
  // Identify flagpole: strong downward move
  const poleStart = recentCandles[0].close;
  const poleEnd = Math.min(...recentCandles.slice(0, 15).map(c => c.low));
  const poleDrop = (poleStart - poleEnd) / poleStart;
  
  // Flagpole should be strong (>8% drop)
  if (poleDrop < 0.08) return null;
  
  // Identify flag: upward sloping consolidation
  const flagCandles = recentCandles.slice(15, 35);
  if (flagCandles.length < 10) return null;
  
  const flagStart = flagCandles[0].low;
  const flagEnd = flagCandles[flagCandles.length - 1].high;
  const flagSlope = (flagEnd - flagStart) / flagStart;
  
  // Flag should slope up slightly (2% to 8%)
  if (flagSlope < 0.02 || flagSlope > 0.08) return null;
  
  // Flag should be narrow (consolidation)
  const flagRange = (Math.max(...flagCandles.map(c => c.high)) - Math.min(...flagCandles.map(c => c.low))) / flagStart;
  if (flagRange > 0.10) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const breakoutLevel = Math.min(...flagCandles.map(c => c.low));
  const isConfirmed = current < breakoutLevel;
  
  // Dynamic confidence
  let confidence = 0.55;
  
  // Flagpole strength
  confidence += Math.min(poleDrop / 0.15, 1.0) * 0.15;
  
  // Flag tightness
  confidence += (1 - flagRange / 0.10) * 0.10;
  
  // Breakout confirmation
  if (isConfirmed) {
    const breakDistance = (breakoutLevel - current) / breakoutLevel;
    confidence += Math.min(breakDistance / 0.03, 1.0) * 0.25;
  }
  
  // Volume
  const flagVolume = flagCandles.reduce((sum, c) => sum + c.volume, 0) / flagCandles.length;
  const poleVolume = recentCandles.slice(0, 15).reduce((sum, c) => sum + c.volume, 0) / 15;
  const recentVolume = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  
  if (flagVolume < poleVolume * 0.7 && recentVolume > flagVolume * 1.3) {
    confidence += 0.15;
  }
  
  confidence = Math.min(0.95, confidence);
  
  return {
    name: "Bearish Flag",
    timeframe: "",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Bearish continuation with ${(poleDrop * 100).toFixed(1)}% flagpole, breakdown at $${breakoutLevel.toFixed(2)}${isConfirmed ? ' (CONFIRMED)' : ''}`
  };
}

export function detectAllPatterns(candles: MarketData[], timeframe: string, currentPrice?: number): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Try all pattern detection functions (19 patterns total)
  const detectors = [
    detectDoubleBottom,
    detectDoubleTop,
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectHammer,
    detectShootingStar,
    detectAscendingTriangle,
    detectDescendingTriangle,
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectCupAndHandle,
    detectBullishFlag,
    detectBearishFlag,
    // Phase 2: New pattern types
    detectTripleTop,
    detectTripleBottom,
    detectRisingWedge,
    detectFallingWedge,
    detectBullishPennant,
    detectBearishPennant,
  ];

  for (const detector of detectors) {
    // Pass currentPrice to detectors that support it
    const pattern = detector(candles, currentPrice);
    if (pattern) {
      pattern.timeframe = timeframe;
      patterns.push(pattern);
    }
  }

  return patterns;
}


/**
 * Detect Triple Top pattern
 * Three distinct highs at similar price levels - bearish reversal
 * Win rate: 65-70%
 */
export function detectTripleTop(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-60);
  
  // Find local maxima
  const maxima: { index: number; price: number }[] = [];
  for (let i = 3; i < recentCandles.length - 3; i++) {
    const current = recentCandles[i].high;
    const prev1 = recentCandles[i - 1].high;
    const prev2 = recentCandles[i - 2].high;
    const prev3 = recentCandles[i - 3].high;
    const next1 = recentCandles[i + 1].high;
    const next2 = recentCandles[i + 2].high;
    const next3 = recentCandles[i + 3].high;
    
    if (current > prev1 && current > prev2 && current > prev3 &&
        current > next1 && current > next2 && current > next3) {
      maxima.push({ index: i, price: current });
    }
  }

  // Need at least 3 maxima for triple top
  if (maxima.length < 3) return null;

  // Find three peaks at similar levels (within 2% tolerance)
  const tolerance = 0.02;
  
  for (let i = 0; i < maxima.length - 2; i++) {
    for (let j = i + 1; j < maxima.length - 1; j++) {
      for (let k = j + 1; k < maxima.length; k++) {
        const first = maxima[i];
        const second = maxima[j];
        const third = maxima[k];
        
        // Check if all three peaks are at similar levels
        const avgPeak = (first.price + second.price + third.price) / 3;
        const diff1 = Math.abs(first.price - avgPeak) / avgPeak;
        const diff2 = Math.abs(second.price - avgPeak) / avgPeak;
        const diff3 = Math.abs(third.price - avgPeak) / avgPeak;
        
        if (diff1 > tolerance || diff2 > tolerance || diff3 > tolerance) continue;
        
        // Find troughs between peaks
        const trough1 = Math.min(...recentCandles.slice(first.index, second.index + 1).map(c => c.low));
        const trough2 = Math.min(...recentCandles.slice(second.index, third.index + 1).map(c => c.low));
        const neckline = Math.min(trough1, trough2);
        
        // Peaks should be significantly above neckline
        if (avgPeak < neckline * 1.03) continue;
        
        const current = currentPrice || recentCandles[recentCandles.length - 1].close;
        const isConfirmed = current < neckline;
        
        // Dynamic confidence calculation
        let confidence = 0.55;
        
        // Pattern symmetry (how similar are the peaks)
        const symmetryScore = 1 - Math.max(diff1, diff2, diff3);
        confidence += symmetryScore * 0.15;
        
        // Breakdown confirmation
        if (isConfirmed) {
          const breakdownDistance = (neckline - current) / neckline;
          confidence += Math.min(breakdownDistance / 0.04, 1.0) * 0.25;
        } else {
          // Price approaching neckline
          const approachDistance = (avgPeak - current) / (avgPeak - neckline);
          confidence += Math.max(0, approachDistance - 0.5) * 0.12;
        }
        
        // Volume analysis (should increase on breakdown)
        const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
        const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        const historicalVolumes = recentCandles.slice(-25, -5).map(c => c.volume);
        const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
        
        if (avgRecentVolume > avgHistoricalVolume * 1.3) {
          confidence += 0.12;
        }
        
        confidence = Math.max(0.05, Math.min(0.95, confidence));
        
        return {
          name: "Triple Top",
          timeframe: "unknown",
          confidence,
          startIndex: first.index,
          endIndex: third.index,
          description: `Triple top at $${avgPeak.toFixed(2)} with neckline at $${neckline.toFixed(2)}${isConfirmed ? ' (confirmed breakdown)' : ''} - Bearish reversal pattern`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect Triple Bottom pattern
 * Three distinct lows at similar price levels - bullish reversal
 * Win rate: 65-70%
 */
export function detectTripleBottom(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 30) return null;

  const recentCandles = candles.slice(-60);
  
  // Find local minima
  const minima: { index: number; price: number }[] = [];
  for (let i = 3; i < recentCandles.length - 3; i++) {
    const current = recentCandles[i].low;
    const prev1 = recentCandles[i - 1].low;
    const prev2 = recentCandles[i - 2].low;
    const prev3 = recentCandles[i - 3].low;
    const next1 = recentCandles[i + 1].low;
    const next2 = recentCandles[i + 2].low;
    const next3 = recentCandles[i + 3].low;
    
    if (current < prev1 && current < prev2 && current < prev3 &&
        current < next1 && current < next2 && current < next3) {
      minima.push({ index: i, price: current });
    }
  }

  // Need at least 3 minima for triple bottom
  if (minima.length < 3) return null;

  const tolerance = 0.02;
  
  for (let i = 0; i < minima.length - 2; i++) {
    for (let j = i + 1; j < minima.length - 1; j++) {
      for (let k = j + 1; k < minima.length; k++) {
        const first = minima[i];
        const second = minima[j];
        const third = minima[k];
        
        // Check if all three bottoms are at similar levels
        const avgBottom = (first.price + second.price + third.price) / 3;
        const diff1 = Math.abs(first.price - avgBottom) / avgBottom;
        const diff2 = Math.abs(second.price - avgBottom) / avgBottom;
        const diff3 = Math.abs(third.price - avgBottom) / avgBottom;
        
        if (diff1 > tolerance || diff2 > tolerance || diff3 > tolerance) continue;
        
        // Find peaks between bottoms
        const peak1 = Math.max(...recentCandles.slice(first.index, second.index + 1).map(c => c.high));
        const peak2 = Math.max(...recentCandles.slice(second.index, third.index + 1).map(c => c.high));
        const neckline = Math.max(peak1, peak2);
        
        // Bottoms should be significantly below neckline
        if (avgBottom > neckline * 0.97) continue;
        
        const current = currentPrice || recentCandles[recentCandles.length - 1].close;
        const isConfirmed = current > neckline;
        
        // Dynamic confidence calculation
        let confidence = 0.55;
        
        // Pattern symmetry
        const symmetryScore = 1 - Math.max(diff1, diff2, diff3);
        confidence += symmetryScore * 0.15;
        
        // Breakout confirmation
        if (isConfirmed) {
          const breakoutDistance = (current - neckline) / neckline;
          confidence += Math.min(breakoutDistance / 0.04, 1.0) * 0.25;
        } else {
          const approachDistance = (current - avgBottom) / (neckline - avgBottom);
          confidence += Math.max(0, approachDistance - 0.5) * 0.12;
        }
        
        // Volume analysis
        const recentVolumes = recentCandles.slice(-5).map(c => c.volume);
        const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        const historicalVolumes = recentCandles.slice(-25, -5).map(c => c.volume);
        const avgHistoricalVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
        
        if (avgRecentVolume > avgHistoricalVolume * 1.3) {
          confidence += 0.12;
        }
        
        confidence = Math.max(0.05, Math.min(0.95, confidence));
        
        return {
          name: "Triple Bottom",
          timeframe: "unknown",
          confidence,
          startIndex: first.index,
          endIndex: third.index,
          description: `Triple bottom at $${avgBottom.toFixed(2)} with neckline at $${neckline.toFixed(2)}${isConfirmed ? ' (confirmed breakout)' : ''} - Bullish reversal pattern`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect Rising Wedge pattern
 * Converging trendlines with higher highs and higher lows - bearish reversal
 * Win rate: 60-68%
 */
export function detectRisingWedge(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 25) return null;

  const recentCandles = candles.slice(-40);
  
  // Find highs and lows for trendlines
  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];
  
  for (let i = 2; i < recentCandles.length - 2; i++) {
    // Local high
    if (recentCandles[i].high > recentCandles[i - 1].high && 
        recentCandles[i].high > recentCandles[i - 2].high &&
        recentCandles[i].high > recentCandles[i + 1].high &&
        recentCandles[i].high > recentCandles[i + 2].high) {
      highs.push({ index: i, price: recentCandles[i].high });
    }
    // Local low
    if (recentCandles[i].low < recentCandles[i - 1].low && 
        recentCandles[i].low < recentCandles[i - 2].low &&
        recentCandles[i].low < recentCandles[i + 1].low &&
        recentCandles[i].low < recentCandles[i + 2].low) {
      lows.push({ index: i, price: recentCandles[i].low });
    }
  }

  if (highs.length < 2 || lows.length < 2) return null;

  // Calculate trendline slopes
  const highSlope = (highs[highs.length - 1].price - highs[0].price) / (highs[highs.length - 1].index - highs[0].index);
  const lowSlope = (lows[lows.length - 1].price - lows[0].price) / (lows[lows.length - 1].index - lows[0].index);
  
  // Both trendlines should be rising (positive slope)
  if (highSlope <= 0 || lowSlope <= 0) return null;
  
  // Trendlines should be converging (low slope > high slope in relative terms)
  const avgPrice = (highs[0].price + lows[0].price) / 2;
  const normalizedHighSlope = highSlope / avgPrice;
  const normalizedLowSlope = lowSlope / avgPrice;
  
  // Low trendline should be rising faster than high trendline (converging)
  if (normalizedLowSlope <= normalizedHighSlope * 0.8) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const supportLevel = lows[lows.length - 1].price;
  const isConfirmed = current < supportLevel;
  
  // Dynamic confidence
  let confidence = 0.50;
  
  // Convergence quality
  const convergenceRatio = normalizedLowSlope / normalizedHighSlope;
  if (convergenceRatio > 1.2 && convergenceRatio < 2.0) {
    confidence += 0.15;
  }
  
  // Number of touches on trendlines
  confidence += Math.min(highs.length + lows.length, 8) * 0.03;
  
  // Breakdown confirmation
  if (isConfirmed) {
    const breakdownDistance = (supportLevel - current) / supportLevel;
    confidence += Math.min(breakdownDistance / 0.03, 1.0) * 0.20;
  }
  
  // Volume (should decrease during wedge)
  const earlyVolume = recentCandles.slice(0, 15).reduce((sum, c) => sum + c.volume, 0) / 15;
  const lateVolume = recentCandles.slice(-10).reduce((sum, c) => sum + c.volume, 0) / 10;
  if (lateVolume < earlyVolume * 0.8) {
    confidence += 0.10;
  }
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));
  
  return {
    name: "Rising Wedge",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Rising wedge with converging trendlines${isConfirmed ? ' (breakdown confirmed)' : ''} - Bearish reversal pattern`,
  };
}

/**
 * Detect Falling Wedge pattern
 * Converging trendlines with lower highs and lower lows - bullish reversal
 * Win rate: 62-70%
 */
export function detectFallingWedge(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 25) return null;

  const recentCandles = candles.slice(-40);
  
  // Find highs and lows for trendlines
  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];
  
  for (let i = 2; i < recentCandles.length - 2; i++) {
    // Local high
    if (recentCandles[i].high > recentCandles[i - 1].high && 
        recentCandles[i].high > recentCandles[i - 2].high &&
        recentCandles[i].high > recentCandles[i + 1].high &&
        recentCandles[i].high > recentCandles[i + 2].high) {
      highs.push({ index: i, price: recentCandles[i].high });
    }
    // Local low
    if (recentCandles[i].low < recentCandles[i - 1].low && 
        recentCandles[i].low < recentCandles[i - 2].low &&
        recentCandles[i].low < recentCandles[i + 1].low &&
        recentCandles[i].low < recentCandles[i + 2].low) {
      lows.push({ index: i, price: recentCandles[i].low });
    }
  }

  if (highs.length < 2 || lows.length < 2) return null;

  // Calculate trendline slopes
  const highSlope = (highs[highs.length - 1].price - highs[0].price) / (highs[highs.length - 1].index - highs[0].index);
  const lowSlope = (lows[lows.length - 1].price - lows[0].price) / (lows[lows.length - 1].index - lows[0].index);
  
  // Both trendlines should be falling (negative slope)
  if (highSlope >= 0 || lowSlope >= 0) return null;
  
  // Trendlines should be converging (high slope less negative than low slope)
  const avgPrice = (highs[0].price + lows[0].price) / 2;
  const normalizedHighSlope = Math.abs(highSlope) / avgPrice;
  const normalizedLowSlope = Math.abs(lowSlope) / avgPrice;
  
  // High trendline should be falling slower than low trendline (converging)
  if (normalizedHighSlope >= normalizedLowSlope * 0.8) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const resistanceLevel = highs[highs.length - 1].price;
  const isConfirmed = current > resistanceLevel;
  
  // Dynamic confidence
  let confidence = 0.52;
  
  // Convergence quality
  const convergenceRatio = normalizedLowSlope / normalizedHighSlope;
  if (convergenceRatio > 1.2 && convergenceRatio < 2.0) {
    confidence += 0.15;
  }
  
  // Number of touches on trendlines
  confidence += Math.min(highs.length + lows.length, 8) * 0.03;
  
  // Breakout confirmation
  if (isConfirmed) {
    const breakoutDistance = (current - resistanceLevel) / resistanceLevel;
    confidence += Math.min(breakoutDistance / 0.03, 1.0) * 0.22;
  }
  
  // Volume (should decrease during wedge, increase on breakout)
  const earlyVolume = recentCandles.slice(0, 15).reduce((sum, c) => sum + c.volume, 0) / 15;
  const lateVolume = recentCandles.slice(-10).reduce((sum, c) => sum + c.volume, 0) / 10;
  const breakoutVolume = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  
  if (lateVolume < earlyVolume * 0.8 && breakoutVolume > lateVolume * 1.3) {
    confidence += 0.12;
  }
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));
  
  return {
    name: "Falling Wedge",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Falling wedge with converging trendlines${isConfirmed ? ' (breakout confirmed)' : ''} - Bullish reversal pattern`,
  };
}

/**
 * Detect Bullish Pennant pattern
 * Small symmetrical triangle after a strong upward move - bullish continuation
 * Win rate: 65-72%
 */
export function detectBullishPennant(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 20) return null;

  const recentCandles = candles.slice(-35);
  
  // Identify flagpole: strong upward move (first 10-15 candles)
  const poleStart = recentCandles[0].close;
  const poleEnd = Math.max(...recentCandles.slice(0, 12).map(c => c.high));
  const poleGain = (poleEnd - poleStart) / poleStart;
  
  // Flagpole should be strong (>6% gain)
  if (poleGain < 0.06) return null;
  
  // Identify pennant: symmetrical triangle consolidation
  const pennantCandles = recentCandles.slice(12, 30);
  if (pennantCandles.length < 8) return null;
  
  // Find highs and lows in pennant
  const pennantHighs = pennantCandles.map((c, i) => ({ index: i, price: c.high }));
  const pennantLows = pennantCandles.map((c, i) => ({ index: i, price: c.low }));
  
  // Calculate trendlines
  const highStart = pennantHighs[0].price;
  const highEnd = pennantHighs[pennantHighs.length - 1].price;
  const lowStart = pennantLows[0].price;
  const lowEnd = pennantLows[pennantLows.length - 1].price;
  
  // Upper trendline should be falling
  if (highEnd >= highStart) return null;
  
  // Lower trendline should be rising
  if (lowEnd <= lowStart) return null;
  
  // Pennant should be narrow (converging)
  const startRange = highStart - lowStart;
  const endRange = highEnd - lowEnd;
  if (endRange >= startRange * 0.7) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const breakoutLevel = Math.max(...pennantCandles.map(c => c.high));
  const isConfirmed = current > breakoutLevel;
  
  // Dynamic confidence
  let confidence = 0.55;
  
  // Flagpole strength
  confidence += Math.min(poleGain / 0.12, 1.0) * 0.12;
  
  // Pennant symmetry (convergence quality)
  const convergenceRatio = endRange / startRange;
  if (convergenceRatio < 0.5) {
    confidence += 0.12;
  }
  
  // Breakout confirmation
  if (isConfirmed) {
    const breakoutDistance = (current - breakoutLevel) / breakoutLevel;
    confidence += Math.min(breakoutDistance / 0.025, 1.0) * 0.22;
  }
  
  // Volume pattern (decrease in pennant, increase on breakout)
  const poleVolume = recentCandles.slice(0, 12).reduce((sum, c) => sum + c.volume, 0) / 12;
  const pennantVolume = pennantCandles.reduce((sum, c) => sum + c.volume, 0) / pennantCandles.length;
  const breakoutVol = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  
  if (pennantVolume < poleVolume * 0.6 && breakoutVol > pennantVolume * 1.4) {
    confidence += 0.15;
  }
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));
  
  return {
    name: "Bullish Pennant",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Bullish pennant with ${(poleGain * 100).toFixed(1)}% flagpole${isConfirmed ? ' (breakout confirmed)' : ''} - Continuation pattern`,
  };
}

/**
 * Detect Bearish Pennant pattern
 * Small symmetrical triangle after a strong downward move - bearish continuation
 * Win rate: 64-71%
 */
export function detectBearishPennant(candles: MarketData[], currentPrice?: number): DetectedPattern | null {
  if (candles.length < 20) return null;

  const recentCandles = candles.slice(-35);
  
  // Identify flagpole: strong downward move (first 10-15 candles)
  const poleStart = recentCandles[0].close;
  const poleEnd = Math.min(...recentCandles.slice(0, 12).map(c => c.low));
  const poleDrop = (poleStart - poleEnd) / poleStart;
  
  // Flagpole should be strong (>6% drop)
  if (poleDrop < 0.06) return null;
  
  // Identify pennant: symmetrical triangle consolidation
  const pennantCandles = recentCandles.slice(12, 30);
  if (pennantCandles.length < 8) return null;
  
  // Find highs and lows in pennant
  const pennantHighs = pennantCandles.map((c, i) => ({ index: i, price: c.high }));
  const pennantLows = pennantCandles.map((c, i) => ({ index: i, price: c.low }));
  
  // Calculate trendlines
  const highStart = pennantHighs[0].price;
  const highEnd = pennantHighs[pennantHighs.length - 1].price;
  const lowStart = pennantLows[0].price;
  const lowEnd = pennantLows[pennantLows.length - 1].price;
  
  // Upper trendline should be falling
  if (highEnd >= highStart) return null;
  
  // Lower trendline should be rising
  if (lowEnd <= lowStart) return null;
  
  // Pennant should be narrow (converging)
  const startRange = highStart - lowStart;
  const endRange = highEnd - lowEnd;
  if (endRange >= startRange * 0.7) return null;
  
  const current = currentPrice || recentCandles[recentCandles.length - 1].close;
  const breakdownLevel = Math.min(...pennantCandles.map(c => c.low));
  const isConfirmed = current < breakdownLevel;
  
  // Dynamic confidence
  let confidence = 0.54;
  
  // Flagpole strength
  confidence += Math.min(poleDrop / 0.12, 1.0) * 0.12;
  
  // Pennant symmetry (convergence quality)
  const convergenceRatio = endRange / startRange;
  if (convergenceRatio < 0.5) {
    confidence += 0.12;
  }
  
  // Breakdown confirmation
  if (isConfirmed) {
    const breakdownDistance = (breakdownLevel - current) / breakdownLevel;
    confidence += Math.min(breakdownDistance / 0.025, 1.0) * 0.22;
  }
  
  // Volume pattern (decrease in pennant, increase on breakdown)
  const poleVolume = recentCandles.slice(0, 12).reduce((sum, c) => sum + c.volume, 0) / 12;
  const pennantVolume = pennantCandles.reduce((sum, c) => sum + c.volume, 0) / pennantCandles.length;
  const breakdownVol = recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
  
  if (pennantVolume < poleVolume * 0.6 && breakdownVol > pennantVolume * 1.4) {
    confidence += 0.15;
  }
  
  confidence = Math.max(0.05, Math.min(0.95, confidence));
  
  return {
    name: "Bearish Pennant",
    timeframe: "unknown",
    confidence,
    startIndex: 0,
    endIndex: recentCandles.length - 1,
    description: `Bearish pennant with ${(poleDrop * 100).toFixed(1)}% flagpole${isConfirmed ? ' (breakdown confirmed)' : ''} - Continuation pattern`,
  };
}
