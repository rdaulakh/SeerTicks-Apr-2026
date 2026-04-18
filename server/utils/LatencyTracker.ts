/**
 * Latency Tracker
 * 
 * Measures end-to-end latency across the entire trading pipeline:
 * Signal Generation → Decision → Order Preparation → Network → Exchange → Confirmation
 * 
 * Critical for maintaining millisecond-level execution and identifying bottlenecks.
 */

export interface LatencyStage {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number; // milliseconds
}

export interface LatencyTrace {
  traceId: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold' | 'reduce' | 'exit';
  
  // Pipeline stages
  stages: {
    signalGeneration?: LatencyStage;
    agentAnalysis?: LatencyStage;
    consensus?: LatencyStage;
    decision?: LatencyStage;
    positionSizing?: LatencyStage;
    orderPreparation?: LatencyStage;
    networkTransmission?: LatencyStage;
    exchangeProcessing?: LatencyStage;
    confirmation?: LatencyStage;
  };
  
  // Aggregate metrics
  totalLatency?: number; // milliseconds
  startTime: number;
  endTime?: number;
  
  // Metadata
  orderId?: string;
  price?: number;
  quantity?: number;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

/**
 * Latency Tracker Manager
 * Tracks active traces and computes statistics
 */
export class LatencyTracker {
  private traces: Map<string, LatencyTrace> = new Map();
  private completedTraces: LatencyTrace[] = [];
  private readonly MAX_COMPLETED_TRACES = 1000; // Keep last 1000 for analysis
  
  /**
   * Start a new latency trace
   */
  startTrace(symbol: string, action: 'buy' | 'sell' | 'hold' | 'reduce' | 'exit'): string {
    const traceId = `${symbol}_${action}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const trace: LatencyTrace = {
      traceId,
      symbol,
      action,
      stages: {},
      startTime: performance.now(),
      status: 'pending',
    };
    
    this.traces.set(traceId, trace);
    return traceId;
  }
  
  /**
   * Start a stage within a trace
   */
  startStage(traceId: string, stageName: keyof LatencyTrace['stages']): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.warn(`[LatencyTracker] Trace not found: ${traceId}`);
      return;
    }
    
    trace.stages[stageName] = {
      name: stageName,
      startTime: performance.now(),
    };
  }
  
  /**
   * End a stage within a trace
   */
  endStage(traceId: string, stageName: keyof LatencyTrace['stages']): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.warn(`[LatencyTracker] Trace not found: ${traceId}`);
      return;
    }
    
    const stage = trace.stages[stageName];
    if (!stage) {
      console.warn(`[LatencyTracker] Stage not started: ${stageName}`);
      return;
    }
    
    stage.endTime = performance.now();
    stage.duration = stage.endTime - stage.startTime;
  }
  
  /**
   * Complete a trace
   */
  completeTrace(traceId: string, metadata?: { orderId?: string; price?: number; quantity?: number }): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.warn(`[LatencyTracker] Trace not found: ${traceId}`);
      return;
    }
    
    trace.endTime = performance.now();
    trace.totalLatency = trace.endTime - trace.startTime;
    trace.status = 'completed';
    
    if (metadata) {
      trace.orderId = metadata.orderId;
      trace.price = metadata.price;
      trace.quantity = metadata.quantity;
    }
    
    // Move to completed traces
    this.completedTraces.push(trace);
    this.traces.delete(traceId);
    
    // Trim if exceeds max
    if (this.completedTraces.length > this.MAX_COMPLETED_TRACES) {
      this.completedTraces.shift();
    }
    
    // Log summary
    this.logTraceSummary(trace);
  }
  
  /**
   * Fail a trace
   */
  failTrace(traceId: string, error: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.warn(`[LatencyTracker] Trace not found: ${traceId}`);
      return;
    }
    
    trace.endTime = performance.now();
    trace.totalLatency = trace.endTime - trace.startTime;
    trace.status = 'failed';
    trace.error = error;
    
    // Move to completed traces
    this.completedTraces.push(trace);
    this.traces.delete(traceId);
    
    console.error(`[LatencyTracker] ❌ Trace failed: ${traceId} - ${error}`);
  }
  
  /**
   * Get a specific trace
   */
  getTrace(traceId: string): LatencyTrace | undefined {
    return this.traces.get(traceId) || this.completedTraces.find(t => t.traceId === traceId);
  }
  
  /**
   * Get recent completed traces
   */
  getRecentTraces(limit: number = 100): LatencyTrace[] {
    return this.completedTraces.slice(-limit);
  }
  
  /**
   * Get latency statistics
   */
  getStats(): {
    totalTraces: number;
    activeTraces: number;
    completedTraces: number;
    failedTraces: number;
    avgTotalLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    stageStats: Record<string, { avg: number; p95: number; count: number }>;
  } {
    const completed = this.completedTraces.filter(t => t.status === 'completed');
    const failed = this.completedTraces.filter(t => t.status === 'failed');
    
    // Calculate total latency percentiles
    const latencies = completed.map(t => t.totalLatency!).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
    const avgTotal = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    
    // Calculate stage statistics
    const stageStats: Record<string, { durations: number[]; count: number }> = {};
    
    for (const trace of completed) {
      for (const [stageName, stage] of Object.entries(trace.stages)) {
        if (stage && stage.duration !== undefined) {
          if (!stageStats[stageName]) {
            stageStats[stageName] = { durations: [], count: 0 };
          }
          stageStats[stageName].durations.push(stage.duration);
          stageStats[stageName].count++;
        }
      }
    }
    
    const stageStatsFormatted: Record<string, { avg: number; p95: number; count: number }> = {};
    for (const [stageName, data] of Object.entries(stageStats)) {
      const sorted = data.durations.sort((a, b) => a - b);
      stageStatsFormatted[stageName] = {
        avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        count: data.count,
      };
    }
    
    return {
      totalTraces: this.traces.size + this.completedTraces.length,
      activeTraces: this.traces.size,
      completedTraces: completed.length,
      failedTraces: failed.length,
      avgTotalLatency: avgTotal,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      stageStats: stageStatsFormatted,
    };
  }
  
  /**
   * Log trace summary
   */
  private logTraceSummary(trace: LatencyTrace): void {
    const stages = Object.entries(trace.stages)
      .filter(([_, stage]) => stage && stage.duration !== undefined)
      .map(([name, stage]) => `${name}: ${stage!.duration!.toFixed(2)}ms`)
      .join(', ');
    
    console.log(
      `[LatencyTracker] ⚡ ${trace.symbol} ${trace.action} | Total: ${trace.totalLatency!.toFixed(2)}ms | ${stages}`
    );
  }
  
  /**
   * Clear all traces (for testing)
   */
  clearAll(): void {
    this.traces.clear();
    this.completedTraces = [];
  }
}

// Singleton instance
let latencyTrackerInstance: LatencyTracker | null = null;

export function getLatencyTracker(): LatencyTracker {
  if (!latencyTrackerInstance) {
    latencyTrackerInstance = new LatencyTracker();
  }
  return latencyTrackerInstance;
}
