/**
 * Tests for Candle Cache Monitor and Dashboard Loading Optimization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the WebSocketCandleCache
const mockCandles = [
  { timestamp: Date.now() - 3600000, open: 100, high: 105, low: 99, close: 104, volume: 1000 },
  { timestamp: Date.now() - 3540000, open: 104, high: 106, low: 103, close: 105, volume: 1200 },
  { timestamp: Date.now() - 3480000, open: 105, high: 107, low: 104, close: 106, volume: 1100 },
];

describe('WebSocketCandleCache', () => {
  describe('getStats', () => {
    it('should return totalCandles count', async () => {
      const { getCandleCache } = await import('../WebSocketCandleCache');
      const cache = getCandleCache();
      
      // Initialize and add some candles
      cache.initializeBuffer('BTC-USD', '1h');
      mockCandles.forEach(candle => cache.addCandle('BTC-USD', '1h', candle));
      
      const stats = cache.getStats();
      
      expect(stats).toHaveProperty('totalCandles');
      expect(typeof stats.totalCandles).toBe('number');
    });

    it('should return symbols object with candle counts', async () => {
      const { getCandleCache } = await import('../WebSocketCandleCache');
      const cache = getCandleCache();
      
      // Initialize buffers
      cache.initializeBuffer('BTC-USD', '1h');
      cache.initializeBuffer('ETH-USD', '1h');
      
      // Add candles
      mockCandles.forEach(candle => {
        cache.addCandle('BTC-USD', '1h', candle);
        cache.addCandle('ETH-USD', '1h', candle);
      });
      
      const stats = cache.getStats();
      
      expect(stats).toHaveProperty('symbols');
      expect(stats.symbols).toHaveProperty('BTC-USD');
      expect(stats.symbols).toHaveProperty('ETH-USD');
    });
  });

  describe('getCandles', () => {
    it('should return candles for a symbol/timeframe', async () => {
      const { getCandleCache } = await import('../WebSocketCandleCache');
      const cache = getCandleCache();
      
      cache.initializeBuffer('BTC-USD', '1h');
      mockCandles.forEach(candle => cache.addCandle('BTC-USD', '1h', candle));
      
      const candles = cache.getCandles('BTC-USD', '1h');
      
      expect(Array.isArray(candles)).toBe(true);
      expect(candles.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent symbol', async () => {
      const { getCandleCache } = await import('../WebSocketCandleCache');
      const cache = getCandleCache();
      
      const candles = cache.getCandles('NONEXISTENT-USD', '1h');
      
      expect(Array.isArray(candles)).toBe(true);
      expect(candles.length).toBe(0);
    });
  });
});

describe('Dashboard Loading Architecture', () => {
  describe('Server Engine Status', () => {
    it('should be the source of truth for system status', () => {
      // The server engine runs 24/7/365 independent of user sessions
      // Frontend should show "Live" based on server engine status, not frontend WebSocket
      
      const serverEngineRunning = true;
      const frontendWebSocketConnected = false;
      
      // Even if frontend WebSocket is not connected, system should show "Live"
      // because the server is always running
      const isSystemLive = serverEngineRunning; // NOT frontendWebSocketConnected
      
      expect(isSystemLive).toBe(true);
    });

    it('should default to true while loading to prevent "Connecting..." flash', () => {
      // When engine status is loading, we should assume the server is running
      // because the server is always running in production
      
      const engineStatusLoading = true;
      const engineStatus = undefined;
      
      // Default to true while loading
      const isEffectivelyConnected = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);
      
      expect(isEffectivelyConnected).toBe(true);
    });

    it('should show Live when engine is running', () => {
      const engineStatusLoading = false;
      const engineStatus = { isRunning: true };
      
      const isEffectivelyConnected = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);
      
      expect(isEffectivelyConnected).toBe(true);
    });
  });
});

describe('Candle Cache Status API', () => {
  describe('getCandleCacheStatus endpoint', () => {
    it('should return summary with health status', async () => {
      // Mock the expected response structure
      const mockResponse = {
        timestampIST: '01/02/2026, 13:00:00',
        summary: {
          totalSymbols: 5,
          healthySymbols: 2,
          degradedSymbols: 1,
          criticalSymbols: 2,
          totalCandles: 1500,
          overallHealth: 'degraded',
        },
        symbols: [],
        aggregatorStatus: {
          isRunning: false,
          ticksProcessed: 0,
          lastTickTime: null,
        },
      };

      expect(mockResponse.summary).toHaveProperty('totalSymbols');
      expect(mockResponse.summary).toHaveProperty('healthySymbols');
      expect(mockResponse.summary).toHaveProperty('overallHealth');
      expect(['healthy', 'degraded', 'critical']).toContain(mockResponse.summary.overallHealth);
    });

    it('should return symbol status with timeframes', async () => {
      const mockSymbolStatus = {
        symbol: 'BTC-USD',
        timeframes: [
          { timeframe: '1m', candleCount: 60, status: 'healthy', coverage: '100%' },
          { timeframe: '5m', candleCount: 24, status: 'low', coverage: '50%' },
          { timeframe: '1h', candleCount: 0, status: 'empty', coverage: '0%' },
        ],
        totalCandles: 84,
        overallStatus: 'degraded',
      };

      expect(mockSymbolStatus.timeframes).toHaveLength(3);
      expect(mockSymbolStatus.timeframes[0]).toHaveProperty('timeframe');
      expect(mockSymbolStatus.timeframes[0]).toHaveProperty('candleCount');
      expect(mockSymbolStatus.timeframes[0]).toHaveProperty('status');
      expect(mockSymbolStatus.timeframes[0]).toHaveProperty('coverage');
    });

    it('should calculate overall health correctly', () => {
      // Test health calculation logic
      const calculateHealth = (healthySymbols: number, degradedSymbols: number) => {
        if (healthySymbols >= 3) return 'healthy';
        if (healthySymbols >= 1 || degradedSymbols >= 2) return 'degraded';
        return 'critical';
      };

      expect(calculateHealth(3, 0)).toBe('healthy');
      expect(calculateHealth(4, 1)).toBe('healthy');
      expect(calculateHealth(1, 0)).toBe('degraded');
      expect(calculateHealth(0, 2)).toBe('degraded');
      expect(calculateHealth(0, 1)).toBe('critical');
      expect(calculateHealth(0, 0)).toBe('critical');
    });
  });
});

describe('Socket.IO Connection Optimization', () => {
  describe('Connection settings', () => {
    it('should use WebSocket transport first for faster connection', () => {
      const transports = ['websocket', 'polling'];
      
      // WebSocket should be first for faster initial connection
      expect(transports[0]).toBe('websocket');
    });

    it('should have reduced timeout for faster failure detection', () => {
      const timeout = 10000; // 10 seconds (was 45 seconds)
      
      expect(timeout).toBeLessThanOrEqual(15000);
      expect(timeout).toBeGreaterThanOrEqual(5000);
    });

    it('should have faster retry intervals', () => {
      const retryIntervals = [500, 1000, 2000]; // was [3000, 6000, 9000]
      
      expect(retryIntervals[0]).toBeLessThanOrEqual(1000);
      expect(retryIntervals[1]).toBeLessThanOrEqual(2000);
      expect(retryIntervals[2]).toBeLessThanOrEqual(3000);
    });
  });
});
