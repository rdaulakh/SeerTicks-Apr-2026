import { getActiveClock } from '../_core/clock';
/**
 * Layered Profit Manager
 * Week 7-8 Implementation based on Claude AI recommendations
 * 
 * Implements institutional-grade profit taking strategy:
 * - 33% at +1% gain
 * - 33% at +1.5% gain
 * - 34% runner with trailing stop
 * - Breakeven stop after first target hit
 */

export interface ProfitTarget {
  percentage: number;
  positionReduction: number; // 0.33 = reduce position by 33%
  executed: boolean;
  price: number;
  executedAt?: number;
  executedPrice?: number;
}

export interface TradeAction {
  type: 'partial_exit' | 'update_stop' | 'activate_trailing_stop' | 'full_exit';
  size?: number;
  price?: number;
  reason: string;
  priority: 'immediate' | 'high' | 'medium' | 'low';
  trailingDistance?: number;
}

export interface Position {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  averagePrice: number;
  currentSize: number;
  initialSize: number;
  notionalValue: number;
  unrealizedPnL: number;
  openTime: number;
}

export interface ProfitManagerConfig {
  targets: Array<{
    percentage: number;
    positionReduction: number;
  }>;
  trailingStopDistance: number;
  breakevenBuffer: number; // Small buffer above/below entry for breakeven
}

export class LayeredProfitManager {
  private profitTargets: Map<string, ProfitTarget[]> = new Map();
  private breakevenStops: Map<string, number> = new Map();
  private trailingStops: Map<string, { active: boolean; price: number; distance: number }> = new Map();
  
  // Configuration based on Claude AI recommendations
  private config: ProfitManagerConfig = {
    targets: [
      { percentage: 0.01, positionReduction: 0.33 },   // 1% - take 33%
      { percentage: 0.015, positionReduction: 0.33 },  // 1.5% - take 33%
      { percentage: 0.02, positionReduction: 0.34 },   // 2% - runner target (remaining 34%)
    ],
    trailingStopDistance: 0.008, // 0.8% trailing distance
    breakevenBuffer: 0.001, // 0.1% buffer for breakeven
  };

  /**
   * Initialize profit targets for a new position
   */
  initializeProfitTargets(position: Position): ProfitTarget[] {
    const entryPrice = position.averagePrice;
    const direction = position.direction;
    
    const targets: ProfitTarget[] = this.config.targets.map((target, index) => ({
      percentage: target.percentage,
      positionReduction: target.positionReduction,
      executed: false,
      price: direction === 'long'
        ? entryPrice * (1 + target.percentage)
        : entryPrice * (1 - target.percentage)
    }));
    
    this.profitTargets.set(position.id, targets);
    this.trailingStops.set(position.id, { active: false, price: 0, distance: this.config.trailingStopDistance });
    
    return targets;
  }

  /**
   * Check profit targets and generate trade actions
   */
  checkProfitTargets(position: Position, currentPrice: number): TradeAction[] {
    const targets = this.profitTargets.get(position.id);
    if (!targets) {
      // Initialize if not exists
      this.initializeProfitTargets(position);
      return [];
    }
    
    const actions: TradeAction[] = [];
    let remainingSize = position.currentSize;
    
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (target.executed) continue;
      
      const targetHit = this.isTargetHit(position.direction, currentPrice, target.price);
      
      if (targetHit) {
        // FIX: partial exits size from current remaining, not initial — prevents over-sell after first TP
        const reductionSize = remainingSize * target.positionReduction;
        const actualReduction = Math.min(reductionSize, remainingSize);
        
        if (actualReduction > 0) {
          actions.push({
            type: 'partial_exit',
            size: actualReduction,
            price: currentPrice,
            reason: `profit_target_${i + 1}_${(target.percentage * 100).toFixed(1)}%`,
            priority: 'high'
          });
          
          remainingSize -= actualReduction;
        }
        
        // Mark target as executed
        target.executed = true;
        target.executedAt = getActiveClock().now();
        target.executedPrice = currentPrice;
        
        // Special actions based on target level
        if (i === 0) {
          // After first target: move to breakeven
          const breakevenPrice = this.calculateBreakevenPrice(position);
          this.breakevenStops.set(position.id, breakevenPrice);
          
          actions.push({
            type: 'update_stop',
            price: breakevenPrice,
            reason: 'breakeven_stop_after_first_target',
            priority: 'high'
          });
        }
        
        if (i === 0) {
          // FIX: trailing stop activates after TP1 to lock gains earlier
          const trailingStop = this.trailingStops.get(position.id);
          if (trailingStop) {
            trailingStop.active = true;
            trailingStop.price = this.calculateTrailingStopPrice(position.direction, currentPrice);
            
            actions.push({
              type: 'activate_trailing_stop',
              trailingDistance: this.config.trailingStopDistance,
              price: trailingStop.price,
              reason: 'runner_trailing_stop_activated',
              priority: 'medium'
            });
          }
        }
      }
    }
    
    // Check trailing stop for runner
    const trailingStopAction = this.checkTrailingStop(position, currentPrice);
    if (trailingStopAction) {
      actions.push(trailingStopAction);
    }
    
    return actions;
  }

  /**
   * Check if a target price has been hit
   */
  private isTargetHit(direction: 'long' | 'short', currentPrice: number, targetPrice: number): boolean {
    if (direction === 'long') {
      return currentPrice >= targetPrice;
    } else {
      return currentPrice <= targetPrice;
    }
  }

  /**
   * Calculate breakeven price with buffer
   */
  private calculateBreakevenPrice(position: Position): number {
    const buffer = position.averagePrice * this.config.breakevenBuffer;
    
    if (position.direction === 'long') {
      return position.averagePrice + buffer; // Slightly above entry
    } else {
      return position.averagePrice - buffer; // Slightly below entry
    }
  }

  /**
   * Calculate trailing stop price
   */
  private calculateTrailingStopPrice(direction: 'long' | 'short', currentPrice: number): number {
    const distance = currentPrice * this.config.trailingStopDistance;
    
    if (direction === 'long') {
      return currentPrice - distance;
    } else {
      return currentPrice + distance;
    }
  }

  /**
   * Update trailing stop based on price movement
   */
  updateTrailingStop(position: Position, currentPrice: number): number | null {
    const trailingStop = this.trailingStops.get(position.id);
    if (!trailingStop || !trailingStop.active) return null;
    
    const newStopPrice = this.calculateTrailingStopPrice(position.direction, currentPrice);
    
    if (position.direction === 'long') {
      // Only update if new stop is higher
      if (newStopPrice > trailingStop.price) {
        trailingStop.price = newStopPrice;
        return newStopPrice;
      }
    } else {
      // Only update if new stop is lower
      if (newStopPrice < trailingStop.price) {
        trailingStop.price = newStopPrice;
        return newStopPrice;
      }
    }
    
    return null;
  }

  /**
   * Check if trailing stop has been triggered
   */
  private checkTrailingStop(position: Position, currentPrice: number): TradeAction | null {
    const trailingStop = this.trailingStops.get(position.id);
    if (!trailingStop || !trailingStop.active) return null;
    
    // First, try to update the trailing stop
    this.updateTrailingStop(position, currentPrice);
    
    // Then check if triggered
    const triggered = position.direction === 'long'
      ? currentPrice <= trailingStop.price
      : currentPrice >= trailingStop.price;
    
    if (triggered) {
      return {
        type: 'full_exit',
        price: currentPrice,
        reason: `trailing_stop_triggered_at_${trailingStop.price.toFixed(2)}`,
        priority: 'immediate'
      };
    }
    
    return null;
  }

  /**
   * Check if breakeven stop has been triggered
   */
  checkBreakevenStop(position: Position, currentPrice: number): TradeAction | null {
    const breakevenPrice = this.breakevenStops.get(position.id);
    if (!breakevenPrice) return null;
    
    const triggered = position.direction === 'long'
      ? currentPrice <= breakevenPrice
      : currentPrice >= breakevenPrice;
    
    if (triggered) {
      return {
        type: 'full_exit',
        price: currentPrice,
        reason: `breakeven_stop_triggered_at_${breakevenPrice.toFixed(2)}`,
        priority: 'immediate'
      };
    }
    
    return null;
  }

  /**
   * Get current profit target status for a position
   */
  getTargetStatus(positionId: string): {
    targets: ProfitTarget[];
    breakevenActive: boolean;
    breakevenPrice: number | null;
    trailingActive: boolean;
    trailingPrice: number | null;
  } {
    const targets = this.profitTargets.get(positionId) || [];
    const breakevenPrice = this.breakevenStops.get(positionId) || null;
    const trailingStop = this.trailingStops.get(positionId);
    
    return {
      targets,
      breakevenActive: breakevenPrice !== null,
      breakevenPrice,
      trailingActive: trailingStop?.active || false,
      trailingPrice: trailingStop?.price || null
    };
  }

  /**
   * Calculate realized profit from executed targets
   */
  calculateRealizedProfit(positionId: string, entryPrice: number): number {
    const targets = this.profitTargets.get(positionId) || [];
    let totalProfit = 0;
    
    for (const target of targets) {
      if (target.executed && target.executedPrice) {
        const profitPerUnit = Math.abs(target.executedPrice - entryPrice);
        totalProfit += profitPerUnit * target.positionReduction;
      }
    }
    
    return totalProfit;
  }

  /**
   * Clean up position data
   */
  cleanupPosition(positionId: string): void {
    this.profitTargets.delete(positionId);
    this.breakevenStops.delete(positionId);
    this.trailingStops.delete(positionId);
  }

  /**
   * Get all active positions with profit management
   */
  getActivePositions(): string[] {
    return Array.from(this.profitTargets.keys());
  }
}
