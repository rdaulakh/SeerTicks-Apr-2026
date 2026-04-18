/**
 * BreakOfStructure - Market structure analysis (BOS, CHoCH, MSS)
 */
import { EventEmitter } from 'events';

export interface SwingPoint { price: number; type: 'high' | 'low'; timestamp: number; broken: boolean; }
export interface StructureMetrics { symbol: string; timestamp: number; trend: 'bullish' | 'bearish' | 'ranging'; lastBOS: { type: 'bullish' | 'bearish'; price: number; timestamp: number } | null; lastCHoCH: { type: 'bullish' | 'bearish'; price: number; timestamp: number } | null; swingHighs: SwingPoint[]; swingLows: SwingPoint[]; }
export interface BOSConfig { swingLookback: number; confirmationCandles: number; }
interface CandleData { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

export class BreakOfStructure extends EventEmitter {
  private config: BOSConfig;
  private candles: Map<string, CandleData[]> = new Map();
  private swingHighs: Map<string, SwingPoint[]> = new Map();
  private swingLows: Map<string, SwingPoint[]> = new Map();
  private lastMetrics: Map<string, StructureMetrics> = new Map();
  private trends: Map<string, 'bullish' | 'bearish' | 'ranging'> = new Map();
  private lastBOS: Map<string, { type: 'bullish' | 'bearish'; price: number; timestamp: number }> = new Map();
  private lastCHoCH: Map<string, { type: 'bullish' | 'bearish'; price: number; timestamp: number }> = new Map();
  
  constructor(config?: Partial<BOSConfig>) { super(); this.config = { swingLookback: 5, confirmationCandles: 1, ...config }; }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): StructureMetrics {
    const candleList = this.getOrCreateCandles(candle.symbol);
    candleList.push(candle);
    if (candleList.length > 200) candleList.shift();
    this.updateSwingPoints(candle.symbol);
    this.detectStructureBreaks(candle.symbol);
    const metrics = this.calculateMetrics(candle.symbol);
    this.lastMetrics.set(candle.symbol, metrics);
    return metrics;
  }
  
  private getOrCreateCandles(symbol: string): CandleData[] { if (!this.candles.has(symbol)) this.candles.set(symbol, []); return this.candles.get(symbol)!; }
  
  private updateSwingPoints(symbol: string): void {
    const candleList = this.candles.get(symbol)!;
    const lb = this.config.swingLookback;
    if (candleList.length < lb * 2 + 1) return;
    if (!this.swingHighs.has(symbol)) this.swingHighs.set(symbol, []);
    if (!this.swingLows.has(symbol)) this.swingLows.set(symbol, []);
    
    const highs = this.swingHighs.get(symbol)!, lows = this.swingLows.get(symbol)!;
    const idx = candleList.length - lb - 1;
    const curr = candleList[idx];
    
    let isSwingHigh = true, isSwingLow = true;
    for (let i = idx - lb; i <= idx + lb; i++) {
      if (i === idx || i < 0 || i >= candleList.length) continue;
      if (candleList[i].high >= curr.high) isSwingHigh = false;
      if (candleList[i].low <= curr.low) isSwingLow = false;
    }
    
    if (isSwingHigh && !highs.find(h => h.timestamp === curr.timestamp)) {
      highs.push({ price: curr.high, type: 'high', timestamp: curr.timestamp, broken: false });
    }
    if (isSwingLow && !lows.find(l => l.timestamp === curr.timestamp)) {
      lows.push({ price: curr.low, type: 'low', timestamp: curr.timestamp, broken: false });
    }
    
    // Keep recent swing points
    this.swingHighs.set(symbol, highs.slice(-20));
    this.swingLows.set(symbol, lows.slice(-20));
  }
  
  private detectStructureBreaks(symbol: string): void {
    const candleList = this.candles.get(symbol)!;
    const highs = this.swingHighs.get(symbol) || [], lows = this.swingLows.get(symbol) || [];
    if (candleList.length < 2 || highs.length < 2 || lows.length < 2) return;
    
    const curr = candleList[candleList.length - 1];
    const currentTrend = this.trends.get(symbol) || 'ranging';
    
    // Check for break of swing high (bullish BOS or CHoCH)
    const recentHigh = highs.filter(h => !h.broken).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (recentHigh && curr.close > recentHigh.price) {
      recentHigh.broken = true;
      if (currentTrend === 'bearish') {
        this.lastCHoCH.set(symbol, { type: 'bullish', price: recentHigh.price, timestamp: curr.timestamp });
        console.log(`[BreakOfStructure] Potential bullish CHOCH on ${symbol} at ${recentHigh.price}`);
        this.emit('choch', { symbol, type: 'bullish', price: recentHigh.price });
      } else {
        this.lastBOS.set(symbol, { type: 'bullish', price: recentHigh.price, timestamp: curr.timestamp });
        this.emit('bos', { symbol, type: 'bullish', price: recentHigh.price });
      }
      this.trends.set(symbol, 'bullish');
    }
    
    // Check for break of swing low (bearish BOS or CHoCH)
    const recentLow = lows.filter(l => !l.broken).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (recentLow && curr.close < recentLow.price) {
      recentLow.broken = true;
      if (currentTrend === 'bullish') {
        this.lastCHoCH.set(symbol, { type: 'bearish', price: recentLow.price, timestamp: curr.timestamp });
        console.log(`[BreakOfStructure] Potential bearish CHOCH on ${symbol} at ${recentLow.price}`);
        this.emit('choch', { symbol, type: 'bearish', price: recentLow.price });
      } else {
        this.lastBOS.set(symbol, { type: 'bearish', price: recentLow.price, timestamp: curr.timestamp });
        this.emit('bos', { symbol, type: 'bearish', price: recentLow.price });
      }
      this.trends.set(symbol, 'bearish');
    }
  }
  
  private calculateMetrics(symbol: string): StructureMetrics {
    return { symbol, timestamp: Date.now(), trend: this.trends.get(symbol) || 'ranging', lastBOS: this.lastBOS.get(symbol) || null, lastCHoCH: this.lastCHoCH.get(symbol) || null, swingHighs: this.swingHighs.get(symbol) || [], swingLows: this.swingLows.get(symbol) || [] };
  }
  
  getSwingPoints(symbol: string): { highs: SwingPoint[]; lows: SwingPoint[] } { return { highs: this.swingHighs.get(symbol) || [], lows: this.swingLows.get(symbol) || [] }; }
  getStructure(symbol: string): StructureMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void { if (symbol) { this.candles.delete(symbol); this.swingHighs.delete(symbol); this.swingLows.delete(symbol); this.lastMetrics.delete(symbol); this.trends.delete(symbol); this.lastBOS.delete(symbol); this.lastCHoCH.delete(symbol); } else { this.candles.clear(); this.swingHighs.clear(); this.swingLows.clear(); this.lastMetrics.clear(); this.trends.clear(); this.lastBOS.clear(); this.lastCHoCH.clear(); } }
}

let instance: BreakOfStructure | null = null;
export function getBreakOfStructure(config?: Partial<BOSConfig>): BreakOfStructure { if (!instance) instance = new BreakOfStructure(config); return instance; }
export function resetBreakOfStructure(): void { instance = null; }
