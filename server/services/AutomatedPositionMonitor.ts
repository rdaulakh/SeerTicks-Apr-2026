import { EventEmitter } from "events";
import type { PositionManager } from "../PositionManager";
import type { PaperTradingEngine } from "../execution/PaperTradingEngine";

/**
 * Automated Position Monitor
 * 
 * Monitors all open positions in real-time and automatically closes them when:
 * - Stop-loss is hit
 * - Take-profit is hit
 * - Trailing stop-loss is triggered
 * 
 * NO manual intervention required - this is institutional-grade autonomous trading.
 * 
 * Features:
 * - Real-time position monitoring (100ms interval)
 * - Automatic stop-loss execution
 * - Automatic take-profit execution
 * - Trailing stop-loss for winning positions
 * - Real-time P&L updates
 * 
 * @fires position_closed - When a position is automatically closed
 * @fires stop_loss_hit - When a stop-loss is triggered
 * @fires take_profit_hit - When a take-profit is triggered
 */
export class AutomatedPositionMonitor extends EventEmitter {
  private userId: number;
  private positionManager: PositionManager | null = null;
  private paperTradingEngine: PaperTradingEngine | null = null;
  
  private isMonitoring: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private MONITORING_INTERVAL_MS: number = 100; // 100ms for real-time monitoring
  
  // Trailing stop-loss configuration
  private enableTrailingStop: boolean = true;
  private trailingStopDistance: number = 0.03; // 3% trailing distance
  private trailingStopActivation: number = 0.05; // Activate after 5% profit

  constructor(userId: number, config?: {
    monitoringIntervalMs?: number;
    enableTrailingStop?: boolean;
    trailingStopDistance?: number;
    trailingStopActivation?: number;
  }) {
    super();
    this.userId = userId;
    
    if (config) {
      if (config.monitoringIntervalMs !== undefined) {
        this.MONITORING_INTERVAL_MS = config.monitoringIntervalMs;
      }
      if (config.enableTrailingStop !== undefined) {
        this.enableTrailingStop = config.enableTrailingStop;
      }
      if (config.trailingStopDistance !== undefined) {
        this.trailingStopDistance = config.trailingStopDistance;
      }
      if (config.trailingStopActivation !== undefined) {
        this.trailingStopActivation = config.trailingStopActivation;
      }
    }
    
    console.log(`[AutomatedPositionMonitor] Initialized for user ${userId}`);
    console.log(`[AutomatedPositionMonitor] Monitoring Interval: ${this.MONITORING_INTERVAL_MS}ms`);
    console.log(`[AutomatedPositionMonitor] Trailing Stop: ${this.enableTrailingStop ? 'Enabled' : 'Disabled'}`);
    if (this.enableTrailingStop) {
      console.log(`[AutomatedPositionMonitor] Trailing Distance: ${(this.trailingStopDistance * 100).toFixed(1)}%`);
      console.log(`[AutomatedPositionMonitor] Trailing Activation: ${(this.trailingStopActivation * 100).toFixed(1)}%`);
    }
  }

  /**
   * Set dependencies
   */
  setDependencies(
    positionManager: PositionManager,
    paperTradingEngine: PaperTradingEngine
  ): void {
    this.positionManager = positionManager;
    this.paperTradingEngine = paperTradingEngine;
    console.log(`[AutomatedPositionMonitor] Dependencies set`);
  }

  /**
   * Start monitoring positions
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      console.log(`[AutomatedPositionMonitor] Already monitoring`);
      return;
    }

    if (!this.positionManager || !this.paperTradingEngine) {
      throw new Error('Dependencies not set');
    }

    console.log(`[AutomatedPositionMonitor] Starting position monitoring...`);
    this.isMonitoring = true;

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.monitorPositions().catch(err => {
        console.error(`[AutomatedPositionMonitor] Monitoring error:`, err);
      });
    }, this.MONITORING_INTERVAL_MS);

    // Run immediately
    await this.monitorPositions();

    console.log(`[AutomatedPositionMonitor] Position monitoring started`);
  }

  /**
   * Stop monitoring positions
   */
  async stop(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    console.log(`[AutomatedPositionMonitor] Stopping position monitoring...`);

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;

    console.log(`[AutomatedPositionMonitor] Position monitoring stopped`);
  }

  /**
   * Monitor all open positions
   */
  private async monitorPositions(): Promise<void> {
    if (!this.positionManager || !this.paperTradingEngine) {
      return;
    }

    try {
      // Get all open positions
      const positions = await this.positionManager.getOpenPositions(this.userId);

      if (positions.length === 0) {
        return; // No positions to monitor
      }

      // Get current prices
      const { priceFeedService } = await import('./priceFeedService');

      for (const position of positions) {
        const prices = priceFeedService.getPrices([position.symbol]);
        const priceData = prices.get(position.symbol);
        
        if (!priceData) {
          continue; // No price data available
        }

        const currentPrice = priceData.price;
        const entryPrice = parseFloat(position.entryPrice);
        const stopLoss = position.stopLoss ? parseFloat(position.stopLoss) : null;
        const takeProfit = position.takeProfit ? parseFloat(position.takeProfit) : null;

        // Check stop-loss
        if (stopLoss !== null) {
          const stopLossHit = position.side === 'long' 
            ? currentPrice <= stopLoss
            : currentPrice >= stopLoss;

          if (stopLossHit) {
            console.log(`[AutomatedPositionMonitor] 🛑 STOP-LOSS HIT: ${position.symbol} @ $${currentPrice.toFixed(2)}`);
            await this.closePosition(position.id, 'stop_loss', currentPrice);
            continue;
          }
        }

        // Check take-profit
        if (takeProfit !== null) {
          const takeProfitHit = position.side === 'long'
            ? currentPrice >= takeProfit
            : currentPrice <= takeProfit;

          if (takeProfitHit) {
            console.log(`[AutomatedPositionMonitor] 🎯 TAKE-PROFIT HIT: ${position.symbol} @ $${currentPrice.toFixed(2)}`);
            await this.closePosition(position.id, 'take_profit', currentPrice);
            continue;
          }
        }

        // Check trailing stop-loss
        if (this.enableTrailingStop && stopLoss !== null) {
          await this.updateTrailingStop(position, currentPrice, entryPrice, stopLoss);
        }
      }

    } catch (error) {
      console.error(`[AutomatedPositionMonitor] Error monitoring positions:`, error);
    }
  }

  /**
   * Update trailing stop-loss for a position
   */
  private async updateTrailingStop(
    position: any,
    currentPrice: number,
    entryPrice: number,
    currentStopLoss: number
  ): Promise<void> {
    // Calculate profit percentage
    const profitPct = position.side === 'long'
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;

    // Only activate trailing stop if profit exceeds activation threshold
    if (profitPct < this.trailingStopActivation) {
      return;
    }

    // Calculate new trailing stop-loss
    const newStopLoss = position.side === 'long'
      ? currentPrice * (1 - this.trailingStopDistance)
      : currentPrice * (1 + this.trailingStopDistance);

    // Only update if new stop-loss is better than current
    const shouldUpdate = position.side === 'long'
      ? newStopLoss > currentStopLoss
      : newStopLoss < currentStopLoss;

    if (shouldUpdate) {
      console.log(`[AutomatedPositionMonitor] 📈 Trailing Stop Updated: ${position.symbol}`);
      console.log(`  Old Stop: $${currentStopLoss.toFixed(2)} → New Stop: $${newStopLoss.toFixed(2)}`);
      console.log(`  Profit: ${(profitPct * 100).toFixed(2)}%`);

      // Update stop-loss in position manager
      await this.positionManager!.updatePosition(position.id, {
        stopLoss: newStopLoss.toString(),
      });

      this.emit('trailing_stop_updated', {
        positionId: position.id,
        symbol: position.symbol,
        oldStopLoss: currentStopLoss,
        newStopLoss,
        profitPct,
      });
    }
  }

  /**
   * Close a position automatically
   */
  private async closePosition(
    positionId: number,
    reason: 'stop_loss' | 'take_profit',
    exitPrice: number
  ): Promise<void> {
    if (!this.paperTradingEngine) {
      throw new Error('PaperTradingEngine not set');
    }

    try {
      console.log(`[AutomatedPositionMonitor] Closing position ${positionId} (${reason}) @ $${exitPrice.toFixed(2)}`);

      // Close position by updating position manager
      await this.positionManager!.updatePosition(positionId, {
        thesisValid: false,
        currentPrice: exitPrice.toString(),
      });

      console.log(`[AutomatedPositionMonitor] ✅ Position ${positionId} closed successfully`);

      this.emit('position_closed', {
        positionId,
        reason,
        exitPrice,
      });

      if (reason === 'stop_loss') {
        this.emit('stop_loss_hit', {
          positionId,
          exitPrice,
        });
      } else if (reason === 'take_profit') {
        this.emit('take_profit_hit', {
          positionId,
          exitPrice,
        });
      }

    } catch (error) {
      console.error(`[AutomatedPositionMonitor] Error closing position ${positionId}:`, error);
      
      this.emit('close_error', {
        positionId,
        reason,
        error,
      });
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      monitoringIntervalMs: this.MONITORING_INTERVAL_MS,
      enableTrailingStop: this.enableTrailingStop,
      trailingStopDistance: this.trailingStopDistance,
      trailingStopActivation: this.trailingStopActivation,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    enableTrailingStop?: boolean;
    trailingStopDistance?: number;
    trailingStopActivation?: number;
  }): void {
    if (config.enableTrailingStop !== undefined) {
      this.enableTrailingStop = config.enableTrailingStop;
    }
    if (config.trailingStopDistance !== undefined) {
      this.trailingStopDistance = config.trailingStopDistance;
    }
    if (config.trailingStopActivation !== undefined) {
      this.trailingStopActivation = config.trailingStopActivation;
    }
    
    console.log(`[AutomatedPositionMonitor] Configuration updated`);
  }
}
