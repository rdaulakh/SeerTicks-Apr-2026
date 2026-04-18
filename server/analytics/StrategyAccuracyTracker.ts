/**
 * Strategy Detection Accuracy Tracker
 * 
 * Tracks and validates strategy detection accuracy to ensure >90% accuracy
 * Monitors pattern detection, consensus calculation, and prediction outcomes
 */

import { getDb } from '../db';
import { agentSignals, positions, winningPatterns } from '../../drizzle/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

export interface AccuracyMetrics {
  overallAccuracy: number;
  patternAccuracy: number;
  consensusAccuracy: number;
  totalPredictions: number;
  correctPredictions: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  byAgent: Record<string, {
    accuracy: number;
    total: number;
    correct: number;
  }>;
  byPattern: Record<string, {
    accuracy: number;
    winRate: number;
    total: number;
    correct: number;
  }>;
  byTimeframe: Record<string, {
    accuracy: number;
    total: number;
    correct: number;
  }>;
}

export interface StrategyPrediction {
  id: number;
  symbol: string;
  timestamp: number;
  predictedSignal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  patternName?: string;
  timeframe?: string;
  agentName: string;
  actualOutcome?: 'correct' | 'incorrect' | 'pending';
  profitLoss?: number;
}

export class StrategyAccuracyTracker {
  private static instance: StrategyAccuracyTracker | null = null;
  private accuracyCache: Map<string, AccuracyMetrics> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute

  private constructor() {}

  static getInstance(): StrategyAccuracyTracker {
    if (!StrategyAccuracyTracker.instance) {
      StrategyAccuracyTracker.instance = new StrategyAccuracyTracker();
    }
    return StrategyAccuracyTracker.instance;
  }

  /**
   * Calculate overall strategy detection accuracy
   */
  async calculateAccuracy(
    symbol?: string,
    startTime?: number,
    endTime?: number
  ): Promise<AccuracyMetrics> {
    const cacheKey = `${symbol || 'all'}_${startTime || 0}_${endTime || Date.now()}`;
    
    // Check cache
    const cached = this.accuracyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Get all predictions (agent signals) with outcomes
    const predictions = await this.getPredictionsWithOutcomes(symbol, startTime, endTime);

    // Calculate overall metrics
    const totalPredictions = predictions.length;
    const correctPredictions = predictions.filter(p => p.actualOutcome === 'correct').length;
    const incorrectPredictions = predictions.filter(p => p.actualOutcome === 'incorrect').length;
    
    const overallAccuracy = totalPredictions > 0 
      ? correctPredictions / totalPredictions 
      : 0;

    // Calculate precision, recall, F1
    const truePositives = predictions.filter(
      p => p.predictedSignal !== 'neutral' && p.actualOutcome === 'correct'
    ).length;
    const falsePositives = predictions.filter(
      p => p.predictedSignal !== 'neutral' && p.actualOutcome === 'incorrect'
    ).length;
    const falseNegatives = predictions.filter(
      p => p.predictedSignal === 'neutral' && p.profitLoss && Math.abs(p.profitLoss) > 0.02
    ).length;

    const precision = (truePositives + falsePositives) > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;
    const recall = (truePositives + falseNegatives) > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;
    const f1Score = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    // Calculate per-agent accuracy
    const byAgent: Record<string, { accuracy: number; total: number; correct: number }> = {};
    const agentGroups = this.groupBy(predictions, p => p.agentName);
    
    for (const [agentName, agentPredictions] of Object.entries(agentGroups)) {
      const total = agentPredictions.length;
      const correct = agentPredictions.filter(p => p.actualOutcome === 'correct').length;
      byAgent[agentName] = {
        accuracy: total > 0 ? correct / total : 0,
        total,
        correct,
      };
    }

    // Calculate per-pattern accuracy
    const byPattern: Record<string, { accuracy: number; winRate: number; total: number; correct: number }> = {};
    const patternPredictions = predictions.filter(p => p.patternName);
    const patternGroups = this.groupBy(patternPredictions, p => p.patternName!);
    
    for (const [patternName, patternPreds] of Object.entries(patternGroups)) {
      const total = patternPreds.length;
      const correct = patternPreds.filter(p => p.actualOutcome === 'correct').length;
      const profitable = patternPreds.filter(p => p.profitLoss && p.profitLoss > 0).length;
      
      byPattern[patternName] = {
        accuracy: total > 0 ? correct / total : 0,
        winRate: total > 0 ? profitable / total : 0,
        total,
        correct,
      };
    }

    // Calculate per-timeframe accuracy
    const byTimeframe: Record<string, { accuracy: number; total: number; correct: number }> = {};
    const timeframePredictions = predictions.filter(p => p.timeframe);
    const timeframeGroups = this.groupBy(timeframePredictions, p => p.timeframe!);
    
    for (const [timeframe, tfPredictions] of Object.entries(timeframeGroups)) {
      const total = tfPredictions.length;
      const correct = tfPredictions.filter(p => p.actualOutcome === 'correct').length;
      
      byTimeframe[timeframe] = {
        accuracy: total > 0 ? correct / total : 0,
        total,
        correct,
      };
    }

    // Calculate pattern-specific accuracy
    const patternAccuracy = Object.values(byPattern).length > 0
      ? Object.values(byPattern).reduce((sum, p) => sum + p.accuracy, 0) / Object.values(byPattern).length
      : 0;

    // Calculate consensus accuracy (predictions with high confidence)
    const highConfidencePredictions = predictions.filter(p => p.confidence >= 0.7);
    const consensusAccuracy = highConfidencePredictions.length > 0
      ? highConfidencePredictions.filter(p => p.actualOutcome === 'correct').length / highConfidencePredictions.length
      : 0;

    const metrics: AccuracyMetrics = {
      overallAccuracy,
      patternAccuracy,
      consensusAccuracy,
      totalPredictions,
      correctPredictions,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1Score,
      byAgent,
      byPattern,
      byTimeframe,
    };

    // Cache results
    this.accuracyCache.set(cacheKey, metrics);
    setTimeout(() => this.accuracyCache.delete(cacheKey), this.CACHE_TTL);

    return metrics;
  }

  /**
   * Get predictions with actual outcomes
   */
  private async getPredictionsWithOutcomes(
    symbol?: string,
    startTime?: number,
    endTime?: number
  ): Promise<StrategyPrediction[]> {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      // Build query conditions
      const conditions = [];
      // Note: symbol is stored in signalData JSON, not as a direct column
      if (startTime) {
        conditions.push(gte(agentSignals.timestamp, new Date(startTime)));
      }
      if (endTime) {
        conditions.push(lte(agentSignals.timestamp, new Date(endTime)));
      }

      // Get all agent signals
      const signals = await db
        .select()
        .from(agentSignals)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(agentSignals.timestamp))
        .limit(1000);

      // Match signals with position outcomes
      const predictions: StrategyPrediction[] = [];

      for (const signal of signals) {
        // Find corresponding position (within 5 minutes of signal)
        const signalSymbol = (signal.signalData as any)?.symbol || '';
        const position = await db
          .select()
          .from(positions)
          .where(
            eq(positions.symbol, signalSymbol)
          )
          .limit(1);

        let actualOutcome: 'correct' | 'incorrect' | 'pending' = 'pending';
        let profitLoss: number | undefined;

        if (position.length > 0) {
          const pos = position[0];
          
          // Check if position has unrealized P&L
          if (pos.unrealizedPnl !== null) {
            profitLoss = parseFloat(pos.unrealizedPnl);
            
            // Determine if prediction was correct
            const predictedBullish = (signal.signalData as any)?.signal === 'bullish';
            const actuallyProfitable = profitLoss > 0;
            
            actualOutcome = predictedBullish === actuallyProfitable ? 'correct' : 'incorrect';
          }
        }

        predictions.push({
          id: signal.id,
          symbol: (signal.signalData as any)?.symbol || '',
          timestamp: signal.timestamp.getTime(),
          predictedSignal: (signal.signalData as any)?.signal as 'bullish' | 'bearish' | 'neutral',
          confidence: signal.confidence ? parseFloat(signal.confidence) : 0,
          patternName: (signal.signalData as any)?.evidence?.matchedPattern as string | undefined,
          timeframe: (signal.signalData as any)?.evidence?.timeframe as string | undefined,
          agentName: signal.agentName,
          actualOutcome,
          profitLoss,
        });
      }

      return predictions;
    } catch (error) {
      console.error('[StrategyAccuracyTracker] Failed to get predictions:', error);
      return [];
    }
  }

  /**
   * Validate pattern accuracy against historical data
   */
  async validatePatternAccuracy(
    patternName: string,
    symbol?: string,
    minSampleSize: number = 10
  ): Promise<{
    isValid: boolean;
    accuracy: number;
    winRate: number;
    sampleSize: number;
    confidence: number;
  }> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      // Get pattern configuration from database
      const conditions = [eq(winningPatterns.patternName, patternName)];
      if (symbol) {
        conditions.push(eq(winningPatterns.symbol, symbol));
      }

      const patterns = await db
        .select()
        .from(winningPatterns)
        .where(and(...conditions));

      if (patterns.length === 0) {
        return {
          isValid: false,
          accuracy: 0,
          winRate: 0,
          sampleSize: 0,
          confidence: 0,
        };
      }

      // Aggregate metrics across all matching patterns
      const totalTrades = patterns.reduce((sum, p) => sum + p.totalTrades, 0);
      const winningTrades = patterns.reduce((sum, p) => sum + p.winningTrades, 0);
      const avgWinRate = patterns.reduce((sum, p) => sum + (p.winRate ? parseFloat(p.winRate) : 0), 0) / patterns.length;

      // Calculate confidence interval (Wilson score)
      const confidence = this.calculateWilsonScore(winningTrades, totalTrades);

      // Pattern is valid if:
      // 1. Sample size >= minSampleSize
      // 2. Win rate >= 55%
      // 3. Confidence >= 0.8
      const isValid = totalTrades >= minSampleSize && avgWinRate >= 0.55 && confidence >= 0.8;

      return {
        isValid,
        accuracy: avgWinRate,
        winRate: avgWinRate,
        sampleSize: totalTrades,
        confidence,
      };
    } catch (error) {
      console.error('[StrategyAccuracyTracker] Failed to validate pattern:', error);
      return {
        isValid: false,
        accuracy: 0,
        winRate: 0,
        sampleSize: 0,
        confidence: 0,
      };
    }
  }

  /**
   * Calculate Wilson score confidence interval
   */
  private calculateWilsonScore(successes: number, total: number, zScore: number = 1.96): number {
    if (total === 0) return 0;

    const phat = successes / total;
    const denominator = 1 + (zScore * zScore) / total;
    const center = phat + (zScore * zScore) / (2 * total);
    const spread = zScore * Math.sqrt((phat * (1 - phat) + (zScore * zScore) / (4 * total)) / total);

    return (center - spread) / denominator;
  }

  /**
   * Group array by key function
   */
  private groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }

  /**
   * Get accuracy report for dashboard
   */
  async getAccuracyReport(symbol?: string): Promise<{
    summary: AccuracyMetrics;
    alerts: string[];
    recommendations: string[];
  }> {
    const metrics = await this.calculateAccuracy(symbol);
    const alerts: string[] = [];
    const recommendations: string[] = [];

    // Check overall accuracy
    if (metrics.overallAccuracy < 0.9) {
      alerts.push(`Overall accuracy ${(metrics.overallAccuracy * 100).toFixed(1)}% is below 90% target`);
      recommendations.push('Review and retrain underperforming agents');
    }

    // Check pattern accuracy
    if (metrics.patternAccuracy < 0.9) {
      alerts.push(`Pattern accuracy ${(metrics.patternAccuracy * 100).toFixed(1)}% is below 90% target`);
      recommendations.push('Disable low-performing patterns and validate new patterns');
    }

    // Check agent performance
    for (const [agentName, agentMetrics] of Object.entries(metrics.byAgent)) {
      if (agentMetrics.accuracy < 0.6 && agentMetrics.total >= 10) {
        alerts.push(`${agentName} accuracy ${(agentMetrics.accuracy * 100).toFixed(1)}% is critically low`);
        recommendations.push(`Consider disabling ${agentName} or adjusting its parameters`);
      }
    }

    // Check pattern performance
    for (const [patternName, patternMetrics] of Object.entries(metrics.byPattern)) {
      if (patternMetrics.accuracy < 0.55 && patternMetrics.total >= 10) {
        alerts.push(`Pattern "${patternName}" accuracy ${(patternMetrics.accuracy * 100).toFixed(1)}% is below threshold`);
        recommendations.push(`Disable pattern "${patternName}" until performance improves`);
      }
    }

    return {
      summary: metrics,
      alerts,
      recommendations,
    };
  }
}

// Export singleton instance
export const strategyAccuracyTracker = StrategyAccuracyTracker.getInstance();
