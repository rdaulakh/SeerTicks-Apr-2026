/**
 * Smart Money Concepts - Index with SmartMoneyManager
 */
import { EventEmitter } from 'events';

export * from './LiquidityGrabDetector';
export * from './OrderBlockIdentifier';
export * from './FairValueGapDetector';
export * from './BreakOfStructure';

import { LiquidityGrabDetector, getLiquidityGrabDetector, LiquidityGrabConfig } from './LiquidityGrabDetector';
import { OrderBlockIdentifier, getOrderBlockIdentifier, OrderBlockConfig } from './OrderBlockIdentifier';
import { FairValueGapDetector, getFairValueGapDetector, FVGConfig } from './FairValueGapDetector';
import { BreakOfStructure, getBreakOfStructure, BOSConfig } from './BreakOfStructure';

export interface SmartMoneyConfig { liquidityGrab?: Partial<LiquidityGrabConfig>; orderBlock?: Partial<OrderBlockConfig>; fvg?: Partial<FVGConfig>; bos?: Partial<BOSConfig>; }

export class SmartMoneyManager extends EventEmitter {
  private liquidityGrab: LiquidityGrabDetector;
  private orderBlock: OrderBlockIdentifier;
  private fvg: FairValueGapDetector;
  private bos: BreakOfStructure;
  
  constructor(config?: SmartMoneyConfig) {
    super();
    this.liquidityGrab = getLiquidityGrabDetector(config?.liquidityGrab);
    this.orderBlock = getOrderBlockIdentifier(config?.orderBlock);
    this.fvg = getFairValueGapDetector(config?.fvg);
    this.bos = getBreakOfStructure(config?.bos);
  }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): void {
    this.liquidityGrab.processCandle(candle);
    this.orderBlock.processCandle(candle);
    this.fvg.processCandle(candle);
    this.bos.processCandle(candle);
  }
  
  getAggregatedSignal(symbol: string): { direction: 'bullish' | 'bearish' | 'neutral'; strength: number; confidence: number; trend: string; tradingLevels: { entry: number | null; stopLoss: number | null; takeProfit: number | null; source: string }; components: any } {
    const lg = this.liquidityGrab.getMetrics(symbol);
    const ob = this.orderBlock.getMetrics(symbol);
    const fvgData = this.fvg.getMetrics(symbol);
    const structure = this.bos.getStructure(symbol);
    
    let bullishScore = 0, bearishScore = 0, signals = 0;
    
    // Liquidity grab signals
    if (lg?.activeGrab) {
      signals++;
      if (lg.activeGrab.type === 'bullish') bullishScore += lg.activeGrab.strength;
      else bearishScore += lg.activeGrab.strength;
    }
    
    // Order block signals
    if (ob?.nearestBullish) { signals++; bullishScore += ob.nearestBullish.strength; }
    if (ob?.nearestBearish) { signals++; bearishScore += ob.nearestBearish.strength; }
    
    // FVG signals
    if (fvgData?.nearestBullish) { signals++; bullishScore += 30; }
    if (fvgData?.nearestBearish) { signals++; bearishScore += 30; }
    
    // Structure signals
    if (structure) {
      signals++;
      if (structure.trend === 'bullish') bullishScore += 40;
      else if (structure.trend === 'bearish') bearishScore += 40;
      if (structure.lastCHoCH) {
        if (structure.lastCHoCH.type === 'bullish') bullishScore += 30;
        else bearishScore += 30;
      }
    }
    
    const totalScore = bullishScore + bearishScore;
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0;
    
    if (totalScore > 0) {
      if (bullishScore > bearishScore * 1.3) { direction = 'bullish'; strength = Math.min(100, (bullishScore / totalScore) * 100); }
      else if (bearishScore > bullishScore * 1.3) { direction = 'bearish'; strength = Math.min(100, (bearishScore / totalScore) * 100); }
      else { strength = 50; }
    }
    
    const confidence = signals > 0 ? Math.min(100, signals * 20) : 0;
    
    // Calculate trading levels
    let entry: number | null = null, stopLoss: number | null = null, takeProfit: number | null = null, source = 'none';
    if (direction === 'bullish' && ob?.nearestBullish) {
      entry = ob.nearestBullish.high;
      stopLoss = ob.nearestBullish.low * 0.995;
      takeProfit = entry * 1.02;
      source = 'order_block';
    } else if (direction === 'bearish' && ob?.nearestBearish) {
      entry = ob.nearestBearish.low;
      stopLoss = ob.nearestBearish.high * 1.005;
      takeProfit = entry * 0.98;
      source = 'order_block';
    }
    
    return { direction, strength: Math.round(strength), confidence, trend: structure?.trend || 'ranging', tradingLevels: { entry, stopLoss, takeProfit, source }, components: { liquidityGrab: lg, orderBlock: ob, fvg: fvgData, structure } };
  }
  
  getKeyLevels(symbol: string): { orderBlocks: any[]; fvgs: any[]; liquidityPools: any[]; swingPoints: any } {
    const ob = this.orderBlock.getMetrics(symbol);
    const fvgData = this.fvg.getMetrics(symbol);
    const lg = this.liquidityGrab.getMetrics(symbol);
    const structure = this.bos.getSwingPoints(symbol);
    return { orderBlocks: ob?.blocks || [], fvgs: fvgData?.fvgs || [], liquidityPools: lg?.pools || [], swingPoints: structure };
  }
}

let instance: SmartMoneyManager | null = null;
export function getSmartMoneyManager(config?: SmartMoneyConfig): SmartMoneyManager { if (!instance) instance = new SmartMoneyManager(config); return instance; }
export function resetSmartMoneyManager(): void { instance = null; }
