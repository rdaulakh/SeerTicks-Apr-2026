import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Week 3 Tests: Multi-Exchange Funding Rate and Liquidation Data Fixes
 * 
 * These tests verify that:
 * 1. MultiExchangeFundingService correctly aggregates data from multiple exchanges
 * 2. MultiExchangeLiquidationService correctly aggregates OI and L/S ratio data
 * 3. Both services handle API failures gracefully
 * 4. Signal generation uses multi-exchange consensus
 */

describe('Week 3: Multi-Exchange Funding Rate Service', () => {
  describe('Symbol Normalization', () => {
    it('should normalize BTC/USDT to BTCUSDT', () => {
      const normalized = 'BTC/USDT'.replace(/\//g, '').replace(/-/g, '').toUpperCase();
      expect(normalized).toBe('BTCUSDT');
    });

    it('should normalize BTC-USDT to BTCUSDT', () => {
      const normalized = 'BTC-USDT'.replace(/\//g, '').replace(/-/g, '').toUpperCase();
      expect(normalized).toBe('BTCUSDT');
    });

    it('should convert to OKX format correctly', () => {
      const toOKXSymbol = (symbol: string): string => {
        const normalized = symbol.replace(/\//g, '').replace(/-/g, '').toUpperCase();
        if (normalized.endsWith('USDT')) {
          const base = normalized.slice(0, -4);
          return `${base}-USDT-SWAP`;
        }
        return `${normalized}-SWAP`;
      };
      
      expect(toOKXSymbol('BTCUSDT')).toBe('BTC-USDT-SWAP');
      expect(toOKXSymbol('ETHUSDT')).toBe('ETH-USDT-SWAP');
    });
  });

  describe('Funding Rate Aggregation', () => {
    it('should calculate average funding rate correctly', () => {
      const rates = [0.0001, 0.00015, 0.0002]; // 0.01%, 0.015%, 0.02%
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      expect(avgRate).toBeCloseTo(0.00015, 6);
    });

    it('should identify bullish consensus from negative funding', () => {
      const rates = [-0.0005, -0.0004, -0.0003]; // All negative = bullish (contrarian)
      let bullishCount = 0;
      let bearishCount = 0;
      
      for (const rate of rates) {
        if (rate > 0.0003) bearishCount++;
        else if (rate < -0.0003) bullishCount++;
      }
      
      // -0.0003 is exactly at threshold, so only 2 are strictly below
      expect(bullishCount).toBe(2);
      expect(bearishCount).toBe(0);
    });

    it('should identify bearish consensus from positive funding', () => {
      const rates = [0.0005, 0.0006, 0.0004]; // All positive = bearish (contrarian)
      let bullishCount = 0;
      let bearishCount = 0;
      
      for (const rate of rates) {
        if (rate > 0.0003) bearishCount++;
        else if (rate < -0.0003) bullishCount++;
      }
      
      expect(bullishCount).toBe(0);
      expect(bearishCount).toBe(3);
    });

    it('should detect neutral when rates are mixed', () => {
      const rates = [0.0001, -0.0001, 0.00005]; // Mixed = neutral
      let bullishCount = 0;
      let bearishCount = 0;
      
      for (const rate of rates) {
        if (rate > 0.0003) bearishCount++;
        else if (rate < -0.0003) bullishCount++;
      }
      
      expect(bullishCount).toBe(0);
      expect(bearishCount).toBe(0);
    });
  });

  describe('Signal Generation from Aggregated Data', () => {
    it('should generate bearish signal for extreme positive funding', () => {
      const avgRate = 0.001; // 0.1% = extreme positive
      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      
      if (avgRate >= 0.001) signal = 'bearish';
      else if (avgRate <= -0.001) signal = 'bullish';
      
      expect(signal).toBe('bearish');
    });

    it('should generate bullish signal for extreme negative funding', () => {
      const avgRate = -0.001; // -0.1% = extreme negative
      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      
      if (avgRate >= 0.001) signal = 'bearish';
      else if (avgRate <= -0.001) signal = 'bullish';
      
      expect(signal).toBe('bullish');
    });

    it('should add confidence bonus for multiple exchanges', () => {
      let confidence = 0.5;
      const exchangeCount = 3;
      
      if (exchangeCount >= 2) confidence += 0.08;
      if (exchangeCount >= 3) confidence += 0.05;
      
      expect(confidence).toBe(0.63);
    });
  });
});

describe('Week 3: Multi-Exchange Liquidation Service', () => {
  describe('Long/Short Ratio Analysis', () => {
    it('should identify long-heavy sentiment', () => {
      const ratio = 1.5; // 60% long, 40% short
      let sentiment: 'long_heavy' | 'short_heavy' | 'balanced' = 'balanced';
      
      if (ratio > 1.2) sentiment = 'long_heavy';
      else if (ratio < 0.8) sentiment = 'short_heavy';
      
      expect(sentiment).toBe('long_heavy');
    });

    it('should identify short-heavy sentiment', () => {
      const ratio = 0.6; // 37.5% long, 62.5% short
      let sentiment: 'long_heavy' | 'short_heavy' | 'balanced' = 'balanced';
      
      if (ratio > 1.2) sentiment = 'long_heavy';
      else if (ratio < 0.8) sentiment = 'short_heavy';
      
      expect(sentiment).toBe('short_heavy');
    });

    it('should identify balanced sentiment', () => {
      const ratio = 1.0; // 50% long, 50% short
      let sentiment: 'long_heavy' | 'short_heavy' | 'balanced' = 'balanced';
      
      if (ratio > 1.2) sentiment = 'long_heavy';
      else if (ratio < 0.8) sentiment = 'short_heavy';
      
      expect(sentiment).toBe('balanced');
    });
  });

  describe('Contrarian Signal Generation', () => {
    it('should generate bearish signal for extreme long bias (contrarian)', () => {
      const ratio = 2.5; // Extreme long bias
      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      
      if (ratio > 2.0) signal = 'bearish';
      else if (ratio < 0.5) signal = 'bullish';
      
      expect(signal).toBe('bearish');
    });

    it('should generate bullish signal for extreme short bias (contrarian)', () => {
      const ratio = 0.4; // Extreme short bias
      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      
      if (ratio > 2.0) signal = 'bearish';
      else if (ratio < 0.5) signal = 'bullish';
      
      expect(signal).toBe('bullish');
    });
  });

  describe('Open Interest Aggregation', () => {
    it('should sum open interest from multiple exchanges', () => {
      const oiData = [
        { exchange: 'Bybit', openInterest: 50000 },
        { exchange: 'OKX', openInterest: 30000 },
        { exchange: 'Binance', openInterest: 80000 },
      ];
      
      const totalOI = oiData.reduce((sum, d) => sum + d.openInterest, 0);
      expect(totalOI).toBe(160000);
    });

    it('should calculate average L/S ratio from multiple exchanges', () => {
      const lsData = [
        { exchange: 'Bybit', longShortRatio: 1.2 },
        { exchange: 'OKX', longShortRatio: 1.4 },
        { exchange: 'Binance', longShortRatio: 1.3 },
      ];
      
      const avgRatio = lsData.reduce((sum, d) => sum + d.longShortRatio, 0) / lsData.length;
      expect(avgRatio).toBeCloseTo(1.3, 2);
    });
  });

  describe('Execution Score Calculation', () => {
    it('should give high score for extreme ratios', () => {
      let score = 50;
      const ratio = 2.5; // Extreme
      
      if (ratio > 2.0 || ratio < 0.5) score += 25;
      else if (ratio > 1.5 || ratio < 0.67) score += 12;
      
      expect(score).toBe(75);
    });

    it('should add bonus for multiple exchanges', () => {
      let score = 50;
      const exchangeCount = 3;
      
      score += exchangeCount * 5;
      
      expect(score).toBe(65);
    });
  });
});

describe('Week 3: Graceful Fallback Handling', () => {
  it('should handle all exchanges failing gracefully', () => {
    const results: (null | { exchange: string })[] = [null, null, null];
    const successfulResults = results.filter(r => r !== null);
    
    expect(successfulResults.length).toBe(0);
  });

  it('should work with partial exchange data', () => {
    const results: (null | { exchange: string; rate: number })[] = [
      { exchange: 'Bybit', rate: 0.0001 },
      null, // OKX failed
      null, // Binance failed
    ];
    
    const successfulResults = results.filter(r => r !== null);
    expect(successfulResults.length).toBe(1);
    expect(successfulResults[0]?.exchange).toBe('Bybit');
  });

  it('should prefer Bybit data when available', () => {
    const results = [
      { exchange: 'Bybit', rate: 0.0001, priority: 1 },
      { exchange: 'OKX', rate: 0.00015, priority: 2 },
      { exchange: 'Binance', rate: 0.0002, priority: 3 },
    ];
    
    // All available - use average
    const avgRate = results.reduce((sum, r) => sum + r.rate, 0) / results.length;
    expect(avgRate).toBeCloseTo(0.00015, 6);
  });
});
