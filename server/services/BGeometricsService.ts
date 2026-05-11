/**
 * BGeometrics Service
 * 
 * Provides FREE pre-computed Bitcoin on-chain metrics.
 * Free tier: 15 requests/day, 8 requests/hour
 * 
 * Available metrics:
 * - MVRV, NUPL, SOPR, NVT
 * - Funding rates, Open Interest
 * - Hashrate, Difficulty
 * - Supply metrics, HODL waves
 * - Technical indicators (RSI, MACD)
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

// API Response types
interface BGeometricsResponse<T> {
  d: string; // date
  unixTs: number;
  [key: string]: T | string | number;
}

export interface MVRVData {
  date: Date;
  mvrv: number;
  mvrvZScore: number;
}

export interface NUPLData {
  date: Date;
  nupl: number;
  nup: number;
  nul: number;
}

export interface SOPRData {
  date: Date;
  sopr: number;
}

export interface FundingRateData {
  date: Date;
  exchange: string;
  symbol: string;
  fundingRate: number;
}

export interface OpenInterestData {
  date: Date;
  exchange: string;
  symbol: string;
  openInterest: number;
  openInterestUSD: number;
}

export interface HashRateData {
  date: Date;
  hashrate: number;
  difficulty: number;
}

export interface SupplyData {
  date: Date;
  totalSupply: number;
  supplyInProfit: number;
  supplyInLoss: number;
  profitPercent: number;
}

export interface OnChainSignal {
  metric: string;
  value: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0-100
  description: string;
}

export class BGeometricsService extends EventEmitter {
  private baseUrl = 'https://bitcoin-data.com/v1';
  private requestCount = 0;
  private hourlyRequestCount = 0;
  private lastHourReset: Date = new Date();
  private lastDayReset: Date = new Date();
  private cache: Map<string, { data: unknown; expiry: Date }> = new Map();
  private cacheTTL = 60 * 60 * 1000; // 1 hour cache (data updates daily)

  // Rate limits
  private readonly DAILY_LIMIT = 15;
  private readonly HOURLY_LIMIT = 8;

  constructor() {
    super();
    this.resetCountersIfNeeded();
  }

  /**
   * Reset rate limit counters if time has passed
   */
  private resetCountersIfNeeded(): void {
    const now = new Date();
    
    // Reset hourly counter
    if (now.getTime() - this.lastHourReset.getTime() > 60 * 60 * 1000) {
      this.hourlyRequestCount = 0;
      this.lastHourReset = now;
    }
    
    // Reset daily counter
    if (now.getTime() - this.lastDayReset.getTime() > 24 * 60 * 60 * 1000) {
      this.requestCount = 0;
      this.lastDayReset = now;
    }
  }

  /**
   * Check if we can make a request
   */
  private canMakeRequest(): boolean {
    this.resetCountersIfNeeded();
    return this.requestCount < this.DAILY_LIMIT && this.hourlyRequestCount < this.HOURLY_LIMIT;
  }

  /**
   * Make API request with rate limiting and caching
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    // Check cache first
    const cached = this.cache.get(endpoint);
    if (cached && cached.expiry > new Date()) {
      return cached.data as T;
    }

    // Check rate limits
    if (!this.canMakeRequest()) {
      throw new Error('BGeometrics rate limit exceeded. Try again later.');
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      
      if (!response.ok) {
        throw new Error(`BGeometrics API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Update counters
      this.requestCount++;
      this.hourlyRequestCount++;

      // Cache the result
      this.cache.set(endpoint, {
        data,
        expiry: new Date(getActiveClock().now() + this.cacheTTL),
      });

      return data;
    } catch (error) {
      console.error(`[BGeometrics] Request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Get latest MVRV data
   */
  async getMVRV(): Promise<MVRVData> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/mvrv/last');
    
    return {
      date: new Date(data.d),
      mvrv: parseFloat(String(data.mvrv)) || 0,
      mvrvZScore: 0, // Calculate from separate endpoint if needed
    };
  }

  /**
   * Get MVRV Z-Score
   */
  async getMVRVZScore(): Promise<{ date: Date; zScore: number }> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/mvrv/last');
    
    // Z-Score calculation would need historical data
    // For now, return the raw MVRV
    return {
      date: new Date(data.d),
      zScore: parseFloat(String(data.mvrv)) || 0,
    };
  }

  /**
   * Get latest NUPL data
   */
  async getNUPL(): Promise<NUPLData> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/nupl/last');
    
    return {
      date: new Date(data.d),
      nupl: parseFloat(String(data.nupl)) || 0,
      nup: parseFloat(String(data.nup)) || 0,
      nul: parseFloat(String(data.nul)) || 0,
    };
  }

  /**
   * Get latest SOPR data
   */
  async getSOPR(): Promise<SOPRData> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/sopr/last');
    
    return {
      date: new Date(data.d),
      sopr: parseFloat(String(data.sopr)) || 0,
    };
  }

  /**
   * Get latest funding rates
   */
  async getFundingRates(): Promise<FundingRateData[]> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>[]>('/funding-rate');
    
    return data.map(item => ({
      date: new Date(item.d),
      exchange: String(item.exchange || 'aggregate'),
      symbol: String(item.symbol || 'BTC'),
      fundingRate: parseFloat(String(item.fundingRate)) || 0,
    }));
  }

  /**
   * Get latest open interest
   */
  async getOpenInterest(): Promise<OpenInterestData[]> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>[]>('/open-interest-1h');
    
    return data.map(item => ({
      date: new Date(item.d),
      exchange: String(item.exchange || 'aggregate'),
      symbol: String(item.symbol || 'BTC'),
      openInterest: parseFloat(String(item.openInterest)) || 0,
      openInterestUSD: parseFloat(String(item.openInterestUsd)) || 0,
    }));
  }

  /**
   * Get hashrate and difficulty
   */
  async getHashRate(): Promise<HashRateData> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/hashrate/last');
    
    return {
      date: new Date(data.d),
      hashrate: parseFloat(String(data.hashrate)) || 0,
      difficulty: parseFloat(String(data.difficulty)) || 0,
    };
  }

  /**
   * Get supply metrics
   */
  async getSupplyMetrics(): Promise<SupplyData> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/supply-profit/last');
    
    const supplyInProfit = parseFloat(String(data.supplyProfit)) || 0;
    const supplyInLoss = parseFloat(String(data.supplyLoss)) || 0;
    const totalSupply = supplyInProfit + supplyInLoss;
    
    return {
      date: new Date(data.d),
      totalSupply,
      supplyInProfit,
      supplyInLoss,
      profitPercent: totalSupply > 0 ? (supplyInProfit / totalSupply) * 100 : 0,
    };
  }

  /**
   * Get Puell Multiple
   */
  async getPuellMultiple(): Promise<{ date: Date; puellMultiple: number }> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/puell-multiple/last');
    
    return {
      date: new Date(data.d),
      puellMultiple: parseFloat(String(data.puellMultiple)) || 0,
    };
  }

  /**
   * Get Reserve Risk
   */
  async getReserveRisk(): Promise<{ date: Date; reserveRisk: number }> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/reserve-risk/last');
    
    return {
      date: new Date(data.d),
      reserveRisk: parseFloat(String(data.reserveRisk)) || 0,
    };
  }

  /**
   * Get NVT Signal
   */
  async getNVT(): Promise<{ date: Date; nvt: number }> {
    const data = await this.makeRequest<BGeometricsResponse<number | string>>('/nvts/last');
    
    return {
      date: new Date(data.d),
      nvt: parseFloat(String(data.nvts)) || 0,
    };
  }

  /**
   * Get comprehensive on-chain signals
   */
  async getOnChainSignals(): Promise<OnChainSignal[]> {
    const signals: OnChainSignal[] = [];

    try {
      // Get MVRV signal
      const mvrv = await this.getMVRV();
      signals.push(this.interpretMVRV(mvrv.mvrv));

      // Get NUPL signal
      const nupl = await this.getNUPL();
      signals.push(this.interpretNUPL(nupl.nupl));

      // Get SOPR signal
      const sopr = await this.getSOPR();
      signals.push(this.interpretSOPR(sopr.sopr));

    } catch (error) {
      console.error('[BGeometrics] Error fetching on-chain signals:', error);
    }

    return signals;
  }

  /**
   * Interpret MVRV value
   */
  private interpretMVRV(mvrv: number): OnChainSignal {
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let strength: number;
    let description: string;

    if (mvrv < 1) {
      signal = 'BULLISH';
      strength = Math.min(100, (1 - mvrv) * 100);
      description = 'MVRV below 1 indicates undervaluation - historically good buying zone';
    } else if (mvrv > 3.5) {
      signal = 'BEARISH';
      strength = Math.min(100, (mvrv - 3.5) * 50);
      description = 'MVRV above 3.5 indicates overvaluation - historically risky zone';
    } else if (mvrv > 2.5) {
      signal = 'BEARISH';
      strength = 50;
      description = 'MVRV elevated - caution advised';
    } else {
      signal = 'NEUTRAL';
      strength = 30;
      description = 'MVRV in normal range';
    }

    return { metric: 'MVRV', value: mvrv, signal, strength, description };
  }

  /**
   * Interpret NUPL value
   */
  private interpretNUPL(nupl: number): OnChainSignal {
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let strength: number;
    let description: string;

    if (nupl < 0) {
      signal = 'BULLISH';
      strength = Math.min(100, Math.abs(nupl) * 200);
      description = 'NUPL negative - capitulation zone, historically good for accumulation';
    } else if (nupl > 0.75) {
      signal = 'BEARISH';
      strength = Math.min(100, (nupl - 0.75) * 400);
      description = 'NUPL in euphoria zone - extreme greed, high risk';
    } else if (nupl > 0.5) {
      signal = 'BEARISH';
      strength = 50;
      description = 'NUPL elevated - belief/denial phase';
    } else if (nupl > 0.25) {
      signal = 'NEUTRAL';
      strength = 30;
      description = 'NUPL in optimism range';
    } else {
      signal = 'BULLISH';
      strength = 40;
      description = 'NUPL in hope/fear range - potential accumulation';
    }

    return { metric: 'NUPL', value: nupl, signal, strength, description };
  }

  /**
   * Interpret SOPR value
   */
  private interpretSOPR(sopr: number): OnChainSignal {
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let strength: number;
    let description: string;

    if (sopr < 0.95) {
      signal = 'BULLISH';
      strength = Math.min(100, (0.95 - sopr) * 500);
      description = 'SOPR below 0.95 - holders selling at loss, potential capitulation';
    } else if (sopr < 1) {
      signal = 'BULLISH';
      strength = 50;
      description = 'SOPR below 1 - slight loss taking, watch for reversal';
    } else if (sopr > 1.05) {
      signal = 'BEARISH';
      strength = Math.min(100, (sopr - 1.05) * 500);
      description = 'SOPR elevated - profit taking in progress';
    } else {
      signal = 'NEUTRAL';
      strength = 30;
      description = 'SOPR near 1 - break-even zone';
    }

    return { metric: 'SOPR', value: sopr, signal, strength, description };
  }

  /**
   * Get service status
   */
  getStatus(): {
    dailyRequestsRemaining: number;
    hourlyRequestsRemaining: number;
    cacheSize: number;
    lastReset: Date;
  } {
    this.resetCountersIfNeeded();
    
    return {
      dailyRequestsRemaining: this.DAILY_LIMIT - this.requestCount,
      hourlyRequestsRemaining: this.HOURLY_LIMIT - this.hourlyRequestCount,
      cacheSize: this.cache.size,
      lastReset: this.lastDayReset,
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
let bgeometricsService: BGeometricsService | null = null;

export function getBGeometricsService(): BGeometricsService {
  if (!bgeometricsService) {
    bgeometricsService = new BGeometricsService();
  }
  return bgeometricsService;
}

export default BGeometricsService;
