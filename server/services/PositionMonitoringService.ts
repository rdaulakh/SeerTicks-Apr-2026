/**
 * Position Monitoring Service
 * 
 * Institutional-grade real-time position monitoring:
 * - Live P&L tracking with sub-second updates
 * - Automatic stop-loss and take-profit execution
 * - Trailing stop functionality
 * - Position health monitoring
 * - Risk alerts and notifications
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getDb } from '../db';
import { paperPositions, paperWallets, PaperPosition } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PositionUpdate {
  positionId: number;
  symbol: string;
  currentPrice: number;
  entryPrice: number;
  quantity: number;
  side: 'long' | 'short';
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  distanceToStopLoss?: number;
  distanceToTakeProfit?: number;
  healthScore: number; // 0-100
  alerts: PositionAlert[];
}

export interface PositionAlert {
  type: 'stop_loss_near' | 'take_profit_near' | 'high_loss' | 'trailing_stop_triggered' | 'position_aged';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
}

export interface TrailingStopConfig {
  enabled: boolean;
  activationPercent: number; // Activate when profit reaches this %
  trailPercent: number; // Trail by this %
  currentTrailPrice?: number;
}

export interface MonitoringConfig {
  updateIntervalMs: number;
  stopLossWarningPercent: number; // Warn when price is within X% of stop loss
  takeProfitWarningPercent: number;
  maxPositionAgeHours: number;
  enableTrailingStops: boolean;
  enableAutoExecution: boolean;
}

// ============================================================================
// Position Monitoring Service
// ============================================================================

export class PositionMonitoringService extends EventEmitter {
  private userId: number;
  private config: MonitoringConfig;
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private priceCache: Map<string, number> = new Map();
  private trailingStops: Map<number, TrailingStopConfig> = new Map();
  private lastUpdateTime: Date | null = null;

  constructor(userId: number, config?: Partial<MonitoringConfig>) {
    super();
    this.userId = userId;
    this.config = {
      updateIntervalMs: 1000, // 1 second updates
      stopLossWarningPercent: 2, // Warn when within 2% of stop loss
      takeProfitWarningPercent: 5, // Warn when within 5% of take profit
      maxPositionAgeHours: 72, // Warn for positions older than 72 hours
      enableTrailingStops: true,
      enableAutoExecution: true,
      ...config,
    };
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.monitoringInterval = setInterval(() => this.updateAllPositions(), this.config.updateIntervalMs);
    
    console.log(`[PositionMonitoringService] Started for user ${this.userId}`);
    this.emit('monitoring_started', { userId: this.userId });
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    console.log(`[PositionMonitoringService] Stopped for user ${this.userId}`);
    this.emit('monitoring_stopped', { userId: this.userId });
  }

  // ============================================================================
  // Price Updates
  // ============================================================================

  updatePrice(symbol: string, price: number): void {
    this.priceCache.set(symbol, price);
  }

  updatePrices(prices: Record<string, number>): void {
    for (const [symbol, price] of Object.entries(prices)) {
      this.priceCache.set(symbol, price);
    }
  }

  getPrice(symbol: string): number | undefined {
    return this.priceCache.get(symbol);
  }

  // ============================================================================
  // Position Monitoring
  // ============================================================================

  private async updateAllPositions(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      // Get all open positions
      const positions = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.userId, this.userId),
          eq(paperPositions.status, 'open')
        ));

      if (positions.length === 0) return;

      const updates: PositionUpdate[] = [];
      let totalUnrealizedPnL = 0;

      for (const position of positions) {
        const update = await this.updatePosition(position);
        if (update) {
          updates.push(update);
          totalUnrealizedPnL += update.unrealizedPnL;
        }
      }

      // Update wallet unrealized P&L
      await this.updateWalletPnL(totalUnrealizedPnL);

      this.lastUpdateTime = new Date();
      this.emit('positions_updated', { updates, totalUnrealizedPnL });

    } catch (error) {
      console.error(`[PositionMonitoringService] Error updating positions:`, error);
    }
  }

  private async updatePosition(position: PaperPosition): Promise<PositionUpdate | null> {
    const currentPrice = this.priceCache.get(position.symbol);
    if (!currentPrice) return null;

    const db = await getDb();
    if (!db) return null;

    const entryPrice = Number(position.entryPrice);
    const quantity = Number(position.quantity);
    const stopLoss = position.stopLoss ? Number(position.stopLoss) : undefined;
    const takeProfit = position.takeProfit ? Number(position.takeProfit) : undefined;

    // Calculate P&L
    const priceDiff = currentPrice - entryPrice;
    const direction = position.side === 'long' ? 1 : -1;
    const unrealizedPnL = priceDiff * quantity * direction;
    const unrealizedPnLPercent = (priceDiff / entryPrice) * 100 * direction;

    // Calculate distances
    let distanceToStopLoss: number | undefined;
    let distanceToTakeProfit: number | undefined;

    if (stopLoss) {
      distanceToStopLoss = position.side === 'long'
        ? ((currentPrice - stopLoss) / currentPrice) * 100
        : ((stopLoss - currentPrice) / currentPrice) * 100;
    }

    if (takeProfit) {
      distanceToTakeProfit = position.side === 'long'
        ? ((takeProfit - currentPrice) / currentPrice) * 100
        : ((currentPrice - takeProfit) / currentPrice) * 100;
    }

    // Generate alerts
    const alerts = this.generateAlerts(position, currentPrice, unrealizedPnLPercent, distanceToStopLoss, distanceToTakeProfit);

    // Calculate health score
    const healthScore = this.calculateHealthScore(unrealizedPnLPercent, distanceToStopLoss, alerts);

    // Update position in database
    await db
      .update(paperPositions)
      .set({
        currentPrice: currentPrice.toString(),
        unrealizedPnL: unrealizedPnL.toFixed(2),
        unrealizedPnLPercent: unrealizedPnLPercent.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(paperPositions.id, position.id));

    // Check for auto-execution triggers
    if (this.config.enableAutoExecution) {
      await this.checkAutoExecution(position, currentPrice, stopLoss, takeProfit);
    }

    // Check trailing stop
    if (this.config.enableTrailingStops) {
      await this.updateTrailingStop(position, currentPrice, unrealizedPnLPercent);
    }

    const update: PositionUpdate = {
      positionId: position.id,
      symbol: position.symbol,
      currentPrice,
      entryPrice,
      quantity,
      side: position.side as 'long' | 'short',
      unrealizedPnL,
      unrealizedPnLPercent,
      stopLoss,
      takeProfit,
      distanceToStopLoss,
      distanceToTakeProfit,
      healthScore,
      alerts,
    };

    // Emit individual position update
    this.emit('position_updated', update);

    // Emit alerts
    for (const alert of alerts) {
      if (alert.severity === 'critical') {
        this.emit('critical_alert', { position: update, alert });
      }
    }

    return update;
  }

  // ============================================================================
  // Alert Generation
  // ============================================================================

  private generateAlerts(
    position: PaperPosition,
    currentPrice: number,
    pnlPercent: number,
    distanceToStopLoss?: number,
    distanceToTakeProfit?: number
  ): PositionAlert[] {
    const alerts: PositionAlert[] = [];

    // Stop loss proximity alert
    if (distanceToStopLoss !== undefined && distanceToStopLoss <= this.config.stopLossWarningPercent) {
      alerts.push({
        type: 'stop_loss_near',
        severity: distanceToStopLoss <= 1 ? 'critical' : 'warning',
        message: `Price is ${distanceToStopLoss.toFixed(2)}% from stop loss`,
        timestamp: new Date(),
      });
    }

    // Take profit proximity alert
    if (distanceToTakeProfit !== undefined && distanceToTakeProfit <= this.config.takeProfitWarningPercent) {
      alerts.push({
        type: 'take_profit_near',
        severity: 'info',
        message: `Price is ${distanceToTakeProfit.toFixed(2)}% from take profit`,
        timestamp: new Date(),
      });
    }

    // High loss alert
    if (pnlPercent < -5) {
      alerts.push({
        type: 'high_loss',
        severity: pnlPercent < -10 ? 'critical' : 'warning',
        message: `Position is down ${Math.abs(pnlPercent).toFixed(2)}%`,
        timestamp: new Date(),
      });
    }

    // Position age alert
    const positionAgeHours = (getActiveClock().now() - new Date(position.entryTime).getTime()) / (1000 * 60 * 60);
    if (positionAgeHours > this.config.maxPositionAgeHours) {
      alerts.push({
        type: 'position_aged',
        severity: 'warning',
        message: `Position is ${Math.floor(positionAgeHours)} hours old`,
        timestamp: new Date(),
      });
    }

    return alerts;
  }

  // ============================================================================
  // Health Score Calculation
  // ============================================================================

  private calculateHealthScore(pnlPercent: number, distanceToStopLoss?: number, alerts: PositionAlert[] = []): number {
    let score = 100;

    // Deduct for negative P&L
    if (pnlPercent < 0) {
      score -= Math.min(30, Math.abs(pnlPercent) * 3);
    }

    // Deduct for proximity to stop loss
    if (distanceToStopLoss !== undefined && distanceToStopLoss < 5) {
      score -= (5 - distanceToStopLoss) * 10;
    }

    // Deduct for alerts
    for (const alert of alerts) {
      if (alert.severity === 'critical') score -= 20;
      else if (alert.severity === 'warning') score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  // ============================================================================
  // Auto Execution
  // ============================================================================

  private async checkAutoExecution(
    position: PaperPosition,
    currentPrice: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<void> {
    const isLong = position.side === 'long';

    // Check stop loss
    if (stopLoss) {
      const stopLossTriggered = isLong 
        ? currentPrice <= stopLoss 
        : currentPrice >= stopLoss;

      if (stopLossTriggered) {
        await this.executeClose(position, 'stop_loss', currentPrice);
        return;
      }
    }

    // Check take profit
    if (takeProfit) {
      const takeProfitTriggered = isLong 
        ? currentPrice >= takeProfit 
        : currentPrice <= takeProfit;

      if (takeProfitTriggered) {
        await this.executeClose(position, 'take_profit', currentPrice);
        return;
      }
    }

    // Check trailing stop
    const trailingStop = this.trailingStops.get(position.id);
    if (trailingStop?.enabled && trailingStop.currentTrailPrice) {
      const trailingStopTriggered = isLong
        ? currentPrice <= trailingStop.currentTrailPrice
        : currentPrice >= trailingStop.currentTrailPrice;

      if (trailingStopTriggered) {
        await this.executeClose(position, 'trailing_stop', currentPrice);
        return;
      }
    }
  }

  private async executeClose(
    position: PaperPosition,
    reason: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'manual',
    exitPrice: number
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const entryPrice = Number(position.entryPrice);
    const quantity = Number(position.quantity);
    const direction = position.side === 'long' ? 1 : -1;
    const realizedPnL = (exitPrice - entryPrice) * quantity * direction;

    try {
      // Update position to closed
      await db
        .update(paperPositions)
        .set({
          status: 'closed',
          exitReason: reason === 'trailing_stop' ? 'stop_loss' : reason,
          exitTime: new Date(),
          currentPrice: exitPrice.toString(),
          realizedPnl: realizedPnL.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(paperPositions.id, position.id));

      // Update wallet balance
      const wallet = await db
        .select()
        .from(paperWallets)
        .where(eq(paperWallets.userId, this.userId))
        .limit(1);

      if (wallet.length > 0) {
        const currentBalance = Number(wallet[0].balance);
        const positionValue = quantity * entryPrice;
        const newBalance = currentBalance + positionValue + realizedPnL;

        await db
          .update(paperWallets)
          .set({
            balance: newBalance.toFixed(2),
            realizedPnL: (Number(wallet[0].realizedPnL) + realizedPnL).toFixed(2),
            totalTrades: sql`${paperWallets.totalTrades} + 1`,
            winningTrades: realizedPnL > 0 ? sql`${paperWallets.winningTrades} + 1` : sql`${paperWallets.winningTrades}`,
            losingTrades: realizedPnL < 0 ? sql`${paperWallets.losingTrades} + 1` : sql`${paperWallets.losingTrades}`,
            updatedAt: new Date(),
          })
          .where(eq(paperWallets.userId, this.userId));
      }

      // Clean up trailing stop
      this.trailingStops.delete(position.id);

      console.log(`[PositionMonitoringService] Position ${position.id} closed: ${reason} at $${exitPrice.toFixed(2)}, P&L: $${realizedPnL.toFixed(2)}`);

      this.emit('position_closed', {
        positionId: position.id,
        symbol: position.symbol,
        reason,
        exitPrice,
        realizedPnL,
      });

    } catch (error) {
      console.error(`[PositionMonitoringService] Error closing position:`, error);
    }
  }

  // ============================================================================
  // Trailing Stop Management
  // ============================================================================

  setTrailingStop(positionId: number, config: Partial<TrailingStopConfig>): void {
    const existing = this.trailingStops.get(positionId) || {
      enabled: false,
      activationPercent: 2, // Activate at 2% profit
      trailPercent: 1, // Trail by 1%
    };

    this.trailingStops.set(positionId, { ...existing, ...config });
  }

  private async updateTrailingStop(
    position: PaperPosition,
    currentPrice: number,
    pnlPercent: number
  ): Promise<void> {
    let config = this.trailingStops.get(position.id);
    
    if (!config) {
      // Create default trailing stop config
      config = {
        enabled: true,
        activationPercent: 2,
        trailPercent: 1,
      };
      this.trailingStops.set(position.id, config);
    }

    if (!config.enabled) return;

    const isLong = position.side === 'long';

    // Check if trailing stop should be activated
    if (!config.currentTrailPrice && pnlPercent >= config.activationPercent) {
      // Activate trailing stop
      const trailPrice = isLong
        ? currentPrice * (1 - config.trailPercent / 100)
        : currentPrice * (1 + config.trailPercent / 100);

      config.currentTrailPrice = trailPrice;
      this.trailingStops.set(position.id, config);

      this.emit('trailing_stop_activated', {
        positionId: position.id,
        trailPrice,
        currentPrice,
      });
    } else if (config.currentTrailPrice) {
      // Update trailing stop if price moved favorably
      const newTrailPrice = isLong
        ? currentPrice * (1 - config.trailPercent / 100)
        : currentPrice * (1 + config.trailPercent / 100);

      const shouldUpdate = isLong
        ? newTrailPrice > config.currentTrailPrice
        : newTrailPrice < config.currentTrailPrice;

      if (shouldUpdate) {
        config.currentTrailPrice = newTrailPrice;
        this.trailingStops.set(position.id, config);

        this.emit('trailing_stop_updated', {
          positionId: position.id,
          trailPrice: newTrailPrice,
          currentPrice,
        });
      }
    }
  }

  // ============================================================================
  // Wallet P&L Update
  // ============================================================================

  private async updateWalletPnL(totalUnrealizedPnL: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      const wallet = await db
        .select()
        .from(paperWallets)
        .where(eq(paperWallets.userId, this.userId))
        .limit(1);

      if (wallet.length > 0) {
        const balance = Number(wallet[0].balance);
        const equity = balance + totalUnrealizedPnL;

        await db
          .update(paperWallets)
          .set({
            unrealizedPnL: totalUnrealizedPnL.toFixed(2),
            equity: equity.toFixed(2),
            totalPnL: (Number(wallet[0].realizedPnL) + totalUnrealizedPnL).toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(paperWallets.userId, this.userId));
      }
    } catch (error) {
      console.error(`[PositionMonitoringService] Error updating wallet P&L:`, error);
    }
  }

  // ============================================================================
  // Manual Position Management
  // ============================================================================

  async closePosition(positionId: number, reason: 'manual' = 'manual'): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    try {
      const positions = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.id, positionId),
          eq(paperPositions.userId, this.userId),
          eq(paperPositions.status, 'open')
        ))
        .limit(1);

      if (positions.length === 0) return false;

      const position = positions[0];
      const currentPrice = this.priceCache.get(position.symbol);
      
      if (!currentPrice) {
        console.error(`[PositionMonitoringService] No price available for ${position.symbol}`);
        return false;
      }

      await this.executeClose(position, reason, currentPrice);
      return true;

    } catch (error) {
      console.error(`[PositionMonitoringService] Error closing position:`, error);
      return false;
    }
  }

  async closeAllPositions(reason: 'manual' = 'manual'): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const positions = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.userId, this.userId),
          eq(paperPositions.status, 'open')
        ));

      let closedCount = 0;
      for (const position of positions) {
        const currentPrice = this.priceCache.get(position.symbol);
        if (currentPrice) {
          await this.executeClose(position, reason, currentPrice);
          closedCount++;
        }
      }

      return closedCount;

    } catch (error) {
      console.error(`[PositionMonitoringService] Error closing all positions:`, error);
      return 0;
    }
  }

  // ============================================================================
  // Status & Metrics
  // ============================================================================

  getStatus(): {
    isRunning: boolean;
    lastUpdateTime: Date | null;
    trackedSymbols: string[];
    activeTrailingStops: number;
  } {
    return {
      isRunning: this.isRunning,
      lastUpdateTime: this.lastUpdateTime,
      trackedSymbols: Array.from(this.priceCache.keys()),
      activeTrailingStops: Array.from(this.trailingStops.values()).filter(ts => ts.enabled && ts.currentTrailPrice).length,
    };
  }
}

// ============================================================================
// Singleton Instance Management
// ============================================================================

const monitoringInstances = new Map<number, PositionMonitoringService>();

export function getPositionMonitor(userId: number): PositionMonitoringService {
  if (!monitoringInstances.has(userId)) {
    monitoringInstances.set(userId, new PositionMonitoringService(userId));
  }
  return monitoringInstances.get(userId)!;
}

export function removePositionMonitor(userId: number): void {
  const monitor = monitoringInstances.get(userId);
  if (monitor) {
    monitor.stop();
    monitoringInstances.delete(userId);
  }
}
