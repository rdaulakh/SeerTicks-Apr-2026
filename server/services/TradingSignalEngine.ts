/**
 * Trading Signal Engine
 * 
 * Generates automated buy/sell signals based on technical indicators:
 * - RSI oversold/overbought
 * - MACD crossovers
 * - Stochastic crossovers
 * - Combined multi-indicator signals
 */

import { Candle } from '../WebSocketCandleCache';
import { getActiveClock } from '../_core/clock';
import { calculateRSI, calculateMACD } from '../utils/IndicatorCache';
import { calculateStochastic, detectStochasticCrossover } from '../utils/AdvancedIndicators';

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';
export type SignalSource = 'RSI' | 'MACD' | 'STOCHASTIC' | 'COMBINED';

export interface TradingSignal {
  symbol: string;
  type: SignalType;
  source: SignalSource;
  strength: number; // 0-100
  confidence: number; // 0-100
  timestamp: number;
  indicators: {
    rsi?: number;
    macd?: { macd: number; signal: number; histogram: number };
    stochastic?: { k: number; d: number };
  };
  reasoning: string;
  price: number;
}

export interface SignalConfig {
  rsi: {
    enabled: boolean;
    oversold: number; // Default: 30
    overbought: number; // Default: 70
  };
  macd: {
    enabled: boolean;
    signalThreshold: number; // Minimum histogram value for signal
  };
  stochastic: {
    enabled: boolean;
    oversold: number; // Default: 20
    overbought: number; // Default: 80
  };
  combined: {
    enabled: boolean;
    minConfirmations: number; // How many indicators must agree
  };
}

export type PartialSignalConfig = {
  rsi?: Partial<SignalConfig['rsi']>;
  macd?: Partial<SignalConfig['macd']>;
  stochastic?: Partial<SignalConfig['stochastic']>;
  combined?: Partial<SignalConfig['combined']>;
};

export class TradingSignalEngine {
  private config: SignalConfig;
  private previousStochastic: Map<string, { k: number; d: number }> = new Map();

  constructor(config?: Partial<SignalConfig>) {
    this.config = {
      rsi: {
        enabled: true,
        oversold: 30,
        overbought: 70,
        ...config?.rsi,
      },
      macd: {
        enabled: true,
        signalThreshold: 0,
        ...config?.macd,
      },
      stochastic: {
        enabled: true,
        oversold: 20,
        overbought: 80,
        ...config?.stochastic,
      },
      combined: {
        enabled: true,
        minConfirmations: 2,
        ...config?.combined,
      },
    };
  }

  /**
   * Generate all signals for a symbol
   */
  generateSignals(symbol: string, candles: Candle[]): TradingSignal[] {
    if (candles.length < 50) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const currentPrice = candles[candles.length - 1].close;

    // RSI signals
    if (this.config.rsi.enabled) {
      const rsiSignal = this.generateRSISignal(symbol, candles, currentPrice);
      if (rsiSignal) signals.push(rsiSignal);
    }

    // MACD signals
    if (this.config.macd.enabled) {
      const macdSignal = this.generateMACDSignal(symbol, candles, currentPrice);
      if (macdSignal) signals.push(macdSignal);
    }

    // Stochastic signals
    if (this.config.stochastic.enabled) {
      const stochasticSignal = this.generateStochasticSignal(symbol, candles, currentPrice);
      if (stochasticSignal) signals.push(stochasticSignal);
    }

    // Combined signal
    if (this.config.combined.enabled && signals.length >= this.config.combined.minConfirmations) {
      const combinedSignal = this.generateCombinedSignal(symbol, signals, currentPrice);
      if (combinedSignal) signals.push(combinedSignal);
    }

    return signals;
  }

  /**
   * Generate RSI-based signal
   * BUY when RSI < oversold (30)
   * SELL when RSI > overbought (70)
   */
  private generateRSISignal(symbol: string, candles: Candle[], currentPrice: number): TradingSignal | null {
    const rsi = calculateRSI(candles, 14);

    if (rsi < this.config.rsi.oversold) {
      return {
        symbol,
        type: 'BUY',
        source: 'RSI',
        strength: Math.min(100, (this.config.rsi.oversold - rsi) * 3),
        confidence: 70,
        timestamp: getActiveClock().now(),
        indicators: { rsi },
        reasoning: `RSI oversold at ${rsi.toFixed(2)} (< ${this.config.rsi.oversold})`,
        price: currentPrice,
      };
    }

    if (rsi > this.config.rsi.overbought) {
      return {
        symbol,
        type: 'SELL',
        source: 'RSI',
        strength: Math.min(100, (rsi - this.config.rsi.overbought) * 3),
        confidence: 70,
        timestamp: getActiveClock().now(),
        indicators: { rsi },
        reasoning: `RSI overbought at ${rsi.toFixed(2)} (> ${this.config.rsi.overbought})`,
        price: currentPrice,
      };
    }

    return null;
  }

  /**
   * Generate MACD-based signal
   * BUY when MACD crosses above signal line (bullish crossover)
   * SELL when MACD crosses below signal line (bearish crossover)
   */
  private generateMACDSignal(symbol: string, candles: Candle[], currentPrice: number): TradingSignal | null {
    const macd = calculateMACD(candles, 12, 26, 9);
    
    // Need at least 2 candles to detect crossover
    if (candles.length < 27) return null;

    const prevCandles = candles.slice(0, -1);
    const prevMACD = calculateMACD(prevCandles, 12, 26, 9);

    // Bullish crossover: MACD crosses above signal
    if (prevMACD.macd <= prevMACD.signal && macd.macd > macd.signal && macd.histogram > this.config.macd.signalThreshold) {
      return {
        symbol,
        type: 'BUY',
        source: 'MACD',
        strength: Math.min(100, Math.abs(macd.histogram) * 10),
        confidence: 75,
        timestamp: getActiveClock().now(),
        indicators: { macd },
        reasoning: `MACD bullish crossover (histogram: ${macd.histogram.toFixed(4)})`,
        price: currentPrice,
      };
    }

    // Bearish crossover: MACD crosses below signal
    if (prevMACD.macd >= prevMACD.signal && macd.macd < macd.signal && macd.histogram < -this.config.macd.signalThreshold) {
      return {
        symbol,
        type: 'SELL',
        source: 'MACD',
        strength: Math.min(100, Math.abs(macd.histogram) * 10),
        confidence: 75,
        timestamp: getActiveClock().now(),
        indicators: { macd },
        reasoning: `MACD bearish crossover (histogram: ${macd.histogram.toFixed(4)})`,
        price: currentPrice,
      };
    }

    return null;
  }

  /**
   * Generate Stochastic-based signal
   * BUY when %K crosses above %D in oversold zone
   * SELL when %K crosses below %D in overbought zone
   */
  private generateStochasticSignal(symbol: string, candles: Candle[], currentPrice: number): TradingSignal | null {
    const stochastic = calculateStochastic(candles, 14, 3);
    const previous = this.previousStochastic.get(symbol);

    // Store current for next iteration
    this.previousStochastic.set(symbol, { k: stochastic.k, d: stochastic.d });

    if (!previous) return null;

    const crossover = detectStochasticCrossover(
      stochastic.k,
      stochastic.d,
      previous.k,
      previous.d
    );

    // Bullish: %K crosses above %D in oversold zone
    if (crossover === 'bullish' && stochastic.k < this.config.stochastic.oversold) {
      return {
        symbol,
        type: 'BUY',
        source: 'STOCHASTIC',
        strength: Math.min(100, (this.config.stochastic.oversold - stochastic.k) * 4),
        confidence: 72,
        timestamp: getActiveClock().now(),
        indicators: { stochastic: { k: stochastic.k, d: stochastic.d } },
        reasoning: `Stochastic bullish crossover in oversold zone (%K: ${stochastic.k.toFixed(2)}, %D: ${stochastic.d.toFixed(2)})`,
        price: currentPrice,
      };
    }

    // Bearish: %K crosses below %D in overbought zone
    if (crossover === 'bearish' && stochastic.k > this.config.stochastic.overbought) {
      return {
        symbol,
        type: 'SELL',
        source: 'STOCHASTIC',
        strength: Math.min(100, (stochastic.k - this.config.stochastic.overbought) * 4),
        confidence: 72,
        timestamp: getActiveClock().now(),
        indicators: { stochastic: { k: stochastic.k, d: stochastic.d } },
        reasoning: `Stochastic bearish crossover in overbought zone (%K: ${stochastic.k.toFixed(2)}, %D: ${stochastic.d.toFixed(2)})`,
        price: currentPrice,
      };
    }

    return null;
  }

  /**
   * Generate combined signal when multiple indicators agree
   */
  private generateCombinedSignal(symbol: string, signals: TradingSignal[], currentPrice: number): TradingSignal | null {
    const buySignals = signals.filter(s => s.type === 'BUY');
    const sellSignals = signals.filter(s => s.type === 'SELL');

    if (buySignals.length >= this.config.combined.minConfirmations) {
      const avgStrength = buySignals.reduce((sum, s) => sum + s.strength, 0) / buySignals.length;
      const avgConfidence = buySignals.reduce((sum, s) => sum + s.confidence, 0) / buySignals.length;
      const sources = buySignals.map(s => s.source).join(' + ');

      return {
        symbol,
        type: 'BUY',
        source: 'COMBINED',
        strength: Math.min(100, avgStrength * 1.2), // Boost combined signal strength
        confidence: Math.min(100, avgConfidence + 10), // Higher confidence when multiple agree
        timestamp: getActiveClock().now(),
        indicators: {
          rsi: buySignals.find(s => s.source === 'RSI')?.indicators.rsi,
          macd: buySignals.find(s => s.source === 'MACD')?.indicators.macd,
          stochastic: buySignals.find(s => s.source === 'STOCHASTIC')?.indicators.stochastic,
        },
        reasoning: `Multiple indicators confirm BUY (${sources})`,
        price: currentPrice,
      };
    }

    if (sellSignals.length >= this.config.combined.minConfirmations) {
      const avgStrength = sellSignals.reduce((sum, s) => sum + s.strength, 0) / sellSignals.length;
      const avgConfidence = sellSignals.reduce((sum, s) => sum + s.confidence, 0) / sellSignals.length;
      const sources = sellSignals.map(s => s.source).join(' + ');

      return {
        symbol,
        type: 'SELL',
        source: 'COMBINED',
        strength: Math.min(100, avgStrength * 1.2),
        confidence: Math.min(100, avgConfidence + 10),
        timestamp: getActiveClock().now(),
        indicators: {
          rsi: sellSignals.find(s => s.source === 'RSI')?.indicators.rsi,
          macd: sellSignals.find(s => s.source === 'MACD')?.indicators.macd,
          stochastic: sellSignals.find(s => s.source === 'STOCHASTIC')?.indicators.stochastic,
        },
        reasoning: `Multiple indicators confirm SELL (${sources})`,
        price: currentPrice,
      };
    }

    return null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: PartialSignalConfig): void {
    if (config.rsi) {
      this.config.rsi = { ...this.config.rsi, ...config.rsi };
    }
    if (config.macd) {
      this.config.macd = { ...this.config.macd, ...config.macd };
    }
    if (config.stochastic) {
      this.config.stochastic = { ...this.config.stochastic, ...config.stochastic };
    }
    if (config.combined) {
      this.config.combined = { ...this.config.combined, ...config.combined };
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SignalConfig {
    return { ...this.config };
  }
}

// Singleton instance
let signalEngineInstance: TradingSignalEngine | null = null;

export function getTradingSignalEngine(): TradingSignalEngine {
  if (!signalEngineInstance) {
    signalEngineInstance = new TradingSignalEngine();
  }
  return signalEngineInstance;
}
