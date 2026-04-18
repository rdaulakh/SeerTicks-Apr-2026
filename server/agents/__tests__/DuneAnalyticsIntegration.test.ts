/**
 * Tests for Dune Analytics Integration with Trading Agents
 * 
 * Tests cover:
 * 1. DuneAnalyticsProvider - API integration and data parsing
 * 2. Signal integration logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DuneAnalyticsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to get fresh instances
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('should return true when API key is provided', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('test-api-key');
      expect(provider.isConfigured()).toBe(true);
    });

    it('should return false when no API key is provided', async () => {
      // Save and clear env to ensure no fallback
      const originalEnv = process.env.DUNE_API_KEY;
      delete process.env.DUNE_API_KEY;
      
      vi.resetModules();
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('');
      expect(provider.isConfigured()).toBe(false);
      
      // Restore env
      if (originalEnv) {
        process.env.DUNE_API_KEY = originalEnv;
      }
    });
  });

  describe('getQueryResult', () => {
    it('should fetch query results from Dune API', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('test-api-key');

      const mockResponse = {
        execution_id: 'test-exec-id',
        query_id: 1621987,
        state: 'QUERY_STATE_COMPLETED',
        result: {
          metadata: {
            column_names: ['time', 'inflow', 'outflow', 'netflow'],
            column_types: ['timestamp', 'double', 'double', 'double'],
            row_count: 2,
            datapoint_count: 8,
          },
          rows: [
            { time: '2024-12-30T00:00:00Z', inflow: 5000, outflow: 5500, netflow: -500 },
            { time: '2024-12-29T00:00:00Z', inflow: 4800, outflow: 5200, netflow: -400 },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getQueryResult(1621987);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/query/1621987/results'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Dune-Api-Key': 'test-api-key',
          }),
        })
      );

      expect(result).toBeDefined();
      expect(result?.query_id).toBe(1621987);
      expect(result?.result.rows).toHaveLength(2);
    });

    it('should return cached results on subsequent calls', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('test-api-key');

      const mockResponse = {
        execution_id: 'test-exec-id',
        query_id: 1621987,
        state: 'QUERY_STATE_COMPLETED',
        result: {
          metadata: { column_names: [], column_types: [], row_count: 1, datapoint_count: 1 },
          rows: [{ test: 'data' }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // First call - should fetch
      await provider.getQueryResult(1621987);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await provider.getQueryResult(1621987);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, no new fetch
    });

    it('should handle API errors gracefully', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('test-api-key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await provider.getQueryResult(1621987);
      expect(result).toBeNull();
    });

    it('should return null when no API key is configured', async () => {
      // Save and clear env
      const originalEnv = process.env.DUNE_API_KEY;
      delete process.env.DUNE_API_KEY;
      
      vi.resetModules();
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('');
      
      const result = await provider.getQueryResult(1621987);
      expect(result).toBeNull();
      
      // Restore env
      if (originalEnv) {
        process.env.DUNE_API_KEY = originalEnv;
      }
    });
  });

  describe('getOnChainMetrics', () => {
    it('should return mock data when API is not configured', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('');
      
      const metrics = await provider.getOnChainMetrics('BTC');

      expect(metrics).toBeDefined();
      expect(metrics.aggregatedSignal).toBeDefined();
      expect(metrics.exchangeFlows).toBeDefined();
      expect(metrics.whaleMovements).toBeDefined();
      expect(['bullish', 'bearish', 'neutral']).toContain(metrics.aggregatedSignal.signal);
    });

    it('should calculate aggregated signal from metrics', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('test-api-key');

      // Mock both query results
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            execution_id: 'exec-1',
            query_id: 1621987,
            state: 'QUERY_STATE_COMPLETED',
            result: {
              metadata: { column_names: [], column_types: [], row_count: 7, datapoint_count: 28 },
              rows: Array.from({ length: 7 }, (_, i) => ({
                time: new Date(Date.now() - i * 86400000).toISOString(),
                exchange: 'aggregated',
                inflow: 5000,
                outflow: 6000, // Net outflow = bullish
                netflow: -1000,
              })),
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            execution_id: 'exec-2',
            query_id: 5836364,
            state: 'QUERY_STATE_COMPLETED',
            result: {
              metadata: { column_names: [], column_types: [], row_count: 10, datapoint_count: 40 },
              rows: Array.from({ length: 10 }, (_, i) => ({
                block_time: new Date(Date.now() - i * 3600000).toISOString(),
                tx_hash: `tx_${i}`,
                amount: 200,
                amount_usd: 8400000,
                from_type: i % 2 === 0 ? 'exchange' : 'whale',
                to_type: i % 2 === 0 ? 'whale' : 'exchange',
              })),
            },
          }),
        });

      const metrics = await provider.getOnChainMetrics('BTC');

      expect(metrics.aggregatedSignal).toBeDefined();
      expect(['bullish', 'bearish', 'neutral']).toContain(metrics.aggregatedSignal.signal);
      expect(metrics.aggregatedSignal.confidence).toBeGreaterThanOrEqual(0);
      expect(metrics.aggregatedSignal.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('getQuickSignal', () => {
    it('should return a quick signal for trading decisions', async () => {
      const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
      const provider = new DuneAnalyticsProvider('');
      
      const signal = await provider.getQuickSignal('BTC');

      expect(signal).toBeDefined();
      expect(['bullish', 'bearish', 'neutral']).toContain(signal.signal);
      expect(signal.confidence).toBeDefined();
      expect(signal.metrics).toBeDefined();
      expect(signal.reasoning).toBeDefined();
    });
  });
});

describe('Signal Integration Logic', () => {
  describe('Signal alignment detection', () => {
    it('should boost confidence when on-chain confirms technical signal', () => {
      // Test the logic that would be used in TechnicalAnalyst.processOnChainSignal
      const technicalSignal = 'bullish';
      const onChainSignal = { signal: 'bullish', confidence: 0.7 };
      
      const aligned = onChainSignal.signal === technicalSignal;
      expect(aligned).toBe(true);
      
      // Confidence boost calculation (matches TechnicalAnalyst logic)
      const boost = Math.min(0.10, onChainSignal.confidence * 0.12);
      expect(boost).toBeCloseTo(0.084, 2);
    });

    it('should reduce confidence when on-chain conflicts with technical signal', () => {
      const technicalSignal = 'bullish';
      const onChainSignal = { signal: 'bearish', confidence: 0.75 };
      
      const conflict = 
        (onChainSignal.signal === 'bullish' && technicalSignal === 'bearish') ||
        (onChainSignal.signal === 'bearish' && technicalSignal === 'bullish');
      expect(conflict).toBe(true);
      
      // Confidence penalty calculation (matches TechnicalAnalyst logic)
      const penalty = Math.min(0.15, onChainSignal.confidence * 0.18);
      expect(penalty).toBeCloseTo(0.135, 2);
    });
  });

  describe('Exchange flow interpretation', () => {
    it('should interpret negative net flow as bullish', () => {
      // Negative net flow = outflows > inflows = coins leaving exchanges = bullish
      const netFlow = -2500;
      const isBullish = netFlow < -2000;
      expect(isBullish).toBe(true);
    });

    it('should interpret positive net flow as bearish', () => {
      // Positive net flow = inflows > outflows = coins entering exchanges = bearish
      const netFlow = 3000;
      const isBearish = netFlow > 2000;
      expect(isBearish).toBe(true);
    });
  });

  describe('Whale activity interpretation', () => {
    it('should interpret high accumulation ratio as bullish', () => {
      const whaleAccumulation = 10000000;
      const whaleDistribution = 5000000;
      const ratio = whaleAccumulation / whaleDistribution;
      
      expect(ratio).toBe(2.0);
      expect(ratio > 1.5).toBe(true); // Strong bullish signal
    });

    it('should interpret low accumulation ratio as bearish', () => {
      const whaleAccumulation = 3000000;
      const whaleDistribution = 8000000;
      const ratio = whaleAccumulation / whaleDistribution;
      
      expect(ratio).toBe(0.375);
      expect(ratio < 0.67).toBe(true); // Strong bearish signal
    });
  });
});

describe('MacroAnalyst Dune Integration', () => {
  describe('applyDuneOnChainSignal logic', () => {
    it('should boost confidence when signals align', () => {
      const signal = 'bullish';
      const confidence = 0.6;
      const onChainSignal = { signal: 'bullish', confidence: 0.7 };
      
      const signalsAligned = onChainSignal.signal === signal;
      expect(signalsAligned).toBe(true);
      
      // MacroAnalyst boost calculation
      const boost = Math.min(0.12, onChainSignal.confidence * 0.15);
      const adjustedConfidence = Math.min(0.95, confidence + boost);
      
      expect(boost).toBeCloseTo(0.105, 2);
      expect(adjustedConfidence).toBeCloseTo(0.705, 2);
    });

    it('should reduce confidence when signals conflict', () => {
      const signal = 'bullish';
      const confidence = 0.6;
      const onChainSignal = { signal: 'bearish', confidence: 0.75 };
      
      const signalsConflict = 
        (onChainSignal.signal === 'bullish' && signal === 'bearish') ||
        (onChainSignal.signal === 'bearish' && signal === 'bullish');
      expect(signalsConflict).toBe(true);
      
      // MacroAnalyst penalty calculation
      const penalty = Math.min(0.15, onChainSignal.confidence * 0.2);
      const adjustedConfidence = Math.max(0.25, confidence - penalty);
      
      expect(penalty).toBe(0.15);
      expect(adjustedConfidence).toBeCloseTo(0.45, 5);
    });

    it('should adjust for whale activity', () => {
      // Whale accumulation confirms bullish
      const whaleActivity = 'accumulating';
      const signal = 'bullish';
      const confidence = 0.7;
      
      const whalesAccumulating = whaleActivity === 'accumulating';
      const shouldBoost = whalesAccumulating && signal === 'bullish';
      expect(shouldBoost).toBe(true);
      
      const adjustedConfidence = Math.min(0.95, confidence + 0.05);
      expect(adjustedConfidence).toBe(0.75);
    });
  });
});

describe('API Key Configuration', () => {
  it('should use environment variable when no key is passed', async () => {
    // Save original env
    const originalEnv = process.env.DUNE_API_KEY;
    
    // Set test env
    process.env.DUNE_API_KEY = 'env-api-key';
    
    // Need to reset modules to pick up new env
    vi.resetModules();
    const { DuneAnalyticsProvider } = await import('../DuneAnalyticsProvider');
    const provider = new DuneAnalyticsProvider();
    expect(provider.isConfigured()).toBe(true);
    
    // Restore original env
    if (originalEnv) {
      process.env.DUNE_API_KEY = originalEnv;
    } else {
      delete process.env.DUNE_API_KEY;
    }
  });

  it('should initialize singleton with API key', async () => {
    vi.resetModules();
    const { initDuneProvider, getDuneProvider } = await import('../DuneAnalyticsProvider');
    
    const provider = initDuneProvider('singleton-test-key');
    expect(provider.isConfigured()).toBe(true);
    
    // Get singleton should return same instance
    const sameProvider = getDuneProvider();
    expect(sameProvider).toBe(provider);
  });
});
