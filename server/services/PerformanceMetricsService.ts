/**
 * Performance Metrics Service
 * 
 * Aggregates and provides real-time performance metrics for the trading platform.
 * Includes agent performance, trade execution, system health, and latency tracking.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export interface AgentPerformanceMetrics {
  agentName: string;
  signalCount: number;
  avgConfidence: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  lastSignalTime: Date | null;
  avgLatencyMs: number;
}

export interface TradeExecutionMetrics {
  totalTrades: number;
  executedTrades: number;
  rejectedTrades: number;
  failedTrades: number;
  executionRate: number;
  avgExecutionTimeMs: number;
  totalPnL: number;
  winRate: number;
  avgWinPnL: number;
  avgLossPnL: number;
}

export interface SystemPerformanceMetrics {
  uptime: number;
  memoryUsageMB: number;
  memoryTotalMB: number;
  cpuUsage: number;
  activeConnections: number;
  ticksPerSecond: number;
  signalsPerMinute: number;
}

export interface LatencyBreakdown {
  signalToConsensus: { avg: number; p95: number; p99: number };
  consensusToDecision: { avg: number; p95: number; p99: number };
  decisionToOrder: { avg: number; p95: number; p99: number };
  orderToFill: { avg: number; p95: number; p99: number };
  total: { avg: number; p95: number; p99: number };
}

export interface ComprehensiveMetrics {
  timestamp: Date;
  agents: AgentPerformanceMetrics[];
  trades: TradeExecutionMetrics;
  system: SystemPerformanceMetrics;
  latency: LatencyBreakdown;
  alerts: {
    type: 'warning' | 'error' | 'critical';
    message: string;
    timestamp: Date;
  }[];
}

class PerformanceMetricsServiceImpl {
  private static instance: PerformanceMetricsServiceImpl;
  private metricsCache: ComprehensiveMetrics | null = null;
  private lastCacheTime: number = 0;
  private readonly CACHE_TTL_MS = 5000; // 5 second cache
  
  // Real-time counters
  private tickCount: number = 0;
  private signalCount: number = 0;
  private lastTickReset: number = Date.now();
  private lastSignalReset: number = Date.now();
  
  private constructor() {
    // Reset counters every minute
    setInterval(() => {
      this.tickCount = 0;
      this.signalCount = 0;
      this.lastTickReset = Date.now();
      this.lastSignalReset = Date.now();
    }, 60000);
  }
  
  static getInstance(): PerformanceMetricsServiceImpl {
    if (!PerformanceMetricsServiceImpl.instance) {
      PerformanceMetricsServiceImpl.instance = new PerformanceMetricsServiceImpl();
    }
    return PerformanceMetricsServiceImpl.instance;
  }
  
  /**
   * Record a price tick (called by price feed)
   */
  recordTick(): void {
    this.tickCount++;
  }
  
  /**
   * Record a signal generation (called by agents)
   */
  recordSignal(): void {
    this.signalCount++;
  }
  
  /**
   * Get comprehensive metrics
   */
  async getMetrics(userId: number, hours: number = 24): Promise<ComprehensiveMetrics> {
    // Check cache
    if (this.metricsCache && Date.now() - this.lastCacheTime < this.CACHE_TTL_MS) {
      return this.metricsCache;
    }
    
    const [agents, trades, latency] = await Promise.all([
      this.getAgentMetrics(userId, hours),
      this.getTradeMetrics(userId, hours),
      this.getLatencyBreakdown(userId, hours),
    ]);
    
    const system = this.getSystemMetrics();
    const alerts = this.generateAlerts(agents, trades, latency, system);
    
    this.metricsCache = {
      timestamp: new Date(),
      agents,
      trades,
      system,
      latency,
      alerts,
    };
    this.lastCacheTime = Date.now();
    
    return this.metricsCache;
  }
  
  /**
   * Get agent performance metrics
   */
  private async getAgentMetrics(userId: number, hours: number): Promise<AgentPerformanceMetrics[]> {
    const db = await getDb();
    if (!db) return [];
    
    try {
      const result = await db.execute(sql`
        SELECT 
          agentName,
          COUNT(*) as signalCount,
          AVG(confidence) as avgConfidence,
          SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) as bullishCount,
          SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) as bearishCount,
          SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) as neutralCount,
          MAX(createdAt) as lastSignalTime
        FROM agentSignals
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
        GROUP BY agentName
        ORDER BY signalCount DESC
      `);
      
      const rows = (result as any)[0] || [];
      return rows.map((row: any) => ({
        agentName: row.agentName,
        signalCount: Number(row.signalCount) || 0,
        avgConfidence: Number(row.avgConfidence) || 0,
        bullishCount: Number(row.bullishCount) || 0,
        bearishCount: Number(row.bearishCount) || 0,
        neutralCount: Number(row.neutralCount) || 0,
        lastSignalTime: row.lastSignalTime ? new Date(row.lastSignalTime) : null,
        avgLatencyMs: 0, // Will be populated from latency logs if available
      }));
    } catch (error) {
      console.error('[PerformanceMetrics] Failed to get agent metrics:', error);
      return [];
    }
  }
  
  /**
   * Get trade execution metrics
   */
  private async getTradeMetrics(userId: number, hours: number): Promise<TradeExecutionMetrics> {
    const db = await getDb();
    if (!db) {
      return {
        totalTrades: 0,
        executedTrades: 0,
        rejectedTrades: 0,
        failedTrades: 0,
        executionRate: 0,
        avgExecutionTimeMs: 0,
        totalPnL: 0,
        winRate: 0,
        avgWinPnL: 0,
        avgLossPnL: 0,
      };
    }
    
    try {
      // Get trade decision stats
      const decisionResult = await db.execute(sql`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN decision = 'EXECUTED' THEN 1 ELSE 0 END) as executed,
          SUM(CASE WHEN decision = 'SKIPPED' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN decision = 'FAILED' THEN 1 ELSE 0 END) as failed
        FROM tradeDecisionLogs
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
      `);
      
      const decisionStats = (decisionResult as any)[0]?.[0] || {};
      
      // Get P&L stats from paper trades
      const pnlResult = await db.execute(sql`
        SELECT 
          COUNT(*) as totalTrades,
          SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as winningTrades,
          SUM(CASE WHEN CAST(pnl AS DECIMAL(20,8)) <= 0 THEN 1 ELSE 0 END) as losingTrades,
          SUM(CAST(pnl AS DECIMAL(20,8))) as totalPnL,
          AVG(CASE WHEN CAST(pnl AS DECIMAL(20,8)) > 0 THEN CAST(pnl AS DECIMAL(20,8)) ELSE NULL END) as avgWinPnL,
          AVG(CASE WHEN CAST(pnl AS DECIMAL(20,8)) <= 0 THEN CAST(pnl AS DECIMAL(20,8)) ELSE NULL END) as avgLossPnL
        FROM paperTrades
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
          AND pnl IS NOT NULL
      `);
      
      const pnlStats = (pnlResult as any)[0]?.[0] || {};
      
      // Get latency stats
      const latencyResult = await db.execute(sql`
        SELECT AVG(totalLatencyMs) as avgLatency
        FROM executionLatencyLogs
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
          AND executionResult = 'executed'
      `);
      
      const latencyStats = (latencyResult as any)[0]?.[0] || {};
      
      const total = Number(decisionStats.total) || 0;
      const executed = Number(decisionStats.executed) || 0;
      const totalTrades = Number(pnlStats.totalTrades) || 0;
      const winningTrades = Number(pnlStats.winningTrades) || 0;
      
      return {
        totalTrades: total,
        executedTrades: executed,
        rejectedTrades: Number(decisionStats.rejected) || 0,
        failedTrades: Number(decisionStats.failed) || 0,
        executionRate: total > 0 ? (executed / total) * 100 : 0,
        avgExecutionTimeMs: Number(latencyStats.avgLatency) || 0,
        totalPnL: Number(pnlStats.totalPnL) || 0,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
        avgWinPnL: Number(pnlStats.avgWinPnL) || 0,
        avgLossPnL: Number(pnlStats.avgLossPnL) || 0,
      };
    } catch (error) {
      console.error('[PerformanceMetrics] Failed to get trade metrics:', error);
      return {
        totalTrades: 0,
        executedTrades: 0,
        rejectedTrades: 0,
        failedTrades: 0,
        executionRate: 0,
        avgExecutionTimeMs: 0,
        totalPnL: 0,
        winRate: 0,
        avgWinPnL: 0,
        avgLossPnL: 0,
      };
    }
  }
  
  /**
   * Get latency breakdown by stage
   */
  private async getLatencyBreakdown(userId: number, hours: number): Promise<LatencyBreakdown> {
    const db = await getDb();
    const defaultBreakdown: LatencyBreakdown = {
      signalToConsensus: { avg: 0, p95: 0, p99: 0 },
      consensusToDecision: { avg: 0, p95: 0, p99: 0 },
      decisionToOrder: { avg: 0, p95: 0, p99: 0 },
      orderToFill: { avg: 0, p95: 0, p99: 0 },
      total: { avg: 0, p95: 0, p99: 0 },
    };
    
    if (!db) return defaultBreakdown;
    
    try {
      const result = await db.execute(sql`
        SELECT 
          AVG(signalToConsensusMs) as avgS2C,
          AVG(consensusToDecisionMs) as avgC2D,
          AVG(decisionToOrderMs) as avgD2O,
          AVG(orderToFillMs) as avgO2F,
          AVG(totalLatencyMs) as avgTotal
        FROM executionLatencyLogs
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
      `);
      
      const stats = (result as any)[0]?.[0] || {};
      
      // Get percentiles
      const percentileResult = await db.execute(sql`
        SELECT 
          signalToConsensusMs, consensusToDecisionMs, 
          decisionToOrderMs, orderToFillMs, totalLatencyMs
        FROM executionLatencyLogs
        WHERE userId = ${userId}
          AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
        ORDER BY totalLatencyMs ASC
      `);
      
      const rows = (percentileResult as any)[0] || [];
      const p95Idx = Math.floor(rows.length * 0.95);
      const p99Idx = Math.floor(rows.length * 0.99);
      
      return {
        signalToConsensus: {
          avg: Number(stats.avgS2C) || 0,
          p95: rows[p95Idx]?.signalToConsensusMs || 0,
          p99: rows[p99Idx]?.signalToConsensusMs || 0,
        },
        consensusToDecision: {
          avg: Number(stats.avgC2D) || 0,
          p95: rows[p95Idx]?.consensusToDecisionMs || 0,
          p99: rows[p99Idx]?.consensusToDecisionMs || 0,
        },
        decisionToOrder: {
          avg: Number(stats.avgD2O) || 0,
          p95: rows[p95Idx]?.decisionToOrderMs || 0,
          p99: rows[p99Idx]?.decisionToOrderMs || 0,
        },
        orderToFill: {
          avg: Number(stats.avgO2F) || 0,
          p95: rows[p95Idx]?.orderToFillMs || 0,
          p99: rows[p99Idx]?.orderToFillMs || 0,
        },
        total: {
          avg: Number(stats.avgTotal) || 0,
          p95: rows[p95Idx]?.totalLatencyMs || 0,
          p99: rows[p99Idx]?.totalLatencyMs || 0,
        },
      };
    } catch (error) {
      console.error('[PerformanceMetrics] Failed to get latency breakdown:', error);
      return defaultBreakdown;
    }
  }
  
  /**
   * Get system performance metrics
   */
  private getSystemMetrics(): SystemPerformanceMetrics {
    const memUsage = process.memoryUsage();
    const elapsedSeconds = (Date.now() - this.lastTickReset) / 1000;
    const signalElapsed = (Date.now() - this.lastSignalReset) / 1000;
    
    return {
      uptime: process.uptime(),
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      cpuUsage: 0, // Would need os module for accurate CPU
      activeConnections: 0, // Would need WebSocket tracking
      ticksPerSecond: elapsedSeconds > 0 ? this.tickCount / elapsedSeconds : 0,
      signalsPerMinute: signalElapsed > 0 ? (this.signalCount / signalElapsed) * 60 : 0,
    };
  }
  
  /**
   * Generate alerts based on metrics
   */
  private generateAlerts(
    agents: AgentPerformanceMetrics[],
    trades: TradeExecutionMetrics,
    latency: LatencyBreakdown,
    system: SystemPerformanceMetrics
  ): ComprehensiveMetrics['alerts'] {
    const alerts: ComprehensiveMetrics['alerts'] = [];
    const now = new Date();
    
    // Check for slow latency
    if (latency.total.p95 > 500) {
      alerts.push({
        type: 'warning',
        message: `High P95 latency: ${latency.total.p95}ms (threshold: 500ms)`,
        timestamp: now,
      });
    }
    
    if (latency.total.p99 > 1000) {
      alerts.push({
        type: 'error',
        message: `Critical P99 latency: ${latency.total.p99}ms (threshold: 1000ms)`,
        timestamp: now,
      });
    }
    
    // Check for low execution rate
    if (trades.totalTrades > 10 && trades.executionRate < 50) {
      alerts.push({
        type: 'warning',
        message: `Low execution rate: ${trades.executionRate.toFixed(1)}% (threshold: 50%)`,
        timestamp: now,
      });
    }
    
    // Check for high failure rate
    if (trades.totalTrades > 10 && trades.failedTrades / trades.totalTrades > 0.1) {
      alerts.push({
        type: 'error',
        message: `High failure rate: ${((trades.failedTrades / trades.totalTrades) * 100).toFixed(1)}%`,
        timestamp: now,
      });
    }
    
    // Check for inactive agents
    const inactiveAgents = agents.filter(a => {
      if (!a.lastSignalTime) return true;
      return Date.now() - a.lastSignalTime.getTime() > 5 * 60 * 1000; // 5 minutes
    });
    
    if (inactiveAgents.length > 0) {
      alerts.push({
        type: 'warning',
        message: `${inactiveAgents.length} agents inactive: ${inactiveAgents.map(a => a.agentName).join(', ')}`,
        timestamp: now,
      });
    }
    
    // Check memory usage
    if (system.memoryUsageMB > system.memoryTotalMB * 0.9) {
      alerts.push({
        type: 'critical',
        message: `High memory usage: ${system.memoryUsageMB}MB / ${system.memoryTotalMB}MB (90%+)`,
        timestamp: now,
      });
    }
    
    return alerts;
  }
}

export const performanceMetricsService = PerformanceMetricsServiceImpl.getInstance();
