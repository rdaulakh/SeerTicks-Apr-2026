/**
 * SEER A++ Service Integration Module
 * 
 * Connects all unused services to the main trading flow:
 * 1. SmartOrderRouter - Intelligent order routing
 * 2. MarketMicrostructureAnalyzer - Market structure analysis
 * 4. PositionMonitoringService - Position monitoring
 * 6. AutomatedTradingEngine - Full automation
 * 7. AutomatedAlertSystem - Automated alerts
 * 8. LatencyAlertMonitor - Latency monitoring
 * 9. HealthMetricsCollector - System health
 * 10. CoinbaseRateLimiter - Rate limiting
 * 11. RateLimitMonitor - Rate limit tracking
 * 12. AlertNotificationService - Alert notifications
 * 13. PatternPredictionService - Pattern prediction
 * 14. ScalpingStrategyEngine - HFT/Scalping
 * 15. HighFrequencyOrchestrator - HFT orchestration
 * 16. IntelligentExitManager - Agent-driven exits
 */

import { EventEmitter } from 'events';

// Service instances (lazy loaded)
let smartOrderRouter: any = null;
let marketMicrostructureAnalyzer: any = null;
let positionMonitoringService: any = null;
let automatedTradingEngine: any = null;
let automatedAlertSystem: any = null;
let latencyAlertMonitor: any = null;
let healthMetricsCollector: any = null;
let coinbaseRateLimiter: any = null;
let rateLimitMonitor: any = null;
let alertNotificationService: any = null;
let patternPredictionService: any = null;
let scalpingStrategyEngine: any = null;
let highFrequencyOrchestrator: any = null;
let intelligentExitManager: any = null;
let ultraLowLatencyTickProcessor: any = null;
let consensusThresholdBacktester: any = null;

// Integration status
interface ServiceStatus {
  name: string;
  connected: boolean;
  error?: string;
}

// Price cache for services that need price data
const priceCache: Map<string, number> = new Map();
const volumeCache: Map<string, number> = new Map();

// Price/volume providers for services
function getPriceProvider(): (symbol: string) => number | undefined {
  return (symbol: string) => priceCache.get(symbol);
}

function getVolumeProvider(): (symbol: string) => number | undefined {
  return (symbol: string) => volumeCache.get(symbol);
}

// Update price cache (called from WebSocket)
export function updatePriceCache(symbol: string, price: number): void {
  priceCache.set(symbol, price);
}

export function updateVolumeCache(symbol: string, volume: number): void {
  volumeCache.set(symbol, volume);
}

class ServiceIntegrationManager extends EventEmitter {
  private services: Map<string, ServiceStatus> = new Map();
  private isInitialized: boolean = false;

  constructor() {
    super();
  }

  /**
   * Initialize all services and connect them to the trading flow
   */
  async initialize(config: {
    userId: number;
    positionManager: any;
    riskManager: any;
    paperTradingEngine: any;
    exchangeAdapter: any;
    strategyOrchestrator: any;
  }): Promise<void> {
    if (this.isInitialized) {
      console.log('[ServiceIntegration] Already initialized');
      return;
    }

    console.log('[ServiceIntegration] Initializing all A++ services...');

    // 1. Smart Order Router - needs price and volume providers
    await this.initService('SmartOrderRouter', async () => {
      const { SmartOrderRouter } = await import('./SmartOrderRouter');
      smartOrderRouter = new SmartOrderRouter(getPriceProvider(), getVolumeProvider());
      // Connect to exchange adapter for order execution
      if (config.exchangeAdapter) {
        smartOrderRouter.setExchange?.(config.exchangeAdapter);
      }
      return smartOrderRouter;
    });

    // 2. Market Microstructure Analyzer - optional config
    await this.initService('MarketMicrostructureAnalyzer', async () => {
      const { MarketMicrostructureAnalyzer } = await import('./MarketMicrostructureAnalyzer');
      marketMicrostructureAnalyzer = new MarketMicrostructureAnalyzer({
        tightSpreadThreshold: 0.05,
        wideSpreadThreshold: 0.15,
        extremeSpreadThreshold: 0.50,
        significantImbalance: 0.3,
        lookbackPeriod: 20,
        anomalyZScoreThreshold: 2.0,
        updateIntervalMs: 1000,
      });
      return marketMicrostructureAnalyzer;
    });



    // 4. Position Monitoring Service - needs userId
    await this.initService('PositionMonitoringService', async () => {
      const { PositionMonitoringService } = await import('./PositionMonitoringService');
      positionMonitoringService = new PositionMonitoringService(config.userId, {
        updateIntervalMs: 5000,
        stopLossWarningPercent: 1.5,
        takeProfitWarningPercent: 2.0,
        maxPositionAgeHours: 24,
        enableTrailingStops: true,
        enableAutoExecution: true,
      });
      return positionMonitoringService;
    });


    // 6. Automated Trading Engine - needs userId
    await this.initService('AutomatedTradingEngine', async () => {
      const { AutomatedTradingEngine } = await import('./AutomatedTradingEngine');
      automatedTradingEngine = new AutomatedTradingEngine(config.userId);
      return automatedTradingEngine;
    });

    // 7. Automated Alert System
    await this.initService('AutomatedAlertSystem', async () => {
      const { AutomatedAlertSystem } = await import('./AutomatedAlertSystem');
      automatedAlertSystem = new AutomatedAlertSystem(config.userId);
      return automatedAlertSystem;
    });

    // 8. Latency Alert Monitor
    await this.initService('LatencyAlertMonitor', async () => {
      const module = await import('./LatencyAlertMonitor');
      // Use default export or named export
      const LatencyAlertMonitorClass = (module as any).LatencyAlertMonitor || (module as any).default;
      if (LatencyAlertMonitorClass) {
        latencyAlertMonitor = new LatencyAlertMonitorClass();
      }
      return latencyAlertMonitor;
    });

    // 9. Health Metrics Collector
    await this.initService('HealthMetricsCollector', async () => {
      const module = await import('./HealthMetricsCollector');
      // Use default export or named export
      const HealthMetricsCollectorClass = (module as any).HealthMetricsCollector || (module as any).default;
      if (HealthMetricsCollectorClass) {
        healthMetricsCollector = new HealthMetricsCollectorClass();
      }
      return healthMetricsCollector;
    });

    // 10. Coinbase Rate Limiter
    await this.initService('CoinbaseRateLimiter', async () => {
      const { CoinbaseRateLimiter } = await import('./CoinbaseRateLimiter');
      coinbaseRateLimiter = new CoinbaseRateLimiter();
      return coinbaseRateLimiter;
    });

    // 11. Rate Limit Monitor
    await this.initService('RateLimitMonitor', async () => {
      const { RateLimitMonitor } = await import('./RateLimitMonitor');
      rateLimitMonitor = new RateLimitMonitor();
      return rateLimitMonitor;
    });

    // 12. Alert Notification Service
    await this.initService('AlertNotificationService', async () => {
      const { AlertNotificationService } = await import('./AlertNotificationService');
      alertNotificationService = new AlertNotificationService();
      return alertNotificationService;
    });

    // 13. Pattern Prediction Service
    await this.initService('PatternPredictionService', async () => {
      const module = await import('./PatternPredictionService');
      // This service exports functions, not a class - use the module directly
      patternPredictionService = module;
      return patternPredictionService;
    });

    // 14. Scalping Strategy Engine
    await this.initService('ScalpingStrategyEngine', async () => {
      const { ScalpingStrategyEngine } = await import('./ScalpingStrategyEngine');
      scalpingStrategyEngine = new ScalpingStrategyEngine();
      // Connect to strategy orchestrator for signal routing
      if (config.strategyOrchestrator) {
        // Register scalping signals with orchestrator
        scalpingStrategyEngine.on?.('signal', (signal: any) => {
          config.strategyOrchestrator.emit?.('scalping_signal', signal);
        });
      }
      return scalpingStrategyEngine;
    });

    // 15. High Frequency Orchestrator
    await this.initService('HighFrequencyOrchestrator', async () => {
      const { HighFrequencyOrchestrator } = await import('./HighFrequencyOrchestrator');
      highFrequencyOrchestrator = new HighFrequencyOrchestrator();
      // Connect to scalping engine
      if (scalpingStrategyEngine) {
        highFrequencyOrchestrator.setScalpingEngine?.(scalpingStrategyEngine);
      }
      return highFrequencyOrchestrator;
    });

    // 16. Intelligent Exit Manager (Agent-driven exits)
    await this.initService('IntelligentExitManager', async () => {
      const { IntelligentExitManager } = await import('./IntelligentExitManager');
      intelligentExitManager = new IntelligentExitManager({
        breakevenActivationPercent: 0.5,
        breakevenBuffer: 0.1,
        trailingActivationPercent: 1.5,
        trailingPercent: 0.5,
        maxHoldTimeHours: 4,
        minProfitForTimeExit: 0,
        exitConsensusThreshold: 0.6,
        partialProfitLevels: [
          { pnlPercent: 1.0, exitPercent: 25 },
          { pnlPercent: 1.5, exitPercent: 25 },
          { pnlPercent: 2.0, exitPercent: 25 },
        ],
      });
      // Connect to position manager for exit signals
      if (config.positionManager) {
        intelligentExitManager.setPositionManager?.(config.positionManager);
      }
      return intelligentExitManager;
    });

    // 17. Ultra Low Latency Tick Processor
    await this.initService('UltraLowLatencyTickProcessor', async () => {
      const { getUltraLowLatencyTickProcessor } = await import('./UltraLowLatencyTickProcessor');
      ultraLowLatencyTickProcessor = getUltraLowLatencyTickProcessor();
      return ultraLowLatencyTickProcessor;
    });

    // 18. Consensus Threshold Backtester
    await this.initService('ConsensusThresholdBacktester', async () => {
      const module = await import('./ConsensusThresholdBacktester');
      consensusThresholdBacktester = module;
      return consensusThresholdBacktester;
    });

    // 19. Correlation Backtester


    this.isInitialized = true;
    console.log('[ServiceIntegration] All A++ services initialized');
    this.printStatus();
  }

  /**
   * Initialize a single service with error handling
   */
  private async initService(name: string, initializer: () => Promise<any>): Promise<void> {
    try {
      await initializer();
      this.services.set(name, { name, connected: true });
      console.log(`[ServiceIntegration] ✅ ${name} connected`);
    } catch (error: any) {
      this.services.set(name, { name, connected: false, error: error.message });
      console.warn(`[ServiceIntegration] ⚠️ ${name} failed to connect: ${error.message}`);
    }
  }

  /**
   * Print status of all services
   */
  printStatus(): void {
    console.log('\n[ServiceIntegration] === Service Status ===');
    let connected = 0;
    let failed = 0;
    
    for (const [name, status] of this.services) {
      if (status.connected) {
        console.log(`  ✅ ${name}`);
        connected++;
      } else {
        console.log(`  ❌ ${name}: ${status.error}`);
        failed++;
      }
    }
    
    console.log(`[ServiceIntegration] Total: ${connected} connected, ${failed} failed`);
    console.log('[ServiceIntegration] ========================\n');
  }

  /**
   * Get service instances
   */
  getSmartOrderRouter() { return smartOrderRouter; }
  getMarketMicrostructureAnalyzer() { return marketMicrostructureAnalyzer; }
  getPositionMonitoringService() { return positionMonitoringService; }
  getAutomatedTradingEngine() { return automatedTradingEngine; }
  getAutomatedAlertSystem() { return automatedAlertSystem; }
  getLatencyAlertMonitor() { return latencyAlertMonitor; }
  getHealthMetricsCollector() { return healthMetricsCollector; }
  getCoinbaseRateLimiter() { return coinbaseRateLimiter; }
  getRateLimitMonitor() { return rateLimitMonitor; }
  getAlertNotificationService() { return alertNotificationService; }
  getPatternPredictionService() { return patternPredictionService; }
  getScalpingStrategyEngine() { return scalpingStrategyEngine; }
  getHighFrequencyOrchestrator() { return highFrequencyOrchestrator; }
  getIntelligentExitManager() { return intelligentExitManager; }
  getUltraLowLatencyTickProcessor() { return ultraLowLatencyTickProcessor; }
  getConsensusThresholdBacktester() { return consensusThresholdBacktester; }

  /**
   * Get all service statuses
   */
  getStatus(): ServiceStatus[] {
    return Array.from(this.services.values());
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
let serviceIntegrationManager: ServiceIntegrationManager | null = null;

export function getServiceIntegrationManager(): ServiceIntegrationManager {
  if (!serviceIntegrationManager) {
    serviceIntegrationManager = new ServiceIntegrationManager();
  }
  return serviceIntegrationManager;
}

export { ServiceIntegrationManager };
