/**
 * OnChainDataProvider - Aggregates on-chain data from multiple free APIs
 * 
 * Data Sources:
 * - Blockchain.com API: Bitcoin network stats, mempool, exchange flows
 * - CoinGecko API: Market data, exchange volumes
 * - Whale Alert (if configured): Large transaction tracking
 * 
 * Provides CryptoQuant-style metrics without paid API access:
 * - Exchange inflow/outflow estimates
 * - Exchange reserve tracking
 * - Large transaction detection
 * - Network activity metrics
 */

import { ENV } from '../_core/env';

// Types for on-chain data
export interface ExchangeFlowMetrics {
  symbol: string;
  timestamp: number;
  
  // Flow metrics (estimated from various sources)
  estimatedInflow: number;      // Coins flowing into exchanges
  estimatedOutflow: number;     // Coins flowing out of exchanges
  netFlow: number;              // inflow - outflow
  flowConfidence: number;       // 0-1 confidence in estimates
  
  // Exchange reserve metrics
  exchangeReserve: number;      // Total on exchanges
  reserveChange24h: number;     // % change
  reserveChange7d: number;      // % change
  
  // Large transaction metrics
  largeTransactionCount: number;
  largeTransactionVolume: number;
  avgLargeTransactionSize: number;
  
  // Network metrics
  networkHashRate?: number;
  mempoolSize?: number;
  avgBlockTime?: number;
  activeAddresses?: number;
  
  // Data source info
  dataSources: string[];
  lastUpdated: number;
}

export interface WhaleTransaction {
  hash: string;
  timestamp: number;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  fromOwner?: string;
  toOwner?: string;
  transactionType: 'exchange_inflow' | 'exchange_outflow' | 'whale_transfer' | 'unknown';
}

export interface NetworkStats {
  symbol: string;
  hashRate: number;
  difficulty: number;
  blockHeight: number;
  mempoolSize: number;
  avgBlockTime: number;
  avgTransactionFee: number;
  activeAddresses24h: number;
}

// Known exchange addresses (partial list for identification)
const KNOWN_EXCHANGE_ADDRESSES: Record<string, string[]> = {
  BTC: [
    'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', // Binance
    '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s', // Binance
    'bc1qa5wkgaew2dkv56kfc68j2ykjfvxk5f5h3xnqvv', // Coinbase
    '3Cbq7aT1tY8kMxWLbitaG7yT6bPbKChq64', // Bitfinex
  ],
  ETH: [
    '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance
    '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase
    '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken
  ],
};

// Cache for API responses
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class OnChainDataProviderClass {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly LONG_CACHE_TTL = 900000; // 15 minutes for less volatile data
  
  // Rate limiting
  private lastBlockchainApiCall = 0;
  private lastCoinGeckoApiCall = 0;
  private readonly BLOCKCHAIN_API_INTERVAL = 10000; // 10 seconds
  private readonly COINGECKO_API_INTERVAL = 6000; // 6 seconds (10 req/min free tier)

  /**
   * Get comprehensive exchange flow metrics for a symbol
   */
  async getExchangeFlowMetrics(symbol: string): Promise<ExchangeFlowMetrics | null> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const cacheKey = `flow_metrics:${normalizedSymbol}`;
    
    // Check cache
    const cached = this.getFromCache<ExchangeFlowMetrics>(cacheKey);
    if (cached) return cached;
    
    try {
      const dataSources: string[] = [];
      let metrics: Partial<ExchangeFlowMetrics> = {
        symbol: normalizedSymbol,
        timestamp: Date.now(),
        dataSources: [],
        lastUpdated: Date.now(),
      };
      
      // Fetch from multiple sources in parallel
      const [blockchainStats, coinGeckoData, whaleData] = await Promise.allSettled([
        this.fetchBlockchainStats(normalizedSymbol),
        this.fetchCoinGeckoExchangeData(normalizedSymbol),
        this.fetchWhaleAlertData(normalizedSymbol),
      ]);
      
      // Process Blockchain.com data (BTC only)
      if (blockchainStats.status === 'fulfilled' && blockchainStats.value) {
        const stats = blockchainStats.value;
        metrics.networkHashRate = stats.hashRate;
        metrics.mempoolSize = stats.mempoolSize;
        metrics.avgBlockTime = stats.avgBlockTime;
        dataSources.push('Blockchain.com');
      }
      
      // Process CoinGecko data
      if (coinGeckoData.status === 'fulfilled' && coinGeckoData.value) {
        const data = coinGeckoData.value;
        metrics.exchangeReserve = data.exchangeReserve;
        metrics.reserveChange24h = data.reserveChange24h;
        metrics.reserveChange7d = data.reserveChange7d;
        dataSources.push('CoinGecko');
      }
      
      // Process Whale Alert data
      if (whaleData.status === 'fulfilled' && whaleData.value) {
        const whales = whaleData.value;
        const { inflow, outflow, largeCount, largeVolume } = this.analyzeWhaleTransactions(whales);
        metrics.estimatedInflow = inflow;
        metrics.estimatedOutflow = outflow;
        metrics.netFlow = inflow - outflow;
        metrics.largeTransactionCount = largeCount;
        metrics.largeTransactionVolume = largeVolume;
        metrics.avgLargeTransactionSize = largeCount > 0 ? largeVolume / largeCount : 0;
        dataSources.push('WhaleAlert');
      }
      
      // Calculate flow confidence based on data sources
      metrics.flowConfidence = dataSources.length / 3;
      metrics.dataSources = dataSources;
      
      // Fill in missing values with estimates
      metrics = this.fillMissingMetrics(metrics, normalizedSymbol);
      
      const result = metrics as ExchangeFlowMetrics;
      this.setCache(cacheKey, result, this.CACHE_TTL);
      
      return result;
    } catch (error) {
      console.error(`[OnChainDataProvider] Failed to get flow metrics for ${symbol}:`, error);
      return this.getFallbackMetrics(normalizedSymbol);
    }
  }

  /**
   * Get recent whale transactions
   */
  async getWhaleTransactions(symbol: string, limit: number = 20): Promise<WhaleTransaction[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const cacheKey = `whale_txs:${normalizedSymbol}`;
    
    const cached = this.getFromCache<WhaleTransaction[]>(cacheKey);
    if (cached) return cached;
    
    try {
      const transactions = await this.fetchWhaleAlertData(normalizedSymbol, limit);
      this.setCache(cacheKey, transactions, this.CACHE_TTL);
      return transactions;
    } catch (error) {
      console.error(`[OnChainDataProvider] Failed to get whale transactions:`, error);
      return [];
    }
  }

  /**
   * Get network statistics
   */
  async getNetworkStats(symbol: string): Promise<NetworkStats | null> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const cacheKey = `network_stats:${normalizedSymbol}`;
    
    const cached = this.getFromCache<NetworkStats>(cacheKey);
    if (cached) return cached;
    
    try {
      const stats = await this.fetchBlockchainStats(normalizedSymbol);
      if (stats) {
        this.setCache(cacheKey, stats, this.LONG_CACHE_TTL);
      }
      return stats;
    } catch (error) {
      console.error(`[OnChainDataProvider] Failed to get network stats:`, error);
      return null;
    }
  }

  /**
   * Fetch Bitcoin network stats from Blockchain.com API
   */
  private async fetchBlockchainStats(symbol: string): Promise<NetworkStats | null> {
    if (symbol !== 'BTC') return null; // Only BTC supported
    
    // Rate limiting
    const now = Date.now();
    if (now - this.lastBlockchainApiCall < this.BLOCKCHAIN_API_INTERVAL) {
      await this.sleep(this.BLOCKCHAIN_API_INTERVAL - (now - this.lastBlockchainApiCall));
    }
    this.lastBlockchainApiCall = Date.now();
    
    try {
      // Fetch multiple endpoints
      const [statsResponse, mempoolResponse] = await Promise.all([
        fetch('https://api.blockchain.info/stats'),
        fetch('https://api.blockchain.info/mempool'),
      ]);
      
      if (!statsResponse.ok || !mempoolResponse.ok) {
        throw new Error('Blockchain.com API error');
      }
      
      const stats = await statsResponse.json();
      const mempool = await mempoolResponse.json();
      
      return {
        symbol: 'BTC',
        hashRate: stats.hash_rate || 0,
        difficulty: stats.difficulty || 0,
        blockHeight: stats.n_blocks_total || 0,
        mempoolSize: mempool.n_tx || 0,
        avgBlockTime: stats.minutes_between_blocks || 10,
        avgTransactionFee: stats.total_fees_btc / (stats.n_tx || 1),
        activeAddresses24h: stats.n_btc_mined ? Math.floor(stats.n_btc_mined * 1000) : 0,
      };
    } catch (error) {
      console.error('[OnChainDataProvider] Blockchain.com API error:', error);
      return null;
    }
  }

  /**
   * Fetch exchange data from CoinGecko
   */
  private async fetchCoinGeckoExchangeData(symbol: string): Promise<{
    exchangeReserve: number;
    reserveChange24h: number;
    reserveChange7d: number;
  } | null> {
    // Rate limiting
    const now = Date.now();
    if (now - this.lastCoinGeckoApiCall < this.COINGECKO_API_INTERVAL) {
      await this.sleep(this.COINGECKO_API_INTERVAL - (now - this.lastCoinGeckoApiCall));
    }
    this.lastCoinGeckoApiCall = Date.now();
    
    try {
      const coinId = this.getCoinGeckoId(symbol);
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Estimate exchange reserve from trading volume (rough approximation)
      // Real exchange reserves would require CryptoQuant/Glassnode paid APIs
      const volume24h = data.market_data?.total_volume?.usd || 0;
      const circulatingSupply = data.market_data?.circulating_supply || 0;
      const currentPrice = data.market_data?.current_price?.usd || 0;
      
      // Estimate ~10-15% of circulating supply on exchanges (industry average)
      const estimatedExchangeReserve = circulatingSupply * 0.12;
      
      // Calculate reserve change from price/volume dynamics
      const priceChange24h = data.market_data?.price_change_percentage_24h || 0;
      const priceChange7d = data.market_data?.price_change_percentage_7d || 0;
      
      // Inverse correlation: rising prices often correlate with falling reserves
      const reserveChange24h = -priceChange24h * 0.1; // Scaled down
      const reserveChange7d = -priceChange7d * 0.1;
      
      return {
        exchangeReserve: estimatedExchangeReserve,
        reserveChange24h,
        reserveChange7d,
      };
    } catch (error) {
      console.error('[OnChainDataProvider] CoinGecko API error:', error);
      return null;
    }
  }

  /**
   * Fetch whale transactions from Whale Alert API
   */
  private async fetchWhaleAlertData(symbol: string, limit: number = 20): Promise<WhaleTransaction[]> {
    const apiKey = ENV.whaleAlertApiKey;
    if (!apiKey) {
      console.warn('[OnChainDataProvider] Whale Alert API key not configured');
      return [];
    }
    
    try {
      const blockchain = this.getWhaleAlertBlockchain(symbol);
      if (!blockchain) return [];
      
      const minValue = symbol === 'BTC' ? 1000000 : 500000; // $1M for BTC, $500K for others
      const response = await fetch(
        `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}&blockchain=${blockchain}&min_value=${minValue}&limit=${limit}`
      );
      
      if (!response.ok) {
        throw new Error(`Whale Alert API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.transactions) return [];
      
      return data.transactions.map((tx: any) => ({
        hash: tx.hash,
        timestamp: tx.timestamp * 1000,
        symbol: symbol,
        amount: tx.amount,
        amountUsd: tx.amount_usd,
        from: tx.from?.address || 'unknown',
        to: tx.to?.address || 'unknown',
        fromOwner: tx.from?.owner || undefined,
        toOwner: tx.to?.owner || undefined,
        transactionType: this.classifyTransaction(tx),
      }));
    } catch (error) {
      console.error('[OnChainDataProvider] Whale Alert API error:', error);
      return [];
    }
  }

  /**
   * Analyze whale transactions to estimate exchange flows
   */
  private analyzeWhaleTransactions(transactions: WhaleTransaction[]): {
    inflow: number;
    outflow: number;
    largeCount: number;
    largeVolume: number;
  } {
    let inflow = 0;
    let outflow = 0;
    let largeCount = 0;
    let largeVolume = 0;
    
    for (const tx of transactions) {
      largeCount++;
      largeVolume += tx.amount;
      
      if (tx.transactionType === 'exchange_inflow') {
        inflow += tx.amount;
      } else if (tx.transactionType === 'exchange_outflow') {
        outflow += tx.amount;
      }
    }
    
    return { inflow, outflow, largeCount, largeVolume };
  }

  /**
   * Classify transaction type based on addresses
   */
  private classifyTransaction(tx: any): WhaleTransaction['transactionType'] {
    const fromOwner = tx.from?.owner?.toLowerCase() || '';
    const toOwner = tx.to?.owner?.toLowerCase() || '';
    
    const exchangeKeywords = ['binance', 'coinbase', 'kraken', 'bitfinex', 'huobi', 'okex', 'bybit', 'kucoin', 'gemini'];
    
    const fromIsExchange = exchangeKeywords.some(kw => fromOwner.includes(kw));
    const toIsExchange = exchangeKeywords.some(kw => toOwner.includes(kw));
    
    if (toIsExchange && !fromIsExchange) {
      return 'exchange_inflow';
    } else if (fromIsExchange && !toIsExchange) {
      return 'exchange_outflow';
    } else if (!fromIsExchange && !toIsExchange) {
      return 'whale_transfer';
    }
    
    return 'unknown';
  }

  /**
   * Fill missing metrics with estimates
   */
  private fillMissingMetrics(
    metrics: Partial<ExchangeFlowMetrics>,
    symbol: string
  ): ExchangeFlowMetrics {
    const defaults = this.getDefaultMetrics(symbol);
    
    return {
      symbol: metrics.symbol || symbol,
      timestamp: metrics.timestamp || Date.now(),
      estimatedInflow: metrics.estimatedInflow ?? defaults.estimatedInflow ?? 0,
      estimatedOutflow: metrics.estimatedOutflow ?? defaults.estimatedOutflow ?? 0,
      netFlow: metrics.netFlow ?? defaults.netFlow ?? 0,
      flowConfidence: metrics.flowConfidence ?? 0.3,
      exchangeReserve: metrics.exchangeReserve ?? defaults.exchangeReserve ?? 0,
      reserveChange24h: metrics.reserveChange24h ?? 0,
      reserveChange7d: metrics.reserveChange7d ?? 0,
      largeTransactionCount: metrics.largeTransactionCount ?? 0,
      largeTransactionVolume: metrics.largeTransactionVolume ?? 0,
      avgLargeTransactionSize: metrics.avgLargeTransactionSize ?? 0,
      networkHashRate: metrics.networkHashRate,
      mempoolSize: metrics.mempoolSize,
      avgBlockTime: metrics.avgBlockTime,
      activeAddresses: metrics.activeAddresses,
      dataSources: metrics.dataSources || [],
      lastUpdated: metrics.lastUpdated || Date.now(),
    };
  }

  /**
   * Get default metrics for a symbol
   */
  private getDefaultMetrics(symbol: string): Partial<ExchangeFlowMetrics> {
    const defaults: Record<string, Partial<ExchangeFlowMetrics>> = {
      BTC: {
        exchangeReserve: 2_000_000,
        estimatedInflow: 1000,
        estimatedOutflow: 1000,
        netFlow: 0,
      },
      ETH: {
        exchangeReserve: 15_000_000,
        estimatedInflow: 10000,
        estimatedOutflow: 10000,
        netFlow: 0,
      },
      SOL: {
        exchangeReserve: 50_000_000,
        estimatedInflow: 100000,
        estimatedOutflow: 100000,
        netFlow: 0,
      },
    };
    
    return defaults[symbol] || {
      exchangeReserve: 100_000_000,
      estimatedInflow: 50000,
      estimatedOutflow: 50000,
      netFlow: 0,
    };
  }

  /**
   * Get fallback metrics when all APIs fail
   */
  private getFallbackMetrics(symbol: string): ExchangeFlowMetrics {
    const defaults = this.getDefaultMetrics(symbol);
    
    return {
      symbol,
      timestamp: Date.now(),
      estimatedInflow: defaults.estimatedInflow || 0,
      estimatedOutflow: defaults.estimatedOutflow || 0,
      netFlow: defaults.netFlow || 0,
      flowConfidence: 0.1,
      exchangeReserve: defaults.exchangeReserve || 0,
      reserveChange24h: 0,
      reserveChange7d: 0,
      largeTransactionCount: 0,
      largeTransactionVolume: 0,
      avgLargeTransactionSize: 0,
      dataSources: ['fallback'],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Helper methods
   */
  private normalizeSymbol(symbol: string): string {
    return symbol
      .replace(/USDT$/i, '')
      .replace(/\/USDT$/i, '')
      .replace(/-USDT$/i, '')
      .replace(/-USD$/i, '')
      .toUpperCase();
  }

  private getCoinGeckoId(symbol: string): string {
    const mapping: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      XRP: 'ripple',
      BNB: 'binancecoin',
      ADA: 'cardano',
      DOGE: 'dogecoin',
      AVAX: 'avalanche-2',
      DOT: 'polkadot',
      MATIC: 'matic-network',
    };
    return mapping[symbol] || symbol.toLowerCase();
  }

  private getWhaleAlertBlockchain(symbol: string): string | null {
    const mapping: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      XRP: 'ripple',
      USDT: 'tether',
      USDC: 'usd-coin',
    };
    return mapping[symbol] || null;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache<T>(key: string, data: T, ttl: number = this.CACHE_TTL): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const OnChainDataProvider = new OnChainDataProviderClass();
