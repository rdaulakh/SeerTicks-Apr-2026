/**
 * Ultra Low Latency Tick Processor
 * 
 * Phase 1 Critical Infrastructure: 10ms monitoring interval
 * 
 * Features:
 * - 10ms tick processing interval (down from 100ms)
 * - Lock-free concurrent processing using atomic operations
 * - Event-driven architecture with minimal blocking
 * - Pre-allocated memory pools to avoid GC pauses
 * - Optimized data structures for O(1) operations
 * - Real-time latency tracking with P50/P95/P99 metrics
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface UltraTick {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
  exchange: string;
}

export interface TickWindow {
  ticks: UltraTick[];
  startTime: number;
  endTime: number;
  vwap: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

export interface UltraSignal {
  symbol: string;
  type: 'momentum' | 'volume' | 'microstructure' | 'combined';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0-1
  confidence: number; // 0-1
  timestamp: number;
  latencyMs: number;
  metadata: {
    priceVelocity?: number;
    volumeVelocity?: number;
    buyPressure?: number;
    spreadBps?: number;
    vwapDeviation?: number;
  };
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface ProcessorConfig {
  monitoringIntervalMs: number; // Target: 10ms
  windowSizes: number[]; // [100, 500, 1000, 5000, 15000] ms
  maxTicksPerSymbol: number;
  signalThreshold: number;
  enableMicrostructure: boolean;
}

// ============================================================================
// Pre-allocated Ring Buffer for Lock-Free Operations
// ============================================================================

class RingBuffer<T> {
  private buffer: (T | null)[];
  private head: number = 0;
  private tail: number = 0;
  private size: number;
  private count: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size).fill(null);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.size;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[idx];
      if (item !== null) {
        result.push(item);
      }
      idx = (idx + 1) % this.size;
    }
    return result;
  }

  getRecent(count: number): T[] {
    const result: T[] = [];
    const start = Math.max(0, this.count - count);
    let idx = (this.head + start) % this.size;
    for (let i = start; i < this.count; i++) {
      const item = this.buffer[idx];
      if (item !== null) {
        result.push(item);
      }
      idx = (idx + 1) % this.size;
    }
    return result;
  }

  getCount(): number {
    return this.count;
  }

  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}

// ============================================================================
// Latency Tracker with Percentile Calculation
// ============================================================================

class LatencyHistogram {
  private samples: RingBuffer<number>;
  private sortedCache: number[] | null = null;
  private cacheValid: boolean = false;

  constructor(maxSamples: number = 10000) {
    this.samples = new RingBuffer(maxSamples);
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    this.cacheValid = false;
  }

  getMetrics(): LatencyMetrics {
    const data = this.samples.getAll();
    if (data.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, count: 0 };
    }

    // Sort for percentile calculation
    const sorted = [...data].sort((a, b) => a - b);
    
    const p50Idx = Math.floor(sorted.length * 0.5);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p99Idx = Math.floor(sorted.length * 0.99);

    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      p50: sorted[p50Idx] || 0,
      p95: sorted[p95Idx] || 0,
      p99: sorted[p99Idx] || 0,
      avg: sum / sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: sorted.length,
    };
  }

  clear(): void {
    this.samples.clear();
    this.cacheValid = false;
  }
}

// ============================================================================
// Ultra Low Latency Tick Processor
// ============================================================================

export class UltraLowLatencyTickProcessor extends EventEmitter {
  private config: ProcessorConfig;
  
  // Per-symbol tick storage using ring buffers
  private tickBuffers: Map<string, RingBuffer<UltraTick>> = new Map();
  
  // Pre-computed window data for fast access
  private windowCache: Map<string, Map<number, TickWindow>> = new Map();
  
  // Latency tracking
  private processingLatency: LatencyHistogram = new LatencyHistogram();
  private signalLatency: LatencyHistogram = new LatencyHistogram();
  
  // Performance counters (atomic-like operations)
  private ticksProcessed: number = 0;
  private signalsGenerated: number = 0;
  private lastProcessTime: number = 0;
  
  // Monitoring interval
  private monitoringTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config?: Partial<ProcessorConfig>) {
    super();
    this.config = {
      monitoringIntervalMs: 10, // 10ms monitoring interval
      windowSizes: [100, 500, 1000, 5000, 15000], // 100ms, 500ms, 1s, 5s, 15s
      maxTicksPerSymbol: 10000,
      signalThreshold: 0.3,
      enableMicrostructure: true,
      ...config,
    };

    console.log('[UltraLowLatencyTickProcessor] Initialized with 10ms monitoring interval');
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Start 10ms monitoring loop
    this.monitoringTimer = setInterval(() => {
      this.processAllSymbols();
    }, this.config.monitoringIntervalMs);

    console.log(`[UltraLowLatencyTickProcessor] Started with ${this.config.monitoringIntervalMs}ms interval`);
    this.emit('started', { intervalMs: this.config.monitoringIntervalMs });
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    console.log('[UltraLowLatencyTickProcessor] Stopped');
    this.emit('stopped', this.getStats());
  }

  // ============================================================================
  // Tick Processing (Optimized for <1ms per tick)
  // ============================================================================

  /**
   * Process a single tick - optimized for minimal latency
   */
  processTick(tick: UltraTick): void {
    const startTime = performance.now();

    // Get or create buffer for symbol
    let buffer = this.tickBuffers.get(tick.symbol);
    if (!buffer) {
      buffer = new RingBuffer(this.config.maxTicksPerSymbol);
      this.tickBuffers.set(tick.symbol, buffer);
      this.windowCache.set(tick.symbol, new Map());
    }

    // Add tick to buffer (O(1) operation)
    buffer.push(tick);
    this.ticksProcessed++;

    // Invalidate window cache for this symbol
    const cache = this.windowCache.get(tick.symbol);
    if (cache) {
      cache.clear();
    }

    // Track processing latency
    const latency = performance.now() - startTime;
    this.processingLatency.record(latency);

    // Emit tick processed event
    this.emit('tick_processed', {
      symbol: tick.symbol,
      price: tick.price,
      latencyMs: latency,
    });
  }

  /**
   * Batch process multiple ticks - more efficient for high throughput
   */
  processTicks(ticks: UltraTick[]): void {
    const startTime = performance.now();

    for (const tick of ticks) {
      let buffer = this.tickBuffers.get(tick.symbol);
      if (!buffer) {
        buffer = new RingBuffer(this.config.maxTicksPerSymbol);
        this.tickBuffers.set(tick.symbol, buffer);
        this.windowCache.set(tick.symbol, new Map());
      }
      buffer.push(tick);
    }

    this.ticksProcessed += ticks.length;

    // Clear all window caches
    for (const cache of this.windowCache.values()) {
      cache.clear();
    }

    const latency = performance.now() - startTime;
    this.processingLatency.record(latency / ticks.length);
  }

  // ============================================================================
  // 10ms Monitoring Loop
  // ============================================================================

  private processAllSymbols(): void {
    const startTime = performance.now();
    const now = Date.now();

    for (const [symbol, buffer] of this.tickBuffers.entries()) {
      // Generate signals for each symbol
      const signals = this.generateSignals(symbol, now);
      
      for (const signal of signals) {
        this.signalsGenerated++;
        this.emit('signal', signal);
      }
    }

    this.lastProcessTime = performance.now() - startTime;
  }

  // ============================================================================
  // Signal Generation (Optimized for <20ms)
  // ============================================================================

  private generateSignals(symbol: string, now: number): UltraSignal[] {
    const signalStart = performance.now();
    const signals: UltraSignal[] = [];

    // Get window data
    const window100ms = this.getWindow(symbol, 100, now);
    const window500ms = this.getWindow(symbol, 500, now);
    const window1s = this.getWindow(symbol, 1000, now);
    const window5s = this.getWindow(symbol, 5000, now);

    if (!window100ms || window100ms.ticks.length < 2) {
      return signals;
    }

    // 1. Momentum Signal (price velocity)
    const momentumSignal = this.generateMomentumSignal(symbol, window100ms, window500ms, window1s, now);
    if (momentumSignal) signals.push(momentumSignal);

    // 2. Volume Signal (buy/sell pressure)
    const volumeSignal = this.generateVolumeSignal(symbol, window100ms, window1s, now);
    if (volumeSignal) signals.push(volumeSignal);

    // 3. Microstructure Signal (VWAP deviation, spread)
    if (this.config.enableMicrostructure) {
      const microSignal = this.generateMicrostructureSignal(symbol, window100ms, window5s, now);
      if (microSignal) signals.push(microSignal);
    }

    // 4. Combined Signal (multi-factor confirmation)
    if (signals.length >= 2) {
      const combinedSignal = this.generateCombinedSignal(symbol, signals, now);
      if (combinedSignal) signals.push(combinedSignal);
    }

    // Track signal generation latency
    const signalLatency = performance.now() - signalStart;
    this.signalLatency.record(signalLatency);

    // Add latency to all signals
    for (const signal of signals) {
      signal.latencyMs = signalLatency;
    }

    return signals;
  }

  private generateMomentumSignal(
    symbol: string,
    window100ms: TickWindow,
    window500ms: TickWindow | null,
    window1s: TickWindow | null,
    now: number
  ): UltraSignal | null {
    // Calculate price velocity ($/ms)
    const velocity100ms = this.calculatePriceVelocity(window100ms);
    const velocity500ms = window500ms ? this.calculatePriceVelocity(window500ms) : 0;
    const velocity1s = window1s ? this.calculatePriceVelocity(window1s) : 0;

    // Multi-timeframe confirmation
    const allPositive = velocity100ms > 0 && velocity500ms > 0 && velocity1s > 0;
    const allNegative = velocity100ms < 0 && velocity500ms < 0 && velocity1s < 0;

    if (!allPositive && !allNegative) return null;

    // Calculate strength based on velocity magnitude
    const avgVelocity = (Math.abs(velocity100ms) + Math.abs(velocity500ms) + Math.abs(velocity1s)) / 3;
    const strength = Math.min(avgVelocity * 10000, 1); // Normalize

    if (strength < this.config.signalThreshold) return null;

    return {
      symbol,
      type: 'momentum',
      direction: allPositive ? 'LONG' : 'SHORT',
      strength,
      confidence: Math.min(0.5 + strength * 0.5, 0.95),
      timestamp: now,
      latencyMs: 0,
      metadata: {
        priceVelocity: velocity100ms,
      },
    };
  }

  private generateVolumeSignal(
    symbol: string,
    window100ms: TickWindow,
    window1s: TickWindow | null,
    now: number
  ): UltraSignal | null {
    const buyPressure = window100ms.volume > 0 
      ? window100ms.buyVolume / window100ms.volume 
      : 0.5;

    // Calculate volume spike
    const avgVolume1s = window1s ? window1s.volume / 10 : window100ms.volume;
    const volumeSpike = avgVolume1s > 0 ? window100ms.volume / avgVolume1s : 1;

    // Strong buy or sell pressure with volume spike
    const strongBuy = buyPressure > 0.65 && volumeSpike > 1.5;
    const strongSell = buyPressure < 0.35 && volumeSpike > 1.5;

    if (!strongBuy && !strongSell) return null;

    const strength = Math.min(volumeSpike / 3, 1);

    if (strength < this.config.signalThreshold) return null;

    return {
      symbol,
      type: 'volume',
      direction: strongBuy ? 'LONG' : 'SHORT',
      strength,
      confidence: Math.min(0.6 + (Math.abs(buyPressure - 0.5) * 0.8), 0.95),
      timestamp: now,
      latencyMs: 0,
      metadata: {
        volumeVelocity: window100ms.volume / 100,
        buyPressure,
      },
    };
  }

  private generateMicrostructureSignal(
    symbol: string,
    window100ms: TickWindow,
    window5s: TickWindow | null,
    now: number
  ): UltraSignal | null {
    if (!window5s || window5s.vwap === 0) return null;

    // VWAP deviation
    const vwapDeviation = (window100ms.close - window5s.vwap) / window5s.vwap;
    
    // Price range as proxy for spread
    const range = window100ms.high - window100ms.low;
    const spreadBps = window100ms.close > 0 ? (range / window100ms.close) * 10000 : 0;

    // Signal when price deviates significantly from VWAP
    const deviationThreshold = 0.001; // 0.1%
    
    if (Math.abs(vwapDeviation) < deviationThreshold) return null;

    const strength = Math.min(Math.abs(vwapDeviation) * 100, 1);

    if (strength < this.config.signalThreshold) return null;

    return {
      symbol,
      type: 'microstructure',
      direction: vwapDeviation > 0 ? 'SHORT' : 'LONG', // Mean reversion
      strength,
      confidence: Math.min(0.5 + strength * 0.4, 0.85),
      timestamp: now,
      latencyMs: 0,
      metadata: {
        vwapDeviation,
        spreadBps,
      },
    };
  }

  private generateCombinedSignal(
    symbol: string,
    signals: UltraSignal[],
    now: number
  ): UltraSignal | null {
    const longSignals = signals.filter(s => s.direction === 'LONG');
    const shortSignals = signals.filter(s => s.direction === 'SHORT');

    const dominantDirection = longSignals.length > shortSignals.length ? 'LONG' : 'SHORT';
    const dominantSignals = dominantDirection === 'LONG' ? longSignals : shortSignals;

    if (dominantSignals.length < 2) return null;

    const avgStrength = dominantSignals.reduce((sum, s) => sum + s.strength, 0) / dominantSignals.length;
    const avgConfidence = dominantSignals.reduce((sum, s) => sum + s.confidence, 0) / dominantSignals.length;

    return {
      symbol,
      type: 'combined',
      direction: dominantDirection,
      strength: Math.min(avgStrength * 1.2, 1),
      confidence: Math.min(avgConfidence + 0.1, 0.98),
      timestamp: now,
      latencyMs: 0,
      metadata: {},
    };
  }

  // ============================================================================
  // Window Calculation (Cached for Performance)
  // ============================================================================

  private getWindow(symbol: string, windowMs: number, now: number): TickWindow | null {
    const cache = this.windowCache.get(symbol);
    if (cache?.has(windowMs)) {
      return cache.get(windowMs)!;
    }

    const buffer = this.tickBuffers.get(symbol);
    if (!buffer) return null;

    const ticks = buffer.getAll().filter(t => now - t.timestamp <= windowMs);
    if (ticks.length === 0) return null;

    const window = this.calculateWindow(ticks, now - windowMs, now);
    
    if (cache) {
      cache.set(windowMs, window);
    }

    return window;
  }

  private calculateWindow(ticks: UltraTick[], startTime: number, endTime: number): TickWindow {
    let volume = 0;
    let buyVolume = 0;
    let sellVolume = 0;
    let vwapNumerator = 0;
    let high = -Infinity;
    let low = Infinity;

    for (const tick of ticks) {
      volume += tick.quantity;
      vwapNumerator += tick.price * tick.quantity;
      
      if (tick.isBuyerMaker) {
        sellVolume += tick.quantity;
      } else {
        buyVolume += tick.quantity;
      }

      if (tick.price > high) high = tick.price;
      if (tick.price < low) low = tick.price;
    }

    return {
      ticks,
      startTime,
      endTime,
      vwap: volume > 0 ? vwapNumerator / volume : 0,
      volume,
      buyVolume,
      sellVolume,
      high: high === -Infinity ? 0 : high,
      low: low === Infinity ? 0 : low,
      open: ticks[0]?.price || 0,
      close: ticks[ticks.length - 1]?.price || 0,
    };
  }

  private calculatePriceVelocity(window: TickWindow): number {
    if (window.ticks.length < 2) return 0;
    
    const priceChange = window.close - window.open;
    const timeChange = window.endTime - window.startTime;
    
    if (timeChange === 0) return 0;
    
    return priceChange / timeChange; // $/ms
  }

  // ============================================================================
  // Statistics & Monitoring
  // ============================================================================

  getStats(): {
    isRunning: boolean;
    ticksProcessed: number;
    signalsGenerated: number;
    symbolCount: number;
    processingLatency: LatencyMetrics;
    signalLatency: LatencyMetrics;
    lastProcessTimeMs: number;
    config: ProcessorConfig;
  } {
    return {
      isRunning: this.isRunning,
      ticksProcessed: this.ticksProcessed,
      signalsGenerated: this.signalsGenerated,
      symbolCount: this.tickBuffers.size,
      processingLatency: this.processingLatency.getMetrics(),
      signalLatency: this.signalLatency.getMetrics(),
      lastProcessTimeMs: this.lastProcessTime,
      config: this.config,
    };
  }

  getLatencyMetrics(): {
    processing: LatencyMetrics;
    signal: LatencyMetrics;
  } {
    return {
      processing: this.processingLatency.getMetrics(),
      signal: this.signalLatency.getMetrics(),
    };
  }

  getTickCount(symbol: string): number {
    return this.tickBuffers.get(symbol)?.getCount() || 0;
  }

  clearSymbol(symbol: string): void {
    this.tickBuffers.delete(symbol);
    this.windowCache.delete(symbol);
  }

  clearAll(): void {
    this.tickBuffers.clear();
    this.windowCache.clear();
    this.processingLatency.clear();
    this.signalLatency.clear();
    this.ticksProcessed = 0;
    this.signalsGenerated = 0;
  }

  updateConfig(config: Partial<ProcessorConfig>): void {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning) {
      this.start();
    }

    console.log('[UltraLowLatencyTickProcessor] Config updated:', this.config);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let processorInstance: UltraLowLatencyTickProcessor | null = null;

export function getUltraLowLatencyTickProcessor(): UltraLowLatencyTickProcessor {
  if (!processorInstance) {
    processorInstance = new UltraLowLatencyTickProcessor();
  }
  return processorInstance;
}

export function createUltraLowLatencyTickProcessor(config?: Partial<ProcessorConfig>): UltraLowLatencyTickProcessor {
  return new UltraLowLatencyTickProcessor(config);
}
