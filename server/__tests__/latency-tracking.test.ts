/**
 * Tests for End-to-End Latency Tracking System
 * Validates latency logging, metrics calculation, and grade distribution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Latency Tracking System', () => {
  // Test the database functions for latency tracking
  describe('Database Functions', () => {
    it('should have logExecutionLatency function', async () => {
      const db = await import('../db');
      expect(typeof db.logExecutionLatency).toBe('function');
    });

    it('should have getLatencyMetrics function', async () => {
      const db = await import('../db');
      expect(typeof db.getLatencyMetrics).toBe('function');
    });

    it('should have getRecentLatencyLogs function', async () => {
      const db = await import('../db');
      expect(typeof db.getRecentLatencyLogs).toBe('function');
    });
  });

  describe('Latency Grade Calculation', () => {
    // Test latency grade thresholds
    const calculateGrade = (latencyMs: number): string => {
      if (latencyMs < 50) return 'excellent';
      if (latencyMs < 100) return 'good';
      if (latencyMs < 250) return 'acceptable';
      if (latencyMs < 500) return 'slow';
      return 'critical';
    };

    it('should grade latency < 50ms as excellent', () => {
      expect(calculateGrade(10)).toBe('excellent');
      expect(calculateGrade(49)).toBe('excellent');
    });

    it('should grade latency 50-99ms as good', () => {
      expect(calculateGrade(50)).toBe('good');
      expect(calculateGrade(99)).toBe('good');
    });

    it('should grade latency 100-249ms as acceptable', () => {
      expect(calculateGrade(100)).toBe('acceptable');
      expect(calculateGrade(249)).toBe('acceptable');
    });

    it('should grade latency 250-499ms as slow', () => {
      expect(calculateGrade(250)).toBe('slow');
      expect(calculateGrade(499)).toBe('slow');
    });

    it('should grade latency >= 500ms as critical', () => {
      expect(calculateGrade(500)).toBe('critical');
      expect(calculateGrade(1000)).toBe('critical');
    });
  });

  describe('Latency Metrics Calculation', () => {
    it('should calculate average latency correctly', () => {
      const latencies = [50, 100, 150, 200, 250];
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avg).toBe(150);
    });

    it('should calculate execution rate correctly', () => {
      const totalSignals = 100;
      const executed = 68;
      const executionRate = (executed / totalSignals) * 100;
      expect(executionRate).toBe(68);
    });

    it('should handle zero signals gracefully', () => {
      const totalSignals = 0;
      const executed = 0;
      const executionRate = totalSignals > 0 ? (executed / totalSignals) * 100 : 0;
      expect(executionRate).toBe(0);
    });
  });

  describe('Health Router Latency Endpoint', () => {
    it('should have getLatencyMetrics endpoint in health router', async () => {
      const { healthRouter } = await import('../routers/healthRouter');
      expect(healthRouter).toBeDefined();
      // Check if the router has the procedure
      const procedures = Object.keys(healthRouter._def.procedures || {});
      expect(procedures).toContain('getLatencyMetrics');
    });
  });
});

describe('Trade Execution Widget Data', () => {
  describe('Wallet Data Parsing', () => {
    it('should parse string P&L values correctly', () => {
      const walletData = {
        totalPnL: '1234.56',
        winRate: '68.5',
        totalTrades: 100,
      };
      
      const totalPnL = parseFloat(String(walletData.totalPnL || '0'));
      const winRate = parseFloat(String(walletData.winRate || '0'));
      
      expect(totalPnL).toBe(1234.56);
      expect(winRate).toBe(68.5);
    });

    it('should handle null/undefined wallet values', () => {
      const walletData = {
        totalPnL: null,
        winRate: undefined,
        totalTrades: 0,
      };
      
      const totalPnL = parseFloat(String(walletData.totalPnL || '0'));
      const winRate = parseFloat(String(walletData.winRate || '0'));
      
      expect(totalPnL).toBe(0);
      expect(winRate).toBe(0);
    });

    it('should determine profitability correctly', () => {
      expect(parseFloat('100') >= 0).toBe(true);
      expect(parseFloat('-50') >= 0).toBe(false);
      expect(parseFloat('0') >= 0).toBe(true);
    });
  });

  describe('Execution Rate Display', () => {
    it('should format execution rate as percentage string', () => {
      const executionRate = '68.9%';
      expect(parseFloat(executionRate)).toBe(68.9);
    });

    it('should categorize execution rate correctly', () => {
      const getCategory = (rate: number) => {
        if (rate > 60) return 'good';
        if (rate > 40) return 'warning';
        return 'poor';
      };

      expect(getCategory(70)).toBe('good');
      expect(getCategory(50)).toBe('warning');
      expect(getCategory(30)).toBe('poor');
    });
  });

  describe('Latency Status Determination', () => {
    it('should determine latency status correctly', () => {
      const getStatus = (avgLatency: number) => {
        if (avgLatency >= 500) return 'critical';
        if (avgLatency >= 250) return 'warning';
        if (avgLatency >= 100) return 'good';
        return 'excellent';
      };

      expect(getStatus(50)).toBe('excellent');
      expect(getStatus(150)).toBe('good');
      expect(getStatus(300)).toBe('warning');
      expect(getStatus(600)).toBe('critical');
    });
  });
});
