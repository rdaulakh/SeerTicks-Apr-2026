import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration flag: set INTEGRATION_TEST=1 to run tests that call external Dune Analytics API.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';

describe('DuneAnalyticsProvider (unit)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should instantiate without API key', async () => {
    const { DuneAnalyticsProvider } = await import('../agents/DuneAnalyticsProvider');
    const provider = new DuneAnalyticsProvider('');
    expect(provider).toBeDefined();
  });

  it('should have clearCache method', async () => {
    const { DuneAnalyticsProvider } = await import('../agents/DuneAnalyticsProvider');
    const provider = new DuneAnalyticsProvider('');
    expect(typeof provider.clearCache).toBe('function');
    provider.clearCache();
  });

  it('should have getQuickSignal method', async () => {
    const { DuneAnalyticsProvider } = await import('../agents/DuneAnalyticsProvider');
    const provider = new DuneAnalyticsProvider('');
    expect(typeof provider.getQuickSignal).toBe('function');
  });

  it('should export getDuneProvider singleton factory', async () => {
    const { getDuneProvider } = await import('../agents/DuneAnalyticsProvider');
    expect(typeof getDuneProvider).toBe('function');
    const provider = getDuneProvider();
    expect(provider).toBeDefined();
  });
});

describe.skipIf(!isIntegration)('DuneAnalyticsProvider Signal Balance (integration)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should generate a mix of signal types over multiple calls', async () => {
    const { DuneAnalyticsProvider } = await import('../agents/DuneAnalyticsProvider');
    const provider = new DuneAnalyticsProvider('');
    
    const iterations = 5;
    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;
    
    for (let i = 0; i < iterations; i++) {
      provider.clearCache();
      const signal = await provider.getQuickSignal('BTC');
      
      if (signal.signal === 'bullish') bullishCount++;
      else if (signal.signal === 'bearish') bearishCount++;
      else neutralCount++;
    }
    
    const total = bullishCount + bearishCount + neutralCount;
    expect(total).toBe(iterations);
    
    // Should not be 100% bullish (the original bug)
    const bullishRatio = bullishCount / iterations;
    expect(bullishRatio).toBeLessThan(0.90);
  }, 60000);
});
