/**
 * OrderImbalanceDetector - Detects large order imbalances
 */

import { EventEmitter } from 'events';

export interface ImbalanceMetrics {
  symbol: string;
  timestamp: number;
  buyVolume: number;
  sellVolume: number;
  imbalanceRatio: number;
  direction: 'buy' | 'sell' | 'neutral';
  strength: number;
  isSignificant: boolean;
}

export interface OrderImbalanceConfig {
  windowSize: number;
  imbalanceThreshold: number;
  significantVolumeMultiplier: number;
}

export class OrderImbalanceDetector extends EventEmitter {
  private config: OrderImbalanceConfig;
  private windowData: Map<string, { buyVolume: number; sellVolume: number; trades: any[] }> = new Map();
  private lastMetrics: Map<string, ImbalanceMetrics> = new Map();
  
  constructor(config?: Partial<OrderImbalanceConfig>) {
    super();
    this.config = { windowSize: 30000, imbalanceThreshold: 2.0, significantVolumeMultiplier: 3.0, ...config };
  }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): ImbalanceMetrics {
    const data = this.getOrCreateData(trade.symbol);
    data.trades.push(trade);
    if (trade.side === 'buy') data.buyVolume += trade.quantity;
    else data.sellVolume += trade.quantity;
    
    this.cleanOldTrades(trade.symbol);
    const metrics = this.calculateMetrics(trade.symbol);
    this.lastMetrics.set(trade.symbol, metrics);
    
    if (metrics.isSignificant) this.emit('imbalance', metrics);
    return metrics;
  }
  
  private getOrCreateData(symbol: string) {
    if (!this.windowData.has(symbol)) {
      this.windowData.set(symbol, { buyVolume: 0, sellVolume: 0, trades: [] });
    }
    return this.windowData.get(symbol)!;
  }
  
  private cleanOldTrades(symbol: string): void {
    const data = this.windowData.get(symbol);
    if (!data) return;
    const cutoff = Date.now() - this.config.windowSize;
    const oldTrades = data.trades.filter((t: any) => t.timestamp < cutoff);
    for (const trade of oldTrades) {
      if (trade.side === 'buy') data.buyVolume -= trade.quantity;
      else data.sellVolume -= trade.quantity;
    }
    data.trades = data.trades.filter((t: any) => t.timestamp >= cutoff);
  }
  
  private calculateMetrics(symbol: string): ImbalanceMetrics {
    const data = this.windowData.get(symbol)!;
    const imbalanceRatio = data.sellVolume > 0 ? data.buyVolume / data.sellVolume : data.buyVolume > 0 ? Infinity : 1;
    
    let direction: 'buy' | 'sell' | 'neutral' = 'neutral';
    if (imbalanceRatio > this.config.imbalanceThreshold) direction = 'buy';
    else if (imbalanceRatio < 1 / this.config.imbalanceThreshold) direction = 'sell';
    
    const strength = Math.min(100, Math.abs(Math.log(imbalanceRatio)) * 30);
    const isSignificant = imbalanceRatio > this.config.imbalanceThreshold || imbalanceRatio < 1 / this.config.imbalanceThreshold;
    
    return { symbol, timestamp: Date.now(), buyVolume: data.buyVolume, sellVolume: data.sellVolume, imbalanceRatio, direction, strength, isSignificant };
  }
  
  getMetrics(symbol: string): ImbalanceMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void {
    if (symbol) { this.windowData.delete(symbol); this.lastMetrics.delete(symbol); }
    else { this.windowData.clear(); this.lastMetrics.clear(); }
  }
}

let instance: OrderImbalanceDetector | null = null;
export function getOrderImbalanceDetector(config?: Partial<OrderImbalanceConfig>): OrderImbalanceDetector {
  if (!instance) instance = new OrderImbalanceDetector(config);
  return instance;
}
export function resetOrderImbalanceDetector(): void { instance = null; }
