/**
 * Order Flow Strategies - Index
 */

import { EventEmitter } from 'events';

export * from './TapeReader';
export * from './VolumeDeltaAnalyzer';
export * from './OrderImbalanceDetector';
export * from './AbsorptionDetector';
export * from './FootprintChartAnalyzer';

import { TapeReader, getTapeReader, TapeReaderConfig } from './TapeReader';
import { VolumeDeltaAnalyzer, getVolumeDeltaAnalyzer, VolumeDeltaConfig } from './VolumeDeltaAnalyzer';
import { OrderImbalanceDetector, getOrderImbalanceDetector, OrderImbalanceConfig } from './OrderImbalanceDetector';
import { AbsorptionDetector, getAbsorptionDetector, AbsorptionConfig } from './AbsorptionDetector';
import { FootprintChartAnalyzer, getFootprintChartAnalyzer, FootprintConfig } from './FootprintChartAnalyzer';

export interface OrderFlowConfig {
  tapeReader?: Partial<TapeReaderConfig>;
  volumeDelta?: Partial<VolumeDeltaConfig>;
  orderImbalance?: Partial<OrderImbalanceConfig>;
  absorption?: Partial<AbsorptionConfig>;
  footprint?: Partial<FootprintConfig>;
}

export class OrderFlowManager extends EventEmitter {
  private tapeReader: TapeReader;
  private volumeDelta: VolumeDeltaAnalyzer;
  private orderImbalance: OrderImbalanceDetector;
  private absorption: AbsorptionDetector;
  private footprint: FootprintChartAnalyzer;
  
  constructor(config?: OrderFlowConfig) {
    super();
    this.tapeReader = getTapeReader(config?.tapeReader);
    this.volumeDelta = getVolumeDeltaAnalyzer(config?.volumeDelta);
    this.orderImbalance = getOrderImbalanceDetector(config?.orderImbalance);
    this.absorption = getAbsorptionDetector(config?.absorption);
    this.footprint = getFootprintChartAnalyzer(config?.footprint);
  }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): void {
    this.tapeReader.processTrade(trade);
    this.volumeDelta.processTrade(trade);
    this.orderImbalance.processTrade(trade);
    this.absorption.processTrade(trade);
    this.footprint.processTrade(trade);
  }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): void {
    // Simulate trades from candle for analysis
    const buyVolume = candle.close > candle.open ? candle.volume * 0.6 : candle.volume * 0.4;
    const sellVolume = candle.volume - buyVolume;
    
    this.processTrade({ symbol: candle.symbol, timestamp: candle.timestamp, price: candle.close, quantity: buyVolume, side: 'buy' });
    this.processTrade({ symbol: candle.symbol, timestamp: candle.timestamp + 1, price: candle.close, quantity: sellVolume, side: 'sell' });
  }
  
  getAggregatedSignal(symbol: string): { direction: 'bullish' | 'bearish' | 'neutral'; strength: number; components: any } {
    const tape = this.tapeReader.getMetrics(symbol);
    const delta = this.volumeDelta.getMetrics(symbol);
    const imbalance = this.orderImbalance.getMetrics(symbol);
    const absorb = this.absorption.getMetrics(symbol);
    
    let bullishScore = 0, bearishScore = 0;
    
    if (tape) {
      if (tape.direction === 'bullish') bullishScore += tape.momentum;
      else if (tape.direction === 'bearish') bearishScore += Math.abs(tape.momentum);
    }
    
    if (delta) {
      if (delta.cumulativeDelta > 0) bullishScore += delta.strength;
      else bearishScore += delta.strength;
    }
    
    if (imbalance) {
      if (imbalance.direction === 'buy') bullishScore += imbalance.strength;
      else if (imbalance.direction === 'sell') bearishScore += imbalance.strength;
    }
    
    if (absorb) {
      if (absorb.type === 'support') bullishScore += absorb.strength;
      else if (absorb.type === 'resistance') bearishScore += absorb.strength;
    }
    
    const totalScore = bullishScore + bearishScore;
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0;
    
    if (totalScore > 0) {
      if (bullishScore > bearishScore * 1.2) { direction = 'bullish'; strength = (bullishScore / totalScore) * 100; }
      else if (bearishScore > bullishScore * 1.2) { direction = 'bearish'; strength = (bearishScore / totalScore) * 100; }
      else { strength = 50; }
    }
    
    return { direction, strength: Math.round(strength), components: { tape, delta, imbalance, absorb } };
  }
}

let instance: OrderFlowManager | null = null;
export function getOrderFlowManager(config?: OrderFlowConfig): OrderFlowManager {
  if (!instance) instance = new OrderFlowManager(config);
  return instance;
}
export function resetOrderFlowManager(): void { instance = null; }
