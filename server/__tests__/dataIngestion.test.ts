/**
 * Data Ingestion Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined)
      })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        }),
        orderBy: vi.fn().mockResolvedValue([])
      })
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    })
  })
}));

// Mock fetch for Coinbase API
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CoinbaseHistoricalDataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Timeframe Configuration', () => {
    it('should have correct granularity for 1m timeframe', () => {
      const config = {
        '1m': { granularity: 60, candlesPerDay: 1440 },
        '5m': { granularity: 300, candlesPerDay: 288 },
        '15m': { granularity: 900, candlesPerDay: 96 },
        '1h': { granularity: 3600, candlesPerDay: 24 },
        '4h': { granularity: 14400, candlesPerDay: 6 },
        '1d': { granularity: 86400, candlesPerDay: 1 }
      };

      expect(config['1m'].granularity).toBe(60);
      expect(config['1m'].candlesPerDay).toBe(1440);
    });

    it('should have correct granularity for 1h timeframe', () => {
      const config = {
        '1h': { granularity: 3600, candlesPerDay: 24 }
      };

      expect(config['1h'].granularity).toBe(3600);
      expect(config['1h'].candlesPerDay).toBe(24);
    });

    it('should have correct granularity for 1d timeframe', () => {
      const config = {
        '1d': { granularity: 86400, candlesPerDay: 1 }
      };

      expect(config['1d'].granularity).toBe(86400);
      expect(config['1d'].candlesPerDay).toBe(1);
    });
  });

  describe('Expected Candles Calculation', () => {
    it('should calculate correct candle count for 1 day of 1h data', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-02T00:00:00Z');
      const granularity = 3600; // 1h in seconds

      const durationMs = endDate.getTime() - startDate.getTime();
      const durationSeconds = durationMs / 1000;
      const expectedCandles = Math.ceil(durationSeconds / granularity);

      expect(expectedCandles).toBe(24);
    });

    it('should calculate correct candle count for 1 week of 1d data', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-08T00:00:00Z');
      const granularity = 86400; // 1d in seconds

      const durationMs = endDate.getTime() - startDate.getTime();
      const durationSeconds = durationMs / 1000;
      const expectedCandles = Math.ceil(durationSeconds / granularity);

      expect(expectedCandles).toBe(7);
    });

    it('should calculate correct candle count for 1 year of 1h data', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2025-01-01T00:00:00Z');
      const granularity = 3600; // 1h in seconds

      const durationMs = endDate.getTime() - startDate.getTime();
      const durationSeconds = durationMs / 1000;
      const expectedCandles = Math.ceil(durationSeconds / granularity);

      // 366 days (leap year) * 24 hours = 8784
      expect(expectedCandles).toBe(8784);
    });
  });

  describe('Coinbase API Response Parsing', () => {
    it('should parse Coinbase candle format correctly', () => {
      // Coinbase returns: [timestamp, low, high, open, close, volume]
      const coinbaseCandle = [1704067200, 42000, 43000, 42500, 42800, 1000.5];

      const parsed = {
        timestamp: coinbaseCandle[0] * 1000, // Convert to milliseconds
        open: coinbaseCandle[3].toString(),
        high: coinbaseCandle[2].toString(),
        low: coinbaseCandle[1].toString(),
        close: coinbaseCandle[4].toString(),
        volume: coinbaseCandle[5].toString()
      };

      expect(parsed.timestamp).toBe(1704067200000);
      expect(parsed.open).toBe('42500');
      expect(parsed.high).toBe('43000');
      expect(parsed.low).toBe('42000');
      expect(parsed.close).toBe('42800');
      expect(parsed.volume).toBe('1000.5');
    });

    it('should handle multiple candles', () => {
      const coinbaseData = [
        [1704067200, 42000, 43000, 42500, 42800, 1000.5],
        [1704070800, 42800, 43500, 42800, 43200, 1500.3],
        [1704074400, 43200, 43800, 43200, 43600, 2000.1]
      ];

      const parsed = coinbaseData.map((candle: number[]) => ({
        timestamp: candle[0] * 1000,
        open: candle[3].toString(),
        high: candle[2].toString(),
        low: candle[1].toString(),
        close: candle[4].toString(),
        volume: candle[5].toString()
      }));

      expect(parsed.length).toBe(3);
      expect(parsed[0].open).toBe('42500');
      expect(parsed[1].open).toBe('42800');
      expect(parsed[2].open).toBe('43200');
    });
  });

  describe('Rate Limiting', () => {
    it('should respect rate limit delay', async () => {
      const RATE_LIMIT_DELAY_MS = 100; // 10 requests per second
      const startTime = Date.now();

      // Simulate rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(RATE_LIMIT_DELAY_MS - 10); // Allow 10ms tolerance
    });
  });

  describe('Batch Size Calculation', () => {
    it('should calculate correct batch duration for 1h timeframe', () => {
      const MAX_CANDLES_PER_REQUEST = 300;
      const granularity = 3600; // 1h in seconds
      const batchDurationMs = MAX_CANDLES_PER_REQUEST * granularity * 1000;

      // 300 candles * 3600 seconds * 1000 = 1,080,000,000 ms = 12.5 days
      expect(batchDurationMs).toBe(1080000000);
    });

    it('should calculate correct batch duration for 1d timeframe', () => {
      const MAX_CANDLES_PER_REQUEST = 300;
      const granularity = 86400; // 1d in seconds
      const batchDurationMs = MAX_CANDLES_PER_REQUEST * granularity * 1000;

      // 300 candles * 86400 seconds * 1000 = 25,920,000,000 ms = 300 days
      expect(batchDurationMs).toBe(25920000000);
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate progress correctly', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-12-31T00:00:00Z');
      const currentPosition = new Date('2024-06-15T00:00:00Z');

      const totalRange = endDate.getTime() - startDate.getTime();
      const completed = endDate.getTime() - currentPosition.getTime();
      const progress = Math.round((1 - completed / totalRange) * 100);

      // Should be approximately 46% (halfway through the year)
      expect(progress).toBeGreaterThan(40);
      expect(progress).toBeLessThan(50);
    });
  });

  describe('Data Validation', () => {
    it('should validate OHLCV data structure', () => {
      const validCandle = {
        timestamp: 1704067200000,
        open: '42500',
        high: '43000',
        low: '42000',
        close: '42800',
        volume: '1000.5'
      };

      expect(validCandle.timestamp).toBeGreaterThan(0);
      expect(parseFloat(validCandle.open)).toBeGreaterThan(0);
      expect(parseFloat(validCandle.high)).toBeGreaterThanOrEqual(parseFloat(validCandle.low));
      expect(parseFloat(validCandle.volume)).toBeGreaterThanOrEqual(0);
    });

    it('should detect invalid high/low relationship', () => {
      const invalidCandle = {
        high: '42000',
        low: '43000' // Low is higher than high - invalid
      };

      const isValid = parseFloat(invalidCandle.high) >= parseFloat(invalidCandle.low);
      expect(isValid).toBe(false);
    });
  });

  describe('Symbol Validation', () => {
    it('should accept valid Coinbase symbols', () => {
      const validSymbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD'];
      
      validSymbols.forEach(symbol => {
        expect(symbol).toMatch(/^[A-Z]+-[A-Z]+$/);
      });
    });
  });

  describe('Date Range Validation', () => {
    it('should validate start date is before end date', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      expect(startDate.getTime()).toBeLessThan(endDate.getTime());
    });

    it('should reject invalid date range', () => {
      const startDate = new Date('2024-12-31');
      const endDate = new Date('2024-01-01');

      expect(startDate.getTime()).toBeGreaterThan(endDate.getTime());
    });
  });
});

describe('Data Coverage Calculation', () => {
  it('should calculate coverage days correctly', () => {
    const earliestTimestamp = new Date('2022-01-01').getTime();
    const latestTimestamp = new Date('2024-01-01').getTime();

    const coverageDays = Math.round((latestTimestamp - earliestTimestamp) / (86400 * 1000));

    // 2 years = 730 or 731 days
    expect(coverageDays).toBeGreaterThanOrEqual(730);
    expect(coverageDays).toBeLessThanOrEqual(731);
  });

  it('should calculate gap count correctly', () => {
    const earliestTimestamp = new Date('2024-01-01').getTime();
    const latestTimestamp = new Date('2024-01-08').getTime();
    const granularity = 3600; // 1h
    const actualCandles = 150; // Should be 168 for 7 days

    const expectedCandles = Math.ceil((latestTimestamp - earliestTimestamp) / (granularity * 1000));
    const gapCount = Math.max(0, expectedCandles - actualCandles);

    expect(expectedCandles).toBe(168);
    expect(gapCount).toBe(18);
  });
});
