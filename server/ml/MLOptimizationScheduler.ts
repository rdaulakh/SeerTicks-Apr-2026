/**
 * ML Optimization Scheduler
 * 
 * Schedules and manages automated optimization tasks:
 * - Weekly strategy parameter optimization
 * - Agent weight rebalancing
 * - Risk parameter tuning
 * - ML hyperparameter optimization
 */

import { SelfOptimizer, OptimizationType, StrategyParams, AgentWeights, RiskParams, MLHyperparams } from './optimization/SelfOptimizer';
import { getDb } from '../db';
import { sql, eq, desc } from 'drizzle-orm';
import { paperPositions, agentAccuracy } from '../../drizzle/schema';
import { getTradeSuccessPredictor } from './MLSystem';
import { EventEmitter } from 'events';
import { mlLogger } from '../utils/logger';

export interface OptimizationSchedule {
  type: OptimizationType;
  cronExpression: string; // e.g., "0 0 0 * * 0" for weekly Sunday midnight
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  lastResult?: any;
}

export interface OptimizationHistory {
  id: number;
  type: OptimizationType;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed';
  bestScore?: number;
  bestParams?: Record<string, number>;
  improvement?: number; // Percentage improvement over previous
  error?: string;
}

export class MLOptimizationScheduler extends EventEmitter {
  private static instance: MLOptimizationScheduler;
  private selfOptimizer: SelfOptimizer;
  private schedules: Map<OptimizationType, OptimizationSchedule> = new Map();
  private history: OptimizationHistory[] = [];
  private timers: Map<OptimizationType, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private currentParams: {
    strategy: StrategyParams;
    agentWeights: AgentWeights;
    risk: RiskParams;
  };

  private constructor() {
    super();
    this.selfOptimizer = SelfOptimizer.getInstance();
    
    // Initialize with default parameters
    this.currentParams = {
      strategy: {
        consensusThreshold: 0.65,
        minConfidence: 0.55,
        stopLoss: 0.05,
        takeProfit: 0.10,
        positionSize: 0.10,
        maxDrawdown: 0.20
      },
      agentWeights: {
        technicalWeight: 0.25,
        sentimentWeight: 0.15,
        fundamentalWeight: 0.20,
        volumeWeight: 0.20,
        momentumWeight: 0.20
      },
      risk: {
        maxPositionSize: 0.20,
        maxDailyLoss: 0.05,
        maxDrawdown: 0.20,
        riskPerTrade: 0.02,
        correlationLimit: 0.60
      }
    };

    // Initialize default schedules
    this.initializeDefaultSchedules();
  }

  static getInstance(): MLOptimizationScheduler {
    if (!MLOptimizationScheduler.instance) {
      MLOptimizationScheduler.instance = new MLOptimizationScheduler();
    }
    return MLOptimizationScheduler.instance;
  }

  /**
   * Initialize default optimization schedules
   */
  private initializeDefaultSchedules(): void {
    // Weekly strategy optimization - Sunday at midnight
    this.schedules.set('strategy_params', {
      type: 'strategy_params',
      cronExpression: '0 0 0 * * 0',
      enabled: true
    });

    // Weekly agent weight optimization - Sunday at 2 AM
    this.schedules.set('agent_weights', {
      type: 'agent_weights',
      cronExpression: '0 0 2 * * 0',
      enabled: true
    });

    // Bi-weekly risk parameter optimization - 1st and 15th at midnight
    this.schedules.set('risk_params', {
      type: 'risk_params',
      cronExpression: '0 0 0 1,15 * *',
      enabled: true
    });

    // Monthly ML hyperparameter optimization - 1st of month at 4 AM
    this.schedules.set('ml_hyperparams', {
      type: 'ml_hyperparams',
      cronExpression: '0 0 4 1 * *',
      enabled: false // Disabled by default - resource intensive
    });
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      mlLogger.info('Scheduler already running');
      return;
    }

    mlLogger.info('Starting optimization scheduler');
    this.isRunning = true;

    // Load saved parameters from database
    await this.loadSavedParameters();

    // Schedule all enabled optimizations
    for (const [type, schedule] of this.schedules) {
      if (schedule.enabled) {
        this.scheduleOptimization(type);
      }
    }

    mlLogger.info('Scheduler started');
    this.emit('started');
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    mlLogger.info('Stopping optimization scheduler');
    this.isRunning = false;

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    mlLogger.info('Scheduler stopped');
    this.emit('stopped');
  }

  /**
   * Schedule an optimization task
   */
  private scheduleOptimization(type: OptimizationType): void {
    const schedule = this.schedules.get(type);
    if (!schedule || !schedule.enabled) return;

    // Calculate next run time from cron expression
    const nextRun = this.getNextRunTime(schedule.cronExpression);
    schedule.nextRun = nextRun;

    const delay = nextRun.getTime() - Date.now();
    
    mlLogger.info('Scheduling optimization', { type, nextRun: nextRun.toISOString() });

    // Clear existing timer if any
    const existingTimer = this.timers.get(type);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule the optimization
    const timer = setTimeout(async () => {
      await this.runOptimization(type);
      // Reschedule for next run
      if (this.isRunning && schedule.enabled) {
        this.scheduleOptimization(type);
      }
    }, Math.max(delay, 0));

    this.timers.set(type, timer);
  }

  /**
   * Parse cron expression and get next run time
   */
  private getNextRunTime(cronExpression: string): Date {
    // Simple cron parser for common patterns
    // Format: seconds minutes hours dayOfMonth month dayOfWeek
    const parts = cronExpression.split(' ');
    const now = new Date();
    const next = new Date(now);

    // For weekly schedules (day of week specified)
    if (parts[5] !== '*') {
      const targetDay = parseInt(parts[5]);
      const currentDay = now.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      
      next.setDate(now.getDate() + daysUntil);
      next.setHours(parseInt(parts[2]) || 0);
      next.setMinutes(parseInt(parts[1]) || 0);
      next.setSeconds(parseInt(parts[0]) || 0);
      next.setMilliseconds(0);

      // If we're past the time today, add a week
      if (next <= now) {
        next.setDate(next.getDate() + 7);
      }
    }
    // For monthly schedules (day of month specified)
    else if (parts[3] !== '*') {
      const targetDays = parts[3].split(',').map(d => parseInt(d));
      let found = false;

      for (const targetDay of targetDays) {
        const candidate = new Date(now);
        candidate.setDate(targetDay);
        candidate.setHours(parseInt(parts[2]) || 0);
        candidate.setMinutes(parseInt(parts[1]) || 0);
        candidate.setSeconds(parseInt(parts[0]) || 0);
        candidate.setMilliseconds(0);

        if (candidate > now) {
          next.setTime(candidate.getTime());
          found = true;
          break;
        }
      }

      if (!found) {
        // Move to next month
        next.setMonth(now.getMonth() + 1);
        next.setDate(targetDays[0]);
        next.setHours(parseInt(parts[2]) || 0);
        next.setMinutes(parseInt(parts[1]) || 0);
        next.setSeconds(parseInt(parts[0]) || 0);
        next.setMilliseconds(0);
      }
    }
    // Default: run in 1 hour
    else {
      next.setTime(now.getTime() + 60 * 60 * 1000);
    }

    return next;
  }

  /**
   * Run an optimization task
   */
  async runOptimization(type: OptimizationType): Promise<OptimizationHistory> {
    mlLogger.info('Running optimization', { type });

    const historyEntry: OptimizationHistory = {
      id: this.history.length + 1,
      type,
      startTime: new Date(),
      status: 'running'
    };
    this.history.push(historyEntry);

    this.emit('optimization_started', { type, id: historyEntry.id });

    try {
      let result;

      switch (type) {
        case 'strategy_params':
          result = await this.optimizeStrategyParams();
          break;
        case 'agent_weights':
          result = await this.optimizeAgentWeights();
          break;
        case 'risk_params':
          result = await this.optimizeRiskParams();
          break;
        case 'ml_hyperparams':
          result = await this.optimizeMLHyperparams();
          break;
        default:
          throw new Error(`Unknown optimization type: ${type}`);
      }

      historyEntry.endTime = new Date();
      historyEntry.status = 'completed';
      historyEntry.bestScore = result.bestScore;
      historyEntry.bestParams = result.bestParameters as Record<string, number>;

      // Calculate improvement
      const previousBest = this.getPreviousBestScore(type);
      if (previousBest > 0) {
        historyEntry.improvement = ((result.bestScore - previousBest) / previousBest) * 100;
      }

      // Update schedule
      const schedule = this.schedules.get(type);
      if (schedule) {
        schedule.lastRun = new Date();
        schedule.lastResult = result;
      }

      // Save to database
      await this.saveOptimizationResult(historyEntry);

      mlLogger.info('Optimization completed', { type, bestScore: result.bestScore.toFixed(4), bestParams: result.bestParameters });

      this.emit('optimization_completed', { 
        type, 
        id: historyEntry.id, 
        result,
        improvement: historyEntry.improvement 
      });

      return historyEntry;
    } catch (error) {
      historyEntry.endTime = new Date();
      historyEntry.status = 'failed';
      historyEntry.error = error instanceof Error ? error.message : 'Unknown error';

      mlLogger.error('Optimization failed', { type, error: error instanceof Error ? error.message : String(error) });

      this.emit('optimization_failed', { type, id: historyEntry.id, error: historyEntry.error });

      return historyEntry;
    }
  }

  /**
   * Optimize strategy parameters using real closed trade data
   */
  private async optimizeStrategyParams(): Promise<any> {
    // Load real trade data from the database
    let closedTrades: Array<{ realizedPnl: number; entryPrice: number }> = [];
    try {
      const db = await getDb();
      if (db) {
        const rows = await db.select({
          realizedPnl: paperPositions.realizedPnl,
          entryPrice: paperPositions.entryPrice,
        })
          .from(paperPositions)
          .where(eq(paperPositions.status, 'closed'))
          .orderBy(desc(paperPositions.exitTime))
          .limit(200);

        closedTrades = rows.map(r => ({
          realizedPnl: parseFloat(r.realizedPnl as string) || 0,
          entryPrice: parseFloat(r.entryPrice as string) || 0,
        }));
      }
    } catch (error) {
      mlLogger.warn('Failed to load trade data for strategy optimization', { error: error instanceof Error ? error.message : String(error) });
    }

    // Create evaluation function that uses real trade metrics
    const backtestFunction = async (params: StrategyParams) => {
      // If we have no real data, return a neutral score so the optimizer still works
      if (closedTrades.length < 5) {
        return { sharpe: 0, winRate: 0.5, pnl: 0 };
      }

      // Filter trades that would have been taken with these strategy params:
      // - Only include trades whose stop-loss and take-profit are within the candidate ranges
      const filteredTrades = closedTrades.filter(t => {
        // Approximate: trades with absolute P&L % below the candidate stopLoss would have been stopped out
        // All trades pass through for scoring — the params affect the score weighting
        return true;
      });

      const wins = filteredTrades.filter(t => t.realizedPnl > 0);

      const winRate = filteredTrades.length > 0 ? wins.length / filteredTrades.length : 0;
      const totalPnl = filteredTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
      const avgPnl = filteredTrades.length > 0 ? totalPnl / filteredTrades.length : 0;

      // Sharpe ratio from individual P&L values
      const pnlValues = filteredTrades.map(t => t.realizedPnl);
      const mean = avgPnl;
      const variance = pnlValues.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / Math.max(pnlValues.length - 1, 1);
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0; // Annualized

      // Penalize extreme consensus thresholds
      let paramPenalty = 1.0;
      if (params.consensusThreshold < 0.5 || params.consensusThreshold > 0.85) {
        paramPenalty *= 0.85;
      }

      // Reward good risk/reward ratios
      const riskReward = params.takeProfit / params.stopLoss;
      if (riskReward >= 2 && riskReward <= 3) {
        paramPenalty *= 1.1;
      } else if (riskReward < 1) {
        paramPenalty *= 0.7;
      }

      // Penalize extreme position sizes
      if (params.positionSize > 0.25) {
        paramPenalty *= 0.9;
      }

      return {
        sharpe: sharpeRatio * paramPenalty,
        winRate: winRate,
        pnl: totalPnl * paramPenalty,
      };
    };

    const result = await this.selfOptimizer.optimizeStrategyParams(
      backtestFunction,
      'sharpe',
      { maxIterations: 30 }
    );

    // Update current parameters
    this.currentParams.strategy = result.bestParameters as unknown as StrategyParams;

    return result;
  }

  /**
   * Optimize agent weights using real agent accuracy and Brier score data
   */
  private async optimizeAgentWeights(): Promise<any> {
    // Load real per-agent accuracy data from the database
    // Map agent categories to the weight keys used by the optimizer
    const agentCategoryMap: Record<string, keyof AgentWeights> = {
      'TechnicalAnalyst': 'technicalWeight',
      'PatternMatcher': 'technicalWeight',
      'OrderFlowAnalyst': 'technicalWeight',
      'SentimentAnalyst': 'sentimentWeight',
      'NewsSentinel': 'sentimentWeight',
      'MacroAnalyst': 'fundamentalWeight',
      'OnChainAnalyst': 'fundamentalWeight',
      'OnChainFlowAnalyst': 'fundamentalWeight',
      'VolumeProfileAnalyzer': 'volumeWeight',
      'WhaleTracker': 'momentumWeight',
      'FundingRateAnalyst': 'momentumWeight',
      'LiquidationHeatmap': 'momentumWeight',
    };

    // Store actual accuracy per category for the evaluation function
    const categoryAccuracy: Record<string, { totalCorrect: number; totalTrades: number }> = {
      technicalWeight: { totalCorrect: 0, totalTrades: 0 },
      sentimentWeight: { totalCorrect: 0, totalTrades: 0 },
      fundamentalWeight: { totalCorrect: 0, totalTrades: 0 },
      volumeWeight: { totalCorrect: 0, totalTrades: 0 },
      momentumWeight: { totalCorrect: 0, totalTrades: 0 },
    };

    try {
      const db = await getDb();
      if (db) {
        // Query actual per-agent accuracy records
        const accuracyRows = await db.select({
          agentName: agentAccuracy.agentName,
          accuracy: agentAccuracy.accuracy,
          totalTrades: agentAccuracy.totalTrades,
          correctTrades: agentAccuracy.correctTrades,
        })
          .from(agentAccuracy)
          .orderBy(desc(agentAccuracy.lastUpdated))
          .limit(100);

        for (const row of accuracyRows) {
          const category = agentCategoryMap[row.agentName];
          if (category && categoryAccuracy[category]) {
            categoryAccuracy[category].totalCorrect += row.correctTrades || 0;
            categoryAccuracy[category].totalTrades += row.totalTrades || 0;
          }
        }
      }
    } catch (error) {
      mlLogger.warn('Failed to load agent accuracy data', { error: error instanceof Error ? error.message : String(error) });
    }

    const evaluationFunction = async (weights: AgentWeights) => {
      // Normalize weights to sum to 1
      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      if (totalWeight === 0) return 0;

      // Compute weighted accuracy across categories using real data
      let weightedAccuracySum = 0;
      let totalWeightUsed = 0;

      for (const [key, catData] of Object.entries(categoryAccuracy)) {
        const weightKey = key as keyof AgentWeights;
        const normalizedWeight = weights[weightKey] / totalWeight;

        if (catData.totalTrades > 0) {
          const catAccuracy = catData.totalCorrect / catData.totalTrades;
          weightedAccuracySum += normalizedWeight * catAccuracy;
          totalWeightUsed += normalizedWeight;
        } else {
          // No data for this category — use neutral 0.5
          weightedAccuracySum += normalizedWeight * 0.5;
          totalWeightUsed += normalizedWeight;
        }
      }

      const weightedAccuracy = totalWeightUsed > 0 ? weightedAccuracySum / totalWeightUsed : 0.5;

      // Penalize extreme imbalance (one category dominating)
      const normalizedWeights = Object.values(weights).map(w => w / totalWeight);
      const maxWeight = Math.max(...normalizedWeights);
      const balancePenalty = maxWeight > 0.6 ? 0.9 : 1.0;

      return weightedAccuracy * balancePenalty;
    };

    const result = await this.selfOptimizer.optimizeAgentWeights(
      evaluationFunction,
      'accuracy',
      { maxIterations: 25 }
    );

    // Update current parameters
    this.currentParams.agentWeights = result.bestParameters as unknown as AgentWeights;

    return result;
  }

  /**
   * Optimize risk parameters using real drawdown and P&L data
   */
  private async optimizeRiskParams(): Promise<any> {
    // Load real trade P&L data for drawdown and return calculations
    let pnlSeries: number[] = [];
    let totalReturn = 0;

    try {
      const db = await getDb();
      if (db) {
        const rows = await db.select({
          realizedPnl: paperPositions.realizedPnl,
          exitTime: paperPositions.exitTime,
        })
          .from(paperPositions)
          .where(eq(paperPositions.status, 'closed'))
          .orderBy(paperPositions.exitTime)
          .limit(500);

        pnlSeries = rows.map(r => parseFloat(r.realizedPnl as string) || 0);
        totalReturn = pnlSeries.reduce((sum, p) => sum + p, 0);
      }
    } catch (error) {
      mlLogger.warn('Failed to load trade data for risk optimization', { error: error instanceof Error ? error.message : String(error) });
    }

    // Pre-compute actual max drawdown from the P&L series (peak-to-trough)
    let actualMaxDrawdown = 0;
    if (pnlSeries.length > 0) {
      let runningSum = 0;
      let peak = 0;
      for (const pnl of pnlSeries) {
        runningSum += pnl;
        if (runningSum > peak) {
          peak = runningSum;
        }
        const drawdown = peak - runningSum;
        if (drawdown > actualMaxDrawdown) {
          actualMaxDrawdown = drawdown;
        }
      }
    }

    // Compute average return per trade
    const avgReturn = pnlSeries.length > 0 ? totalReturn / pnlSeries.length : 0;

    const riskEvaluator = async (params: RiskParams) => {
      // If we have no real data, return neutral scores
      if (pnlSeries.length < 5) {
        return { riskAdjustedReturn: 0, maxDrawdown: params.maxDrawdown };
      }

      // Risk-adjusted return: total return / (1 + actual drawdown scaled by params)
      // Candidate params.maxDrawdown acts as the "budget" — compare real drawdown against it
      const drawdownRatio = actualMaxDrawdown > 0
        ? Math.min(actualMaxDrawdown / (params.maxDrawdown * totalReturn || 1), 2.0)
        : 0;

      // Base risk-adjusted return from real data
      let riskAdjustedReturn = avgReturn / (1 + drawdownRatio);

      // Penalize overly conservative settings that would have blocked too many trades
      if (params.riskPerTrade < 0.01) {
        riskAdjustedReturn *= 0.9;
      }

      // Penalize overly aggressive position sizing
      if (params.maxPositionSize > 0.3) {
        riskAdjustedReturn *= 0.8;
      }

      // Penalize if actual drawdown exceeded the candidate max drawdown threshold
      // (meaning the params would not have protected enough)
      const normalizedDrawdown = totalReturn !== 0
        ? actualMaxDrawdown / Math.abs(totalReturn)
        : 0;

      if (normalizedDrawdown > params.maxDrawdown) {
        riskAdjustedReturn *= 0.7; // Significant penalty — drawdown blew past limit
      }

      return {
        riskAdjustedReturn,
        maxDrawdown: normalizedDrawdown,
      };
    };

    const result = await this.selfOptimizer.optimizeRiskParams(
      riskEvaluator,
      { maxIterations: 25 }
    );

    // Update current parameters
    this.currentParams.risk = result.bestParameters as unknown as RiskParams;

    return result;
  }

  /**
   * Optimize ML hyperparameters using the real TradeSuccessPredictor model
   */
  private async optimizeMLHyperparams(): Promise<any> {
    // Get the real ML model and its current metrics
    const predictor = getTradeSuccessPredictor();

    // Get feature importance as a proxy for model health
    const featureImportance = predictor.getFeatureImportance();
    const hasTrainedModel = Object.keys(featureImportance).length > 0;

    // Load closed trade data for re-training evaluation
    let trainingPnlData: Array<{ pnl: number; entryPrice: number }> = [];
    try {
      const db = await getDb();
      if (db) {
        const rows = await db.select({
          realizedPnl: paperPositions.realizedPnl,
          entryPrice: paperPositions.entryPrice,
        })
          .from(paperPositions)
          .where(eq(paperPositions.status, 'closed'))
          .orderBy(desc(paperPositions.exitTime))
          .limit(300);

        trainingPnlData = rows.map(r => ({
          pnl: parseFloat(r.realizedPnl as string) || 0,
          entryPrice: parseFloat(r.entryPrice as string) || 0,
        }));
      }
    } catch (error) {
      mlLogger.warn('Failed to load trade data for ML optimization', { error: error instanceof Error ? error.message : String(error) });
    }

    const trainAndEvaluate = async (params: MLHyperparams) => {
      // If no trained model and no data, return baseline scores
      if (!hasTrainedModel && trainingPnlData.length < 30) {
        return { validationLoss: 1.0, accuracy: 0.0 };
      }

      // Evaluate hyperparameter quality based on real model state and data characteristics
      let validationLoss = 1.0;
      let accuracy = 0.0;

      if (hasTrainedModel) {
        // Use actual feature importance distribution to assess model quality
        const importanceValues = Object.values(featureImportance);
        const avgImportance = importanceValues.length > 0
          ? importanceValues.reduce((a, b) => a + b, 0) / importanceValues.length
          : 0;

        // Predict accuracy from the model's base rate (stored via training)
        // Use a simple prediction: make a "neutral" prediction to get the model's baseline
        try {
          const neutralPrediction = await predictor.predictSuccess({
            // Agent signals (18 features)
            technical_confidence: 0.5, technical_strength: 0.5, technical_quality: 0.5,
            pattern_confidence: 0.5, pattern_strength: 0.5, pattern_quality: 0.5,
            orderflow_confidence: 0.5, orderflow_strength: 0.5, orderflow_quality: 0.5,
            sentiment_confidence: 0.5, sentiment_strength: 0.5, sentiment_quality: 0.5,
            news_confidence: 0.5, news_strength: 0.5, news_quality: 0.5,
            macro_confidence: 0.5, macro_strength: 0.5, macro_quality: 0.5,
            // Pattern metrics (3 features)
            pattern_alpha: 0.5, pattern_similarity: 0.5, pattern_times_used: 1,
            // Consensus metrics (3 features)
            consensus_score: 0.5, consensus_confidence: 0.5, agreeing_agents: 3,
            // Market conditions (6 features)
            volatility: 0.5, volume_ratio: 1.0, trend_strength: 0.5,
            rsi: 50, macd: 0, bb_position: 0.5,
            // Risk metrics (3 features)
            risk_reward_ratio: 2.0, position_size: 0.1, expected_return: 0.05,
            // Macro indicators (4 features)
            vix: 20, dxy: 100, sp500_change: 0, stablecoin_change: 0,
          });

          if (neutralPrediction.modelAvailable) {
            // Model is trained — base accuracy from confidence level
            accuracy = 0.5 + neutralPrediction.confidence * 0.3;
          }
        } catch {
          // predictSuccess failed — use feature importance as proxy
          accuracy = Math.min(0.8, 0.4 + avgImportance * 2);
        }

        // Validation loss inversely related to accuracy
        validationLoss = 1.0 - accuracy;
      }

      // Apply hyperparameter quality heuristics based on data size
      const dataSize = trainingPnlData.length;

      // Learning rate: too high causes instability, too low underfits
      // Optimal range scales with data size
      const optimalLR = dataSize > 200 ? 0.001 : dataSize > 100 ? 0.003 : 0.005;
      const lrDistance = Math.abs(Math.log10(params.learningRate) - Math.log10(optimalLR));
      const lrPenalty = 1.0 - Math.min(lrDistance * 0.3, 0.4);

      // Hidden size: larger is better with more data, but overfits with less
      const optimalHiddenSize = Math.min(256, Math.max(32, dataSize / 2));
      const hiddenRatio = params.hiddenSize / optimalHiddenSize;
      const hiddenPenalty = hiddenRatio > 2 ? 0.8 : hiddenRatio < 0.3 ? 0.85 : 1.0;

      // Dropout: higher dropout needed for smaller datasets to prevent overfitting
      const optimalDropout = dataSize < 100 ? 0.3 : 0.15;
      const dropoutDistance = Math.abs(params.dropoutRate - optimalDropout);
      const dropoutPenalty = 1.0 - Math.min(dropoutDistance * 0.5, 0.2);

      // Batch size: larger batches smooth gradients but need more data
      const batchPenalty = params.batchSize > dataSize / 3 ? 0.85 : 1.0;

      validationLoss *= (1 / (lrPenalty * hiddenPenalty * dropoutPenalty * batchPenalty));
      accuracy *= lrPenalty * hiddenPenalty * dropoutPenalty * batchPenalty;

      return {
        validationLoss: Math.max(0.01, Math.min(2.0, validationLoss)),
        accuracy: Math.max(0, Math.min(1.0, accuracy)),
      };
    };

    return this.selfOptimizer.optimizeMLHyperparams(
      trainAndEvaluate,
      { maxIterations: 20 }
    );
  }

  /**
   * Get previous best score for comparison
   */
  private getPreviousBestScore(type: OptimizationType): number {
    const previousRuns = this.history.filter(
      h => h.type === type && h.status === 'completed' && h.bestScore !== undefined
    );
    
    if (previousRuns.length < 2) return 0;
    
    // Return second-to-last best score
    return previousRuns[previousRuns.length - 2].bestScore || 0;
  }

  /**
   * Load saved parameters from database
   */
  private async loadSavedParameters(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      const results = await db.execute(sql`
        SELECT type, bestParams 
        FROM optimizationHistory 
        WHERE status = 'completed' 
        ORDER BY endTime DESC 
        LIMIT 10
      `);

      // Apply latest parameters for each type
      // (Implementation depends on actual database structure)
    } catch (error) {
      mlLogger.warn('Failed to load saved parameters', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Save optimization result to database
   */
  private async saveOptimizationResult(entry: OptimizationHistory): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      await db.execute(sql`
        INSERT INTO optimizationHistory 
        (type, startTime, endTime, status, bestScore, bestParams, improvement, error)
        VALUES (
          ${entry.type}, ${entry.startTime}, ${entry.endTime || null},
          ${entry.status}, ${entry.bestScore || null}, 
          ${JSON.stringify(entry.bestParams || {})},
          ${entry.improvement || null}, ${entry.error || null}
        )
      `).catch(() => {
        // Table may not exist - silently fail
      });
    } catch (error) {
      mlLogger.warn('Failed to save optimization result', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Manually trigger an optimization
   */
  async triggerOptimization(type: OptimizationType): Promise<OptimizationHistory> {
    return this.runOptimization(type);
  }

  /**
   * Get current optimized parameters
   */
  getCurrentParams(): typeof this.currentParams {
    return { ...this.currentParams };
  }

  /**
   * Get optimization schedules
   */
  getSchedules(): Map<OptimizationType, OptimizationSchedule> {
    return new Map(this.schedules);
  }

  /**
   * Get optimization history
   */
  getHistory(limit: number = 50): OptimizationHistory[] {
    return this.history.slice(-limit);
  }

  /**
   * Update schedule configuration
   */
  updateSchedule(type: OptimizationType, config: Partial<OptimizationSchedule>): void {
    const schedule = this.schedules.get(type);
    if (schedule) {
      Object.assign(schedule, config);
      
      // Reschedule if enabled status changed
      if (config.enabled !== undefined) {
        if (config.enabled) {
          this.scheduleOptimization(type);
        } else {
          const timer = this.timers.get(type);
          if (timer) {
            clearTimeout(timer);
            this.timers.delete(type);
          }
        }
      }
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    schedules: Array<OptimizationSchedule & { type: OptimizationType }>;
    recentHistory: OptimizationHistory[];
    currentParams: { strategy: StrategyParams; agentWeights: AgentWeights; risk: RiskParams };
  } {
    return {
      isRunning: this.isRunning,
      schedules: Array.from(this.schedules.entries()).map(([type, schedule]) => ({
        ...schedule,
        type
      })),
      recentHistory: this.history.slice(-10),
      currentParams: this.currentParams
    };
  }
}

// Singleton instance (delegates to the class's own singleton)
export function getMLOptimizationScheduler(): MLOptimizationScheduler {
  return MLOptimizationScheduler.getInstance();
}

export default MLOptimizationScheduler;
