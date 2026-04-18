import { getDb } from "../db";
import { portfolioSnapshots, InsertPortfolioSnapshot, paperPositions, capitalAllocations } from "../../drizzle/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { calculateAllVaR } from "../risk/VaRCalculator";
import { calculateDrawdown } from "../risk/DrawdownMonitor";

/**
 * Portfolio Snapshot Service
 * 
 * Captures daily portfolio snapshots for historical analysis and equity curve tracking.
 * 
 * Features:
 * - Daily automated snapshots
 * - Equity curve calculation
 * - Risk metrics snapshot (VaR, drawdown, Sharpe ratio)
 * - Position composition tracking
 * - Performance trend analysis
 */
export class PortfolioSnapshotService {
  private userId: number;

  constructor(userId: number) {
    this.userId = userId;
  }

  /**
   * Capture current portfolio snapshot
   */
  async captureSnapshot(): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.error("[PortfolioSnapshotService] Database not available");
      return;
    }

    try {
      // Get current capital allocation
      const capitalRecords = await db
        .select()
        .from(capitalAllocations)
        .where(eq(capitalAllocations.userId, this.userId))
        .orderBy(desc(capitalAllocations.createdAt))
        .limit(1);

      if (capitalRecords.length === 0) {
        console.warn("[PortfolioSnapshotService] No capital allocation record found");
        return;
      }

      const capital = capitalRecords[0];
      const totalBalance = parseFloat(capital.totalCapital.toString());

      // Get open positions
      const openPositions = await db
        .select()
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.userId, this.userId),
            eq(paperPositions.status, "open")
          )
        );

      // Calculate positions value and unrealized P&L
      let positionsValue = 0;
      let unrealizedPnL = 0;
      const positionDetails: any[] = [];

      for (const position of openPositions) {
        const currentPrice = parseFloat(position.currentPrice?.toString() || "0");
        const entryPrice = parseFloat(position.entryPrice.toString());
        const quantity = parseFloat(position.quantity.toString());

        const positionValue = currentPrice * quantity;
        const pnl = position.side === "long"
          ? (currentPrice - entryPrice) * quantity
          : (entryPrice - currentPrice) * quantity;

        positionsValue += positionValue;
        unrealizedPnL += pnl;

        positionDetails.push({
          symbol: position.symbol,
          side: position.side,
          value: positionValue,
          weight: 0, // Will calculate after total
          pnl,
          quantity,
          entryPrice,
          currentPrice,
        });
      }

      // Calculate weights
      const totalEquity = totalBalance + unrealizedPnL;
      for (const detail of positionDetails) {
        detail.weight = totalEquity > 0 ? (detail.value / totalEquity) * 100 : 0;
      }

      // Calculate daily return (compare to previous snapshot)
      const dailyReturn = await this.calculateDailyReturn(totalEquity);
      const dailyPnL = dailyReturn !== null ? totalEquity * (dailyReturn / 100) : null;

      // Calculate portfolio VaR
      const portfolioVaR95 = this.calculatePortfolioVaR(openPositions);

      // Calculate current drawdown
      const equityCurve = await this.getEquityCurve(30); // Last 30 days
      const drawdownMetrics = calculateDrawdown(totalEquity, equityCurve);

      // Calculate Sharpe ratio (simplified)
      const sharpeRatio = await this.calculateSharpeRatio(30);

      // Calculate capital allocation
      const activeTradingCapital = positionsValue;
      const reserveCapital = totalBalance - positionsValue;

      // Create snapshot
      const snapshot: InsertPortfolioSnapshot = {
        userId: this.userId,
        snapshotDate: new Date(),
        totalEquity: totalEquity.toString(),
        cash: totalBalance.toString(),
        positionsValue: positionsValue.toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        realizedPnL: "0", // Would need to calculate from trade history
        dailyReturn: dailyReturn?.toString() || null,
        dailyPnL: dailyPnL?.toString() || null,
        numberOfPositions: openPositions.length,
        positionDetails: JSON.stringify(positionDetails),
        portfolioVaR95: portfolioVaR95.toString(),
        currentDrawdown: drawdownMetrics.currentDrawdown.toString(),
        sharpeRatio: sharpeRatio?.toString() || null,
        activeTradingCapital: activeTradingCapital.toString(),
        reserveCapital: reserveCapital.toString(),
      };

      await db.insert(portfolioSnapshots).values(snapshot);

      console.log(`[PortfolioSnapshotService] Snapshot captured: Equity=$${totalEquity.toFixed(2)}, Positions=${openPositions.length}, VaR=$${portfolioVaR95.toFixed(2)}`);
    } catch (error) {
      console.error("[PortfolioSnapshotService] Error capturing snapshot:", error);
    }
  }

  /**
   * Calculate daily return compared to previous snapshot
   */
  private async calculateDailyReturn(currentEquity: number): Promise<number | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      const previousSnapshots = await db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.userId, this.userId))
        .orderBy(desc(portfolioSnapshots.snapshotDate))
        .limit(1);

      if (previousSnapshots.length === 0) {
        return null; // No previous snapshot
      }

      const previousEquity = parseFloat(previousSnapshots[0].totalEquity.toString());
      if (previousEquity === 0) return null;

      const dailyReturn = ((currentEquity - previousEquity) / previousEquity) * 100;
      return dailyReturn;
    } catch (error) {
      console.error("[PortfolioSnapshotService] Error calculating daily return:", error);
      return null;
    }
  }

  /**
   * Get equity curve for the last N days
   */
  private async getEquityCurve(days: number): Promise<number[]> {
    const db = await getDb();
    if (!db) return [];

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const snapshots = await db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(
            eq(portfolioSnapshots.userId, this.userId),
            gte(portfolioSnapshots.snapshotDate, startDate)
          )
        )
        .orderBy(portfolioSnapshots.snapshotDate);

      return snapshots.map(s => parseFloat(s.totalEquity.toString()));
    } catch (error) {
      console.error("[PortfolioSnapshotService] Error getting equity curve:", error);
      return [];
    }
  }

  /**
   * Calculate portfolio VaR (simplified)
   */
  private calculatePortfolioVaR(positions: any[]): number {
    let totalVaR = 0;

    for (const position of positions) {
      const currentPrice = parseFloat(position.currentPrice?.toString() || "0");
      const quantity = parseFloat(position.quantity.toString());
      const positionValue = currentPrice * quantity;
      const volatility = 0.02; // 2% daily volatility assumption
      const positionVaR = positionValue * volatility * 2; // 95% confidence
      totalVaR += positionVaR;
    }

    return totalVaR;
  }

  /**
   * Calculate Sharpe ratio over the last N days
   */
  private async calculateSharpeRatio(days: number): Promise<number | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const snapshots = await db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(
            eq(portfolioSnapshots.userId, this.userId),
            gte(portfolioSnapshots.snapshotDate, startDate)
          )
        )
        .orderBy(portfolioSnapshots.snapshotDate);

      if (snapshots.length < 2) {
        return null; // Need at least 2 data points
      }

      // Calculate daily returns
      const returns: number[] = [];
      for (let i = 1; i < snapshots.length; i++) {
        const prevEquity = parseFloat(snapshots[i - 1].totalEquity.toString());
        const currEquity = parseFloat(snapshots[i].totalEquity.toString());
        if (prevEquity > 0) {
          const dailyReturn = (currEquity - prevEquity) / prevEquity;
          returns.push(dailyReturn);
        }
      }

      if (returns.length === 0) return null;

      // Calculate mean return
      const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

      // Calculate standard deviation
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) return null;

      // Sharpe ratio (assuming 2% annual risk-free rate = 0.0055% daily)
      const riskFreeRate = 0.02 / 365;
      const sharpeRatio = (meanReturn - riskFreeRate) / stdDev;

      // Annualize Sharpe ratio
      const annualizedSharpe = sharpeRatio * Math.sqrt(252); // 252 trading days

      return annualizedSharpe;
    } catch (error) {
      console.error("[PortfolioSnapshotService] Error calculating Sharpe ratio:", error);
      return null;
    }
  }

  /**
   * Get snapshot history
   */
  async getSnapshotHistory(days: number = 30): Promise<any[]> {
    const db = await getDb();
    if (!db) return [];

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const snapshots = await db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(
            eq(portfolioSnapshots.userId, this.userId),
            gte(portfolioSnapshots.snapshotDate, startDate)
          )
        )
        .orderBy(portfolioSnapshots.snapshotDate);

      return snapshots.map(s => ({
        date: s.snapshotDate,
        totalEquity: parseFloat(s.totalEquity.toString()),
        cash: parseFloat(s.cash.toString()),
        positionsValue: parseFloat(s.positionsValue.toString()),
        unrealizedPnL: parseFloat(s.unrealizedPnL.toString()),
        realizedPnL: parseFloat(s.realizedPnL.toString()),
        dailyReturn: s.dailyReturn ? parseFloat(s.dailyReturn.toString()) : null,
        dailyPnL: s.dailyPnL ? parseFloat(s.dailyPnL.toString()) : null,
        numberOfPositions: s.numberOfPositions,
        portfolioVaR95: parseFloat(s.portfolioVaR95?.toString() || "0"),
        currentDrawdown: parseFloat(s.currentDrawdown?.toString() || "0"),
        sharpeRatio: s.sharpeRatio ? parseFloat(s.sharpeRatio.toString()) : null,
      }));
    } catch (error) {
      console.error("[PortfolioSnapshotService] Error getting snapshot history:", error);
      return [];
    }
  }

  /**
   * Get equity curve for charting
   */
  async getEquityCurveForChart(days: number = 30): Promise<{ date: Date; equity: number }[]> {
    const snapshots = await this.getSnapshotHistory(days);
    return snapshots.map(s => ({
      date: s.date,
      equity: s.totalEquity,
    }));
  }

  /**
   * Calculate performance metrics
   */
  async getPerformanceMetrics(days: number = 30): Promise<{
    totalReturn: number;
    avgDailyReturn: number;
    volatility: number;
    sharpeRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
  }> {
    const snapshots = await this.getSnapshotHistory(days);

    if (snapshots.length < 2) {
      return {
        totalReturn: 0,
        avgDailyReturn: 0,
        volatility: 0,
        sharpeRatio: null,
        maxDrawdown: 0,
        winRate: null,
      };
    }

    // Total return
    const firstEquity = snapshots[0].totalEquity;
    const lastEquity = snapshots[snapshots.length - 1].totalEquity;
    const totalReturn = firstEquity > 0 ? ((lastEquity - firstEquity) / firstEquity) * 100 : 0;

    // Average daily return
    const returns = snapshots
      .filter(s => s.dailyReturn !== null)
      .map(s => s.dailyReturn!);
    const avgDailyReturn = returns.length > 0
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : 0;

    // Volatility (standard deviation of returns)
    const volatility = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / returns.length)
      : 0;

    // Sharpe ratio
    const sharpeRatio = snapshots[snapshots.length - 1].sharpeRatio;

    // Max drawdown
    const maxDrawdown = Math.max(...snapshots.map(s => s.currentDrawdown));

    return {
      totalReturn,
      avgDailyReturn,
      volatility,
      sharpeRatio,
      maxDrawdown,
      winRate: null, // Would need trade history to calculate
    };
  }
}

/**
 * Schedule daily portfolio snapshots
 * 
 * This should be called from a cron job or scheduler
 */
export async function scheduleDailySnapshots(userId: number): Promise<void> {
  const service = new PortfolioSnapshotService(userId);
  await service.captureSnapshot();
}
