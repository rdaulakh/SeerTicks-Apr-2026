/**
 * Data Ingestion Router
 * 
 * tRPC endpoints for managing historical OHLCV data ingestion
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { coinbaseHistoricalDataService, Timeframe } from '../services/CoinbaseHistoricalDataService';

const timeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);

export const dataIngestionRouter = router({
  /**
   * Create a new ingestion job
   */
  createJob: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1),
      timeframe: timeframeSchema,
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s))
    }))
    .mutation(async ({ input }) => {
      const jobId = await coinbaseHistoricalDataService.createIngestionJob(
        input.symbol,
        input.timeframe as Timeframe,
        input.startDate,
        input.endDate
      );
      return { jobId };
    }),

  /**
   * Start or resume a job
   */
  startJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      // Run in background - don't await
      coinbaseHistoricalDataService.runIngestionJob(input.jobId).catch(err => {
        console.error(`[DataIngestion] Job ${input.jobId} failed:`, err);
      });
      return { success: true, message: 'Job started' };
    }),

  /**
   * Pause a running job
   */
  pauseJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      await coinbaseHistoricalDataService.pauseJob(input.jobId);
      return { success: true };
    }),

  /**
   * Get job status
   */
  getJobStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      return coinbaseHistoricalDataService.getJobStatus(input.jobId);
    }),

  /**
   * Get all jobs
   */
  getAllJobs: protectedProcedure
    .query(async () => {
      return coinbaseHistoricalDataService.getAllJobs();
    }),

  /**
   * Get data coverage summary
   */
  getDataCoverage: protectedProcedure
    .query(async () => {
      return coinbaseHistoricalDataService.getDataCoverage();
    }),

  /**
   * Start bulk ingestion for multiple symbols/timeframes
   */
  startBulkIngestion: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()).min(1),
      timeframes: z.array(timeframeSchema).min(1),
      yearsOfData: z.number().min(0.5).max(5).default(2)
    }))
    .mutation(async ({ input }) => {
      const jobIds = await coinbaseHistoricalDataService.startBulkIngestion(
        input.symbols,
        input.timeframes as Timeframe[],
        input.yearsOfData
      );
      return { jobIds, message: `Started ${jobIds.length} ingestion jobs` };
    }),

  /**
   * Get OHLCV data for backtesting
   */
  getOHLCVData: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      timeframe: timeframeSchema,
      startTime: z.number(),
      endTime: z.number()
    }))
    .query(async ({ input }) => {
      return coinbaseHistoricalDataService.getOHLCVData(
        input.symbol,
        input.timeframe as Timeframe,
        input.startTime,
        input.endTime
      );
    }),

  /**
   * Quick start: Fetch 2 years of data for BTC-USD and ETH-USD across all timeframes
   */
  quickStart: protectedProcedure
    .mutation(async () => {
      const symbols = ['BTC-USD', 'ETH-USD'];
      const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
      
      const jobIds = await coinbaseHistoricalDataService.startBulkIngestion(
        symbols,
        timeframes,
        2 // 2 years
      );

      return {
        success: true,
        jobIds,
        message: `Started ${jobIds.length} ingestion jobs for ${symbols.join(', ')} across ${timeframes.length} timeframes`
      };
    }),

  /**
   * Get ingestion statistics
   */
  getStats: protectedProcedure
    .query(async () => {
      const jobs = await coinbaseHistoricalDataService.getAllJobs();
      const coverage = await coinbaseHistoricalDataService.getDataCoverage();

      const totalCandles = coverage.reduce((sum, c) => sum + c.totalCandles, 0);
      const runningJobs = jobs.filter(j => j.status === 'running').length;
      const completedJobs = jobs.filter(j => j.status === 'completed').length;
      const failedJobs = jobs.filter(j => j.status === 'failed').length;
      const pendingJobs = jobs.filter(j => j.status === 'pending').length;

      return {
        totalCandles,
        totalJobs: jobs.length,
        runningJobs,
        completedJobs,
        failedJobs,
        pendingJobs,
        symbolsCovered: [...new Set(coverage.map(c => c.symbol))].length,
        timeframesCovered: [...new Set(coverage.map(c => c.timeframe))].length,
        oldestData: coverage.reduce((oldest, c) => {
          if (!c.earliestDate) return oldest;
          if (!oldest) return c.earliestDate;
          return c.earliestDate < oldest ? c.earliestDate : oldest;
        }, null as Date | null),
        newestData: coverage.reduce((newest, c) => {
          if (!c.latestDate) return newest;
          if (!newest) return c.latestDate;
          return c.latestDate > newest ? c.latestDate : newest;
        }, null as Date | null)
      };
    })
});
