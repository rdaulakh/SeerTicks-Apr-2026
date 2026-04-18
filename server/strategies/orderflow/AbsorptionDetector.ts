/**
 * AbsorptionDetector - Detects absorption patterns at key levels
 */

import { EventEmitter } from 'events';

export interface AbsorptionMetrics {
  symbol: string;
  timestamp: number;
  priceLevel: number;
  absorbedVolume: number;
  priceMovement: number;
  absorptionRatio: number;
  type: 'support' | 'resistance' | 'none';
  strength: number;
}

export interface AbsorptionConfig {
  windowSize: number;
  priceTolerancePercent: number;
  minAbsorptionRatio: number;
}

export class AbsorptionDetector extends EventEmitter {
  private config: AbsorptionConfig;
  private tradeData: Map<string, { trades: any[]; lastPrice: number }> = new Map();
  private lastMetrics: Map<string, AbsorptionMetrics> = new Map();
  
  constructor(config?: Partial<AbsorptionConfig>) {
    super();
    this.config = { windowSize: 60000, priceTolerancePercent: 0.1, minAbsorptionRatio: 5.0, ...config };
  }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): AbsorptionMetrics {
    const data = this.getOrCreateData(trade.symbol);
    data.trades.push(trade);
    data.lastPrice = trade.price;
    this.cleanOldTrades(trade.symbol);
    const metrics = this.calculateMetrics(trade.symbol);
    this.lastMetrics.set(trade.symbol, metrics);
    if (metrics.type !== 'none') this.emit('absorption', metrics);
    return metrics;
  }
  
  private getOrCreateData(symbol: string) {
    if (!this.tradeData.has(symbol)) this.tradeData.set(symbol, { trades: [], lastPrice: 0 });
    return this.tradeData.get(symbol)!;
  }
  
  private cleanOldTrades(symbol: string): void {
    const data = this.tradeData.get(symbol);
    if (!data) return;
    const cutoff = Date.now() - this.config.windowSize;
    data.trades = data.trades.filter((t: any) => t.timestamp >= cutoff);
  }
  
  private calculateMetrics(symbol: string): AbsorptionMetrics {
    const data = this.tradeData.get(symbol)!;
    if (data.trades.length < 5) {
      return { symbol, timestamp: Date.now(), priceLevel: data.lastPrice, absorbedVolume: 0, priceMovement: 0, absorptionRatio: 0, type: 'none', strength: 0 };
    }
    const prices = data.trades.map((t: any) => t.price);
    const volumes = data.trades.map((t: any) => t.quantity);
    const totalVolume = volumes.reduce((a: number, b: number) => a + b, 0);
    const priceRange = Math.max(...prices) - Math.min(...prices);
    const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
    const priceMovementPercent = (priceRange / avgPrice) * 100;
    const absorptionRatio = priceMovementPercent > 0 ? totalVolume / priceMovementPercent : totalVolume;
    let type: 'support' | 'resistance' | 'none' = 'none';
    if (absorptionRatio > this.config.minAbsorptionRatio) {
      const buyVolume = data.trades.filter((t: any) => t.side === 'buy').reduce((sum: number, t: any) => sum + t.quantity, 0);
      const sellVolume = data.trades.filter((t: any) => t.side === 'sell').reduce((sum: number, t: any) => sum + t.quantity, 0);
      type = buyVolume > sellVolume ? 'support' : 'resistance';
    }
    return { symbol, timestamp: Date.now(), priceLevel: avgPrice, absorbedVolume: totalVolume, priceMovement: priceMovementPercent, absorptionRatio, type, strength: Math.min(100, absorptionRatio * 10) };
  }
  
  getMetrics(symbol: string): AbsorptionMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void {
    if (symbol) { this.tradeData.delete(symbol); this.lastMetrics.delete(symbol); }
    else { this.tradeData.clear(); this.lastMetrics.clear(); }
  }
}

let instance: AbsorptionDetector | null = null;
export function getAbsorptionDetector(config?: Partial<AbsorptionConfig>): AbsorptionDetector {
  if (!instance) instance = new AbsorptionDetector(config);
  return instance;
}
export function resetAbsorptionDetector(): void { instance = null; }
