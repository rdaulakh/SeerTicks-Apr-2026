/**
 * Tests for On-Chain Analytics Services
 * 
 * Tests the free API integrations:
 * - BGeometrics (Bitcoin metrics)
 * - DeFiLlama (DeFi data)
 * - Dune Analytics (custom queries)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BGeometricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch MVRV data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        d: '2024-12-31',
        unixTs: 1735689600,
        mvrv: 2.5,
      }),
    });

    const { getBGeometricsService } = await import('../BGeometricsService');
    const service = getBGeometricsService();
    
    const result = await service.getMVRV();
    
    expect(result).toHaveProperty('mvrv');
    expect(result.mvrv).toBe(2.5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/mvrv/last')
    );
  });

  it('should fetch NUPL data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        d: '2024-12-31',
        unixTs: 1735689600,
        nupl: 0.45,
        nup: 0.5,
        nul: 0.05,
      }),
    });

    const { getBGeometricsService } = await import('../BGeometricsService');
    const service = getBGeometricsService();
    
    const result = await service.getNUPL();
    
    expect(result).toHaveProperty('nupl');
    expect(result.nupl).toBe(0.45);
  });

  it('should fetch SOPR data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        d: '2024-12-31',
        unixTs: 1735689600,
        sopr: 1.02,
      }),
    });

    const { getBGeometricsService } = await import('../BGeometricsService');
    const service = getBGeometricsService();
    
    const result = await service.getSOPR();
    
    expect(result).toHaveProperty('sopr');
    expect(result.sopr).toBe(1.02);
  });

  it('should interpret MVRV signals correctly', async () => {
    // Test bullish signal (MVRV < 1)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        d: '2024-12-31',
        unixTs: 1735689600,
        mvrv: 0.8,
      }),
    });

    const { getBGeometricsService } = await import('../BGeometricsService');
    const service = getBGeometricsService();
    
    // Clear cache to force new request
    service.clearCache();
    
    const signals = await service.getOnChainSignals();
    const mvrvSignal = signals.find(s => s.metric === 'MVRV');
    
    expect(mvrvSignal?.signal).toBe('BULLISH');
  });

  it('should respect rate limits', async () => {
    const { getBGeometricsService } = await import('../BGeometricsService');
    const service = getBGeometricsService();
    
    const status = service.getStatus();
    
    expect(status).toHaveProperty('dailyRequestsRemaining');
    expect(status).toHaveProperty('hourlyRequestsRemaining');
    expect(status.dailyRequestsRemaining).toBeLessThanOrEqual(15);
    expect(status.hourlyRequestsRemaining).toBeLessThanOrEqual(8);
  });
});

describe('DeFiLlamaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch protocols', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          id: '1',
          name: 'Aave',
          tvl: 10000000000,
          change_1d: 2.5,
          change_7d: -1.2,
          chains: ['Ethereum', 'Polygon'],
        },
      ]),
    });

    const { getDeFiLlamaService } = await import('../DeFiLlamaService');
    const service = getDeFiLlamaService();
    
    const protocols = await service.getProtocols();
    
    expect(protocols).toHaveLength(1);
    expect(protocols[0].name).toBe('Aave');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/protocols')
    );
  });

  it('should fetch chain TVL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { name: 'Ethereum', tvl: 50000000000 },
        { name: 'BSC', tvl: 5000000000 },
      ]),
    });

    const { getDeFiLlamaService } = await import('../DeFiLlamaService');
    const service = getDeFiLlamaService();
    
    const chains = await service.getChainTVL();
    
    expect(chains).toHaveLength(2);
    expect(chains[0].tvl).toBe(50000000000);
  });

  it('should fetch DEX volumes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        total24h: 5000000000,
        change_1d: 10.5,
        protocols: [
          { name: 'Uniswap', totalVolume24h: 2000000000 },
        ],
      }),
    });

    const { getDeFiLlamaService } = await import('../DeFiLlamaService');
    const service = getDeFiLlamaService();
    
    const volume = await service.getTotalDEXVolume();
    
    expect(volume.volume24h).toBe(5000000000);
    expect(volume.change24h).toBe(10.5);
  });

  it('should calculate DeFi sentiment', async () => {
    // Mock chain TVL
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { name: 'Ethereum', tvl: 50000000000 },
      ]),
    });

    // Mock DEX volume
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        total24h: 5000000000,
        change_1d: 25, // High activity
      }),
    });

    // Mock stablecoins
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        peggedAssets: [
          { name: 'USDT', circulating: { ethereum: 50000000000 } },
        ],
      }),
    });

    const { getDeFiLlamaService } = await import('../DeFiLlamaService');
    const service = getDeFiLlamaService();
    
    // Clear cache
    service.clearCache();
    
    const sentiment = await service.getDeFiSentiment();
    
    expect(sentiment).toHaveProperty('sentiment');
    expect(sentiment).toHaveProperty('totalTVL');
    expect(sentiment).toHaveProperty('dexVolume24h');
  });
});

describe('DuneAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should check configuration status', async () => {
    const { getDuneAnalyticsService } = await import('../DuneAnalyticsService');
    const service = getDuneAnalyticsService();
    
    const status = service.getStatus();
    
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('rateLimitRemaining');
    expect(status).toHaveProperty('cacheSize');
  });

  it('should throw error when not configured', async () => {
    // Reset modules to ensure clean state
    vi.resetModules();
    
    // Mock fetch to prevent actual API calls
    const mockFetchLocal = vi.fn().mockRejectedValue(new Error('Should not be called'));
    global.fetch = mockFetchLocal;
    
    // Clear DUNE_API_KEY from environment for this test
    const originalEnv = process.env.DUNE_API_KEY;
    delete process.env.DUNE_API_KEY;
    
    try {
      const { DuneAnalyticsService } = await import('../DuneAnalyticsService');
      const service = new DuneAnalyticsService(''); // Empty API key
      
      // isConfigured should return false for empty string
      expect(service.isConfigured()).toBe(false);
      
      // executeQuery should throw before making any API call
      await expect(service.executeQuery(12345)).rejects.toThrow(
        'Dune Analytics API key not configured'
      );
      
      // Verify fetch was never called
      expect(mockFetchLocal).not.toHaveBeenCalled();
    } finally {
      // Restore environment
      if (originalEnv) {
        process.env.DUNE_API_KEY = originalEnv;
      }
    }
  });
});

describe('OnChainAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get combined dashboard', async () => {
    // Mock BGeometrics responses
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ d: '2024-12-31', mvrv: 2.5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ d: '2024-12-31', nupl: 0.45 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ d: '2024-12-31', sopr: 1.02 }),
      })
      // DeFiLlama responses
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ name: 'Ethereum', tvl: 50000000000 }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total24h: 5000000000, change_1d: 10 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ name: 'Aave', tvl: 10000000000 }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          totalTVL: 50000000000,
          sentiment: 'NEUTRAL',
        }),
      });

    const { getOnChainAnalyticsService } = await import('../OnChainAnalyticsService');
    const service = getOnChainAnalyticsService();
    
    // Clear cache
    service.clearCache();
    
    const dashboard = await service.getDashboard();
    
    expect(dashboard).toHaveProperty('btcMetrics');
    expect(dashboard).toHaveProperty('defiMetrics');
    expect(dashboard).toHaveProperty('marketHealth');
    expect(dashboard).toHaveProperty('dataSource');
  });

  it('should calculate market health score', async () => {
    const { getOnChainAnalyticsService } = await import('../OnChainAnalyticsService');
    const service = getOnChainAnalyticsService();
    
    // Use cached data if available
    const dashboard = await service.getDashboard();
    
    expect(dashboard.marketHealth.score).toBeGreaterThanOrEqual(0);
    expect(dashboard.marketHealth.score).toBeLessThanOrEqual(100);
    expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(dashboard.marketHealth.trend);
  });
});
