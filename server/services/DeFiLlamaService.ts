/**
 * DeFiLlama Service
 * 
 * Provides FREE DeFi analytics data.
 * No API key required, no explicit rate limits.
 * 
 * Available data:
 * - TVL (Total Value Locked) by protocol and chain
 * - Stablecoin supply and flows
 * - DEX trading volumes
 * - Yields/APY data
 * - Protocol fees and revenue
 * - Bridge volumes
 */

import { EventEmitter } from 'events';

// API Response types
interface Protocol {
  id: string;
  name: string;
  symbol: string;
  category: string;
  chains: string[];
  tvl: number;
  chainTvls: Record<string, number>;
  change_1d: number;
  change_7d: number;
  change_1m?: number;
}

interface ChainTVL {
  gecko_id: string;
  tvl: number;
  tokenSymbol: string;
  cmcId: string;
  name: string;
  chainId?: number;
}

interface Stablecoin {
  id: string;
  name: string;
  symbol: string;
  gecko_id: string;
  pegType: string;
  pegMechanism: string;
  circulating: Record<string, number>;
  price: number;
}

interface DEXVolume {
  name: string;
  displayName: string;
  totalVolume24h: number;
  totalVolume7d: number;
  change_1d: number;
  change_7d: number;
}

interface YieldPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
  pool: string;
}

export interface TVLData {
  protocol: string;
  tvl: number;
  change24h: number;
  change7d: number;
  chains: string[];
}

export interface StablecoinFlow {
  name: string;
  symbol: string;
  totalSupply: number;
  change24h: number;
  change7d: number;
  dominance: number;
}

export interface DeFiSentiment {
  totalTVL: number;
  tvlChange24h: number;
  tvlChange7d: number;
  stablecoinSupply: number;
  stablecoinChange24h: number;
  dexVolume24h: number;
  dexVolumeChange24h: number;
  sentiment: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  description: string;
}

export class DeFiLlamaService extends EventEmitter {
  private baseUrl = 'https://api.llama.fi';
  private coinsUrl = 'https://coins.llama.fi';
  private yieldsUrl = 'https://yields.llama.fi';
  private cache: Map<string, { data: unknown; expiry: Date }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes cache

  constructor() {
    super();
  }

  /**
   * Make API request with caching
   */
  private async makeRequest<T>(url: string, cacheTTL?: number): Promise<T> {
    // Check cache first
    const cached = this.cache.get(url);
    if (cached && cached.expiry > new Date()) {
      return cached.data as T;
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`DeFiLlama API error: ${response.status}`);
      }

      const data = await response.json();

      // Cache the result
      this.cache.set(url, {
        data,
        expiry: new Date(Date.now() + (cacheTTL || this.cacheTTL)),
      });

      return data;
    } catch (error) {
      console.error(`[DeFiLlama] Request failed for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Get all protocols with TVL
   */
  async getProtocols(): Promise<Protocol[]> {
    return this.makeRequest<Protocol[]>(`${this.baseUrl}/protocols`);
  }

  /**
   * Get TVL for a specific protocol
   */
  async getProtocolTVL(protocol: string): Promise<TVLData> {
    const data = await this.makeRequest<Protocol>(`${this.baseUrl}/protocol/${protocol}`);
    
    return {
      protocol: data.name,
      tvl: data.tvl,
      change24h: data.change_1d,
      change7d: data.change_7d,
      chains: data.chains,
    };
  }

  /**
   * Get TVL by chain
   */
  async getChainTVL(): Promise<ChainTVL[]> {
    return this.makeRequest<ChainTVL[]>(`${this.baseUrl}/v2/chains`);
  }

  /**
   * Get total DeFi TVL
   */
  async getTotalTVL(): Promise<number> {
    const chains = await this.getChainTVL();
    return chains.reduce((sum, chain) => sum + chain.tvl, 0);
  }

  /**
   * Get top protocols by TVL
   */
  async getTopProtocols(limit: number = 20): Promise<TVLData[]> {
    const protocols = await this.getProtocols();
    
    return protocols
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, limit)
      .map(p => ({
        protocol: p.name,
        tvl: p.tvl,
        change24h: p.change_1d,
        change7d: p.change_7d,
        chains: p.chains,
      }));
  }

  /**
   * Get stablecoin data
   */
  async getStablecoins(): Promise<Stablecoin[]> {
    const data = await this.makeRequest<{ peggedAssets: Stablecoin[] }>(
      `${this.baseUrl}/stablecoins`
    );
    return data.peggedAssets;
  }

  /**
   * Get stablecoin flows (supply changes)
   */
  async getStablecoinFlows(): Promise<StablecoinFlow[]> {
    const stablecoins = await this.getStablecoins();
    const totalSupply = stablecoins.reduce((sum, s) => {
      const supply = Object.values(s.circulating || {}).reduce((a, b) => a + b, 0);
      return sum + supply;
    }, 0);

    return stablecoins
      .filter(s => s.circulating)
      .map(s => {
        const supply = Object.values(s.circulating).reduce((a, b) => a + b, 0);
        return {
          name: s.name,
          symbol: s.symbol,
          totalSupply: supply,
          change24h: 0, // Would need historical data
          change7d: 0,
          dominance: totalSupply > 0 ? (supply / totalSupply) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalSupply - a.totalSupply);
  }

  /**
   * Get DEX volumes
   */
  async getDEXVolumes(): Promise<DEXVolume[]> {
    const data = await this.makeRequest<{ protocols: DEXVolume[] }>(
      `${this.baseUrl}/overview/dexs`
    );
    return data.protocols || [];
  }

  /**
   * Get total DEX volume (24h)
   */
  async getTotalDEXVolume(): Promise<{ volume24h: number; change24h: number }> {
    const data = await this.makeRequest<{ total24h: number; change_1d: number }>(
      `${this.baseUrl}/overview/dexs`
    );
    
    return {
      volume24h: data.total24h || 0,
      change24h: data.change_1d || 0,
    };
  }

  /**
   * Get yield pools
   */
  async getYieldPools(chain?: string): Promise<YieldPool[]> {
    const data = await this.makeRequest<{ data: YieldPool[] }>(
      `${this.yieldsUrl}/pools`
    );
    
    let pools = data.data || [];
    
    if (chain) {
      pools = pools.filter(p => p.chain.toLowerCase() === chain.toLowerCase());
    }
    
    return pools;
  }

  /**
   * Get top yield opportunities
   */
  async getTopYields(limit: number = 20, minTVL: number = 1000000): Promise<YieldPool[]> {
    const pools = await this.getYieldPools();
    
    return pools
      .filter(p => p.tvlUsd >= minTVL && p.apy > 0 && p.apy < 1000) // Filter unrealistic APYs
      .sort((a, b) => b.apy - a.apy)
      .slice(0, limit);
  }

  /**
   * Get fees and revenue data
   */
  async getFeesAndRevenue(): Promise<{ protocols: Array<{ name: string; total24h: number; change_1d: number }> }> {
    return this.makeRequest(`${this.baseUrl}/overview/fees`);
  }

  /**
   * Get DeFi sentiment analysis
   */
  async getDeFiSentiment(): Promise<DeFiSentiment> {
    try {
      // Get TVL data
      const chains = await this.getChainTVL();
      const totalTVL = chains.reduce((sum, chain) => sum + chain.tvl, 0);

      // Get DEX volume
      const dexData = await this.getTotalDEXVolume();

      // Get stablecoin data
      const stablecoins = await this.getStablecoins();
      const stablecoinSupply = stablecoins.reduce((sum, s) => {
        return sum + Object.values(s.circulating || {}).reduce((a, b) => a + b, 0);
      }, 0);

      // Calculate sentiment
      let sentiment: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' = 'NEUTRAL';
      let description = '';

      // Simple sentiment logic based on TVL and volume changes
      const tvlChange = 0; // Would need historical comparison
      const volumeChange = dexData.change24h;

      if (volumeChange > 20) {
        sentiment = 'RISK_ON';
        description = 'High DEX activity indicates increased risk appetite';
      } else if (volumeChange < -20) {
        sentiment = 'RISK_OFF';
        description = 'Low DEX activity indicates decreased risk appetite';
      } else {
        sentiment = 'NEUTRAL';
        description = 'DeFi activity within normal range';
      }

      return {
        totalTVL,
        tvlChange24h: tvlChange,
        tvlChange7d: 0,
        stablecoinSupply,
        stablecoinChange24h: 0,
        dexVolume24h: dexData.volume24h,
        dexVolumeChange24h: dexData.change24h,
        sentiment,
        description,
      };
    } catch (error) {
      console.error('[DeFiLlama] Error calculating sentiment:', error);
      throw error;
    }
  }

  /**
   * Get protocol by category
   */
  async getProtocolsByCategory(category: string): Promise<TVLData[]> {
    const protocols = await this.getProtocols();
    
    return protocols
      .filter(p => p.category?.toLowerCase() === category.toLowerCase())
      .sort((a, b) => b.tvl - a.tvl)
      .map(p => ({
        protocol: p.name,
        tvl: p.tvl,
        change24h: p.change_1d,
        change7d: p.change_7d,
        chains: p.chains,
      }));
  }

  /**
   * Get TVL by category (Lending, DEX, etc.)
   */
  async getTVLByCategory(): Promise<Record<string, number>> {
    const protocols = await this.getProtocols();
    const categories: Record<string, number> = {};

    for (const protocol of protocols) {
      const category = protocol.category || 'Other';
      categories[category] = (categories[category] || 0) + protocol.tvl;
    }

    return categories;
  }

  /**
   * Get service status
   */
  getStatus(): {
    cacheSize: number;
    endpoints: string[];
  } {
    return {
      cacheSize: this.cache.size,
      endpoints: [
        '/protocols',
        '/v2/chains',
        '/stablecoins',
        '/overview/dexs',
        '/overview/fees',
      ],
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
let defiLlamaService: DeFiLlamaService | null = null;

export function getDeFiLlamaService(): DeFiLlamaService {
  if (!defiLlamaService) {
    defiLlamaService = new DeFiLlamaService();
  }
  return defiLlamaService;
}

export default DeFiLlamaService;
