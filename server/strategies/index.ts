/**
 * Phase 3 Strategies - Unified Index
 */
import { EventEmitter } from 'events';

export * from './orderflow';
export * from './smartmoney';
export * from './statistical';
export * from './scoring';

import { OrderFlowManager, getOrderFlowManager, OrderFlowConfig } from './orderflow';
import { SmartMoneyManager, getSmartMoneyManager, SmartMoneyConfig } from './smartmoney';
import { StatisticalArbitrageManager, getStatisticalArbitrageManager, StatisticalConfig } from './statistical';
import { StrategyCompetenceTracker, getStrategyCompetenceTracker, CompetenceConfig } from './scoring';

export interface UnifiedStrategyConfig { orderFlow?: OrderFlowConfig; smartMoney?: SmartMoneyConfig; statistical?: StatisticalConfig; competence?: Partial<CompetenceConfig>; }

export interface UnifiedSignal { symbol: string; timestamp: number; direction: 'bullish' | 'bearish' | 'neutral'; strength: number; confidence: number; sources: { orderFlow: { direction: string; strength: number } | null; smartMoney: { direction: string; strength: number; trend: string } | null; statistical: { direction: string; strength: number; regime: string } | null; }; tradingLevels: { entry: number | null; stopLoss: number | null; takeProfit: number | null; source: string; }; competenceScore: number; }

export class UnifiedStrategyManager extends EventEmitter {
  private orderFlow: OrderFlowManager;
  private smartMoney: SmartMoneyManager;
  private statistical: StatisticalArbitrageManager;
  private competence: StrategyCompetenceTracker;
  private isRunning = false;
  
  constructor(config?: UnifiedStrategyConfig) {
    super();
    this.orderFlow = getOrderFlowManager(config?.orderFlow);
    this.smartMoney = getSmartMoneyManager(config?.smartMoney);
    this.statistical = getStatisticalArbitrageManager(config?.statistical);
    this.competence = getStrategyCompetenceTracker(config?.competence);
  }
  
  start(): void { this.isRunning = true; this.statistical.start(); console.log('[UnifiedStrategyManager] Started Phase 3 strategies'); }
  stop(): void { this.isRunning = false; this.statistical.stop(); }
  
  processTrade(trade: { symbol: string; timestamp: number; price: number; quantity: number; side: 'buy' | 'sell' }): void { if (this.isRunning) this.orderFlow.processTrade(trade); }
  
  processCandle(candle: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }): void {
    if (!this.isRunning) return;
    this.orderFlow.processCandle(candle);
    this.smartMoney.processCandle(candle);
    this.statistical.processCandle(candle);
  }
  
  getUnifiedSignal(symbol: string): UnifiedSignal {
    const ofSignal = this.orderFlow.getAggregatedSignal(symbol);
    const smSignal = this.smartMoney.getAggregatedSignal(symbol);
    const statSignal = this.statistical.getAggregatedSignal(symbol);
    
    let bullishScore = 0, bearishScore = 0, totalWeight = 0;
    if (ofSignal.direction !== 'neutral') { const w = 0.3; if (ofSignal.direction === 'bullish') bullishScore += ofSignal.strength * w; else bearishScore += ofSignal.strength * w; totalWeight += w; }
    if (smSignal.direction !== 'neutral') { const w = 0.4; if (smSignal.direction === 'bullish') bullishScore += smSignal.strength * w; else bearishScore += smSignal.strength * w; totalWeight += w; }
    if (statSignal.direction !== 'neutral') { const w = 0.3; if (statSignal.direction === 'bullish') bullishScore += statSignal.strength * w; else bearishScore += statSignal.strength * w; totalWeight += w; }
    
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral', strength = 0;
    if (totalWeight > 0) {
      const nb = bullishScore / totalWeight, nbe = bearishScore / totalWeight;
      if (nb > nbe * 1.2) { direction = 'bullish'; strength = nb; }
      else if (nbe > nb * 1.2) { direction = 'bearish'; strength = nbe; }
      else strength = Math.max(nb, nbe);
    }
    
    let agreementCount = 0;
    if (ofSignal.direction === direction) agreementCount++;
    if (smSignal.direction === direction) agreementCount++;
    if (statSignal.direction === direction) agreementCount++;
    
    return {
      symbol, timestamp: Date.now(), direction, strength: Math.round(strength), confidence: direction !== 'neutral' ? Math.round((agreementCount / 3) * 100) : 0,
      sources: {
        orderFlow: ofSignal.direction !== 'neutral' ? { direction: ofSignal.direction, strength: ofSignal.strength } : null,
        smartMoney: smSignal.direction !== 'neutral' ? { direction: smSignal.direction, strength: smSignal.strength, trend: smSignal.trend } : null,
        statistical: statSignal.direction !== 'neutral' ? { direction: statSignal.direction, strength: statSignal.strength, regime: statSignal.regime } : null,
      },
      tradingLevels: smSignal.tradingLevels,
      competenceScore: this.competence.getOverallScore(),
    };
  }
  
  recordTradeResult(strategyName: string, category: 'orderflow' | 'smartmoney' | 'statistical' | 'grid', result: { profit: number; prediction: 'bullish' | 'bearish' | 'neutral'; actual: 'bullish' | 'bearish' | 'neutral' }): void { this.competence.recordTrade(strategyName, category, result); }
  getCompetenceReport() { return this.competence.generateReport(); }
  getOrderFlowManager() { return this.orderFlow; }
  getSmartMoneyManager() { return this.smartMoney; }
  getStatisticalManager() { return this.statistical; }
  getCompetenceTracker() { return this.competence; }
}

let instance: UnifiedStrategyManager | null = null;
export function getUnifiedStrategyManager(config?: UnifiedStrategyConfig): UnifiedStrategyManager { if (!instance) instance = new UnifiedStrategyManager(config); return instance; }
export function resetUnifiedStrategyManager(): void { if (instance) instance.stop(); instance = null; }
