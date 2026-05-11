import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import type { MomentumSignal, VolumeSignal } from './HighFrequencyTickProcessor';

/**
 * Scalping Strategy Engine
 * 
 * Combines momentum and volume signals to generate trade recommendations
 * Operates in milliseconds with strict risk management
 */

export interface ScalpingSignal {
  symbol: string;
  action: 'BUY' | 'SELL';
  confidence: number; // 0-1
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
  signalSources: string[]; // ['momentum', 'volume', etc.]
  latency: number; // ms from data to signal
}

export interface ScalpingConfig {
  minConfidence: number; // Minimum confidence to trade (0-1)
  stopLossPercent: number; // Stop loss as % of entry
  takeProfitPercent: number; // Take profit as % of entry
  maxPositionSize: number; // Max position size in USD
  requireMultiSignal: boolean; // Require both momentum + volume
}

const DEFAULT_CONFIG: ScalpingConfig = {
  minConfidence: 0.6,
  stopLossPercent: 0.5, // 0.5% stop loss
  takeProfitPercent: 1.0, // 1.0% take profit (2:1 reward/risk)
  maxPositionSize: 1000,
  requireMultiSignal: true,
};

/**
 * Scalping Strategy Engine
 * Generates trade signals from high-frequency tick data
 */
export class ScalpingStrategyEngine extends EventEmitter {
  private config: ScalpingConfig;
  
  // Signal tracking
  private recentMomentumSignals: Map<string, MomentumSignal> = new Map();
  private recentVolumeSignals: Map<string, VolumeSignal> = new Map();
  
  // Performance tracking
  private signalsGenerated: number = 0;
  private signalLatency: number[] = [];

  constructor(config: Partial<ScalpingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[ScalpingStrategyEngine] Initialized with config:', this.config);
  }

  /**
   * Process momentum signal
   */
  processMomentumSignal(signal: MomentumSignal, currentPrice: number): void {
    const startTime = getActiveClock().now();
    
    // Store recent momentum signal
    this.recentMomentumSignals.set(signal.symbol, signal);

    // Check if we have a volume signal too
    const volumeSignal = this.recentVolumeSignals.get(signal.symbol);

    if (this.config.requireMultiSignal && !volumeSignal) {
      // Wait for volume confirmation
      return;
    }

    // Generate scalping signal
    this.generateScalpingSignal(signal.symbol, signal.direction, currentPrice, ['momentum'], signal.strength, startTime);

    // Clean up old signals (> 1 second old)
    this.cleanOldSignals();
  }

  /**
   * Process volume signal
   */
  processVolumeSignal(signal: VolumeSignal, currentPrice: number): void {
    const startTime = getActiveClock().now();
    
    // Store recent volume signal
    this.recentVolumeSignals.set(signal.symbol, signal);

    // Check if we have a momentum signal too
    const momentumSignal = this.recentMomentumSignals.get(signal.symbol);

    if (this.config.requireMultiSignal && !momentumSignal) {
      // Wait for momentum confirmation
      return;
    }

    // Generate scalping signal
    this.generateScalpingSignal(signal.symbol, signal.direction, currentPrice, ['volume'], signal.strength, startTime);

    // Clean up old signals (> 1 second old)
    this.cleanOldSignals();
  }

  /**
   * Process combined momentum + volume signal
   */
  processCombinedSignal(symbol: string, currentPrice: number): void {
    const momentumSignal = this.recentMomentumSignals.get(symbol);
    const volumeSignal = this.recentVolumeSignals.get(symbol);

    if (!momentumSignal || !volumeSignal) return;

    // Check if signals agree on direction
    if (momentumSignal.direction !== volumeSignal.direction) return;

    const startTime = getActiveClock().now();

    // Combined confidence (average of both)
    const combinedStrength = (momentumSignal.strength + volumeSignal.strength) / 2;

    // Generate scalping signal with both sources
    this.generateScalpingSignal(
      symbol,
      momentumSignal.direction,
      currentPrice,
      ['momentum', 'volume'],
      combinedStrength,
      startTime
    );
  }

  /**
   * Generate scalping signal
   */
  private generateScalpingSignal(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    currentPrice: number,
    sources: string[],
    strength: number,
    startTime: number
  ): void {
    // Calculate confidence based on signal strength and sources
    let confidence = strength;
    
    // Boost confidence if multiple signals
    if (sources.length > 1) {
      confidence = Math.min(confidence * 1.2, 1.0);
    }

    // Check minimum confidence threshold
    if (confidence < this.config.minConfidence) {
      return;
    }

    // Calculate stop loss and take profit
    const action = direction === 'LONG' ? 'BUY' : 'SELL';
    
    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'LONG') {
      stopLoss = currentPrice * (1 - this.config.stopLossPercent / 100);
      takeProfit = currentPrice * (1 + this.config.takeProfitPercent / 100);
    } else {
      stopLoss = currentPrice * (1 + this.config.stopLossPercent / 100);
      takeProfit = currentPrice * (1 - this.config.takeProfitPercent / 100);
    }

    const latency = getActiveClock().now() - startTime;

    const scalpingSignal: ScalpingSignal = {
      symbol,
      action,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      timestamp: getActiveClock().now(),
      signalSources: sources,
      latency,
    };

    // Track performance
    this.signalsGenerated++;
    this.signalLatency.push(latency);
    if (this.signalLatency.length > 1000) {
      this.signalLatency.shift();
    }

    // Emit signal
    this.emit('scalping_signal', scalpingSignal);

    console.log(`[ScalpingStrategyEngine] 🎯 SIGNAL: ${action} ${symbol} @ $${currentPrice.toFixed(2)} (confidence: ${(confidence * 100).toFixed(1)}%, latency: ${latency}ms)`);
  }

  /**
   * Clean up old signals (> 1 second)
   */
  private cleanOldSignals(): void {
    const now = getActiveClock().now();
    const maxAge = 1000; // 1 second

    // Clean momentum signals
    for (const [symbol, signal] of this.recentMomentumSignals.entries()) {
      if (now - signal.timestamp > maxAge) {
        this.recentMomentumSignals.delete(symbol);
      }
    }

    // Clean volume signals
    for (const [symbol, signal] of this.recentVolumeSignals.entries()) {
      if (now - signal.timestamp > maxAge) {
        this.recentVolumeSignals.delete(symbol);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScalpingConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[ScalpingStrategyEngine] Config updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ScalpingConfig {
    return { ...this.config };
  }

  /**
   * Get performance stats
   */
  getStats(): {
    signalsGenerated: number;
    averageLatency: number;
    pendingMomentumSignals: number;
    pendingVolumeSignals: number;
  } {
    const avgLatency = this.signalLatency.length > 0
      ? this.signalLatency.reduce((a, b) => a + b, 0) / this.signalLatency.length
      : 0;

    return {
      signalsGenerated: this.signalsGenerated,
      averageLatency: avgLatency,
      pendingMomentumSignals: this.recentMomentumSignals.size,
      pendingVolumeSignals: this.recentVolumeSignals.size,
    };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.signalsGenerated = 0;
    this.signalLatency = [];
    this.recentMomentumSignals.clear();
    this.recentVolumeSignals.clear();
  }
}

// Singleton instance
let scalpingEngine: ScalpingStrategyEngine | null = null;

export function getScalpingStrategyEngine(): ScalpingStrategyEngine {
  if (!scalpingEngine) {
    scalpingEngine = new ScalpingStrategyEngine();
  }
  return scalpingEngine;
}
