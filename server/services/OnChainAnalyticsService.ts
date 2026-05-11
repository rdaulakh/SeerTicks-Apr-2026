/**
 * Unified On-Chain Analytics Service
 * 
 * Combines data from multiple FREE sources:
 * - BGeometrics: Bitcoin on-chain metrics (MVRV, NUPL, SOPR)
 * - DeFiLlama: DeFi TVL, stablecoins, DEX volumes
 * - Dune Analytics: Custom queries (when API key available)
 * 
 * This service provides a single interface for all on-chain analytics
 * without requiring expensive subscriptions to Glassnode or CryptoQuant.
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getBGeometricsService, OnChainSignal } from './BGeometricsService';
import { getDeFiLlamaService, DeFiSentiment } from './DeFiLlamaService';
import { getDuneAnalyticsService } from './DuneAnalyticsService';

export interface MarketHealthScore {
  score: number; // 0-100
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0-100
  signals: OnChainSignal[];
  defiSentiment: DeFiSentiment | null;
  timestamp: Date;
}

export interface OnChainDashboard {
  // Bitcoin metrics
  btcMetrics: {
    mvrv: number | null;
    nupl: number | null;
    sopr: number | null;
    fundingRate: number | null;
    signals: OnChainSignal[];
  };
  
  // DeFi metrics
  defiMetrics: {
    totalTVL: number | null;
    tvlChange24h: number | null;
    stablecoinSupply: number | null;
    dexVolume24h: number | null;
    topProtocols: Array<{ name: string; tvl: number; change24h: number }>;
  };
  
  // Overall health
  marketHealth: MarketHealthScore;
  
  // Data freshness
  lastUpdated: Date;
  dataSource: string[];
}

export class OnChainAnalyticsService extends EventEmitter {
  private bgeometrics = getBGeometricsService();
  private defiLlama = getDeFiLlamaService();
  private dune = getDuneAnalyticsService();
  
  private dashboardCache: OnChainDashboard | null = null;
  private cacheExpiry: Date | null = null;
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
  }

  /**
   * Get comprehensive on-chain dashboard
   */
  async getDashboard(): Promise<OnChainDashboard> {
    // Return cached data if fresh
    if (this.dashboardCache && this.cacheExpiry && this.cacheExpiry > new Date()) {
      return this.dashboardCache;
    }

    const dataSources: string[] = [];
    
    // Initialize with null values
    const dashboard: OnChainDashboard = {
      btcMetrics: {
        mvrv: null,
        nupl: null,
        sopr: null,
        fundingRate: null,
        signals: [],
      },
      defiMetrics: {
        totalTVL: null,
        tvlChange24h: null,
        stablecoinSupply: null,
        dexVolume24h: null,
        topProtocols: [],
      },
      marketHealth: {
        score: 50,
        trend: 'NEUTRAL',
        confidence: 0,
        signals: [],
        defiSentiment: null,
        timestamp: new Date(),
      },
      lastUpdated: new Date(),
      dataSource: [],
    };

    // Fetch BGeometrics data (Bitcoin on-chain)
    try {
      const [mvrv, nupl, sopr] = await Promise.all([
        this.bgeometrics.getMVRV().catch(() => null),
        this.bgeometrics.getNUPL().catch(() => null),
        this.bgeometrics.getSOPR().catch(() => null),
      ]);

      if (mvrv) dashboard.btcMetrics.mvrv = mvrv.mvrv;
      if (nupl) dashboard.btcMetrics.nupl = nupl.nupl;
      if (sopr) dashboard.btcMetrics.sopr = sopr.sopr;

      // Get signals
      const signals = await this.bgeometrics.getOnChainSignals().catch(() => []);
      dashboard.btcMetrics.signals = signals;
      dashboard.marketHealth.signals = signals;

      dataSources.push('BGeometrics');
    } catch (error) {
      console.error('[OnChainAnalytics] BGeometrics error:', error);
    }

    // Fetch DeFiLlama data
    try {
      const [totalTVL, dexVolume, topProtocols, sentiment] = await Promise.all([
        this.defiLlama.getTotalTVL().catch(() => null),
        this.defiLlama.getTotalDEXVolume().catch(() => null),
        this.defiLlama.getTopProtocols(10).catch(() => []),
        this.defiLlama.getDeFiSentiment().catch(() => null),
      ]);

      if (totalTVL) dashboard.defiMetrics.totalTVL = totalTVL;
      if (dexVolume) {
        dashboard.defiMetrics.dexVolume24h = dexVolume.volume24h;
      }
      dashboard.defiMetrics.topProtocols = topProtocols.map(p => ({
        name: p.protocol,
        tvl: p.tvl,
        change24h: p.change24h,
      }));

      if (sentiment) {
        dashboard.marketHealth.defiSentiment = sentiment;
        dashboard.defiMetrics.stablecoinSupply = sentiment.stablecoinSupply;
        dashboard.defiMetrics.tvlChange24h = sentiment.tvlChange24h;
      }

      dataSources.push('DeFiLlama');
    } catch (error) {
      console.error('[OnChainAnalytics] DeFiLlama error:', error);
    }

    // Calculate market health score
    dashboard.marketHealth = this.calculateMarketHealth(dashboard);
    dashboard.dataSource = dataSources;

    // Cache the result
    this.dashboardCache = dashboard;
    this.cacheExpiry = new Date(getActiveClock().now() + this.cacheTTL);

    return dashboard;
  }

  /**
   * Calculate overall market health score
   */
  private calculateMarketHealth(dashboard: OnChainDashboard): MarketHealthScore {
    let score = 50; // Start neutral
    let bullishSignals = 0;
    let bearishSignals = 0;
    let totalSignals = 0;

    // Process BTC on-chain signals
    for (const signal of dashboard.btcMetrics.signals) {
      totalSignals++;
      if (signal.signal === 'BULLISH') {
        bullishSignals++;
        score += signal.strength * 0.3;
      } else if (signal.signal === 'BEARISH') {
        bearishSignals++;
        score -= signal.strength * 0.3;
      }
    }

    // Process DeFi sentiment
    if (dashboard.marketHealth.defiSentiment) {
      const defi = dashboard.marketHealth.defiSentiment;
      totalSignals++;
      
      if (defi.sentiment === 'RISK_ON') {
        bullishSignals++;
        score += 10;
      } else if (defi.sentiment === 'RISK_OFF') {
        bearishSignals++;
        score -= 10;
      }

      // TVL change impact
      if (defi.tvlChange24h > 5) score += 5;
      else if (defi.tvlChange24h < -5) score -= 5;

      // DEX volume change impact
      if (defi.dexVolumeChange24h > 20) score += 5;
      else if (defi.dexVolumeChange24h < -20) score -= 5;
    }

    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine trend
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (score >= 60) trend = 'BULLISH';
    else if (score <= 40) trend = 'BEARISH';
    else trend = 'NEUTRAL';

    // Calculate confidence based on data availability
    const confidence = totalSignals > 0 ? Math.min(100, totalSignals * 20) : 0;

    return {
      score,
      trend,
      confidence,
      signals: dashboard.btcMetrics.signals,
      defiSentiment: dashboard.marketHealth.defiSentiment,
      timestamp: new Date(),
    };
  }

  /**
   * Get Bitcoin-specific metrics
   */
  async getBitcoinMetrics(): Promise<{
    mvrv: number | null;
    nupl: number | null;
    sopr: number | null;
    puellMultiple: number | null;
    reserveRisk: number | null;
    nvt: number | null;
  }> {
    const [mvrv, nupl, sopr, puell, reserveRisk, nvt] = await Promise.all([
      this.bgeometrics.getMVRV().catch(() => null),
      this.bgeometrics.getNUPL().catch(() => null),
      this.bgeometrics.getSOPR().catch(() => null),
      this.bgeometrics.getPuellMultiple().catch(() => null),
      this.bgeometrics.getReserveRisk().catch(() => null),
      this.bgeometrics.getNVT().catch(() => null),
    ]);

    return {
      mvrv: mvrv?.mvrv ?? null,
      nupl: nupl?.nupl ?? null,
      sopr: sopr?.sopr ?? null,
      puellMultiple: puell?.puellMultiple ?? null,
      reserveRisk: reserveRisk?.reserveRisk ?? null,
      nvt: nvt?.nvt ?? null,
    };
  }

  /**
   * Get DeFi-specific metrics
   */
  async getDeFiMetrics(): Promise<{
    totalTVL: number;
    tvlByCategory: Record<string, number>;
    topProtocols: Array<{ name: string; tvl: number; change24h: number }>;
    dexVolume24h: number;
    stablecoinSupply: number;
  }> {
    const [totalTVL, tvlByCategory, topProtocols, dexVolume, stablecoins] = await Promise.all([
      this.defiLlama.getTotalTVL(),
      this.defiLlama.getTVLByCategory(),
      this.defiLlama.getTopProtocols(20),
      this.defiLlama.getTotalDEXVolume(),
      this.defiLlama.getStablecoinFlows(),
    ]);

    return {
      totalTVL,
      tvlByCategory,
      topProtocols: topProtocols.map(p => ({
        name: p.protocol,
        tvl: p.tvl,
        change24h: p.change24h,
      })),
      dexVolume24h: dexVolume.volume24h,
      stablecoinSupply: stablecoins.reduce((sum, s) => sum + s.totalSupply, 0),
    };
  }

  /**
   * Get service status
   */
  getStatus(): {
    bgeometrics: {
      dailyRequestsRemaining: number;
      hourlyRequestsRemaining: number;
      cacheSize: number;
      lastReset: Date;
    };
    defiLlama: {
      cacheSize: number;
      endpoints: string[];
    };
    dune: {
      configured: boolean;
      rateLimitRemaining: number;
      cacheSize: number;
    };
    cacheValid: boolean;
  } {
    return {
      bgeometrics: this.bgeometrics.getStatus(),
      defiLlama: this.defiLlama.getStatus(),
      dune: this.dune.getStatus(),
      cacheValid: !!(this.cacheExpiry && this.cacheExpiry > new Date()),
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.dashboardCache = null;
    this.cacheExpiry = null;
    this.bgeometrics.clearCache();
    this.defiLlama.clearCache();
    this.dune.clearCache();
  }
}

// Singleton instance
let onChainAnalyticsService: OnChainAnalyticsService | null = null;

export function getOnChainAnalyticsService(): OnChainAnalyticsService {
  if (!onChainAnalyticsService) {
    onChainAnalyticsService = new OnChainAnalyticsService();
  }
  return onChainAnalyticsService;
}

export default OnChainAnalyticsService;
