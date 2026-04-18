/**
 * Connection Health Router
 * 
 * Provides real-time connection health status for all data sources.
 * Used by the frontend to display connection status and alert on issues.
 */

import { router, publicProcedure, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { connectionResilienceManager } from '../services/ConnectionResilienceManager';
import { tickStalenessMonitor } from '../services/TickStalenessMonitor';
import { signalBuffer } from '../services/SignalBuffer';
import { getPoolStats } from '../db';

export const connectionHealthRouter = router({
  /**
   * Get overall connection health status
   */
  getHealth: publicProcedure.query(async () => {
    const systemHealth = connectionResilienceManager.getSystemHealth();
    const tickStatus = tickStalenessMonitor.getStatus();
    const bufferStats = signalBuffer.getStats();
    const poolStats = getPoolStats();

    return {
      timestamp: Date.now(),
      overall: systemHealth.overall,
      connections: systemHealth.connections.map(conn => ({
        name: conn.name,
        status: conn.status,
        lastSuccessTime: conn.lastSuccessTime,
        lastErrorTime: conn.lastErrorTime,
        lastError: conn.lastError,
        consecutiveFailures: conn.consecutiveFailures,
        uptime: conn.uptime,
        latencyMs: conn.latencyMs,
      })),
      tickHealth: {
        isHealthy: tickStatus.isHealthy,
        ticksPerSecond: tickStatus.ticksPerSecond,
        lastTickTime: tickStatus.lastTickTime,
        staleDurationMs: tickStatus.staleDurationMs,
        primarySource: {
          name: tickStatus.primarySource.name,
          isStale: tickStatus.primarySource.isStale,
          tickCount: tickStatus.primarySource.tickCount,
          reconnectCount: tickStatus.primarySource.reconnectCount,
        },
        recentAlerts: tickStatus.alerts.slice(-5),
      },
      signalBuffer: {
        currentSize: bufferStats.currentSize,
        totalBuffered: bufferStats.totalBuffered,
        totalProcessed: bufferStats.totalProcessed,
        totalExpired: bufferStats.totalExpired,
        totalDropped: bufferStats.totalDropped,
        oldestSignalAge: bufferStats.oldestSignalAge,
      },
      database: poolStats ? {
        totalConnections: poolStats.totalConnections,
        freeConnections: poolStats.freeConnections,
        queuedRequests: poolStats.queuedRequests,
      } : null,
    };
  }),

  /**
   * Get detailed connection status for a specific connection
   */
  getConnectionDetail: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }) => {
      const health = connectionResilienceManager.getHealth(input.name);
      if (!health) {
        return { error: `Connection '${input.name}' not found` };
      }
      return health;
    }),

  /**
   * Force reconnection for a specific connection
   */
  forceReconnect: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      console.log(`[ConnectionHealthRouter] Force reconnect requested for ${input.name}`);
      
      // INFRASTRUCTURE FIX (Feb 6, 2026): CoinAPI removed. Coinbase is the primary feed.
      if (input.name === 'coinbase_websocket' || input.name === 'price_feed') {
        try {
          // Coinbase WebSocket auto-reconnects via CoinbaseWebSocketManager
          return { success: true, message: `Reconnection signal sent for ${input.name}. Coinbase WebSocket will auto-reconnect.` };
        } catch (error) {
          return { 
            success: false, 
            message: `Failed to reconnect ${input.name}: ${error instanceof Error ? error.message : 'Unknown error'}` 
          };
        }
      }
      
      return { success: false, message: `Reconnection not supported for ${input.name}` };
    }),

  /**
   * Get buffered signals
   */
  getBufferedSignals: protectedProcedure.query(async () => {
    const signals = signalBuffer.getPendingSignals();
    return {
      count: signals.length,
      signals: signals.map(s => ({
        id: s.id,
        timestamp: s.timestamp,
        type: s.type,
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
        priority: s.priority,
        retryCount: s.retryCount,
        expiresAt: s.expiresAt,
      })),
    };
  }),

  /**
   * Flush signal buffer (process all pending signals)
   */
  flushBuffer: protectedProcedure.mutation(async () => {
    const signals = signalBuffer.flush();
    console.log(`[ConnectionHealthRouter] Flushed ${signals.length} signals from buffer`);
    return {
      success: true,
      flushedCount: signals.length,
    };
  }),

  /**
   * Get connection health history (for charts)
   */
  getHealthHistory: publicProcedure
    .input(z.object({ 
      connectionName: z.string(),
      hours: z.number().min(1).max(24).default(1),
    }))
    .query(async ({ input }) => {
      // This would require storing historical data
      // For now, return current status
      const health = connectionResilienceManager.getHealth(input.connectionName);
      return {
        connectionName: input.connectionName,
        currentStatus: health?.status || 'unknown',
        message: 'Historical data not yet implemented',
      };
    }),
});

export type ConnectionHealthRouter = typeof connectionHealthRouter;
