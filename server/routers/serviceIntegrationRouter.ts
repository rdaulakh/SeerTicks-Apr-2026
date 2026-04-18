/**
 * Service Integration Router
 * 
 * Exposes endpoints to check the status of all integrated services
 * and manage the intelligent trading coordinator.
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getServiceIntegrationManager } from "../services/ServiceIntegration";
import { getIntelligentTradingCoordinator } from "../services/IntelligentTradingCoordinator";

export const serviceIntegrationRouter = router({
  /**
   * Get status of all integrated services
   */
  getStatus: protectedProcedure.query(async () => {
    const serviceManager = getServiceIntegrationManager();
    const statuses = serviceManager.getStatus();
    
    const connected = statuses.filter(s => s.connected);
    const failed = statuses.filter(s => !s.connected);
    
    return {
      totalServices: statuses.length,
      connectedCount: connected.length,
      failedCount: failed.length,
      services: statuses.map(s => ({
        name: s.name,
        connected: s.connected,
        error: s.error,
      })),
      summary: {
        connected: connected.map(s => s.name),
        failed: failed.map(s => ({ name: s.name, error: s.error })),
      },
    };
  }),

  /**
   * Get intelligent trading coordinator status
   */
  getCoordinatorStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const coordinator = getIntelligentTradingCoordinator({ userId: ctx.user.id });
      return coordinator.getStatus();
    } catch (error) {
      return {
        isRunning: false,
        servicesConnected: 0,
        servicesFailed: 0,
        lastUpdate: Date.now(),
        intelligentExitsActive: false,
        smartRoutingActive: false,
        hftActive: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }),

  /**
   * Start the intelligent trading coordinator
   */
  startCoordinator: protectedProcedure
    .input(z.object({
      enableIntelligentExits: z.boolean().optional().default(true),
      enableSmartRouting: z.boolean().optional().default(true),
      enableMicrostructureAnalysis: z.boolean().optional().default(true),
      enableHFT: z.boolean().optional().default(false),
      enableAlerts: z.boolean().optional().default(true),
      enableMonitoring: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const coordinator = getIntelligentTradingCoordinator({
          userId: ctx.user.id,
          ...input,
        });
        
        await coordinator.start();
        
        return {
          success: true,
          message: 'Intelligent Trading Coordinator started',
          status: coordinator.getStatus(),
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to start coordinator',
          status: null,
        };
      }
    }),

  /**
   * Stop the intelligent trading coordinator
   */
  stopCoordinator: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const coordinator = getIntelligentTradingCoordinator({ userId: ctx.user.id });
      await coordinator.stop();
      
      return {
        success: true,
        message: 'Intelligent Trading Coordinator stopped',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to stop coordinator',
      };
    }
  }),

  /**
   * Get individual service details
   */
  getServiceDetails: protectedProcedure
    .input(z.object({
      serviceName: z.string(),
    }))
    .query(async ({ input }) => {
      const serviceManager = getServiceIntegrationManager();
      const statuses = serviceManager.getStatus();
      const service = statuses.find(s => s.name === input.serviceName);
      
      if (!service) {
        return {
          found: false,
          name: input.serviceName,
          message: 'Service not found',
        };
      }
      
      return {
        found: true,
        name: service.name,
        connected: service.connected,
        error: service.error,
      };
    }),

  /**
   * List all available services
   */
  listServices: protectedProcedure.query(async () => {
    return {
      services: [
        { name: 'SmartOrderRouter', description: 'Intelligent order routing for optimal execution' },
        { name: 'MarketMicrostructureAnalyzer', description: 'Spread and liquidity analysis' },
        { name: 'PositionIntelligenceManager', description: 'Portfolio optimization and risk management' },
        { name: 'PositionMonitoringService', description: 'Real-time position tracking' },
        { name: 'LiveStrategyIntegration', description: 'Live strategy execution' },
        { name: 'AutomatedTradingEngine', description: 'Full trading automation' },
        { name: 'AutomatedAlertSystem', description: 'Automated trading alerts' },
        { name: 'LatencyAlertMonitor', description: 'Latency monitoring' },
        { name: 'HealthMetricsCollector', description: 'System health metrics' },
        { name: 'CoinbaseRateLimiter', description: 'Coinbase API rate limiting' },
        { name: 'RateLimitMonitor', description: 'Rate limit tracking' },
        { name: 'AlertNotificationService', description: 'Alert notifications' },
        { name: 'PatternPredictionService', description: 'Pattern prediction' },
        { name: 'ScalpingStrategyEngine', description: 'HFT scalping strategies' },
        { name: 'HighFrequencyOrchestrator', description: 'HFT orchestration' },
        { name: 'IntelligentExitManager', description: 'Agent-driven position exits' },
        { name: 'UltraLowLatencyTickProcessor', description: 'Ultra-low latency tick processing' },
        { name: 'ConsensusThresholdBacktester', description: 'Consensus threshold backtesting' },
        { name: 'CorrelationBacktester', description: 'Correlation backtesting' },
      ],
    };
  }),
});
