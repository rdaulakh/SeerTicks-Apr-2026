/**
 * Monitoring Service
 * Collects and aggregates system, trading, and performance metrics
 */

import * as si from 'systeminformation';
import { getActiveClock } from '../_core/clock';

export interface SystemMetrics {
  cpu: {
    usage: number; // CPU usage percentage
    cores: number;
    speed: number; // GHz
  };
  memory: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercent: number;
  };
  disk: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercent: number;
  };
  uptime: number; // seconds
  timestamp: Date;
}

export interface TradingMetrics {
  activePositions: number;
  totalPositions: number;
  ordersPerMinute: number;
  totalPnL: number;
  winRate: number;
  averageHoldTime: number; // seconds
  timestamp: Date;
}

export interface WebSocketMetrics {
  activeConnections: number;
  messagesPerSecond: number;
  totalMessages: number;
  errors: number;
  timestamp: Date;
}

export interface DatabaseMetrics {
  activeConnections: number;
  queryTime: number; // average ms
  slowQueries: number;
  errors: number;
  timestamp: Date;
}

export interface APIMetrics {
  requestsPerMinute: number;
  averageResponseTime: number; // ms
  errorRate: number; // percentage
  activeRequests: number;
  totalRequests: number;
  timestamp: Date;
}

export interface MonitoringSnapshot {
  system: SystemMetrics;
  trading: TradingMetrics;
  websocket: WebSocketMetrics;
  database: DatabaseMetrics;
  api: APIMetrics;
  timestamp: Date;
}

class MonitoringService {
  private systemMetricsHistory: SystemMetrics[] = [];
  private tradingMetricsHistory: TradingMetrics[] = [];
  private wsMetricsHistory: WebSocketMetrics[] = [];
  private dbMetricsHistory: DatabaseMetrics[] = [];
  private apiMetricsHistory: APIMetrics[] = [];
  
  private maxHistorySize = 1000; // Keep last 1000 snapshots
  private collectionInterval: NodeJS.Timeout | null = null;
  
  // API metrics tracking
  private apiRequestCount = 0;
  private apiResponseTimes: number[] = [];
  private apiErrors = 0;
  private apiActiveRequests = 0;
  private lastApiMetricsReset = getActiveClock().now();
  
  // Order tracking ring buffer (timestamps of orders in last 60s)
  private orderTimestamps: number[] = [];

  // WebSocket metrics tracking
  private wsConnections = 0;
  private wsMessageCount = 0;
  private wsErrors = 0;
  private lastWsMetricsReset = getActiveClock().now();

  constructor() {
    // Start collecting metrics every 5 seconds
    this.startCollection();
  }

  /**
   * Start automatic metrics collection
   */
  startCollection() {
    if (this.collectionInterval) {
      return;
    }

    this.collectionInterval = setInterval(async () => {
      try {
        await this.collectSystemMetrics();
        await this.collectTradingMetrics();
        await this.collectWebSocketMetrics();
        await this.collectDatabaseMetrics();
        await this.collectAPIMetrics();
      } catch (error) {
        console.error('[MonitoringService] Error collecting metrics:', error);
      }
    }, 5000); // Collect every 5 seconds

    console.log('[MonitoringService] Started metrics collection');
  }

  /**
   * Stop automatic metrics collection
   */
  stopCollection() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      console.log('[MonitoringService] Stopped metrics collection');
    }
  }

  /**
   * Collect system metrics (CPU, memory, disk)
   */
  private async collectSystemMetrics() {
    try {
      const [cpu, mem, disk, time] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.time(),
      ]);

      const metrics: SystemMetrics = {
        cpu: {
          usage: cpu.currentLoad,
          cores: cpu.cpus?.length || 0,
          speed: 0, // Speed not available in currentLoad
        },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          usagePercent: (mem.used / mem.total) * 100,
        },
        disk: {
          total: disk[0]?.size || 0,
          used: disk[0]?.used || 0,
          free: disk[0]?.available || 0,
          usagePercent: disk[0]?.use || 0,
        },
        uptime: time.uptime,
        timestamp: new Date(),
      };

      this.addToHistory(this.systemMetricsHistory, metrics);
    } catch (error) {
      console.error('[MonitoringService] Error collecting system metrics:', error);
    }
  }

  /**
   * Collect trading metrics
   */
  private async collectTradingMetrics() {
    try {
      // Query positions from database
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) {
        return;
      }
      const { positions: positionsTable } = await import('../../drizzle/schema');
      const positions = await db.select().from(positionsTable);
      
      const activePositions = positions.filter((p: any) => p.status === 'open').length;
      const closedPositions = positions.filter((p: any) => p.status === 'closed');
      
      const totalPnL = closedPositions.reduce((sum: number, p: any) => sum + (p.realizedPnl || 0), 0);
      const winningTrades = closedPositions.filter((p: any) => (p.realizedPnl || 0) > 0).length;
      const winRate = closedPositions.length > 0 ? (winningTrades / closedPositions.length) * 100 : 0;
      
      const avgHoldTime = closedPositions.length > 0
        ? closedPositions.reduce((sum: number, p: any) => {
            const entryTime = new Date(p.entryTime).getTime();
            const exitTime = p.exitTime ? new Date(p.exitTime).getTime() : getActiveClock().now();
            return sum + (exitTime - entryTime);
          }, 0) / closedPositions.length / 1000
        : 0;

      const metrics: TradingMetrics = {
        activePositions,
        totalPositions: positions.length,
        ordersPerMinute: this.getOrdersPerMinute(),
        totalPnL,
        winRate,
        averageHoldTime: avgHoldTime,
        timestamp: new Date(),
      };

      this.addToHistory(this.tradingMetricsHistory, metrics);
    } catch (error) {
      console.error('[MonitoringService] Error collecting trading metrics:', error);
    }
  }

  /**
   * Collect WebSocket metrics
   */
  private async collectWebSocketMetrics() {
    const now = getActiveClock().now();
    const timeSinceReset = (now - this.lastWsMetricsReset) / 1000; // seconds

    const metrics: WebSocketMetrics = {
      activeConnections: this.wsConnections,
      messagesPerSecond: timeSinceReset > 0 ? this.wsMessageCount / timeSinceReset : 0,
      totalMessages: this.wsMessageCount,
      errors: this.wsErrors,
      timestamp: new Date(),
    };

    this.addToHistory(this.wsMetricsHistory, metrics);
    
    // Reset counters every minute
    if (timeSinceReset > 60) {
      this.wsMessageCount = 0;
      this.wsErrors = 0;
      this.lastWsMetricsReset = now;
    }
  }

  /**
   * Collect database metrics
   */
  private async collectDatabaseMetrics() {
    // TODO: Implement database metrics collection
    // This would require hooking into Drizzle ORM or MySQL connection pool
    const metrics: DatabaseMetrics = {
      activeConnections: 0,
      queryTime: 0,
      slowQueries: 0,
      errors: 0,
      timestamp: new Date(),
    };

    this.addToHistory(this.dbMetricsHistory, metrics);
  }

  /**
   * Collect API metrics
   */
  private async collectAPIMetrics() {
    const now = getActiveClock().now();
    const timeSinceReset = (now - this.lastApiMetricsReset) / 1000; // seconds

    const avgResponseTime = this.apiResponseTimes.length > 0
      ? this.apiResponseTimes.reduce((sum, t) => sum + t, 0) / this.apiResponseTimes.length
      : 0;

    const errorRate = this.apiRequestCount > 0
      ? (this.apiErrors / this.apiRequestCount) * 100
      : 0;

    const metrics: APIMetrics = {
      requestsPerMinute: timeSinceReset > 0 ? (this.apiRequestCount / timeSinceReset) * 60 : 0,
      averageResponseTime: avgResponseTime,
      errorRate,
      activeRequests: this.apiActiveRequests,
      totalRequests: this.apiRequestCount,
      timestamp: new Date(),
    };

    this.addToHistory(this.apiMetricsHistory, metrics);
    
    // Reset counters every minute
    if (timeSinceReset > 60) {
      this.apiRequestCount = 0;
      this.apiResponseTimes = [];
      this.apiErrors = 0;
      this.lastApiMetricsReset = now;
    }
  }

  /**
   * Add metrics to history with size limit
   */
  private addToHistory<T>(history: T[], metrics: T) {
    history.push(metrics);
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * Get current monitoring snapshot
   */
  async getCurrentSnapshot(): Promise<MonitoringSnapshot> {
    const latest = {
      system: this.systemMetricsHistory[this.systemMetricsHistory.length - 1] || await this.getDefaultSystemMetrics(),
      trading: this.tradingMetricsHistory[this.tradingMetricsHistory.length - 1] || this.getDefaultTradingMetrics(),
      websocket: this.wsMetricsHistory[this.wsMetricsHistory.length - 1] || this.getDefaultWebSocketMetrics(),
      database: this.dbMetricsHistory[this.dbMetricsHistory.length - 1] || this.getDefaultDatabaseMetrics(),
      api: this.apiMetricsHistory[this.apiMetricsHistory.length - 1] || this.getDefaultAPIMetrics(),
      timestamp: new Date(),
    };

    return latest;
  }

  /**
   * Get metrics history for a time window
   */
  getHistory(windowMs: number = 300000): MonitoringSnapshot[] {
    const cutoff = getActiveClock().now() - windowMs;
    const snapshots: MonitoringSnapshot[] = [];

    // Find the minimum length to avoid index errors
    const minLength = Math.min(
      this.systemMetricsHistory.length,
      this.tradingMetricsHistory.length,
      this.wsMetricsHistory.length,
      this.dbMetricsHistory.length,
      this.apiMetricsHistory.length
    );

    for (let i = 0; i < minLength; i++) {
      const timestamp = this.systemMetricsHistory[i].timestamp.getTime();
      if (timestamp >= cutoff) {
        snapshots.push({
          system: this.systemMetricsHistory[i],
          trading: this.tradingMetricsHistory[i],
          websocket: this.wsMetricsHistory[i],
          database: this.dbMetricsHistory[i],
          api: this.apiMetricsHistory[i],
          timestamp: new Date(timestamp),
        });
      }
    }

    return snapshots;
  }

  /**
   * Track API request
   */
  trackAPIRequest(responseTime: number, isError: boolean = false) {
    this.apiRequestCount++;
    this.apiResponseTimes.push(responseTime);
    if (isError) {
      this.apiErrors++;
    }
  }

  /**
   * Track API request start
   */
  startAPIRequest() {
    this.apiActiveRequests++;
  }

  /**
   * Track API request end
   */
  endAPIRequest() {
    this.apiActiveRequests = Math.max(0, this.apiActiveRequests - 1);
  }

  /**
   * Track WebSocket connection
   */
  trackWSConnection(connected: boolean) {
    if (connected) {
      this.wsConnections++;
    } else {
      this.wsConnections = Math.max(0, this.wsConnections - 1);
    }
  }

  /**
   * Track WebSocket message
   */
  trackWSMessage() {
    this.wsMessageCount++;
  }

  /**
   * Track WebSocket error
   */
  trackWSError() {
    this.wsErrors++;
  }

  /**
   * Record an order execution timestamp for orders-per-minute tracking
   */
  recordOrder() {
    this.orderTimestamps.push(getActiveClock().now());
    // Prune entries older than 60 seconds to keep the buffer bounded
    this.pruneOrderTimestamps();
  }

  /**
   * Get the number of orders placed in the last 60 seconds
   */
  private getOrdersPerMinute(): number {
    this.pruneOrderTimestamps();
    return this.orderTimestamps.length;
  }

  /**
   * Remove order timestamps older than 60 seconds
   */
  private pruneOrderTimestamps() {
    const cutoff = getActiveClock().now() - 60_000;
    // Find the first index that is within the window
    let firstValid = 0;
    while (firstValid < this.orderTimestamps.length && this.orderTimestamps[firstValid] < cutoff) {
      firstValid++;
    }
    if (firstValid > 0) {
      this.orderTimestamps = this.orderTimestamps.slice(firstValid);
    }
  }

  /**
   * Default metrics for when no data is available
   */
  private async getDefaultSystemMetrics(): Promise<SystemMetrics> {
    return {
      cpu: { usage: 0, cores: 0, speed: 0 },
      memory: { total: 0, used: 0, free: 0, usagePercent: 0 },
      disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
      uptime: 0,
      timestamp: new Date(),
    };
  }

  private getDefaultTradingMetrics(): TradingMetrics {
    return {
      activePositions: 0,
      totalPositions: 0,
      ordersPerMinute: 0,
      totalPnL: 0,
      winRate: 0,
      averageHoldTime: 0,
      timestamp: new Date(),
    };
  }

  private getDefaultWebSocketMetrics(): WebSocketMetrics {
    return {
      activeConnections: 0,
      messagesPerSecond: 0,
      totalMessages: 0,
      errors: 0,
      timestamp: new Date(),
    };
  }

  private getDefaultDatabaseMetrics(): DatabaseMetrics {
    return {
      activeConnections: 0,
      queryTime: 0,
      slowQueries: 0,
      errors: 0,
      timestamp: new Date(),
    };
  }

  private getDefaultAPIMetrics(): APIMetrics {
    return {
      requestsPerMinute: 0,
      averageResponseTime: 0,
      errorRate: 0,
      activeRequests: 0,
      totalRequests: 0,
      timestamp: new Date(),
    };
  }
}

// Singleton instance
const monitoringService = new MonitoringService();

export { monitoringService, MonitoringService };
