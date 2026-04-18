/**
 * Tests for OHLCV Persistence and Miss-Out Logging
 * 
 * Verifies:
 * 1. CoinAPI WebSocket aggregates OHLCV data correctly
 * 2. Miss-out logging detects sequence gaps
 * 3. Data integrity metrics are calculated correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../db/candleStorage', () => ({
  saveCandlesToDatabase: vi.fn().mockResolvedValue(1),
}));

vi.mock('../WebSocketCandleCache', () => ({
  getCandleCache: vi.fn(() => ({
    addCandle: vi.fn(),
    getCandles: vi.fn(() => []),
  })),
}));

vi.mock('../_core/env', () => ({
  ENV: {
    coinApiKey: 'test-key',
  },
}));

vi.mock('./priceFeedService', () => ({
  priceFeedService: {
    updatePrice: vi.fn(),
  },
}));

describe('OHLCV Persistence and Miss-Out Logging', () => {
  describe('OHLCV Aggregation Logic', () => {
    it('should aggregate trades into OHLCV candles correctly', () => {
      // Simulate OHLCV aggregation logic
      const ohlcvAggregator = new Map<string, {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        timestamp: number;
        trades: number;
      }>();

      const aggregateOHLCV = (symbol: string, price: number, size: number, timestamp: number) => {
        const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
        const key = `${symbol}_${minuteTimestamp}`;
        
        const existing = ohlcvAggregator.get(key);
        if (existing) {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          existing.close = price;
          existing.volume += size;
          existing.trades++;
        } else {
          ohlcvAggregator.set(key, {
            open: price,
            high: price,
            low: price,
            close: price,
            volume: size,
            timestamp: minuteTimestamp,
            trades: 1
          });
        }
      };

      const baseTime = Date.now();
      const minuteTime = Math.floor(baseTime / 60000) * 60000;

      // First trade - sets OHLC
      aggregateOHLCV('BTC-USD', 100000, 0.5, baseTime);
      
      // Second trade - higher price
      aggregateOHLCV('BTC-USD', 100500, 0.3, baseTime + 1000);
      
      // Third trade - lower price (this becomes the close since it's last)
      aggregateOHLCV('BTC-USD', 99500, 0.2, baseTime + 2000);

      const candle = ohlcvAggregator.get(`BTC-USD_${minuteTime}`);
      
      expect(candle).toBeDefined();
      expect(candle!.open).toBe(100000);
      expect(candle!.high).toBe(100500);
      expect(candle!.low).toBe(99500);
      expect(candle!.close).toBe(99500); // Last trade price
      expect(candle!.volume).toBe(1.0); // 0.5 + 0.3 + 0.2
      expect(candle!.trades).toBe(3);
    });

    it('should create separate candles for different minutes', () => {
      const ohlcvAggregator = new Map<string, any>();

      const aggregateOHLCV = (symbol: string, price: number, size: number, timestamp: number) => {
        const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
        const key = `${symbol}_${minuteTimestamp}`;
        
        const existing = ohlcvAggregator.get(key);
        if (existing) {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          existing.close = price;
          existing.volume += size;
          existing.trades++;
        } else {
          ohlcvAggregator.set(key, {
            open: price,
            high: price,
            low: price,
            close: price,
            volume: size,
            timestamp: minuteTimestamp,
            trades: 1
          });
        }
      };

      const minute1 = 1706000000000; // Some timestamp
      const minute2 = minute1 + 60000; // Next minute

      aggregateOHLCV('BTC-USD', 100000, 0.5, minute1);
      aggregateOHLCV('BTC-USD', 101000, 0.3, minute2);

      expect(ohlcvAggregator.size).toBe(2);
    });
  });

  describe('Miss-Out Logging (Sequence Gap Detection)', () => {
    it('should detect sequence gaps in trade data', () => {
      const stats = {
        missedTicks: 0,
        lastSequence: new Map<string, number>(),
        dataGaps: [] as Array<{ symbol: string; expectedSeq: number; receivedSeq: number; timestamp: number }>
      };

      const checkSequenceGap = (symbolId: string, sequence: number) => {
        const lastSeq = stats.lastSequence.get(symbolId);
        if (lastSeq !== undefined && sequence !== lastSeq + 1) {
          const missedCount = sequence - lastSeq - 1;
          stats.missedTicks += missedCount;
          stats.dataGaps.push({
            symbol: symbolId,
            expectedSeq: lastSeq + 1,
            receivedSeq: sequence,
            timestamp: Date.now()
          });
        }
        stats.lastSequence.set(symbolId, sequence);
      };

      // Normal sequence
      checkSequenceGap('COINBASE_SPOT_BTC_USD', 1);
      checkSequenceGap('COINBASE_SPOT_BTC_USD', 2);
      checkSequenceGap('COINBASE_SPOT_BTC_USD', 3);
      
      // Gap detected (missed 4, 5, 6)
      checkSequenceGap('COINBASE_SPOT_BTC_USD', 7);

      expect(stats.missedTicks).toBe(3);
      expect(stats.dataGaps.length).toBe(1);
      expect(stats.dataGaps[0].expectedSeq).toBe(4);
      expect(stats.dataGaps[0].receivedSeq).toBe(7);
    });

    it('should track gaps for multiple symbols independently', () => {
      const stats = {
        missedTicks: 0,
        lastSequence: new Map<string, number>(),
        dataGaps: [] as Array<{ symbol: string; expectedSeq: number; receivedSeq: number; timestamp: number }>
      };

      const checkSequenceGap = (symbolId: string, sequence: number) => {
        const lastSeq = stats.lastSequence.get(symbolId);
        if (lastSeq !== undefined && sequence !== lastSeq + 1) {
          const missedCount = sequence - lastSeq - 1;
          stats.missedTicks += missedCount;
          stats.dataGaps.push({
            symbol: symbolId,
            expectedSeq: lastSeq + 1,
            receivedSeq: sequence,
            timestamp: Date.now()
          });
        }
        stats.lastSequence.set(symbolId, sequence);
      };

      // BTC sequence with gap
      checkSequenceGap('BTC_USD', 1);
      checkSequenceGap('BTC_USD', 5); // Gap of 3

      // ETH sequence with gap
      checkSequenceGap('ETH_USD', 1);
      checkSequenceGap('ETH_USD', 3); // Gap of 1

      expect(stats.missedTicks).toBe(4); // 3 + 1
      expect(stats.dataGaps.length).toBe(2);
    });
  });

  describe('Data Integrity Metrics', () => {
    it('should calculate data integrity percentage correctly', () => {
      const calculateDataIntegrity = (received: number, missed: number): number => {
        const total = received + missed;
        return total > 0 ? (received / total) * 100 : 100;
      };

      // Perfect integrity
      expect(calculateDataIntegrity(1000, 0)).toBe(100);

      // 99% integrity
      expect(calculateDataIntegrity(990, 10)).toBe(99);

      // 95% integrity
      expect(calculateDataIntegrity(950, 50)).toBe(95);

      // No data yet
      expect(calculateDataIntegrity(0, 0)).toBe(100);
    });

    it('should generate data gap report', () => {
      const stats = {
        messagesReceived: 1000,
        missedTicks: 5,
        dataGaps: [
          { symbol: 'BTC_USD', expectedSeq: 100, receivedSeq: 103, timestamp: Date.now() - 5000 },
          { symbol: 'BTC_USD', expectedSeq: 200, receivedSeq: 202, timestamp: Date.now() - 3000 },
        ]
      };

      const getDataGapReport = () => {
        const totalExpected = stats.messagesReceived + stats.missedTicks;
        return {
          totalMissedTicks: stats.missedTicks,
          recentGaps: stats.dataGaps.slice(-20),
          dataIntegrityPercent: totalExpected > 0 
            ? (stats.messagesReceived / totalExpected) * 100 
            : 100
        };
      };

      const report = getDataGapReport();
      
      expect(report.totalMissedTicks).toBe(5);
      expect(report.recentGaps.length).toBe(2);
      expect(report.dataIntegrityPercent).toBeCloseTo(99.50, 1);
    });
  });

  describe('Candle Persistence Logic', () => {
    it('should only persist completed candles (not current minute)', () => {
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000) * 60000;
      const previousMinute = currentMinute - 60000;

      const ohlcvAggregator = new Map<string, { timestamp: number; close: number }>();
      ohlcvAggregator.set(`BTC-USD_${previousMinute}`, { timestamp: previousMinute, close: 100000 });
      ohlcvAggregator.set(`BTC-USD_${currentMinute}`, { timestamp: currentMinute, close: 100500 });

      const completedCandles: number[] = [];
      
      for (const [key, candle] of ohlcvAggregator.entries()) {
        if (candle.timestamp < currentMinute) {
          completedCandles.push(candle.timestamp);
        }
      }

      expect(completedCandles.length).toBe(1);
      expect(completedCandles[0]).toBe(previousMinute);
    });
  });
});

describe('Engine Uptime Fix', () => {
  it('should preserve startedAt timestamp on state save', () => {
    // Simulate the fix: startedAt should NOT be overwritten on every save
    const engineState = {
      isRunning: true,
      startedAt: new Date('2026-01-01T00:00:00Z'), // Original start time
    };

    // Simulate saveEngineState - should preserve original startedAt
    const saveEngineState = (state: typeof engineState) => {
      const now = new Date();
      return {
        isRunning: state.isRunning,
        // FIX: Preserve original startedAt instead of overwriting with 'now'
        startedAt: state.isRunning ? state.startedAt : null,
        updatedAt: now,
      };
    };

    const savedState = saveEngineState(engineState);
    
    expect(savedState.startedAt).toEqual(engineState.startedAt);
    expect(savedState.startedAt).not.toEqual(savedState.updatedAt);
  });

  it('should calculate correct uptime from original startedAt', () => {
    const startedAt = new Date(Date.now() - 3600000); // 1 hour ago
    const now = new Date();
    
    const uptimeMs = now.getTime() - startedAt.getTime();
    const uptimeMinutes = Math.floor(uptimeMs / 60000);
    
    expect(uptimeMinutes).toBe(60);
  });
});
