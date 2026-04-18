/**
 * OrderBlockIdentifier - Identifies institutional entry zones
 */
import { EventEmitter } from 'events';

export interface OrderBlock { price: number; high: number; low: number; type: 'bullish' | 'bearish'; timestamp: number; strength: number; status: 'fresh' | 'tested' | 'broken'; }
export interface OrderBlockMetrics { symbol: string; timestamp: number; blocks: OrderBlock[]; nearestBullish: OrderBlock | null; nearestBearish: OrderBlock | null; }
export interface OrderBlockConfig { minImpulsePercent: number; maxBlockAge: number; }
interface CandleData { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

export class OrderBlockIdentifier extends EventEmitter {
  private config: OrderBlockConfig;
  private candles: Map<string, CandleData[]> = new Map();
  private blocks: Map<string, OrderBlock[]> = new Map();
  private lastMetrics: Map<string, OrderBlockMetrics> = new Map();
  
  constructor(config?: Partial<OrderBlockConfig>) { super(); this.config = { minImpulsePercent: 1.0, maxBlockAge: 50, ...config }; }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): OrderBlockMetrics {
    const candleList = this.getOrCreateCandles(candle.symbol);
    candleList.push(candle);
    if (candleList.length > 100) candleList.shift();
    this.detectOrderBlocks(candle.symbol);
    this.updateBlockStatus(candle.symbol);
    const metrics = this.calculateMetrics(candle.symbol);
    this.lastMetrics.set(candle.symbol, metrics);
    return metrics;
  }
  
  private getOrCreateCandles(symbol: string): CandleData[] { if (!this.candles.has(symbol)) this.candles.set(symbol, []); return this.candles.get(symbol)!; }
  
  private detectOrderBlocks(symbol: string): void {
    const candleList = this.candles.get(symbol)!;
    if (candleList.length < 4) return;
    if (!this.blocks.has(symbol)) this.blocks.set(symbol, []);
    const blockList = this.blocks.get(symbol)!;
    const curr = candleList[candleList.length - 1], prev = candleList[candleList.length - 2];
    const currMove = ((curr.close - curr.open) / curr.open) * 100, prevMove = ((prev.close - prev.open) / prev.open) * 100;
    if (prevMove < 0 && currMove > this.config.minImpulsePercent) {
      if (!blockList.find(b => b.type === 'bullish' && Math.abs(b.price - prev.low) / prev.low < 0.005)) {
        blockList.push({ price: prev.low, high: prev.high, low: prev.low, type: 'bullish', timestamp: prev.timestamp, strength: Math.abs(currMove), status: 'fresh' });
      }
    }
    if (prevMove > 0 && currMove < -this.config.minImpulsePercent) {
      if (!blockList.find(b => b.type === 'bearish' && Math.abs(b.price - prev.high) / prev.high < 0.005)) {
        blockList.push({ price: prev.high, high: prev.high, low: prev.low, type: 'bearish', timestamp: prev.timestamp, strength: Math.abs(currMove), status: 'fresh' });
      }
    }
    this.blocks.set(symbol, blockList.slice(-this.config.maxBlockAge));
  }
  
  private updateBlockStatus(symbol: string): void {
    const candleList = this.candles.get(symbol)!, blockList = this.blocks.get(symbol) || [];
    if (candleList.length < 1) return;
    const curr = candleList[candleList.length - 1];
    for (const block of blockList) {
      if (block.status === 'broken') continue;
      if (block.type === 'bullish') { if (curr.low <= block.high && curr.low >= block.low) block.status = 'tested'; if (curr.close < block.low) block.status = 'broken'; }
      else { if (curr.high >= block.low && curr.high <= block.high) block.status = 'tested'; if (curr.close > block.high) block.status = 'broken'; }
    }
  }
  
  private calculateMetrics(symbol: string): OrderBlockMetrics {
    const candleList = this.candles.get(symbol)!, blockList = this.blocks.get(symbol) || [];
    const activeBlocks = blockList.filter(b => b.status !== 'broken');
    const currentPrice = candleList.length > 0 ? candleList[candleList.length - 1].close : 0;
    const bullishBlocks = activeBlocks.filter(b => b.type === 'bullish' && b.price < currentPrice).sort((a, b) => b.price - a.price);
    const bearishBlocks = activeBlocks.filter(b => b.type === 'bearish' && b.price > currentPrice).sort((a, b) => a.price - b.price);
    return { symbol, timestamp: Date.now(), blocks: activeBlocks, nearestBullish: bullishBlocks[0] || null, nearestBearish: bearishBlocks[0] || null };
  }
  
  getMetrics(symbol: string): OrderBlockMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void { if (symbol) { this.candles.delete(symbol); this.blocks.delete(symbol); this.lastMetrics.delete(symbol); } else { this.candles.clear(); this.blocks.clear(); this.lastMetrics.clear(); } }
}

let instance: OrderBlockIdentifier | null = null;
export function getOrderBlockIdentifier(config?: Partial<OrderBlockConfig>): OrderBlockIdentifier { if (!instance) instance = new OrderBlockIdentifier(config); return instance; }
export function resetOrderBlockIdentifier(): void { instance = null; }
