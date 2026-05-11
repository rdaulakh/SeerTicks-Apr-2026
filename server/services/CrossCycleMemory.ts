/**
 * CrossCycleMemory — Phase 35: Persistent Insight Tracking Across Analysis Cycles
 * 
 * Problem: Each analysis cycle (fast: 2s, slow: 5min) starts fresh.
 * Agents have no memory of what they observed in previous cycles.
 * This means:
 * - Patterns that develop over multiple cycles are missed
 * - Repeated signals aren't recognized as strengthening
 * - Contradictions between cycles aren't flagged
 * - Regime transitions aren't tracked with context
 * 
 * Solution: A sliding-window memory store that:
 * 1. Records key insights from each analysis cycle
 * 2. Provides agents with relevant historical context
 * 3. Tracks signal persistence (how long a signal has been consistent)
 * 4. Detects signal flips (bullish → bearish transitions)
 * 5. Maintains a "conviction score" that strengthens with consistent signals
 * 
 * Memory is per-symbol, in-memory (no DB), with configurable retention.
 */

import type { AgentSignal } from '../agents/AgentBase';
import { getActiveClock } from '../_core/clock';

export interface CycleInsight {
  cycleId: string;           // Unique cycle identifier
  timestamp: number;
  symbol: string;
  agentName: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  keyFindings: string[];     // Extracted key points from reasoning
  regime: string;
  priceAtCycle: number;
}

export interface SignalPersistence {
  agentName: string;
  currentSignal: 'bullish' | 'bearish' | 'neutral';
  consecutiveCycles: number;   // How many cycles this signal has been consistent
  firstSeenAt: number;         // When this signal direction started
  convictionScore: number;     // 0-1, increases with consistency
  lastFlipAt: number;          // When the signal last changed direction
  flipCount: number;           // Total flips in memory window
}

export interface CrossCycleContext {
  // For agents to consume
  signalPersistence: Record<string, SignalPersistence>;
  recentInsights: CycleInsight[];
  overallConviction: number;       // Aggregate conviction across all agents
  dominantDirection: 'bullish' | 'bearish' | 'neutral';
  directionStrength: number;       // 0-1, how strongly the direction dominates
  regimeHistory: Array<{ regime: string; timestamp: number; duration: number }>;
  signalFlips: Array<{ agentName: string; from: string; to: string; timestamp: number }>;
  priceHistory: Array<{ price: number; timestamp: number }>;
  cycleCount: number;
}

export class CrossCycleMemory {
  private insights: Map<string, CycleInsight[]> = new Map();        // symbol -> insights[]
  private persistence: Map<string, Map<string, SignalPersistence>> = new Map(); // symbol -> (agent -> persistence)
  private regimeHistory: Map<string, Array<{ regime: string; timestamp: number }>> = new Map();
  private priceHistory: Map<string, Array<{ price: number; timestamp: number }>> = new Map();
  private signalFlips: Map<string, Array<{ agentName: string; from: string; to: string; timestamp: number }>> = new Map();
  private cycleCounters: Map<string, number> = new Map();

  private readonly MAX_INSIGHTS_PER_SYMBOL = 200;     // Keep last 200 cycle insights
  private readonly MAX_REGIME_HISTORY = 50;
  private readonly MAX_PRICE_HISTORY = 500;
  private readonly MAX_FLIP_HISTORY = 100;
  private readonly CONVICTION_GROWTH_RATE = 0.15;      // Per consistent cycle
  private readonly CONVICTION_DECAY_RATE = 0.5;        // On signal flip

  /**
   * Record insights from a completed analysis cycle.
   */
  recordCycle(
    symbol: string,
    signals: AgentSignal[],
    regime: string,
    currentPrice: number
  ): void {
    const timestamp = getActiveClock().now();
    const cycleId = `${symbol}-${timestamp}`;

    // Increment cycle counter
    const count = (this.cycleCounters.get(symbol) || 0) + 1;
    this.cycleCounters.set(symbol, count);

    // Record price
    const prices = this.priceHistory.get(symbol) || [];
    prices.push({ price: currentPrice, timestamp });
    if (prices.length > this.MAX_PRICE_HISTORY) prices.shift();
    this.priceHistory.set(symbol, prices);

    // Record regime
    const regimes = this.regimeHistory.get(symbol) || [];
    const lastRegime = regimes.length > 0 ? regimes[regimes.length - 1] : null;
    if (!lastRegime || lastRegime.regime !== regime) {
      regimes.push({ regime, timestamp });
      if (regimes.length > this.MAX_REGIME_HISTORY) regimes.shift();
      this.regimeHistory.set(symbol, regimes);
    }

    // Initialize persistence map for this symbol
    if (!this.persistence.has(symbol)) {
      this.persistence.set(symbol, new Map());
    }
    const symbolPersistence = this.persistence.get(symbol)!;

    // Initialize flip history
    if (!this.signalFlips.has(symbol)) {
      this.signalFlips.set(symbol, []);
    }
    const flips = this.signalFlips.get(symbol)!;

    // Initialize insights
    if (!this.insights.has(symbol)) {
      this.insights.set(symbol, []);
    }
    const symbolInsights = this.insights.get(symbol)!;

    // Process each agent signal
    for (const signal of signals) {
      const agentName = signal.agentName;
      const signalDir = signal.signal || 'neutral';

      // Extract key findings from reasoning
      const keyFindings = this.extractKeyFindings(signal.reasoning || '');

      // Record insight
      symbolInsights.push({
        cycleId,
        timestamp,
        symbol,
        agentName,
        signal: signalDir as 'bullish' | 'bearish' | 'neutral',
        confidence: signal.confidence || 0,
        keyFindings,
        regime,
        priceAtCycle: currentPrice,
      });

      // Update persistence
      const existing = symbolPersistence.get(agentName);
      if (!existing) {
        // First time seeing this agent
        symbolPersistence.set(agentName, {
          agentName,
          currentSignal: signalDir as 'bullish' | 'bearish' | 'neutral',
          consecutiveCycles: 1,
          firstSeenAt: timestamp,
          convictionScore: 0.1,
          lastFlipAt: 0,
          flipCount: 0,
        });
      } else if (existing.currentSignal === signalDir) {
        // Same signal — strengthen conviction
        existing.consecutiveCycles++;
        existing.convictionScore = Math.min(1.0,
          existing.convictionScore + this.CONVICTION_GROWTH_RATE * (1 - existing.convictionScore)
        );
      } else {
        // Signal flipped — record flip, reset conviction
        flips.push({
          agentName,
          from: existing.currentSignal,
          to: signalDir,
          timestamp,
        });
        if (flips.length > this.MAX_FLIP_HISTORY) flips.shift();

        existing.currentSignal = signalDir as 'bullish' | 'bearish' | 'neutral';
        existing.consecutiveCycles = 1;
        existing.firstSeenAt = timestamp;
        existing.convictionScore = Math.max(0.05, existing.convictionScore * this.CONVICTION_DECAY_RATE);
        existing.lastFlipAt = timestamp;
        existing.flipCount++;
      }
    }

    // Trim insights
    if (symbolInsights.length > this.MAX_INSIGHTS_PER_SYMBOL) {
      symbolInsights.splice(0, symbolInsights.length - this.MAX_INSIGHTS_PER_SYMBOL);
    }
  }

  /**
   * Get cross-cycle context for agents to consume.
   * This is injected into the agent context alongside MarketRegimeAI guidance.
   */
  getContext(symbol: string): CrossCycleContext {
    const symbolPersistence = this.persistence.get(symbol) || new Map();
    const symbolInsights = this.insights.get(symbol) || [];
    const regimes = this.regimeHistory.get(symbol) || [];
    const flips = this.signalFlips.get(symbol) || [];
    const prices = this.priceHistory.get(symbol) || [];
    const cycleCount = this.cycleCounters.get(symbol) || 0;

    // Build persistence record
    const persistenceRecord: Record<string, SignalPersistence> = {};
    for (const [name, p] of symbolPersistence) {
      persistenceRecord[name] = { ...p };
    }

    // Calculate overall conviction and dominant direction
    let bullishConviction = 0;
    let bearishConviction = 0;
    let neutralCount = 0;
    let totalAgents = 0;

    for (const p of symbolPersistence.values()) {
      totalAgents++;
      if (p.currentSignal === 'bullish') {
        bullishConviction += p.convictionScore;
      } else if (p.currentSignal === 'bearish') {
        bearishConviction += p.convictionScore;
      } else {
        neutralCount++;
      }
    }

    const totalConviction = bullishConviction + bearishConviction;
    const overallConviction = totalAgents > 0 ? totalConviction / totalAgents : 0;

    let dominantDirection: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let directionStrength = 0;
    if (bullishConviction > bearishConviction && bullishConviction > 0) {
      dominantDirection = 'bullish';
      directionStrength = totalConviction > 0 ? bullishConviction / totalConviction : 0;
    } else if (bearishConviction > bullishConviction && bearishConviction > 0) {
      dominantDirection = 'bearish';
      directionStrength = totalConviction > 0 ? bearishConviction / totalConviction : 0;
    }

    // Build regime history with durations
    const regimeHistoryWithDuration = regimes.map((r, i) => {
      const nextTimestamp = i < regimes.length - 1 ? regimes[i + 1].timestamp : getActiveClock().now();
      return {
        regime: r.regime,
        timestamp: r.timestamp,
        duration: nextTimestamp - r.timestamp,
      };
    });

    // Return last 20 insights for agent context (not all 200)
    const recentInsights = symbolInsights.slice(-20);

    return {
      signalPersistence: persistenceRecord,
      recentInsights,
      overallConviction: Math.round(overallConviction * 1000) / 1000,
      dominantDirection,
      directionStrength: Math.round(directionStrength * 1000) / 1000,
      regimeHistory: regimeHistoryWithDuration.slice(-10),
      signalFlips: flips.slice(-20),
      priceHistory: prices.slice(-50),
      cycleCount,
    };
  }

  /**
   * Get a summary string for injection into agent prompts.
   */
  getSummaryForAgent(symbol: string, agentName: string): string {
    const ctx = this.getContext(symbol);
    const persistence = ctx.signalPersistence[agentName];

    const parts: string[] = [];

    if (persistence) {
      parts.push(`Your signal has been ${persistence.currentSignal} for ${persistence.consecutiveCycles} consecutive cycles (conviction: ${(persistence.convictionScore * 100).toFixed(0)}%)`);
      if (persistence.flipCount > 0) {
        parts.push(`You have flipped direction ${persistence.flipCount} times in this window`);
      }
    }

    parts.push(`Overall market conviction: ${ctx.dominantDirection} (${(ctx.directionStrength * 100).toFixed(0)}% strength)`);
    parts.push(`Analysis cycles completed: ${ctx.cycleCount}`);

    if (ctx.signalFlips.length > 0) {
      const recentFlips = ctx.signalFlips.slice(-3);
      parts.push(`Recent signal flips: ${recentFlips.map(f => `${f.agentName}: ${f.from}→${f.to}`).join(', ')}`);
    }

    return parts.join('. ') + '.';
  }

  /**
   * Extract key findings from agent reasoning text.
   */
  private extractKeyFindings(reasoning: string): string[] {
    if (!reasoning) return [];

    const findings: string[] = [];

    // Extract sentences containing key indicators
    const sentences = reasoning.split(/[.!]\s+/);
    const keyTerms = [
      'support', 'resistance', 'breakout', 'breakdown', 'divergence',
      'volume', 'momentum', 'trend', 'reversal', 'accumulation',
      'distribution', 'overbought', 'oversold', 'bullish', 'bearish',
      'whale', 'liquidation', 'funding', 'correlation',
    ];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (keyTerms.some(term => lower.includes(term)) && sentence.length > 20 && sentence.length < 200) {
        findings.push(sentence.trim());
        if (findings.length >= 3) break; // Max 3 key findings per agent per cycle
      }
    }

    return findings;
  }

  /**
   * Get statistics for monitoring.
   */
  getStats(): Record<string, {
    cycleCount: number;
    insightCount: number;
    agentCount: number;
    flipCount: number;
    overallConviction: number;
    dominantDirection: string;
  }> {
    const stats: Record<string, any> = {};

    for (const [symbol, insights] of this.insights) {
      const ctx = this.getContext(symbol);
      stats[symbol] = {
        cycleCount: ctx.cycleCount,
        insightCount: insights.length,
        agentCount: Object.keys(ctx.signalPersistence).length,
        flipCount: ctx.signalFlips.length,
        overallConviction: ctx.overallConviction,
        dominantDirection: ctx.dominantDirection,
      };
    }

    return stats;
  }

  /**
   * Clear memory for a symbol (e.g., when stopping analysis).
   */
  clearSymbol(symbol: string): void {
    this.insights.delete(symbol);
    this.persistence.delete(symbol);
    this.regimeHistory.delete(symbol);
    this.priceHistory.delete(symbol);
    this.signalFlips.delete(symbol);
    this.cycleCounters.delete(symbol);
  }

  /**
   * Clear all memory.
   */
  clearAll(): void {
    this.insights.clear();
    this.persistence.clear();
    this.regimeHistory.clear();
    this.priceHistory.clear();
    this.signalFlips.clear();
    this.cycleCounters.clear();
  }
}

// Singleton
let memoryInstance: CrossCycleMemory | null = null;

export function getCrossCycleMemory(): CrossCycleMemory {
  if (!memoryInstance) {
    memoryInstance = new CrossCycleMemory();
  }
  return memoryInstance;
}
