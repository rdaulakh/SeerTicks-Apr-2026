/**
 * Intelligent Trading Coordinator
 * 
 * A++ Institutional Grade Trading Coordination System
 * 
 * This is the MASTER coordinator that connects ALL services to the main trading flow:
 * - Connects IntelligentExitManager for agent-driven exits
 * - Connects SmartOrderRouter for intelligent order execution
 * - Connects MarketMicrostructureAnalyzer for spread/liquidity analysis
 * - Connects PositionMonitoringService for real-time position tracking
 * - Connects all monitoring, alerting, and HFT services
 * 
 * Key Principle: Position management and exits are INTELLIGENCE-DRIVEN by agents,
 * not static bot-like behavior.
 */

import { EventEmitter } from 'events';
import { getServiceIntegrationManager, updatePriceCache, updateVolumeCache } from './ServiceIntegration';
import type { PositionManager } from '../PositionManager';
import type { RiskManager } from '../RiskManager';
import type { PaperTradingEngine } from '../execution/PaperTradingEngine';
import type { ExchangeInterface } from '../exchanges/ExchangeInterface';
import type { StrategyOrchestrator } from '../orchestrator/StrategyOrchestrator';
import { getAgentManager, AgentSignal } from '../agents/AgentBase';
import { getSharedAgentMemory } from './SharedAgentMemory';

export interface TradingCoordinatorConfig {
  userId: number;
  enableIntelligentExits: boolean;
  enableSmartRouting: boolean;
  enableMicrostructureAnalysis: boolean;
  enableHFT: boolean;
  enableAlerts: boolean;
  enableMonitoring: boolean;
}

export interface CoordinatorStatus {
  isRunning: boolean;
  servicesConnected: number;
  servicesFailed: number;
  lastUpdate: number;
  intelligentExitsActive: boolean;
  smartRoutingActive: boolean;
  hftActive: boolean;
}

export class IntelligentTradingCoordinator extends EventEmitter {
  private config: TradingCoordinatorConfig;
  private isRunning: boolean = false;
  private positionManager: PositionManager | null = null;
  private riskManager: RiskManager | null = null;
  private paperTradingEngine: PaperTradingEngine | null = null;
  private exchangeAdapter: ExchangeInterface | null = null;
  private strategyOrchestrator: StrategyOrchestrator | null = null;
  
  // Price feed for services
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private lastPrices: Map<string, number> = new Map();

  constructor(config: Partial<TradingCoordinatorConfig>) {
    super();
    this.config = {
      userId: config.userId || 1,
      enableIntelligentExits: config.enableIntelligentExits ?? true,
      enableSmartRouting: config.enableSmartRouting ?? true,
      enableMicrostructureAnalysis: config.enableMicrostructureAnalysis ?? true,
      enableHFT: config.enableHFT ?? false, // HFT off by default
      enableAlerts: config.enableAlerts ?? true,
      enableMonitoring: config.enableMonitoring ?? true,
    };
    
    console.log('[IntelligentTradingCoordinator] Initialized with config:', this.config);
  }

  /**
   * Set dependencies for the coordinator
   */
  setDependencies(deps: {
    positionManager: PositionManager;
    riskManager: RiskManager;
    paperTradingEngine: PaperTradingEngine;
    exchangeAdapter: ExchangeInterface;
    strategyOrchestrator?: StrategyOrchestrator;
  }): void {
    this.positionManager = deps.positionManager;
    this.riskManager = deps.riskManager;
    this.paperTradingEngine = deps.paperTradingEngine;
    this.exchangeAdapter = deps.exchangeAdapter;
    this.strategyOrchestrator = deps.strategyOrchestrator || null;
    
    console.log('[IntelligentTradingCoordinator] Dependencies set');
  }

  /**
   * Start the coordinator and connect all services
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[IntelligentTradingCoordinator] Already running');
      return;
    }

    console.log('[IntelligentTradingCoordinator] Starting intelligent trading coordination...');

    try {
      // Initialize Service Integration Manager
      const serviceManager = getServiceIntegrationManager();
      
      if (!serviceManager.isReady()) {
        await serviceManager.initialize({
          userId: this.config.userId,
          positionManager: this.positionManager,
          riskManager: this.riskManager,
          paperTradingEngine: this.paperTradingEngine,
          exchangeAdapter: this.exchangeAdapter,
          strategyOrchestrator: this.strategyOrchestrator,
        });
      }

      // Connect Intelligent Exit Manager
      if (this.config.enableIntelligentExits) {
        await this.connectIntelligentExitManager(serviceManager);
      }

      // Connect Smart Order Router
      if (this.config.enableSmartRouting) {
        await this.connectSmartOrderRouter(serviceManager);
      }

      // Connect Market Microstructure Analyzer
      if (this.config.enableMicrostructureAnalysis) {
        await this.connectMicrostructureAnalyzer(serviceManager);
      }


      // Connect Position Monitoring Service
      if (this.config.enableMonitoring) {
        await this.connectPositionMonitoringService(serviceManager);
      }

      // Connect Alert Services
      if (this.config.enableAlerts) {
        await this.connectAlertServices(serviceManager);
      }

      // Connect HFT Services (if enabled)
      if (this.config.enableHFT) {
        await this.connectHFTServices(serviceManager);
      }

      // Start price feed for services
      this.startPriceFeed();

      this.isRunning = true;
      console.log('[IntelligentTradingCoordinator] ✅ All services connected and running');
      this.emit('started');

    } catch (error) {
      console.error('[IntelligentTradingCoordinator] Failed to start:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Connect Intelligent Exit Manager for agent-driven exits
   */
  private async connectIntelligentExitManager(serviceManager: any): Promise<void> {
    const exitManager = serviceManager.getIntelligentExitManager();
    if (!exitManager) {
      console.warn('[IntelligentTradingCoordinator] IntelligentExitManager not available');
      return;
    }

    // Set callbacks for intelligent exit decisions
    exitManager.setCallbacks({
      // Get agent signals for exit decisions - NOW WIRED TO AGENTMANAGER
      getAgentSignals: async (symbol: string, position: any) => {
        const exitSignals: { agentName: string; signal: 'hold' | 'exit' | 'partial_exit' | 'add'; confidence: number; reason: string; timestamp: number }[] = [];
        
        try {
          // 1. Check shared memory for veto state first
          const sharedMemory = getSharedAgentMemory();
          if (sharedMemory.isVetoActive(symbol)) {
            const vetoState = sharedMemory.getVetoState();
            exitSignals.push({ agentName: 'SharedMemory', signal: 'exit' as const, confidence: 1.0, reason: `VETO ACTIVE: ${vetoState.reason}`, timestamp: Date.now() });
            return exitSignals;
          }
          
          // 2. Get real-time signals directly from AgentManager
          const agentManager = getAgentManager();
          const agentSignals = await agentManager.getAllSignals(symbol, { currentPrice: this.lastPrices.get(symbol), positionSide: position.side, positionPnl: position.unrealizedPnlPercent });
          
          // Convert agent signals to exit signals based on position direction
          for (const signal of agentSignals) {
            if (position.side === 'long' && signal.signal === 'bearish') {
              exitSignals.push({ agentName: signal.agentName, signal: signal.confidence > 0.8 ? 'exit' : 'partial_exit', confidence: signal.confidence, reason: `${signal.agentName}: ${signal.reasoning}`, timestamp: signal.timestamp });
            } else if (position.side === 'short' && signal.signal === 'bullish') {
              exitSignals.push({ agentName: signal.agentName, signal: signal.confidence > 0.8 ? 'exit' : 'partial_exit', confidence: signal.confidence, reason: `${signal.agentName}: ${signal.reasoning}`, timestamp: signal.timestamp });
            } else if (signal.recommendation?.action === 'exit') {
              exitSignals.push({ agentName: signal.agentName, signal: 'exit', confidence: signal.confidence, reason: `${signal.agentName}: ${signal.recommendation.urgency} urgency exit`, timestamp: signal.timestamp });
            }
          }
          
          // 3. Also check orchestrator for consensus-level exit signals
          if (this.strategyOrchestrator) {
            const recommendation = await this.strategyOrchestrator.getRecommendation(symbol);
            if (recommendation.action === 'exit' || recommendation.action === 'sell') {
              exitSignals.push({ agentName: 'StrategyOrchestrator', signal: 'exit' as const, confidence: recommendation.confidence, reason: recommendation.reasoning, timestamp: Date.now() });
            }
            if (recommendation.vetoActive) {
              exitSignals.push({ agentName: 'MacroAnalyst', signal: 'exit' as const, confidence: 1.0, reason: `VETO: ${recommendation.vetoReason}`, timestamp: Date.now() });
            }
          }
          
          console.log(`[IntelligentTradingCoordinator] Collected ${exitSignals.length} exit signals from ${agentSignals.length} agents for ${symbol}`);
          return exitSignals;
        } catch (error) {
          console.error('[IntelligentTradingCoordinator] Error getting agent signals:', error);
          return exitSignals;
        }
      },
      
      // Get current price
      getCurrentPrice: async (symbol: string) => {
        return this.lastPrices.get(symbol) || 0;
      },
      
      // Execute exit - connects IntelligentExitManager decisions to actual trade execution
      executeExit: async (positionId: string, quantity: number, reason: string) => {
        if (!this.paperTradingEngine) {
          console.warn('[IntelligentTradingCoordinator] No paper trading engine for exit');
          return;
        }
        
        console.log(`[IntelligentTradingCoordinator] 🎯 Executing intelligent exit: ${positionId}`);
        console.log(`[IntelligentTradingCoordinator] Reason: ${reason}`);
        console.log(`[IntelligentTradingCoordinator] Quantity: ${quantity}`);
        
        // Emit exit event for tracking and UI updates
        this.emit('intelligent_exit', {
          positionId,
          quantity,
          reason,
          timestamp: Date.now(),
        });
        
        // Execute through paper trading engine
        try {
          // Get position details - check both in-memory and by symbol
          const positions = this.paperTradingEngine.getPositions?.() || [];
          let position = positions.find((p: any) => 
            p.id === positionId || 
            p.id?.toString() === positionId ||
            p.positionId === positionId
          );
          
          // Also try to find by symbol if positionId contains symbol info
          if (!position && positionId.includes('-')) {
            const symbolPart = positionId.split('_')[0] || positionId;
            position = positions.find((p: any) => p.symbol === symbolPart);
          }
          
          if (position) {
            // Get current price from cache or position
            const currentPrice = this.lastPrices.get(position.symbol) || position.currentPrice || position.entryPrice;
            
            // Check if this is a partial or full exit
            const isPartialExit = quantity < position.quantity;
            
            if (isPartialExit) {
              // Partial exit - place a sell order for the specified quantity
              console.log(`[IntelligentTradingCoordinator] Executing partial exit: ${quantity}/${position.quantity}`);
              await this.paperTradingEngine.placeOrder?.({
                symbol: position.symbol,
                type: 'market',
                side: 'sell',
                quantity: quantity,
                price: currentPrice,
                strategy: `intelligent_exit_partial: ${reason}`,
              });
            } else {
              // Full exit - close the entire position
              await this.paperTradingEngine.closePositionById?.(position.id || positionId, currentPrice, `intelligent_exit: ${reason}`);
            }
            
            console.log(`[IntelligentTradingCoordinator] ✅ Position ${positionId} ${isPartialExit ? 'partially' : 'fully'} closed at $${currentPrice.toFixed(2)}`);
            
            // Emit detailed exit event
            this.emit('position_exit_executed', {
              positionId,
              symbol: position.symbol,
              quantity,
              exitPrice: currentPrice,
              isPartialExit,
              reason,
              timestamp: Date.now(),
            });
          } else {
            console.warn(`[IntelligentTradingCoordinator] Position ${positionId} not found for exit`);
          }
        } catch (error) {
          console.error(`[IntelligentTradingCoordinator] Error executing exit:`, error);
          this.emit('exit_error', { positionId, error, reason });
        }
      },
      
      // Get market regime - Phase 3 Enhancement: Regime-aware trailing
      getMarketRegime: async (symbol: string) => {
        try {
          // 1. First check SharedAgentMemory for consensus regime
          const sharedMemory = getSharedAgentMemory();
          const regimeConsensus = sharedMemory.getRegimeConsensus(symbol);
          
          if (regimeConsensus && regimeConsensus.confidence > 0.6) {
            // Use consensus regime if confidence is high enough
            console.log(`[IntelligentTradingCoordinator] Using regime consensus: ${regimeConsensus.regime} (${(regimeConsensus.confidence * 100).toFixed(0)}% confidence)`);
            return regimeConsensus.regime;
          }
          
          // 2. Fall back to technical calculation
          const { getCandleCache } = await import('../WebSocketCandleCache');
          const candleCache = getCandleCache();
          const candles = candleCache.getCandles(symbol, '1h');
          
          if (candles && candles.length >= 200) {
            const closes = candles.map(c => c.close);
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            
            // Calculate SMA50 and SMA200
            const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
            const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
            
            // Calculate ATR for regime detection
            const trueRanges: number[] = [];
            for (let i = 1; i < Math.min(14, candles.length); i++) {
              const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
              );
              trueRanges.push(tr);
            }
            const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
            const avgATR = atr; // Use same for simplicity
            
            const { detectMarketRegime } = await import('../utils/RiskCalculations');
            const detectedRegime = detectMarketRegime(closes[closes.length - 1], sma50, sma200, atr, avgATR);
            
            // Update SharedAgentMemory with detected regime
            sharedMemory.updateRegimeConsensus(symbol, 'TechnicalAnalysis', detectedRegime as any, 0.7);
            
            return detectedRegime;
          }
          
          return 'unknown';
        } catch (error) {
          console.warn('[IntelligentTradingCoordinator] Error detecting market regime:', error);
          return 'unknown';
        }
      },
    });

    // Start the exit manager
    exitManager.start();
    
    // Listen for position changes and add to exit manager
    if (this.positionManager) {
      this.positionManager.on('position_opened', async (position: any) => {
        // Calculate ATR for the position (Phase 3 Enhancement)
        let positionATR: number | undefined;
        try {
          const { getCandleCache } = await import('../WebSocketCandleCache');
          const candleCache = getCandleCache();
          const candles = candleCache.getCandles(position.symbol, '1h');
          
          if (candles && candles.length >= 15) {
            const { calculateATR } = await import('../utils/RiskCalculations');
            positionATR = calculateATR(candles.slice(-15));
            console.log(`[IntelligentTradingCoordinator] Calculated ATR for ${position.symbol}: ${positionATR.toFixed(2)}`);
          }
        } catch (atrError) {
          console.warn('[IntelligentTradingCoordinator] Could not calculate ATR:', atrError);
        }
        
        exitManager.addPosition({
          id: position.id?.toString() || position.positionId,
          symbol: position.symbol,
          side: position.side === 'buy' ? 'long' : 'short',
          entryPrice: position.entryPrice,
          currentPrice: position.currentPrice || position.entryPrice,
          quantity: position.quantity,
          remainingQuantity: position.quantity,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTime: Date.now(),
          marketRegime: 'unknown',
          originalConsensus: position.confidence || 0.5,
          atr: positionATR, // Phase 3: ATR for dynamic trailing
          // Phase 32: Pass TP/SL for enforcement
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
        });
      });
      
      this.positionManager.on('position_closed', (position: any) => {
        exitManager.removePosition(position.id?.toString() || position.positionId);
      });
    }

    console.log('[IntelligentTradingCoordinator] ✅ IntelligentExitManager connected');
  }

  /**
   * Connect Smart Order Router
   */
  private async connectSmartOrderRouter(serviceManager: any): Promise<void> {
    const router = serviceManager.getSmartOrderRouter();
    if (!router) {
      console.warn('[IntelligentTradingCoordinator] SmartOrderRouter not available');
      return;
    }

    // Listen for order routing events
    router.on?.('order_routed', (data: any) => {
      console.log(`[IntelligentTradingCoordinator] Order routed: ${data.orderId} via ${data.route}`);
      this.emit('order_routed', data);
    });

    console.log('[IntelligentTradingCoordinator] ✅ SmartOrderRouter connected');
  }

  /**
   * Connect Market Microstructure Analyzer
   */
  private async connectMicrostructureAnalyzer(serviceManager: any): Promise<void> {
    const analyzer = serviceManager.getMarketMicrostructureAnalyzer();
    if (!analyzer) {
      console.warn('[IntelligentTradingCoordinator] MarketMicrostructureAnalyzer not available');
      return;
    }

    // Set exchange for spread analysis
    if (this.exchangeAdapter) {
      analyzer.setExchange?.(this.exchangeAdapter);
    }

    // Listen for spread alerts
    analyzer.on?.('spread_alert', (data: any) => {
      console.log(`[IntelligentTradingCoordinator] Spread alert: ${data.symbol} - ${data.message}`);
      this.emit('spread_alert', data);
    });

    console.log('[IntelligentTradingCoordinator] ✅ MarketMicrostructureAnalyzer connected');
  }


  /**
   * Connect Position Monitoring Service
   */
  private async connectPositionMonitoringService(serviceManager: any): Promise<void> {
    const monitoringService = serviceManager.getPositionMonitoringService();
    if (!monitoringService) {
      console.warn('[IntelligentTradingCoordinator] PositionMonitoringService not available');
      return;
    }

    // Listen for position alerts
    monitoringService.on?.('position_alert', (alert: any) => {
      console.log(`[IntelligentTradingCoordinator] Position alert: ${alert.type} - ${alert.message}`);
      this.emit('position_alert', alert);
    });

    // Start monitoring
    await monitoringService.start?.();

    console.log('[IntelligentTradingCoordinator] ✅ PositionMonitoringService connected');
  }

  /**
   * Connect Alert Services
   */
  private async connectAlertServices(serviceManager: any): Promise<void> {
    const alertSystem = serviceManager.getAutomatedAlertSystem();
    const notificationService = serviceManager.getAlertNotificationService();

    if (alertSystem) {
      alertSystem.on?.('alert', (alert: any) => {
        console.log(`[IntelligentTradingCoordinator] Alert: ${alert.type} - ${alert.message}`);
        this.emit('alert', alert);
        
        // Forward to notification service
        if (notificationService) {
          notificationService.sendAlert?.(alert);
        }
      });
      
      await alertSystem.start?.();
      console.log('[IntelligentTradingCoordinator] ✅ AutomatedAlertSystem connected');
    }

    if (notificationService) {
      console.log('[IntelligentTradingCoordinator] ✅ AlertNotificationService connected');
    }
  }

  /**
   * Connect HFT Services
   */
  private async connectHFTServices(serviceManager: any): Promise<void> {
    const scalpingEngine = serviceManager.getScalpingStrategyEngine();
    const hftOrchestrator = serviceManager.getHighFrequencyOrchestrator();

    if (scalpingEngine) {
      scalpingEngine.on?.('scalp_signal', (signal: any) => {
        console.log(`[IntelligentTradingCoordinator] Scalp signal: ${signal.symbol} ${signal.direction}`);
        this.emit('scalp_signal', signal);
      });
      
      await scalpingEngine.start?.();
      console.log('[IntelligentTradingCoordinator] ✅ ScalpingStrategyEngine connected');
    }

    if (hftOrchestrator) {
      await hftOrchestrator.start?.();
      console.log('[IntelligentTradingCoordinator] ✅ HighFrequencyOrchestrator connected');
    }
  }

  /**
   * Start price feed for services
   */
  private startPriceFeed(): void {
    // Update prices every 100ms
    this.priceUpdateInterval = setInterval(async () => {
      try {
        if (!this.exchangeAdapter) return;
        
        // Get prices for common symbols
        const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
        
        for (const symbol of symbols) {
          try {
            const ticker = await this.exchangeAdapter.getTicker?.(symbol);
            if (ticker && ticker.last) {
              this.lastPrices.set(symbol, ticker.last);
              updatePriceCache(symbol, ticker.last);
              
              if (ticker.volume) {
                updateVolumeCache(symbol, ticker.volume);
              }
            }
          } catch (e) {
            // Ignore individual symbol errors
          }
        }
      } catch (error) {
        // Ignore price feed errors
      }
    }, 100);
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('[IntelligentTradingCoordinator] Stopping...');

    // Stop price feed
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }

    // Stop services
    const serviceManager = getServiceIntegrationManager();
    
    const exitManager = serviceManager.getIntelligentExitManager();
    if (exitManager) exitManager.stop?.();
    
    const monitoringService = serviceManager.getPositionMonitoringService();
    if (monitoringService) await monitoringService.stop?.();

    this.isRunning = false;
    console.log('[IntelligentTradingCoordinator] Stopped');
    this.emit('stopped');
  }

  /**
   * Get coordinator status
   */
  getStatus(): CoordinatorStatus {
    const serviceManager = getServiceIntegrationManager();
    const statuses = serviceManager.getStatus();
    
    const connected = statuses.filter(s => s.connected).length;
    const failed = statuses.filter(s => !s.connected).length;

    return {
      isRunning: this.isRunning,
      servicesConnected: connected,
      servicesFailed: failed,
      lastUpdate: Date.now(),
      intelligentExitsActive: this.config.enableIntelligentExits && !!serviceManager.getIntelligentExitManager(),
      smartRoutingActive: this.config.enableSmartRouting && !!serviceManager.getSmartOrderRouter(),
      hftActive: this.config.enableHFT && !!serviceManager.getHighFrequencyOrchestrator(),
    };
  }

  /**
   * Update price for a symbol
   */
  updatePrice(symbol: string, price: number): void {
    this.lastPrices.set(symbol, price);
    updatePriceCache(symbol, price);
  }
}

// Singleton instance
let coordinatorInstance: IntelligentTradingCoordinator | null = null;

export function getIntelligentTradingCoordinator(config?: Partial<TradingCoordinatorConfig>): IntelligentTradingCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new IntelligentTradingCoordinator(config || {});
  }
  return coordinatorInstance;
}

export function resetIntelligentTradingCoordinator(): void {
  if (coordinatorInstance) {
    coordinatorInstance.stop().catch(console.error);
    coordinatorInstance = null;
  }
}
