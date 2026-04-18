/**
 * Statistical Arbitrage Strategies - Index
 */
import { EventEmitter } from 'events';

export * from './PairTradingEngine';
export * from './MeanReversionAnalyzer';
export * from './GridTradingEngine';

import { PairTradingEngine, getPairTradingEngine, PairTradingConfig } from './PairTradingEngine';
import { MeanReversionAnalyzer, getMeanReversionAnalyzer, MeanReversionConfig } from './MeanReversionAnalyzer';
import { GridTradingEngine, getGridTradingEngine, GridConfig } from './GridTradingEngine';

export interface StatisticalConfig { pairTrading?: Partial<PairTradingConfig>; meanReversion?: Partial<MeanReversionConfig>; grid?: Partial<GridConfig>; }

export class StatisticalArbitrageManager extends EventEmitter {
  private pairTrading: PairTradingEngine;
  private meanReversion: MeanReversionAnalyzer;
  private grid: GridTradingEngine;
  
  constructor(config?: StatisticalConfig) {
    super();
    this.pairTrading = getPairTradingEngine(config?.pairTrading);
    this.meanReversion = getMeanReversionAnalyzer(config?.meanReversion);
    this.grid = getGridTradingEngine(config?.grid);
  }
  
  start(): void { this.pairTrading.start(); this.grid.start(); }
  stop(): void { this.pairTrading.stop(); this.grid.stop(); }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): void {
    this.pairTrading.processPrice({ symbol: candle.symbol, timestamp: candle.timestamp, price: candle.close });
    this.meanReversion.processPrice(candle);
    this.grid.processPrice({ symbol: candle.symbol, timestamp: candle.timestamp, price: candle.close });
  }
  
  getAggregatedSignal(symbol: string): { direction: 'bullish' | 'bearish' | 'neutral'; strength: number; regime: string; components: any } {
    const mr = this.meanReversion.getMetrics(symbol);
    
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0;
    
    if (mr) {
      if (mr.signal === 'oversold') { direction = 'bullish'; strength = mr.strength; }
      else if (mr.signal === 'overbought') { direction = 'bearish'; strength = mr.strength; }
    }
    
    return { direction, strength, regime: mr?.regime || 'unknown', components: { meanReversion: mr, pairTrading: this.pairTrading.getMetrics(), grids: this.grid.getAllGrids() } };
  }
  
  // Pair trading methods
  registerPair(symbol1: string, symbol2: string): string { return this.pairTrading.registerPair(symbol1, symbol2); }
  getPairMetrics() { return this.pairTrading.getMetrics(); }
  
  // Grid trading methods
  createGrid(params: { symbol: string; upperPrice: number; lowerPrice: number; gridCount?: number; gridType?: 'arithmetic' | 'geometric'; totalInvestment: number }) { return this.grid.createGrid(params); }
  getGridMetrics(gridId: string) { return this.grid.getGridMetrics(gridId); }
  getAllGrids() { return this.grid.getAllGrids(); }
  
  // Mean reversion methods
  getMeanReversionMetrics(symbol: string) { return this.meanReversion.getMetrics(symbol); }
}

let instance: StatisticalArbitrageManager | null = null;
export function getStatisticalArbitrageManager(config?: StatisticalConfig): StatisticalArbitrageManager { if (!instance) instance = new StatisticalArbitrageManager(config); return instance; }
export function resetStatisticalArbitrageManager(): void { if (instance) instance.stop(); instance = null; }
