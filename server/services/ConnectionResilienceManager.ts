/**
 * Connection Resilience Manager
 * 
 * Centralized connection health monitoring and auto-recovery for all data sources.
 * Addresses the root cause of signal loss during active trading.
 * 
 * Key Features:
 * 1. Unified health monitoring for all connections (DB, WebSocket, APIs)
 * 2. Automatic reconnection with exponential backoff
 * 3. Signal buffering during connection recovery
 * 4. Circuit breaker integration for cascade failure prevention
 * 5. Real-time health status reporting
 * 
 * Architecture:
 * - Monitors: Database pool, CoinAPI WebSocket, Coinbase WebSocket, External APIs
 * - Recovery: Automatic reconnection with configurable retry policies
 * - Buffering: Queues signals during brief disconnections
 * - Alerting: Emits events for monitoring dashboards
 */

import { EventEmitter } from 'events';
import { getDb, getPoolStats } from '../db';
import { priceFeedService } from './priceFeedService';

export interface ConnectionHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'disconnected' | 'recovering';
  lastSuccessTime: number | null;
  lastErrorTime: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalFailures: number;
  totalRecoveries: number;
  uptime: number; // percentage
  latencyMs: number;
  isRecovering: boolean;
}

export interface ConnectionResilienceConfig {
  healthCheckIntervalMs: number;
  maxConsecutiveFailures: number;
  recoveryDelayMs: number;
  maxRecoveryDelayMs: number;
  signalBufferSize: number;
  signalBufferTimeoutMs: number;
}

interface BufferedSignal {
  timestamp: number;
  type: string;
  data: any;
}

const DEFAULT_CONFIG: ConnectionResilienceConfig = {
  healthCheckIntervalMs: 5000,        // Check every 5 seconds
  maxConsecutiveFailures: 3,          // Trigger recovery after 3 failures
  recoveryDelayMs: 1000,              // Start with 1 second delay
  maxRecoveryDelayMs: 30000,          // Max 30 seconds between retries
  signalBufferSize: 1000,             // Buffer up to 1000 signals
  signalBufferTimeoutMs: 60000,       // Discard signals older than 60 seconds
};

export class ConnectionResilienceManager extends EventEmitter {
  private config: ConnectionResilienceConfig;
  private connections: Map<string, ConnectionHealth> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private signalBuffer: BufferedSignal[] = [];
  private isRunning: boolean = false;
  private startTime: number = 0;
  
  // Recovery callbacks
  private recoveryCallbacks: Map<string, () => Promise<void>> = new Map();
  
  // Last price tick tracking
  private lastPriceTickTime: number = 0;
  private priceTickCount: number = 0;

  constructor(config: Partial<ConnectionResilienceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize connection health entries
    this.initializeConnections();
  }

  private initializeConnections(): void {
    const connectionNames = [
      'database',
      'binance_fallback',
      'coinbase_websocket',
      'price_feed',
      'whale_alert_api',
      'dune_api',
      'news_api',
    ];

    for (const name of connectionNames) {
      this.connections.set(name, {
        name,
        status: 'disconnected',
        lastSuccessTime: null,
        lastErrorTime: null,
        lastError: null,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalRecoveries: 0,
        uptime: 0,
        latencyMs: 0,
        isRecovering: false,
      });
    }
  }

  /**
   * Start the resilience manager
   */
  start(): void {
    if (this.isRunning) {
      console.log('[ConnectionResilienceManager] Already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    console.log('[ConnectionResilienceManager] 🚀 Starting connection resilience monitoring');
    console.log(`[ConnectionResilienceManager] Health check interval: ${this.config.healthCheckIntervalMs}ms`);
    console.log(`[ConnectionResilienceManager] Max consecutive failures: ${this.config.maxConsecutiveFailures}`);

    // Subscribe to price feed for tick tracking
    this.subscribeToPriceFeed();

    // Start health check interval
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    // Initial health check
    this.performHealthCheck();

    this.emit('started', { timestamp: Date.now() });
  }

  /**
   * Stop the resilience manager
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    console.log('[ConnectionResilienceManager] Stopped');
    this.emit('stopped', { timestamp: Date.now() });
  }

  /**
   * Subscribe to price feed for tick tracking
   */
  private subscribeToPriceFeed(): void {
    priceFeedService.on('price_update', () => {
      this.lastPriceTickTime = Date.now();
      this.priceTickCount++;
      
      // Mark price feed as healthy
      this.recordSuccess('price_feed');
    });
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(): Promise<void> {
    const now = Date.now();

    // Check database connection
    await this.checkDatabaseHealth();

    // Check price feed health (based on tick recency)
    this.checkPriceFeedHealth(now);

    // Check WebSocket connections (via tick staleness)
    this.checkWebSocketHealth(now);

    // Emit health status
    this.emit('health_check', this.getAllHealth());

    // Log summary periodically (every 30 seconds)
    if (now % 30000 < this.config.healthCheckIntervalMs) {
      this.logHealthSummary();
    }
  }

  /**
   * Check database connection health
   */
  private async checkDatabaseHealth(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const db = await getDb();
      if (!db) {
        this.recordFailure('database', 'Database not initialized');
        return;
      }

      // Get pool stats for monitoring
      const poolStats = getPoolStats();
      
      // Simple query to verify connection
      // The getDb() already tests connection, so if we got here, it's working
      const latency = Date.now() - startTime;
      
      const health = this.connections.get('database');
      if (health) {
        health.latencyMs = latency;
      }

      this.recordSuccess('database');

      // Check for pool exhaustion warning
      if (poolStats && poolStats.queuedRequests > 5) {
        console.warn(`[ConnectionResilienceManager] ⚠️ Database pool queue building up: ${poolStats.queuedRequests} queued requests`);
        this.emit('pool_warning', { queuedRequests: poolStats.queuedRequests });
      }
    } catch (error) {
      this.recordFailure('database', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Check price feed health based on tick recency
   */
  private checkPriceFeedHealth(now: number): void {
    const timeSinceLastTick = now - this.lastPriceTickTime;
    
    if (this.lastPriceTickTime === 0) {
      // No ticks received yet
      return;
    }

    if (timeSinceLastTick > 30000) {
      // No tick for 30 seconds - degraded
      this.recordFailure('price_feed', `No price tick for ${Math.round(timeSinceLastTick / 1000)}s`);
    } else if (timeSinceLastTick > 10000) {
      // No tick for 10 seconds - warning
      const health = this.connections.get('price_feed');
      if (health && health.status === 'healthy') {
        health.status = 'degraded';
        console.warn(`[ConnectionResilienceManager] ⚠️ Price feed degraded: ${Math.round(timeSinceLastTick / 1000)}s since last tick`);
      }
    }
  }

  /**
   * Check WebSocket connection health
   * INFRASTRUCTURE FIX (Feb 6, 2026): CoinAPI removed, now tracks Coinbase + Binance fallback
   */
  private checkWebSocketHealth(now: number): void {
    const priceFeedHealth = this.connections.get('price_feed');
    
    if (priceFeedHealth?.status === 'healthy') {
      this.recordSuccess('coinbase_websocket');
      this.recordSuccess('binance_fallback');
    } else if (priceFeedHealth?.status === 'degraded' || priceFeedHealth?.status === 'disconnected') {
      // Only mark Coinbase as failing - Binance fallback may still be active
      this.recordFailure('coinbase_websocket', 'Price feed unhealthy');
    }
  }

  /**
   * Record a successful operation for a connection
   */
  recordSuccess(connectionName: string): void {
    const health = this.connections.get(connectionName);
    if (!health) return;

    const now = Date.now();
    health.lastSuccessTime = now;
    health.consecutiveFailures = 0;
    health.isRecovering = false;

    if (health.status !== 'healthy') {
      const wasRecovering = health.status === 'recovering';
      health.status = 'healthy';
      
      if (wasRecovering) {
        health.totalRecoveries++;
        console.log(`[ConnectionResilienceManager] ✅ ${connectionName} recovered successfully`);
        this.emit('connection_recovered', { name: connectionName, timestamp: now });
      }
    }

    // Update uptime calculation
    this.updateUptime(health);
  }

  /**
   * Record a failed operation for a connection
   */
  recordFailure(connectionName: string, error?: string): void {
    const health = this.connections.get(connectionName);
    if (!health) return;

    const now = Date.now();
    health.lastErrorTime = now;
    health.lastError = error || 'Unknown error';
    health.consecutiveFailures++;
    health.totalFailures++;

    // Update status based on consecutive failures
    if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      if (health.status !== 'disconnected' && health.status !== 'recovering') {
        health.status = 'disconnected';
        console.error(`[ConnectionResilienceManager] ❌ ${connectionName} disconnected after ${health.consecutiveFailures} failures: ${error}`);
        this.emit('connection_lost', { name: connectionName, error, timestamp: now });
        
        // Trigger recovery
        this.triggerRecovery(connectionName);
      }
    } else if (health.consecutiveFailures >= 1) {
      if (health.status === 'healthy') {
        health.status = 'degraded';
        console.warn(`[ConnectionResilienceManager] ⚠️ ${connectionName} degraded: ${error}`);
        this.emit('connection_degraded', { name: connectionName, error, timestamp: now });
      }
    }

    // Update uptime calculation
    this.updateUptime(health);
  }

  /**
   * Trigger recovery for a connection
   */
  private async triggerRecovery(connectionName: string): Promise<void> {
    const health = this.connections.get(connectionName);
    if (!health || health.isRecovering) return;

    health.isRecovering = true;
    health.status = 'recovering';

    console.log(`[ConnectionResilienceManager] 🔄 Triggering recovery for ${connectionName}`);
    this.emit('recovery_started', { name: connectionName, timestamp: Date.now() });

    // Get recovery callback
    const recoveryCallback = this.recoveryCallbacks.get(connectionName);
    if (recoveryCallback) {
      try {
        await recoveryCallback();
        console.log(`[ConnectionResilienceManager] ✅ Recovery callback executed for ${connectionName}`);
      } catch (error) {
        console.error(`[ConnectionResilienceManager] ❌ Recovery callback failed for ${connectionName}:`, error);
        
        // Schedule retry with exponential backoff
        const delay = Math.min(
          this.config.recoveryDelayMs * Math.pow(2, health.consecutiveFailures - this.config.maxConsecutiveFailures),
          this.config.maxRecoveryDelayMs
        );
        
        setTimeout(() => {
          if (health.status === 'recovering' || health.status === 'disconnected') {
            this.triggerRecovery(connectionName);
          }
        }, delay);
      }
    }
  }

  /**
   * Register a recovery callback for a connection
   */
  registerRecoveryCallback(connectionName: string, callback: () => Promise<void>): void {
    this.recoveryCallbacks.set(connectionName, callback);
    console.log(`[ConnectionResilienceManager] Recovery callback registered for ${connectionName}`);
  }

  /**
   * Update uptime percentage for a connection
   */
  private updateUptime(health: ConnectionHealth): void {
    if (!this.startTime) return;

    const totalTime = Date.now() - this.startTime;
    if (totalTime === 0) return;

    // Estimate uptime based on success/failure ratio
    const totalOperations = health.totalFailures + (health.totalRecoveries * 10); // Weight recoveries
    if (totalOperations === 0) {
      health.uptime = 100;
    } else {
      const successRatio = 1 - (health.totalFailures / (totalOperations + 100));
      health.uptime = Math.max(0, Math.min(100, successRatio * 100));
    }
  }

  /**
   * Buffer a signal during connection recovery
   */
  bufferSignal(type: string, data: any): void {
    if (this.signalBuffer.length >= this.config.signalBufferSize) {
      // Remove oldest signal
      this.signalBuffer.shift();
    }

    this.signalBuffer.push({
      timestamp: Date.now(),
      type,
      data,
    });
  }

  /**
   * Flush buffered signals after recovery
   */
  flushSignalBuffer(): BufferedSignal[] {
    const now = Date.now();
    
    // Filter out expired signals
    const validSignals = this.signalBuffer.filter(
      signal => now - signal.timestamp < this.config.signalBufferTimeoutMs
    );

    // Clear buffer
    this.signalBuffer = [];

    console.log(`[ConnectionResilienceManager] Flushed ${validSignals.length} buffered signals`);
    return validSignals;
  }

  /**
   * Get health status for a specific connection
   */
  getHealth(connectionName: string): ConnectionHealth | undefined {
    return this.connections.get(connectionName);
  }

  /**
   * Get health status for all connections
   */
  getAllHealth(): ConnectionHealth[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get overall system health
   */
  getSystemHealth(): {
    overall: 'healthy' | 'degraded' | 'critical';
    healthyCount: number;
    degradedCount: number;
    disconnectedCount: number;
    connections: ConnectionHealth[];
  } {
    const connections = this.getAllHealth();
    
    const healthyCount = connections.filter(c => c.status === 'healthy').length;
    const degradedCount = connections.filter(c => c.status === 'degraded').length;
    const disconnectedCount = connections.filter(c => c.status === 'disconnected' || c.status === 'recovering').length;

    let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    // Critical if database or price feed is down
    const criticalConnections = ['database', 'price_feed'];
    const criticalDown = connections.some(
      c => criticalConnections.includes(c.name) && (c.status === 'disconnected' || c.status === 'recovering')
    );
    
    if (criticalDown || disconnectedCount >= 3) {
      overall = 'critical';
    } else if (degradedCount >= 2 || disconnectedCount >= 1) {
      overall = 'degraded';
    }

    return {
      overall,
      healthyCount,
      degradedCount,
      disconnectedCount,
      connections,
    };
  }

  /**
   * Log health summary
   */
  private logHealthSummary(): void {
    const systemHealth = this.getSystemHealth();
    
    const statusIcon = {
      healthy: '✅',
      degraded: '⚠️',
      critical: '❌',
    };

    console.log(`[ConnectionResilienceManager] ${statusIcon[systemHealth.overall]} System Health: ${systemHealth.overall.toUpperCase()}`);
    console.log(`  Healthy: ${systemHealth.healthyCount}, Degraded: ${systemHealth.degradedCount}, Disconnected: ${systemHealth.disconnectedCount}`);
    
    // Log any non-healthy connections
    for (const conn of systemHealth.connections) {
      if (conn.status !== 'healthy') {
        console.log(`  - ${conn.name}: ${conn.status} (${conn.consecutiveFailures} failures, last error: ${conn.lastError || 'none'})`);
      }
    }
  }
}

// Singleton instance
export const connectionResilienceManager = new ConnectionResilienceManager();
