/**
 * PairTradingEngine - Correlation-based pair trading strategies
 */
import { EventEmitter } from 'events';
import { getActiveClock } from '../../_core/clock';

export interface TradingPair { id: string; symbol1: string; symbol2: string; correlation: number; cointegration: number; spread: number; spreadMean: number; spreadStd: number; zScore: number; hedgeRatio: number; lastUpdate: number; }
export interface PairSignal { pairId: string; type: 'entry' | 'exit'; direction: 'long_spread' | 'short_spread'; strength: number; zScore: number; }
export interface PairTradingConfig { windowSize: number; entryZScore: number; exitZScore: number; minCorrelation: number; minCointegration: number; }

export class PairTradingEngine extends EventEmitter {
  private config: PairTradingConfig;
  private pairs: Map<string, TradingPair> = new Map();
  private prices: Map<string, number[]> = new Map();
  private isRunning = false;
  
  constructor(config?: Partial<PairTradingConfig>) { super(); this.config = { windowSize: 50, entryZScore: 2.0, exitZScore: 0.5, minCorrelation: 0.7, minCointegration: 50, ...config }; }
  
  start(): void { this.isRunning = true; }
  stop(): void { this.isRunning = false; }
  
  registerPair(symbol1: string, symbol2: string): string {
    const id = `${symbol1}_${symbol2}`;
    if (!this.pairs.has(id)) this.pairs.set(id, { id, symbol1, symbol2, correlation: 0, cointegration: 0, spread: 0, spreadMean: 0, spreadStd: 0, zScore: 0, hedgeRatio: 1, lastUpdate: getActiveClock().now() });
    return id;
  }
  
  processPrice(data: { symbol: string; timestamp: number; price: number }): void {
    if (!this.isRunning) return;
    const priceList = this.prices.get(data.symbol) || [];
    priceList.push(data.price);
    if (priceList.length > this.config.windowSize * 2) priceList.shift();
    this.prices.set(data.symbol, priceList);
    for (const pair of this.pairs.values()) {
      if (pair.symbol1 === data.symbol || pair.symbol2 === data.symbol) this.updatePair(pair.id);
    }
  }
  
  private updatePair(pairId: string): void {
    const pair = this.pairs.get(pairId);
    if (!pair) return;
    const prices1 = this.prices.get(pair.symbol1) || [], prices2 = this.prices.get(pair.symbol2) || [];
    const minLen = Math.min(prices1.length, prices2.length, this.config.windowSize);
    if (minLen < 10) return;
    const p1 = prices1.slice(-minLen), p2 = prices2.slice(-minLen);
    const mean1 = p1.reduce((a, b) => a + b, 0) / minLen, mean2 = p2.reduce((a, b) => a + b, 0) / minLen;
    let cov = 0, var1 = 0, var2 = 0;
    for (let i = 0; i < minLen; i++) { const d1 = p1[i] - mean1, d2 = p2[i] - mean2; cov += d1 * d2; var1 += d1 * d1; var2 += d2 * d2; }
    pair.correlation = var1 > 0 && var2 > 0 ? cov / Math.sqrt(var1 * var2) : 0;
    pair.hedgeRatio = var1 > 0 ? cov / var1 : 1;
    const spreads = p1.map((v, i) => v - pair.hedgeRatio * p2[i]);
    pair.spread = spreads[spreads.length - 1];
    pair.spreadMean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    pair.spreadStd = Math.sqrt(spreads.reduce((sum, s) => sum + Math.pow(s - pair.spreadMean, 2), 0) / spreads.length);
    pair.zScore = pair.spreadStd > 0 ? (pair.spread - pair.spreadMean) / pair.spreadStd : 0;
    pair.cointegration = Math.abs(pair.correlation) * 100;
    pair.lastUpdate = getActiveClock().now();
    if (Math.abs(pair.correlation) >= this.config.minCorrelation && pair.cointegration >= this.config.minCointegration) {
      if (Math.abs(pair.zScore) >= this.config.entryZScore) this.emit('entrySignal', { pairId, type: 'entry', direction: pair.zScore > 0 ? 'short_spread' : 'long_spread', strength: Math.min(100, Math.abs(pair.zScore) * 30), zScore: pair.zScore });
      else if (Math.abs(pair.zScore) <= this.config.exitZScore) this.emit('exitSignal', { pairId, type: 'exit', direction: pair.zScore > 0 ? 'short_spread' : 'long_spread', strength: 50, zScore: pair.zScore });
    }
  }
  
  getPair(pairId: string): TradingPair | undefined { return this.pairs.get(pairId); }
  getAllPairs(): TradingPair[] { return Array.from(this.pairs.values()); }
  getMetrics(): { pairs: TradingPair[]; activePairs: number } { const pairs = this.getAllPairs(); return { pairs, activePairs: pairs.filter(p => Math.abs(p.correlation) >= this.config.minCorrelation).length }; }
}

let instance: PairTradingEngine | null = null;
export function getPairTradingEngine(config?: Partial<PairTradingConfig>): PairTradingEngine { if (!instance) instance = new PairTradingEngine(config); return instance; }
export function resetPairTradingEngine(): void { if (instance) instance.stop(); instance = null; }
