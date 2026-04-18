/**
 * VolumeDeltaAnalyzer - Cumulative Volume Delta Analysis
 */

import { EventEmitter } from 'events';

export interface VolumeDeltaMetrics {
  symbol: string;
  timestamp: number;
  cumulativeDelta: number;
  deltaSMA: number;
  deltaEMA: number;
  divergence: 'bullish' | 'bearish' | 'none';
  strength: number;
}

export interface VolumeDeltaConfig {
  smaPeriod: number;
  emaPeriod: number;
  divergenceThreshold: number;
}

interface DeltaData {
  deltas: number[];
  prices: number[];
  cumulativeDelta: number;
  lastPrice: number;
}

export class VolumeDeltaAnalyzer extends EventEmitter {
  private config: VolumeDeltaConfig;
  private deltaData: Map<string, DeltaData> = new Map();
  private lastMetrics: Map<string, VolumeDeltaMetrics> = new Map();
  
  constructor(config?: Partial<VolumeDeltaConfig>) {
    super();
    this.config = { smaPeriod: 20, emaPeriod: 12, divergenceThreshold: 0.3, ...config };
  }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): VolumeDeltaMetrics {
    const data = this.getOrCreateData(trade.symbol);
    const delta = trade.side === 'buy' ? trade.quantity : -trade.quantity;
    
    data.deltas.push(delta);
    data.prices.push(trade.price);
    data.cumulativeDelta += delta;
    data.lastPrice = trade.price;
    
    if (data.deltas.length > 500) { data.deltas.shift(); data.prices.shift(); }
    
    const metrics = this.calculateMetrics(trade.symbol);
    this.lastMetrics.set(trade.symbol, metrics);
    return metrics;
  }
  
  private getOrCreateData(symbol: string): DeltaData {
    if (!this.deltaData.has(symbol)) {
      this.deltaData.set(symbol, { deltas: [], prices: [], cumulativeDelta: 0, lastPrice: 0 });
    }
    return this.deltaData.get(symbol)!;
  }
  
  private calculateMetrics(symbol: string): VolumeDeltaMetrics {
    const data = this.deltaData.get(symbol)!;
    const smaSlice = data.deltas.slice(-this.config.smaPeriod);
    const deltaSMA = smaSlice.length > 0 ? smaSlice.reduce((a, b) => a + b, 0) / smaSlice.length : 0;
    
    const emaMultiplier = 2 / (this.config.emaPeriod + 1);
    let deltaEMA = data.deltas[0] || 0;
    for (let i = 1; i < Math.min(data.deltas.length, this.config.emaPeriod); i++) {
      deltaEMA = (data.deltas[i] - deltaEMA) * emaMultiplier + deltaEMA;
    }
    
    let divergence: 'bullish' | 'bearish' | 'none' = 'none';
    if (data.prices.length >= 10) {
      const priceChange = (data.prices[data.prices.length - 1] - data.prices[data.prices.length - 10]) / data.prices[data.prices.length - 10];
      if (priceChange < -this.config.divergenceThreshold && data.cumulativeDelta > 0) divergence = 'bullish';
      else if (priceChange > this.config.divergenceThreshold && data.cumulativeDelta < 0) divergence = 'bearish';
    }
    
    return { symbol, timestamp: Date.now(), cumulativeDelta: data.cumulativeDelta, deltaSMA, deltaEMA, divergence, strength: Math.min(100, Math.abs(data.cumulativeDelta) / 10) };
  }
  
  getMetrics(symbol: string): VolumeDeltaMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void {
    if (symbol) { this.deltaData.delete(symbol); this.lastMetrics.delete(symbol); }
    else { this.deltaData.clear(); this.lastMetrics.clear(); }
  }
}

let instance: VolumeDeltaAnalyzer | null = null;
export function getVolumeDeltaAnalyzer(config?: Partial<VolumeDeltaConfig>): VolumeDeltaAnalyzer {
  if (!instance) instance = new VolumeDeltaAnalyzer(config);
  return instance;
}
export function resetVolumeDeltaAnalyzer(): void { instance = null; }
