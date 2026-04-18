/**
 * Portfolio Risk Calculator
 * 
 * Calculates portfolio-level risk metrics:
 * - Sharpe Ratio
 * - Sortino Ratio
 * - Maximum Drawdown
 * - Volatility
 * - Correlation Matrix
 */

import { getDb } from '../db';
import { portfolioRiskMetrics, positions, trades } from '../../drizzle/schema';
import { eq, gte, and } from 'drizzle-orm';

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
  positions: {
    symbol: string;
    value: number;
    pnl: number;
  }[];
}

export interface RiskMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  volatility: number;
  dailyReturn: number;
  cumulativeReturn: number;
  correlationMatrix: Record<string, number>;
}

export class PortfolioRiskCalculator {
  private riskFreeRate: number = 0.04; // 4% annual risk-free rate (US Treasury)

  /**
   * Calculate comprehensive portfolio risk metrics
   */
  async calculateRiskMetrics(
    userId: number,
    lookbackDays: number = 30
  ): Promise<RiskMetrics> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Get historical portfolio values
    const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const historicalMetrics = await db
      .select()
      .from(portfolioRiskMetrics)
      .where(
        and(
          eq(portfolioRiskMetrics.userId, userId),
          gte(portfolioRiskMetrics.timestamp, startDate)
        )
      )
      .orderBy(portfolioRiskMetrics.timestamp);

    if (historicalMetrics.length < 2) {
      // Not enough data, return default values
      return {
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdown: 0,
        volatility: 0,
        dailyReturn: 0,
        cumulativeReturn: 0,
        correlationMatrix: {},
      };
    }

    // Calculate daily returns
    const returns: number[] = [];
    for (let i = 1; i < historicalMetrics.length; i++) {
      const prevValue = parseFloat(historicalMetrics[i - 1].totalValue);
      const currValue = parseFloat(historicalMetrics[i].totalValue);
      const dailyReturn = (currValue - prevValue) / prevValue;
      returns.push(dailyReturn);
    }

    // Calculate metrics
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const maxDrawdown = this.calculateMaxDrawdown(historicalMetrics.map(m => parseFloat(m.totalValue)));
    const volatility = this.calculateVolatility(returns);
    const dailyReturn = returns.length > 0 ? returns[returns.length - 1] : 0;
    const cumulativeReturn = this.calculateCumulativeReturn(returns);

    // Calculate correlation matrix
    const correlationMatrix = await this.calculateCorrelationMatrix(userId, lookbackDays);

    return {
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      volatility,
      dailyReturn,
      cumulativeReturn,
      correlationMatrix,
    };
  }

  /**
   * Calculate Sharpe Ratio
   * (Average Return - Risk Free Rate) / Standard Deviation
   */
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = this.calculateVolatility(returns);

    if (stdDev === 0) return 0;

    // Annualize (assuming daily returns)
    const dailyRiskFreeRate = this.riskFreeRate / 365;
    const sharpeRatio = (avgReturn - dailyRiskFreeRate) / stdDev;

    // Annualize Sharpe Ratio
    return sharpeRatio * Math.sqrt(365);
  }

  /**
   * Calculate Sortino Ratio
   * Similar to Sharpe but only penalizes downside volatility
   */
  private calculateSortinoRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const downsideReturns = returns.filter(r => r < 0);

    if (downsideReturns.length === 0) return 0;

    const downsideStdDev = Math.sqrt(
      downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length
    );

    if (downsideStdDev === 0) return 0;

    const dailyRiskFreeRate = this.riskFreeRate / 365;
    const sortinoRatio = (avgReturn - dailyRiskFreeRate) / downsideStdDev;

    // Annualize Sortino Ratio
    return sortinoRatio * Math.sqrt(365);
  }

  /**
   * Calculate Maximum Drawdown
   * Maximum peak-to-trough decline
   */
  private calculateMaxDrawdown(values: number[]): number {
    if (values.length === 0) return 0;

    let maxDrawdown = 0;
    let peak = values[0];

    for (const value of values) {
      if (value > peak) {
        peak = value;
      }

      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Calculate Volatility (Standard Deviation of Returns)
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * Calculate Cumulative Return
   */
  private calculateCumulativeReturn(returns: number[]): number {
    if (returns.length === 0) return 0;

    // Compound returns: (1 + r1) * (1 + r2) * ... - 1
    return returns.reduce((cumulative, r) => cumulative * (1 + r), 1) - 1;
  }

  /**
   * Calculate correlation matrix between all traded symbols
   */
  private async calculateCorrelationMatrix(
    userId: number,
    lookbackDays: number
  ): Promise<Record<string, number>> {
    const db = await getDb();
    if (!db) {
      return {};
    }

    // Get all active symbols
    const activePositions = await db
      .select()
      .from(positions)
      .where(eq(positions.userId, userId));

    const symbols = Array.from(new Set(activePositions.map(p => p.symbol)));

    if (symbols.length < 2) {
      return {}; // Need at least 2 symbols for correlation
    }

    // Get historical trades for each symbol
    const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const historicalTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          gte(trades.entryTime, startDate)
        )
      )
      .orderBy(trades.entryTime);

    // Group trades by symbol and calculate daily returns
    const symbolReturns: Map<string, number[]> = new Map();

    for (const symbol of symbols) {
      const symbolTrades = historicalTrades.filter(t => t.symbol === symbol);
      const returns: number[] = [];

      for (let i = 1; i < symbolTrades.length; i++) {
        const prevPrice = parseFloat(symbolTrades[i - 1].entryPrice);
        const currPrice = parseFloat(symbolTrades[i].entryPrice);
        const dailyReturn = (currPrice - prevPrice) / prevPrice;
        returns.push(dailyReturn);
      }

      symbolReturns.set(symbol, returns);
    }

    // Calculate pairwise correlations
    const correlationMatrix: Record<string, number> = {};

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symbol1 = symbols[i];
        const symbol2 = symbols[j];
        const returns1 = symbolReturns.get(symbol1) || [];
        const returns2 = symbolReturns.get(symbol2) || [];

        const correlation = this.calculatePearsonCorrelation(returns1, returns2);
        const key = `${symbol1}-${symbol2}`;
        correlationMatrix[key] = correlation;
      }
    }

    return correlationMatrix;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length === 0 || y.length === 0 || x.length !== y.length) {
      return 0;
    }

    const n = x.length;
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));

    if (denomX === 0 || denomY === 0) return 0;

    return numerator / (denomX * denomY);
  }

  /**
   * Save current portfolio snapshot to database
   */
  async savePortfolioSnapshot(
    userId: number,
    snapshot: PortfolioSnapshot,
    metrics: RiskMetrics
  ): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.warn('[PortfolioRiskCalculator] Database not available, skipping snapshot save');
      return;
    }

    try {
      await db.insert(portfolioRiskMetrics).values({
        userId,
        timestamp: new Date(snapshot.timestamp),
        totalValue: snapshot.totalValue.toString(),
        dailyReturn: metrics.dailyReturn.toString(),
        cumulativeReturn: metrics.cumulativeReturn.toString(),
        sharpeRatio: metrics.sharpeRatio.toString(),
        sortinoRatio: metrics.sortinoRatio.toString(),
        maxDrawdown: metrics.maxDrawdown.toString(),
        volatility: metrics.volatility.toString(),
        numberOfPositions: snapshot.positions.length,
        allocatedCapital: snapshot.positions.reduce((sum, p) => sum + p.value, 0).toString(),
        availableCash: (snapshot.totalValue - snapshot.positions.reduce((sum, p) => sum + p.value, 0)).toString(),
        correlationMatrix: JSON.stringify(metrics.correlationMatrix),
      });
    } catch (error) {
      console.error('[PortfolioRiskCalculator] Failed to save portfolio snapshot:', error);
    }
  }

  /**
   * Get historical risk metrics
   */
  async getHistoricalMetrics(
    userId: number,
    lookbackDays: number = 30
  ): Promise<any[]> {
    const db = await getDb();
    if (!db) {
      return [];
    }

    const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const metrics = await db
      .select()
      .from(portfolioRiskMetrics)
      .where(
        and(
          eq(portfolioRiskMetrics.userId, userId),
          gte(portfolioRiskMetrics.timestamp, startDate)
        )
      )
      .orderBy(portfolioRiskMetrics.timestamp);

    return metrics.map(m => ({
      ...m,
      correlationMatrix: JSON.parse(m.correlationMatrix as string || '{}'),
    }));
  }
}
