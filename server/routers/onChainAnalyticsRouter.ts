/**
 * On-Chain Analytics Router
 * 
 * Provides tRPC endpoints for free on-chain analytics data from:
 * - BGeometrics (Bitcoin metrics: MVRV, NUPL, SOPR)
 * - DeFiLlama (DeFi TVL, stablecoins, DEX volumes)
 * - Dune Analytics (custom queries when API key available)
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import { getOnChainAnalyticsService } from '../services/OnChainAnalyticsService';
import { getBGeometricsService } from '../services/BGeometricsService';
import { getDeFiLlamaService } from '../services/DeFiLlamaService';
import { getDuneAnalyticsService } from '../services/DuneAnalyticsService';

export const onChainAnalyticsRouter = router({
  /**
   * Get comprehensive on-chain dashboard
   * Combines data from all free sources
   */
  getDashboard: publicProcedure.query(async () => {
    const service = getOnChainAnalyticsService();
    return service.getDashboard();
  }),

  /**
   * Get Bitcoin-specific on-chain metrics
   */
  getBitcoinMetrics: publicProcedure.query(async () => {
    const service = getOnChainAnalyticsService();
    return service.getBitcoinMetrics();
  }),

  /**
   * Get DeFi-specific metrics
   */
  getDeFiMetrics: publicProcedure.query(async () => {
    const service = getOnChainAnalyticsService();
    return service.getDeFiMetrics();
  }),

  /**
   * Get on-chain signals for trading decisions
   */
  getSignals: publicProcedure.query(async () => {
    const bgeometrics = getBGeometricsService();
    return bgeometrics.getOnChainSignals();
  }),

  /**
   * Get MVRV data
   */
  getMVRV: publicProcedure.query(async () => {
    const bgeometrics = getBGeometricsService();
    return bgeometrics.getMVRV();
  }),

  /**
   * Get NUPL data
   */
  getNUPL: publicProcedure.query(async () => {
    const bgeometrics = getBGeometricsService();
    return bgeometrics.getNUPL();
  }),

  /**
   * Get SOPR data
   */
  getSOPR: publicProcedure.query(async () => {
    const bgeometrics = getBGeometricsService();
    return bgeometrics.getSOPR();
  }),

  /**
   * Get funding rates
   */
  getFundingRates: publicProcedure.query(async () => {
    const bgeometrics = getBGeometricsService();
    return bgeometrics.getFundingRates();
  }),

  /**
   * Get DeFi TVL data
   */
  getTVL: publicProcedure.query(async () => {
    const defiLlama = getDeFiLlamaService();
    return {
      total: await defiLlama.getTotalTVL(),
      byCategory: await defiLlama.getTVLByCategory(),
    };
  }),

  /**
   * Get top protocols by TVL
   */
  getTopProtocols: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const defiLlama = getDeFiLlamaService();
      return defiLlama.getTopProtocols(input?.limit || 20);
    }),

  /**
   * Get stablecoin flows
   */
  getStablecoinFlows: publicProcedure.query(async () => {
    const defiLlama = getDeFiLlamaService();
    return defiLlama.getStablecoinFlows();
  }),

  /**
   * Get DEX volumes
   */
  getDEXVolumes: publicProcedure.query(async () => {
    const defiLlama = getDeFiLlamaService();
    return {
      total: await defiLlama.getTotalDEXVolume(),
      byDex: await defiLlama.getDEXVolumes(),
    };
  }),

  /**
   * Get top yield opportunities
   */
  getTopYields: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      minTVL: z.number().default(1000000),
      chain: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const defiLlama = getDeFiLlamaService();
      return defiLlama.getTopYields(input?.limit || 20, input?.minTVL || 1000000);
    }),

  /**
   * Get DeFi sentiment analysis
   */
  getDeFiSentiment: publicProcedure.query(async () => {
    const defiLlama = getDeFiLlamaService();
    return defiLlama.getDeFiSentiment();
  }),

  /**
   * Execute a Dune query (requires API key)
   */
  executeDuneQuery: protectedProcedure
    .input(z.object({
      queryId: z.number(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const dune = getDuneAnalyticsService();
      if (!dune.isConfigured()) {
        throw new Error('Dune Analytics API key not configured');
      }
      return dune.executeQuery(input.queryId, input.parameters);
    }),

  /**
   * Get latest results from a Dune query
   */
  getDuneResults: protectedProcedure
    .input(z.object({
      queryId: z.number(),
    }))
    .query(async ({ input }) => {
      const dune = getDuneAnalyticsService();
      if (!dune.isConfigured()) {
        throw new Error('Dune Analytics API key not configured');
      }
      return dune.getLatestResults(input.queryId);
    }),

  /**
   * Get service status and rate limits
   */
  getStatus: publicProcedure.query(async () => {
    const service = getOnChainAnalyticsService();
    return service.getStatus();
  }),

  /**
   * Clear all caches
   */
  clearCache: protectedProcedure.mutation(async () => {
    const service = getOnChainAnalyticsService();
    service.clearCache();
    return { success: true };
  }),
});

export type OnChainAnalyticsRouter = typeof onChainAnalyticsRouter;
