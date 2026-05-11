/**
 * Exchange Failover Manager
 * 
 * Manages multi-exchange failover with automatic switching, health monitoring,
 * and order reconciliation across exchanges.
 * 
 * Key Features:
 * - Automatic exchange switching on failure
 * - Cross-exchange order reconciliation
 * - Real-time exchange health scoring
 * - API rate limit monitoring
 * - Order book depth monitoring
 * - Failover priority queue
 * - Connection pooling
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ExchangeConfig {
  id: string;
  name: string;
  priority: number;                    // Lower = higher priority
  enabled: boolean;
  maxRatePerSecond: number;
  maxConcurrentConnections: number;
  timeoutMs: number;
  retryAttempts: number;
  healthCheckIntervalMs: number;
}

export interface ExchangeHealth {
  exchangeId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  score: number;                       // 0-100
  latencyMs: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;                   // 0-1
  lastSuccessTime: number;
  lastErrorTime: number | null;
  lastError: string | null;
  consecutiveErrors: number;
  consecutiveSuccesses: number;
  rateLimitRemaining: number;
  rateLimitResetTime: number | null;
  orderBookDepth: number;
  spreadBps: number;                   // Spread in basis points
  uptime: number;                      // 0-1
}

export interface FailoverEvent {
  id: string;
  timestamp: number;
  fromExchange: string;
  toExchange: string;
  reason: string;
  symbol: string;
  orderType: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface OrderReconciliation {
  orderId: string;
  symbol: string;
  primaryExchange: string;
  backupExchange: string | null;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'failed' | 'reconciled';
  primaryStatus: string;
  backupStatus: string | null;
  discrepancy: boolean;
  discrepancyDetails?: string;
  lastChecked: number;
}

export interface FailoverManagerConfig {
  // Health thresholds
  healthyScoreThreshold: number;       // Score above this = healthy (default: 80)
  degradedScoreThreshold: number;      // Score above this = degraded (default: 50)
  
  // Failover triggers
  maxConsecutiveErrors: number;        // Errors before failover (default: 3)
  maxLatencyMs: number;                // Latency threshold for degraded (default: 1000)
  maxErrorRate: number;                // Error rate threshold (default: 0.1)
  
  // Rate limiting
  rateLimitBuffer: number;             // Buffer before hitting limit (default: 0.2)
  
  // Reconciliation
  reconciliationIntervalMs: number;    // Check interval (default: 5000)
  maxReconciliationAge: number;        // Max age before cleanup (default: 3600000)
  
  // Connection pooling
  minConnections: number;              // Min connections per exchange (default: 2)
  maxConnections: number;              // Max connections per exchange (default: 10)
  connectionIdleTimeoutMs: number;     // Idle timeout (default: 30000)
}

export interface ExchangeConnection {
  id: string;
  exchangeId: string;
  status: 'idle' | 'active' | 'error';
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
}

// ============================================================================
// Exchange Failover Manager
// ============================================================================

export class ExchangeFailoverManager extends EventEmitter {
  private config: FailoverManagerConfig;
  private exchanges: Map<string, ExchangeConfig> = new Map();
  private healthData: Map<string, ExchangeHealth> = new Map();
  private failoverEvents: FailoverEvent[] = [];
  private orderReconciliations: Map<string, OrderReconciliation> = new Map();
  private connectionPools: Map<string, ExchangeConnection[]> = new Map();
  private latencyHistory: Map<string, number[]> = new Map();
  private isActive: boolean = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private eventCounter: number = 0;

  // Statistics
  private stats: {
    totalFailovers: number;
    successfulFailovers: number;
    failedFailovers: number;
    totalRequests: number;
    totalErrors: number;
    reconciliationsMade: number;
    discrepanciesFound: number;
  } = {
    totalFailovers: 0,
    successfulFailovers: 0,
    failedFailovers: 0,
    totalRequests: 0,
    totalErrors: 0,
    reconciliationsMade: 0,
    discrepanciesFound: 0,
  };

  constructor(config?: Partial<FailoverManagerConfig>) {
    super();
    this.config = {
      healthyScoreThreshold: 80,
      degradedScoreThreshold: 50,
      maxConsecutiveErrors: 3,
      maxLatencyMs: 1000,
      maxErrorRate: 0.1,
      rateLimitBuffer: 0.2,
      reconciliationIntervalMs: 5000,
      maxReconciliationAge: 3600000,
      minConnections: 2,
      maxConnections: 10,
      connectionIdleTimeoutMs: 30000,
      ...config,
    };

    console.log('[ExchangeFailoverManager] Initialized');
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  start(): void {
    if (this.isActive) return;
    this.isActive = true;

    // Start health check loop
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, 5000);

    // Start reconciliation loop
    this.reconciliationInterval = setInterval(() => {
      this.runReconciliation();
    }, this.config.reconciliationIntervalMs);

    console.log('[ExchangeFailoverManager] Started');
    this.emit('manager_started', { timestamp: getActiveClock().now() });
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }

    console.log('[ExchangeFailoverManager] Stopped');
    this.emit('manager_stopped', { timestamp: getActiveClock().now() });
  }

  // ============================================================================
  // Exchange Registration
  // ============================================================================

  registerExchange(config: ExchangeConfig): void {
    this.exchanges.set(config.id, config);
    
    // Initialize health data
    this.healthData.set(config.id, {
      exchangeId: config.id,
      status: 'healthy',
      score: 100,
      latencyMs: 0,
      avgLatencyMs: 0,
      p99LatencyMs: 0,
      errorRate: 0,
      lastSuccessTime: getActiveClock().now(),
      lastErrorTime: null,
      lastError: null,
      consecutiveErrors: 0,
      consecutiveSuccesses: 0,
      rateLimitRemaining: config.maxRatePerSecond,
      rateLimitResetTime: null,
      orderBookDepth: 0,
      spreadBps: 0,
      uptime: 1,
    });

    // Initialize connection pool
    this.connectionPools.set(config.id, []);
    this.latencyHistory.set(config.id, []);

    // Pre-warm connection pool
    this.warmConnectionPool(config.id);

    console.log(`[ExchangeFailoverManager] Registered exchange: ${config.name} (priority: ${config.priority})`);
    this.emit('exchange_registered', { exchangeId: config.id, config });
  }

  unregisterExchange(exchangeId: string): void {
    this.exchanges.delete(exchangeId);
    this.healthData.delete(exchangeId);
    this.connectionPools.delete(exchangeId);
    this.latencyHistory.delete(exchangeId);
    
    console.log(`[ExchangeFailoverManager] Unregistered exchange: ${exchangeId}`);
    this.emit('exchange_unregistered', { exchangeId });
  }

  // ============================================================================
  // Exchange Selection & Failover
  // ============================================================================

  /**
   * Get the best available exchange for a request
   */
  getBestExchange(symbol?: string): { exchangeId: string; health: ExchangeHealth } | null {
    const availableExchanges = this.getAvailableExchanges();
    
    if (availableExchanges.length === 0) {
      console.warn('[ExchangeFailoverManager] No available exchanges');
      return null;
    }

    // Sort by priority and health score
    availableExchanges.sort((a, b) => {
      const configA = this.exchanges.get(a.exchangeId)!;
      const configB = this.exchanges.get(b.exchangeId)!;
      
      // First by status (healthy > degraded > unhealthy)
      const statusOrder = { healthy: 0, degraded: 1, unhealthy: 2, offline: 3 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      
      // Then by priority
      const priorityDiff = configA.priority - configB.priority;
      if (priorityDiff !== 0) return priorityDiff;
      
      // Finally by health score
      return b.score - a.score;
    });

    return {
      exchangeId: availableExchanges[0].exchangeId,
      health: availableExchanges[0],
    };
  }

  /**
   * Execute failover to next available exchange
   */
  async executeFailover(
    fromExchange: string,
    symbol: string,
    orderType: string,
    reason: string
  ): Promise<{ success: boolean; toExchange: string | null; error?: string }> {
    const startTime = performance.now();
    this.eventCounter++;

    // Get next available exchange
    const availableExchanges = this.getAvailableExchanges()
      .filter(h => h.exchangeId !== fromExchange);

    if (availableExchanges.length === 0) {
      const event: FailoverEvent = {
        id: `FO-${getActiveClock().now()}-${this.eventCounter}`,
        timestamp: getActiveClock().now(),
        fromExchange,
        toExchange: 'none',
        reason,
        symbol,
        orderType,
        latencyMs: performance.now() - startTime,
        success: false,
        error: 'No available exchanges for failover',
      };
      
      this.recordFailoverEvent(event);
      this.stats.failedFailovers++;
      
      return { success: false, toExchange: null, error: 'No available exchanges' };
    }

    // Select best alternative
    const toExchange = availableExchanges[0].exchangeId;
    const latencyMs = performance.now() - startTime;

    const event: FailoverEvent = {
      id: `FO-${getActiveClock().now()}-${this.eventCounter}`,
      timestamp: getActiveClock().now(),
      fromExchange,
      toExchange,
      reason,
      symbol,
      orderType,
      latencyMs,
      success: true,
    };

    this.recordFailoverEvent(event);
    this.stats.totalFailovers++;
    this.stats.successfulFailovers++;

    console.log(`[ExchangeFailoverManager] Failover: ${fromExchange} -> ${toExchange} (${reason})`);
    this.emit('failover_executed', event);

    return { success: true, toExchange };
  }

  private getAvailableExchanges(): ExchangeHealth[] {
    return Array.from(this.healthData.values())
      .filter(health => {
        const config = this.exchanges.get(health.exchangeId);
        return config?.enabled && health.status !== 'offline';
      });
  }

  // ============================================================================
  // Health Monitoring
  // ============================================================================

  /**
   * Record a successful request
   */
  recordSuccess(exchangeId: string, latencyMs: number): void {
    const health = this.healthData.get(exchangeId);
    if (!health) return;

    this.stats.totalRequests++;
    health.lastSuccessTime = getActiveClock().now();
    health.consecutiveSuccesses++;
    health.consecutiveErrors = 0;
    health.latencyMs = latencyMs;

    // Update latency history
    this.updateLatencyHistory(exchangeId, latencyMs);

    // Recalculate health score
    this.recalculateHealthScore(exchangeId);
  }

  /**
   * Record a failed request
   */
  recordError(exchangeId: string, error: string, latencyMs?: number): void {
    const health = this.healthData.get(exchangeId);
    if (!health) return;

    this.stats.totalRequests++;
    this.stats.totalErrors++;
    health.lastErrorTime = getActiveClock().now();
    health.lastError = error;
    health.consecutiveErrors++;
    health.consecutiveSuccesses = 0;

    if (latencyMs !== undefined) {
      health.latencyMs = latencyMs;
      this.updateLatencyHistory(exchangeId, latencyMs);
    }

    // Recalculate health score
    this.recalculateHealthScore(exchangeId);

    // Check if failover is needed
    if (health.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      this.emit('exchange_unhealthy', { exchangeId, health, reason: 'consecutive_errors' });
    }
  }

  /**
   * Update rate limit information
   */
  updateRateLimit(exchangeId: string, remaining: number, resetTime: number): void {
    const health = this.healthData.get(exchangeId);
    if (!health) return;

    health.rateLimitRemaining = remaining;
    health.rateLimitResetTime = resetTime;

    // Check if approaching rate limit
    const config = this.exchanges.get(exchangeId);
    if (config && remaining < config.maxRatePerSecond * this.config.rateLimitBuffer) {
      this.emit('rate_limit_warning', { exchangeId, remaining, resetTime });
    }
  }

  /**
   * Update order book depth
   */
  updateOrderBookDepth(exchangeId: string, depth: number, spreadBps: number): void {
    const health = this.healthData.get(exchangeId);
    if (!health) return;

    health.orderBookDepth = depth;
    health.spreadBps = spreadBps;
  }

  private updateLatencyHistory(exchangeId: string, latencyMs: number): void {
    const history = this.latencyHistory.get(exchangeId) || [];
    history.push(latencyMs);
    
    // Keep last 100 samples
    if (history.length > 100) {
      history.shift();
    }
    
    this.latencyHistory.set(exchangeId, history);

    // Update avg and p99
    const health = this.healthData.get(exchangeId);
    if (health && history.length > 0) {
      health.avgLatencyMs = history.reduce((a, b) => a + b, 0) / history.length;
      
      const sorted = [...history].sort((a, b) => a - b);
      const p99Index = Math.floor(sorted.length * 0.99);
      health.p99LatencyMs = sorted[p99Index] || sorted[sorted.length - 1];
    }
  }

  private recalculateHealthScore(exchangeId: string): void {
    const health = this.healthData.get(exchangeId);
    const config = this.exchanges.get(exchangeId);
    if (!health || !config) return;

    let score = 100;

    // Latency penalty (up to -30 points)
    if (health.avgLatencyMs > this.config.maxLatencyMs) {
      score -= 30;
    } else if (health.avgLatencyMs > this.config.maxLatencyMs * 0.5) {
      score -= 15;
    }

    // Error rate penalty (up to -40 points)
    const errorRate = this.stats.totalRequests > 0 
      ? this.stats.totalErrors / this.stats.totalRequests 
      : 0;
    health.errorRate = errorRate;
    
    if (errorRate > this.config.maxErrorRate) {
      score -= 40;
    } else if (errorRate > this.config.maxErrorRate * 0.5) {
      score -= 20;
    }

    // Consecutive errors penalty (up to -20 points)
    score -= Math.min(20, health.consecutiveErrors * 5);

    // Rate limit penalty (up to -10 points)
    const rateLimitUsage = 1 - (health.rateLimitRemaining / config.maxRatePerSecond);
    if (rateLimitUsage > 0.8) {
      score -= 10;
    } else if (rateLimitUsage > 0.5) {
      score -= 5;
    }

    health.score = Math.max(0, Math.min(100, score));

    // Update status
    if (health.score >= this.config.healthyScoreThreshold) {
      health.status = 'healthy';
    } else if (health.score >= this.config.degradedScoreThreshold) {
      health.status = 'degraded';
    } else if (health.score > 0) {
      health.status = 'unhealthy';
    } else {
      health.status = 'offline';
    }
  }

  private runHealthChecks(): void {
    for (const [exchangeId, health] of this.healthData) {
      // Check for stale data
      const timeSinceSuccess = getActiveClock().now() - health.lastSuccessTime;
      if (timeSinceSuccess > 60000) {
        health.status = 'unhealthy';
        health.score = Math.max(0, health.score - 10);
      }

      // Update uptime
      const config = this.exchanges.get(exchangeId);
      if (config) {
        const totalTime = getActiveClock().now() - (health.lastSuccessTime - timeSinceSuccess);
        health.uptime = Math.max(0, 1 - (timeSinceSuccess / totalTime));
      }
    }
  }

  // ============================================================================
  // Order Reconciliation
  // ============================================================================

  /**
   * Register an order for reconciliation tracking
   */
  registerOrder(
    orderId: string,
    symbol: string,
    primaryExchange: string,
    backupExchange?: string
  ): void {
    this.orderReconciliations.set(orderId, {
      orderId,
      symbol,
      primaryExchange,
      backupExchange: backupExchange || null,
      status: 'pending',
      primaryStatus: 'pending',
      backupStatus: backupExchange ? 'pending' : null,
      discrepancy: false,
      lastChecked: getActiveClock().now(),
    });
  }

  /**
   * Update order status from an exchange
   */
  updateOrderStatus(
    orderId: string,
    exchangeId: string,
    status: string
  ): void {
    const reconciliation = this.orderReconciliations.get(orderId);
    if (!reconciliation) return;

    if (exchangeId === reconciliation.primaryExchange) {
      reconciliation.primaryStatus = status;
    } else if (exchangeId === reconciliation.backupExchange) {
      reconciliation.backupStatus = status;
    }

    reconciliation.lastChecked = getActiveClock().now();

    // Check for discrepancies
    this.checkOrderDiscrepancy(orderId);
  }

  private checkOrderDiscrepancy(orderId: string): void {
    const reconciliation = this.orderReconciliations.get(orderId);
    if (!reconciliation || !reconciliation.backupExchange) return;

    // Check if statuses match
    if (reconciliation.primaryStatus !== reconciliation.backupStatus) {
      reconciliation.discrepancy = true;
      reconciliation.discrepancyDetails = 
        `Primary: ${reconciliation.primaryStatus}, Backup: ${reconciliation.backupStatus}`;
      
      this.stats.discrepanciesFound++;
      this.emit('order_discrepancy', reconciliation);
    }
  }

  private runReconciliation(): void {
    const now = getActiveClock().now();
    
    for (const [orderId, reconciliation] of this.orderReconciliations) {
      // Clean up old reconciliations
      if (now - reconciliation.lastChecked > this.config.maxReconciliationAge) {
        this.orderReconciliations.delete(orderId);
        continue;
      }

      // Mark as reconciled if both match and are final
      const finalStatuses = ['filled', 'cancelled', 'failed'];
      if (
        finalStatuses.includes(reconciliation.primaryStatus) &&
        (!reconciliation.backupExchange || 
         reconciliation.primaryStatus === reconciliation.backupStatus)
      ) {
        reconciliation.status = 'reconciled';
        this.stats.reconciliationsMade++;
      }
    }
  }

  // ============================================================================
  // Connection Pooling
  // ============================================================================

  private warmConnectionPool(exchangeId: string): void {
    const config = this.exchanges.get(exchangeId);
    if (!config) return;

    const pool = this.connectionPools.get(exchangeId) || [];
    
    while (pool.length < this.config.minConnections) {
      pool.push({
        id: `${exchangeId}-conn-${getActiveClock().now()}-${pool.length}`,
        exchangeId,
        status: 'idle',
        createdAt: getActiveClock().now(),
        lastUsedAt: getActiveClock().now(),
        requestCount: 0,
      });
    }

    this.connectionPools.set(exchangeId, pool);
  }

  /**
   * Get an available connection from the pool
   */
  getConnection(exchangeId: string): ExchangeConnection | null {
    const pool = this.connectionPools.get(exchangeId);
    if (!pool) return null;

    // Find idle connection
    const idleConnection = pool.find(c => c.status === 'idle');
    if (idleConnection) {
      idleConnection.status = 'active';
      idleConnection.lastUsedAt = getActiveClock().now();
      idleConnection.requestCount++;
      return idleConnection;
    }

    // Create new connection if under limit
    const config = this.exchanges.get(exchangeId);
    if (config && pool.length < this.config.maxConnections) {
      const newConnection: ExchangeConnection = {
        id: `${exchangeId}-conn-${getActiveClock().now()}-${pool.length}`,
        exchangeId,
        status: 'active',
        createdAt: getActiveClock().now(),
        lastUsedAt: getActiveClock().now(),
        requestCount: 1,
      };
      pool.push(newConnection);
      return newConnection;
    }

    return null;
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connectionId: string): void {
    for (const pool of this.connectionPools.values()) {
      const connection = pool.find(c => c.id === connectionId);
      if (connection) {
        connection.status = 'idle';
        connection.lastUsedAt = getActiveClock().now();
        return;
      }
    }
  }

  // ============================================================================
  // Status & Reporting
  // ============================================================================

  private recordFailoverEvent(event: FailoverEvent): void {
    this.failoverEvents.push(event);
    if (this.failoverEvents.length > 1000) {
      this.failoverEvents = this.failoverEvents.slice(-500);
    }
  }

  getStatus(): {
    isActive: boolean;
    exchanges: Array<{ config: ExchangeConfig; health: ExchangeHealth }>;
    stats: {
      totalFailovers: number;
      successfulFailovers: number;
      failedFailovers: number;
      totalRequests: number;
      totalErrors: number;
      reconciliationsMade: number;
      discrepanciesFound: number;
    };
    recentFailovers: FailoverEvent[];
    pendingReconciliations: number;
  } {
    const exchanges = Array.from(this.exchanges.entries()).map(([id, config]) => ({
      config,
      health: this.healthData.get(id)!,
    }));

    const pendingReconciliations = Array.from(this.orderReconciliations.values())
      .filter(r => r.status === 'pending').length;

    return {
      isActive: this.isActive,
      exchanges,
      stats: { ...this.stats },
      recentFailovers: this.failoverEvents.slice(-20),
      pendingReconciliations,
    };
  }

  getExchangeHealth(exchangeId: string): ExchangeHealth | undefined {
    return this.healthData.get(exchangeId);
  }

  getAllHealth(): ExchangeHealth[] {
    return Array.from(this.healthData.values());
  }

  getConfig(): FailoverManagerConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<FailoverManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[ExchangeFailoverManager] Configuration updated');
    this.emit('config_updated', this.config);
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.exchanges.clear();
    this.healthData.clear();
    this.failoverEvents = [];
    this.orderReconciliations.clear();
    this.connectionPools.clear();
    this.latencyHistory.clear();
    this.stats = {
      totalFailovers: 0,
      successfulFailovers: 0,
      failedFailovers: 0,
      totalRequests: 0,
      totalErrors: 0,
      reconciliationsMade: 0,
      discrepanciesFound: 0,
    };
    console.log('[ExchangeFailoverManager] Reset complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let failoverManagerInstance: ExchangeFailoverManager | null = null;

export function getExchangeFailoverManager(config?: Partial<FailoverManagerConfig>): ExchangeFailoverManager {
  if (!failoverManagerInstance) {
    failoverManagerInstance = new ExchangeFailoverManager(config);
  }
  return failoverManagerInstance;
}

export function resetExchangeFailoverManager(): void {
  if (failoverManagerInstance) {
    failoverManagerInstance.stop();
    failoverManagerInstance = null;
  }
}
