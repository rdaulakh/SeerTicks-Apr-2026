/**
 * FairValueGapDetector - Identifies imbalance zones (FVGs)
 */
import { EventEmitter } from 'events';

export interface FairValueGap { high: number; low: number; type: 'bullish' | 'bearish'; timestamp: number; filled: boolean; fillPercent: number; }
export interface FVGMetrics { symbol: string; timestamp: number; fvgs: FairValueGap[]; nearestBullish: FairValueGap | null; nearestBearish: FairValueGap | null; }
export interface FVGConfig { minGapPercent: number; maxFVGAge: number; }
interface CandleData { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

export class FairValueGapDetector extends EventEmitter {
  private config: FVGConfig;
  private candles: Map<string, CandleData[]> = new Map();
  private fvgs: Map<string, FairValueGap[]> = new Map();
  private lastMetrics: Map<string, FVGMetrics> = new Map();
  
  constructor(config?: Partial<FVGConfig>) { super(); this.config = { minGapPercent: 0.1, maxFVGAge: 50, ...config }; }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): FVGMetrics {
    const candleList = this.getOrCreateCandles(candle.symbol);
    candleList.push(candle);
    if (candleList.length > 100) candleList.shift();
    this.detectFVGs(candle.symbol);
    this.updateFVGStatus(candle.symbol);
    const metrics = this.calculateMetrics(candle.symbol);
    this.lastMetrics.set(candle.symbol, metrics);
    return metrics;
  }
  
  private getOrCreateCandles(symbol: string): CandleData[] { if (!this.candles.has(symbol)) this.candles.set(symbol, []); return this.candles.get(symbol)!; }
  
  private detectFVGs(symbol: string): void {
    const candleList = this.candles.get(symbol)!;
    if (candleList.length < 3) return;
    if (!this.fvgs.has(symbol)) this.fvgs.set(symbol, []);
    const fvgList = this.fvgs.get(symbol)!;
    
    const c1 = candleList[candleList.length - 3], c2 = candleList[candleList.length - 2], c3 = candleList[candleList.length - 1];
    
    // Bullish FVG: c1.high < c3.low (gap up)
    if (c1.high < c3.low) {
      const gapPercent = ((c3.low - c1.high) / c1.high) * 100;
      if (gapPercent >= this.config.minGapPercent) {
        const existing = fvgList.find(f => f.type === 'bullish' && Math.abs(f.low - c1.high) / c1.high < 0.001);
        if (!existing) {
          fvgList.push({ high: c3.low, low: c1.high, type: 'bullish', timestamp: c2.timestamp, filled: false, fillPercent: 0 });
          this.emit('newFVG', { symbol, type: 'bullish', fvg: fvgList[fvgList.length - 1] });
          console.log(`[FairValueGapDetector] New bullish FVG on ${symbol}: ${c1.high.toFixed(2)}-${c3.low.toFixed(2)} (${gapPercent.toFixed(2)}%)`);
        }
      }
    }
    
    // Bearish FVG: c1.low > c3.high (gap down)
    if (c1.low > c3.high) {
      const gapPercent = ((c1.low - c3.high) / c1.low) * 100;
      if (gapPercent >= this.config.minGapPercent) {
        const existing = fvgList.find(f => f.type === 'bearish' && Math.abs(f.high - c1.low) / c1.low < 0.001);
        if (!existing) {
          fvgList.push({ high: c1.low, low: c3.high, type: 'bearish', timestamp: c2.timestamp, filled: false, fillPercent: 0 });
          this.emit('newFVG', { symbol, type: 'bearish', fvg: fvgList[fvgList.length - 1] });
          console.log(`[FairValueGapDetector] New bearish FVG on ${symbol}: ${c3.high.toFixed(2)}-${c1.low.toFixed(2)} (${gapPercent.toFixed(2)}%)`);
        }
      }
    }
    
    this.fvgs.set(symbol, fvgList.slice(-this.config.maxFVGAge));
  }
  
  private updateFVGStatus(symbol: string): void {
    const candleList = this.candles.get(symbol)!, fvgList = this.fvgs.get(symbol) || [];
    if (candleList.length < 1) return;
    const curr = candleList[candleList.length - 1];
    
    for (const fvg of fvgList) {
      if (fvg.filled) continue;
      const gapSize = fvg.high - fvg.low;
      if (fvg.type === 'bullish') {
        if (curr.low <= fvg.high) {
          const fillAmount = Math.min(fvg.high - curr.low, gapSize);
          fvg.fillPercent = Math.min(100, (fillAmount / gapSize) * 100);
          if (curr.low <= fvg.low) fvg.filled = true;
        }
      } else {
        if (curr.high >= fvg.low) {
          const fillAmount = Math.min(curr.high - fvg.low, gapSize);
          fvg.fillPercent = Math.min(100, (fillAmount / gapSize) * 100);
          if (curr.high >= fvg.high) fvg.filled = true;
        }
      }
    }
  }
  
  private calculateMetrics(symbol: string): FVGMetrics {
    const candleList = this.candles.get(symbol)!, fvgList = this.fvgs.get(symbol) || [];
    const activeFVGs = fvgList.filter(f => !f.filled);
    const currentPrice = candleList.length > 0 ? candleList[candleList.length - 1].close : 0;
    const bullishFVGs = activeFVGs.filter(f => f.type === 'bullish' && f.high < currentPrice).sort((a, b) => b.high - a.high);
    const bearishFVGs = activeFVGs.filter(f => f.type === 'bearish' && f.low > currentPrice).sort((a, b) => a.low - b.low);
    return { symbol, timestamp: Date.now(), fvgs: activeFVGs, nearestBullish: bullishFVGs[0] || null, nearestBearish: bearishFVGs[0] || null };
  }
  
  getFVGs(symbol: string): FairValueGap[] | null { return this.fvgs.get(symbol) || null; }
  getMetrics(symbol: string): FVGMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void { if (symbol) { this.candles.delete(symbol); this.fvgs.delete(symbol); this.lastMetrics.delete(symbol); } else { this.candles.clear(); this.fvgs.clear(); this.lastMetrics.clear(); } }
}

let instance: FairValueGapDetector | null = null;
export function getFairValueGapDetector(config?: Partial<FVGConfig>): FairValueGapDetector { if (!instance) instance = new FairValueGapDetector(config); return instance; }
export function resetFairValueGapDetector(): void { instance = null; }
