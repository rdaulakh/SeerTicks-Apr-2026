/**
 * TapeReader - Real-time Trade Flow Analysis
 * Analyzes the tape (time & sales) to identify large trades, buy/sell pressure, and momentum
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../../_core/clock';

export interface Trade {
  symbol: string;
  timestamp: number;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  tradeId?: string;
}

export interface TapeMetrics {
  symbol: string;
  timestamp: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  buySellRatio: number;
  avgTradeSize: number;
  largeTradeCount: number;
  tradeVelocity: number;
  vwap: number;
  momentum: number;
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface TapeReaderConfig {
  windowSize: number;
  largeTradeThreshold: number;
  velocityWindow: number;
  momentumPeriod: number;
}

interface TradeWindow {
  trades: Trade[];
  buyVolume: number;
  sellVolume: number;
  totalValue: number;
  totalQuantity: number;
  largeTradeCount: number;
}

export class TapeReader extends EventEmitter {
  private config: TapeReaderConfig;
  private tradeWindows: Map<string, TradeWindow> = new Map();
  private lastMetrics: Map<string, TapeMetrics> = new Map();
  
  constructor(config?: Partial<TapeReaderConfig>) {
    super();
    this.config = {
      windowSize: 60000,
      largeTradeThreshold: 1.0,
      velocityWindow: 5000,
      momentumPeriod: 20,
      ...config,
    };
  }
  
  processTrade(trade: Trade): TapeMetrics | null {
    const window = this.getOrCreateWindow(trade.symbol);
    window.trades.push(trade);
    
    if (trade.side === 'buy') {
      window.buyVolume += trade.quantity;
    } else {
      window.sellVolume += trade.quantity;
    }
    
    window.totalValue += trade.price * trade.quantity;
    window.totalQuantity += trade.quantity;
    
    if (trade.quantity >= this.config.largeTradeThreshold) {
      window.largeTradeCount++;
      this.emit('largeTrade', trade);
    }
    
    this.cleanOldTrades(trade.symbol);
    const metrics = this.calculateMetrics(trade.symbol);
    this.lastMetrics.set(trade.symbol, metrics);
    this.emit('metrics', metrics);
    return metrics;
  }
  
  private getOrCreateWindow(symbol: string): TradeWindow {
    if (!this.tradeWindows.has(symbol)) {
      this.tradeWindows.set(symbol, {
        trades: [],
        buyVolume: 0,
        sellVolume: 0,
        totalValue: 0,
        totalQuantity: 0,
        largeTradeCount: 0,
      });
    }
    return this.tradeWindows.get(symbol)!;
  }
  
  private cleanOldTrades(symbol: string): void {
    const window = this.tradeWindows.get(symbol);
    if (!window) return;
    
    const cutoff = getActiveClock().now() - this.config.windowSize;
    const oldTrades = window.trades.filter(t => t.timestamp < cutoff);
    
    for (const trade of oldTrades) {
      if (trade.side === 'buy') {
        window.buyVolume -= trade.quantity;
      } else {
        window.sellVolume -= trade.quantity;
      }
      window.totalValue -= trade.price * trade.quantity;
      window.totalQuantity -= trade.quantity;
      if (trade.quantity >= this.config.largeTradeThreshold) {
        window.largeTradeCount--;
      }
    }
    
    window.trades = window.trades.filter(t => t.timestamp >= cutoff);
  }
  
  private calculateMetrics(symbol: string): TapeMetrics {
    const window = this.tradeWindows.get(symbol)!;
    const now = getActiveClock().now();
    
    const vwap = window.totalQuantity > 0 ? window.totalValue / window.totalQuantity : 0;
    const buySellRatio = window.sellVolume > 0 ? window.buyVolume / window.sellVolume : window.buyVolume > 0 ? Infinity : 1;
    
    const velocityCutoff = now - this.config.velocityWindow;
    const recentTrades = window.trades.filter(t => t.timestamp >= velocityCutoff);
    const tradeVelocity = recentTrades.length / (this.config.velocityWindow / 1000);
    
    const avgTradeSize = window.trades.length > 0 ? window.totalQuantity / window.trades.length : 0;
    
    let momentum = 0;
    if (window.buyVolume + window.sellVolume > 0) {
      momentum = ((window.buyVolume - window.sellVolume) / (window.buyVolume + window.sellVolume)) * 100;
    }
    
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (momentum > 20) direction = 'bullish';
    else if (momentum < -20) direction = 'bearish';
    
    return {
      symbol, timestamp: now, buyVolume: window.buyVolume, sellVolume: window.sellVolume,
      totalVolume: window.buyVolume + window.sellVolume, buySellRatio, avgTradeSize,
      largeTradeCount: window.largeTradeCount, tradeVelocity, vwap, momentum, direction,
    };
  }
  
  getMetrics(symbol: string): TapeMetrics | null {
    return this.lastMetrics.get(symbol) || null;
  }
  
  reset(symbol?: string): void {
    if (symbol) {
      this.tradeWindows.delete(symbol);
      this.lastMetrics.delete(symbol);
    } else {
      this.tradeWindows.clear();
      this.lastMetrics.clear();
    }
  }
}

let instance: TapeReader | null = null;
export function getTapeReader(config?: Partial<TapeReaderConfig>): TapeReader {
  if (!instance) instance = new TapeReader(config);
  return instance;
}
export function resetTapeReader(): void { instance = null; }
