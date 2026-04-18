/**
 * Coinbase Historical Data Service
 * 
 * Service for fetching and managing historical OHLCV data from Coinbase
 * Used for backtesting and model training
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface IngestionJob {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  candlesIngested: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataCoverage {
  symbol: string;
  timeframe: Timeframe;
  totalCandles: number;
  earliestDate: Date | null;
  latestDate: Date | null;
}

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// Coinbase Historical Data Service
// ============================================================================

class CoinbaseHistoricalDataServiceClass extends EventEmitter {
  private jobs: Map<string, IngestionJob> = new Map();
  private jobCounter: number = 0;

  constructor() {
    super();
    console.log('[CoinbaseHistoricalDataService] Initialized');
  }

  /**
   * Create a new ingestion job
   */
  async createIngestionJob(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const jobId = `job_${++this.jobCounter}_${Date.now()}`;
    
    const job: IngestionJob = {
      id: jobId,
      symbol,
      timeframe,
      startDate,
      endDate,
      status: 'pending',
      progress: 0,
      candlesIngested: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, job);
    console.log(`[CoinbaseHistoricalDataService] Created job ${jobId} for ${symbol} ${timeframe}`);
    
    return jobId;
  }

  /**
   * Run an ingestion job
   */
  async runIngestionJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status === 'running') {
      console.log(`[CoinbaseHistoricalDataService] Job ${jobId} is already running`);
      return;
    }

    job.status = 'running';
    job.updatedAt = new Date();
    this.emit('job_started', job);

    try {
      // Simulate data fetching (in production, this would fetch from Coinbase API)
      const totalBatches = 10;
      for (let i = 0; i < totalBatches; i++) {
        // Re-fetch job to check for status changes
        const currentJob = this.jobs.get(jobId);
        if (!currentJob || currentJob.status === 'paused') {
          console.log(`[CoinbaseHistoricalDataService] Job ${jobId} paused`);
          return;
        }

        // Simulate batch processing
        await new Promise(resolve => setTimeout(resolve, 100));
        
        job.progress = ((i + 1) / totalBatches) * 100;
        job.candlesIngested += 100;
        job.updatedAt = new Date();
        
        this.emit('job_progress', job);
      }

      job.status = 'completed';
      job.progress = 100;
      job.updatedAt = new Date();
      
      console.log(`[CoinbaseHistoricalDataService] Job ${jobId} completed with ${job.candlesIngested} candles`);
      this.emit('job_completed', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date();
      
      console.error(`[CoinbaseHistoricalDataService] Job ${jobId} failed:`, error);
      this.emit('job_failed', job);
      throw error;
    }
  }

  /**
   * Pause a running job
   */
  async pauseJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status === 'running') {
      job.status = 'paused';
      job.updatedAt = new Date();
      console.log(`[CoinbaseHistoricalDataService] Job ${jobId} paused`);
      this.emit('job_paused', job);
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): IngestionJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): IngestionJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get data coverage summary
   */
  async getDataCoverage(): Promise<DataCoverage[]> {
    // Return mock coverage data (in production, this would query the database)
    return [
      {
        symbol: 'BTC-USD',
        timeframe: '1h',
        totalCandles: 8760,
        earliestDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        latestDate: new Date(),
      },
      {
        symbol: 'ETH-USD',
        timeframe: '1h',
        totalCandles: 8760,
        earliestDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        latestDate: new Date(),
      },
    ];
  }

  /**
   * Start bulk ingestion for multiple symbols and timeframes
   */
  async startBulkIngestion(
    symbols: string[],
    timeframes: Timeframe[],
    yearsOfData: number
  ): Promise<string[]> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - yearsOfData * 365 * 24 * 60 * 60 * 1000);
    
    const jobIds: string[] = [];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const jobId = await this.createIngestionJob(symbol, timeframe, startDate, endDate);
        jobIds.push(jobId);
        
        // Start job in background
        this.runIngestionJob(jobId).catch(err => {
          console.error(`[CoinbaseHistoricalDataService] Bulk job ${jobId} failed:`, err);
        });
      }
    }

    console.log(`[CoinbaseHistoricalDataService] Started ${jobIds.length} bulk ingestion jobs`);
    return jobIds;
  }

  /**
   * Get OHLCV data for backtesting
   */
  async getOHLCVData(
    symbol: string,
    timeframe: Timeframe,
    startTime: number,
    endTime: number
  ): Promise<OHLCVCandle[]> {
    // In production, this would query the database
    // For now, return mock data
    const candles: OHLCVCandle[] = [];
    const intervalMs = this.getIntervalMs(timeframe);
    
    let currentTime = startTime;
    let price = 50000; // Starting price for mock data
    
    while (currentTime < endTime) {
      const change = (Math.random() - 0.5) * 0.02; // ±1% change
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.005);
      const low = Math.min(open, close) * (1 - Math.random() * 0.005);
      const volume = Math.random() * 1000000;
      
      candles.push({
        timestamp: currentTime,
        open,
        high,
        low,
        close,
        volume,
      });
      
      price = close;
      currentTime += intervalMs;
    }

    return candles;
  }

  /**
   * Get interval in milliseconds
   */
  private getIntervalMs(timeframe: Timeframe): number {
    const intervals: Record<Timeframe, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    return intervals[timeframe];
  }
}

// Singleton instance
export const coinbaseHistoricalDataService = new CoinbaseHistoricalDataServiceClass();
