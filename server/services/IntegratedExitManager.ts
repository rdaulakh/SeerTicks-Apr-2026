/**
 * Integrated Exit Manager
 * Week 7-8 Implementation based on Claude AI recommendations
 * 
 * Combines all exit strategies into a unified manager:
 * - Structure-based exits (ATR stops, support/resistance breaks)
 * - Layered profit targets (33% at +1%, 33% at +1.5%, 34% runner)
 * - Time-based exits (4-hour max hold)
 * - Drawdown protection (3% max per position)
 * 
 * This replaces the confidence decay exit logic that was causing
 * the 201-minute average loser hold time.
 */

import { EventEmitter } from 'events';
import {
  StructureBasedExitManager,
  ExitSignal,
  OHLCV,
  Position as StructurePosition
} from './StructureBasedExitManager';
import {
  LayeredProfitManager,
  TradeAction,
  Position as ProfitPosition
} from './LayeredProfitManager';
import { getTradingConfig } from '../config/TradingConfig';

export interface ManagedPosition {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  averagePrice: number;
  currentSize: number;
  initialSize: number;
  notionalValue: number;
  unrealizedPnL: number;
  openTime: number;
  peakPrice?: number;
  trailingStopActive?: boolean;
  trailingStopPrice?: number;
}

export interface ExitDecision {
  shouldExit: boolean;
  exitType: 'full' | 'partial' | 'none';
  exitSize: number;
  reason: string;
  urgency: 'immediate' | 'high' | 'medium' | 'low';
  confidence: number;
  details: {
    structureSignals: ExitSignal[];
    profitActions: TradeAction[];
    triggeredBy: string;
  };
}

export interface ExitManagerConfig {
  enableStructureExits: boolean;
  enableLayeredProfits: boolean;
  enableTimeBasedExits: boolean;
  enableDrawdownProtection: boolean;
  maxHoldTimeHours: number;
  maxDrawdownPercent: number;
}

export class IntegratedExitManager extends EventEmitter {
  private structureManager: StructureBasedExitManager;
  private profitManager: LayeredProfitManager;
  private positions: Map<string, ManagedPosition> = new Map();
  private candleCache: Map<string, { candles: OHLCV[]; timestamp: number }> = new Map();
  
  // Phase 18: Defaults from TradingConfig (single source of truth)
  private config: ExitManagerConfig = (() => {
    try {
      const tc = getTradingConfig();
      return {
        enableStructureExits: true,
        enableLayeredProfits: true,
        enableTimeBasedExits: true,
        enableDrawdownProtection: true,
        maxHoldTimeHours: tc.exits.maxWinnerTimeMinutes / 60,
        maxDrawdownPercent: tc.exits.positionMaxDrawdownPercent,
      };
    } catch {
      return {
        enableStructureExits: true,
        enableLayeredProfits: true,
        enableTimeBasedExits: true,
        enableDrawdownProtection: true,
        maxHoldTimeHours: 4,
        maxDrawdownPercent: 0.03,
      };
    }
  })();

  // Callback for executing exits
  private exitCallback: ((positionId: string, size: number, reason: string) => Promise<void>) | null = null;

  constructor(config?: Partial<ExitManagerConfig>) {
    super();
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    this.structureManager = new StructureBasedExitManager();
    this.profitManager = new LayeredProfitManager();
    
    console.log('[IntegratedExitManager] Initialized with config:', this.config);
  }

  /**
   * Set exit callback for executing trades
   */
  setExitCallback(callback: (positionId: string, size: number, reason: string) => Promise<void>): void {
    this.exitCallback = callback;
    console.log('[IntegratedExitManager] Exit callback registered');
  }

  /**
   * Register a new position for exit management
   */
  registerPosition(position: ManagedPosition): void {
    this.positions.set(position.id, { ...position });
    
    // Initialize profit targets
    this.profitManager.initializeProfitTargets({
      id: position.id,
      symbol: position.symbol,
      direction: position.direction,
      averagePrice: position.averagePrice,
      currentSize: position.currentSize,
      initialSize: position.initialSize,
      notionalValue: position.notionalValue,
      unrealizedPnL: position.unrealizedPnL,
      openTime: position.openTime,
    });
    
    console.log(`[IntegratedExitManager] Position ${position.id} registered for ${position.symbol} ${position.direction}`);
    this.emit('position_registered', { positionId: position.id, symbol: position.symbol });
  }

  /**
   * Update position with current price and check for exits
   */
  async updatePosition(
    positionId: string,
    currentPrice: number,
    candles?: OHLCV[]
  ): Promise<ExitDecision> {
    const position = this.positions.get(positionId);
    if (!position) {
      return this.createNoExitDecision('Position not found');
    }

    // Update unrealized P&L
    const priceDiff = position.direction === 'long'
      ? currentPrice - position.averagePrice
      : position.averagePrice - currentPrice;
    position.unrealizedPnL = priceDiff * position.currentSize;
    position.notionalValue = currentPrice * position.currentSize;

    // Update peak price for trailing stops
    if (position.direction === 'long') {
      if (!position.peakPrice || currentPrice > position.peakPrice) {
        position.peakPrice = currentPrice;
      }
    } else {
      if (!position.peakPrice || currentPrice < position.peakPrice) {
        position.peakPrice = currentPrice;
      }
    }

    // Get candles (use cache if not provided)
    const candleData = candles || this.getCachedCandles(position.symbol);
    
    // Collect all exit signals and actions
    const structureSignals: ExitSignal[] = [];
    const profitActions: TradeAction[] = [];

    // Check structure-based exits
    if (this.config.enableStructureExits && candleData.length > 0) {
      const signals = await this.structureManager.calculateExitConditions(
        this.toStructurePosition(position),
        currentPrice,
        candleData
      );
      structureSignals.push(...signals);
    }

    // Check layered profit targets
    if (this.config.enableLayeredProfits) {
      const actions = this.profitManager.checkProfitTargets(
        this.toProfitPosition(position),
        currentPrice
      );
      profitActions.push(...actions);

      // Also check breakeven stop
      const breakevenAction = this.profitManager.checkBreakevenStop(
        this.toProfitPosition(position),
        currentPrice
      );
      if (breakevenAction) {
        profitActions.push(breakevenAction);
      }
    }

    // Check time-based exit
    if (this.config.enableTimeBasedExits) {
      const holdTimeMs = Date.now() - position.openTime;
      const maxHoldTimeMs = this.config.maxHoldTimeHours * 60 * 60 * 1000;
      
      if (holdTimeMs > maxHoldTimeMs) {
        structureSignals.push({
          type: 'max_time_exit',
          urgency: 'immediate',
          confidence: 1.0,
          reason: `Max hold time exceeded (${(holdTimeMs / 3600000).toFixed(1)} hours)`,
        });
      }
    }

    // Check drawdown protection
    if (this.config.enableDrawdownProtection) {
      const drawdown = Math.abs(position.unrealizedPnL) / position.notionalValue;
      if (position.unrealizedPnL < 0 && drawdown > this.config.maxDrawdownPercent) {
        structureSignals.push({
          type: 'drawdown_protection',
          urgency: 'immediate',
          confidence: 0.95,
          reason: `Drawdown ${(drawdown * 100).toFixed(2)}% exceeds ${(this.config.maxDrawdownPercent * 100).toFixed(1)}% limit`,
        });
      }
    }

    // Determine exit decision
    const decision = this.determineExitDecision(position, structureSignals, profitActions);

    // Execute exit if needed
    if (decision.shouldExit && this.exitCallback) {
      await this.executeExit(position, decision);
    }

    return decision;
  }

  /**
   * Determine the exit decision based on signals and actions
   */
  private determineExitDecision(
    position: ManagedPosition,
    structureSignals: ExitSignal[],
    profitActions: TradeAction[]
  ): ExitDecision {
    // Check for immediate structure exits first (highest priority)
    const immediateStructureExit = structureSignals.find(
      s => s.urgency === 'immediate' && s.confidence >= 0.7
    );

    if (immediateStructureExit) {
      return {
        shouldExit: true,
        exitType: 'full',
        exitSize: position.currentSize,
        reason: immediateStructureExit.reason || immediateStructureExit.type,
        urgency: 'immediate',
        confidence: immediateStructureExit.confidence,
        details: {
          structureSignals,
          profitActions,
          triggeredBy: `structure:${immediateStructureExit.type}`,
        },
      };
    }

    // Check for profit target partial exits
    const partialExitAction = profitActions.find(a => a.type === 'partial_exit');
    if (partialExitAction && partialExitAction.size) {
      return {
        shouldExit: true,
        exitType: 'partial',
        exitSize: partialExitAction.size,
        reason: partialExitAction.reason,
        urgency: partialExitAction.priority,
        confidence: 0.9,
        details: {
          structureSignals,
          profitActions,
          triggeredBy: `profit:${partialExitAction.reason}`,
        },
      };
    }

    // Check for trailing stop full exit
    const trailingStopAction = profitActions.find(a => a.type === 'full_exit');
    if (trailingStopAction) {
      return {
        shouldExit: true,
        exitType: 'full',
        exitSize: position.currentSize,
        reason: trailingStopAction.reason,
        urgency: trailingStopAction.priority,
        confidence: 0.85,
        details: {
          structureSignals,
          profitActions,
          triggeredBy: `profit:${trailingStopAction.reason}`,
        },
      };
    }

    // Check for high urgency structure exits
    const highUrgencyExit = structureSignals.find(
      s => s.urgency === 'high' && s.confidence >= 0.6
    );

    if (highUrgencyExit) {
      return {
        shouldExit: true,
        exitType: 'full',
        exitSize: position.currentSize,
        reason: highUrgencyExit.reason || highUrgencyExit.type,
        urgency: 'high',
        confidence: highUrgencyExit.confidence,
        details: {
          structureSignals,
          profitActions,
          triggeredBy: `structure:${highUrgencyExit.type}`,
        },
      };
    }

    // No exit needed
    return this.createNoExitDecision('No exit conditions met', structureSignals, profitActions);
  }

  /**
   * Execute the exit
   */
  private async executeExit(position: ManagedPosition, decision: ExitDecision): Promise<void> {
    if (!this.exitCallback) {
      console.warn('[IntegratedExitManager] No exit callback registered');
      return;
    }

    try {
      console.log(`[IntegratedExitManager] Executing ${decision.exitType} exit for ${position.id}: ${decision.reason}`);
      
      await this.exitCallback(position.id, decision.exitSize, decision.reason);
      
      // Update position size after partial exit
      if (decision.exitType === 'partial') {
        position.currentSize -= decision.exitSize;
        if (position.currentSize <= 0) {
          this.removePosition(position.id);
        }
      } else {
        this.removePosition(position.id);
      }

      this.emit('exit_executed', {
        positionId: position.id,
        symbol: position.symbol,
        exitType: decision.exitType,
        exitSize: decision.exitSize,
        reason: decision.reason,
      });
    } catch (error) {
      console.error(`[IntegratedExitManager] Exit execution failed for ${position.id}:`, error);
      this.emit('exit_failed', {
        positionId: position.id,
        error,
      });
    }
  }

  /**
   * Remove a position from management
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId);
    this.profitManager.cleanupPosition(positionId);
    console.log(`[IntegratedExitManager] Position ${positionId} removed`);
    this.emit('position_removed', { positionId });
  }

  /**
   * Update candle cache for a symbol
   */
  updateCandleCache(symbol: string, candles: OHLCV[]): void {
    this.candleCache.set(symbol, {
      candles,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached candles for a symbol
   */
  private getCachedCandles(symbol: string): OHLCV[] {
    const cached = this.candleCache.get(symbol);
    if (!cached) return [];
    
    // Cache expires after 5 minutes
    if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
      return [];
    }
    
    return cached.candles;
  }

  /**
   * Create a no-exit decision
   */
  private createNoExitDecision(
    reason: string,
    structureSignals: ExitSignal[] = [],
    profitActions: TradeAction[] = []
  ): ExitDecision {
    return {
      shouldExit: false,
      exitType: 'none',
      exitSize: 0,
      reason,
      urgency: 'low',
      confidence: 0,
      details: {
        structureSignals,
        profitActions,
        triggeredBy: 'none',
      },
    };
  }

  /**
   * Convert ManagedPosition to StructurePosition
   */
  private toStructurePosition(position: ManagedPosition): StructurePosition {
    return {
      id: position.id,
      symbol: position.symbol,
      direction: position.direction,
      averagePrice: position.averagePrice,
      currentSize: position.currentSize,
      notionalValue: position.notionalValue,
      unrealizedPnL: position.unrealizedPnL,
      openTime: position.openTime,
      peakPrice: position.peakPrice,
      trailingStopActive: position.trailingStopActive,
      trailingStopPrice: position.trailingStopPrice,
    };
  }

  /**
   * Convert ManagedPosition to ProfitPosition
   */
  private toProfitPosition(position: ManagedPosition): ProfitPosition {
    return {
      id: position.id,
      symbol: position.symbol,
      direction: position.direction,
      averagePrice: position.averagePrice,
      currentSize: position.currentSize,
      initialSize: position.initialSize,
      notionalValue: position.notionalValue,
      unrealizedPnL: position.unrealizedPnL,
      openTime: position.openTime,
    };
  }

  /**
   * Get all managed positions
   */
  getPositions(): ManagedPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by ID
   */
  getPosition(positionId: string): ManagedPosition | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Get profit target status for a position
   */
  getProfitTargetStatus(positionId: string) {
    return this.profitManager.getTargetStatus(positionId);
  }

  /**
   * Get configuration
   */
  getConfig(): ExitManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExitManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[IntegratedExitManager] Config updated:', this.config);
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    activePositions: number;
    totalExitsExecuted: number;
    avgHoldTime: number;
  } {
    const positions = this.getPositions();
    const now = Date.now();
    
    const totalHoldTime = positions.reduce((sum, p) => sum + (now - p.openTime), 0);
    const avgHoldTime = positions.length > 0 ? totalHoldTime / positions.length : 0;
    
    return {
      activePositions: positions.length,
      totalExitsExecuted: 0, // Would need to track this
      avgHoldTime: avgHoldTime / 60000, // Convert to minutes
    };
  }
}

export default IntegratedExitManager;
