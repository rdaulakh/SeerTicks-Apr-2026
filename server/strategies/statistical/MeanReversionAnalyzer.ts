/**
 * MeanReversionAnalyzer - Z-score based mean reversion analysis
 */
import { EventEmitter } from 'events';
import { getActiveClock } from '../../_core/clock';

export interface MeanReversionMetrics { symbol: string; timestamp: number; zScore: number; zScore20: number; zScore50: number; bollingerUpper: number; bollingerMiddle: number; bollingerLower: number; percentB: number; rsi: number; regime: 'trending' | 'mean_reverting' | 'volatile'; signal: 'oversold' | 'overbought' | 'neutral'; strength: number; }
export interface MeanReversionConfig { shortPeriod: number; longPeriod: number; bollingerPeriod: number; bollingerStd: number; rsiPeriod: number; entryZScore: number; rsiOversold: number; rsiOverbought: number; }

export class MeanReversionAnalyzer extends EventEmitter {
  private config: MeanReversionConfig;
  private prices: Map<string, number[]> = new Map();
  private lastMetrics: Map<string, MeanReversionMetrics> = new Map();
  
  constructor(config?: Partial<MeanReversionConfig>) { super(); this.config = { shortPeriod: 20, longPeriod: 50, bollingerPeriod: 20, bollingerStd: 2, rsiPeriod: 14, entryZScore: 2.0, rsiOversold: 30, rsiOverbought: 70, ...config }; }
  
  processPrice(data: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): MeanReversionMetrics {
    const priceList = this.prices.get(data.symbol) || [];
    priceList.push(data.close);
    if (priceList.length > 200) priceList.shift();
    this.prices.set(data.symbol, priceList);
    const metrics = this.calculateMetrics(data.symbol);
    this.lastMetrics.set(data.symbol, metrics);
    return metrics;
  }
  
  private calculateMetrics(symbol: string): MeanReversionMetrics {
    const prices = this.prices.get(symbol) || [];
    const now = getActiveClock().now();
    if (prices.length < this.config.shortPeriod) {
      return { symbol, timestamp: now, zScore: 0, zScore20: 0, zScore50: 0, bollingerUpper: 0, bollingerMiddle: 0, bollingerLower: 0, percentB: 0.5, rsi: 50, regime: 'mean_reverting', signal: 'neutral', strength: 0 };
    }
    
    const current = prices[prices.length - 1];
    
    // Z-scores
    const calcZScore = (period: number) => {
      const slice = prices.slice(-period);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const std = Math.sqrt(slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / slice.length);
      return std > 0 ? (current - mean) / std : 0;
    };
    const zScore20 = calcZScore(Math.min(20, prices.length));
    const zScore50 = prices.length >= 50 ? calcZScore(50) : zScore20;
    const zScore = zScore20;
    
    // Bollinger Bands
    const bbSlice = prices.slice(-this.config.bollingerPeriod);
    const bbMean = bbSlice.reduce((a, b) => a + b, 0) / bbSlice.length;
    const bbStd = Math.sqrt(bbSlice.reduce((sum, p) => sum + Math.pow(p - bbMean, 2), 0) / bbSlice.length);
    const bollingerUpper = bbMean + this.config.bollingerStd * bbStd;
    const bollingerLower = bbMean - this.config.bollingerStd * bbStd;
    const percentB = bollingerUpper !== bollingerLower ? (current - bollingerLower) / (bollingerUpper - bollingerLower) : 0.5;
    
    // RSI
    let rsi = 50;
    if (prices.length >= this.config.rsiPeriod + 1) {
      let gains = 0, losses = 0;
      for (let i = prices.length - this.config.rsiPeriod; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / this.config.rsiPeriod, avgLoss = losses / this.config.rsiPeriod;
      rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    
    // Regime detection
    const volatility = bbStd / bbMean * 100;
    let regime: 'trending' | 'mean_reverting' | 'volatile' = 'mean_reverting';
    if (volatility > 5) regime = 'volatile';
    else if (Math.abs(zScore50) > 1.5) regime = 'trending';
    
    // Signal
    let signal: 'oversold' | 'overbought' | 'neutral' = 'neutral';
    let strength = 0;
    if (zScore < -this.config.entryZScore || rsi < this.config.rsiOversold) { signal = 'oversold'; strength = Math.min(100, Math.abs(zScore) * 30 + (this.config.rsiOversold - rsi)); }
    else if (zScore > this.config.entryZScore || rsi > this.config.rsiOverbought) { signal = 'overbought'; strength = Math.min(100, Math.abs(zScore) * 30 + (rsi - this.config.rsiOverbought)); }
    
    return { symbol, timestamp: now, zScore, zScore20, zScore50, bollingerUpper, bollingerMiddle: bbMean, bollingerLower, percentB, rsi, regime, signal, strength };
  }
  
  getMetrics(symbol: string): MeanReversionMetrics | null { return this.lastMetrics.get(symbol) || null; }
  reset(symbol?: string): void { if (symbol) { this.prices.delete(symbol); this.lastMetrics.delete(symbol); } else { this.prices.clear(); this.lastMetrics.clear(); } }
}

let instance: MeanReversionAnalyzer | null = null;
export function getMeanReversionAnalyzer(config?: Partial<MeanReversionConfig>): MeanReversionAnalyzer { if (!instance) instance = new MeanReversionAnalyzer(config); return instance; }
export function resetMeanReversionAnalyzer(): void { instance = null; }
