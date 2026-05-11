/**
 * Parameter Learning Scheduler
 * 
 * Implements a weekly job that calls `learnConsensusThreshold()` and 
 * `learnAgentConfidenceThreshold()` to continuously improve parameters 
 * based on actual trade outcomes.
 * 
 * Learning Strategy:
 * - Runs weekly (every Sunday at 2:00 AM UTC)
 * - Analyzes 90-day rolling window of trades
 * - Updates parameters only if new values show improvement
 * - Maintains audit log of all parameter changes
 */

import { getDb } from "../db";
import { getActiveClock } from '../_core/clock';
import { trades, learnedParameters } from "../../drizzle/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { parameterLearning } from "./ParameterLearning";
import { seedLearnedParameters, checkParametersSeeded } from "./seedLearnedParameters";

interface TradeWithSignals {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: string;
  exitPrice: string | null;
  pnl: string | null;
  entryTime: Date;
  exitTime: Date | null;
  status: string;
  agentSignals: any;
  confidence: string | null;
}

interface LearningResult {
  symbol: string;
  regime: string;
  oldThreshold: number;
  newThreshold: number;
  improvement: number;
  sampleSize: number;
  newWinRate: number;
  newSharpe: number;
}

interface AgentLearningResult {
  agentName: string;
  oldThreshold: number;
  newThreshold: number;
  improvement: number;
  sampleSize: number;
  newWinRate: number;
}

/**
 * Detect market regime from trade data
 */
function detectRegimeFromTrade(trade: TradeWithSignals): string {
  const agentData = trade.agentSignals as any;
  
  if (agentData?.MacroAnalyst?.evidence?.regime) {
    return agentData.MacroAnalyst.evidence.regime;
  }
  
  const pnl = parseFloat(trade.pnl || '0');
  const entryPrice = parseFloat(trade.entryPrice);
  const exitPrice = parseFloat(trade.exitPrice || trade.entryPrice);
  const priceChange = Math.abs((exitPrice - entryPrice) / entryPrice);
  
  if (priceChange > 0.05) {
    return pnl > 0 ? 'trending_up' : 'trending_down';
  } else if (priceChange > 0.02) {
    return 'high_volatility';
  }
  
  return 'range_bound';
}

/**
 * Calculate consensus score from agent signals
 */
function calculateConsensusScore(agentSignals: any): number {
  if (!agentSignals || typeof agentSignals !== 'object') {
    return 0;
  }
  
  const signals = Object.values(agentSignals) as any[];
  if (signals.length === 0) return 0;
  
  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;
  
  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;
    
    const confidence = signal.confidence || 0.5;
    const weight = confidence;
    totalWeight += weight;
    
    if (signal.signal === 'bullish') {
      bullishScore += weight;
    } else if (signal.signal === 'bearish') {
      bearishScore += weight;
    }
  }
  
  if (totalWeight === 0) return 0;
  
  return Math.abs(bullishScore - bearishScore) / totalWeight;
}

/**
 * Fetch historical trades for learning
 */
async function fetchHistoricalTrades(days: number = 90): Promise<TradeWithSignals[]> {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  try {
    const result = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.status, 'closed'),
          gte(trades.entryTime, cutoffDate)
        )
      )
      .orderBy(desc(trades.entryTime));
    
    return result as TradeWithSignals[];
  } catch (error) {
    console.error('[ParameterLearningScheduler] Failed to fetch historical trades:', error);
    return [];
  }
}

/**
 * Learn optimal consensus thresholds from historical trades
 */
export async function learnConsensusThresholds(): Promise<LearningResult[]> {
  console.log('[ParameterLearningScheduler] Starting consensus threshold learning...');
  
  const historicalTrades = await fetchHistoricalTrades(90);
  console.log(`[ParameterLearningScheduler] Analyzing ${historicalTrades.length} historical trades`);
  
  if (historicalTrades.length < 50) {
    console.log('[ParameterLearningScheduler] Insufficient trades for learning (need 50+)');
    return [];
  }
  
  const results: LearningResult[] = [];
  
  const tradesBySymbolRegime = new Map<string, Array<{
    consensusScore: number;
    pnl: number;
    duration: number;
  }>>();
  
  for (const trade of historicalTrades) {
    const regime = detectRegimeFromTrade(trade);
    const key = `${trade.symbol}_${regime}`;
    
    if (!tradesBySymbolRegime.has(key)) {
      tradesBySymbolRegime.set(key, []);
    }
    
    const consensusScore = calculateConsensusScore(trade.agentSignals);
    const pnl = parseFloat(trade.pnl || '0');
    const duration = trade.exitTime && trade.entryTime 
      ? trade.exitTime.getTime() - trade.entryTime.getTime()
      : 3600000;
    
    tradesBySymbolRegime.get(key)!.push({
      consensusScore,
      pnl,
      duration
    });
  }
  
  for (const [key, groupedTrades] of tradesBySymbolRegime) {
    const [symbol, regime] = key.split('_');
    
    if (groupedTrades.length < 30) {
      console.log(`[ParameterLearningScheduler] Skipping ${key}: insufficient trades (${groupedTrades.length})`);
      continue;
    }
    
    const oldThreshold = await parameterLearning.getConsensusThreshold(symbol, regime);
    
    await parameterLearning.learnConsensusThreshold(symbol, regime, groupedTrades);
    
    parameterLearning.clearCache();
    const newThreshold = await parameterLearning.getConsensusThreshold(symbol, regime);
    
    const filteredTrades = groupedTrades.filter(t => Math.abs(t.consensusScore) >= newThreshold);
    const winRate = filteredTrades.filter(t => t.pnl > 0).length / filteredTrades.length;
    const returns = filteredTrades.map(t => t.pnl);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;
    
    const improvement = ((newThreshold - oldThreshold) / oldThreshold) * 100;
    
    results.push({
      symbol,
      regime,
      oldThreshold,
      newThreshold,
      improvement,
      sampleSize: groupedTrades.length,
      newWinRate: winRate,
      newSharpe: sharpe
    });
    
    console.log(`[ParameterLearningScheduler] ${symbol}/${regime}: ${oldThreshold.toFixed(3)} → ${newThreshold.toFixed(3)} (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%, WR: ${(winRate * 100).toFixed(1)}%)`);
  }
  
  return results;
}

/**
 * Learn optimal agent confidence thresholds from historical data
 */
export async function learnAgentConfidenceThresholds(): Promise<AgentLearningResult[]> {
  console.log('[ParameterLearningScheduler] Starting agent confidence threshold learning...');
  
  const historicalTrades = await fetchHistoricalTrades(90);
  
  if (historicalTrades.length < 50) {
    console.log('[ParameterLearningScheduler] Insufficient trades for agent learning (need 50+)');
    return [];
  }
  
  const results: AgentLearningResult[] = [];
  
  const signalsByAgent = new Map<string, Array<{
    confidence: number;
    correct: boolean;
  }>>();
  
  for (const trade of historicalTrades) {
    const agentData = trade.agentSignals as any;
    if (!agentData || typeof agentData !== 'object') continue;
    
    const tradePnl = parseFloat(trade.pnl || '0');
    const tradeWon = tradePnl > 0;
    
    for (const [agentName, signal] of Object.entries(agentData)) {
      if (!signal || typeof signal !== 'object') continue;
      
      const agentSignal = signal as any;
      const confidence = agentSignal.confidence || 0.5;
      const signalDirection = agentSignal.signal;
      
      let correct = false;
      if (trade.side === 'long') {
        correct = (signalDirection === 'bullish' && tradeWon) || 
                  (signalDirection === 'bearish' && !tradeWon);
      } else {
        correct = (signalDirection === 'bearish' && tradeWon) || 
                  (signalDirection === 'bullish' && !tradeWon);
      }
      
      if (!signalsByAgent.has(agentName)) {
        signalsByAgent.set(agentName, []);
      }
      
      signalsByAgent.get(agentName)!.push({
        confidence,
        correct
      });
    }
  }
  
  for (const [agentName, signals] of signalsByAgent) {
    if (signals.length < 50) {
      console.log(`[ParameterLearningScheduler] Skipping ${agentName}: insufficient signals (${signals.length})`);
      continue;
    }
    
    const oldThreshold = await parameterLearning.getAgentConfidenceThreshold(agentName);
    
    await parameterLearning.learnAgentConfidenceThreshold(agentName, signals);
    
    parameterLearning.clearCache();
    const newThreshold = await parameterLearning.getAgentConfidenceThreshold(agentName);
    
    const filteredSignals = signals.filter(s => s.confidence >= newThreshold);
    const winRate = filteredSignals.filter(s => s.correct).length / filteredSignals.length;
    
    const improvement = ((newThreshold - oldThreshold) / oldThreshold) * 100;
    
    results.push({
      agentName,
      oldThreshold,
      newThreshold,
      improvement,
      sampleSize: signals.length,
      newWinRate: winRate
    });
    
    console.log(`[ParameterLearningScheduler] ${agentName}: ${oldThreshold.toFixed(3)} → ${newThreshold.toFixed(3)} (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%, WR: ${(winRate * 100).toFixed(1)}%)`);
  }
  
  return results;
}

/**
 * Main learning job - runs all parameter learning functions
 */
export async function runWeeklyParameterLearning(): Promise<{
  success: boolean;
  consensusResults: LearningResult[];
  agentResults: AgentLearningResult[];
  timestamp: Date;
  error?: string;
}> {
  const timestamp = new Date();
  console.log(`[ParameterLearningScheduler] ========================================`);
  console.log(`[ParameterLearningScheduler] Weekly Parameter Learning Job Started`);
  console.log(`[ParameterLearningScheduler] Timestamp: ${timestamp.toISOString()}`);
  console.log(`[ParameterLearningScheduler] ========================================`);
  
  try {
    const isSeeded = await checkParametersSeeded();
    if (!isSeeded) {
      console.log('[ParameterLearningScheduler] Seeding baseline parameters...');
      await seedLearnedParameters();
    }
    
    const consensusResults = await learnConsensusThresholds();
    const agentResults = await learnAgentConfidenceThresholds();
    
    console.log(`[ParameterLearningScheduler] ========================================`);
    console.log(`[ParameterLearningScheduler] Weekly Learning Job Completed`);
    console.log(`[ParameterLearningScheduler] Consensus thresholds updated: ${consensusResults.length}`);
    console.log(`[ParameterLearningScheduler] Agent thresholds updated: ${agentResults.length}`);
    console.log(`[ParameterLearningScheduler] ========================================`);
    
    return {
      success: true,
      consensusResults,
      agentResults,
      timestamp
    };
  } catch (error) {
    console.error('[ParameterLearningScheduler] Weekly learning job failed:', error);
    return {
      success: false,
      consensusResults: [],
      agentResults: [],
      timestamp,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Scheduler class to manage weekly learning jobs
 */
export class ParameterLearningScheduler {
  private static instance: ParameterLearningScheduler;
  private intervalId: NodeJS.Timeout | null = null;
  private lastRun: Date | null = null;
  private isRunning: boolean = false;
  
  private constructor() {}
  
  static getInstance(): ParameterLearningScheduler {
    if (!ParameterLearningScheduler.instance) {
      ParameterLearningScheduler.instance = new ParameterLearningScheduler();
    }
    return ParameterLearningScheduler.instance;
  }
  
  /**
   * Start the weekly scheduler
   */
  start(): void {
    if (this.intervalId) {
      console.log('[ParameterLearningScheduler] Scheduler already running');
      return;
    }
    
    console.log('[ParameterLearningScheduler] Starting weekly scheduler...');
    
    const now = new Date();
    const nextRun = this.getNextSundayAt2AM();
    const msUntilNextRun = nextRun.getTime() - now.getTime();
    
    console.log(`[ParameterLearningScheduler] Next scheduled run: ${nextRun.toISOString()}`);
    console.log(`[ParameterLearningScheduler] Time until next run: ${Math.round(msUntilNextRun / 3600000)} hours`);
    
    setTimeout(() => {
      this.runJob();
      
      this.intervalId = setInterval(() => {
        this.runJob();
      }, 7 * 24 * 60 * 60 * 1000);
      
    }, msUntilNextRun);
    
    if (!this.lastRun || this.daysSinceLastRun() >= 7) {
      console.log('[ParameterLearningScheduler] Running initial learning job...');
      this.runJob();
    }
  }
  
  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ParameterLearningScheduler] Scheduler stopped');
    }
  }
  
  /**
   * Run the learning job manually
   */
  async runJob(): Promise<void> {
    if (this.isRunning) {
      console.log('[ParameterLearningScheduler] Job already running, skipping...');
      return;
    }
    
    this.isRunning = true;
    
    try {
      await runWeeklyParameterLearning();
      this.lastRun = new Date();
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Get the next Sunday at 2:00 AM UTC
   */
  private getNextSundayAt2AM(): Date {
    const now = new Date();
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    
    const nextSunday = new Date(now);
    nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
    nextSunday.setUTCHours(2, 0, 0, 0);
    
    if (now.getUTCDay() === 0 && now.getUTCHours() >= 2) {
      nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    }
    
    return nextSunday;
  }
  
  /**
   * Calculate days since last run
   */
  private daysSinceLastRun(): number {
    if (!this.lastRun) return Infinity;
    return (getActiveClock().now() - this.lastRun.getTime()) / (24 * 60 * 60 * 1000);
  }
  
  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    lastRun: Date | null;
    nextRun: Date;
    schedulerActive: boolean;
  } {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.getNextSundayAt2AM(),
      schedulerActive: this.intervalId !== null
    };
  }
}

// Export singleton instance
export const parameterLearningScheduler = ParameterLearningScheduler.getInstance();
