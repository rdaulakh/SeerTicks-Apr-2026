/**
 * Post-Trade Analyzer
 * 
 * Analyzes every closed trade and updates agent weights based on accuracy.
 * This is the learning layer that improves system performance over time.
 * 
 * Analysis Metrics:
 * - Which agents were correct/incorrect?
 * - What was the market regime?
 * - What could be improved?
 * - Update agent weights (increase weight for accurate agents)
 */

import { getDb } from "./db";
import { trades, agentSignals, type Trade } from "../drizzle/schema";
import { eq } from "drizzle-orm";

interface AgentAccuracy {
  agentName: string;
  correct: number;
  incorrect: number;
  accuracy: number;
  avgPnl: number;
  totalTrades: number;
}

interface TradeAnalysis {
  tradeId: number;
  symbol: string;
  side: string;
  pnl: number;
  pnlPercent: number;
  holdTime: number; // milliseconds
  exitReason: string;
  marketRegime: string;
  agentAccuracy: Record<string, boolean>; // agentName -> was correct
  improvements: string[];
}

export class PostTradeAnalyzer {
  private agentWeights: Map<string, number> = new Map();
  private agentAccuracyHistory: Map<string, AgentAccuracy> = new Map();

  constructor() {
    // Initialize default agent weights (equal weighting)
    const defaultAgents = [
      "TechnicalAnalyst",
      "PatternMatcher",
      "OrderFlowAnalyst",
      "SentimentAnalyst",
      "NewsSentinel",
      "MacroAnalyst",
      "OnChainAnalyst",
    ];

    for (const agent of defaultAgents) {
      this.agentWeights.set(agent, 1.0);
      this.agentAccuracyHistory.set(agent, {
        agentName: agent,
        correct: 0,
        incorrect: 0,
        accuracy: 0,
        avgPnl: 0,
        totalTrades: 0,
      });
    }

    console.log("[PostTradeAnalyzer] Initialized with equal agent weights");
  }

  /**
   * Analyze a closed trade and update agent weights
   */
  async analyzeTrade(tradeId: number): Promise<TradeAnalysis | null> {
    const db = await getDb();
    if (!db) return null;

    // Fetch trade details
    const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId));

    if (!trade || trade.status !== "closed") {
      console.warn(`[PostTradeAnalyzer] Trade ${tradeId} not found or not closed`);
      return null;
    }

    const pnl = parseFloat(trade.pnl?.toString() || "0");
    const entryPrice = parseFloat(trade.entryPrice.toString());
    const exitPrice = parseFloat(trade.exitPrice?.toString() || entryPrice.toString());
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100 * (trade.side === "long" ? 1 : -1);
    const holdTime = trade.exitTime && trade.entryTime ? trade.exitTime.getTime() - trade.entryTime.getTime() : 0;

    // Determine if trade was successful
    const isSuccessful = pnl > 0;

    // Parse agent signals from trade entry
    const agentSignalsData = trade.agentSignals as any;
    const agentAccuracy: Record<string, boolean> = {};

    if (agentSignalsData && typeof agentSignalsData === "object") {
      for (const [agentName, signalData] of Object.entries(agentSignalsData)) {
        const signal = (signalData as any).signal;

        // Check if agent's signal matched the outcome
        let wasCorrect = false;

        if (trade.side === "long") {
          // For long trades, bullish signal should lead to profit
          wasCorrect = (signal > 0 && isSuccessful) || (signal < 0 && !isSuccessful);
        } else {
          // For short trades, bearish signal should lead to profit
          wasCorrect = (signal < 0 && isSuccessful) || (signal > 0 && !isSuccessful);
        }

        agentAccuracy[agentName] = wasCorrect;

        // Update agent accuracy history
        this.updateAgentAccuracy(agentName, wasCorrect, pnl);
      }
    }

    // Identify market regime (simplified)
    const marketRegime = this.identifyMarketRegime(trade);

    // Generate improvement suggestions
    const improvements = this.generateImprovements(trade, agentAccuracy, marketRegime);

    const analysis: TradeAnalysis = {
      tradeId,
      symbol: trade.symbol,
      side: trade.side,
      pnl,
      pnlPercent,
      holdTime,
      exitReason: trade.exitReason || "unknown",
      marketRegime,
      agentAccuracy,
      improvements,
    };

    console.log(`[PostTradeAnalyzer] Analyzed trade ${tradeId}:`, {
      pnl: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2) + "%",
      agentAccuracy,
    });

    // Update agent weights based on accuracy
    this.updateAgentWeights();

    return analysis;
  }

  /**
   * Update agent accuracy history
   */
  private updateAgentAccuracy(agentName: string, wasCorrect: boolean, pnl: number): void {
    let accuracy = this.agentAccuracyHistory.get(agentName);

    if (!accuracy) {
      accuracy = {
        agentName,
        correct: 0,
        incorrect: 0,
        accuracy: 0,
        avgPnl: 0,
        totalTrades: 0,
      };
      this.agentAccuracyHistory.set(agentName, accuracy);
    }

    if (wasCorrect) {
      accuracy.correct++;
    } else {
      accuracy.incorrect++;
    }

    accuracy.totalTrades++;
    accuracy.accuracy = accuracy.correct / accuracy.totalTrades;

    // Update average PnL
    accuracy.avgPnl = (accuracy.avgPnl * (accuracy.totalTrades - 1) + pnl) / accuracy.totalTrades;
  }

  /**
   * Update agent weights based on accuracy
   * Increase weight for accurate agents, decrease for inaccurate ones
   */
  private updateAgentWeights(): void {
    for (const [agentName, accuracy] of Array.from(this.agentAccuracyHistory.entries())) {
      if (accuracy.totalTrades < 5) {
        // Need at least 5 trades before adjusting weights
        continue;
      }

      // Weight formula: base weight * (1 + accuracy - 0.5)
      // - 50% accuracy = 1.0x weight (neutral)
      // - 60% accuracy = 1.1x weight
      // - 70% accuracy = 1.2x weight
      // - 40% accuracy = 0.9x weight
      const newWeight = 1.0 * (1 + accuracy.accuracy - 0.5);

      // Clamp weight between 0.5 and 1.5
      const clampedWeight = Math.max(0.5, Math.min(1.5, newWeight));

      this.agentWeights.set(agentName, clampedWeight);

      console.log(
        `[PostTradeAnalyzer] Updated ${agentName} weight: ${clampedWeight.toFixed(2)} (accuracy: ${(accuracy.accuracy * 100).toFixed(1)}%)`
      );
    }
  }

  /**
   * Get current agent weights
   */
  getAgentWeights(): Map<string, number> {
    return new Map(this.agentWeights);
  }

  /**
   * Get agent accuracy history
   */
  getAgentAccuracyHistory(): Map<string, AgentAccuracy> {
    return new Map(this.agentAccuracyHistory);
  }

  /**
   * Identify market regime from trade data
   */
  private identifyMarketRegime(trade: Trade): string {
    // Simplified regime identification
    // In production, this would analyze market data at trade entry time
    const exitReason = trade.exitReason || "unknown";

    if (exitReason.includes("stop_loss")) {
      return "volatile";
    } else if (exitReason.includes("take_profit")) {
      return "trending";
    } else if (exitReason.includes("time_based")) {
      return "range_bound";
    }

    return "unknown";
  }

  /**
   * Generate improvement suggestions based on trade analysis
   */
  private generateImprovements(
    trade: Trade,
    agentAccuracy: Record<string, boolean>,
    marketRegime: string
  ): string[] {
    const improvements: string[] = [];

    const pnl = parseFloat(trade.pnl?.toString() || "0");
    const exitReason = trade.exitReason || "unknown";

    // Improvement 1: Stop-loss too tight
    if (exitReason.includes("stop_loss") && pnl < 0) {
      improvements.push("Consider wider stop-loss (2.5x ATR instead of 2.0x) in volatile markets");
    }

    // Improvement 2: Take-profit too conservative
    if (exitReason.includes("partial_exit") && pnl > 0) {
      improvements.push("Partial exits working well, consider extending final target from 5% to 7%");
    }

    // Improvement 3: Time-based exit triggered
    if (exitReason.includes("time_based")) {
      improvements.push("Trade stagnated for >4 hours, consider tighter entry criteria or shorter timeframes");
    }

    // Improvement 4: Agent disagreement
    const correctAgents = Object.values(agentAccuracy).filter((correct) => correct).length;
    const totalAgents = Object.keys(agentAccuracy).length;

    if (correctAgents < totalAgents / 2) {
      improvements.push(
        `Only ${correctAgents}/${totalAgents} agents were correct, increase minimum consensus threshold`
      );
    }

    // Improvement 5: Market regime mismatch
    if (marketRegime === "volatile" && trade.exitReason?.includes("stop_loss")) {
      improvements.push("Volatile regime detected, reduce position size to 0.5x in high volatility");
    }

    return improvements;
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalTrades: number;
    winRate: number;
    avgPnl: number;
    bestAgent: string;
    worstAgent: string;
  } {
    let totalTrades = 0;
    let totalWins = 0;
    let totalPnl = 0;
    let bestAgent = "";
    let bestAccuracy = 0;
    let worstAgent = "";
    let worstAccuracy = 1;

    for (const [agentName, accuracy] of Array.from(this.agentAccuracyHistory.entries())) {
      if (accuracy.totalTrades > 0) {
        totalTrades += accuracy.totalTrades;
        totalWins += accuracy.correct;
        totalPnl += accuracy.avgPnl * accuracy.totalTrades;

        if (accuracy.accuracy > bestAccuracy) {
          bestAccuracy = accuracy.accuracy;
          bestAgent = agentName;
        }

        if (accuracy.accuracy < worstAccuracy && accuracy.totalTrades >= 5) {
          worstAccuracy = accuracy.accuracy;
          worstAgent = agentName;
        }
      }
    }

    return {
      totalTrades,
      winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
      avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
      bestAgent,
      worstAgent,
    };
  }
}

// Singleton instance
export const postTradeAnalyzer = new PostTradeAnalyzer();
