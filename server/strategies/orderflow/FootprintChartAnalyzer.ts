/**
 * FootprintChartAnalyzer - Price-volume visualization data
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../../_core/clock';

export interface FootprintLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  totalVolume: number;
}

export interface FootprintData {
  symbol: string;
  timestamp: number;
  levels: FootprintLevel[];
  poc: number; // Point of Control
  valueAreaHigh: number;
  valueAreaLow: number;
  totalBuyVolume: number;
  totalSellVolume: number;
}

export interface FootprintConfig {
  priceStep: number;
  windowSize: number;
  valueAreaPercent: number;
}

export class FootprintChartAnalyzer extends EventEmitter {
  private config: FootprintConfig;
  private footprintData: Map<string, Map<number, FootprintLevel>> = new Map();
  private lastFootprint: Map<string, FootprintData> = new Map();
  
  constructor(config?: Partial<FootprintConfig>) {
    super();
    this.config = { priceStep: 10, windowSize: 300000, valueAreaPercent: 70, ...config };
  }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): FootprintData {
    const levels = this.getOrCreateLevels(trade.symbol);
    const priceLevel = Math.floor(trade.price / this.config.priceStep) * this.config.priceStep;
    
    if (!levels.has(priceLevel)) {
      levels.set(priceLevel, { price: priceLevel, buyVolume: 0, sellVolume: 0, delta: 0, totalVolume: 0 });
    }
    
    const level = levels.get(priceLevel)!;
    if (trade.side === 'buy') level.buyVolume += trade.quantity;
    else level.sellVolume += trade.quantity;
    level.delta = level.buyVolume - level.sellVolume;
    level.totalVolume = level.buyVolume + level.sellVolume;
    
    const footprint = this.calculateFootprint(trade.symbol);
    this.lastFootprint.set(trade.symbol, footprint);
    return footprint;
  }
  
  private getOrCreateLevels(symbol: string): Map<number, FootprintLevel> {
    if (!this.footprintData.has(symbol)) this.footprintData.set(symbol, new Map());
    return this.footprintData.get(symbol)!;
  }
  
  private calculateFootprint(symbol: string): FootprintData {
    const levels = this.footprintData.get(symbol)!;
    const levelArray = Array.from(levels.values()).sort((a, b) => b.price - a.price);
    
    let totalBuyVolume = 0, totalSellVolume = 0, maxVolume = 0, poc = 0;
    for (const level of levelArray) {
      totalBuyVolume += level.buyVolume;
      totalSellVolume += level.sellVolume;
      if (level.totalVolume > maxVolume) { maxVolume = level.totalVolume; poc = level.price; }
    }
    
    // Calculate value area
    const totalVolume = totalBuyVolume + totalSellVolume;
    const targetVolume = totalVolume * (this.config.valueAreaPercent / 100);
    let accumulatedVolume = 0;
    let valueAreaHigh = poc, valueAreaLow = poc;
    
    const sortedByVolume = [...levelArray].sort((a, b) => b.totalVolume - a.totalVolume);
    for (const level of sortedByVolume) {
      accumulatedVolume += level.totalVolume;
      if (level.price > valueAreaHigh) valueAreaHigh = level.price;
      if (level.price < valueAreaLow) valueAreaLow = level.price;
      if (accumulatedVolume >= targetVolume) break;
    }
    
    return { symbol, timestamp: getActiveClock().now(), levels: levelArray, poc, valueAreaHigh, valueAreaLow, totalBuyVolume, totalSellVolume };
  }
  
  getFootprint(symbol: string): FootprintData | null { return this.lastFootprint.get(symbol) || null; }
  reset(symbol?: string): void {
    if (symbol) { this.footprintData.delete(symbol); this.lastFootprint.delete(symbol); }
    else { this.footprintData.clear(); this.lastFootprint.clear(); }
  }
}

let instance: FootprintChartAnalyzer | null = null;
export function getFootprintChartAnalyzer(config?: Partial<FootprintConfig>): FootprintChartAnalyzer {
  if (!instance) instance = new FootprintChartAnalyzer(config);
  return instance;
}
export function resetFootprintChartAnalyzer(): void { instance = null; }
