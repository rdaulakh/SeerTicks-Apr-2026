/**
 * LiquidityGrabDetector - Identifies false breakouts and liquidity sweeps
 */

import { EventEmitter } from 'events';

export interface LiquidityPool { price: number; type: 'high' | 'low'; timestamp: number; strength: number; tested: boolean; grabbed: boolean; }
export interface LiquidityGrabMetrics { symbol: string; timestamp: number; pools: LiquidityPool[]; activeGrab: { type: 'bullish' | 'bearish'; price: number; strength: number } | null; recentGrabs: number; }
export interface LiquidityGrabConfig { lookbackPeriod: number; grabThresholdPercent: number; minPoolStrength: number; }

interface CandleData { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

export class LiquidityGrabDetector extends EventEmitter {
  private config: LiquidityGrabConfig;
  private candles: Map<string, CandleData[]> = new Map();
  private pools: Map<string, LiquidityPool[]> = new Map();
  private lastMetrics: Map<string, LiquidityGrabMetrics> = new Map();
  
  constructor(config?: Partial<LiquidityGrabConfig>) {
    super();
    this.config = { lookbackPeriod: 20, grabThresholdPercent: 0.5, minPoolStrength: 2, ...config };
  }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): LiquidityGrabMetrics {
    const candleList = this.getOrCreateCandles(candle.symbol);
    candleList.push(candle);
    if (candleList.length > 100) candleList.shift();
    this.updatePools(candle.symbol);
    this.detectGrabs(candle.symbol);
    const metrics = this.calculateMetrics(candle.symbol);
    this.lastMetrics.set(candle.symbol, metrics);
    return metrics;
  }
  
  private getOrCreateCandles(symbol: string): CandleData[] {
    if (!this.candles.has(symbol)) this.candles.set(symbol, []);
    return this.candles.get(symbol)!;
  }
  
  private updatePools(symbol: string): void {
    const candleList = this.candles.get(symbol)!;
    if (candleList.length < 5) return;
    if (!this.pools.has(symbol)) this.pools.set(symbol, []);
    const poolList = this.pools.get(symbol)!;
    
    for (let i = 2; i < candleList.length - 2; i++) {
      const curr = candleList[i], prev1 = candleList[i - 1], prev2 = candleList[i - 2], next1 = candleList[i + 1], next2 = candleList[i + 2];
      if (curr.high > prev1.high && curr.high > prev2.high && curr.high > next1.high && curr.high > next2.high) {
        const existing = poolList.find(p => Math.abs(p.price - curr.high) / curr.high < 0.001);
        if (!existing) poolList.push({ price: curr.high, type: 'high', timestamp: curr.timestamp, strength: 1, tested: false, grabbed: false });
        else existing.strength++;
      }
      if (curr.low < prev1.low && curr.low < prev2.low && curr.low < next1.low && curr.low < next2.low) {
        const existing = poolList.find(p => Math.abs(p.price - curr.low) / curr.low < 0.001);
        if (!existing) poolList.push({ price: curr.low, type: 'low', timestamp: curr.timestamp, strength: 1, tested: false, grabbed: false });
        else existing.strength++;
      }
    }
    const cutoff = Date.now() - this.config.lookbackPeriod * 60000;
    this.pools.set(symbol, poolList.filter(p => p.timestamp > cutoff || p.strength >= this.config.minPoolStrength));
  }
  
  private detectGrabs(symbol: string): void {
    const candleList = this.candles.get(symbol)!, poolList = this.pools.get(symbol) || [];
    if (candleList.length < 2) return;
    const curr = candleList[candleList.length - 1];
    for (const pool of poolList) {
      if (pool.grabbed) continue;
      const threshold = pool.price * (this.config.grabThresholdPercent / 100);
      if (pool.type === 'low' && curr.low < pool.price - threshold && curr.close > pool.price) {
        pool.grabbed = true;
        this.emit('liquidityGrab', { symbol, type: 'bullish', pool, candle: curr });
      }
      if (pool.type === 'high' && curr.high > pool.price + threshold && curr.close < pool.price) {
        pool.grabbed = true;
        this.emit('liquidityGrab', { symbol, type: 'bearish', pool, candle: curr });
      }
    }
  }
  
  private calculateMetrics(symbol: string): LiquidityGrabMetrics {
    const poolList = this.pools.get(symbol) || [];
    const activeGrab = poolList.find(p => p.grabbed && Date.now() - p.timestamp < 300000);
    return { symbol, timestamp: Date.now(), pools: poolList.filter(p => !p.grabbed), activeGrab: activeGrab ? { type: activeGrab.type === 'low' ? 'bullish' : 'bearish', price: activeGrab.price, strength: activeGrab.strength * 20 } : null, recentGrabs: poolList.filter(p => p.grabbed).length };
  }
  
  getMetrics(symbol: string): LiquidityGrabMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void { if (symbol) { this.candles.delete(symbol); this.pools.delete(symbol); this.lastMetrics.delete(symbol); } else { this.candles.clear(); this.pools.clear(); this.lastMetrics.clear(); } }
}

let instance: LiquidityGrabDetector | null = null;
export function getLiquidityGrabDetector(config?: Partial<LiquidityGrabConfig>): LiquidityGrabDetector { if (!instance) instance = new LiquidityGrabDetector(config); return instance; }
export function resetLiquidityGrabDetector(): void { instance = null; }
