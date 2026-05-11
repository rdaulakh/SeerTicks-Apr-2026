import { getActiveClock } from '../_core/clock';
/**
 * Dune Analytics Provider
 * 
 * Fetches on-chain data from Dune Analytics API to enhance trading signals.
 * Provides institutional-grade on-chain metrics:
 * - Exchange inflows/outflows
 * - Whale movements
 * - Cross-exchange flows
 * - Stablecoin metrics
 * - Network activity
 * 
 * API Documentation: https://docs.dune.com/api-reference/executions/endpoint/get-query-result
 */

export interface DuneQueryResult {
  execution_id: string;
  query_id: number;
  state: string;
  submitted_at: string;
  execution_started_at: string;
  execution_ended_at: string;
  result: {
    metadata: {
      column_names: string[];
      column_types: string[];
      row_count: number;
      datapoint_count: number;
    };
    rows: Record<string, any>[];
  };
}

export interface ExchangeFlowData {
  timestamp: Date;
  exchange: string;
  inflow: number;
  outflow: number;
  netFlow: number; // Positive = inflow (bearish), Negative = outflow (bullish)
}

export interface WhaleMovement {
  timestamp: Date;
  txHash: string;
  amount: number;
  amountUsd: number;
  fromType: 'exchange' | 'whale' | 'unknown';
  toType: 'exchange' | 'whale' | 'unknown';
  direction: 'to_exchange' | 'from_exchange' | 'whale_to_whale';
}

export interface OnChainSignal {
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  metrics: {
    exchangeNetFlow24h: number;
    exchangeNetFlow7d: number;
    whaleAccumulation: number;
    whaleDistribution: number;
    largeTransactionCount: number;
    stablecoinFlow: number;
  };
  reasoning: string;
  timestamp: Date;
  dataFreshness: number; // seconds since last update
}

export interface DuneOnChainMetrics {
  exchangeFlows: ExchangeFlowData[];
  whaleMovements: WhaleMovement[];
  aggregatedSignal: OnChainSignal;
  lastUpdated: Date;
}

// Popular Dune query IDs for crypto on-chain metrics
const DUNE_QUERIES = {
  // CEX Total Inflow & Outflow - tracks major exchange flows
  EXCHANGE_NETFLOW: 1621987,
  // Bitcoin Cross Exchange Flows
  BTC_CROSS_EXCHANGE: 2855661,
  // BTC Whale Movements Counter
  BTC_WHALE_MOVEMENTS: 5836364,
  // Bitcoin Exchange Inflow/Outflow
  BTC_EXCHANGE_FLOW: 5518299,
  // Top BTC Whales
  BTC_TOP_WHALES: 2011447,
};

export class DuneAnalyticsProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.dune.com/api/v1';
  private cache: Map<number, { data: DuneQueryResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 900000; // 15 minutes (Dune data updates slowly)
  private errorCache: Map<number, { timestamp: number; status: number }> = new Map();
  private readonly ERROR_CACHE_TTL = 1800000; // 30 minutes — don't retry failed queries too often
  private metricsCache: DuneOnChainMetrics | null = null;
  private lastMetricsFetch: number = 0;
  private readonly METRICS_CACHE_TTL = 600000; // 10 minutes
  private freeDataProvider: import('./FreeOnChainDataProvider').FreeOnChainDataProvider | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.DUNE_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[DuneAnalyticsProvider] DUNE_API_KEY not configured. Using free blockchain data sources.');
    }
    // Lazy-load free data provider for fallback
    import('./FreeOnChainDataProvider').then(({ FreeOnChainDataProvider }) => {
      this.freeDataProvider = new FreeOnChainDataProvider();
    }).catch(() => {
      console.warn('[DuneAnalyticsProvider] Could not load FreeOnChainDataProvider');
    });
  }

  /**
   * Check if the provider is configured with a valid API key
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Get the latest result for a Dune query
   */
  async getQueryResult(queryId: number): Promise<DuneQueryResult | null> {
    // Check cache first
    const cached = this.cache.get(queryId);
    if (cached && getActiveClock().now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`[DuneAnalyticsProvider] Using cached result for query ${queryId}`);
      return cached.data;
    }

    if (!this.apiKey) {
      console.warn(`[DuneAnalyticsProvider] No API key, returning null for query ${queryId}`);
      return null;
    }

    // Check error cache — don't retry recently failed queries
    const cachedError = this.errorCache.get(queryId);
    if (cachedError && getActiveClock().now() - cachedError.timestamp < this.ERROR_CACHE_TTL) {
      return null; // Silently skip — already logged on first failure
    }

    try {
      const url = `${this.baseUrl}/query/${queryId}/results?limit=100`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Dune-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DuneAnalyticsProvider] API error for query ${queryId}: ${response.status} - ${errorText}`);
        // Cache the error to prevent log spam
        this.errorCache.set(queryId, { timestamp: getActiveClock().now(), status: response.status });
        return null;
      }

      // Clear error cache on success
      this.errorCache.delete(queryId);
      const data = await response.json() as DuneQueryResult;
      
      // Cache the result
      this.cache.set(queryId, { data, timestamp: getActiveClock().now() });
      
      console.log(`[DuneAnalyticsProvider] Fetched ${data.result?.rows?.length || 0} rows for query ${queryId}`);
      return data;
    } catch (error) {
      console.error(`[DuneAnalyticsProvider] Failed to fetch query ${queryId}:`, error);
      // Cache network errors too
      this.errorCache.set(queryId, { timestamp: getActiveClock().now(), status: 0 });
      return null;
    }
  }

  /**
   * Get comprehensive on-chain metrics for trading signals
   */
  async getOnChainMetrics(symbol: string = 'BTC'): Promise<DuneOnChainMetrics> {
    // Check cache
    if (this.metricsCache && getActiveClock().now() - this.lastMetricsFetch < this.METRICS_CACHE_TTL) {
      return this.metricsCache;
    }

    console.log(`[DuneAnalyticsProvider] Fetching on-chain metrics for ${symbol}...`);

    // Fetch data from multiple queries in parallel
    const [exchangeFlowResult, whaleResult] = await Promise.all([
      this.getQueryResult(DUNE_QUERIES.EXCHANGE_NETFLOW),
      this.getQueryResult(DUNE_QUERIES.BTC_WHALE_MOVEMENTS),
    ]);

    // Parse exchange flow data (async - may fall back to free blockchain APIs)
    const exchangeFlows = await this.parseExchangeFlowData(exchangeFlowResult);

    // Parse whale movement data (async - may fall back to free blockchain APIs)
    const whaleMovements = await this.parseWhaleMovements(whaleResult);

    // Calculate aggregated signal
    const aggregatedSignal = this.calculateAggregatedSignal(exchangeFlows, whaleMovements);

    const metrics: DuneOnChainMetrics = {
      exchangeFlows,
      whaleMovements,
      aggregatedSignal,
      lastUpdated: new Date(),
    };

    // Cache the metrics
    this.metricsCache = metrics;
    this.lastMetricsFetch = getActiveClock().now();

    return metrics;
  }

  /**
   * Parse exchange flow data from Dune query result
   */
  private async parseExchangeFlowData(result: DuneQueryResult | null): Promise<ExchangeFlowData[]> {
    if (!result?.result?.rows) {
      return this.getFreeExchangeFlows();
    }

    try {
      return result.result.rows.map(row => ({
        timestamp: new Date(row.time || row.day || row.date || getActiveClock().now()),
        exchange: row.exchange || row.exchange_name || 'unknown',
        inflow: parseFloat(row.inflow || row.total_inflow || '0'),
        outflow: parseFloat(row.outflow || row.total_outflow || '0'),
        netFlow: parseFloat(row.netflow || row.net_flow || '0') ||
                 (parseFloat(row.inflow || '0') - parseFloat(row.outflow || '0')),
      }));
    } catch (error) {
      console.error('[DuneAnalyticsProvider] Failed to parse exchange flow data:', error);
      return this.getFreeExchangeFlows();
    }
  }

  /**
   * Parse whale movement data from Dune query result
   */
  private async parseWhaleMovements(result: DuneQueryResult | null): Promise<WhaleMovement[]> {
    if (!result?.result?.rows) {
      return this.getFreeWhaleMovements();
    }

    try {
      return result.result.rows.slice(0, 50).map(row => ({
        timestamp: new Date(row.block_time || row.time || getActiveClock().now()),
        txHash: row.tx_hash || row.hash || 'unknown',
        amount: parseFloat(row.amount || row.value || '0'),
        amountUsd: parseFloat(row.amount_usd || row.value_usd || '0'),
        fromType: this.classifyAddressType(row.from_type || row.from_label),
        toType: this.classifyAddressType(row.to_type || row.to_label),
        direction: this.determineDirection(row),
      }));
    } catch (error) {
      console.error('[DuneAnalyticsProvider] Failed to parse whale movements:', error);
      return this.getFreeWhaleMovements();
    }
  }

  /**
   * Classify address type from label
   */
  private classifyAddressType(label: string | undefined): 'exchange' | 'whale' | 'unknown' {
    if (!label) return 'unknown';
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes('exchange') || lowerLabel.includes('binance') || 
        lowerLabel.includes('coinbase') || lowerLabel.includes('kraken') ||
        lowerLabel.includes('okx') || lowerLabel.includes('bybit')) {
      return 'exchange';
    }
    if (lowerLabel.includes('whale') || lowerLabel.includes('fund') || 
        lowerLabel.includes('institution')) {
      return 'whale';
    }
    return 'unknown';
  }

  /**
   * Determine movement direction
   */
  private determineDirection(row: Record<string, any>): 'to_exchange' | 'from_exchange' | 'whale_to_whale' {
    const fromType = this.classifyAddressType(row.from_type || row.from_label);
    const toType = this.classifyAddressType(row.to_type || row.to_label);
    
    if (toType === 'exchange' && fromType !== 'exchange') return 'to_exchange';
    if (fromType === 'exchange' && toType !== 'exchange') return 'from_exchange';
    return 'whale_to_whale';
  }

  /**
   * Calculate aggregated on-chain signal from all metrics
   */
  private calculateAggregatedSignal(
    exchangeFlows: ExchangeFlowData[],
    whaleMovements: WhaleMovement[]
  ): OnChainSignal {
    // Calculate exchange net flow metrics
    const recentFlows = exchangeFlows.slice(-7); // Last 7 data points
    const totalNetFlow24h = recentFlows.slice(-1).reduce((sum, f) => sum + f.netFlow, 0);
    const totalNetFlow7d = recentFlows.reduce((sum, f) => sum + f.netFlow, 0);

    // Calculate whale metrics
    const toExchange = whaleMovements.filter(w => w.direction === 'to_exchange');
    const fromExchange = whaleMovements.filter(w => w.direction === 'from_exchange');
    const whaleAccumulation = fromExchange.reduce((sum, w) => sum + w.amountUsd, 0);
    const whaleDistribution = toExchange.reduce((sum, w) => sum + w.amountUsd, 0);
    const largeTransactionCount = whaleMovements.length;

    // Calculate stablecoin flow (simplified - would need separate query)
    const stablecoinFlow = totalNetFlow24h * 0.3; // Estimate

    // Determine signal based on metrics
    let bullishScore = 0;
    let bearishScore = 0;

    // Exchange net flow analysis
    // Negative net flow (outflows > inflows) = bullish (coins leaving exchanges)
    if (totalNetFlow24h < -1000) bullishScore += 2;
    else if (totalNetFlow24h < 0) bullishScore += 1;
    else if (totalNetFlow24h > 1000) bearishScore += 2;
    else if (totalNetFlow24h > 0) bearishScore += 1;

    // 7-day trend
    if (totalNetFlow7d < -5000) bullishScore += 2;
    else if (totalNetFlow7d < 0) bullishScore += 1;
    else if (totalNetFlow7d > 5000) bearishScore += 2;
    else if (totalNetFlow7d > 0) bearishScore += 1;

    // Whale accumulation vs distribution
    const whaleRatio = whaleAccumulation / (whaleDistribution || 1);
    if (whaleRatio > 1.5) bullishScore += 2;
    else if (whaleRatio > 1.1) bullishScore += 1;
    else if (whaleRatio < 0.67) bearishScore += 2;
    else if (whaleRatio < 0.9) bearishScore += 1;

    // Large transaction activity (high activity = potential volatility)
    if (largeTransactionCount > 50) {
      // High activity - lean towards current trend
      if (bullishScore > bearishScore) bullishScore += 1;
      else if (bearishScore > bullishScore) bearishScore += 1;
    }

    // Calculate final signal
    const netScore = bullishScore - bearishScore;
    let signal: 'bullish' | 'bearish' | 'neutral';
    let confidence: number;
    let strength: number;

    if (netScore >= 3) {
      signal = 'bullish';
      confidence = Math.min(0.85, 0.5 + netScore * 0.1);
      strength = Math.min(1.0, netScore * 0.15);
    } else if (netScore <= -3) {
      signal = 'bearish';
      confidence = Math.min(0.85, 0.5 + Math.abs(netScore) * 0.1);
      strength = Math.min(1.0, Math.abs(netScore) * 0.15);
    } else {
      signal = 'neutral';
      confidence = 0.5;
      strength = Math.abs(netScore) * 0.1;
    }

    // Build reasoning
    const reasoningParts: string[] = [];
    if (totalNetFlow24h < 0) {
      reasoningParts.push(`Exchange outflows of ${Math.abs(totalNetFlow24h).toFixed(0)} BTC in 24h (bullish)`);
    } else if (totalNetFlow24h > 0) {
      reasoningParts.push(`Exchange inflows of ${totalNetFlow24h.toFixed(0)} BTC in 24h (bearish)`);
    }
    if (whaleRatio > 1.1) {
      reasoningParts.push(`Whale accumulation ratio ${whaleRatio.toFixed(2)}x (bullish)`);
    } else if (whaleRatio < 0.9) {
      reasoningParts.push(`Whale distribution ratio ${whaleRatio.toFixed(2)}x (bearish)`);
    }
    reasoningParts.push(`${largeTransactionCount} large transactions detected`);

    return {
      signal,
      confidence,
      strength,
      metrics: {
        exchangeNetFlow24h: totalNetFlow24h,
        exchangeNetFlow7d: totalNetFlow7d,
        whaleAccumulation,
        whaleDistribution,
        largeTransactionCount,
        stablecoinFlow,
      },
      reasoning: reasoningParts.join('. '),
      timestamp: new Date(),
      dataFreshness: 0,
    };
  }

  /**
   * Get exchange flow data from free blockchain sources (mempool.space)
   * Replaces previous Math.random() mock data with real blockchain data
   */
  private async getFreeExchangeFlows(): Promise<ExchangeFlowData[]> {
    if (!this.freeDataProvider) {
      return []; // Empty, not random
    }

    try {
      const flowData = await this.freeDataProvider.getExchangeFlowData('BTCUSDT');
      // Convert to ExchangeFlowData format
      return [{
        timestamp: new Date(),
        exchange: flowData.dataSource,
        inflow: flowData.inflow,
        outflow: flowData.outflow,
        netFlow: flowData.netFlow,
      }];
    } catch (error) {
      console.warn('[DuneAnalyticsProvider] Free exchange flow fallback failed:', error);
      return []; // Empty, not random
    }
  }

  /**
   * Get whale movement data from free blockchain sources (mempool.space)
   * Replaces previous Math.random() mock data with real blockchain transaction data
   */
  private async getFreeWhaleMovements(): Promise<WhaleMovement[]> {
    if (!this.freeDataProvider) {
      return []; // Empty, not random
    }

    try {
      const whaleTxs = await this.freeDataProvider.getWhaleTransactions('BTCUSDT', 10);
      // Convert to WhaleMovement format
      return whaleTxs.map(tx => {
        let direction: 'to_exchange' | 'from_exchange' | 'whale_to_whale';
        if (tx.toType === 'exchange' && tx.fromType !== 'exchange') direction = 'to_exchange';
        else if (tx.fromType === 'exchange' && tx.toType !== 'exchange') direction = 'from_exchange';
        else direction = 'whale_to_whale';

        return {
          timestamp: new Date(tx.timestamp * 1000),
          txHash: tx.txHash,
          amount: tx.amount,
          amountUsd: tx.amountUsd,
          fromType: tx.fromType,
          toType: tx.toType,
          direction,
        };
      });
    } catch (error) {
      console.warn('[DuneAnalyticsProvider] Free whale movement fallback failed:', error);
      return []; // Empty, not random
    }
  }

  /**
   * Get a quick signal for trading decisions
   */
  async getQuickSignal(symbol: string = 'BTC'): Promise<OnChainSignal> {
    const metrics = await this.getOnChainMetrics(symbol);
    return metrics.aggregatedSignal;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    this.metricsCache = null;
    this.lastMetricsFetch = 0;
  }
}

// Singleton instance
let duneProvider: DuneAnalyticsProvider | null = null;

export function getDuneProvider(): DuneAnalyticsProvider {
  if (!duneProvider) {
    duneProvider = new DuneAnalyticsProvider();
  }
  return duneProvider;
}

export function initDuneProvider(apiKey: string): DuneAnalyticsProvider {
  duneProvider = new DuneAnalyticsProvider(apiKey);
  return duneProvider;
}
