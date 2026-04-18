/**
 * Multi-Exchange Liquidation Data Service
 * 
 * Fetches open interest and long/short ratio data from multiple exchanges
 * to overcome geo-blocking issues with Binance.
 * 
 * Priority order: Bybit (most reliable) → OKX → Binance → Fallback
 * 
 * All APIs are public and don't require authentication.
 */

export interface OpenInterestData {
  exchange: string;
  symbol: string;
  openInterest: number;        // In contracts/coins
  openInterestValue: number;   // In USDT
  timestamp: number;
}

export interface LongShortRatioData {
  exchange: string;
  symbol: string;
  longShortRatio: number;
  longPercentage: number;
  shortPercentage: number;
  timestamp: number;
}

export interface AggregatedLiquidationData {
  symbol: string;
  totalOpenInterest: number;
  totalOpenInterestValue: number;
  avgLongShortRatio: number;
  avgLongPercentage: number;
  avgShortPercentage: number;
  exchangeCount: number;
  exchanges: {
    openInterest: OpenInterestData[];
    longShortRatio: LongShortRatioData[];
  };
  sentiment: 'long_heavy' | 'short_heavy' | 'balanced';
  sentimentStrength: number;
}

class MultiExchangeLiquidationService {
  private cache: Map<string, { data: AggregatedLiquidationData; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly TIMEOUT = 5000;    // 5 second timeout per exchange

  /**
   * Get aggregated liquidation data from multiple exchanges
   */
  async getAggregatedLiquidationData(symbol: string): Promise<AggregatedLiquidationData | null> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    // Check cache
    const cached = this.cache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Fetch from all exchanges in parallel
    const [oiResults, lsResults] = await Promise.all([
      Promise.allSettled([
        this.fetchBybitOpenInterest(normalizedSymbol),
        this.fetchOKXOpenInterest(normalizedSymbol),
        this.fetchBinanceOpenInterest(normalizedSymbol),
      ]),
      Promise.allSettled([
        this.fetchBybitLongShortRatio(normalizedSymbol),
        this.fetchOKXLongShortRatio(normalizedSymbol),
        this.fetchBinanceLongShortRatio(normalizedSymbol),
      ]),
    ]);

    const openInterestData: OpenInterestData[] = [];
    const longShortData: LongShortRatioData[] = [];
    
    for (const result of oiResults) {
      if (result.status === 'fulfilled' && result.value) {
        openInterestData.push(result.value);
      }
    }

    for (const result of lsResults) {
      if (result.status === 'fulfilled' && result.value) {
        longShortData.push(result.value);
      }
    }

    if (openInterestData.length === 0 && longShortData.length === 0) {
      return null;
    }

    // Aggregate results
    const aggregated = this.aggregateResults(normalizedSymbol, openInterestData, longShortData);
    
    // Cache the result
    this.cache.set(normalizedSymbol, { data: aggregated, timestamp: Date.now() });
    
    return aggregated;
  }

  /**
   * Fetch open interest from Bybit
   * API: https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min
   */
  private async fetchBybitOpenInterest(symbol: string): Promise<OpenInterestData | null> {
    try {
      const bybitSymbol = symbol.replace('/', '').toUpperCase();
      
      const response = await fetch(
        `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${bybitSymbol}&intervalTime=5min&limit=1`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.retCode !== 0 || !data.result?.list?.[0]) {
        return null;
      }

      const item = data.result.list[0];
      
      return {
        exchange: 'Bybit',
        symbol: bybitSymbol,
        openInterest: parseFloat(item.openInterest || '0'),
        openInterestValue: parseFloat(item.openInterestValue || '0'),
        timestamp: parseInt(item.timestamp || Date.now().toString()),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch long/short ratio from Bybit
   * API: https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h
   */
  private async fetchBybitLongShortRatio(symbol: string): Promise<LongShortRatioData | null> {
    try {
      const bybitSymbol = symbol.replace('/', '').toUpperCase();
      
      const response = await fetch(
        `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${bybitSymbol}&period=1h&limit=1`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.retCode !== 0 || !data.result?.list?.[0]) {
        return null;
      }

      const item = data.result.list[0];
      const buyRatio = parseFloat(item.buyRatio || '0.5');
      const sellRatio = parseFloat(item.sellRatio || '0.5');
      
      return {
        exchange: 'Bybit',
        symbol: bybitSymbol,
        longShortRatio: sellRatio > 0 ? buyRatio / sellRatio : 1,
        longPercentage: buyRatio * 100,
        shortPercentage: sellRatio * 100,
        timestamp: parseInt(item.timestamp || Date.now().toString()),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch open interest from OKX
   * API: https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP
   */
  private async fetchOKXOpenInterest(symbol: string): Promise<OpenInterestData | null> {
    try {
      const okxSymbol = this.toOKXSymbol(symbol);
      
      const response = await fetch(
        `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${okxSymbol}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.code !== '0' || !data.data?.[0]) {
        return null;
      }

      const item = data.data[0];
      
      return {
        exchange: 'OKX',
        symbol: okxSymbol,
        openInterest: parseFloat(item.oi || '0'),
        openInterestValue: parseFloat(item.oiCcy || '0'),
        timestamp: parseInt(item.ts || Date.now().toString()),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch long/short ratio from OKX
   * API: https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?instId=BTC-USDT-SWAP
   */
  private async fetchOKXLongShortRatio(symbol: string): Promise<LongShortRatioData | null> {
    try {
      const okxSymbol = this.toOKXSymbol(symbol);
      
      const response = await fetch(
        `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?instId=${okxSymbol}&period=1H`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.code !== '0' || !data.data?.[0]) {
        return null;
      }

      const item = data.data[0];
      const ratio = parseFloat(item[1] || '1'); // [timestamp, ratio]
      
      // Convert ratio to percentages
      const longPct = (ratio / (1 + ratio)) * 100;
      const shortPct = (1 / (1 + ratio)) * 100;
      
      return {
        exchange: 'OKX',
        symbol: okxSymbol,
        longShortRatio: ratio,
        longPercentage: longPct,
        shortPercentage: shortPct,
        timestamp: parseInt(item[0] || Date.now().toString()),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch open interest from Binance (may be geo-blocked)
   */
  private async fetchBinanceOpenInterest(symbol: string): Promise<OpenInterestData | null> {
    try {
      const binanceSymbol = symbol.replace('/', '').replace('-', '').toUpperCase();
      
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      return {
        exchange: 'Binance',
        symbol: binanceSymbol,
        openInterest: parseFloat(data.openInterest || '0'),
        openInterestValue: 0, // Binance doesn't provide this directly
        timestamp: data.time || Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch long/short ratio from Binance (may be geo-blocked)
   */
  private async fetchBinanceLongShortRatio(symbol: string): Promise<LongShortRatioData | null> {
    try {
      const binanceSymbol = symbol.replace('/', '').replace('-', '').toUpperCase();
      
      const response = await fetch(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${binanceSymbol}&period=1h&limit=1`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );

      if (!response.ok) return null;

      const data = await response.json();
      
      if (!data?.[0]) return null;

      const item = data[0];
      const ratio = parseFloat(item.longShortRatio || '1');
      
      return {
        exchange: 'Binance',
        symbol: binanceSymbol,
        longShortRatio: ratio,
        longPercentage: parseFloat(item.longAccount || '50') * 100,
        shortPercentage: parseFloat(item.shortAccount || '50') * 100,
        timestamp: item.timestamp || Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Aggregate data from multiple exchanges
   */
  private aggregateResults(
    symbol: string,
    openInterestData: OpenInterestData[],
    longShortData: LongShortRatioData[]
  ): AggregatedLiquidationData {
    // Aggregate open interest
    const totalOI = openInterestData.reduce((sum, d) => sum + d.openInterest, 0);
    const totalOIValue = openInterestData.reduce((sum, d) => sum + d.openInterestValue, 0);

    // Aggregate long/short ratios
    let avgRatio = 1;
    let avgLongPct = 50;
    let avgShortPct = 50;

    if (longShortData.length > 0) {
      avgRatio = longShortData.reduce((sum, d) => sum + d.longShortRatio, 0) / longShortData.length;
      avgLongPct = longShortData.reduce((sum, d) => sum + d.longPercentage, 0) / longShortData.length;
      avgShortPct = longShortData.reduce((sum, d) => sum + d.shortPercentage, 0) / longShortData.length;
    }

    // Determine sentiment
    let sentiment: 'long_heavy' | 'short_heavy' | 'balanced' = 'balanced';
    let sentimentStrength = 0;

    if (avgRatio > 1.2) {
      sentiment = 'long_heavy';
      sentimentStrength = Math.min((avgRatio - 1) / 0.5, 1);
    } else if (avgRatio < 0.8) {
      sentiment = 'short_heavy';
      sentimentStrength = Math.min((1 - avgRatio) / 0.5, 1);
    }

    return {
      symbol,
      totalOpenInterest: totalOI,
      totalOpenInterestValue: totalOIValue,
      avgLongShortRatio: avgRatio,
      avgLongPercentage: avgLongPct,
      avgShortPercentage: avgShortPct,
      exchangeCount: Math.max(openInterestData.length, longShortData.length),
      exchanges: {
        openInterest: openInterestData,
        longShortRatio: longShortData,
      },
      sentiment,
      sentimentStrength,
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
export const multiExchangeLiquidationService = new MultiExchangeLiquidationService();
