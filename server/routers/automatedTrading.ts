import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import {
  getAutomatedTradingSettings,
  upsertAutomatedTradingSettings,
  getAutomatedTradeLogsByUser,
} from '../db/automatedTradingDb';

export const automatedTradingRouter = router({
  // Get user's automated trading settings
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getAutomatedTradingSettings(ctx.user.id);
    
    // Return default settings if none exist
    if (!settings) {
      return {
        userId: ctx.user.id,
        enabled: false,
        minSignalConfidence: 70,
        maxPositionSizePercent: 10,
        useKellyCriterion: false,
        kellyFraction: '0.25',
        maxTradesPerDay: 10,
        maxOpenPositions: 5,
        cooldownMinutes: 15,
        maxDailyLossUSD: '500.00',
        stopOnConsecutiveLosses: 3,
        requireBothAgentTypes: true,
        tradingHours: null,
        allowedSymbols: null,
        blockedSymbols: null,
        enableTechnicalSignals: true,
        enableSentimentSignals: true,
        enableOnChainSignals: false,
        useMarketOrders: true,
        limitOrderOffsetPercent: '0.10',
        notifyOnExecution: true,
        notifyOnRejection: true,
      };
    }
    
    return settings;
  }),

  // Update automated trading settings
  updateSettings: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      minSignalConfidence: z.number().min(0).max(100).optional(),
      maxPositionSizePercent: z.number().min(1).max(100).optional(),
      useKellyCriterion: z.boolean().optional(),
      kellyFraction: z.string().optional(),
      maxTradesPerDay: z.number().min(1).max(100).optional(),
      maxOpenPositions: z.number().min(1).max(50).optional(),
      cooldownMinutes: z.number().min(0).max(1440).optional(),
      maxDailyLossUSD: z.string().optional(),
      stopOnConsecutiveLosses: z.number().min(1).max(20).optional(),
      requireBothAgentTypes: z.boolean().optional(),
      tradingHours: z.any().optional(),
      allowedSymbols: z.array(z.string()).nullable().optional(),
      blockedSymbols: z.array(z.string()).nullable().optional(),
      enableTechnicalSignals: z.boolean().optional(),
      enableSentimentSignals: z.boolean().optional(),
      enableOnChainSignals: z.boolean().optional(),
      useMarketOrders: z.boolean().optional(),
      limitOrderOffsetPercent: z.string().optional(),
      notifyOnExecution: z.boolean().optional(),
      notifyOnRejection: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertAutomatedTradingSettings({
        userId: ctx.user.id,
        ...input,
      });
      
      return { success: true };
    }),

  // Get automated trade execution history
  getTradeHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional().default(100),
    }))
    .query(async ({ ctx, input }) => {
      const logs = await getAutomatedTradeLogsByUser(ctx.user.id, input.limit);
      return logs;
    }),

  // Get automated trading statistics
  getStatistics: protectedProcedure.query(async ({ ctx }) => {
    const logs = await getAutomatedTradeLogsByUser(ctx.user.id, 1000);
    
    const executed = logs.filter(l => l.status === 'executed');
    const rejected = logs.filter(l => l.status === 'rejected');
    const failed = logs.filter(l => l.status === 'failed');
    
    // Calculate rejection reasons breakdown
    const rejectionReasons: Record<string, number> = {};
    rejected.forEach(log => {
      if (log.rejectionReason) {
        rejectionReasons[log.rejectionReason] = (rejectionReasons[log.rejectionReason] || 0) + 1;
      }
    });
    
    // Calculate average execution latency
    const latencies = executed
      .filter(l => l.executionLatencyMs)
      .map(l => l.executionLatencyMs!);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    
    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = logs.filter(l => new Date(l.createdAt) >= today);
    const todayExecuted = todayLogs.filter(l => l.status === 'executed');
    
    return {
      total: logs.length,
      executed: executed.length,
      rejected: rejected.length,
      failed: failed.length,
      executionRate: logs.length > 0 ? (executed.length / logs.length) * 100 : 0,
      rejectionReasons,
      avgExecutionLatencyMs: Math.round(avgLatency),
      today: {
        total: todayLogs.length,
        executed: todayExecuted.length,
        rejected: todayLogs.filter(l => l.status === 'rejected').length,
      },
    };
  }),
});
