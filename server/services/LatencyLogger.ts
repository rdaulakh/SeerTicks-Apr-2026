/**
 * Latency Logger Service
 * 
 * Tracks end-to-end execution latency from signal generation to trade fill.
 * Persists latency data to database for performance analysis and optimization.
 * 
 * Pipeline stages:
 * 1. Signal Generation (agent analysis)
 * 2. Consensus Calculation
 * 3. Decision Making
 * 4. Order Placement
 * 5. Order Fill
 */

import { logExecutionLatency, ExecutionLatencyEntry } from '../db';

export interface LatencyContext {
  userId: number;
  symbol: string;
  signalId?: string;
  
  // Timestamps (milliseconds since epoch)
  signalGeneratedAt: number;
  consensusCalculatedAt?: number;
  decisionMadeAt?: number;
  orderPlacedAt?: number;
  orderFilledAt?: number;
  
  // Metadata
  agentCount: number;
  consensusStrength?: number;
  priceAtSignal?: number;
  priceAtExecution?: number;
}

class LatencyLoggerService {
  private static instance: LatencyLoggerService;
  private activeContexts: Map<string, LatencyContext> = new Map();
  
  private constructor() {}
  
  static getInstance(): LatencyLoggerService {
    if (!LatencyLoggerService.instance) {
      LatencyLoggerService.instance = new LatencyLoggerService();
    }
    return LatencyLoggerService.instance;
  }
  
  /**
   * Start tracking latency for a new signal
   */
  startSignal(userId: number, symbol: string, agentCount: number, priceAtSignal?: number): string {
    const contextId = `${userId}_${symbol}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    this.activeContexts.set(contextId, {
      userId,
      symbol,
      signalGeneratedAt: Date.now(),
      agentCount,
      priceAtSignal,
    });
    
    return contextId;
  }
  
  /**
   * Record consensus calculation timestamp
   */
  recordConsensus(contextId: string, consensusStrength: number): void {
    const ctx = this.activeContexts.get(contextId);
    if (ctx) {
      ctx.consensusCalculatedAt = Date.now();
      ctx.consensusStrength = consensusStrength;
    }
  }
  
  /**
   * Record decision made timestamp
   */
  recordDecision(contextId: string, signalId?: string): void {
    const ctx = this.activeContexts.get(contextId);
    if (ctx) {
      ctx.decisionMadeAt = Date.now();
      if (signalId) {
        ctx.signalId = signalId;
      }
    }
  }
  
  /**
   * Record order placed timestamp
   */
  recordOrderPlaced(contextId: string): void {
    const ctx = this.activeContexts.get(contextId);
    if (ctx) {
      ctx.orderPlacedAt = Date.now();
    }
  }
  
  /**
   * Record order filled and finalize latency tracking
   */
  async recordOrderFilled(
    contextId: string, 
    priceAtExecution?: number,
    executionResult: 'executed' | 'rejected' | 'skipped' | 'failed' | 'timeout' = 'executed'
  ): Promise<void> {
    const ctx = this.activeContexts.get(contextId);
    if (!ctx) {
      console.warn(`[LatencyLogger] Context not found: ${contextId}`);
      return;
    }
    
    ctx.orderFilledAt = Date.now();
    ctx.priceAtExecution = priceAtExecution;
    
    const totalLatencyMs = ctx.orderFilledAt - ctx.signalGeneratedAt;
    
    // Calculate slippage in ms (time between order placed and filled)
    const slippageMs = ctx.orderPlacedAt && ctx.orderFilledAt 
      ? ctx.orderFilledAt - ctx.orderPlacedAt 
      : undefined;
    
    // Persist to database
    try {
      const entry: ExecutionLatencyEntry = {
        userId: ctx.userId,
        signalId: ctx.signalId || contextId,
        symbol: ctx.symbol,
        signalGeneratedAt: ctx.signalGeneratedAt,
        consensusCalculatedAt: ctx.consensusCalculatedAt,
        decisionMadeAt: ctx.decisionMadeAt,
        orderPlacedAt: ctx.orderPlacedAt,
        orderFilledAt: ctx.orderFilledAt,
        totalLatencyMs,
        executionResult,
        agentCount: ctx.agentCount,
        consensusStrength: ctx.consensusStrength?.toFixed(4),
        priceAtSignal: ctx.priceAtSignal?.toString(),
        priceAtExecution: ctx.priceAtExecution?.toString(),
        slippageMs,
      };
      
      await logExecutionLatency(entry);
      
      // Log summary
      const grade = this.calculateGrade(totalLatencyMs);
      console.log(`[LatencyLogger] ⚡ ${ctx.symbol} ${executionResult.toUpperCase()} | Total: ${totalLatencyMs}ms (${grade}) | Stages: Signal→Consensus: ${ctx.consensusCalculatedAt ? ctx.consensusCalculatedAt - ctx.signalGeneratedAt : 'N/A'}ms, Consensus→Decision: ${ctx.decisionMadeAt && ctx.consensusCalculatedAt ? ctx.decisionMadeAt - ctx.consensusCalculatedAt : 'N/A'}ms, Decision→Order: ${ctx.orderPlacedAt && ctx.decisionMadeAt ? ctx.orderPlacedAt - ctx.decisionMadeAt : 'N/A'}ms, Order→Fill: ${slippageMs || 'N/A'}ms`);
    } catch (error) {
      console.error(`[LatencyLogger] Failed to persist latency:`, error);
    }
    
    // Clean up
    this.activeContexts.delete(contextId);
  }
  
  /**
   * Record a rejected/skipped signal (no order placed)
   */
  async recordRejected(
    contextId: string,
    executionResult: 'rejected' | 'skipped' | 'failed' | 'timeout' = 'rejected'
  ): Promise<void> {
    const ctx = this.activeContexts.get(contextId);
    if (!ctx) {
      return; // Silent fail for rejected signals without context
    }
    
    const endTime = Date.now();
    const totalLatencyMs = endTime - ctx.signalGeneratedAt;
    
    // Persist to database
    try {
      const entry: ExecutionLatencyEntry = {
        userId: ctx.userId,
        signalId: ctx.signalId || contextId,
        symbol: ctx.symbol,
        signalGeneratedAt: ctx.signalGeneratedAt,
        consensusCalculatedAt: ctx.consensusCalculatedAt,
        decisionMadeAt: ctx.decisionMadeAt,
        totalLatencyMs,
        executionResult,
        agentCount: ctx.agentCount,
        consensusStrength: ctx.consensusStrength?.toFixed(4),
        priceAtSignal: ctx.priceAtSignal?.toString(),
      };
      
      await logExecutionLatency(entry);
    } catch (error) {
      console.error(`[LatencyLogger] Failed to persist rejected latency:`, error);
    }
    
    // Clean up
    this.activeContexts.delete(contextId);
  }
  
  /**
   * Calculate latency grade
   */
  private calculateGrade(totalLatencyMs: number): string {
    if (totalLatencyMs < 50) return 'EXCELLENT';
    if (totalLatencyMs < 100) return 'GOOD';
    if (totalLatencyMs < 250) return 'ACCEPTABLE';
    if (totalLatencyMs < 500) return 'SLOW';
    return 'CRITICAL';
  }
  
  /**
   * Get active context count (for monitoring)
   */
  getActiveContextCount(): number {
    return this.activeContexts.size;
  }
  
  /**
   * Clean up stale contexts (older than 5 minutes)
   */
  cleanupStaleContexts(): number {
    const staleThreshold = Date.now() - 5 * 60 * 1000;
    let cleaned = 0;
    
    for (const [id, ctx] of this.activeContexts) {
      if (ctx.signalGeneratedAt < staleThreshold) {
        this.activeContexts.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[LatencyLogger] Cleaned up ${cleaned} stale contexts`);
    }
    
    return cleaned;
  }
}

// Singleton export
export const latencyLogger = LatencyLoggerService.getInstance();

// Start periodic cleanup
setInterval(() => {
  latencyLogger.cleanupStaleContexts();
}, 60 * 1000); // Every minute
