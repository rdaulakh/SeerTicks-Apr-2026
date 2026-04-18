/**
 * Dune Analytics Service
 * 
 * Provides on-chain analytics via Dune's SQL query API.
 * Free tier: 2,500 credits/month, 40 API calls/minute
 * 
 * Key features:
 * - Execute custom SQL queries for on-chain data
 * - Access community queries for whale tracking, exchange flows, etc.
 * - TypeScript SDK integration
 */

import { EventEmitter } from 'events';

// Dune API types
interface DuneQueryResult {
  execution_id: string;
  query_id: number;
  state: 'QUERY_STATE_PENDING' | 'QUERY_STATE_EXECUTING' | 'QUERY_STATE_COMPLETED' | 'QUERY_STATE_FAILED';
  result?: {
    rows: Record<string, unknown>[];
    metadata: {
      column_names: string[];
      column_types: string[];
      row_count: number;
    };
  };
}

interface DuneExecutionStatus {
  execution_id: string;
  state: string;
  submitted_at: string;
  expires_at: string;
  execution_started_at?: string;
  execution_ended_at?: string;
}

// Pre-built query IDs for common on-chain metrics
// These are community queries that can be used without creating custom queries
const COMMUNITY_QUERIES: Record<string, number> = {
  // Bitcoin whale wallets (>1000 BTC)
  BTC_WHALE_WALLETS: 3310917,

  // Ethereum whale wallets (>10000 ETH)
  ETH_WHALE_WALLETS: 3310963,

  // Exchange inflows/outflows
  EXCHANGE_FLOWS: 3276441,

  // Stablecoin supply on Ethereum
  STABLECOIN_SUPPLY: 3264458,

  // DEX trading volume
  DEX_VOLUME: 3303353,

  // NFT trading volume
  NFT_VOLUME: 3291779,
};

export interface OnChainMetric {
  name: string;
  value: number;
  timestamp: Date;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface WhaleTransaction {
  hash: string;
  from: string;
  to: string;
  value: number;
  token: string;
  timestamp: Date;
  isExchangeInflow: boolean;
  isExchangeOutflow: boolean;
}

export interface ExchangeFlow {
  exchange: string;
  token: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  timestamp: Date;
}

export class DuneAnalyticsService extends EventEmitter {
  private apiKey: string;
  private baseUrl = 'https://api.dune.com/api/v1';
  private rateLimitRemaining = 40;
  private rateLimitReset: Date | null = null;
  private queryCache: Map<string, { data: unknown; expiry: Date }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes cache

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.DUNE_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('[DuneAnalytics] No API key provided. Service will be limited.');
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Execute a Dune query by ID
   */
  async executeQuery(queryId: number, parameters?: Record<string, unknown>): Promise<DuneQueryResult> {
    if (!this.isConfigured()) {
      throw new Error('Dune Analytics API key not configured');
    }

    // Check cache first
    const cacheKey = `query_${queryId}_${JSON.stringify(parameters || {})}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.expiry > new Date()) {
      return cached.data as DuneQueryResult;
    }

    try {
      // Execute the query
      const executeResponse = await this.makeRequest(`/query/${queryId}/execute`, 'POST', {
        query_parameters: parameters,
      });

      const executionId = executeResponse.execution_id;

      // Poll for results
      let result: DuneQueryResult;
      let attempts = 0;
      const maxAttempts = 30; // 30 * 2s = 60s max wait

      do {
        await this.sleep(2000);
        result = await this.getExecutionStatus(executionId);
        attempts++;
      } while (
        result.state !== 'QUERY_STATE_COMPLETED' &&
        result.state !== 'QUERY_STATE_FAILED' &&
        attempts < maxAttempts
      );

      if (result.state === 'QUERY_STATE_FAILED') {
        throw new Error('Dune query execution failed');
      }

      if (result.state !== 'QUERY_STATE_COMPLETED') {
        throw new Error('Dune query timed out');
      }

      // Get full results
      const fullResult = await this.getExecutionResults(executionId);

      // Cache the result
      this.queryCache.set(cacheKey, {
        data: fullResult,
        expiry: new Date(Date.now() + this.cacheTTL),
      });

      return fullResult;
    } catch (error) {
      console.error('[DuneAnalytics] Query execution error:', error);
      throw error;
    }
  }

  /**
   * Get execution status
   */
  private async getExecutionStatus(executionId: string): Promise<DuneQueryResult> {
    return this.makeRequest(`/execution/${executionId}/status`, 'GET');
  }

  /**
   * Get execution results
   */
  private async getExecutionResults(executionId: string): Promise<DuneQueryResult> {
    return this.makeRequest(`/execution/${executionId}/results`, 'GET');
  }

  /**
   * Get latest results for a query (uses cached results if available)
   */
  async getLatestResults(queryId: number): Promise<DuneQueryResult> {
    if (!this.isConfigured()) {
      throw new Error('Dune Analytics API key not configured');
    }

    const cacheKey = `latest_${queryId}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.expiry > new Date()) {
      return cached.data as DuneQueryResult;
    }

    const result = await this.makeRequest(`/query/${queryId}/results`, 'GET');

    this.queryCache.set(cacheKey, {
      data: result,
      expiry: new Date(Date.now() + this.cacheTTL),
    });

    return result;
  }

  /**
   * Execute custom SQL query (requires Plus plan or higher)
   */
  async executeSQL(sql: string, name?: string): Promise<DuneQueryResult> {
    if (!this.isConfigured()) {
      throw new Error('Dune Analytics API key not configured');
    }

    // This endpoint requires Dune Plus ($349/mo) or higher
    // For free tier, use pre-built queries instead
    console.warn('[DuneAnalytics] Custom SQL requires Dune Plus subscription');
    
    throw new Error('Custom SQL queries require Dune Plus subscription. Use pre-built queries instead.');
  }

  /**
   * Get whale transactions for a token
   */
  async getWhaleTransactions(token: string, minValue: number = 1000000): Promise<WhaleTransaction[]> {
    // This would use a community query for whale tracking
    // For now, return empty array if no query ID configured
    const queryId = token === 'BTC' ? COMMUNITY_QUERIES.BTC_WHALE_WALLETS : COMMUNITY_QUERIES.ETH_WHALE_WALLETS;
    
    if (!queryId) {
      console.warn(`[DuneAnalytics] No whale tracking query configured for ${token}`);
      return [];
    }

    try {
      const result = await this.executeQuery(queryId, { min_value: minValue });
      
      if (!result.result?.rows) {
        return [];
      }

      return result.result.rows.map((row: Record<string, unknown>) => ({
        hash: String(row.tx_hash || ''),
        from: String(row.from_address || ''),
        to: String(row.to_address || ''),
        value: Number(row.value || 0),
        token,
        timestamp: new Date(String(row.block_time || Date.now())),
        isExchangeInflow: Boolean(row.is_exchange_inflow),
        isExchangeOutflow: Boolean(row.is_exchange_outflow),
      }));
    } catch (error) {
      console.error('[DuneAnalytics] Error fetching whale transactions:', error);
      return [];
    }
  }

  /**
   * Get exchange flows
   */
  async getExchangeFlows(token: string = 'ETH'): Promise<ExchangeFlow[]> {
    if (!COMMUNITY_QUERIES.EXCHANGE_FLOWS) {
      console.warn('[DuneAnalytics] No exchange flows query configured');
      return [];
    }

    try {
      const result = await this.executeQuery(COMMUNITY_QUERIES.EXCHANGE_FLOWS, { token });
      
      if (!result.result?.rows) {
        return [];
      }

      return result.result.rows.map((row: Record<string, unknown>) => ({
        exchange: String(row.exchange || ''),
        token,
        inflow: Number(row.inflow || 0),
        outflow: Number(row.outflow || 0),
        netFlow: Number(row.net_flow || 0),
        timestamp: new Date(String(row.date || Date.now())),
      }));
    } catch (error) {
      console.error('[DuneAnalytics] Error fetching exchange flows:', error);
      return [];
    }
  }

  /**
   * Get on-chain metrics summary
   */
  async getOnChainSummary(): Promise<OnChainMetric[]> {
    const metrics: OnChainMetric[] = [];
    const now = new Date();

    // This would aggregate data from multiple queries
    // For now, return placeholder structure
    
    return metrics;
  }

  /**
   * Make API request with rate limiting
   */
  private async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>
  ): Promise<DuneQueryResult> {
    // Check API key is configured before making request
    if (!this.isConfigured()) {
      throw new Error('Dune Analytics API key not configured');
    }
    
    // Check rate limit
    if (this.rateLimitRemaining <= 0 && this.rateLimitReset && this.rateLimitReset > new Date()) {
      const waitTime = this.rateLimitReset.getTime() - Date.now();
      console.warn(`[DuneAnalytics] Rate limited. Waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'X-Dune-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    // Update rate limit info from headers
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset) {
      this.rateLimitReset = new Date(parseInt(reset, 10) * 1000);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dune API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * Get service status
   */
  getStatus(): {
    configured: boolean;
    rateLimitRemaining: number;
    cacheSize: number;
  } {
    return {
      configured: this.isConfigured(),
      rateLimitRemaining: this.rateLimitRemaining,
      cacheSize: this.queryCache.size,
    };
  }
}

// Singleton instance
let duneService: DuneAnalyticsService | null = null;

export function getDuneAnalyticsService(): DuneAnalyticsService {
  if (!duneService) {
    duneService = new DuneAnalyticsService();
  }
  return duneService;
}

export default DuneAnalyticsService;
