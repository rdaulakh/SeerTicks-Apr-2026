/**
 * Portfolio Rebalancer
 * 
 * Implements dynamic capital allocation across symbols based on:
 * - Agent confidence scores
 * - Kelly Criterion position sizing
 * - Portfolio risk constraints
 * - Rebalancing triggers (time, confidence, deviation)
 */

import { KellyCriterion, PositionSizeResult } from './KellyCriterion';
import { PositionManager } from '../PositionManager';
import { getDb } from '../db';
import { rebalancingHistory, positions } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export interface RebalancingConfig {
  enabled: boolean;
  minConfidenceThreshold: number;     // Minimum confidence to allocate capital (default 0.5)
  maxPositionSize: number;            // Max position size per symbol (default 0.25)
  fractionOfKelly: number;            // Fraction of Kelly to use (default 0.5)
  rebalanceIntervalMinutes: number;   // Time-based trigger (default 60)
  deviationThreshold: number;         // Deviation trigger in % (default 10%)
  confidenceChangeThreshold: number;  // Confidence change trigger (default 0.15)
  maxSymbols: number;                 // Max number of symbols to trade (default 5)
  minPositionSizeUSD: number;         // Min position size to open (default 100)
}

export interface SymbolMetrics {
  symbol: string;
  winRate: number;
  profitFactor: number;
  confidence: number;
  currentPrice: number;
  currentPositionSizeUSD: number;
}

export interface RebalancingResult {
  timestamp: number;
  trigger: 'time' | 'confidence' | 'deviation' | 'manual';
  symbolsRebalanced: number;
  totalCapitalAllocated: number;
  changes: {
    symbol: string;
    action: 'increase' | 'decrease' | 'open' | 'close';
    oldSizeUSD: number;
    newSizeUSD: number;
    reason: string;
  }[];
  portfolioMetrics: {
    totalValue: number;
    allocatedCapital: number;
    availableCash: number;
    numberOfPositions: number;
  };
}

export class PortfolioRebalancer {
  private config: RebalancingConfig;
  private positionManager: PositionManager;
  private lastRebalanceTime: number = 0;
  private previousConfidenceScores: Map<string, number> = new Map();
  private isRebalancing: boolean = false;
  private lastKnownAccountBalance: number = 10000; // Updated on each rebalance

  constructor(
    positionManager: PositionManager,
    config?: Partial<RebalancingConfig>
  ) {
    this.positionManager = positionManager;
    this.config = {
      enabled: true,
      minConfidenceThreshold: 0.5,
      maxPositionSize: 0.25,
      fractionOfKelly: 0.5,
      rebalanceIntervalMinutes: 60,
      deviationThreshold: 10,
      confidenceChangeThreshold: 0.15,
      maxSymbols: 5,
      minPositionSizeUSD: 100,
      ...config,
    };
  }

  /**
   * Check if rebalancing should be triggered
   */
  shouldRebalance(
    symbolMetrics: SymbolMetrics[]
  ): { shouldRebalance: boolean; trigger?: 'time' | 'confidence' | 'deviation' } {
    if (!this.config.enabled) {
      return { shouldRebalance: false };
    }

    // Time-based trigger
    const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime;
    const rebalanceIntervalMs = this.config.rebalanceIntervalMinutes * 60 * 1000;
    if (timeSinceLastRebalance >= rebalanceIntervalMs) {
      return { shouldRebalance: true, trigger: 'time' };
    }

    // Confidence change trigger
    for (const metric of symbolMetrics) {
      const previousConfidence = this.previousConfidenceScores.get(metric.symbol) || 0;
      const confidenceChange = Math.abs(metric.confidence - previousConfidence);
      if (confidenceChange >= this.config.confidenceChangeThreshold) {
        console.log(
          `[PortfolioRebalancer] Confidence change trigger: ${metric.symbol} changed by ${(confidenceChange * 100).toFixed(1)}%`
        );
        return { shouldRebalance: true, trigger: 'confidence' };
      }
    }

    // Deviation trigger (current position size vs optimal)
    const accountBalance = this.lastKnownAccountBalance;
    const optimalAllocations = KellyCriterion.calculatePortfolioAllocation(
      symbolMetrics,
      accountBalance,
      {
        maxPositionSize: this.config.maxPositionSize,
        fractionOfKelly: this.config.fractionOfKelly,
        minConfidence: this.config.minConfidenceThreshold,
      }
    );

    for (const metric of symbolMetrics) {
      const optimalSize = optimalAllocations.get(metric.symbol)?.positionSizeUSD || 0;
      const currentSize = metric.currentPositionSizeUSD;
      
      if (optimalSize > 0) {
        const deviation = Math.abs(currentSize - optimalSize) / optimalSize;
        if (deviation >= this.config.deviationThreshold / 100) {
          console.log(
            `[PortfolioRebalancer] Deviation trigger: ${metric.symbol} deviated by ${(deviation * 100).toFixed(1)}%`
          );
          return { shouldRebalance: true, trigger: 'deviation' };
        }
      }
    }

    return { shouldRebalance: false };
  }

  /**
   * Execute portfolio rebalancing
   */
  async rebalance(
    symbolMetrics: SymbolMetrics[],
    trigger: 'time' | 'confidence' | 'deviation' | 'manual' = 'manual',
    accountBalance?: number
  ): Promise<RebalancingResult> {
    if (this.isRebalancing) {
      throw new Error('Rebalancing already in progress');
    }

    this.isRebalancing = true;
    const startTime = Date.now();

    try {
      console.log(`[PortfolioRebalancer] Starting rebalancing (trigger: ${trigger})...`);

      // Use provided balance or fall back to last known
      if (accountBalance !== undefined) {
        this.lastKnownAccountBalance = accountBalance;
      }
      const balance = this.lastKnownAccountBalance;

      // Calculate optimal allocations using Kelly Criterion
      const optimalAllocations = KellyCriterion.calculatePortfolioAllocation(
        symbolMetrics,
        balance,
        {
          maxPositionSize: this.config.maxPositionSize,
          fractionOfKelly: this.config.fractionOfKelly,
          minConfidence: this.config.minConfidenceThreshold,
        }
      );

      // Sort symbols by confidence (highest first)
      const sortedSymbols = Array.from(optimalAllocations.entries())
        .sort((a, b) => {
          const confA = symbolMetrics.find(m => m.symbol === a[0])?.confidence || 0;
          const confB = symbolMetrics.find(m => m.symbol === b[0])?.confidence || 0;
          return confB - confA;
        })
        .slice(0, this.config.maxSymbols); // Limit to max symbols

      // Calculate rebalancing changes
      const changes: RebalancingResult['changes'] = [];
      let totalCapitalAllocated = 0;

      for (const [symbol, allocation] of sortedSymbols) {
        const metric = symbolMetrics.find(m => m.symbol === symbol);
        if (!metric) continue;

        const optimalSizeUSD = allocation.positionSizeUSD;
        const currentSizeUSD = metric.currentPositionSizeUSD;

        // Skip if below minimum position size
        if (optimalSizeUSD < this.config.minPositionSizeUSD) {
          if (currentSizeUSD > 0) {
            changes.push({
              symbol,
              action: 'close',
              oldSizeUSD: currentSizeUSD,
              newSizeUSD: 0,
              reason: `Position size below minimum ($${this.config.minPositionSizeUSD})`,
            });
          }
          continue;
        }

        // Determine action
        let action: 'increase' | 'decrease' | 'open' | 'close';
        if (currentSizeUSD === 0) {
          action = 'open';
        } else if (optimalSizeUSD > currentSizeUSD * 1.1) {
          action = 'increase';
        } else if (optimalSizeUSD < currentSizeUSD * 0.9) {
          action = 'decrease';
        } else {
          // No significant change needed
          totalCapitalAllocated += currentSizeUSD;
          continue;
        }

        changes.push({
          symbol,
          action,
          oldSizeUSD: currentSizeUSD,
          newSizeUSD: optimalSizeUSD,
          reason: allocation.reasoning,
        });

        totalCapitalAllocated += optimalSizeUSD;
      }

      // Close positions not in optimal allocation
      for (const metric of symbolMetrics) {
        if (!optimalAllocations.has(metric.symbol) && metric.currentPositionSizeUSD > 0) {
          changes.push({
            symbol: metric.symbol,
            action: 'close',
            oldSizeUSD: metric.currentPositionSizeUSD,
            newSizeUSD: 0,
            reason: 'Below confidence threshold or not in top symbols',
          });
        }
      }

      // Update confidence scores for next trigger check
      symbolMetrics.forEach(m => {
        this.previousConfidenceScores.set(m.symbol, m.confidence);
      });

      // Update last rebalance time
      this.lastRebalanceTime = Date.now();

      // Save to database
      await this.saveRebalancingHistory({
        timestamp: startTime,
        trigger,
        symbolsRebalanced: changes.length,
        totalCapitalAllocated,
        changes,
        portfolioMetrics: {
          totalValue: balance,
          allocatedCapital: totalCapitalAllocated,
          availableCash: balance - totalCapitalAllocated,
          numberOfPositions: sortedSymbols.length,
        },
      });

      console.log(
        `[PortfolioRebalancer] Rebalancing complete: ${changes.length} changes, $${totalCapitalAllocated.toFixed(2)} allocated`
      );

      return {
        timestamp: startTime,
        trigger,
        symbolsRebalanced: changes.length,
        totalCapitalAllocated,
        changes,
        portfolioMetrics: {
          totalValue: balance,
          allocatedCapital: totalCapitalAllocated,
          availableCash: balance - totalCapitalAllocated,
          numberOfPositions: sortedSymbols.length,
        },
      };
    } finally {
      this.isRebalancing = false;
    }
  }

  /**
   * Save rebalancing history to database
   */
  private async saveRebalancingHistory(result: RebalancingResult): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.warn('[PortfolioRebalancer] Database not available, skipping history save');
      return;
    }

    try {
      await db.insert(rebalancingHistory).values({
        timestamp: new Date(result.timestamp),
        trigger: result.trigger,
        symbolsRebalanced: result.symbolsRebalanced,
        totalCapitalAllocated: result.totalCapitalAllocated.toString(),
        changes: JSON.stringify(result.changes),
        portfolioMetrics: JSON.stringify(result.portfolioMetrics),
      });
    } catch (error) {
      console.error('[PortfolioRebalancer] Failed to save rebalancing history:', error);
    }
  }

  /**
   * Get rebalancing history from database
   */
  async getRebalancingHistory(limit: number = 50): Promise<any[]> {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      const history = await db
        .select()
        .from(rebalancingHistory)
        .orderBy(rebalancingHistory.timestamp)
        .limit(limit);

      return history.map(h => ({
        ...h,
        changes: JSON.parse(h.changes as string),
        portfolioMetrics: JSON.parse(h.portfolioMetrics as string),
      }));
    } catch (error) {
      console.error('[PortfolioRebalancer] Failed to fetch rebalancing history:', error);
      return [];
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): RebalancingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RebalancingConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[PortfolioRebalancer] Configuration updated:', this.config);
  }

  /**
   * Enable/disable rebalancing
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[PortfolioRebalancer] Rebalancing ${enabled ? 'enabled' : 'disabled'}`);
  }
}
