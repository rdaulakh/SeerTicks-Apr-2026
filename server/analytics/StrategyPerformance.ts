/**
 * Strategy Performance Analytics
 * 
 * Tracks and analyzes performance of all 21 trading strategies:
 * - 7 AI Agents (TechnicalAnalyst, PatternMatcher, OrderFlowAnalyst, SentimentAnalyst, NewsSentinel, MacroAnalyst, OnChainAnalyst)
 * - 14 Technical Patterns (tracked by PatternMatcher)
 * 
 * Provides insights on:
 * - Which strategies are most profitable
 * - Win rate per strategy
 * - Average return per strategy
 * - Best/worst performing strategies
 * - Strategy recommendations based on historical performance
 */

import { getDb } from "../db";
import { trades } from "../../drizzle/schema";
import { eq, and, gte } from "drizzle-orm";

export interface StrategyStats {
  strategyName: string;
  strategyType: "agent" | "pattern";
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // Percentage
  totalProfitLoss: number;
  averageReturn: number; // Percentage
  bestTrade: number;
  worstTrade: number;
  sharpeRatio: number;
  profitFactor: number; // Gross profit / Gross loss
  averageHoldTime: number; // Hours
}

export interface StrategyRecommendation {
  strategyName: string;
  recommendation: "strong_buy" | "buy" | "neutral" | "avoid";
  reason: string;
  confidence: number; // 0-1
}

export class StrategyPerformanceAnalytics {
  /**
   * Get performance stats for all strategies
   */
  async getAllStrategyStats(userId: number, daysBack: number = 30): Promise<StrategyStats[]> {
    const db = await getDb();
    if (!db) {
      console.error("[StrategyPerformanceAnalytics] Database not available");
      return [];
    }

    // Get all completed trades in the time window
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const completedTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          eq(trades.status, "closed"),
          gte(trades.entryTime, cutoffDate)
        )
      );

    if (completedTrades.length === 0) {
      console.log("[StrategyPerformanceAnalytics] No completed trades found");
      return this.getDefaultStrategyStats();
    }

    // Group trades by strategy
    const strategyTrades = new Map<string, any[]>();

    for (const trade of completedTrades) {
      if (!trade.agentSignals) continue;

      try {
        const signals = JSON.parse(trade.agentSignals as string);
        
        // Track each agent that contributed to this trade
        for (const signal of signals) {
          const strategyName = signal.agentName;
          if (!strategyTrades.has(strategyName)) {
            strategyTrades.set(strategyName, []);
          }
          strategyTrades.get(strategyName)!.push(trade);
        }

        // Track patterns if PatternMatcher was involved
        const patternSignal = signals.find((s: any) => s.agentName === "PatternMatcher");
        if (patternSignal && patternSignal.evidence?.patternName) {
          const patternName = patternSignal.evidence.patternName;
          if (!strategyTrades.has(patternName)) {
            strategyTrades.set(patternName, []);
          }
          strategyTrades.get(patternName)!.push(trade);
        }
      } catch (error) {
        console.error("[StrategyPerformanceAnalytics] Failed to parse agent signals:", error);
      }
    }

    // Calculate stats for each strategy
    const stats: StrategyStats[] = [];

    for (const [strategyName, trades] of Array.from(strategyTrades.entries())) {
      const strategyStats = this.calculateStrategyStats(strategyName, trades);
      stats.push(strategyStats);
    }

    // Sort by profitability (total P&L)
    stats.sort((a, b) => b.totalProfitLoss - a.totalProfitLoss);

    return stats;
  }

  /**
   * Calculate statistics for a single strategy
   */
  private calculateStrategyStats(strategyName: string, trades: any[]): StrategyStats {
    const isPattern = !this.isAgentName(strategyName);

    let totalProfitLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let bestTrade = 0;
    let worstTrade = 0;
    let totalHoldTime = 0;
    const returns: number[] = [];

    for (const trade of trades) {
      const profitLoss = parseFloat(trade.profitLoss?.toString() || "0");
      totalProfitLoss += profitLoss;

      if (profitLoss > 0) {
        winningTrades++;
      } else if (profitLoss < 0) {
        losingTrades++;
      }

      if (profitLoss > bestTrade) bestTrade = profitLoss;
      if (profitLoss < worstTrade) worstTrade = profitLoss;

      // Calculate return percentage
      const entryPrice = parseFloat(trade.entryPrice?.toString() || "0");
      const exitPrice = parseFloat(trade.exitPrice?.toString() || entryPrice.toString());
      if (entryPrice > 0) {
        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        returns.push(returnPct);
      }

      // Calculate hold time
      if (trade.entryTime && trade.exitTime) {
        const holdTimeMs = new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime();
        totalHoldTime += holdTimeMs / (1000 * 60 * 60); // Convert to hours
      }
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const averageReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0;

    // Calculate Sharpe Ratio (simplified)
    const sharpeRatio = this.calculateSharpeRatio(returns);

    // Calculate Profit Factor
    const grossProfit = trades
      .filter(t => parseFloat(t.profitLoss?.toString() || "0") > 0)
      .reduce((sum, t) => sum + parseFloat(t.profitLoss?.toString() || "0"), 0);
    const grossLoss = Math.abs(
      trades
        .filter(t => parseFloat(t.profitLoss?.toString() || "0") < 0)
        .reduce((sum, t) => sum + parseFloat(t.profitLoss?.toString() || "0"), 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    return {
      strategyName,
      strategyType: isPattern ? "pattern" : "agent",
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalProfitLoss,
      averageReturn,
      bestTrade,
      worstTrade,
      sharpeRatio,
      profitFactor,
      averageHoldTime,
    };
  }

  /**
   * Calculate Sharpe Ratio (simplified version)
   */
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length < 2) return 0;

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualized Sharpe Ratio (assuming daily returns)
    const riskFreeRate = 0.04; // 4% annual risk-free rate
    const dailyRiskFreeRate = riskFreeRate / 365;
    const sharpe = ((avgReturn - dailyRiskFreeRate) / stdDev) * Math.sqrt(365);

    return sharpe;
  }

  /**
   * Check if strategy name is an agent (vs pattern)
   */
  private isAgentName(name: string): boolean {
    const agents = [
      "TechnicalAnalyst",
      "PatternMatcher",
      "OrderFlowAnalyst",
      "SentimentAnalyst",
      "NewsSentinel",
      "MacroAnalyst",
      "OnChainAnalyst",
    ];
    return agents.includes(name);
  }

  /**
   * Get strategy recommendations based on performance
   */
  async getStrategyRecommendations(userId: number): Promise<StrategyRecommendation[]> {
    const stats = await this.getAllStrategyStats(userId, 30);
    const recommendations: StrategyRecommendation[] = [];

    for (const stat of stats) {
      let recommendation: "strong_buy" | "buy" | "neutral" | "avoid" = "neutral";
      let reason = "";
      let confidence = 0.5;

      // Strong Buy: High win rate + positive P&L + good Sharpe ratio
      if (stat.winRate > 65 && stat.totalProfitLoss > 0 && stat.sharpeRatio > 1.5 && stat.totalTrades >= 10) {
        recommendation = "strong_buy";
        reason = `Excellent performance: ${stat.winRate.toFixed(1)}% win rate, $${stat.totalProfitLoss.toFixed(2)} profit, Sharpe ${stat.sharpeRatio.toFixed(2)}`;
        confidence = 0.9;
      }
      // Buy: Positive P&L + decent win rate
      else if (stat.winRate > 55 && stat.totalProfitLoss > 0 && stat.totalTrades >= 5) {
        recommendation = "buy";
        reason = `Good performance: ${stat.winRate.toFixed(1)}% win rate, $${stat.totalProfitLoss.toFixed(2)} profit`;
        confidence = 0.7;
      }
      // Avoid: Negative P&L or low win rate
      else if (stat.totalProfitLoss < 0 || stat.winRate < 40) {
        recommendation = "avoid";
        reason = `Poor performance: ${stat.winRate.toFixed(1)}% win rate, $${stat.totalProfitLoss.toFixed(2)} P&L`;
        confidence = 0.8;
      }
      // Neutral: Not enough data or mixed results
      else {
        recommendation = "neutral";
        reason = `Insufficient data or mixed results (${stat.totalTrades} trades)`;
        confidence = 0.5;
      }

      recommendations.push({
        strategyName: stat.strategyName,
        recommendation,
        reason,
        confidence,
      });
    }

    return recommendations;
  }

  /**
   * Get default stats when no trades exist
   */
  private getDefaultStrategyStats(): StrategyStats[] {
    const agents = [
      "TechnicalAnalyst",
      "PatternMatcher",
      "OrderFlowAnalyst",
      "SentimentAnalyst",
      "NewsSentinel",
      "MacroAnalyst",
      "OnChainAnalyst",
    ];

    return agents.map(agent => ({
      strategyName: agent,
      strategyType: "agent" as const,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalProfitLoss: 0,
      averageReturn: 0,
      bestTrade: 0,
      worstTrade: 0,
      sharpeRatio: 0,
      profitFactor: 0,
      averageHoldTime: 0,
    }));
  }

  /**
   * Get top performing strategies
   */
  async getTopStrategies(userId: number, limit: number = 5): Promise<StrategyStats[]> {
    const stats = await this.getAllStrategyStats(userId, 30);
    return stats.slice(0, limit);
  }

  /**
   * Get worst performing strategies
   */
  async getWorstStrategies(userId: number, limit: number = 5): Promise<StrategyStats[]> {
    const stats = await this.getAllStrategyStats(userId, 30);
    return stats.slice(-limit).reverse();
  }
}

// Singleton instance
let strategyPerformanceAnalytics: StrategyPerformanceAnalytics | null = null;

export function getStrategyPerformanceAnalytics(): StrategyPerformanceAnalytics {
  if (!strategyPerformanceAnalytics) {
    strategyPerformanceAnalytics = new StrategyPerformanceAnalytics();
  }
  return strategyPerformanceAnalytics;
}
