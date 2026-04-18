/**
 * Shared Agent Memory System
 * Enables inter-agent communication and shared state management.
 */

import { EventEmitter } from 'events';
import { AgentSignal } from '../agents/AgentBase';

export interface AgentInsight {
  agentName: string;
  insightType: InsightType;
  symbol: string;
  data: Record<string, any>;
  confidence: number;
  timestamp: number;
  expiresAt: number;
}

export type InsightType = 
  | 'market_regime' | 'veto_condition' | 'correlation_shift' | 'whale_activity'
  | 'sentiment_shift' | 'technical_level' | 'funding_rate' | 'liquidation_risk'
  | 'pattern_detected' | 'divergence' | 'volume_anomaly' | 'news_event' | 'custom';

export interface SignalCorrelation {
  symbol: string;
  timestamp: number;
  signals: { agentName: string; signal: 'bullish' | 'bearish' | 'neutral'; confidence: number }[];
  agreementScore: number;
  conflictScore: number;
}

export interface MarketRegimeConsensus {
  symbol: string;
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';
  confidence: number;
  contributors: string[];
  timestamp: number;
}

export interface VetoState {
  active: boolean;
  reason: string;
  triggeredBy: string;
  timestamp: number;
  expiresAt: number;
  affectedSymbols: string[];
}

export interface SharedMemoryConfig {
  insightTTLMs: number;
  maxInsightsPerType: number;
  correlationWindowMs: number;
  vetoTTLMs: number;
}

const DEFAULT_CONFIG: SharedMemoryConfig = {
  insightTTLMs: 5 * 60 * 1000,
  maxInsightsPerType: 10,
  correlationWindowMs: 30 * 1000,
  vetoTTLMs: 60 * 60 * 1000,
};

export class SharedAgentMemory extends EventEmitter {
  private config: SharedMemoryConfig;
  private insights: Map<string, Map<InsightType, AgentInsight[]>> = new Map();
  private signalCorrelations: Map<string, SignalCorrelation[]> = new Map();
  private regimeConsensus: Map<string, MarketRegimeConsensus> = new Map();
  private vetoState: VetoState = { active: false, reason: '', triggeredBy: '', timestamp: 0, expiresAt: 0, affectedSymbols: [] };
  private recentSignals: Map<string, Map<string, AgentSignal>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<SharedMemoryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  writeInsight(insight: Omit<AgentInsight, 'timestamp' | 'expiresAt'> & { ttlMs?: number }): void {
    const fullInsight: AgentInsight = {
      ...insight,
      timestamp: Date.now(),
      expiresAt: Date.now() + (insight.ttlMs || this.config.insightTTLMs),
    };
    if (!this.insights.has(insight.symbol)) this.insights.set(insight.symbol, new Map());
    const symbolInsights = this.insights.get(insight.symbol)!;
    if (!symbolInsights.has(insight.insightType)) symbolInsights.set(insight.insightType, []);
    const typeInsights = symbolInsights.get(insight.insightType)!;
    typeInsights.push(fullInsight);
    if (typeInsights.length > this.config.maxInsightsPerType) typeInsights.shift();
    this.emit('insight', fullInsight);
  }

  readInsights(symbol: string, insightType: InsightType): AgentInsight[] {
    const symbolInsights = this.insights.get(symbol);
    if (!symbolInsights) return [];
    const typeInsights = symbolInsights.get(insightType) || [];
    return typeInsights.filter(i => i.expiresAt > Date.now());
  }

  readLatestInsight(symbol: string, insightType: InsightType): AgentInsight | null {
    const insights = this.readInsights(symbol, insightType);
    return insights.length > 0 ? insights[insights.length - 1] : null;
  }

  recordSignal(signal: AgentSignal): void {
    const { symbol, agentName } = signal;
    if (!this.recentSignals.has(symbol)) this.recentSignals.set(symbol, new Map());
    this.recentSignals.get(symbol)!.set(agentName, signal);
    if (this.recentSignals.get(symbol)!.size >= 2) this.calculateCorrelation(symbol);
  }

  private calculateCorrelation(symbol: string): void {
    const symbolSignals = this.recentSignals.get(symbol);
    if (!symbolSignals) return;
    const windowStart = Date.now() - this.config.correlationWindowMs;
    const recentSignals: { agentName: string; signal: 'bullish' | 'bearish' | 'neutral'; confidence: number }[] = [];
    for (const [agentName, signal] of symbolSignals) {
      if (signal.timestamp >= windowStart) {
        recentSignals.push({ agentName, signal: signal.signal, confidence: signal.confidence });
      }
    }
    if (recentSignals.length < 2) return;
    let bullishWeight = 0, bearishWeight = 0, totalWeight = 0;
    for (const s of recentSignals) {
      if (s.signal === 'bullish') bullishWeight += s.confidence;
      else if (s.signal === 'bearish') bearishWeight += s.confidence;
      totalWeight += s.confidence;
    }
    const agreementScore = totalWeight > 0 ? (bullishWeight - bearishWeight) / totalWeight : 0;
    const signalTypes = new Set(recentSignals.map(s => s.signal));
    const conflictScore = signalTypes.size > 1 ? (signalTypes.size - 1) / 2 : 0;
    const correlation: SignalCorrelation = { symbol, timestamp: Date.now(), signals: recentSignals, agreementScore, conflictScore };
    if (!this.signalCorrelations.has(symbol)) this.signalCorrelations.set(symbol, []);
    const correlations = this.signalCorrelations.get(symbol)!;
    correlations.push(correlation);
    if (correlations.length > 100) correlations.shift();
    this.emit('correlation', correlation);
  }

  getSignalCorrelation(symbol: string): SignalCorrelation | null {
    const correlations = this.signalCorrelations.get(symbol);
    return correlations && correlations.length > 0 ? correlations[correlations.length - 1] : null;
  }

  updateRegimeConsensus(symbol: string, agentName: string, regime: MarketRegimeConsensus['regime'], confidence: number): void {
    const existing = this.regimeConsensus.get(symbol);
    if (!existing) {
      this.regimeConsensus.set(symbol, { symbol, regime, confidence, contributors: [agentName], timestamp: Date.now() });
    } else {
      if (!existing.contributors.includes(agentName)) existing.contributors.push(agentName);
      if (confidence > existing.confidence) { existing.regime = regime; existing.confidence = confidence; }
      existing.timestamp = Date.now();
    }
  }

  getRegimeConsensus(symbol: string): MarketRegimeConsensus | null {
    return this.regimeConsensus.get(symbol) || null;
  }

  activateVeto(reason: string, triggeredBy: string, affectedSymbols: string[] = []): void {
    this.vetoState = { active: true, reason, triggeredBy, timestamp: Date.now(), expiresAt: Date.now() + this.config.vetoTTLMs, affectedSymbols };
    console.log(`[SharedAgentMemory] 🚨 VETO ACTIVATED by ${triggeredBy}: ${reason}`);
    this.emit('veto_activated', this.vetoState);
  }

  deactivateVeto(): void {
    if (this.vetoState.active) {
      console.log(`[SharedAgentMemory] ✅ Veto deactivated`);
      this.vetoState = { active: false, reason: '', triggeredBy: '', timestamp: 0, expiresAt: 0, affectedSymbols: [] };
      this.emit('veto_deactivated');
    }
  }

  isVetoActive(symbol?: string): boolean {
    if (!this.vetoState.active) return false;
    if (Date.now() > this.vetoState.expiresAt) { this.deactivateVeto(); return false; }
    if (!symbol || this.vetoState.affectedSymbols.length === 0) return true;
    return this.vetoState.affectedSymbols.includes(symbol);
  }

  getVetoState(): VetoState { return { ...this.vetoState }; }

  getSummary(): { totalInsights: number; insightsByType: Record<string, number>; correlationCount: number; regimeConsensusCount: number; vetoActive: boolean } {
    let totalInsights = 0;
    const insightsByType: Record<string, number> = {};
    for (const symbolInsights of this.insights.values()) {
      for (const [type, insights] of symbolInsights) {
        const validCount = insights.filter(i => i.expiresAt > Date.now()).length;
        totalInsights += validCount;
        insightsByType[type] = (insightsByType[type] || 0) + validCount;
      }
    }
    let correlationCount = 0;
    for (const correlations of this.signalCorrelations.values()) correlationCount += correlations.length;
    return { totalInsights, insightsByType, correlationCount, regimeConsensusCount: this.regimeConsensus.size, vetoActive: this.isVetoActive() };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const symbolInsights of this.insights.values()) {
      for (const [type, insights] of symbolInsights) {
        const valid = insights.filter(i => i.expiresAt > now);
        if (valid.length !== insights.length) symbolInsights.set(type, valid);
      }
    }
    if (this.vetoState.active && now > this.vetoState.expiresAt) this.deactivateVeto();
  }

  stop(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
  }
}

let sharedMemoryInstance: SharedAgentMemory | null = null;
export function getSharedAgentMemory(): SharedAgentMemory {
  if (!sharedMemoryInstance) sharedMemoryInstance = new SharedAgentMemory();
  return sharedMemoryInstance;
}
