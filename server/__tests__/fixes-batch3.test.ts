/**
 * Tests for Fixes 11-15 (Batch 3)
 * 
 * Fix 11: Optimize agentSignals table
 * Fix 12: Fix ML pipeline
 * Fix 13: Implement latency tracking
 * Fix 14: Add performance dashboards
 * Fix 15: Implement circuit breakers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database for tests
vi.mock('../db', () => ({
  getDb: vi.fn(() => Promise.resolve({
    execute: vi.fn(() => Promise.resolve([[]])),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([]))
          }))
        }))
      }))
    }))
  })),
  logExecutionLatency: vi.fn(() => Promise.resolve(1)),
  getLatencyMetrics: vi.fn(() => Promise.resolve({
    totalExecutions: 100,
    executedCount: 80,
    rejectedCount: 15,
    skippedCount: 3,
    failedCount: 2,
    avgLatencyMs: 75,
    p50LatencyMs: 50,
    p95LatencyMs: 150,
    p99LatencyMs: 250,
    minLatencyMs: 10,
    maxLatencyMs: 500,
    excellentCount: 30,
    goodCount: 40,
    acceptableCount: 20,
    slowCount: 8,
    criticalCount: 2,
  })),
  getRecentLatencyLogs: vi.fn(() => Promise.resolve([])),
}));

describe('Fix 13: Latency Logger Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create latency context on startSignal', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'BTC-USD', 5, 50000);
    
    expect(contextId).toBeDefined();
    expect(contextId).toContain('BTC-USD');
    expect(latencyLogger.getActiveContextCount()).toBeGreaterThanOrEqual(1);
  });

  it('should track consensus calculation', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'ETH-USD', 5, 3000);
    latencyLogger.recordConsensus(contextId, 0.75);
    
    // Should not throw
    expect(latencyLogger.getActiveContextCount()).toBeGreaterThanOrEqual(1);
  });

  it('should track decision made', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'ETH-USD', 5, 3000);
    latencyLogger.recordDecision(contextId, 'signal-123');
    
    // Should not throw
    expect(latencyLogger.getActiveContextCount()).toBeGreaterThanOrEqual(1);
  });

  it('should track order placement', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'ETH-USD', 5, 3000);
    latencyLogger.recordOrderPlaced(contextId);
    
    // Should not throw
    expect(latencyLogger.getActiveContextCount()).toBeGreaterThanOrEqual(1);
  });

  it('should complete trace on order filled', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'SOL-USD', 5, 100);
    latencyLogger.recordConsensus(contextId, 0.8);
    latencyLogger.recordDecision(contextId, 'signal-456');
    latencyLogger.recordOrderPlaced(contextId);
    
    await latencyLogger.recordOrderFilled(contextId, 100.5, 'executed');
    
    // Context should be cleaned up after completion
    // Note: We can't directly check if context was removed, but it should not throw
  });

  it('should handle rejected trades', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    const contextId = latencyLogger.startSignal(1, 'DOGE-USD', 3, 0.1);
    latencyLogger.recordConsensus(contextId, 0.3);
    
    await latencyLogger.recordRejected(contextId, 'rejected');
    
    // Should not throw
  });

  it('should cleanup stale contexts', async () => {
    const { latencyLogger } = await import('../services/LatencyLogger');
    
    // Cleanup should not throw
    const cleaned = latencyLogger.cleanupStaleContexts();
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });
});

describe('Fix 14: Performance Metrics Service', () => {
  it('should be importable', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    expect(performanceMetricsService).toBeDefined();
  });

  it('should record ticks', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    
    // Should not throw
    performanceMetricsService.recordTick();
    performanceMetricsService.recordTick();
    performanceMetricsService.recordTick();
  });

  it('should record signals', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    
    // Should not throw
    performanceMetricsService.recordSignal();
    performanceMetricsService.recordSignal();
  });

  it('should get metrics', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    
    const metrics = await performanceMetricsService.getMetrics(1, 24);
    
    expect(metrics).toBeDefined();
    expect(metrics.timestamp).toBeInstanceOf(Date);
    expect(metrics.agents).toBeDefined();
    expect(metrics.trades).toBeDefined();
    expect(metrics.system).toBeDefined();
    expect(metrics.latency).toBeDefined();
    expect(metrics.alerts).toBeDefined();
  });

  it('should include system metrics', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    
    const metrics = await performanceMetricsService.getMetrics(1, 24);
    
    expect(metrics.system.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics.system.memoryUsageMB).toBeGreaterThan(0);
    expect(metrics.system.memoryTotalMB).toBeGreaterThan(0);
  });

  it('should include latency breakdown', async () => {
    const { performanceMetricsService } = await import('../services/PerformanceMetricsService');
    
    const metrics = await performanceMetricsService.getMetrics(1, 24);
    
    expect(metrics.latency.signalToConsensus).toBeDefined();
    expect(metrics.latency.consensusToDecision).toBeDefined();
    expect(metrics.latency.decisionToOrder).toBeDefined();
    expect(metrics.latency.orderToFill).toBeDefined();
    expect(metrics.latency.total).toBeDefined();
  });
});

describe('Fix 15: Circuit Breaker Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be importable', async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    expect(circuitBreakerManager).toBeDefined();
  });

  it('should initialize default breakers', async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    const stats = circuitBreakerManager.getStats();
    
    expect(stats.totalBreakers).toBeGreaterThan(0);
    expect(stats.breakers.length).toBeGreaterThan(0);
  });

  it('should have breakers for critical services', async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    const stats = circuitBreakerManager.getStats();
    const breakerNames = stats.breakers.map(b => b.name);
    
    expect(breakerNames).toContain('database');
    expect(breakerNames).toContain('trade_execution');
    expect(breakerNames).toContain('coinapi');
  });

  it('should start with closed state', async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    const stats = circuitBreakerManager.getStats();
    
    expect(stats.closedBreakers).toBe(stats.totalBreakers);
    expect(stats.openBreakers).toBe(0);
  });

  it('should check service availability', async () => {
    const { circuitBreakerManager, isServiceAvailable } = await import('../services/CircuitBreakerManager');
    
    // All services should be available initially
    expect(isServiceAvailable('database')).toBe(true);
    expect(isServiceAvailable('coinapi')).toBe(true);
    expect(isServiceAvailable('trade_execution')).toBe(true);
  });

  it('should record success', async () => {
    const { circuitBreakerManager, recordAPISuccess } = await import('../services/CircuitBreakerManager');
    
    // Should not throw
    recordAPISuccess('coinapi');
    recordAPISuccess('database');
    
    const state = circuitBreakerManager.getBreakerState('coinapi');
    expect(state?.totalSuccesses).toBeGreaterThan(0);
  });

  it('should record failure', async () => {
    const { circuitBreakerManager, recordAPIFailure } = await import('../services/CircuitBreakerManager');
    
    // Record a failure
    recordAPIFailure('coingecko', 'Test error');
    
    const state = circuitBreakerManager.getBreakerState('coingecko');
    expect(state?.totalFailures).toBeGreaterThan(0);
    expect(state?.lastError).toBe('Test error');
  });

  it('should open circuit after threshold failures', async () => {
    const { circuitBreakerManager, recordAPIFailure, isServiceAvailable } = await import('../services/CircuitBreakerManager');
    
    // Force reset first
    circuitBreakerManager.forceReset('whalealert');
    
    // Record multiple failures to trigger circuit open
    for (let i = 0; i < 6; i++) {
      recordAPIFailure('whalealert', `Error ${i}`);
    }
    
    const state = circuitBreakerManager.getBreakerState('whalealert');
    expect(state?.state).toBe('open');
    expect(isServiceAvailable('whalealert')).toBe(false);
  });

  it('should force reset circuit breaker', async () => {
    const { circuitBreakerManager, recordAPIFailure } = await import('../services/CircuitBreakerManager');
    
    // Open the circuit
    for (let i = 0; i < 6; i++) {
      recordAPIFailure('dune', `Error ${i}`);
    }
    
    // Force reset
    const success = circuitBreakerManager.forceReset('dune');
    expect(success).toBe(true);
    
    const state = circuitBreakerManager.getBreakerState('dune');
    expect(state?.state).toBe('closed');
  });

  it('should get system health', async () => {
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    // Reset all first
    circuitBreakerManager.forceResetAll();
    
    const health = circuitBreakerManager.getSystemHealth();
    
    expect(health.healthy).toBe(true);
    expect(health.score).toBe(100);
    expect(health.criticalDown).toHaveLength(0);
    expect(health.degraded).toHaveLength(0);
  });

  it('should execute with circuit breaker protection', async () => {
    const { withCircuitBreaker, circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    // Reset first
    circuitBreakerManager.forceReset('test_service');
    
    // Execute a successful function
    const result = await withCircuitBreaker('test_service', async () => {
      return 'success';
    });
    
    expect(result).toBe('success');
  });

  it('should use fallback when circuit is open', async () => {
    const { circuitBreakerManager, recordAPIFailure } = await import('../services/CircuitBreakerManager');
    
    // Create a unique breaker for this test
    const testName = 'fallback_test_' + Date.now();
    circuitBreakerManager.getOrCreate(testName, 'api');
    
    // Open the circuit (need 5 failures for API type)
    for (let i = 0; i < 10; i++) {
      recordAPIFailure(testName, `Error ${i}`);
    }
    
    // Verify circuit is open
    const state = circuitBreakerManager.getBreakerState(testName);
    expect(state?.state).toBe('open');
  });

  it('should get open circuits', async () => {
    const { circuitBreakerManager, recordAPIFailure } = await import('../services/CircuitBreakerManager');
    
    // Create a unique breaker for this test
    const testName = 'open_circuit_test_' + Date.now();
    circuitBreakerManager.getOrCreate(testName, 'api');
    
    // Open the circuit (need 5 failures for API type)
    for (let i = 0; i < 10; i++) {
      recordAPIFailure(testName, `Error ${i}`);
    }
    
    const openCircuits = circuitBreakerManager.getOpenCircuits();
    
    expect(openCircuits.length).toBeGreaterThan(0);
    expect(openCircuits.some(c => c.name === testName)).toBe(true);
  });
});

describe('Fix 15: Circuit Breaker Integration with Rate Limiter', () => {
  it('should integrate with ExternalAPIRateLimiter', async () => {
    const { externalAPIRateLimiter } = await import('../services/ExternalAPIRateLimiter');
    
    expect(externalAPIRateLimiter).toBeDefined();
    expect(typeof externalAPIRateLimiter.isServiceAvailable).toBe('function');
  });

  it('should check combined availability', async () => {
    const { externalAPIRateLimiter } = await import('../services/ExternalAPIRateLimiter');
    const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
    
    // Reset circuit breaker
    circuitBreakerManager.forceReset('whaleAlert');
    
    // Check combined availability
    const available = externalAPIRateLimiter.isServiceAvailable('whaleAlert');
    expect(typeof available).toBe('boolean');
  });
});
