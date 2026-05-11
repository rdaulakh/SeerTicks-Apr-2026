/**
 * MarketMicrostructureAnalyzer - Bid/Ask Spread Analysis for Execution Timing
 * 
 * Market microstructure signals provide insights into:
 * 1. Bid/Ask Spread - Liquidity indicator and transaction cost
 * 2. Spread Anomalies - Unusual spread widening/narrowing
 * 3. Order Book Imbalance - Buy/sell pressure from order book depth
 * 4. Execution Timing - Optimal entry/exit based on spread conditions
 * 
 * This completes Phase 2.2 of the A++ implementation roadmap.
 */

import { EventEmitter } from "events";
import { getActiveClock } from '../_core/clock';
import type { ExchangeInterface } from "../exchanges/ExchangeInterface";

export interface SpreadData {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
  spreadPercent: number;
  midPrice: number;
  bidSize: number;
  askSize: number;
  imbalance: number; // -1 to +1 (negative = sell pressure, positive = buy pressure)
}

export interface SpreadSignal {
  symbol: string;
  timestamp: number;
  signal: 'favorable' | 'unfavorable' | 'neutral';
  confidence: number; // 0-1
  spreadCondition: 'tight' | 'normal' | 'wide' | 'extreme';
  imbalanceDirection: 'buy_pressure' | 'sell_pressure' | 'balanced';
  executionRecommendation: 'immediate' | 'wait' | 'limit_order' | 'avoid';
  reasoning: string;
  metrics: {
    currentSpread: number;
    currentSpreadPercent: number;
    avgSpread: number;
    avgSpreadPercent: number;
    spreadZScore: number;
    imbalance: number;
    volatility: number;
  };
}

export interface MicrostructureConfig {
  // Spread thresholds (in percentage)
  tightSpreadThreshold: number;    // Below this = tight spread (good for market orders)
  wideSpreadThreshold: number;     // Above this = wide spread (use limit orders)
  extremeSpreadThreshold: number;  // Above this = avoid trading
  
  // Imbalance thresholds
  significantImbalance: number;    // Above this = significant buy/sell pressure
  
  // Analysis window
  lookbackPeriod: number;          // Number of data points for averaging
  anomalyZScoreThreshold: number;  // Z-score threshold for spread anomaly
  
  // Update frequency
  updateIntervalMs: number;        // How often to update spread data
}

const DEFAULT_CONFIG: MicrostructureConfig = {
  tightSpreadThreshold: 0.05,      // 0.05% = tight spread
  wideSpreadThreshold: 0.15,       // 0.15% = wide spread
  extremeSpreadThreshold: 0.50,    // 0.50% = extreme spread
  significantImbalance: 0.3,       // 30% imbalance is significant
  lookbackPeriod: 100,             // Last 100 data points
  anomalyZScoreThreshold: 2.0,     // 2 standard deviations
  updateIntervalMs: 1000,          // Update every second
};

export class MarketMicrostructureAnalyzer extends EventEmitter {
  private config: MicrostructureConfig;
  private spreadHistory: Map<string, SpreadData[]> = new Map();
  private exchange: ExchangeInterface | null = null;
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  
  constructor(config?: Partial<MicrostructureConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Set exchange adapter for market data
   */
  setExchange(exchange: ExchangeInterface): void {
    this.exchange = exchange;
  }
  
  /**
   * Start monitoring spread for a symbol
   */
  async startMonitoring(symbol: string): Promise<void> {
    if (this.updateIntervals.has(symbol)) {
      console.log(`[MicrostructureAnalyzer] Already monitoring ${symbol}`);
      return;
    }
    
    console.log(`[MicrostructureAnalyzer] Starting spread monitoring for ${symbol}`);
    
    // Initialize history
    if (!this.spreadHistory.has(symbol)) {
      this.spreadHistory.set(symbol, []);
    }
    
    // Start periodic updates
    const interval = setInterval(async () => {
      try {
        await this.updateSpreadData(symbol);
      } catch (error) {
        console.error(`[MicrostructureAnalyzer] Error updating spread for ${symbol}:`, error);
      }
    }, this.config.updateIntervalMs);
    
    this.updateIntervals.set(symbol, interval);
    this.isRunning = true;
    
    // Initial update
    await this.updateSpreadData(symbol);
  }
  
  /**
   * Stop monitoring spread for a symbol
   */
  stopMonitoring(symbol: string): void {
    const interval = this.updateIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(symbol);
      console.log(`[MicrostructureAnalyzer] Stopped monitoring ${symbol}`);
    }
  }
  
  /**
   * Stop all monitoring
   */
  stopAll(): void {
    for (const [symbol, interval] of this.updateIntervals.entries()) {
      clearInterval(interval);
      console.log(`[MicrostructureAnalyzer] Stopped monitoring ${symbol}`);
    }
    this.updateIntervals.clear();
    this.isRunning = false;
  }
  
  /**
   * Update spread data from exchange
   */
  private async updateSpreadData(symbol: string): Promise<void> {
    if (!this.exchange) {
      console.warn('[MicrostructureAnalyzer] No exchange set');
      return;
    }
    
    try {
      // Get order book data
      const orderBook = await this.exchange.getOrderBook(symbol);
      
      if (!orderBook || !orderBook.bids || !orderBook.asks || 
          orderBook.bids.length === 0 || orderBook.asks.length === 0) {
        console.warn(`[MicrostructureAnalyzer] Invalid order book data for ${symbol}`);
        return;
      }
      
      const bestBid = orderBook.bids[0];
      const bestAsk = orderBook.asks[0];
      
      const bid = bestBid.price;
      const ask = bestAsk.price;
      const bidSize = bestBid.quantity;
      const askSize = bestAsk.quantity;
      
      const spread = ask - bid;
      const midPrice = (bid + ask) / 2;
      const spreadPercent = (spread / midPrice) * 100;
      
      // Calculate order book imbalance
      // Positive = more buy pressure, Negative = more sell pressure
      const totalSize = bidSize + askSize;
      const imbalance = totalSize > 0 ? (bidSize - askSize) / totalSize : 0;
      
      const spreadData: SpreadData = {
        symbol,
        timestamp: getActiveClock().now(),
        bid,
        ask,
        spread,
        spreadPercent,
        midPrice,
        bidSize,
        askSize,
        imbalance,
      };
      
      // Add to history
      const history = this.spreadHistory.get(symbol) || [];
      history.push(spreadData);
      
      // Keep only lookback period
      if (history.length > this.config.lookbackPeriod) {
        history.shift();
      }
      
      this.spreadHistory.set(symbol, history);
      
      // Emit update event
      this.emit('spread_update', spreadData);
      
    } catch (error) {
      console.error(`[MicrostructureAnalyzer] Failed to update spread for ${symbol}:`, error);
    }
  }
  
  /**
   * Get current spread signal for a symbol
   */
  getSpreadSignal(symbol: string): SpreadSignal | null {
    const history = this.spreadHistory.get(symbol);
    
    if (!history || history.length === 0) {
      return null;
    }
    
    const current = history[history.length - 1];
    
    // Calculate statistics
    const spreads = history.map(h => h.spreadPercent);
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const stdDev = Math.sqrt(
      spreads.reduce((sum, s) => sum + Math.pow(s - avgSpread, 2), 0) / spreads.length
    );
    const spreadZScore = stdDev > 0 ? (current.spreadPercent - avgSpread) / stdDev : 0;
    
    // Calculate volatility from spread changes
    const spreadChanges: number[] = [];
    for (let i = 1; i < history.length; i++) {
      spreadChanges.push(Math.abs(history[i].spreadPercent - history[i - 1].spreadPercent));
    }
    const volatility = spreadChanges.length > 0 
      ? spreadChanges.reduce((a, b) => a + b, 0) / spreadChanges.length 
      : 0;
    
    // Determine spread condition
    let spreadCondition: SpreadSignal['spreadCondition'];
    if (current.spreadPercent <= this.config.tightSpreadThreshold) {
      spreadCondition = 'tight';
    } else if (current.spreadPercent <= this.config.wideSpreadThreshold) {
      spreadCondition = 'normal';
    } else if (current.spreadPercent <= this.config.extremeSpreadThreshold) {
      spreadCondition = 'wide';
    } else {
      spreadCondition = 'extreme';
    }
    
    // Determine imbalance direction
    let imbalanceDirection: SpreadSignal['imbalanceDirection'];
    if (Math.abs(current.imbalance) < this.config.significantImbalance) {
      imbalanceDirection = 'balanced';
    } else if (current.imbalance > 0) {
      imbalanceDirection = 'buy_pressure';
    } else {
      imbalanceDirection = 'sell_pressure';
    }
    
    // Determine execution recommendation
    let executionRecommendation: SpreadSignal['executionRecommendation'];
    let signal: SpreadSignal['signal'];
    let confidence: number;
    let reasoning: string;
    
    if (spreadCondition === 'extreme') {
      executionRecommendation = 'avoid';
      signal = 'unfavorable';
      confidence = 0.9;
      reasoning = `Extreme spread (${current.spreadPercent.toFixed(3)}%) indicates low liquidity or high volatility. Avoid trading until conditions normalize.`;
    } else if (spreadCondition === 'wide') {
      executionRecommendation = 'limit_order';
      signal = 'unfavorable';
      confidence = 0.7;
      reasoning = `Wide spread (${current.spreadPercent.toFixed(3)}%) suggests using limit orders to minimize slippage.`;
    } else if (spreadCondition === 'tight') {
      executionRecommendation = 'immediate';
      signal = 'favorable';
      confidence = 0.8;
      reasoning = `Tight spread (${current.spreadPercent.toFixed(3)}%) indicates good liquidity. Market orders are efficient.`;
    } else {
      // Normal spread - consider imbalance
      if (Math.abs(spreadZScore) > this.config.anomalyZScoreThreshold) {
        executionRecommendation = 'wait';
        signal = 'neutral';
        confidence = 0.6;
        reasoning = `Spread anomaly detected (Z-score: ${spreadZScore.toFixed(2)}). Wait for normalization.`;
      } else {
        executionRecommendation = 'immediate';
        signal = 'favorable';
        confidence = 0.7;
        reasoning = `Normal spread conditions (${current.spreadPercent.toFixed(3)}%). Execution timing is favorable.`;
      }
    }
    
    // Adjust confidence based on imbalance
    if (imbalanceDirection !== 'balanced') {
      confidence *= 0.9; // Reduce confidence when there's significant imbalance
      reasoning += ` ${imbalanceDirection === 'buy_pressure' ? 'Buy' : 'Sell'} pressure detected (imbalance: ${(current.imbalance * 100).toFixed(1)}%).`;
    }
    
    return {
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      spreadCondition,
      imbalanceDirection,
      executionRecommendation,
      reasoning,
      metrics: {
        currentSpread: current.spread,
        currentSpreadPercent: current.spreadPercent,
        avgSpread: avgSpread * current.midPrice / 100,
        avgSpreadPercent: avgSpread,
        spreadZScore,
        imbalance: current.imbalance,
        volatility,
      },
    };
  }
  
  /**
   * Get spread history for a symbol
   */
  getSpreadHistory(symbol: string): SpreadData[] {
    return this.spreadHistory.get(symbol) || [];
  }
  
  /**
   * Calculate optimal execution price based on spread analysis
   */
  calculateOptimalExecutionPrice(
    symbol: string, 
    side: 'buy' | 'sell',
    urgency: 'low' | 'medium' | 'high'
  ): { price: number; orderType: 'market' | 'limit'; reasoning: string } | null {
    const history = this.spreadHistory.get(symbol);
    
    if (!history || history.length === 0) {
      return null;
    }
    
    const current = history[history.length - 1];
    const signal = this.getSpreadSignal(symbol);
    
    if (!signal) {
      return null;
    }
    
    let price: number;
    let orderType: 'market' | 'limit';
    let reasoning: string;
    
    if (urgency === 'high' || signal.spreadCondition === 'tight') {
      // Use market order for urgent trades or tight spreads
      price = side === 'buy' ? current.ask : current.bid;
      orderType = 'market';
      reasoning = urgency === 'high' 
        ? 'High urgency trade - using market order for immediate execution.'
        : 'Tight spread - market order is cost-effective.';
    } else if (signal.spreadCondition === 'extreme') {
      // Use aggressive limit order for extreme spreads
      const improvement = current.spread * 0.3; // Try to capture 30% of spread
      price = side === 'buy' 
        ? current.bid + improvement 
        : current.ask - improvement;
      orderType = 'limit';
      reasoning = 'Extreme spread - using limit order with price improvement to reduce costs.';
    } else {
      // Normal/wide spread - use limit order at mid-price or better
      const improvement = current.spread * (urgency === 'low' ? 0.5 : 0.25);
      price = side === 'buy'
        ? current.bid + improvement
        : current.ask - improvement;
      orderType = 'limit';
      reasoning = `${signal.spreadCondition} spread - using limit order targeting ${urgency === 'low' ? 'mid-price' : 'near-market'}.`;
    }
    
    return { price, orderType, reasoning };
  }
  
  /**
   * Get execution score based on current spread conditions
   * Returns 0-100 score for execution timing
   */
  getExecutionScore(symbol: string): number {
    const signal = this.getSpreadSignal(symbol);
    
    if (!signal) {
      return 50; // Neutral score if no data
    }
    
    let score = 50; // Base score
    
    // Spread condition scoring
    switch (signal.spreadCondition) {
      case 'tight':
        score += 30;
        break;
      case 'normal':
        score += 15;
        break;
      case 'wide':
        score -= 15;
        break;
      case 'extreme':
        score -= 30;
        break;
    }
    
    // Z-score adjustment (anomaly detection)
    const zScoreImpact = Math.min(Math.abs(signal.metrics.spreadZScore) * 5, 20);
    score -= zScoreImpact;
    
    // Imbalance adjustment
    if (signal.imbalanceDirection !== 'balanced') {
      score -= 10;
    }
    
    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Get status of the analyzer
   */
  getStatus(): {
    isRunning: boolean;
    monitoredSymbols: string[];
    config: MicrostructureConfig;
  } {
    return {
      isRunning: this.isRunning,
      monitoredSymbols: Array.from(this.updateIntervals.keys()),
      config: this.config,
    };
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<MicrostructureConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config_updated', this.config);
  }
}

// Singleton instance
let microstructureAnalyzerInstance: MarketMicrostructureAnalyzer | null = null;

export function getMicrostructureAnalyzer(): MarketMicrostructureAnalyzer {
  if (!microstructureAnalyzerInstance) {
    microstructureAnalyzerInstance = new MarketMicrostructureAnalyzer();
  }
  return microstructureAnalyzerInstance;
}

export default MarketMicrostructureAnalyzer;
