/**
 * Health Check Router
 * Endpoints for monitoring service health
 */

import { z } from 'zod';
import { getActiveClock } from '../_core/clock';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import { monitoringService } from '../services/MonitoringService';
import { externalAPIRateLimiter } from '../services/ExternalAPIRateLimiter';
import { wsHealthMonitor } from '../monitoring/WebSocketHealthMonitor';
import { priceFeedService } from '../services/priceFeedService';

// Track server start time
const serverStartTime = getActiveClock().now();

// Global health state (updated by services)
export const healthState = {
  websocket: {
    connected: false,
    lastPing: 0,
    provider: 'unknown',
  },
  priceFeed: {
    connected: false,
    lastTick: 0,
    tickCount: 0,
    latency: 0,
  },
  agents: {
    active: 0,
    total: 12, // FIX: Was 8, actually 12 agents (3 FAST + 4 SLOW + 5 PHASE2)
    lastSignal: 0,
  },
  database: {
    connected: false,
    lastQuery: 0,
  },
};

// Export function to update health state from other services
// Phase 42: Removed per-tick JSON.stringify logging — was creating 21,600 string objects/hour
let healthUpdateCount = 0;
export function updateHealthState(service: keyof typeof healthState, data: Partial<typeof healthState[keyof typeof healthState]>) {
  healthState[service] = { ...healthState[service], ...data } as any;
  healthUpdateCount++;
  // Only log every 1000th update to reduce string allocation pressure
  if (healthUpdateCount % 1000 === 0) {
    console.log(`[HealthState] ${service} updated (${healthUpdateCount} total updates)`);
  }
}

// Format uptime to human readable
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Format timestamp to IST
function formatToIST(date: Date): string {
  return date.toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export const healthRouter = router({
  /**
   * Quick ping endpoint (public) for health monitoring
   */
  ping: publicProcedure.query(() => {
    return {
      status: 'ok',
      timestamp: formatToIST(new Date()),
      uptime: formatUptime(getActiveClock().now() - serverStartTime),
    };
  }),

  /**
   * Get comprehensive service status (public)
   */
  getServiceStatus: publicProcedure.query(() => {
    const now = getActiveClock().now();
    const uptime = now - serverStartTime;
    
    // Determine overall status
    // All services are REQUIRED for healthy status:
    // - websocket: Real-time price data
    // - priceFeed: Price tick processing
    // - database: Data persistence
    // - agents: Signal generation (CRITICAL for trading)
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const wsOk = healthState.websocket.connected;
    const priceOk = healthState.priceFeed.connected;
    const dbOk = healthState.database.connected;
    const agentsOk = healthState.agents.active > 0; // REQUIRED - agents generate trading signals
    
    // All services must be up for healthy status
    const allServicesUp = [wsOk, priceOk, dbOk, agentsOk];
    const servicesDown = allServicesUp.filter(x => !x).length;
    if (servicesDown >= 2) overallStatus = 'unhealthy';
    else if (servicesDown >= 1) overallStatus = 'degraded';
    
    const memUsage = process.memoryUsage();
    
    return {
      status: overallStatus,
      uptime,
      uptimeFormatted: formatUptime(uptime),
      timestampIST: formatToIST(new Date()),
      services: {
        websocket: {
          status: wsOk ? 'up' : 'down',
          provider: healthState.websocket.provider,
          lastPing: healthState.websocket.lastPing > 0 ? formatToIST(new Date(healthState.websocket.lastPing)) : null,
        },
        priceFeed: {
          status: priceOk ? 'up' : 'down',
          tickCount: healthState.priceFeed.tickCount,
          latency: healthState.priceFeed.latency,
          lastTick: healthState.priceFeed.lastTick > 0 ? formatToIST(new Date(healthState.priceFeed.lastTick)) : null,
        },
        agents: {
          status: agentsOk ? 'up' : 'down',
          active: healthState.agents.active,
          total: healthState.agents.total,
          lastSignal: healthState.agents.lastSignal > 0 ? formatToIST(new Date(healthState.agents.lastSignal)) : null,
        },
        database: {
          status: dbOk ? 'up' : 'down',
          lastQuery: healthState.database.lastQuery > 0 ? formatToIST(new Date(healthState.database.lastQuery)) : null,
        },
      },
      metrics: {
        memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
    };
  }),

  /**
   * Basic health check
   * Returns 200 if server is running
   */
  basic: protectedProcedure.query(() => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }),

  /**
   * Detailed health check
   * Returns comprehensive system health information
   */
  detailed: protectedProcedure.query(async () => {
    const snapshot = await monitoringService.getCurrentSnapshot();
    
    const isHealthy = 
      snapshot.system.cpu.usage < 80 &&
      snapshot.system.memory.usagePercent < 85 &&
      snapshot.system.disk.usagePercent < 90 &&
      snapshot.api.errorRate < 5;

    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        cpu: {
          status: snapshot.system.cpu.usage < 80 ? 'pass' : 'fail',
          usage: snapshot.system.cpu.usage,
          threshold: 80,
        },
        memory: {
          status: snapshot.system.memory.usagePercent < 85 ? 'pass' : 'fail',
          usage: snapshot.system.memory.usagePercent,
          threshold: 85,
        },
        disk: {
          status: snapshot.system.disk.usagePercent < 90 ? 'pass' : 'fail',
          usage: snapshot.system.disk.usagePercent,
          threshold: 90,
        },
        api: {
          status: snapshot.api.errorRate < 5 ? 'pass' : 'fail',
          errorRate: snapshot.api.errorRate,
          threshold: 5,
        },
      },
      metrics: snapshot,
    };
  }),

  /**
   * Readiness check
   * Returns 200 when service is ready to accept traffic
   */
  ready: protectedProcedure.query(async () => {
    // Check if critical services are available
    const { getDb } = await import('../db');
    const db = await getDb();
    
    const checks = {
      database: !!db,
      // Add more readiness checks as needed
    };

    const isReady = Object.values(checks).every(check => check === true);

    return {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    };
  }),

  /**
   * Liveness check
   * Returns 200 if service is alive (even if degraded)
   */
  alive: protectedProcedure.query(() => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    };
  }),

  /**
   * Get current service health status
   * Returns health status for all monitored services
   */
  getServiceHealth: protectedProcedure.query(async () => {
    const { getDb } = await import('../db');
    const { serviceHealth } = await import('../../drizzle/schema');
    const db = await getDb();
    
    if (!db) {
      return { services: [] };
    }

    const services = await db.select().from(serviceHealth);
    return { services };
  }),

  /**
   * Get latest startup log
   * Returns the most recent system startup attempt and results
   */
  getLatestStartup: protectedProcedure.query(async () => {
    const { getDb } = await import('../db');
    const { systemStartupLog } = await import('../../drizzle/schema');
    const { desc } = await import('drizzle-orm');
    const db = await getDb();
    
    if (!db) {
      return null;
    }

    const logs = await db.select().from(systemStartupLog).orderBy(desc(systemStartupLog.startedAt)).limit(1);
    return logs.length > 0 ? logs[0] : null;
  }),

  /**
   * Get startup history
   * Returns recent startup attempts for trend analysis
   */
  getStartupHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(10),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import('../db');
      const { systemStartupLog } = await import('../../drizzle/schema');
      const { desc } = await import('drizzle-orm');
      const db = await getDb();
      
      if (!db) {
        return { logs: [] };
      }

      const logs = await db.select().from(systemStartupLog).orderBy(desc(systemStartupLog.startedAt)).limit(input.limit);
      return { logs };
    }),

  /**
   * Run health checks manually
   * Triggers a new health check cycle and returns results
   */
  runHealthCheck: protectedProcedure.mutation(async () => {
    const { runStartupHealthChecks } = await import('../services/StartupHealthCheck');
    const result = await runStartupHealthChecks();
    return result;
  }),

  /**
   * Get execution latency metrics
   * Shows latency statistics for the signal-to-trade pipeline
   */
  getLatencyMetrics: protectedProcedure
    .input(z.object({
      hours: z.number().min(1).max(168).default(24),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { getLatencyMetrics, getRecentLatencyLogs } = await import('../db');
      const hours = input?.hours || 24;
      
      const metrics = await getLatencyMetrics(ctx.user.id, hours);
      const recentLogs = await getRecentLatencyLogs(ctx.user.id, 20);
      
      // Calculate execution rate
      const executionRate = metrics.totalExecutions > 0 
        ? ((metrics.executedCount / metrics.totalExecutions) * 100).toFixed(1)
        : '0.0';
      
      // Calculate latency grade distribution
      const gradeDistribution = {
        excellent: metrics.excellentCount,
        good: metrics.goodCount,
        acceptable: metrics.acceptableCount,
        slow: metrics.slowCount,
        critical: metrics.criticalCount,
      };
      
      return {
        timestampIST: formatToIST(new Date()),
        periodHours: hours,
        summary: {
          avgLatencyMs: Math.round(metrics.avgLatencyMs),
          p50LatencyMs: metrics.p50LatencyMs,
          p95LatencyMs: metrics.p95LatencyMs,
          p99LatencyMs: metrics.p99LatencyMs,
          minLatencyMs: metrics.minLatencyMs,
          maxLatencyMs: metrics.maxLatencyMs,
        },
        execution: {
          totalSignals: metrics.totalExecutions,
          executed: metrics.executedCount,
          rejected: metrics.rejectedCount,
          skipped: metrics.skippedCount,
          failed: metrics.failedCount,
          executionRate: `${executionRate}%`,
        },
        gradeDistribution,
        recentLogs: recentLogs.map((log: any) => ({
          signalId: log.signalId,
          symbol: log.symbol,
          totalLatencyMs: log.totalLatencyMs,
          latencyGrade: log.latencyGrade,
          executionResult: log.executionResult,
          createdAt: formatToIST(new Date(log.createdAt)),
        })),
      };
    }),

  /**
   * Get ML Integration Service status
   * Shows RL training, optimization, and prediction status
   */
  getMLStatus: protectedProcedure.query(async () => {
    try {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const mlService = getMLIntegrationService();
      return mlService.getStatus();
    } catch (error) {
      return {
        isInitialized: false,
        rlTraining: {
          isTraining: false,
          currentAgent: null,
          progress: null,
          lastTrainingResult: null,
          trainingHistory: []
        },
        optimization: {
          isRunning: false,
          schedules: [],
          recentHistory: []
        },
        mlPrediction: {
          isEnabled: false,
          accuracy: { correct: 0, total: 0, rate: 0 }
        }
      };
    }
  }),

  /**
   * Start RL agent training
   */
  startRLTraining: protectedProcedure
    .input(z.object({
      symbol: z.string().default('BTC-USD'),
      agentType: z.enum(['dqn', 'ppo', 'both']).default('both'),
      episodes: z.number().min(10).max(1000).default(100),
    }))
    .mutation(async ({ input }) => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const mlService = getMLIntegrationService();
      
      // Start training in background (don't await)
      mlService.startRLTraining(input.symbol, input.agentType, {
        episodes: input.episodes,
        paperTradingValidation: true
      }).catch(err => {
        console.error('[healthRouter] RL training failed:', err);
      });
      
      return { started: true, message: `Started ${input.agentType} training for ${input.symbol}` };
    }),

  /**
   * Trigger manual optimization
   */
  triggerOptimization: protectedProcedure
    .input(z.object({
      type: z.enum(['strategy_params', 'agent_weights', 'risk_params', 'ml_hyperparams']),
    }))
    .mutation(async ({ input }) => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const mlService = getMLIntegrationService();
      
      // Start optimization in background
      mlService.triggerOptimization(input.type).catch(err => {
        console.error('[healthRouter] Optimization failed:', err);
      });
      
      return { started: true, message: `Started ${input.type} optimization` };
    }),

  /**
   * Toggle ML prediction agent
   */
  toggleMLPrediction: protectedProcedure
    .input(z.object({
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const mlService = getMLIntegrationService();
      mlService.setMLPredictionEnabled(input.enabled);
      return { enabled: input.enabled };
    }),

  /**
   * Get external API rate limit status
   * Shows rate limit state for WhaleAlert, CoinGecko, Mempool, etc.
   */
  getRateLimitStatus: publicProcedure.query(() => {
    const status = externalAPIRateLimiter.getStatus();
    const now = getActiveClock().now();
    
    // Format for display
    const formatted: Record<string, {
      name: string;
      requestsUsed: number;
      requestsMax: number;
      percentUsed: number;
      inBackoff: boolean;
      backoffRemainingSeconds: number;
      consecutiveErrors: number;
      status: 'ok' | 'warning' | 'error';
      lastError?: string;
    }> = {};
    
    for (const [apiName, state] of Object.entries(status)) {
      const percentUsed = Math.round((state.requestCount / state.maxRequests) * 100);
      let apiStatus: 'ok' | 'warning' | 'error' = 'ok';
      
      if (state.inBackoff || state.consecutiveErrors > 0) {
        apiStatus = 'error';
      } else if (percentUsed > 80) {
        apiStatus = 'warning';
      }
      
      formatted[apiName] = {
        name: apiName.charAt(0).toUpperCase() + apiName.slice(1),
        requestsUsed: state.requestCount,
        requestsMax: state.maxRequests,
        percentUsed,
        inBackoff: state.inBackoff,
        backoffRemainingSeconds: Math.ceil(state.backoffRemainingMs / 1000),
        consecutiveErrors: state.consecutiveErrors,
        status: apiStatus,
        lastError: state.lastError,
      };
    }
    
    return {
      timestampIST: formatToIST(new Date()),
      apis: formatted,
    };
  }),

  /**
   * Recalculate wallet margin for current user
   * Fixes data inconsistencies where margin doesn't match open positions
   */
  recalculateWalletMargin: protectedProcedure.mutation(async ({ ctx }) => {
    const { recalculateWalletMargin } = await import('../db');
    const result = await recalculateWalletMargin(ctx.user.id);
    
    if (!result) {
      return {
        success: false,
        message: 'Failed to recalculate wallet margin',
      };
    }
    
    return {
      success: true,
      ...result,
      message: result.corrected 
        ? `Margin corrected from $${result.oldMargin.toFixed(2)} to $${result.newMargin.toFixed(2)}`
        : 'Margin is already correct',
    };
  }),

  /**
   * Get comprehensive performance metrics
   * Includes agent performance, trade execution, system health, and latency
   */
  getPerformanceMetrics: protectedProcedure
    .input(z.object({
      hours: z.number().min(1).max(168).default(24),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
      const hours = input?.hours || 24;
      
      const metrics = await performanceMetricsService.getMetrics(ctx.user.id, hours);
      
      return {
        timestampIST: formatToIST(metrics.timestamp),
        periodHours: hours,
        agents: metrics.agents.map(a => ({
          ...a,
          lastSignalTime: a.lastSignalTime ? formatToIST(a.lastSignalTime) : null,
          avgConfidence: Number((a.avgConfidence * 100).toFixed(1)),
        })),
        trades: {
          ...metrics.trades,
          executionRate: Number(metrics.trades.executionRate.toFixed(1)),
          winRate: Number(metrics.trades.winRate.toFixed(1)),
          totalPnL: Number(metrics.trades.totalPnL.toFixed(2)),
          avgWinPnL: Number(metrics.trades.avgWinPnL.toFixed(2)),
          avgLossPnL: Number(metrics.trades.avgLossPnL.toFixed(2)),
          avgExecutionTimeMs: Math.round(metrics.trades.avgExecutionTimeMs),
        },
        system: {
          ...metrics.system,
          uptimeFormatted: formatUptime(metrics.system.uptime * 1000),
          ticksPerSecond: Number(metrics.system.ticksPerSecond.toFixed(1)),
          signalsPerMinute: Number(metrics.system.signalsPerMinute.toFixed(1)),
        },
        latency: {
          signalToConsensus: {
            avg: Math.round(metrics.latency.signalToConsensus.avg),
            p95: Math.round(metrics.latency.signalToConsensus.p95),
            p99: Math.round(metrics.latency.signalToConsensus.p99),
          },
          consensusToDecision: {
            avg: Math.round(metrics.latency.consensusToDecision.avg),
            p95: Math.round(metrics.latency.consensusToDecision.p95),
            p99: Math.round(metrics.latency.consensusToDecision.p99),
          },
          decisionToOrder: {
            avg: Math.round(metrics.latency.decisionToOrder.avg),
            p95: Math.round(metrics.latency.decisionToOrder.p95),
            p99: Math.round(metrics.latency.decisionToOrder.p99),
          },
          orderToFill: {
            avg: Math.round(metrics.latency.orderToFill.avg),
            p95: Math.round(metrics.latency.orderToFill.p95),
            p99: Math.round(metrics.latency.orderToFill.p99),
          },
          total: {
            avg: Math.round(metrics.latency.total.avg),
            p95: Math.round(metrics.latency.total.p95),
            p99: Math.round(metrics.latency.total.p99),
          },
        },
        alerts: metrics.alerts.map(a => ({
          ...a,
          timestamp: formatToIST(a.timestamp),
        })),
      };
    }),

  /**
   * Recalculate wallet margin for all users (admin only)
   * Use this to fix data inconsistencies across all wallets
   */
  recalculateAllWalletMargins: protectedProcedure.mutation(async ({ ctx }) => {
    // Only allow admin users
    if (ctx.user.role !== 'admin') {
      return {
        success: false,
        message: 'Admin access required',
        results: [],
      };
    }
    
    const { getDb } = await import('../db');
    const { paperWallets } = await import('../../drizzle/schema');
    const { recalculateWalletMargin } = await import('../db');
    
    const db = await getDb();
    if (!db) {
      return {
        success: false,
        message: 'Database not available',
        results: [],
      };
    }
    
    const wallets = await db.select().from(paperWallets);
    const results = [];
    
    for (const wallet of wallets) {
      const result = await recalculateWalletMargin(wallet.userId);
      if (result) {
        results.push(result);
      }
    }
    
    const correctedCount = results.filter(r => r.corrected).length;
    
    return {
      success: true,
      message: `Processed ${results.length} wallets, corrected ${correctedCount}`,
      results,
    };
  }),

  /**
   * Get circuit breaker status
   * Shows all circuit breakers and their current state
   */
  getCircuitBreakerStatus: protectedProcedure.query(async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    const stats = circuitBreakerManager.getStats();
    const health = circuitBreakerManager.getSystemHealth();
    
    return {
      timestampIST: formatToIST(new Date()),
      summary: {
        totalBreakers: stats.totalBreakers,
        openBreakers: stats.openBreakers,
        halfOpenBreakers: stats.halfOpenBreakers,
        closedBreakers: stats.closedBreakers,
        systemHealthy: health.healthy,
        healthScore: health.score,
      },
      criticalDown: health.criticalDown,
      degraded: health.degraded,
      breakers: stats.breakers.map(b => ({
        name: b.name,
        state: b.state,
        failureCount: b.failureCount,
        totalFailures: b.totalFailures,
        totalSuccesses: b.totalSuccesses,
        lastFailureTime: b.lastFailureTime ? formatToIST(new Date(b.lastFailureTime)) : null,
        lastSuccessTime: b.lastSuccessTime ? formatToIST(new Date(b.lastSuccessTime)) : null,
        lastError: b.lastError,
      })),
    };
  }),

  /**
   * Reset a specific circuit breaker
   */
  resetCircuitBreaker: protectedProcedure
    .input(z.object({
      name: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
      const success = circuitBreakerManager.forceReset(input.name);
      
      return {
        success,
        message: success 
          ? `Circuit breaker '${input.name}' has been reset`
          : `Circuit breaker '${input.name}' not found`,
      };
    }),

  /**
   * Reset all circuit breakers (admin only)
   */
  resetAllCircuitBreakers: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') {
      return {
        success: false,
        message: 'Admin access required',
      };
    }
    
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    circuitBreakerManager.forceResetAll();
    
    return {
      success: true,
      message: 'All circuit breakers have been reset',
    };
  }),

  /**
   * Get comprehensive price feed health status
   * INFRASTRUCTURE FIX (Feb 6, 2026): Shows Coinbase WebSocket (primary) + Binance REST (fallback)
   */
  getPriceFeedHealth: protectedProcedure.query(async () => {
    const wsStatus = wsHealthMonitor.getStatus();
    const allPrices = priceFeedService.getAllPrices();
    const priceCount = Object.keys(allPrices).length;
    const now = getActiveClock().now();

    // Coinbase WebSocket status
    const coinbaseWs = wsStatus['CoinbaseWS'];
    const coinbaseConnected = coinbaseWs?.connectionStatus === 'connected';
    const coinbaseLastMsg = Number(coinbaseWs?.lastMessageTime || 0);
    const coinbaseStaleSec = coinbaseLastMsg > 0 ? Math.round((now - coinbaseLastMsg) / 1000) : -1;

    // Binance REST fallback status
    let binanceStatus: any = null;
    try {
      const { binanceRestFallback } = await import('../services/BinanceRestFallback');
      binanceStatus = binanceRestFallback.getStatus();
    } catch { /* not initialized */ }

    // Determine overall feed health
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'critical';
    if (coinbaseConnected && coinbaseStaleSec < 30) {
      overallStatus = 'healthy';
    } else if (coinbaseConnected || (binanceStatus?.isActive)) {
      overallStatus = 'degraded';
    }

    return {
      timestampIST: formatToIST(new Date()),
      overallStatus,
      architecture: 'Coinbase WebSocket (PRIMARY) + Binance REST (FALLBACK)',
      monthlyCost: '$0 (both sources are free)',
      primary: {
        name: 'Coinbase WebSocket',
        connected: coinbaseConnected,
        messagesReceived: coinbaseWs?.totalMessages || 0,
        lastMessageTime: Number(coinbaseLastMsg) > 0 ? formatToIST(new Date(Number(coinbaseLastMsg))) : null,
        staleSec: coinbaseStaleSec,
        reconnectAttempts: coinbaseWs?.reconnectionAttempts || 0,
        minutesSinceLastMessage: coinbaseWs?.minutesSinceLastMessage || null,
        status: coinbaseConnected && coinbaseStaleSec < 30 ? 'healthy' :
                coinbaseConnected ? 'degraded' : 'disconnected',
      },
      fallback: {
        name: 'Binance REST Polling',
        isActive: binanceStatus?.isActive || false,
        mode: binanceStatus?.mode || 'standby',
        lastPollTime: binanceStatus?.lastPollTime ? formatToIST(new Date(binanceStatus.lastPollTime)) : null,
        pollIntervalMs: binanceStatus?.pollIntervalMs || 10000,
        consecutiveErrors: binanceStatus?.consecutiveErrors || 0,
        totalPolls: binanceStatus?.totalPolls || 0,
        status: binanceStatus?.isActive ? 'active' : 'standby',
      },
      removedServices: {
        coinapi: { reason: '403 Forbidden - subscription invalid', monthlySavings: '$79-499' },
        coincap: { reason: '503/502 - WebSocket unavailable', monthlySavings: '$65-150' },
      },
      priceFeed: {
        priceCount,
        symbols: Object.keys(allPrices),
        isRunning: priceFeedService.getStatus().isRunning,
      },
    };
  }),

  /**
   * Get candle cache status
   * Shows real-time status of the WebSocket candle cache for each symbol and timeframe
   */
  getCandleCacheStatus: protectedProcedure.query(async () => {
    const { getCandleCache } = await import('../WebSocketCandleCache');
    const cache = getCandleCache();
    const stats = cache.getStats();
    
    // Define expected timeframes and symbols
    const expectedTimeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const expectedSymbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-USDT', 'ETH-USDT'];
    
    // Build detailed status for each symbol/timeframe combination
    const symbolStatus: Array<{
      symbol: string;
      timeframes: Array<{
        timeframe: string;
        candleCount: number;
        oldestCandle: string | null;
        newestCandle: string | null;
        status: 'healthy' | 'low' | 'empty';
        coverage: string;
      }>;
      totalCandles: number;
      overallStatus: 'healthy' | 'degraded' | 'critical';
    }> = [];
    
    for (const symbol of expectedSymbols) {
      const timeframeStatus = [];
      let totalCandles = 0;
      let healthyCount = 0;
      
      for (const tf of expectedTimeframes) {
        const candles = cache.getCandles(symbol, tf);
        const count = candles.length;
        totalCandles += count;
        
        // Determine status based on candle count
        // Minimum requirements: 1m needs 60+, 5m needs 48+, 1h needs 24+, 4h needs 12+, 1d needs 7+
        const minRequired: Record<string, number> = {
          '1m': 60,
          '5m': 48,
          '15m': 24,
          '1h': 24,
          '4h': 12,
          '1d': 7,
        };
        
        let status: 'healthy' | 'low' | 'empty' = 'empty';
        if (count >= minRequired[tf]) {
          status = 'healthy';
          healthyCount++;
        } else if (count > 0) {
          status = 'low';
        }
        
        // Get oldest and newest candle timestamps
        let oldestCandle = null;
        let newestCandle = null;
        if (candles.length > 0) {
          const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
          oldestCandle = formatToIST(new Date(sorted[0].timestamp));
          newestCandle = formatToIST(new Date(sorted[sorted.length - 1].timestamp));
        }
        
        // Calculate coverage (how much of the expected period is covered)
        const coveragePercent = Math.min(100, Math.round((count / minRequired[tf]) * 100));
        
        timeframeStatus.push({
          timeframe: tf,
          candleCount: count,
          oldestCandle,
          newestCandle,
          status,
          coverage: `${coveragePercent}%`,
        });
      }
      
      // Determine overall symbol status
      let overallStatus: 'healthy' | 'degraded' | 'critical' = 'critical';
      if (healthyCount >= 4) overallStatus = 'healthy';
      else if (healthyCount >= 2) overallStatus = 'degraded';
      
      symbolStatus.push({
        symbol,
        timeframes: timeframeStatus,
        totalCandles,
        overallStatus,
      });
    }
    
    // Calculate overall cache health
    const healthySymbols = symbolStatus.filter(s => s.overallStatus === 'healthy').length;
    const degradedSymbols = symbolStatus.filter(s => s.overallStatus === 'degraded').length;
    let overallHealth: 'healthy' | 'degraded' | 'critical' = 'critical';
    if (healthySymbols >= 3) overallHealth = 'healthy';
    else if (healthySymbols >= 1 || degradedSymbols >= 2) overallHealth = 'degraded';
    
    return {
      timestampIST: formatToIST(new Date()),
      summary: {
        totalSymbols: expectedSymbols.length,
        healthySymbols,
        degradedSymbols,
        criticalSymbols: symbolStatus.filter(s => s.overallStatus === 'critical').length,
        totalCandles: stats.totalCandles,
        overallHealth,
      },
      symbols: symbolStatus,
      aggregatorStatus: {
        isRunning: stats.isAggregatorRunning || false,
        ticksProcessed: stats.ticksProcessed || 0,
        lastTickTime: stats.lastTickTime ? formatToIST(new Date(stats.lastTickTime)) : null,
      },
    };
  }),

  /**
   * Get Agent Health Report
   * Shows bias detection, signal distribution, and staleness for all agents
   */
  getAgentHealth: protectedProcedure.query(async () => {
    const { runAgentHealthCheck, getLastHealthReport } = await import('../monitoring/AgentHealthMonitor');
    
    // Try to get cached report first, run fresh check if none exists
    let report = getLastHealthReport();
    if (!report) {
      report = await runAgentHealthCheck();
    }
    
    if (!report) {
      return {
        status: 'unavailable',
        message: 'Agent health data not yet available. Check back in a few minutes.',
        agents: [],
        alerts: [],
      };
    }
    
    return {
      status: 'ok',
      timestampIST: formatToIST(report.timestamp),
      summary: {
        totalAgents: report.totalAgents,
        healthyAgents: report.healthyAgents,
        biasedAgents: report.biasedAgents,
        staleAgents: report.staleAgents,
        overallBias: report.overallBias,
      },
      agents: report.agents.map(a => ({
        name: a.agentName,
        totalSignals: a.totalSignals,
        distribution: {
          bullish: `${a.bullishPercent}%`,
          bearish: `${a.bearishPercent}%`,
          neutral: `${a.neutralPercent}%`,
        },
        avgConfidence: a.avgConfidence,
        bias: a.biasDetected ? {
          direction: a.biasDirection,
          severity: a.biasSeverity,
        } : null,
        lastSignalAge: `${a.lastSignalAge} min`,
        isStale: a.isStale,
        status: a.biasDetected ? a.biasSeverity : (a.isStale ? 'stale' : 'healthy'),
      })),
      alerts: report.alerts,
    };
  }),

  /**
   * Phase 13E: Get Data Gap Resilience stats
   * Shows REST fallback poller status, backfill counts, and gap recovery metrics
   */
  getResilienceStats: protectedProcedure.query(async () => {
    try {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      const stats = dataGapResilience.getStats();
      return {
        timestampIST: formatToIST(new Date()),
        ...stats,
      };
    } catch {
      return {
        timestampIST: formatToIST(new Date()),
        restPollCount: 0,
        restPollErrors: 0,
        backfillCount: 0,
        backfillTicksRecovered: 0,
        gapsDetected: 0,
        gapsRecoveredRapid: 0,
        isRESTPolling: false,
        lastRESTPrice: {},
        lastBackfillAt: 0,
        lastGapScanAt: 0,
      };
    }
  }),

  /**
   * Get LLM Circuit Breaker stats
   */
  getLLMCircuitBreakerStats: protectedProcedure.query(async () => {
    try {
      const { getLLMCircuitBreaker } = await import('../utils/LLMCircuitBreaker');
      const stats = getLLMCircuitBreaker().getStats();
      return {
        ...stats,
        timestampIST: formatToIST(new Date()),
      };
    } catch {
      return {
        state: 'CLOSED' as const,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalFallbacks: 0,
        totalCircuitOpens: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        lastStateChange: getActiveClock().now(),
        cooldownRemaining: 0,
        primaryProvider: 'Forge/Gemini',
        fallbackProvider: null,
        fallbackAvailable: false,
        timestampIST: formatToIST(new Date()),
      };
    }
  }),

  /**
   * Reset LLM Circuit Breaker (manual intervention)
   */
  resetLLMCircuitBreaker: protectedProcedure.mutation(async () => {
    const { getLLMCircuitBreaker } = await import('../utils/LLMCircuitBreaker');
    getLLMCircuitBreaker().reset();
    return { success: true, message: 'LLM circuit breaker reset to CLOSED' };
  }),

  /**
   * Get server process uptime — uses Node.js process.uptime() which is the most reliable metric.
   * This is the ACTUAL process uptime, not engine uptime.
   */
  getProcessUptime: protectedProcedure.query(() => {
    const uptimeSeconds = process.uptime();
    const uptimeMs = uptimeSeconds * 1000;
    const memUsage = process.memoryUsage();
    
    return {
      uptimeMs,
      uptimeSeconds: Math.floor(uptimeSeconds),
      uptimeFormatted: formatUptime(uptimeMs),
      serverStartTime: new Date(getActiveClock().now() - uptimeMs).toISOString(),
      serverStartTimeIST: formatToIST(new Date(getActiveClock().now() - uptimeMs)),
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
        externalMB: Math.round(memUsage.external / 1024 / 1024),
      },
      pid: process.pid,
      nodeVersion: process.version,
    };
  }),

  /**
   * Get server logs from the in-memory log buffer
   * Supports filtering by level, category, and search text
   */
  getServerLogs: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional().default(200),
      afterId: z.number().optional(),
      level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
      category: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const { getServerLogBuffer } = await import('../services/ServerLogBuffer');
      const logBuffer = getServerLogBuffer();
      
      return logBuffer.getLogs({
        limit: input?.limit,
        afterId: input?.afterId,
        level: input?.level,
        category: input?.category,
        search: input?.search,
      });
    }),

  /**
   * Get log statistics for the health dashboard
   */
  getLogStats: protectedProcedure.query(async () => {
    const { getServerLogBuffer } = await import('../services/ServerLogBuffer');
    const logBuffer = getServerLogBuffer();
    return logBuffer.getStats();
  }),

  /**
   * Get available log categories
   */
  getLogCategories: protectedProcedure.query(async () => {
    const { getServerLogBuffer } = await import('../services/ServerLogBuffer');
    const logBuffer = getServerLogBuffer();
    return logBuffer.getCategories();
  }),

  /**
   * Get process error statistics from ProcessManager
   */
  getProcessErrors: protectedProcedure.query(async () => {
    const { processManager } = await import('../_core/processManager');
    return processManager.getErrorStats();
  }),

  /**
   * Get MemoryGuard status — current memory usage, limits, and cleanup stats
   */
  getMemoryStatus: protectedProcedure.query(async () => {
    const { getMemoryGuard } = await import('../services/MemoryGuard');
    const guard = getMemoryGuard();
    if (!guard) {
      const mem = process.memoryUsage();
      return {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        limitMB: parseInt(process.env.MEMORY_LIMIT_MB || '1024', 10),
        usagePercent: 0,
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
        arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024),
        growthMB: 0,
        peakRSS: 0,
        cleanupCount: 0,
        gcCount: 0,
        lastGCTime: 0,
        registeredClearables: 0,
        uptimeMin: 0,
        startTime: getActiveClock().now(),
      };
    }
    return guard.getStatus();
  }),

  /**
   * Get MemoryGuard time-series history for dashboard charts
   */
  getMemoryHistory: protectedProcedure
    .input(z.object({
      minutes: z.number().min(1).max(360).optional(),
    }).optional())
    .query(async ({ input }) => {
      const { getMemoryGuard } = await import('../services/MemoryGuard');
      const guard = getMemoryGuard();
      if (!guard) return { history: [], cleanupEvents: [] };
      return {
        history: guard.getHistory(input?.minutes),
        cleanupEvents: guard.getCleanupEvents(50),
      };
    }),
});
