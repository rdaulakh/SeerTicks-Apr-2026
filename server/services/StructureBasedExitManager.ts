/**
 * Structure-Based Exit Manager
 * Week 7-8 Implementation based on Claude AI recommendations
 *
 * Replaces confidence decay exits with price structure invalidation:
 * - ATR-based dynamic stops (2.5x ATR for crypto volatility)
 * - Support/resistance break detection
 * - Trend structure invalidation (lower high in uptrend, higher low in downtrend)
 */

import { getTradingConfig } from '../config/TradingConfig';
import { getActiveClock } from '../_core/clock';

export interface StructureLevel {
  price: number;
  timestamp: number;
  type: 'support' | 'resistance' | 'swing_high' | 'swing_low';
  strength: number; // 1-10 based on volume, touches, time
  atrMultiple: number; // Distance from current price in ATR units
}

export interface ExitSignal {
  type: 'atr_stop' | 'support_break' | 'resistance_break' | 'trend_break' | 'max_time_exit' | 'drawdown_protection' | 'trailing_stop';
  urgency: 'immediate' | 'high' | 'medium' | 'low';
  confidence: number;
  reason?: string;
  level?: number;
  price?: number;
}

export interface Position {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  averagePrice: number;
  currentSize: number;
  notionalValue: number;
  unrealizedPnL: number;
  openTime: number;
  peakPrice?: number;
  trailingStopActive?: boolean;
  trailingStopPrice?: number;
}

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export class StructureBasedExitManager {
  private atrPeriod = 14;
  private structureLevels: Map<string, StructureLevel[]> = new Map();
  private atrCache: Map<string, { value: number; timestamp: number }> = new Map();
  private swingCache: Map<string, { highs: number[]; lows: number[]; timestamp: number }> = new Map();
  
  // Configuration — Phase 18: maxDrawdownPercent and maxHoldTime from TradingConfig
  private get config() {
    try {
      const tc = getTradingConfig();
      return {
        atrMultiplier: tc.exits.atrStopMultiplier,
        structureBreachThreshold: 0.3,
        priceProximityThreshold: 0.02,
        trailingStopDistance: tc.exits.trailingDistancePercent / 100,
        maxHoldTime: tc.exits.maxWinnerTimeMinutes * 60 * 1000,
        maxDrawdownPercent: tc.exits.positionMaxDrawdownPercent,
        swingLookback: 20,
      };
    } catch {
      return {
        atrMultiplier: 2.5,
        structureBreachThreshold: 0.3,
        priceProximityThreshold: 0.02,
        trailingStopDistance: 0.008,
        maxHoldTime: 4 * 60 * 60 * 1000,
        maxDrawdownPercent: 0.03,
        swingLookback: 20,
      };
    }
  }

  /**
   * Calculate all exit conditions for a position
   */
  async calculateExitConditions(
    position: Position,
    currentPrice: number,
    candles: OHLCV[]
  ): Promise<ExitSignal[]> {
    const signals: ExitSignal[] = [];
    const atr = this.calculateATR(candles);
    
    // Update structure levels
    this.updateStructureLevels(position.symbol, candles, currentPrice);
    
    // 1. Dynamic ATR Stop (Primary Safety)
    const atrStopSignal = this.checkATRStop(position, currentPrice, atr);
    if (atrStopSignal) {
      signals.push(atrStopSignal);
    }

    // 2. Structure Break Detection
    const structureBreak = this.detectStructureBreak(position, currentPrice, atr);
    if (structureBreak) {
      signals.push(structureBreak);
    }

    // 3. Trend Structure Invalidation
    const trendBreak = this.detectTrendBreak(position, candles, currentPrice);
    if (trendBreak) {
      signals.push(trendBreak);
    }

    // 4. Trailing Stop Check (if active)
    const trailingStopSignal = this.checkTrailingStop(position, currentPrice);
    if (trailingStopSignal) {
      signals.push(trailingStopSignal);
    }

    // 5. Safety Overrides
    const safetySignals = this.checkSafetyConditions(position, currentPrice);
    signals.push(...safetySignals);

    return signals;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(candles: OHLCV[]): number {
    if (candles.length < this.atrPeriod + 1) {
      // Fallback: use simple range average
      const ranges = candles.slice(-10).map(c => c.high - c.low);
      return ranges.reduce((a, b) => a + b, 0) / ranges.length;
    }

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      trueRanges.push(tr);
    }

    // Calculate ATR as SMA of true ranges
    const recentTRs = trueRanges.slice(-this.atrPeriod);
    return recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
  }

  /**
   * Check ATR-based stop loss
   */
  private checkATRStop(position: Position, currentPrice: number, atr: number): ExitSignal | null {
    const stopDistance = atr * this.config.atrMultiplier;
    
    if (position.direction === 'long') {
      const stopPrice = position.averagePrice - stopDistance;
      if (currentPrice <= stopPrice) {
        return {
          type: 'atr_stop',
          urgency: 'immediate',
          confidence: 0.95,
          reason: `Price ${currentPrice.toFixed(2)} breached ATR stop at ${stopPrice.toFixed(2)}`,
          level: stopPrice
        };
      }
    } else {
      const stopPrice = position.averagePrice + stopDistance;
      if (currentPrice >= stopPrice) {
        return {
          type: 'atr_stop',
          urgency: 'immediate',
          confidence: 0.95,
          reason: `Price ${currentPrice.toFixed(2)} breached ATR stop at ${stopPrice.toFixed(2)}`,
          level: stopPrice
        };
      }
    }
    
    return null;
  }

  /**
   * Update structure levels based on recent price action
   */
  private updateStructureLevels(symbol: string, candles: OHLCV[], currentPrice: number): void {
    const levels: StructureLevel[] = [];
    const lookback = Math.min(this.config.swingLookback, candles.length - 2);
    
    // Detect swing highs and lows
    for (let i = 2; i < lookback; i++) {
      const prev = candles[candles.length - i - 1];
      const curr = candles[candles.length - i];
      const next = candles[candles.length - i + 1];
      
      // Swing high
      if (curr.high > prev.high && curr.high > next.high) {
        levels.push({
          price: curr.high,
          timestamp: curr.timestamp,
          type: 'swing_high',
          strength: this.calculateLevelStrength(curr, candles),
          atrMultiple: Math.abs(curr.high - currentPrice) / this.calculateATR(candles)
        });
      }
      
      // Swing low
      if (curr.low < prev.low && curr.low < next.low) {
        levels.push({
          price: curr.low,
          timestamp: curr.timestamp,
          type: 'swing_low',
          strength: this.calculateLevelStrength(curr, candles),
          atrMultiple: Math.abs(curr.low - currentPrice) / this.calculateATR(candles)
        });
      }
    }
    
    // Convert swing points to support/resistance
    const avgPrice = candles.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
    levels.forEach(level => {
      if (level.type === 'swing_low' && level.price < avgPrice) {
        level.type = 'support';
      } else if (level.type === 'swing_high' && level.price > avgPrice) {
        level.type = 'resistance';
      }
    });
    
    this.structureLevels.set(symbol, levels);
  }

  /**
   * Calculate strength of a price level
   */
  private calculateLevelStrength(candle: OHLCV, allCandles: OHLCV[]): number {
    let strength = 5; // Base strength
    
    // Volume factor
    const avgVolume = allCandles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    if (candle.volume > avgVolume * 1.5) strength += 2;
    if (candle.volume > avgVolume * 2) strength += 1;
    
    // Candle size factor
    const candleRange = candle.high - candle.low;
    const avgRange = allCandles.slice(-20).reduce((sum, c) => sum + (c.high - c.low), 0) / 20;
    if (candleRange > avgRange * 1.5) strength += 1;
    
    // Recency factor (more recent = stronger)
    const recencyIndex = allCandles.indexOf(candle);
    if (recencyIndex > allCandles.length - 5) strength += 1;
    
    return Math.min(10, strength);
  }

  /**
   * Detect support/resistance break
   */
  private detectStructureBreak(position: Position, currentPrice: number, atr: number): ExitSignal | null {
    const levels = this.structureLevels.get(position.symbol) || [];
    const breachThreshold = atr * this.config.structureBreachThreshold;
    
    // Find relevant levels near current price
    const relevantLevels = levels.filter(level => {
      const priceDistance = Math.abs(level.price - currentPrice) / currentPrice;
      return priceDistance < this.config.priceProximityThreshold;
    });

    for (const level of relevantLevels) {
      if (position.direction === 'long' && (level.type === 'support' || level.type === 'swing_low')) {
        if (currentPrice < level.price - breachThreshold) {
          return {
            type: 'support_break',
            urgency: 'immediate',
            confidence: level.strength / 10,
            reason: `Support break at ${level.price.toFixed(2)} (strength: ${level.strength}/10)`,
            level: level.price
          };
        }
      } else if (position.direction === 'short' && (level.type === 'resistance' || level.type === 'swing_high')) {
        if (currentPrice > level.price + breachThreshold) {
          return {
            type: 'resistance_break',
            urgency: 'immediate',
            confidence: level.strength / 10,
            reason: `Resistance break at ${level.price.toFixed(2)} (strength: ${level.strength}/10)`,
            level: level.price
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Detect trend structure invalidation
   * Long: Lower high invalidates uptrend
   * Short: Higher low invalidates downtrend
   */
  private detectTrendBreak(position: Position, candles: OHLCV[], currentPrice: number): ExitSignal | null {
    if (candles.length < 10) return null;
    
    const recentCandles = candles.slice(-10);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    
    // Find recent swing points
    const recentHigh = Math.max(...highs.slice(-5));
    const previousHigh = Math.max(...highs.slice(0, 5));
    const recentLow = Math.min(...lows.slice(-5));
    const previousLow = Math.min(...lows.slice(0, 5));
    
    if (position.direction === 'long') {
      // Check for lower high (uptrend invalidation)
      if (recentHigh < previousHigh * 0.995) { // 0.5% tolerance
        // Also check if price is below recent low
        if (currentPrice < recentLow) {
          return {
            type: 'trend_break',
            urgency: 'high',
            confidence: 0.75,
            reason: `Uptrend invalidated: Lower high (${recentHigh.toFixed(2)} < ${previousHigh.toFixed(2)}) and price below recent low`,
            level: recentLow
          };
        }
      }
    } else {
      // Check for higher low (downtrend invalidation)
      if (recentLow > previousLow * 1.005) { // 0.5% tolerance
        // Also check if price is above recent high
        if (currentPrice > recentHigh) {
          return {
            type: 'trend_break',
            urgency: 'high',
            confidence: 0.75,
            reason: `Downtrend invalidated: Higher low (${recentLow.toFixed(2)} > ${previousLow.toFixed(2)}) and price above recent high`,
            level: recentHigh
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Check trailing stop
   */
  private checkTrailingStop(position: Position, currentPrice: number): ExitSignal | null {
    if (!position.trailingStopActive || !position.trailingStopPrice) {
      return null;
    }
    
    if (position.direction === 'long') {
      if (currentPrice <= position.trailingStopPrice) {
        return {
          type: 'trailing_stop',
          urgency: 'immediate',
          confidence: 0.9,
          reason: `Trailing stop triggered at ${position.trailingStopPrice.toFixed(2)}`,
          level: position.trailingStopPrice
        };
      }
    } else {
      if (currentPrice >= position.trailingStopPrice) {
        return {
          type: 'trailing_stop',
          urgency: 'immediate',
          confidence: 0.9,
          reason: `Trailing stop triggered at ${position.trailingStopPrice.toFixed(2)}`,
          level: position.trailingStopPrice
        };
      }
    }
    
    return null;
  }

  /**
   * Update trailing stop price based on current price
   */
  updateTrailingStop(position: Position, currentPrice: number): number | null {
    if (!position.trailingStopActive) return null;
    
    const trailingDistance = currentPrice * this.config.trailingStopDistance;
    
    if (position.direction === 'long') {
      const newStopPrice = currentPrice - trailingDistance;
      // Only update if new stop is higher than current
      if (!position.trailingStopPrice || newStopPrice > position.trailingStopPrice) {
        return newStopPrice;
      }
    } else {
      const newStopPrice = currentPrice + trailingDistance;
      // Only update if new stop is lower than current
      if (!position.trailingStopPrice || newStopPrice < position.trailingStopPrice) {
        return newStopPrice;
      }
    }
    
    return position.trailingStopPrice;
  }

  /**
   * Check safety conditions (time-based exit, drawdown protection)
   */
  private checkSafetyConditions(position: Position, currentPrice: number): ExitSignal[] {
    const signals: ExitSignal[] = [];
    
    // Time-based exit
    const holdTime = getActiveClock().now() - position.openTime;
    if (holdTime > this.config.maxHoldTime) {
      signals.push({
        type: 'max_time_exit',
        urgency: 'immediate',
        confidence: 1.0,
        reason: `Max hold time reached (${(holdTime / 3600000).toFixed(1)} hours)`
      });
    }
    
    // Drawdown protection
    const currentDrawdown = Math.abs(position.unrealizedPnL) / position.notionalValue;
    if (position.unrealizedPnL < 0 && currentDrawdown > this.config.maxDrawdownPercent) {
      signals.push({
        type: 'drawdown_protection',
        urgency: 'immediate',
        confidence: 0.9,
        reason: `Drawdown ${(currentDrawdown * 100).toFixed(2)}% exceeds ${(this.config.maxDrawdownPercent * 100).toFixed(1)}% limit`
      });
    }
    
    return signals;
  }

  /**
   * Get the most urgent exit signal from a list
   */
  getMostUrgentSignal(signals: ExitSignal[]): ExitSignal | null {
    if (signals.length === 0) return null;
    
    const urgencyOrder = { immediate: 0, high: 1, medium: 2, low: 3 };
    return signals.sort((a, b) => {
      const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return b.confidence - a.confidence;
    })[0];
  }

  /**
   * Check if any exit signal requires immediate action
   */
  requiresImmediateExit(signals: ExitSignal[]): boolean {
    return signals.some(s => s.urgency === 'immediate' && s.confidence >= 0.7);
  }
}
