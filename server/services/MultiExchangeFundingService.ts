/**
 * Multi-Exchange Funding Rate Service
 * 
 * Fetches funding rates from multiple exchanges to overcome geo-blocking issues.
 * Priority order: Bybit (most reliable) → OKX → Binance → Fallback
 * 
 * All APIs are public and don't require authentication.
 */

export interface FundingRateData {
  exchange: string;
  symbol: string;
  fundingRate: number;        // Current funding rate (e.g., 0.0001 = 0.01%)
  fundingTime: number;        // Next funding timestamp
  markPrice?: number;
  indexPrice?: number;
  predictedRate?: number;     // Predicted next funding rate
}

export interface AggregatedFundingData {
  symbol: string;
  avgFundingRate: number;
  minFundingRate: number;
  maxFundingRate: number;
  exchangeCount: number;
  exchanges: FundingRateData[];
  nextFundingTime: number;
  consensus: 'bullish' | 'bearish' | 'neutral';
  consensusStrength: number;
}

class MultiExchangeFundingService {
  private cache: Map<string, { data: AggregatedFundingData; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly TIMEOUT = 5000;    // 5 second timeout per exchange

  /**
   * Get aggregated funding rate from multiple exchanges
   */
  async getAggregatedFundingRate(symbol: string): Promise<AggregatedFundingData | null> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    // Check cache
    const cached = this.cache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Fetch from all exchanges in parallel
    const results = await Promise.allSettled([
      this.fetchBybitFunding(normalizedSymbol),
      this.fetchOKXFunding(normalizedSymbol),
      this.fetchBinanceFunding(normalizedSymbol),
    ]);

    const successfulResults: FundingRateData[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successfulResults.push(result.value);
      }
    }

    if (successfulResults.length === 0) {
      return null;
    }

    // Aggregate results
    const aggregated = this.aggregateResults(normalizedSymbol, successfulResults);
    
    // Cache the result
    this.cache.set(normalizedSymbol, { data: aggregated, timestamp: Date.now() });
    
    return aggregated;
  }

  /**
   * Fetch funding rate from Bybit (most reliable, no geo-restrictions)
   * API: https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT
   */
  private async fetchBybitFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const bybitSymbol = symbol.replace('/', '').toUpperCase();
      
      const response = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${bybitSymbol}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.retCode !== 0 || !data.result?.list?.[0]) {
        return null;
      }

      const ticker = data.result.list[0];
      
      return {
        exchange: 'Bybit',
        symbol: bybitSymbol,
        fundingRate: parseFloat(ticker.fundingRate || '0'),
        fundingTime: parseInt(ticker.nextFundingTime || '0'),
        markPrice: parseFloat(ticker.markPrice || '0'),
        indexPrice: parseFloat(ticker.indexPrice || '0'),
        predictedRate: parseFloat(ticker.predictedFundingRate || ticker.fundingRate || '0'),
      };
    } catch (error) {
      // Silently handle errors
      return null;
    }
  }

  /**
   * Fetch funding rate from OKX
   * API: https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP
   */
  private async fetchOKXFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      // OKX uses format like BTC-USDT-SWAP
      const okxSymbol = this.toOKXSymbol(symbol);
      
      const response = await fetch(
        `https://www.okx.com/api/v5/public/funding-rate?instId=${okxSymbol}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.code !== '0' || !data.data?.[0]) {
        return null;
      }

      const fundingData = data.data[0];
      
      return {
        exchange: 'OKX',
        symbol: okxSymbol,
        fundingRate: parseFloat(fundingData.fundingRate || '0'),
        fundingTime: parseInt(fundingData.nextFundingTime || '0'),
        predictedRate: parseFloat(fundingData.nextFundingRate || fundingData.fundingRate || '0'),
      };
    } catch (error) {
      // Silently handle errors
      return null;
    }
  }

  /**
   * Fetch funding rate from Binance (may be geo-blocked)
   * API: https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT
   */
  private async fetchBinanceFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const binanceSymbol = symbol.replace('/', '').replace('-', '').toUpperCase();
      
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      return {
        exchange: 'Binance',
        symbol: binanceSymbol,
        fundingRate: parseFloat(data.lastFundingRate || '0'),
        fundingTime: parseInt(data.nextFundingTime || '0'),
        markPrice: parseFloat(data.markPrice || '0'),
        indexPrice: parseFloat(data.indexPrice || '0'),
      };
    } catch (error) {
      // Silently handle errors - expected when geo-blocked
      return null;
    }
  }

  /**
   * Aggregate funding rates from multiple exchanges
   */
  private aggregateResults(symbol: string, results: FundingRateData[]): AggregatedFundingData {
    const rates = results.map(r => r.fundingRate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    
    // Find earliest next funding time
    const fundingTimes = results.map(r => r.fundingTime).filter(t => t > 0);
    const nextFundingTime = fundingTimes.length > 0 ? Math.min(...fundingTimes) : Date.now() + 8 * 60 * 60 * 1000;

    // Determine consensus
    let bullishCount = 0;
    let bearishCount = 0;
    
    for (const rate of rates) {
      if (rate > 0.0003) {  // > 0.03% = bearish (contrarian)
        bearishCount++;
      } else if (rate < -0.0003) {  // < -0.03% = bullish (contrarian)
        bullishCount++;
      }
    }

    let consensus: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let consensusStrength = 0;

    if (bullishCount > bearishCount && bullishCount >= results.length / 2) {
      consensus = 'bullish';
      consensusStrength = bullishCount / results.length;
    } else if (bearishCount > bullishCount && bearishCount >= results.length / 2) {
      consensus = 'bearish';
      consensusStrength = bearishCount / results.length;
    }

    return {
      symbol,
      avgFundingRate: avgRate,
      minFundingRate: minRate,
      maxFundingRate: maxRate,
      exchangeCount: results.length,
      exchanges: results,
      nextFundingTime,
      consensus,
      consensusStrength,
    };
  }

  /**
   * Normalize symbol to standard format
   */
  private normalizeSymbol(symbol: string): string {
    return symbol
      .replace(/\//g, '')
      .replace(/-/g, '')
      .toUpperCase();
  }

  /**
   * Convert to OKX symbol format (BTC-USDT-SWAP)
   */
  private toOKXSymbol(symbol: string): string {
    const normalized = this.normalizeSymbol(symbol);
    
    // Common patterns
    if (normalized.endsWith('USDT')) {
      const base = normalized.slice(0, -4);
      return `${base}-USDT-SWAP`;
    }
    if (normalized.endsWith('USD')) {
      const base = normalized.slice(0, -3);
      return `${base}-USD-SWAP`;
    }
    
    return `${normalized}-SWAP`;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const multiExchangeFundingService = new MultiExchangeFundingService();
