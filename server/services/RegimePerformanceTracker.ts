import { getActiveClock } from '../_core/clock';
/**
 * RegimePerformanceTracker — Phase 36: Track trade outcomes per market regime.
 *
 * Records win rate, average R:R, cumulative PnL, and other metrics for each
 * regime so the user can see which market conditions the system trades best in.
 *
 * Data is kept in-memory with a configurable sliding window (default: last 500
 * trades). Hooks into `position_closed` events from the trading engines.
 */

export interface TradeRecord {
  symbol: string;
  regime: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  riskRewardActual: number;   // Actual R:R achieved
  holdingTimeMs: number;
  timestamp: number;
  strategy: string;
}

export interface RegimeStats {
  regime: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;              // 0-1
  avgPnlPercent: number;
  totalPnl: number;
  avgRiskReward: number;
  bestTrade: number;            // Best PnL %
  worstTrade: number;           // Worst PnL %
  avgHoldingTimeMs: number;
  profitFactor: number;         // Gross profit / gross loss
  sharpeRatio: number;          // Risk-adjusted return
  consecutiveWins: number;      // Current streak
  consecutiveLosses: number;    // Current streak
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  lastTradeAt: number;
  tradesByDirection: {
    long: { count: number; winRate: number; avgPnl: number };
    short: { count: number; winRate: number; avgPnl: number };
  };
}

export interface PerformanceSummary {
  regimeStats: Record<string, RegimeStats>;
  bestRegime: string;
  worstRegime: string;
  overallWinRate: number;
  overallAvgRR: number;
  totalTrades: number;
  recentTrades: TradeRecord[];
}

const MAX_TRADES = 500;

export class RegimePerformanceTracker {
  private trades: TradeRecord[] = [];

  /**
   * Record a completed trade with its regime context.
   */
  recordTrade(trade: {
    symbol: string;
    regime: string;
    direction: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    stopLoss?: number;
    entryTime: Date | number;
    exitTime?: Date | number;
    strategy?: string;
  }): void {
    const entryTs = typeof trade.entryTime === 'number' ? trade.entryTime : trade.entryTime.getTime();
    const exitTs = trade.exitTime
      ? (typeof trade.exitTime === 'number' ? trade.exitTime : trade.exitTime.getTime())
      : getActiveClock().now();

    // Calculate actual R:R
    let riskRewardActual = 0;
    if (trade.stopLoss && trade.stopLoss > 0) {
      const risk = Math.abs(trade.entryPrice - trade.stopLoss);
      const reward = Math.abs(trade.exitPrice - trade.entryPrice);
      riskRewardActual = risk > 0 ? reward / risk : 0;
    } else {
      // Fallback: use PnL% as proxy
      riskRewardActual = Math.abs(trade.pnlPercent) > 0 ? Math.abs(trade.pnlPercent) / 1.0 : 0;
    }

    const record: TradeRecord = {
      symbol: trade.symbol,
      regime: trade.regime || 'unknown',
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      pnlPercent: trade.pnlPercent,
      riskRewardActual: Math.round(riskRewardActual * 100) / 100,
      holdingTimeMs: exitTs - entryTs,
      timestamp: exitTs,
      strategy: trade.strategy || 'unknown',
    };

    this.trades.push(record);

    // Trim to sliding window
    if (this.trades.length > MAX_TRADES) {
      this.trades.splice(0, this.trades.length - MAX_TRADES);
    }
  }

  /**
   * Get performance stats for a specific regime.
   */
  getRegimeStats(regime: string): RegimeStats {
    const regimeTrades = this.trades.filter(t => t.regime === regime);
    return this.calculateStats(regime, regimeTrades);
  }

  /**
   * Get full performance summary across all regimes.
   */
  getSummary(): PerformanceSummary {
    // Group by regime
    const regimeGroups = new Map<string, TradeRecord[]>();
    for (const trade of this.trades) {
      const group = regimeGroups.get(trade.regime) || [];
      group.push(trade);
      regimeGroups.set(trade.regime, group);
    }

    const regimeStats: Record<string, RegimeStats> = {};
    for (const [regime, trades] of regimeGroups) {
      regimeStats[regime] = this.calculateStats(regime, trades);
    }

    // Find best and worst regimes
    let bestRegime = 'none';
    let worstRegime = 'none';
    let bestWinRate = -1;
    let worstWinRate = 2;

    for (const [regime, stats] of Object.entries(regimeStats)) {
      if (stats.totalTrades >= 3) { // Minimum 3 trades for meaningful comparison
        if (stats.winRate > bestWinRate) {
          bestWinRate = stats.winRate;
          bestRegime = regime;
        }
        if (stats.winRate < worstWinRate) {
          worstWinRate = stats.winRate;
          worstRegime = regime;
        }
      }
    }

    // Overall stats
    const allStats = this.calculateStats('all', this.trades);

    return {
      regimeStats,
      bestRegime,
      worstRegime,
      overallWinRate: allStats.winRate,
      overallAvgRR: allStats.avgRiskReward,
      totalTrades: this.trades.length,
      recentTrades: this.trades.slice(-20).reverse(),
    };
  }

  /**
   * Calculate stats for a set of trades.
   */
  private calculateStats(regime: string, trades: TradeRecord[]): RegimeStats {
    if (trades.length === 0) {
      return this.emptyStats(regime);
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;

    const avgPnlPercent = trades.reduce((sum, t) => sum + t.pnlPercent, 0) / trades.length;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgRR = trades.reduce((sum, t) => sum + t.riskRewardActual, 0) / trades.length;
    const avgHoldingTimeMs = trades.reduce((sum, t) => sum + t.holdingTimeMs, 0) / trades.length;

    const bestTrade = Math.max(...trades.map(t => t.pnlPercent));
    const worstTrade = Math.min(...trades.map(t => t.pnlPercent));

    // Profit factor
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Sharpe ratio (simplified: mean return / std dev of returns)
    const returns = trades.map(t => t.pnlPercent);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

    // Consecutive wins/losses
    let currentWins = 0;
    let currentLosses = 0;
    let maxWins = 0;
    let maxLosses = 0;

    // Sort by timestamp for streak calculation
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    for (const trade of sorted) {
      if (trade.pnl > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    }

    // Direction breakdown
    const longTrades = trades.filter(t => t.direction === 'long');
    const shortTrades = trades.filter(t => t.direction === 'short');

    const longWins = longTrades.filter(t => t.pnl > 0);
    const shortWins = shortTrades.filter(t => t.pnl > 0);

    return {
      regime,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 1000) / 1000,
      avgPnlPercent: Math.round(avgPnlPercent * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgRiskReward: Math.round(avgRR * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
      avgHoldingTimeMs: Math.round(avgHoldingTimeMs),
      profitFactor: Math.round(profitFactor * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      consecutiveWins: currentWins,
      consecutiveLosses: currentLosses,
      maxConsecutiveWins: maxWins,
      maxConsecutiveLosses: maxLosses,
      lastTradeAt: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : 0,
      tradesByDirection: {
        long: {
          count: longTrades.length,
          winRate: longTrades.length > 0 ? Math.round(longWins.length / longTrades.length * 1000) / 1000 : 0,
          avgPnl: longTrades.length > 0 ? Math.round(longTrades.reduce((s, t) => s + t.pnlPercent, 0) / longTrades.length * 100) / 100 : 0,
        },
        short: {
          count: shortTrades.length,
          winRate: shortTrades.length > 0 ? Math.round(shortWins.length / shortTrades.length * 1000) / 1000 : 0,
          avgPnl: shortTrades.length > 0 ? Math.round(shortTrades.reduce((s, t) => s + t.pnlPercent, 0) / shortTrades.length * 100) / 100 : 0,
        },
      },
    };
  }

  private emptyStats(regime: string): RegimeStats {
    return {
      regime,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgPnlPercent: 0,
      totalPnl: 0,
      avgRiskReward: 0,
      bestTrade: 0,
      worstTrade: 0,
      avgHoldingTimeMs: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      lastTradeAt: 0,
      tradesByDirection: {
        long: { count: 0, winRate: 0, avgPnl: 0 },
        short: { count: 0, winRate: 0, avgPnl: 0 },
      },
    };
  }

  /**
   * Get all recorded trades (for export/debugging).
   */
  getAllTrades(): TradeRecord[] {
    return [...this.trades];
  }

  /**
   * Clear all recorded data.
   */
  clear(): void {
    this.trades = [];
  }
}

// Singleton
let trackerInstance: RegimePerformanceTracker | null = null;

export function getRegimePerformanceTracker(): RegimePerformanceTracker {
  if (!trackerInstance) {
    trackerInstance = new RegimePerformanceTracker();
  }
  return trackerInstance;
}
