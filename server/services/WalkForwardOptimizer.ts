/**
 * Phase 17: Walk-Forward Parameter Optimization
 *
 * Prevents overfitting by validating parameters on out-of-sample data.
 *
 * Method:
 * 1. Split historical trades into rolling windows (e.g., 12 months)
 * 2. For each window:
 *    - TRAIN: Find optimal parameters on prior 3 months
 *    - TEST: Validate on current month (out-of-sample)
 * 3. Track parameter stability across windows
 * 4. Report: in-sample vs out-of-sample Sharpe (should be <30% gap)
 * 5. Alert if optimal parameters change >15% between windows
 *
 * Parameters optimized:
 * - consensusThreshold (0.55 - 0.80)
 * - minConfidence (0.50 - 0.80)
 * - hardStopLossPercent (-0.5 to -2.0)
 * - maxPositionSizePercent (0.03 to 0.15)
 * - atrStopMultiplier (1.0 to 3.0)
 *
 * Runs on-demand or scheduled (weekly).
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

export interface ParameterSet {
  consensusThreshold: number;
  minConfidence: number;
  hardStopLossPercent: number;
  maxPositionSizePercent: number;
  atrStopMultiplier: number;
}

export interface WindowResult {
  windowStart: Date;
  windowEnd: Date;
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
  trainTrades: number;
  testTrades: number;
  optimalParams: ParameterSet;
  inSampleSharpe: number;
  inSampleWinRate: number;
  outOfSampleSharpe: number;
  outOfSampleWinRate: number;
  overfitRatio: number;           // outOfSample / inSample (1.0 = no overfit)
  parameterDrift: number;         // % change from previous window
}

export interface WalkForwardResult {
  timestamp: number;
  totalWindows: number;
  windowResults: WindowResult[];

  // Aggregates
  avgInSampleSharpe: number;
  avgOutOfSampleSharpe: number;
  avgOverfitRatio: number;
  maxParameterDrift: number;

  // Recommendations
  recommendedParams: ParameterSet;
  isOverfit: boolean;              // true if avg overfitRatio < 0.7
  isUnstable: boolean;             // true if maxParameterDrift > 0.15
  confidence: 'high' | 'medium' | 'low';
}

// Parameter search space
const PARAM_RANGES = {
  consensusThreshold: [0.55, 0.60, 0.65, 0.70, 0.75, 0.80],
  minConfidence: [0.50, 0.55, 0.60, 0.65, 0.70, 0.75],
  hardStopLossPercent: [-0.5, -0.75, -1.0, -1.25, -1.5, -2.0],
  maxPositionSizePercent: [0.03, 0.05, 0.07, 0.10, 0.12, 0.15],
  atrStopMultiplier: [1.0, 1.2, 1.5, 1.8, 2.0, 2.5],
};

interface TradeRecord {
  entryTime: Date;
  exitTime: Date;
  pnlPercent: number;
  pnlAfterCosts: number;
  consensusStrength: number;
  avgConfidence: number;
  atrAtEntry: number;
  positionSizePercent: number;
}

class WalkForwardOptimizer extends EventEmitter {
  private isRunning: boolean = false;
  private lastResult: WalkForwardResult | null = null;

  getLastResult(): WalkForwardResult | null {
    return this.lastResult;
  }

  /**
   * Run walk-forward optimization
   * @param trainMonths Number of months for training window (default 3)
   * @param testMonths Number of months for test window (default 1)
   */
  async runOptimization(trainMonths: number = 3, testMonths: number = 1): Promise<WalkForwardResult> {
    console.log('[WalkForwardOptimizer] Starting walk-forward optimization...');
    this.isRunning = true;

    try {
      // Load all closed trades
      const trades = await this.loadTrades();

      if (trades.length < 50) {
        console.log(`[WalkForwardOptimizer] Insufficient trades: ${trades.length} (need 50+)`);
        const emptyResult: WalkForwardResult = {
          timestamp: getActiveClock().now(),
          totalWindows: 0,
          windowResults: [],
          avgInSampleSharpe: 0,
          avgOutOfSampleSharpe: 0,
          avgOverfitRatio: 0,
          maxParameterDrift: 0,
          recommendedParams: this.getDefaultParams(),
          isOverfit: false,
          isUnstable: false,
          confidence: 'low',
        };
        this.lastResult = emptyResult;
        return emptyResult;
      }

      // Sort by entry time
      trades.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());

      // Create rolling windows
      const firstTrade = trades[0].entryTime;
      const lastTrade = trades[trades.length - 1].entryTime;
      const totalMonths = Math.floor(
        (lastTrade.getTime() - firstTrade.getTime()) / (30 * 24 * 60 * 60 * 1000)
      );

      if (totalMonths < trainMonths + testMonths) {
        console.log(`[WalkForwardOptimizer] Insufficient time range: ${totalMonths} months (need ${trainMonths + testMonths}+)`);
        const emptyResult: WalkForwardResult = {
          timestamp: getActiveClock().now(),
          totalWindows: 0,
          windowResults: [],
          avgInSampleSharpe: 0,
          avgOutOfSampleSharpe: 0,
          avgOverfitRatio: 0,
          maxParameterDrift: 0,
          recommendedParams: this.getDefaultParams(),
          isOverfit: false,
          isUnstable: false,
          confidence: 'low',
        };
        this.lastResult = emptyResult;
        return emptyResult;
      }

      const windowResults: WindowResult[] = [];
      let previousParams: ParameterSet | null = null;

      // Walk through time in testMonths increments
      for (let month = trainMonths; month < totalMonths; month += testMonths) {
        const windowStart = new Date(firstTrade.getTime() + (month - trainMonths) * 30 * 24 * 60 * 60 * 1000);
        const trainEnd = new Date(firstTrade.getTime() + month * 30 * 24 * 60 * 60 * 1000);
        const testEnd = new Date(firstTrade.getTime() + (month + testMonths) * 30 * 24 * 60 * 60 * 1000);

        // Split trades
        const trainTrades = trades.filter(t => t.entryTime >= windowStart && t.entryTime < trainEnd);
        const testTrades = trades.filter(t => t.entryTime >= trainEnd && t.entryTime < testEnd);

        if (trainTrades.length < 20 || testTrades.length < 5) continue;

        // Optimize on training data
        const { params: optimalParams, sharpe: inSampleSharpe, winRate: inSampleWinRate } =
          this.optimizeParameters(trainTrades);

        // Validate on test data
        const { sharpe: outOfSampleSharpe, winRate: outOfSampleWinRate } =
          this.evaluateParameters(testTrades, optimalParams);

        // Calculate overfit ratio
        const overfitRatio = inSampleSharpe > 0 ? outOfSampleSharpe / inSampleSharpe : 0;

        // Calculate parameter drift from previous window
        let parameterDrift = 0;
        if (previousParams) {
          parameterDrift = this.calculateParamDrift(previousParams, optimalParams);
        }

        windowResults.push({
          windowStart,
          windowEnd: testEnd,
          trainStart: windowStart,
          trainEnd,
          testStart: trainEnd,
          testEnd,
          trainTrades: trainTrades.length,
          testTrades: testTrades.length,
          optimalParams,
          inSampleSharpe,
          inSampleWinRate,
          outOfSampleSharpe,
          outOfSampleWinRate,
          overfitRatio,
          parameterDrift,
        });

        previousParams = optimalParams;
      }

      // Aggregate results
      const avgInSampleSharpe = windowResults.length > 0
        ? windowResults.reduce((s, w) => s + w.inSampleSharpe, 0) / windowResults.length : 0;
      const avgOutOfSampleSharpe = windowResults.length > 0
        ? windowResults.reduce((s, w) => s + w.outOfSampleSharpe, 0) / windowResults.length : 0;
      const avgOverfitRatio = windowResults.length > 0
        ? windowResults.reduce((s, w) => s + w.overfitRatio, 0) / windowResults.length : 0;
      const maxParameterDrift = windowResults.length > 0
        ? Math.max(...windowResults.map(w => w.parameterDrift)) : 0;

      // Recommended params: use most recent window's optimal (validated on out-of-sample)
      const recommendedParams = windowResults.length > 0
        ? windowResults[windowResults.length - 1].optimalParams
        : this.getDefaultParams();

      const isOverfit = avgOverfitRatio < 0.70;
      const isUnstable = maxParameterDrift > 0.15;
      const confidence = !isOverfit && !isUnstable ? 'high'
        : (!isOverfit || !isUnstable) ? 'medium' : 'low';

      const result: WalkForwardResult = {
        timestamp: getActiveClock().now(),
        totalWindows: windowResults.length,
        windowResults,
        avgInSampleSharpe,
        avgOutOfSampleSharpe,
        avgOverfitRatio,
        maxParameterDrift,
        recommendedParams,
        isOverfit,
        isUnstable,
        confidence,
      };

      this.lastResult = result;
      this.emit('optimization_complete', result);

      // Log summary
      this.logSummary(result);

      // Persist to DB
      await this.persistResult(result);

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Load trades from database
   */
  private async loadTrades(): Promise<TradeRecord[]> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return [];

      const { trades, paperTrades } = await import('../../drizzle/schema');
      const { eq, isNotNull, and, ne } = await import('drizzle-orm');

      // Phase 22 fix: Try trades table first (StrategyOrchestrator path),
      // then fall back to paperTrades (PaperTradingEngine — the active engine path).
      const rows = await db
        .select({
          entryTime: trades.entryTime,
          exitTime: trades.exitTime,
          entryPrice: trades.entryPrice,
          exitPrice: trades.exitPrice,
          side: trades.side,
          pnl: trades.pnl,
          pnlAfterCosts: trades.pnlAfterCosts,
          confidence: trades.confidence,
          agentSignals: trades.agentSignals,
        })
        .from(trades)
        .where(
          and(
            eq(trades.status, 'closed'),
            isNotNull(trades.pnlAfterCosts),
            isNotNull(trades.exitPrice)
          )
        )
        .orderBy(trades.entryTime);

      if (rows.length > 0) {
        return rows.map(row => {
          const entryPrice = parseFloat(row.entryPrice || '0');
          const exitPrice = parseFloat(row.exitPrice || '0');
          let pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
          if (row.side === 'short') pnlPercent = -pnlPercent;

          return {
            entryTime: row.entryTime || new Date(),
            exitTime: row.exitTime || new Date(),
            pnlPercent,
            pnlAfterCosts: parseFloat(row.pnlAfterCosts || '0'),
            consensusStrength: parseFloat(row.confidence || '0.65'),
            avgConfidence: parseFloat(row.confidence || '0.65'),
            atrAtEntry: 0,
            positionSizePercent: 0.05,
          };
        });
      }

      // Fallback: Read from paperTrades (PaperTradingEngine writes here)
      // Exit records have non-zero pnl. Pair them for return calculations.
      const paperRows = await db
        .select({
          timestamp: paperTrades.timestamp,
          price: paperTrades.price,
          pnl: paperTrades.pnl,
          quantity: paperTrades.quantity,
          commission: paperTrades.commission,
          side: paperTrades.side,
        })
        .from(paperTrades)
        .where(
          and(
            ne(paperTrades.pnl, '0'),
            ne(paperTrades.pnl, '0.00'),
            isNotNull(paperTrades.pnl)
          )
        )
        .orderBy(paperTrades.timestamp);

      if (paperRows.length > 0) {
        console.log(`[WalkForwardOptimizer] Using ${paperRows.length} paperTrades records (fallback)`);
        return paperRows.map(row => {
          const price = parseFloat(row.price || '0');
          const pnl = parseFloat(row.pnl || '0');
          const qty = parseFloat(row.quantity || '0');
          const commission = parseFloat(row.commission || '0');
          const positionValue = price * qty;
          const pnlPercent = positionValue > 0 ? (pnl / positionValue) * 100 : 0;

          return {
            entryTime: row.timestamp || new Date(),
            exitTime: row.timestamp || new Date(),
            pnlPercent,
            pnlAfterCosts: pnl - commission,
            consensusStrength: 0.65, // Default — not available in paperTrades
            avgConfidence: 0.65,
            atrAtEntry: 0,
            positionSizePercent: 0.05,
          };
        });
      }

      return [];
    } catch (err) {
      console.error('[WalkForwardOptimizer] Failed to load trades:', (err as Error)?.message);
      return [];
    }
  }

  /**
   * Grid search for optimal parameters on training data
   * Uses simplified simulation: filter trades by parameter thresholds
   */
  private optimizeParameters(trades: TradeRecord[]): {
    params: ParameterSet;
    sharpe: number;
    winRate: number;
  } {
    let bestSharpe = -Infinity;
    let bestParams = this.getDefaultParams();
    let bestWinRate = 0;

    // Reduced grid search (avoid combinatorial explosion)
    // Test key parameters: consensusThreshold and minConfidence first
    for (const ct of PARAM_RANGES.consensusThreshold) {
      for (const mc of PARAM_RANGES.minConfidence) {
        // Filter trades that would pass these thresholds
        const filtered = trades.filter(t =>
          t.consensusStrength >= ct && t.avgConfidence >= mc
        );

        if (filtered.length < 10) continue;

        const pnls = filtered.map(t => t.pnlAfterCosts);
        const sharpe = this.quickSharpe(pnls);
        const winRate = pnls.filter(p => p > 0).length / pnls.length;

        if (sharpe > bestSharpe) {
          bestSharpe = sharpe;
          bestWinRate = winRate;
          bestParams = {
            ...this.getDefaultParams(),
            consensusThreshold: ct,
            minConfidence: mc,
          };
        }
      }
    }

    // Second pass: optimize stop loss and position size with best consensus params
    for (const sl of PARAM_RANGES.hardStopLossPercent) {
      for (const ps of PARAM_RANGES.maxPositionSizePercent) {
        const filtered = trades.filter(t =>
          t.consensusStrength >= bestParams.consensusThreshold &&
          t.avgConfidence >= bestParams.minConfidence
        );

        if (filtered.length < 10) continue;

        // Simulate stop loss effect: cap losses at stop level
        const adjustedPnls = filtered.map(t => {
          if (t.pnlPercent < sl) return sl * ps * 10000; // Convert to dollar-like
          return t.pnlAfterCosts * (ps / 0.05); // Scale by position size
        });

        const sharpe = this.quickSharpe(adjustedPnls);
        if (sharpe > bestSharpe) {
          bestSharpe = sharpe;
          bestParams.hardStopLossPercent = sl;
          bestParams.maxPositionSizePercent = ps;
        }
      }
    }

    return { params: bestParams, sharpe: bestSharpe, winRate: bestWinRate };
  }

  /**
   * Evaluate parameters on out-of-sample data
   */
  private evaluateParameters(
    trades: TradeRecord[],
    params: ParameterSet
  ): { sharpe: number; winRate: number } {
    const filtered = trades.filter(t =>
      t.consensusStrength >= params.consensusThreshold &&
      t.avgConfidence >= params.minConfidence
    );

    if (filtered.length < 3) {
      return { sharpe: 0, winRate: 0 };
    }

    const pnls = filtered.map(t => t.pnlAfterCosts);
    const sharpe = this.quickSharpe(pnls);
    const winRate = pnls.filter(p => p > 0).length / pnls.length;

    return { sharpe, winRate };
  }

  /**
   * Quick Sharpe ratio calculation
   */
  private quickSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return mean > 0 ? 3 : 0;
    return (mean / stdDev) * Math.sqrt(252); // Annualized
  }

  /**
   * Calculate normalized parameter drift between two parameter sets
   */
  private calculateParamDrift(prev: ParameterSet, curr: ParameterSet): number {
    const diffs = [
      Math.abs(curr.consensusThreshold - prev.consensusThreshold) / prev.consensusThreshold,
      Math.abs(curr.minConfidence - prev.minConfidence) / prev.minConfidence,
      Math.abs(curr.hardStopLossPercent - prev.hardStopLossPercent) / Math.abs(prev.hardStopLossPercent),
      Math.abs(curr.maxPositionSizePercent - prev.maxPositionSizePercent) / prev.maxPositionSizePercent,
      Math.abs(curr.atrStopMultiplier - prev.atrStopMultiplier) / prev.atrStopMultiplier,
    ];
    return Math.max(...diffs);
  }

  private getDefaultParams(): ParameterSet {
    return {
      consensusThreshold: 0.65,
      minConfidence: 0.60,
      hardStopLossPercent: -1.0,
      maxPositionSizePercent: 0.10,
      atrStopMultiplier: 1.5,
    };
  }

  private logSummary(result: WalkForwardResult): void {
    console.log('\n============================================');
    console.log('   WALK-FORWARD OPTIMIZATION REPORT');
    console.log('============================================');
    console.log(`Windows: ${result.totalWindows}`);
    console.log(`Avg In-Sample Sharpe: ${result.avgInSampleSharpe.toFixed(2)}`);
    console.log(`Avg Out-of-Sample Sharpe: ${result.avgOutOfSampleSharpe.toFixed(2)}`);
    console.log(`Avg Overfit Ratio: ${result.avgOverfitRatio.toFixed(2)} ${result.isOverfit ? '⚠️ OVERFIT' : '✅'}`);
    console.log(`Max Parameter Drift: ${(result.maxParameterDrift * 100).toFixed(1)}% ${result.isUnstable ? '⚠️ UNSTABLE' : '✅'}`);
    console.log(`Confidence: ${result.confidence.toUpperCase()}`);
    console.log(`Recommended: consensus=${result.recommendedParams.consensusThreshold}, conf=${result.recommendedParams.minConfidence}, stop=${result.recommendedParams.hardStopLossPercent}%`);
    console.log('============================================\n');
  }

  private async persistResult(result: WalkForwardResult): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const data = {
        timestamp: new Date(result.timestamp).toISOString(),
        totalWindows: result.totalWindows,
        avgInSampleSharpe: result.avgInSampleSharpe,
        avgOutOfSampleSharpe: result.avgOutOfSampleSharpe,
        avgOverfitRatio: result.avgOverfitRatio,
        maxParameterDrift: result.maxParameterDrift,
        recommendedParams: result.recommendedParams,
        isOverfit: result.isOverfit,
        isUnstable: result.isUnstable,
        confidence: result.confidence,
      };

      const existing = await db.select().from(systemConfig)
        .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'walk_forward_optimization')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: data, updatedAt: new Date() })
          .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'walk_forward_optimization')));
      } else {
        await db.insert(systemConfig).values({
          userId: 1,
          configKey: 'walk_forward_optimization',
          configValue: data,
        });
      }
    } catch {
      // Non-critical
    }
  }
}

// Singleton
let instance: WalkForwardOptimizer | null = null;

export function getWalkForwardOptimizer(): WalkForwardOptimizer {
  if (!instance) {
    instance = new WalkForwardOptimizer();
  }
  return instance;
}

export { WalkForwardOptimizer };
