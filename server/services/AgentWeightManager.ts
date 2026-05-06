/**
 * AgentWeightManager - Manages configurable agent weights for consensus algorithm
 *
 * This service provides:
 * 1. Configurable weights for all agents (core + Phase 2)
 * 2. Category multipliers for fast/slow/phase2 agent groups
 * 3. Performance-based weight adjustment with Brier score calibration
 * 4. Database persistence for user-specific configurations
 * 5. Automatic weight recalculation from trade outcomes
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "../db";
import { agentWeights } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { agentLogger } from '../utils/logger';

/**
 * Phase 15 — File-backed persistence for the adaptive-weight feedback loop.
 *
 * Pre-Phase-15 AgentWeightManager tracked `performanceHistory` and
 * `detailedPerformance` in memory only. Every pm2 restart wiped the
 * accumulated learning — agents that had built up a 70% win rate over 80
 * trades reset to a default 50% baseline, and the `MIN_SAMPLES_FOR_ADJUSTMENT`
 * threshold had to be re-earned from scratch. So in practice the system
 * never learned across any meaningful time window.
 *
 * Why file over DB: a migration requires care; single pm2 process means no
 * inter-process write contention; serializing ~6 KB of {accuracy, samples,
 * brierScore} every 10 records costs <1ms. The tradeoff — if the file is
 * lost (disk failure, manual delete), learning restarts. Acceptable.
 *
 * Path is absolute so it survives cwd changes (pm2 sometimes launches from
 * a different working dir). File is written atomically via write-and-rename
 * to avoid half-written JSON if the process dies mid-flush.
 */
/**
 * Evaluated at call time, not module load, so SEER_DATA_DIR can be set
 * by a process manager OR overridden in tests after import. Previous
 * module-level constant captured the value too early and tests setting
 * the env in beforeEach had no effect.
 */
function getPerformanceStorePath(): string {
  return path.join(
    process.env.SEER_DATA_DIR ?? path.join(process.cwd(), 'data'),
    'agent-performance.json',
  );
}
interface PersistedAgentState {
  version: 1;
  updatedAt: string;
  userId: number;
  // Keyed by agent name. Arrays are sliced to PERFORMANCE_WINDOW before save.
  performanceHistory: Record<string, number[]>;
  detailedPerformance: Record<string, AgentPerformanceRecord[]>;
}
export function __loadAgentPerformanceFromFile(
  filePath: string = getPerformanceStorePath(),
): PersistedAgentState | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    return parsed as PersistedAgentState;
  } catch (err) {
    agentLogger.warn(
      `[AgentWeightManager] Failed to load persisted performance: ${(err as Error)?.message ?? err}`,
    );
    return null;
  }
}
export function __saveAgentPerformanceToFile(
  state: PersistedAgentState,
  filePath: string = getPerformanceStorePath(),
): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, filePath); // Atomic replace on POSIX.
  } catch (err) {
    // Never let persistence errors break the trade loop — log and move on.
    agentLogger.warn(
      `[AgentWeightManager] Failed to persist performance: ${(err as Error)?.message ?? err}`,
    );
  }
}

// Agent category definitions
export const AGENT_CATEGORIES = {
  FAST: ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'],
  SLOW: ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'],
  PHASE2: ['WhaleTracker', 'FundingRateAnalyst', 'LiquidationHeatmap', 'OnChainFlowAnalyst', 'VolumeProfileAnalyzer', 'ForexCorrelationAgent', 'OpenInterestDeltaAgent', 'FundingRateFlipAgent'],
  // Phase 53.10 — LEAD_INFO is a new category for Binance-microstructure /
  // cross-exchange-lead agents. Tokyo placement makes Binance the price-
  // discovery venue; these agents convert that into trade-decision signal
  // (LeadLag, perp/spot premium, perp/spot CVD, perp depth imbalance).
  LEAD_INFO: ['LeadLagAgent', 'PerpSpotPremiumAgent', 'PerpTakerFlowAgent', 'SpotTakerFlowAgent', 'PerpDepthImbalanceAgent', 'WhaleWallAgent', 'CrossExchangeSpreadAgent', 'CVDDivergenceAgent', 'TradeSizeOutlierAgent', 'SpreadCompressionAgent', 'LiquidityVacuumAgent', 'VelocityAgent'],
} as const;

// All agent names
export const ALL_AGENTS = [
  ...AGENT_CATEGORIES.FAST,
  ...AGENT_CATEGORIES.SLOW,
  ...AGENT_CATEGORIES.PHASE2,
  ...AGENT_CATEGORIES.LEAD_INFO,
] as const;

export type AgentName = typeof ALL_AGENTS[number];
export type AgentCategory = keyof typeof AGENT_CATEGORIES;

// Default weights for each agent (within their category)
export const DEFAULT_AGENT_WEIGHTS: Record<AgentName, number> = {
  // Fast agents (weights should sum to 100 within category)
  TechnicalAnalyst: 40,
  PatternMatcher: 35,
  OrderFlowAnalyst: 25,

  // Slow agents (weights should sum to 100 within category)
  SentimentAnalyst: 33.33,
  NewsSentinel: 33.33,
  MacroAnalyst: 33.34,
  OnChainAnalyst: 0, // Optional, disabled by default

  // Phase 2 agents (weights should sum to 100 within category)
  WhaleTracker: 12,
  FundingRateAnalyst: 12,
  LiquidationHeatmap: 12,
  OnChainFlowAnalyst: 12,
  VolumeProfileAnalyzer: 16,
  ForexCorrelationAgent: 10,
  OpenInterestDeltaAgent: 12,
  FundingRateFlipAgent: 14,

  // Phase 53.10/53.11 LEAD_INFO category (sum = 100)
  // Distribution rationale: LeadLag and PerpTakerFlow are the highest-quality
  // pure-information signals (cross-exchange timing + same-venue CVD).
  // PerpSpotPremium gets meaningful weight because the perp/spot premium is
  // a continuous reading rather than event-triggered. Spot CVD and depth
  // imbalance are slightly lower (noisier on busy spot tape, depth signal
  // is short-horizon). WhaleWall is binary (wall present or not) so it gets
  // less weight despite high specificity.
  LeadLagAgent: 13,
  PerpSpotPremiumAgent: 10,
  PerpTakerFlowAgent: 12,
  SpotTakerFlowAgent: 7,
  PerpDepthImbalanceAgent: 7,
  WhaleWallAgent: 6,
  CrossExchangeSpreadAgent: 8,
  CVDDivergenceAgent: 9,
  TradeSizeOutlierAgent: 7,
  SpreadCompressionAgent: 5,
  LiquidityVacuumAgent: 5,
  VelocityAgent: 11,
};

// Phase 15B FIX: Rebalanced category multipliers.
// Previous values (FAST=1.0, SLOW=0.2) caused 100% bullish bias because
// fast agents (tick-driven, high noise) dominated macro/sentiment agents
// that actually provide higher-quality directional signals.
// Audit data: 267K consensus records → 100% bullish despite mixed signals.
export const DEFAULT_CATEGORY_MULTIPLIERS = {
  FAST: 0.70,   // Reduced from 1.0 — technical noise should not dominate
  SLOW: 0.50,   // Increased from 0.20 — macro/sentiment signals are higher quality
  PHASE2: 0.60, // Increased from 0.50 — whale/funding/liquidation are valuable
  // Phase 53.10 — LEAD_INFO sits between FAST and PHASE2. Real-time like
  // FAST agents but specialized; high signal quality (Tokyo placement +
  // Binance microstructure) but each individual reading is short-horizon.
  LEAD_INFO: 0.65,
};

export interface AgentWeightConfig {
  userId: number;
  weights: Record<AgentName, number>;
  categoryMultipliers: Record<AgentCategory, number>;
  timeframeBonus: number;
  isActive: boolean;
}

export interface WeightedAgentScore {
  agentName: AgentName;
  category: AgentCategory;
  baseWeight: number;
  categoryMultiplier: number;
  finalWeight: number;
  performanceAdjustment: number;
}

/**
 * Tracks per-agent performance with Brier score for confidence calibration
 */
export interface AgentPerformanceRecord {
  wasCorrect: boolean;
  predictedConfidence: number; // The confidence the agent reported (0-1)
  timestamp: number;
}

/**
 * Computed performance metrics for an agent
 */
export interface AgentPerformanceMetrics {
  accuracy: number;          // Win rate (0-1)
  brierScore: number;        // Brier score (0=perfect, 1=worst) - lower is better
  calibration: number;       // How well confidence matches accuracy (0=perfect)
  samples: number;           // Number of recorded outcomes
  recentAccuracy: number;    // Accuracy of last 20 trades
  weightAdjustment: number;  // Computed weight multiplier (0.5-1.5)
}

export class AgentWeightManager extends EventEmitter {
  private userId: number;
  private weights: Map<AgentName, number> = new Map();
  private categoryMultipliers: Map<AgentCategory, number> = new Map();
  private timeframeBonus: number = 10;
  private isActive: boolean = true;
  private performanceHistory: Map<AgentName, number[]> = new Map(); // Legacy binary accuracy
  private detailedPerformance: Map<AgentName, AgentPerformanceRecord[]> = new Map(); // Full performance with confidence
  private readonly PERFORMANCE_WINDOW = 200; // Track last 200 signals per agent
  private readonly MIN_SAMPLES_FOR_ADJUSTMENT = 10; // Need at least 10 trades before adjusting
  // Phase 15B FIX: Reduced from 50 to 10. Poor agents dominated for 50+ trades before correction.
  private readonly WEIGHT_RECALC_INTERVAL = 10; // Recalculate weights every 10 new records
  private recordsSinceLastRecalc: number = 0;

  constructor(userId: number = 1, opts: { skipHydration?: boolean } = {}) {
    super();
    this.userId = userId;
    this.initializeDefaults();
    // Phase 15 — rehydrate the accumulated learning from disk. If the file
    // doesn't exist (fresh box, deleted data dir), the in-memory maps stay at
    // their empty defaults — no throw, no crash.
    //
    // Hydration policy:
    //   opts.skipHydration === true  → never hydrate (tests that want
    //                                    clean state pass this).
    //   opts.skipHydration === false → ALWAYS hydrate, even under vitest
    //                                    (Phase 15 tests that verify the
    //                                    round-trip pass this and set
    //                                    SEER_DATA_DIR to a temp dir).
    //   opts.skipHydration == null    → default: hydrate in prod, skip
    //                                    under vitest (so existing
    //                                    suites that use the default
    //                                    constructor don't inherit state
    //                                    from a leaked default-path file).
    const isTestEnv = !!process.env.VITEST || process.env.NODE_ENV === 'test';
    const shouldHydrate =
      opts.skipHydration === false ||
      (opts.skipHydration === undefined && !isTestEnv);
    if (shouldHydrate) {
      this.hydratePerformanceFromFile();
    }
  }

  /**
   * Phase 15 — load last-persisted performance history if present. Matches by
   * userId so multi-user installations stay isolated (one file per userId
   * wouldn't scale; instead we keep one file per process and only
   * overwrite entries for this userId).
   */
  private hydratePerformanceFromFile(): void {
    const state = __loadAgentPerformanceFromFile();
    if (!state) return;
    if (state.userId !== this.userId) return; // Different user — skip.
    let totalRecordsRestored = 0;
    for (const agent of ALL_AGENTS) {
      const hist = state.performanceHistory[agent];
      const detailed = state.detailedPerformance[agent];
      if (Array.isArray(hist) && hist.length) {
        this.performanceHistory.set(agent, hist.slice(-this.PERFORMANCE_WINDOW));
        totalRecordsRestored += hist.length;
      }
      if (Array.isArray(detailed) && detailed.length) {
        this.detailedPerformance.set(agent, detailed.slice(-this.PERFORMANCE_WINDOW));
      }
    }
    agentLogger.info(
      `[AgentWeightManager] Rehydrated ${totalRecordsRestored} performance records from ${getPerformanceStorePath()}`,
    );
  }

  /** Phase 15 — serialize current performance state to disk. Called from
   *  recordPerformance periodically (every WEIGHT_RECALC_INTERVAL records).
   *  Atomic write-and-rename keeps the file valid even on mid-flush crash. */
  private persistPerformanceToFile(): void {
    const performanceHistory: Record<string, number[]> = {};
    const detailedPerformance: Record<string, AgentPerformanceRecord[]> = {};
    for (const agent of ALL_AGENTS) {
      performanceHistory[agent] = this.performanceHistory.get(agent) ?? [];
      detailedPerformance[agent] = this.detailedPerformance.get(agent) ?? [];
    }
    __saveAgentPerformanceToFile({
      version: 1,
      updatedAt: new Date().toISOString(),
      userId: this.userId,
      performanceHistory,
      detailedPerformance,
    });
  }
  
  /**
   * Initialize with default weights
   */
  private initializeDefaults(): void {
    // Set default agent weights
    for (const [agent, weight] of Object.entries(DEFAULT_AGENT_WEIGHTS)) {
      this.weights.set(agent as AgentName, weight);
    }
    
    // Set default category multipliers
    for (const [category, multiplier] of Object.entries(DEFAULT_CATEGORY_MULTIPLIERS)) {
      this.categoryMultipliers.set(category as AgentCategory, multiplier);
    }
    
    // Initialize performance history
    for (const agent of ALL_AGENTS) {
      this.performanceHistory.set(agent, []);
      this.detailedPerformance.set(agent, []);
    }
  }
  
  /**
   * Load weights from database
   */
  async loadFromDatabase(): Promise<boolean> {
    try {
      const db = await getDb();
      if (!db) {
        agentLogger.warn('Database not available, using defaults');
        return false;
      }
      
      const result = await db
        .select()
        .from(agentWeights)
        .where(eq(agentWeights.userId, this.userId))
        .limit(1);
      
      if (result.length === 0) {
        agentLogger.info('No saved weights found, using defaults');
        return false;
      }
      
      const config = result[0];
      
      // Load agent weights
      this.weights.set('TechnicalAnalyst', parseFloat(config.technicalWeight || '40'));
      this.weights.set('PatternMatcher', parseFloat(config.patternWeight || '35'));
      this.weights.set('OrderFlowAnalyst', parseFloat(config.orderFlowWeight || '25'));
      this.weights.set('SentimentAnalyst', parseFloat(config.sentimentWeight || '33.33'));
      this.weights.set('NewsSentinel', parseFloat(config.newsWeight || '33.33'));
      this.weights.set('MacroAnalyst', parseFloat(config.macroWeight || '33.34'));
      this.weights.set('OnChainAnalyst', parseFloat(config.onChainWeight || '0'));
      this.weights.set('WhaleTracker', parseFloat(config.whaleTrackerWeight || '15'));
      this.weights.set('FundingRateAnalyst', parseFloat(config.fundingRateWeight || '15'));
      this.weights.set('LiquidationHeatmap', parseFloat(config.liquidationWeight || '15'));
      this.weights.set('OnChainFlowAnalyst', parseFloat(config.onChainFlowWeight || '15'));
      this.weights.set('VolumeProfileAnalyzer', parseFloat(config.volumeProfileWeight || '20'));
      
      // Load category multipliers
      this.categoryMultipliers.set('FAST', parseFloat(config.fastAgentMultiplier || '1.0'));
      this.categoryMultipliers.set('SLOW', parseFloat(config.slowAgentMultiplier || '0.20'));
      this.categoryMultipliers.set('PHASE2', parseFloat(config.phase2AgentMultiplier || '0.50'));
      
      // Load other settings
      this.timeframeBonus = parseFloat(config.timeframeBonus || '10');
      this.isActive = config.isActive ?? true;
      
      agentLogger.info('Loaded weights from database');
      this.emit('weights_loaded', this.getConfig());
      return true;
    } catch (error) {
      agentLogger.error('Failed to load weights', { error: (error as Error)?.message });
      return false;
    }
  }
  
  /**
   * Save weights to database
   */
  async saveToDatabase(): Promise<boolean> {
    try {
      const db = await getDb();
      if (!db) {
        agentLogger.warn('Database not available');
        return false;
      }
      
      const data = {
        userId: this.userId,
        technicalWeight: this.weights.get('TechnicalAnalyst')?.toString() || '40',
        patternWeight: this.weights.get('PatternMatcher')?.toString() || '35',
        orderFlowWeight: this.weights.get('OrderFlowAnalyst')?.toString() || '25',
        sentimentWeight: this.weights.get('SentimentAnalyst')?.toString() || '33.33',
        newsWeight: this.weights.get('NewsSentinel')?.toString() || '33.33',
        macroWeight: this.weights.get('MacroAnalyst')?.toString() || '33.34',
        onChainWeight: this.weights.get('OnChainAnalyst')?.toString() || '0',
        whaleTrackerWeight: this.weights.get('WhaleTracker')?.toString() || '15',
        fundingRateWeight: this.weights.get('FundingRateAnalyst')?.toString() || '15',
        liquidationWeight: this.weights.get('LiquidationHeatmap')?.toString() || '15',
        onChainFlowWeight: this.weights.get('OnChainFlowAnalyst')?.toString() || '15',
        volumeProfileWeight: this.weights.get('VolumeProfileAnalyzer')?.toString() || '20',
        fastAgentMultiplier: this.categoryMultipliers.get('FAST')?.toString() || '1.0',
        slowAgentMultiplier: this.categoryMultipliers.get('SLOW')?.toString() || '0.20',
        phase2AgentMultiplier: this.categoryMultipliers.get('PHASE2')?.toString() || '0.50',
        timeframeBonus: this.timeframeBonus.toString(),
        isActive: this.isActive,
      };
      
      // Check if exists
      const existing = await db
        .select()
        .from(agentWeights)
        .where(eq(agentWeights.userId, this.userId))
        .limit(1);
      
      if (existing.length > 0) {
        await db
          .update(agentWeights)
          .set(data)
          .where(eq(agentWeights.userId, this.userId));
      } else {
        await db.insert(agentWeights).values(data);
      }
      
      agentLogger.info('Saved weights to database');
      this.emit('weights_saved', this.getConfig());
      return true;
    } catch (error) {
      agentLogger.error('Failed to save weights', { error: (error as Error)?.message });
      return false;
    }
  }
  
  /**
   * Get the category for an agent
   */
  getAgentCategory(agentName: string): AgentCategory | null {
    if (AGENT_CATEGORIES.FAST.includes(agentName as any)) return 'FAST';
    if (AGENT_CATEGORIES.SLOW.includes(agentName as any)) return 'SLOW';
    if (AGENT_CATEGORIES.PHASE2.includes(agentName as any)) return 'PHASE2';
    return null;
  }
  
  /**
   * Calculate the final weight for an agent
   * Formula: baseWeight * categoryMultiplier * performanceAdjustment
   */
  calculateAgentWeight(agentName: string, historicalAccuracy?: number): WeightedAgentScore | null {
    const category = this.getAgentCategory(agentName);
    if (!category) {
      agentLogger.warn('Unknown agent', { agentName });
      return null;
    }
    
    const baseWeight = this.weights.get(agentName as AgentName) || 0;
    const categoryMultiplier = this.categoryMultipliers.get(category) || 1.0;
    
    // Calculate performance adjustment (0.5 to 1.5 based on recent accuracy)
    let performanceAdjustment = 1.0;
    if (historicalAccuracy !== undefined) {
      // Scale accuracy (0-1) to adjustment (0.5-1.5)
      performanceAdjustment = 0.5 + historicalAccuracy;
    } else {
      // Use internal performance history if available
      const history = this.performanceHistory.get(agentName as AgentName);
      if (history && history.length > 0) {
        const avgAccuracy = history.reduce((a, b) => a + b, 0) / history.length;
        performanceAdjustment = 0.5 + avgAccuracy;
      }
    }
    
    // Calculate final weight
    const finalWeight = (baseWeight / 100) * categoryMultiplier * performanceAdjustment;
    
    return {
      agentName: agentName as AgentName,
      category,
      baseWeight,
      categoryMultiplier,
      finalWeight,
      performanceAdjustment,
    };
  }
  
  /**
   * Get all agent weights with their calculated final values
   */
  getAllWeights(historicalAccuracies?: Map<string, number>): WeightedAgentScore[] {
    const scores: WeightedAgentScore[] = [];
    
    for (const agent of ALL_AGENTS) {
      const accuracy = historicalAccuracies?.get(agent);
      const score = this.calculateAgentWeight(agent, accuracy);
      if (score) {
        scores.push(score);
      }
    }
    
    return scores;
  }
  
  /**
   * Update weight for a specific agent
   */
  setAgentWeight(agentName: AgentName, weight: number): void {
    if (!ALL_AGENTS.includes(agentName)) {
      agentLogger.warn('Unknown agent', { agentName });
      return;
    }
    
    // Clamp weight to 0-100
    const clampedWeight = Math.max(0, Math.min(100, weight));
    this.weights.set(agentName, clampedWeight);
    
    this.emit('weight_updated', { agentName, weight: clampedWeight });
  }
  
  /**
   * Update category multiplier
   */
  setCategoryMultiplier(category: AgentCategory, multiplier: number): void {
    // Clamp multiplier to 0-2
    const clampedMultiplier = Math.max(0, Math.min(2, multiplier));
    this.categoryMultipliers.set(category, clampedMultiplier);
    
    this.emit('multiplier_updated', { category, multiplier: clampedMultiplier });
  }
  
  /**
   * Record agent performance for adaptive weighting
   * Enhanced with confidence tracking for Brier score calibration
   */
  recordPerformance(agentName: AgentName, wasCorrect: boolean, predictedConfidence?: number): void {
    // Legacy binary tracking
    const history = this.performanceHistory.get(agentName);
    if (!history) return;

    history.push(wasCorrect ? 1 : 0);
    if (history.length > this.PERFORMANCE_WINDOW) {
      history.shift();
    }

    // Detailed performance tracking with confidence
    const detailed = this.detailedPerformance.get(agentName);
    if (detailed) {
      detailed.push({
        wasCorrect,
        predictedConfidence: predictedConfidence ?? 0.5,
        timestamp: Date.now(),
      });
      if (detailed.length > this.PERFORMANCE_WINDOW) {
        detailed.shift();
      }
    }

    const recentAccuracy = history.reduce((a, b) => a + b, 0) / history.length;

    this.emit('performance_recorded', {
      agentName,
      wasCorrect,
      recentAccuracy,
    });

    // Trigger weight recalculation periodically
    this.recordsSinceLastRecalc++;
    if (this.recordsSinceLastRecalc >= this.WEIGHT_RECALC_INTERVAL) {
      this.recalculateWeightsFromPerformance();
      // Phase 15 — persist after each recalc so restart picks up the latest
      // learning. Coupling to the recalc interval (every 10 records) limits
      // file writes to once per ~10 trades, keeping disk I/O negligible.
      this.persistPerformanceToFile();
      this.recordsSinceLastRecalc = 0;
    }
  }

  /**
   * Record a complete trade outcome for all participating agents
   * Called when a trade closes — evaluates each agent's signal against the outcome
   */
  recordTradeOutcome(
    agentSignals: Array<{ agentName: string; signal: 'bullish' | 'bearish' | 'neutral'; confidence: number }>,
    tradeSide: 'long' | 'short',
    wasProfit: boolean,
    pnlAfterCosts?: number // Phase 5: cost-aware profitability
  ): void {
    // Phase 5: Use pnlAfterCosts as the primary profitability signal when available.
    // Small winners that become losers after fees (commission + slippage) should penalize agents.
    const actuallyProfit = pnlAfterCosts !== undefined ? pnlAfterCosts > 0 : wasProfit;

    for (const agentSignal of agentSignals) {
      const agentName = agentSignal.agentName as AgentName;
      if (!ALL_AGENTS.includes(agentName)) continue;

      // Agent was correct if its signal direction matched the profitable trade outcome
      let wasCorrect = false;
      if (tradeSide === 'long') {
        wasCorrect = (agentSignal.signal === 'bullish' && actuallyProfit) ||
                     (agentSignal.signal === 'bearish' && !actuallyProfit);
      } else {
        wasCorrect = (agentSignal.signal === 'bearish' && actuallyProfit) ||
                     (agentSignal.signal === 'bullish' && !actuallyProfit);
      }

      // Neutral signals are neither correct nor incorrect — skip them
      if (agentSignal.signal === 'neutral') continue;

      this.recordPerformance(agentName, wasCorrect, agentSignal.confidence);
    }
  }

  /**
   * Calculate Brier score for an agent
   * Brier score measures how well an agent's confidence matches actual outcomes
   * Score of 0 = perfect calibration, 1 = worst possible
   */
  calculateBrierScore(agentName: AgentName): number {
    const records = this.detailedPerformance.get(agentName);
    if (!records || records.length === 0) return 0.25; // Default: random baseline

    let sumSquaredErrors = 0;
    for (const record of records) {
      const outcome = record.wasCorrect ? 1 : 0;
      const forecast = record.predictedConfidence;
      sumSquaredErrors += (forecast - outcome) ** 2;
    }

    return sumSquaredErrors / records.length;
  }

  /**
   * Get comprehensive performance metrics for an agent
   */
  getAgentMetrics(agentName: AgentName): AgentPerformanceMetrics {
    const history = this.performanceHistory.get(agentName) || [];
    const detailed = this.detailedPerformance.get(agentName) || [];

    const samples = history.length;
    const accuracy = samples > 0 ? history.reduce((a, b) => a + b, 0) / samples : 0.5;

    // Recent accuracy (last 20 trades)
    const recent = history.slice(-20);
    const recentAccuracy = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.5;

    // Brier score
    const brierScore = this.calculateBrierScore(agentName);

    // Calibration: average confidence vs actual accuracy
    let avgConfidence = 0.5;
    if (detailed.length > 0) {
      avgConfidence = detailed.reduce((sum, r) => sum + r.predictedConfidence, 0) / detailed.length;
    }
    const calibration = Math.abs(avgConfidence - accuracy);

    // Weight adjustment: combine accuracy and calibration
    const weightAdjustment = this.computeWeightAdjustment(accuracy, brierScore, samples);

    return { accuracy, brierScore, calibration, samples, recentAccuracy, weightAdjustment };
  }

  /**
   * Compute weight adjustment multiplier from performance metrics
   * Range: 0.5 (worst) to 1.5 (best)
   *
   * Uses a combination of:
   * - Accuracy: agents with >70% get boosted, <40% get halved
   * - Brier score: well-calibrated agents get extra boost
   * - Minimum samples: need MIN_SAMPLES_FOR_ADJUSTMENT before adjusting
   */
  private computeWeightAdjustment(accuracy: number, brierScore: number, samples: number): number {
    if (samples < this.MIN_SAMPLES_FOR_ADJUSTMENT) {
      return 1.0; // Not enough data, use default weight
    }

    // Base adjustment from accuracy (0.5 at 0% accuracy, 1.0 at 50%, 1.5 at 100%)
    let adjustment = 0.5 + accuracy;

    // Brier score bonus/penalty (good calibration = lower brier score)
    // Perfect Brier = 0 → +0.1 bonus, Terrible Brier = 0.5+ → -0.1 penalty
    const brierAdjustment = 0.1 * (1 - brierScore * 4); // Maps 0→+0.1, 0.25→0, 0.5→-0.1
    adjustment += Math.max(-0.1, Math.min(0.1, brierAdjustment));

    // Phase 15B / Phase 32: Hard penalty for under-performing agents.
    // Pre-Phase-32 the threshold was 0.40 (an agent at ≤40% accuracy got
    // halved). Phase 32 tightens to 0.45 — anything below break-even after
    // accounting for the platform's natural mean-reversion bias is treated
    // as actively harmful. Random-flipping agents at 0.50 are spared so
    // that a noisy-but-honest signal doesn't get gutted on a small sample.
    // Phase 30 made the feedback loop actually populate `accuracy`, so this
    // gate now has live data to act on (pre-Phase-30 it was dormant).
    if (accuracy < 0.45 && samples >= this.MIN_SAMPLES_FOR_ADJUSTMENT) {
      adjustment *= 0.5;
    }

    // Clamp to safe range
    return Math.max(0.25, Math.min(1.5, adjustment)); // Lowered floor from 0.5 to 0.25 for poor agents
  }

  /**
   * Recalculate all agent weights based on accumulated performance data
   * Called periodically (every WEIGHT_RECALC_INTERVAL recordings)
   * Persists updated weights to database
   */
  recalculateWeightsFromPerformance(): void {
    let adjustmentsMade = 0;

    for (const agentName of ALL_AGENTS) {
      const metrics = this.getAgentMetrics(agentName);

      if (metrics.samples < this.MIN_SAMPLES_FOR_ADJUSTMENT) continue;

      const currentWeight = this.weights.get(agentName) || 0;
      if (currentWeight === 0) continue; // Don't adjust disabled agents

      const category = this.getAgentCategory(agentName);
      if (!category) continue;

      // Get default weight for this agent
      const defaultWeight = DEFAULT_AGENT_WEIGHTS[agentName];

      // New weight = default weight * performance adjustment
      const newWeight = defaultWeight * metrics.weightAdjustment;
      const clampedWeight = Math.max(0, Math.min(100, newWeight));

      if (Math.abs(clampedWeight - currentWeight) > 0.5) {
        this.weights.set(agentName, clampedWeight);
        adjustmentsMade++;

        agentLogger.info('Weight adjusted', { agentName, oldWeight: currentWeight.toFixed(1), newWeight: clampedWeight.toFixed(1), accuracyPct: (metrics.accuracy * 100).toFixed(1), brierScore: metrics.brierScore.toFixed(3), samples: metrics.samples });
      }
    }

    if (adjustmentsMade > 0) {
      agentLogger.info('Recalculated agent weights from performance data', { adjustmentsMade });
      this.emit('weights_recalculated', this.getConfig());

      // Persist to database (async, non-blocking)
      this.saveToDatabase().catch(err => {
        agentLogger.error('Failed to persist recalculated weights', { error: (err as Error)?.message });
      });
    }
  }

  /**
   * Get consensus weights formatted for AutomatedSignalProcessor
   * Returns normalized weights (0-1 range) for all agents
   * This is the single source of truth for agent weights across the system
   */
  getConsensusWeights(): Record<string, number> {
    const weights: Record<string, number> = {};

    for (const agentName of ALL_AGENTS) {
      const score = this.calculateAgentWeight(agentName);
      if (score) {
        weights[agentName] = score.finalWeight;
      }
    }

    return weights;
  }
  
  /**
   * Get current configuration
   */
  getConfig(): AgentWeightConfig {
    const weights: Record<string, number> = {};
    for (const [agent, weight] of this.weights.entries()) {
      weights[agent] = weight;
    }
    
    const categoryMultipliers: Record<string, number> = {};
    for (const [category, multiplier] of this.categoryMultipliers.entries()) {
      categoryMultipliers[category] = multiplier;
    }
    
    return {
      userId: this.userId,
      weights: weights as Record<AgentName, number>,
      categoryMultipliers: categoryMultipliers as Record<AgentCategory, number>,
      timeframeBonus: this.timeframeBonus,
      isActive: this.isActive,
    };
  }
  
  /**
   * Update configuration from object
   */
  updateConfig(config: Partial<AgentWeightConfig>): void {
    if (config.weights) {
      for (const [agent, weight] of Object.entries(config.weights)) {
        this.setAgentWeight(agent as AgentName, weight);
      }
    }
    
    if (config.categoryMultipliers) {
      for (const [category, multiplier] of Object.entries(config.categoryMultipliers)) {
        this.setCategoryMultiplier(category as AgentCategory, multiplier);
      }
    }
    
    if (config.timeframeBonus !== undefined) {
      this.timeframeBonus = config.timeframeBonus;
    }
    
    if (config.isActive !== undefined) {
      this.isActive = config.isActive;
    }
    
    this.emit('config_updated', this.getConfig());
  }
  
  /**
   * Reset to default weights
   */
  resetToDefaults(): void {
    this.initializeDefaults();
    this.emit('config_reset', this.getConfig());
  }
  
  /**
   * Get performance summary for all agents (enhanced with Brier score)
   */
  getPerformanceSummary(): Record<AgentName, AgentPerformanceMetrics> {
    const summary: Record<string, AgentPerformanceMetrics> = {};

    for (const agent of ALL_AGENTS) {
      summary[agent] = this.getAgentMetrics(agent);
    }

    return summary as Record<AgentName, AgentPerformanceMetrics>;
  }
}

// Singleton instance
let agentWeightManagerInstance: AgentWeightManager | null = null;

export function getAgentWeightManager(userId: number = 1): AgentWeightManager {
  if (!agentWeightManagerInstance || agentWeightManagerInstance['userId'] !== userId) {
    agentWeightManagerInstance = new AgentWeightManager(userId);
  }
  return agentWeightManagerInstance;
}

export default AgentWeightManager;
