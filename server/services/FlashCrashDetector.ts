/**
 * Flash Crash Detector Service
 * 
 * Ultra-fast detection of flash crashes with 10ms detection window.
 * Implements multi-level circuit breaker cascade and emergency deleveraging.
 * 
 * Key Features:
 * - 10ms price movement detection
 * - Rapid volatility spike detection
 * - Automatic position reduction (emergency deleveraging)
 * - Price sanity checks (reject anomalous prices)
 * - Multi-level circuit breaker cascade
 * - Flash crash recovery protocols
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface FlashCrashConfig {
  // Detection thresholds
  detectionWindowMs: number;           // Detection window (default: 10ms)
  priceDropThreshold: number;          // % drop to trigger alert (default: 5%)
  priceSpikeThreshold: number;         // % spike to trigger alert (default: 5%)
  volatilityMultiplier: number;        // Std dev multiplier for volatility spike (default: 5)
  
  // Price sanity checks
  maxPriceDeviationPercent: number;    // Max deviation from VWAP (default: 10%)
  minPriceValidityMs: number;          // Min time for price to be valid (default: 100ms)
  anomalyRejectionEnabled: boolean;    // Enable anomalous price rejection
  
  // Circuit breaker cascade levels
  level1ThresholdPercent: number;      // Level 1: Warning (default: 3%)
  level2ThresholdPercent: number;      // Level 2: Reduce positions (default: 5%)
  level3ThresholdPercent: number;      // Level 3: Emergency close (default: 10%)
  
  // Emergency deleveraging
  emergencyReducePercent: number;      // % to reduce on Level 2 (default: 50%)
  emergencyCloseEnabled: boolean;      // Enable emergency close on Level 3
  
  // Recovery settings
  recoveryDelayMs: number;             // Delay before recovery (default: 5000ms)
  recoveryConfirmationCount: number;   // Price confirmations needed (default: 10)
  
  // Monitoring
  priceHistorySize: number;            // Number of prices to keep (default: 1000)
  vwapWindowMs: number;                // VWAP calculation window (default: 60000ms)
}

export interface PricePoint {
  price: number;
  volume: number;
  timestamp: number;
  source: string;
}

export interface FlashCrashEvent {
  id: string;
  symbol: string;
  type: 'flash_drop' | 'flash_spike' | 'volatility_spike' | 'anomaly_detected';
  severity: 'warning' | 'critical' | 'emergency';
  level: 1 | 2 | 3;
  priceChange: number;
  priceChangePercent: number;
  detectionLatencyMs: number;
  startPrice: number;
  endPrice: number;
  startTime: number;
  endTime: number;
  vwap: number;
  deviationFromVwap: number;
  actionTaken: string;
  recoveryStatus: 'pending' | 'recovering' | 'recovered' | 'failed';
}

export interface SymbolFlashState {
  symbol: string;
  priceHistory: PricePoint[];
  vwap: number;
  vwapVolume: number;
  lastPrice: number;
  lastPriceTime: number;
  volatility: number;
  baselineVolatility: number;
  isInFlashCrash: boolean;
  flashCrashStartTime: number | null;
  currentLevel: 0 | 1 | 2 | 3;
  recoveryStartTime: number | null;
  recoveryConfirmations: number;
  rejectedPrices: number;
  validPrices: number;
}

export interface FlashCrashStatus {
  isActive: boolean;
  activeSymbols: string[];
  totalDetections: number;
  level1Triggers: number;
  level2Triggers: number;
  level3Triggers: number;
  rejectedAnomalies: number;
  avgDetectionLatencyMs: number;
  lastEvent: FlashCrashEvent | null;
}

// ============================================================================
// Flash Crash Detector
// ============================================================================

export class FlashCrashDetector extends EventEmitter {
  private config: FlashCrashConfig;
  private symbolStates: Map<string, SymbolFlashState> = new Map();
  private events: FlashCrashEvent[] = [];
  private isActive: boolean = false;
  private detectionLatencies: number[] = [];
  private eventCounter: number = 0;
  
  // Statistics
  private stats = {
    totalDetections: 0,
    level1Triggers: 0,
    level2Triggers: 0,
    level3Triggers: 0,
    rejectedAnomalies: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
  };

  constructor(config?: Partial<FlashCrashConfig>) {
    super();
    this.config = {
      // Detection thresholds
      detectionWindowMs: 10,
      priceDropThreshold: 5,
      priceSpikeThreshold: 5,
      volatilityMultiplier: 5,
      
      // Price sanity checks
      maxPriceDeviationPercent: 10,
      minPriceValidityMs: 100,
      anomalyRejectionEnabled: true,
      
      // Circuit breaker cascade levels
      level1ThresholdPercent: 3,
      level2ThresholdPercent: 5,
      level3ThresholdPercent: 10,
      
      // Emergency deleveraging
      emergencyReducePercent: 50,
      emergencyCloseEnabled: true,
      
      // Recovery settings
      recoveryDelayMs: 5000,
      recoveryConfirmationCount: 10,
      
      // Monitoring
      priceHistorySize: 1000,
      vwapWindowMs: 60000,
      
      ...config,
    };
    
    console.log('[FlashCrashDetector] Initialized with 10ms detection window');
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  start(): void {
    if (this.isActive) return;
    this.isActive = true;
    console.log('[FlashCrashDetector] Started - monitoring for flash crashes');
    this.emit('detector_started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;
    console.log('[FlashCrashDetector] Stopped');
    this.emit('detector_stopped', { timestamp: Date.now() });
  }

  // ============================================================================
  // Price Processing (Hot Path - Optimized for 10ms)
  // ============================================================================

  /**
   * Process incoming price tick - ULTRA FAST PATH
   * Must complete in <1ms for 10ms detection window
   */
  processPriceTick(symbol: string, price: number, volume: number = 1, source: string = 'unknown'): {
    accepted: boolean;
    flashCrashDetected: boolean;
    event?: FlashCrashEvent;
    reason?: string;
  } {
    const startTime = performance.now();
    
    if (!this.isActive) {
      return { accepted: false, flashCrashDetected: false, reason: 'Detector not active' };
    }

    // Get or create symbol state
    let state = this.symbolStates.get(symbol);
    if (!state) {
      state = this.initializeSymbolState(symbol, price);
      this.symbolStates.set(symbol, state);
    }

    const now = Date.now();
    const pricePoint: PricePoint = { price, volume, timestamp: now, source };

    // Step 1: Price Sanity Check (fast rejection)
    if (this.config.anomalyRejectionEnabled) {
      const sanityResult = this.checkPriceSanity(state, price);
      if (!sanityResult.valid) {
        state.rejectedPrices++;
        this.stats.rejectedAnomalies++;
        this.emit('price_rejected', { symbol, price, reason: sanityResult.reason });
        return { 
          accepted: false, 
          flashCrashDetected: false, 
          reason: sanityResult.reason 
        };
      }
    }

    // Step 2: Update price history and VWAP
    this.updatePriceHistory(state, pricePoint);
    this.updateVWAP(state, pricePoint);

    // Step 3: Flash Crash Detection (10ms window)
    const flashResult = this.detectFlashCrash(state, pricePoint);
    
    // Step 4: Record detection latency
    const latencyMs = performance.now() - startTime;
    this.recordDetectionLatency(latencyMs);

    // Step 5: Handle flash crash if detected
    if (flashResult.detected && flashResult.type && flashResult.level && 
        flashResult.priceChange !== undefined && flashResult.priceChangePercent !== undefined && 
        flashResult.referencePrice !== undefined) {
      const event = this.createFlashCrashEvent(symbol, state, {
        type: flashResult.type,
        level: flashResult.level,
        priceChange: flashResult.priceChange,
        priceChangePercent: flashResult.priceChangePercent,
        referencePrice: flashResult.referencePrice,
      }, latencyMs);
      this.handleFlashCrash(symbol, state, event);
      return { accepted: true, flashCrashDetected: true, event };
    }

    // Step 6: Check recovery if in flash crash state
    if (state.isInFlashCrash) {
      this.checkRecovery(symbol, state);
    }

    state.validPrices++;
    return { accepted: true, flashCrashDetected: false };
  }

  // ============================================================================
  // Flash Crash Detection Logic
  // ============================================================================

  private detectFlashCrash(state: SymbolFlashState, currentPrice: PricePoint): {
    detected: boolean;
    type?: 'flash_drop' | 'flash_spike' | 'volatility_spike';
    level?: 1 | 2 | 3;
    priceChange?: number;
    priceChangePercent?: number;
    referencePrice?: number;
  } {
    const now = currentPrice.timestamp;
    const windowStart = now - this.config.detectionWindowMs;
    
    // Find prices within detection window
    const recentPrices = state.priceHistory.filter(p => p.timestamp >= windowStart);
    
    if (recentPrices.length < 2) {
      return { detected: false };
    }

    // Get reference price (oldest in window)
    const referencePrice = recentPrices[0].price;
    const priceChange = currentPrice.price - referencePrice;
    const priceChangePercent = (priceChange / referencePrice) * 100;
    const absPriceChangePercent = Math.abs(priceChangePercent);

    // Determine flash crash type and level
    let type: 'flash_drop' | 'flash_spike' | 'volatility_spike' | undefined;
    let level: 1 | 2 | 3 | undefined;

    // Check for flash drop
    if (priceChangePercent < -this.config.level1ThresholdPercent) {
      type = 'flash_drop';
      
      if (absPriceChangePercent >= this.config.level3ThresholdPercent) {
        level = 3;
      } else if (absPriceChangePercent >= this.config.level2ThresholdPercent) {
        level = 2;
      } else {
        level = 1;
      }
    }
    // Check for flash spike
    else if (priceChangePercent > this.config.level1ThresholdPercent) {
      type = 'flash_spike';
      
      if (absPriceChangePercent >= this.config.level3ThresholdPercent) {
        level = 3;
      } else if (absPriceChangePercent >= this.config.level2ThresholdPercent) {
        level = 2;
      } else {
        level = 1;
      }
    }
    // Check for volatility spike
    else if (this.detectVolatilitySpike(state, currentPrice.price)) {
      type = 'volatility_spike';
      level = 1;
    }

    if (type && level) {
      return {
        detected: true,
        type,
        level,
        priceChange,
        priceChangePercent,
        referencePrice,
      };
    }

    return { detected: false };
  }

  private detectVolatilitySpike(state: SymbolFlashState, currentPrice: number): boolean {
    if (state.baselineVolatility === 0) return false;
    
    // Calculate current volatility
    const returns = this.calculateReturns(state.priceHistory.slice(-20));
    if (returns.length < 2) return false;
    
    const currentVolatility = this.calculateStdDev(returns);
    state.volatility = currentVolatility;
    
    // Check if volatility exceeds threshold
    return currentVolatility > state.baselineVolatility * this.config.volatilityMultiplier;
  }

  // ============================================================================
  // Price Sanity Checks
  // ============================================================================

  private checkPriceSanity(state: SymbolFlashState, price: number): { valid: boolean; reason?: string } {
    // Check 1: Price must be positive
    if (price <= 0) {
      return { valid: false, reason: 'Non-positive price' };
    }

    // Check 2: Price deviation from VWAP
    if (state.vwap > 0) {
      const deviationPercent = Math.abs((price - state.vwap) / state.vwap) * 100;
      if (deviationPercent > this.config.maxPriceDeviationPercent) {
        return { 
          valid: false, 
          reason: `Price deviates ${deviationPercent.toFixed(2)}% from VWAP (max: ${this.config.maxPriceDeviationPercent}%)` 
        };
      }
    }

    // Check 3: Sudden large price jump from last price
    if (state.lastPrice > 0) {
      const jumpPercent = Math.abs((price - state.lastPrice) / state.lastPrice) * 100;
      // Allow larger jumps if enough time has passed
      const timeSinceLastPrice = Date.now() - state.lastPriceTime;
      const maxJumpPercent = this.config.maxPriceDeviationPercent * 
        Math.max(1, timeSinceLastPrice / this.config.minPriceValidityMs);
      
      if (jumpPercent > maxJumpPercent && timeSinceLastPrice < this.config.minPriceValidityMs) {
        return { 
          valid: false, 
          reason: `Suspicious price jump: ${jumpPercent.toFixed(2)}% in ${timeSinceLastPrice}ms` 
        };
      }
    }

    return { valid: true };
  }

  // ============================================================================
  // Flash Crash Handling
  // ============================================================================

  private handleFlashCrash(symbol: string, state: SymbolFlashState, event: FlashCrashEvent): void {
    state.isInFlashCrash = true;
    state.flashCrashStartTime = event.startTime;
    state.currentLevel = event.level;
    state.recoveryConfirmations = 0;

    // Update statistics
    this.stats.totalDetections++;
    if (event.level === 1) this.stats.level1Triggers++;
    if (event.level === 2) this.stats.level2Triggers++;
    if (event.level === 3) this.stats.level3Triggers++;

    // Store event
    this.events.push(event);
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500);
    }

    // Emit events based on level
    this.emit('flash_crash_detected', event);

    switch (event.level) {
      case 1:
        console.log(`[FlashCrashDetector] LEVEL 1 WARNING: ${symbol} - ${event.priceChangePercent.toFixed(2)}% in ${this.config.detectionWindowMs}ms`);
        this.emit('level1_warning', event);
        break;
        
      case 2:
        console.log(`[FlashCrashDetector] LEVEL 2 CRITICAL: ${symbol} - Initiating position reduction`);
        this.emit('level2_reduce_positions', {
          ...event,
          reducePercent: this.config.emergencyReducePercent,
        });
        break;
        
      case 3:
        console.log(`[FlashCrashDetector] LEVEL 3 EMERGENCY: ${symbol} - Emergency close triggered`);
        if (this.config.emergencyCloseEnabled) {
          this.emit('level3_emergency_close', event);
        }
        break;
    }
  }

  private createFlashCrashEvent(
    symbol: string,
    state: SymbolFlashState,
    detection: {
      type: 'flash_drop' | 'flash_spike' | 'volatility_spike';
      level: 1 | 2 | 3;
      priceChange: number;
      priceChangePercent: number;
      referencePrice: number;
    },
    latencyMs: number
  ): FlashCrashEvent {
    const now = Date.now();
    this.eventCounter++;

    const severity: 'warning' | 'critical' | 'emergency' = 
      detection.level === 3 ? 'emergency' : 
      detection.level === 2 ? 'critical' : 'warning';

    const actionTaken = 
      detection.level === 3 ? 'emergency_close' :
      detection.level === 2 ? 'reduce_positions' : 'alert_only';

    return {
      id: `FC-${symbol}-${now}-${this.eventCounter}`,
      symbol,
      type: detection.type,
      severity,
      level: detection.level,
      priceChange: detection.priceChange,
      priceChangePercent: detection.priceChangePercent,
      detectionLatencyMs: latencyMs,
      startPrice: detection.referencePrice,
      endPrice: state.lastPrice,
      startTime: now - this.config.detectionWindowMs,
      endTime: now,
      vwap: state.vwap,
      deviationFromVwap: state.vwap > 0 ? ((state.lastPrice - state.vwap) / state.vwap) * 100 : 0,
      actionTaken,
      recoveryStatus: 'pending',
    };
  }

  // ============================================================================
  // Recovery Logic
  // ============================================================================

  private checkRecovery(symbol: string, state: SymbolFlashState): void {
    if (!state.isInFlashCrash || !state.flashCrashStartTime) return;

    const now = Date.now();
    const timeSinceFlash = now - state.flashCrashStartTime;

    // Wait for recovery delay
    if (timeSinceFlash < this.config.recoveryDelayMs) return;

    // Start recovery tracking
    if (!state.recoveryStartTime) {
      state.recoveryStartTime = now;
    }

    // Check if price is stable (within normal volatility)
    const recentPrices = state.priceHistory.slice(-10);
    if (recentPrices.length < 10) return;

    const returns = this.calculateReturns(recentPrices);
    const currentVolatility = this.calculateStdDev(returns);

    // If volatility is back to normal, count as confirmation
    if (currentVolatility <= state.baselineVolatility * 2) {
      state.recoveryConfirmations++;
    } else {
      state.recoveryConfirmations = Math.max(0, state.recoveryConfirmations - 1);
    }

    // Recovery complete
    if (state.recoveryConfirmations >= this.config.recoveryConfirmationCount) {
      this.completeRecovery(symbol, state);
    }
  }

  private completeRecovery(symbol: string, state: SymbolFlashState): void {
    const event = this.events.find(e => e.symbol === symbol && e.recoveryStatus === 'pending');
    if (event) {
      event.recoveryStatus = 'recovered';
    }

    state.isInFlashCrash = false;
    state.flashCrashStartTime = null;
    state.currentLevel = 0;
    state.recoveryStartTime = null;
    state.recoveryConfirmations = 0;

    this.stats.successfulRecoveries++;

    console.log(`[FlashCrashDetector] Recovery complete for ${symbol}`);
    this.emit('recovery_complete', { symbol, timestamp: Date.now() });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private initializeSymbolState(symbol: string, initialPrice: number): SymbolFlashState {
    return {
      symbol,
      priceHistory: [],
      vwap: initialPrice,
      vwapVolume: 0,
      lastPrice: initialPrice,
      lastPriceTime: Date.now(),
      volatility: 0,
      baselineVolatility: 0.01, // 1% baseline
      isInFlashCrash: false,
      flashCrashStartTime: null,
      currentLevel: 0,
      recoveryStartTime: null,
      recoveryConfirmations: 0,
      rejectedPrices: 0,
      validPrices: 0,
    };
  }

  private updatePriceHistory(state: SymbolFlashState, pricePoint: PricePoint): void {
    state.priceHistory.push(pricePoint);
    state.lastPrice = pricePoint.price;
    state.lastPriceTime = pricePoint.timestamp;

    // Trim history
    if (state.priceHistory.length > this.config.priceHistorySize) {
      state.priceHistory = state.priceHistory.slice(-this.config.priceHistorySize);
    }

    // Update baseline volatility periodically
    if (state.priceHistory.length % 100 === 0 && !state.isInFlashCrash) {
      this.updateBaselineVolatility(state);
    }
  }

  private updateVWAP(state: SymbolFlashState, pricePoint: PricePoint): void {
    const windowStart = pricePoint.timestamp - this.config.vwapWindowMs;
    const windowPrices = state.priceHistory.filter(p => p.timestamp >= windowStart);

    if (windowPrices.length === 0) {
      state.vwap = pricePoint.price;
      state.vwapVolume = pricePoint.volume;
      return;
    }

    let totalPV = 0;
    let totalVolume = 0;
    for (const p of windowPrices) {
      totalPV += p.price * p.volume;
      totalVolume += p.volume;
    }

    state.vwap = totalVolume > 0 ? totalPV / totalVolume : pricePoint.price;
    state.vwapVolume = totalVolume;
  }

  private updateBaselineVolatility(state: SymbolFlashState): void {
    const returns = this.calculateReturns(state.priceHistory.slice(-100));
    if (returns.length >= 10) {
      state.baselineVolatility = this.calculateStdDev(returns);
    }
  }

  private calculateReturns(prices: PricePoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i].price - prices[i - 1].price) / prices[i - 1].price);
    }
    return returns;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private recordDetectionLatency(latencyMs: number): void {
    this.detectionLatencies.push(latencyMs);
    if (this.detectionLatencies.length > 1000) {
      this.detectionLatencies = this.detectionLatencies.slice(-500);
    }
  }

  // ============================================================================
  // Status & Configuration
  // ============================================================================

  getStatus(): FlashCrashStatus {
    const activeSymbols = Array.from(this.symbolStates.entries())
      .filter(([_, state]) => state.isInFlashCrash)
      .map(([symbol, _]) => symbol);

    const avgLatency = this.detectionLatencies.length > 0
      ? this.detectionLatencies.reduce((a, b) => a + b, 0) / this.detectionLatencies.length
      : 0;

    return {
      isActive: this.isActive,
      activeSymbols,
      totalDetections: this.stats.totalDetections,
      level1Triggers: this.stats.level1Triggers,
      level2Triggers: this.stats.level2Triggers,
      level3Triggers: this.stats.level3Triggers,
      rejectedAnomalies: this.stats.rejectedAnomalies,
      avgDetectionLatencyMs: avgLatency,
      lastEvent: this.events.length > 0 ? this.events[this.events.length - 1] : null,
    };
  }

  getSymbolState(symbol: string): SymbolFlashState | undefined {
    return this.symbolStates.get(symbol);
  }

  getRecentEvents(limit: number = 50): FlashCrashEvent[] {
    return this.events.slice(-limit);
  }

  getConfig(): FlashCrashConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<FlashCrashConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[FlashCrashDetector] Configuration updated');
    this.emit('config_updated', this.config);
  }

  /**
   * Force trigger a flash crash for testing
   */
  simulateFlashCrash(symbol: string, type: 'flash_drop' | 'flash_spike', level: 1 | 2 | 3): FlashCrashEvent {
    const state = this.symbolStates.get(symbol) || this.initializeSymbolState(symbol, 100);
    if (!this.symbolStates.has(symbol)) {
      this.symbolStates.set(symbol, state);
    }

    const priceChangePercent = type === 'flash_drop' 
      ? -level * this.config.level1ThresholdPercent 
      : level * this.config.level1ThresholdPercent;

    const event = this.createFlashCrashEvent(symbol, state, {
      type,
      level,
      priceChange: state.lastPrice * (priceChangePercent / 100),
      priceChangePercent,
      referencePrice: state.lastPrice,
    }, 0.5);

    this.handleFlashCrash(symbol, state, event);
    return event;
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.symbolStates.clear();
    this.events = [];
    this.detectionLatencies = [];
    this.stats = {
      totalDetections: 0,
      level1Triggers: 0,
      level2Triggers: 0,
      level3Triggers: 0,
      rejectedAnomalies: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
    };
    console.log('[FlashCrashDetector] Reset complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let flashCrashDetectorInstance: FlashCrashDetector | null = null;

export function getFlashCrashDetector(config?: Partial<FlashCrashConfig>): FlashCrashDetector {
  if (!flashCrashDetectorInstance) {
    flashCrashDetectorInstance = new FlashCrashDetector(config);
  }
  return flashCrashDetectorInstance;
}

export function resetFlashCrashDetector(): void {
  if (flashCrashDetectorInstance) {
    flashCrashDetectorInstance.stop();
    flashCrashDetectorInstance = null;
  }
}
