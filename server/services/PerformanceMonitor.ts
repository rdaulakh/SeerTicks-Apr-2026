/**
 * Performance Monitor Service
 * Tracks and analyzes trading performance metrics
 */

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  averagePnL: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  averageHoldTime: number;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryTime: Date;
  exitTime: Date;
  holdTime: number;
  strategy?: string;
}

class PerformanceMonitor {
  private trades: TradeRecord[] = [];
  private metrics: PerformanceMetrics | null = null;
  private lastUpdateTime: Date = new Date();

  /**
   * Add a completed trade to the performance tracker
   */
  addTrade(trade: TradeRecord): void {
    this.trades.push(trade);
    this.metrics = null; // Invalidate cached metrics
    this.lastUpdateTime = new Date();
  }

  /**
   * Calculate current performance metrics
   */
  calculateMetrics(): PerformanceMetrics {
    if (this.metrics && this.trades.length > 0) {
      return this.metrics;
    }

    const totalTrades = this.trades.length;
    
    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        averagePnL: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        averageHoldTime: 0,
      };
    }

    const winningTrades = this.trades.filter(t => t.pnl > 0);
    const losingTrades = this.trades.filter(t => t.pnl < 0);
    
    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const averagePnL = totalPnL / totalTrades;
    
    const totalWinAmount = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossAmount = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0;
    
    const averageWin = winningTrades.length > 0 
      ? totalWinAmount / winningTrades.length 
      : 0;
    
    const averageLoss = losingTrades.length > 0 
      ? totalLossAmount / losingTrades.length 
      : 0;

    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(t => t.pnl)) 
      : 0;
    
    const largestLoss = losingTrades.length > 0 
      ? Math.min(...losingTrades.map(t => t.pnl)) 
      : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;
    
    for (const trade of this.trades) {
      runningPnL += trade.pnl;
      if (runningPnL > peak) {
        peak = runningPnL;
      }
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate consecutive wins/losses
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    
    for (const trade of this.trades) {
      if (trade.pnl > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        consecutiveWins = Math.max(consecutiveWins, currentWinStreak);
      } else if (trade.pnl < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        consecutiveLosses = Math.max(consecutiveLosses, currentLossStreak);
      }
    }

    // Calculate average hold time
    const averageHoldTime = this.trades.length > 0
      ? this.trades.reduce((sum, t) => sum + t.holdTime, 0) / this.trades.length
      : 0;

    // Calculate Sharpe ratio (simplified)
    const returns = this.trades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    this.metrics = {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0,
      totalPnL,
      averagePnL,
      maxDrawdown,
      sharpeRatio,
      profitFactor,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      consecutiveWins,
      consecutiveLosses,
      averageHoldTime,
    };

    return this.metrics;
  }

  /**
   * Get all trades
   */
  getTrades(): TradeRecord[] {
    return [...this.trades];
  }

  /**
   * Get trades filtered by symbol
   */
  getTradesBySymbol(symbol: string): TradeRecord[] {
    return this.trades.filter(t => t.symbol === symbol);
  }

  /**
   * Get recent trades
   */
  getRecentTrades(count: number = 10): TradeRecord[] {
    return this.trades.slice(-count);
  }

  /**
   * Clear all trade history
   */
  clear(): void {
    this.trades = [];
    this.metrics = null;
    this.lastUpdateTime = new Date();
  }

  /**
   * Get last update time
   */
  getLastUpdateTime(): Date {
    return this.lastUpdateTime;
  }

  /**
   * Get current metrics (alias for calculateMetrics)
   */
  getMetrics(): PerformanceMetrics {
    return this.calculateMetrics();
  }

  /**
   * Get performance history
   */
  getPerformanceHistory(): TradeRecord[] {
    return this.getTrades();
  }
}

// Singleton instance per user
const performanceMonitors = new Map<number, PerformanceMonitor>();

export function getPerformanceMonitor(userId?: number): PerformanceMonitor {
  // If no userId provided, return a default instance
  const key = userId ?? 0;
  if (!performanceMonitors.has(key)) {
    performanceMonitors.set(key, new PerformanceMonitor());
  }
  return performanceMonitors.get(key)!;
}

export { PerformanceMonitor };
