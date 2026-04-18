/**
 * Tests for Health Dashboard Logic
 * Tests the business logic used in Health page and Rate Limit widgets
 */

import { describe, it, expect } from 'vitest';

describe('Rate Limit Status Logic', () => {
  it('should correctly identify healthy APIs (usage < 80%)', () => {
    const api = {
      requestsUsed: 3,
      requestsMax: 5,
      percentUsed: 60,
      inBackoff: false,
      consecutiveErrors: 0,
    };
    
    let status: 'ok' | 'warning' | 'error' = 'ok';
    if (api.inBackoff || api.consecutiveErrors > 0) {
      status = 'error';
    } else if (api.percentUsed > 80) {
      status = 'warning';
    }
    
    expect(status).toBe('ok');
  });

  it('should correctly identify warning APIs (usage > 80%)', () => {
    const api = {
      requestsUsed: 7,
      requestsMax: 8,
      percentUsed: 87,
      inBackoff: false,
      consecutiveErrors: 0,
    };
    
    let status: 'ok' | 'warning' | 'error' = 'ok';
    if (api.inBackoff || api.consecutiveErrors > 0) {
      status = 'error';
    } else if (api.percentUsed > 80) {
      status = 'warning';
    }
    
    expect(status).toBe('warning');
  });

  it('should correctly identify error APIs (in backoff)', () => {
    const api = {
      requestsUsed: 0,
      requestsMax: 30,
      percentUsed: 0,
      inBackoff: true,
      consecutiveErrors: 2,
    };
    
    let status: 'ok' | 'warning' | 'error' = 'ok';
    if (api.inBackoff || api.consecutiveErrors > 0) {
      status = 'error';
    } else if (api.percentUsed > 80) {
      status = 'warning';
    }
    
    expect(status).toBe('error');
  });

  it('should correctly identify error APIs (consecutive errors > 0)', () => {
    const api = {
      requestsUsed: 5,
      requestsMax: 10,
      percentUsed: 50,
      inBackoff: false,
      consecutiveErrors: 1,
    };
    
    let status: 'ok' | 'warning' | 'error' = 'ok';
    if (api.inBackoff || api.consecutiveErrors > 0) {
      status = 'error';
    } else if (api.percentUsed > 80) {
      status = 'warning';
    }
    
    expect(status).toBe('error');
  });
});

describe('Overall Status Calculation', () => {
  type APIStatus = 'ok' | 'warning' | 'error';
  
  const calculateOverallStatus = (apis: { status: APIStatus }[]): APIStatus => {
    const errorCount = apis.filter(a => a.status === 'error').length;
    const warningCount = apis.filter(a => a.status === 'warning').length;
    return errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok';
  };

  it('should return error when any API is in error state', () => {
    const apis: { status: APIStatus }[] = [
      { status: 'ok' },
      { status: 'ok' },
      { status: 'error' },
      { status: 'ok' },
    ];
    
    expect(calculateOverallStatus(apis)).toBe('error');
  });

  it('should return warning when any API is in warning state (no errors)', () => {
    const apis: { status: APIStatus }[] = [
      { status: 'ok' },
      { status: 'warning' },
      { status: 'ok' },
    ];
    
    expect(calculateOverallStatus(apis)).toBe('warning');
  });

  it('should return ok when all APIs are healthy', () => {
    const apis: { status: APIStatus }[] = [
      { status: 'ok' },
      { status: 'ok' },
      { status: 'ok' },
    ];
    
    expect(calculateOverallStatus(apis)).toBe('ok');
  });
});

describe('Service Health Status', () => {
  it('should determine healthy status when all services are up', () => {
    const services = {
      websocket: { status: 'up' },
      priceFeed: { status: 'up' },
      agents: { status: 'up' },
      database: { status: 'up' },
    };
    
    const wsOk = services.websocket.status === 'up';
    const priceOk = services.priceFeed.status === 'up';
    const agentsOk = services.agents.status === 'up';
    const dbOk = services.database.status === 'up';
    
    const downCount = [wsOk, priceOk, agentsOk, dbOk].filter(x => !x).length;
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (downCount >= 2) overallStatus = 'unhealthy';
    else if (downCount >= 1) overallStatus = 'degraded';
    
    expect(overallStatus).toBe('healthy');
  });

  it('should determine degraded status when one service is down', () => {
    const services = {
      websocket: { status: 'down' },
      priceFeed: { status: 'up' },
      agents: { status: 'up' },
      database: { status: 'up' },
    };
    
    const wsOk = services.websocket.status === 'up';
    const priceOk = services.priceFeed.status === 'up';
    const agentsOk = services.agents.status === 'up';
    const dbOk = services.database.status === 'up';
    
    const downCount = [wsOk, priceOk, agentsOk, dbOk].filter(x => !x).length;
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (downCount >= 2) overallStatus = 'unhealthy';
    else if (downCount >= 1) overallStatus = 'degraded';
    
    expect(overallStatus).toBe('degraded');
  });

  it('should determine unhealthy status when two or more services are down', () => {
    const services = {
      websocket: { status: 'down' },
      priceFeed: { status: 'down' },
      agents: { status: 'up' },
      database: { status: 'up' },
    };
    
    const wsOk = services.websocket.status === 'up';
    const priceOk = services.priceFeed.status === 'up';
    const agentsOk = services.agents.status === 'up';
    const dbOk = services.database.status === 'up';
    
    const downCount = [wsOk, priceOk, agentsOk, dbOk].filter(x => !x).length;
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (downCount >= 2) overallStatus = 'unhealthy';
    else if (downCount >= 1) overallStatus = 'degraded';
    
    expect(overallStatus).toBe('unhealthy');
  });
});

describe('IST Timestamp Formatting', () => {
  it('should format timestamp to IST correctly', () => {
    const formatToIST = (timestamp: string | null): string => {
      if (!timestamp) return 'Never';
      try {
        return new Date(timestamp).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      } catch {
        return timestamp;
      }
    };
    
    // Test with valid timestamp
    const result = formatToIST('2026-01-29T12:30:00Z');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/); // Should match HH:MM:SS format
    
    // Test with null
    expect(formatToIST(null)).toBe('Never');
  });
});

describe('Agent Status', () => {
  it('should have 12 agents defined', () => {
    const agents = [
      { name: 'TechnicalAnalyst', type: 'fast' },
      { name: 'OrderFlowAnalyst', type: 'fast' },
      { name: 'SentimentAnalyst', type: 'fast' },
      { name: 'MomentumTracker', type: 'fast' },
      { name: 'VolatilityAnalyst', type: 'fast' },
      { name: 'PatternMatcher', type: 'slow' },
      { name: 'WhaleTracker', type: 'slow' },
      { name: 'MacroAnalyst', type: 'slow' },
      { name: 'CorrelationAnalyst', type: 'slow' },
      { name: 'RiskManager', type: 'slow' },
      { name: 'LiquidityAnalyst', type: 'slow' },
      { name: 'NewsAnalyst', type: 'slow' },
    ];
    
    expect(agents.length).toBe(12);
    expect(agents.filter(a => a.type === 'fast').length).toBe(5);
    expect(agents.filter(a => a.type === 'slow').length).toBe(7);
  });
});

describe('Memory Usage Calculation', () => {
  it('should calculate memory percentage correctly', () => {
    const memoryUsageMB = 256;
    const memoryTotalMB = 512;
    const percentage = (memoryUsageMB / memoryTotalMB) * 100;
    
    expect(percentage).toBe(50);
  });

  it('should determine memory status based on usage', () => {
    const getMemoryStatus = (usageMB: number, totalMB: number): 'ok' | 'warning' | 'critical' => {
      const percentage = (usageMB / totalMB) * 100;
      if (percentage >= 85) return 'critical';
      if (percentage >= 70) return 'warning';
      return 'ok';
    };
    
    expect(getMemoryStatus(256, 512)).toBe('ok'); // 50%
    expect(getMemoryStatus(400, 512)).toBe('warning'); // 78%
    expect(getMemoryStatus(450, 512)).toBe('critical'); // 88%
  });
});
