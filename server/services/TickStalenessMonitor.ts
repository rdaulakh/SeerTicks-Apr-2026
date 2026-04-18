/**
 * Tick Staleness Monitor with Auto-Recovery
 * 
 * Institutional-grade tick monitoring system that:
 * 1. Detects tick staleness at millisecond precision (500ms threshold)
 * 2. Auto-recovers by triggering WebSocket reconnection
 * 3. Supports dual-feed aggregation for increased tick frequency
 * 4. Provides real-time health metrics and alerting
 * 
 * Architecture:
 * - Primary Feed: Coinbase WebSocket (high-frequency trades)
 * - Secondary Feed: Binance REST fallback (redundancy)
 * - Both feeds run simultaneously for maximum tick coverage
 * - Deduplication prevents duplicate price updates
 */

import EventEmitter from 'eventemitter3';
import { priceFeedService } from './priceFeedService';

export interface TickSource {
  name: string;
  lastTickTime: number;
  tickCount: number;
  ticksPerSecond: number;
  isStale: boolean;
  reconnectCount: number;
  lastReconnectTime: number | null;
  avgLatencyMs: number;
  latencyHistory: number[];
}

export interface StalenessAlert {
  source: string;
  staleDurationMs: number;
  timestamp: number;
  action: 'reconnect' | 'failover' | 'alert';
  success: boolean;
}

export interface TickStalenessStatus {
  isHealthy: boolean;
  primarySource: TickSource;
  secondarySource: TickSource | null;
  dualFeedEnabled: boolean;
  totalTicksReceived: number;
  ticksPerSecond: number;
  lastTickTime: number;
  staleDurationMs: number;
  alerts: StalenessAlert[];
  uptime: number;
}

export interface TickStalenessConfig {
  stalenessThresholdMs: number;      // When to consider feed stale (default: 500ms)
  reconnectDelayMs: number;          // Delay before reconnect attempt (default: 100ms)
  maxReconnectAttempts: number;      // Max reconnects before alerting (default: 5)
  healthCheckIntervalMs: number;     // How often to check health (default: 100ms)
  dualFeedEnabled: boolean;          // Run both feeds simultaneously (default: true)
  alertOnStale: boolean;             // Emit alerts when stale (default: true)
  autoReconnect: boolean;            // Auto-reconnect on staleness (default: true)
}

const DEFAULT_CONFIG: TickStalenessConfig = {
  stalenessThresholdMs: 500,         // 500ms = stale (millisecond trading requires fast detection)
  reconnectDelayMs: 100,             // Quick reconnect for minimal downtime
  maxReconnectAttempts: 10,          // Try 10 times before cooldown reset
  healthCheckIntervalMs: 100,        // Check every 100ms for millisecond precision
  dualFeedEnabled: true,             // Run both feeds for redundancy
  alertOnStale: true,                // Alert on staleness
  autoReconnect: true,               // Auto-reconnect
};

export class TickStalenessMonitor extends EventEmitter {
  private config: TickStalenessConfig;
  private primarySource: TickSource;
  private secondarySource: TickSource | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private alerts: StalenessAlert[] = [];
  private maxAlertHistory: number = 100;
  
  // Tick aggregation for dual-feed
  private lastTickPrices: Map<string, { price: number; timestamp: number; source: string }> = new Map();
  private deduplicationWindowMs: number = 50; // Dedupe ticks within 50ms
  
  // Reconnect callbacks
  private primaryReconnectCallback: (() => Promise<void>) | null = null;
  private secondaryReconnectCallback: (() => Promise<void>) | null = null;
  
  // Tick rate calculation
  private tickCountWindow: number[] = [];
  private tickCountWindowSize: number = 10; // 10 samples for smoothing
  private lastTickCountTime: number = 0;
  private tickCountInWindow: number = 0;

  constructor(config: Partial<TickStalenessConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.primarySource = this.createTickSource('Coinbase');
    
    if (this.config.dualFeedEnabled) {
      this.secondarySource = this.createTickSource('Binance');
    }
    
    console.log('[TickStalenessMonitor] Initialized with config:', {
      stalenessThresholdMs: this.config.stalenessThresholdMs,
      healthCheckIntervalMs: this.config.healthCheckIntervalMs,
      dualFeedEnabled: this.config.dualFeedEnabled,
      autoReconnect: this.config.autoReconnect,
    });
  }

  private createTickSource(name: string): TickSource {
    return {
      name,
      lastTickTime: 0,
      tickCount: 0,
      ticksPerSecond: 0,
      isStale: true,
      reconnectCount: 0,
      lastReconnectTime: null,
      avgLatencyMs: 0,
      latencyHistory: [],
    };
  }

  /**
   * Start the staleness monitor
   */
  start(): void {
    if (this.isRunning) {
      console.log('[TickStalenessMonitor] Already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    
    console.log('[TickStalenessMonitor] 🚀 Starting tick staleness monitoring');
    console.log(`[TickStalenessMonitor] Staleness threshold: ${this.config.stalenessThresholdMs}ms`);
    console.log(`[TickStalenessMonitor] Health check interval: ${this.config.healthCheckIntervalMs}ms`);
    console.log(`[TickStalenessMonitor] Dual feed: ${this.config.dualFeedEnabled ? 'ENABLED' : 'DISABLED'}`);

    // Subscribe to price feed for tick tracking
    this.subscribeToPriceFeed();

    // Start health check interval
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, this.config.healthCheckIntervalMs);

    this.emit('started', { timestamp: Date.now() });
  }

  /**
   * Stop the staleness monitor
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    console.log('[TickStalenessMonitor] Stopped');
    this.emit('stopped', { timestamp: Date.now() });
  }

  /**
   * Subscribe to price feed service for tick tracking
   */
  private subscribeToPriceFeed(): void {
    // Track ticks from the central price feed service
    priceFeedService.on('price_update', (data: { symbol: string; price: number; source?: string; timestamp?: number }) => {
      const now = Date.now();
      const source = data.source || 'websocket';
      
      // Determine which source this tick came from
      if (source === 'websocket' || source === 'coinapi' || source === 'coinbase') {
        this.recordTick(this.primarySource, now, data.symbol, data.price);
      } else if (source === 'coincap' || source === 'fallback' || source === 'binance') {
        if (this.secondarySource) {
          this.recordTick(this.secondarySource, now, data.symbol, data.price);
        }
      } else {
        // Default to primary
        this.recordTick(this.primarySource, now, data.symbol, data.price);
      }
      
      // Track for tick rate calculation
      this.tickCountInWindow++;
    });
  }

  /**
   * Record a tick from a source
   */
  private recordTick(source: TickSource, timestamp: number, symbol: string, price: number): void {
    // Calculate latency if we have a previous tick
    if (source.lastTickTime > 0) {
      const latency = timestamp - source.lastTickTime;
      source.latencyHistory.push(latency);
      
      // Keep only last 100 latency samples
      if (source.latencyHistory.length > 100) {
        source.latencyHistory.shift();
      }
      
      // Calculate average latency
      source.avgLatencyMs = source.latencyHistory.reduce((a, b) => a + b, 0) / source.latencyHistory.length;
    }
    
    source.lastTickTime = timestamp;
    source.tickCount++;
    source.isStale = false;
    
    // Deduplication for dual-feed
    if (this.config.dualFeedEnabled) {
      const lastTick = this.lastTickPrices.get(symbol);
      if (lastTick && (timestamp - lastTick.timestamp) < this.deduplicationWindowMs) {
        // Skip duplicate tick within deduplication window
        return;
      }
      this.lastTickPrices.set(symbol, { price, timestamp, source: source.name });
    }
    
    // Emit tick event for consumers
    this.emit('tick', {
      source: source.name,
      symbol,
      price,
      timestamp,
      latencyMs: source.avgLatencyMs,
    });
  }

  /**
   * Check health of all tick sources
   */
  private checkHealth(): void {
    const now = Date.now();
    
    // Calculate tick rate
    if (now - this.lastTickCountTime >= 1000) {
      this.tickCountWindow.push(this.tickCountInWindow);
      if (this.tickCountWindow.length > this.tickCountWindowSize) {
        this.tickCountWindow.shift();
      }
      this.tickCountInWindow = 0;
      this.lastTickCountTime = now;
      
      // Update tick rate for sources
      const avgTicksPerSecond = this.tickCountWindow.reduce((a, b) => a + b, 0) / this.tickCountWindow.length;
      this.primarySource.ticksPerSecond = avgTicksPerSecond;
      if (this.secondarySource) {
        this.secondarySource.ticksPerSecond = avgTicksPerSecond * 0.3; // Estimate secondary contribution
      }
    }
    
    // Check primary source staleness
    this.checkSourceStaleness(this.primarySource, now);
    
    // Check secondary source staleness
    if (this.secondarySource) {
      this.checkSourceStaleness(this.secondarySource, now);
    }
    
    // Emit health status periodically (every second)
    if (now % 1000 < this.config.healthCheckIntervalMs) {
      this.emit('health', this.getStatus());
    }
  }

  /**
   * Check staleness for a specific source
   */
  private checkSourceStaleness(source: TickSource, now: number): void {
    if (source.lastTickTime === 0) {
      // No ticks received yet - waiting for first tick
      return;
    }
    
    const staleDuration = now - source.lastTickTime;
    const wasStale = source.isStale;
    source.isStale = staleDuration > this.config.stalenessThresholdMs;
    
    if (source.isStale && !wasStale) {
      // Just became stale
      console.warn(`[TickStalenessMonitor] ⚠️ ${source.name} is STALE (${staleDuration}ms since last tick)`);
      
      const alert: StalenessAlert = {
        source: source.name,
        staleDurationMs: staleDuration,
        timestamp: now,
        action: 'reconnect',
        success: false,
      };
      
      this.addAlert(alert);
      this.emit('stale', { source: source.name, staleDurationMs: staleDuration });
      
      // Trigger auto-recovery
      if (this.config.autoReconnect) {
        this.triggerReconnect(source);
      }
    } else if (!source.isStale && wasStale) {
      // Recovered from staleness
      console.log(`[TickStalenessMonitor] ✅ ${source.name} recovered from staleness`);
      this.emit('recovered', { source: source.name, timestamp: now });
    }
  }

  /**
   * Trigger reconnection for a stale source.
   * NEVER gives up — after maxReconnectAttempts, resets counter with a cooldown
   * and retries indefinitely. With real money positions open, price feed is life support.
   */
  private async triggerReconnect(source: TickSource): Promise<void> {
    if (source.reconnectCount >= this.config.maxReconnectAttempts) {
      console.warn(`[TickStalenessMonitor] ⚠️ ${source.name} reached ${source.reconnectCount} reconnect attempts — resetting with 10s cooldown`);
      this.emit('max_reconnects', { source: source.name, attempts: source.reconnectCount });
      
      // NEVER give up — reset counter and retry after cooldown
      // With real money positions open, even 30s without price feed is dangerous
      source.reconnectCount = 0;
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s cooldown
      
      // If source recovered during cooldown, skip reconnect
      if (!source.isStale) {
        console.log(`[TickStalenessMonitor] ✅ ${source.name} recovered during cooldown — skipping reconnect`);
        return;
      }
      
      console.log(`[TickStalenessMonitor] 🔄 ${source.name} still stale after cooldown — retrying reconnect cycle`);
    }
    
    source.reconnectCount++;
    source.lastReconnectTime = Date.now();
    
    console.log(`[TickStalenessMonitor] 🔄 Triggering reconnect for ${source.name} (attempt ${source.reconnectCount}/${this.config.maxReconnectAttempts})`);
    
    // Call the appropriate reconnect callback
    try {
      if ((source.name === 'Coinbase' || source.name === 'CoinAPI') && this.primaryReconnectCallback) {
        await this.primaryReconnectCallback();
        console.log(`[TickStalenessMonitor] ✅ ${source.name} reconnect triggered successfully`);
        
        // Update alert as successful
        const lastAlert = this.alerts[this.alerts.length - 1];
        if (lastAlert && lastAlert.source === source.name) {
          lastAlert.success = true;
        }
      } else if ((source.name === 'Binance' || source.name === 'CoinCap') && this.secondaryReconnectCallback) {
        await this.secondaryReconnectCallback();
        console.log(`[TickStalenessMonitor] ✅ ${source.name} reconnect triggered successfully`);
      }
      
      this.emit('reconnect_triggered', { source: source.name, attempt: source.reconnectCount });
    } catch (error) {
      console.error(`[TickStalenessMonitor] ❌ ${source.name} reconnect failed:`, error);
      this.emit('reconnect_failed', { source: source.name, error });
    }
  }

  /**
   * Set reconnect callback for primary source
   */
  setPrimaryReconnectCallback(callback: () => Promise<void>): void {
    this.primaryReconnectCallback = callback;
    console.log('[TickStalenessMonitor] Primary reconnect callback registered');
  }

  /**
   * Set reconnect callback for secondary source
   */
  setSecondaryReconnectCallback(callback: () => Promise<void>): void {
    this.secondaryReconnectCallback = callback;
    console.log('[TickStalenessMonitor] Secondary reconnect callback registered');
  }

  /**
   * Manually report a tick from external source
   * Used when integrating with existing WebSocket handlers
   */
  reportTick(sourceName: string, symbol: string, price: number, timestamp?: number): void {
    const now = timestamp || Date.now();
    
    if (sourceName === 'Coinbase' || sourceName === 'coinbase' || sourceName === 'CoinAPI' || sourceName === 'coinapi' || sourceName === 'primary') {
      this.recordTick(this.primarySource, now, symbol, price);
    } else if (this.secondarySource && (sourceName === 'Binance' || sourceName === 'binance' || sourceName === 'CoinCap' || sourceName === 'coincap' || sourceName === 'secondary')) {
      this.recordTick(this.secondarySource, now, symbol, price);
    }
  }

  /**
   * Reset reconnect counter for a source (call after successful connection)
   */
  resetReconnectCount(sourceName: string): void {
    if (sourceName === 'Coinbase' || sourceName === 'CoinAPI' || sourceName === 'primary') {
      this.primarySource.reconnectCount = 0;
      console.log('[TickStalenessMonitor] Primary source reconnect count reset');
    } else if (this.secondarySource && (sourceName === 'Binance' || sourceName === 'CoinCap' || sourceName === 'secondary')) {
      this.secondarySource.reconnectCount = 0;
      console.log('[TickStalenessMonitor] Secondary source reconnect count reset');
    }
  }

  /**
   * Add alert to history
   */
  private addAlert(alert: StalenessAlert): void {
    this.alerts.push(alert);
    
    // Keep only recent alerts
    if (this.alerts.length > this.maxAlertHistory) {
      this.alerts.shift();
    }
    
    if (this.config.alertOnStale) {
      this.emit('alert', alert);
    }
  }

  /**
   * Get current status
   */
  getStatus(): TickStalenessStatus {
    const now = Date.now();
    const primaryStaleDuration = this.primarySource.lastTickTime > 0 
      ? now - this.primarySource.lastTickTime 
      : 0;
    
    const totalTicks = this.primarySource.tickCount + (this.secondarySource?.tickCount || 0);
    const avgTicksPerSecond = this.tickCountWindow.length > 0
      ? this.tickCountWindow.reduce((a, b) => a + b, 0) / this.tickCountWindow.length
      : 0;
    
    return {
      isHealthy: !this.primarySource.isStale || (this.secondarySource ? !this.secondarySource.isStale : false),
      primarySource: { ...this.primarySource },
      secondarySource: this.secondarySource ? { ...this.secondarySource } : null,
      dualFeedEnabled: this.config.dualFeedEnabled,
      totalTicksReceived: totalTicks,
      ticksPerSecond: avgTicksPerSecond,
      lastTickTime: Math.max(
        this.primarySource.lastTickTime,
        this.secondarySource?.lastTickTime || 0
      ),
      staleDurationMs: primaryStaleDuration,
      alerts: [...this.alerts.slice(-10)], // Last 10 alerts
      uptime: this.startTime > 0 ? now - this.startTime : 0,
    };
  }

  /**
   * Get alerts history
   */
  getAlerts(): StalenessAlert[] {
    return [...this.alerts];
  }

  /**
   * Clear alerts history
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TickStalenessConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[TickStalenessMonitor] Configuration updated:', this.config);
  }

  /**
   * Check if monitor is running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const tickStalenessMonitor = new TickStalenessMonitor();
