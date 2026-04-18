import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import { strategyInstances, strategyPerformance, paperPositions, paperOrders, paperTrades, paperWallets } from "../drizzle/schema";
import type { InsertStrategyInstance, InsertStrategyPerformance } from "../drizzle/schema";

/**
 * Strategy Database Helpers
 * Functions for managing strategy instances and performance tracking
 */

// ============================================================================
// Strategy Instance Management
// ============================================================================

export async function createStrategyInstance(data: InsertStrategyInstance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(strategyInstances).values(data);
  return result[0].insertId;
}

export async function getStrategyInstance(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(strategyInstances)
    .where(and(eq(strategyInstances.id, strategyId), eq(strategyInstances.userId, userId)))
    .limit(1);

  return result[0];
}

export async function getUserStrategyInstances(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(strategyInstances)
    .where(eq(strategyInstances.userId, userId))
    .orderBy(desc(strategyInstances.createdAt));
}

export async function getActiveStrategyInstances(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(strategyInstances)
    .where(and(eq(strategyInstances.userId, userId), eq(strategyInstances.status, "active")))
    .orderBy(desc(strategyInstances.createdAt));
}

export async function updateStrategyInstance(
  strategyId: number,
  userId: number,
  updates: Partial<InsertStrategyInstance>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(strategyInstances)
    .set(updates)
    .where(and(eq(strategyInstances.id, strategyId), eq(strategyInstances.userId, userId)));
}

export async function deleteStrategyInstance(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete strategy performance records first
  await db
    .delete(strategyPerformance)
    .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)));

  // Delete strategy instance
  await db
    .delete(strategyInstances)
    .where(and(eq(strategyInstances.id, strategyId), eq(strategyInstances.userId, userId)));
}

// ============================================================================
// Strategy Performance Tracking
// ============================================================================

export async function createStrategyPerformance(data: InsertStrategyPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(strategyPerformance).values(data);
  return result[0].insertId;
}

export async function getStrategyPerformance(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(strategyPerformance)
    .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)))
    .limit(1);

  return result[0];
}

export async function updateStrategyPerformance(
  strategyId: number,
  userId: number,
  updates: Partial<InsertStrategyPerformance>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(strategyPerformance)
    .set(updates)
    .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)));
}

// ============================================================================
// Strategy-Specific Data Queries
// ============================================================================

export async function getStrategyPositions(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.strategyId, strategyId), eq(paperPositions.userId, userId)))
    .orderBy(desc(paperPositions.createdAt));
}

export async function getStrategyOpenPositions(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.strategyId, strategyId),
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, "open")
      )
    )
    .orderBy(desc(paperPositions.createdAt));
}

export async function getStrategyOrders(strategyId: number, userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(paperOrders)
    .where(and(eq(paperOrders.strategyId, strategyId), eq(paperOrders.userId, userId)))
    .orderBy(desc(paperOrders.createdAt))
    .limit(limit);
}

export async function getStrategyTrades(strategyId: number, userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(paperTrades)
    .where(and(eq(paperTrades.strategyId, strategyId), eq(paperTrades.userId, userId)))
    .orderBy(desc(paperTrades.timestamp))
    .limit(limit);
}

// ============================================================================
// Performance Calculation Helpers
// ============================================================================

/**
 * Calculate maximum peak-to-trough drawdown percentage from trade P&L series.
 * Uses the actual wallet starting balance (fetched from DB) or falls back to $10,000.
 * Trades must be in chronological order (oldest first).
 * Returns the max drawdown as a positive percentage (e.g. 15.5 means -15.5%).
 */
function calculateMaxDrawdown(trades: Array<{ pnl: string | number }>, walletStartingBalance?: number): number {
  if (!trades || trades.length === 0) return 0;

  // Trades from getStrategyTrades are sorted desc (newest first) — reverse for chrono order
  const chronoTrades = [...trades].reverse();

  // Use actual wallet balance if provided, otherwise fall back to paper trading default
  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;
  let peak = startingBalance;
  let maxDD = 0;
  let runningBalance = startingBalance;

  for (const trade of chronoTrades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (isNaN(pnl)) continue;

    runningBalance += pnl;
    if (runningBalance > peak) {
      peak = runningBalance;
    }
    const drawdown = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
    if (drawdown > maxDD) {
      maxDD = drawdown;
    }
  }

  return maxDD;
}

/**
 * Annualized Sharpe Ratio — institutional-grade implementation.
 *
 * Formula: Sharpe = (Annualized Return - Risk-Free Rate) / Annualized Volatility
 *
 * Implementation details:
 * - Converts each trade P&L to a percentage return relative to the running balance
 * - Uses the actual wallet starting balance (or $10,000 default) as the initial equity
 * - Annualizes using √(252) for daily trading (crypto markets trade ~365 days,
 *   but 252 is the institutional standard for risk-adjusted metrics)
 * - Risk-free rate defaults to 5.25% (current US T-bill rate as of 2024-2025)
 * - Requires minimum 2 trades to produce a meaningful ratio
 * - Returns null if insufficient data or zero volatility
 *
 * Interpretation:
 *   > 3.0  — Exceptional (top hedge fund tier)
 *   > 2.0  — Very good
 *   > 1.0  — Acceptable
 *   > 0.5  — Below average
 *   < 0.0  — Losing money relative to risk-free
 */
function calculateSharpeRatio(
  trades: Array<{ pnl: string | number }>,
  walletStartingBalance?: number,
  annualRiskFreeRate: number = 0.0525 // 5.25% US T-bill rate
): number | null {
  if (!trades || trades.length < 2) return null;

  // Reverse to chronological order (oldest first)
  const chronoTrades = [...trades].reverse();
  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;

  // Calculate per-trade percentage returns relative to running equity
  const returns: number[] = [];
  let runningBalance = startingBalance;

  for (const trade of chronoTrades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (isNaN(pnl)) continue;

    // Percentage return for this trade relative to equity before the trade
    if (runningBalance > 0) {
      const pctReturn = pnl / runningBalance;
      returns.push(pctReturn);
    }
    runningBalance += pnl;
  }

  if (returns.length < 2) return null;

  // Mean return per trade
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Standard deviation of returns (sample std dev with Bessel's correction)
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  // Zero volatility means no risk — Sharpe is undefined
  if (stdDev === 0 || isNaN(stdDev)) return null;

  // Annualization factor
  // Estimate trades per year: assume average ~1 trade/day for crypto
  // Use min(tradesPerYear, 252) to avoid over-annualizing for very active strategies
  const TRADING_DAYS_PER_YEAR = 252;
  const annualizationFactor = Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Per-trade risk-free rate (de-annualize)
  const perTradeRiskFreeRate = annualRiskFreeRate / TRADING_DAYS_PER_YEAR;

  // Sharpe = (mean excess return) / stdDev * annualization factor
  const excessReturn = meanReturn - perTradeRiskFreeRate;
  const sharpeRatio = (excessReturn / stdDev) * annualizationFactor;

  // Clamp to reasonable range [-10, 10] to avoid display issues
  return Math.max(-10, Math.min(10, sharpeRatio));
}

/**
 * Annualized Sortino Ratio — institutional-grade implementation.
 *
 * The Sortino ratio improves on the Sharpe ratio by only penalizing downside
 * volatility. Upside volatility (large gains) is desirable in trading and
 * should not reduce the risk-adjusted performance metric.
 *
 * Formula: Sortino = (Annualized Return - Risk-Free Rate) / Downside Deviation
 *
 * Implementation details:
 * - Uses the same per-trade percentage return calculation as Sharpe
 * - Downside deviation only considers returns below the target (risk-free rate)
 * - Uses Bessel's correction on the downside sample for unbiased estimation
 * - Annualizes using √(252) consistent with Sharpe implementation
 * - Returns null if fewer than 2 trades or zero downside deviation
 *
 * Interpretation:
 *   > 3.0  — Exceptional (strategy generates returns with minimal downside risk)
 *   > 2.0  — Very good
 *   > 1.0  — Acceptable
 *   > 0.5  — Below average
 *   < 0.0  — Losing money relative to risk-free
 *
 * Key difference from Sharpe:
 *   A strategy with high upside volatility (big winners) will have a higher
 *   Sortino than Sharpe, correctly reflecting that large gains are beneficial.
 *   Sortino > Sharpe → strategy has positive skew (desirable for trading)
 *   Sortino < Sharpe → strategy has negative skew (concerning)
 */
function calculateSortinoRatio(
  trades: Array<{ pnl: string | number }>,
  walletStartingBalance?: number,
  annualRiskFreeRate: number = 0.0525 // 5.25% US T-bill rate
): number | null {
  if (!trades || trades.length < 2) return null;

  // Reverse to chronological order (oldest first)
  const chronoTrades = [...trades].reverse();
  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;

  // Calculate per-trade percentage returns relative to running equity
  const returns: number[] = [];
  let runningBalance = startingBalance;

  for (const trade of chronoTrades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (isNaN(pnl)) continue;

    if (runningBalance > 0) {
      const pctReturn = pnl / runningBalance;
      returns.push(pctReturn);
    }
    runningBalance += pnl;
  }

  if (returns.length < 2) return null;

  const TRADING_DAYS_PER_YEAR = 252;
  const perTradeRiskFreeRate = annualRiskFreeRate / TRADING_DAYS_PER_YEAR;

  // Mean return per trade
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Downside deviation: only consider returns below the target (risk-free rate)
  // This is the key difference from Sharpe — we ignore upside volatility
  const downsideReturns = returns.filter(r => r < perTradeRiskFreeRate);

  // Need at least 2 downside observations for meaningful deviation
  if (downsideReturns.length < 2) {
    // All returns are above target — strategy has no downside risk
    // Return a high positive value if mean return is positive, null otherwise
    if (meanReturn > perTradeRiskFreeRate) {
      return 10; // Cap at maximum (all returns above target)
    }
    return null;
  }

  // Calculate downside variance using Bessel's correction
  // Sum of squared deviations below target, divided by (n-1)
  const downsideVariance = downsideReturns.reduce(
    (sum, r) => sum + Math.pow(r - perTradeRiskFreeRate, 2), 0
  ) / (downsideReturns.length - 1);
  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0 || isNaN(downsideDeviation)) return null;

  // Annualization factor
  const annualizationFactor = Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Sortino = (mean excess return) / downside deviation * annualization factor
  const excessReturn = meanReturn - perTradeRiskFreeRate;
  const sortinoRatio = (excessReturn / downsideDeviation) * annualizationFactor;

  // Clamp to reasonable range [-10, 10]
  return Math.max(-10, Math.min(10, sortinoRatio));
}

/**
 * Calmar Ratio — institutional-grade implementation.
 *
 * The Calmar ratio measures risk-adjusted return using maximum drawdown as the
 * risk denominator. Unlike Sharpe/Sortino which use volatility, Calmar directly
 * addresses the worst-case capital loss scenario — the metric institutional
 * allocators care about most.
 *
 * Formula: Calmar = Annualized Return / Max Drawdown
 *
 * Implementation details:
 * - Calculates total return as percentage of starting balance
 * - Annualizes return based on actual trading period (first to last trade)
 * - Uses the pre-calculated max drawdown percentage
 * - Minimum 5 trades and 7 days of trading history required
 * - Returns null if max drawdown is zero (no drawdown occurred)
 *
 * Interpretation:
 *   > 3.0  — Exceptional (top-tier fund performance)
 *   > 2.0  — Very good (strong risk-adjusted returns)
 *   > 1.0  — Acceptable (returns justify the drawdown risk)
 *   > 0.5  — Below average
 *   < 0.0  — Losing money
 *
 * Key difference from Sharpe/Sortino:
 *   Calmar answers: "For every 1% of max drawdown risk, how much annualized
 *   return does this strategy generate?" This is the metric that determines
 *   whether institutional capital will tolerate the strategy's worst period.
 */
function calculateCalmarRatio(
  trades: Array<{ pnl: string | number; timestamp?: Date | string | null }>,
  maxDrawdownPct: number,
  walletStartingBalance?: number
): number | null {
  if (!trades || trades.length < 5) return null;
  if (maxDrawdownPct <= 0 || isNaN(maxDrawdownPct)) return null;

  const startingBalance = walletStartingBalance && walletStartingBalance > 0 ? walletStartingBalance : 10000;

  // Calculate total realized return
  let totalPnl = 0;
  for (const trade of trades) {
    const pnl = typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
    if (!isNaN(pnl)) totalPnl += pnl;
  }

  const totalReturnPct = (totalPnl / startingBalance) * 100;

  // Determine the trading period for annualization
  // Trades come in desc order (newest first) from getStrategyTrades
  const timestamps: number[] = [];
  for (const trade of trades) {
    if (trade.timestamp) {
      const ts = trade.timestamp instanceof Date
        ? trade.timestamp.getTime()
        : new Date(trade.timestamp).getTime();
      if (!isNaN(ts)) timestamps.push(ts);
    }
  }

  let annualizationFactor = 1;
  if (timestamps.length >= 2) {
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    const tradingDays = (latest - earliest) / (1000 * 60 * 60 * 24);

    // Require at least 7 days of trading history for meaningful annualization
    if (tradingDays < 7) return null;

    // Annualize: scale the return to a full year (365 days for crypto)
    annualizationFactor = 365 / tradingDays;
  } else {
    // Cannot determine trading period without timestamps
    return null;
  }

  const annualizedReturnPct = totalReturnPct * annualizationFactor;

  // Calmar = Annualized Return % / Max Drawdown %
  const calmarRatio = annualizedReturnPct / maxDrawdownPct;

  // Clamp to reasonable range [-10, 10]
  return Math.max(-10, Math.min(10, calmarRatio));
}

export async function calculateStrategyPerformance(strategyId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;

  // Get all trades for this strategy
  const trades = await getStrategyTrades(strategyId, userId, 1000);
  const openPositions = await getStrategyOpenPositions(strategyId, userId);

  // 10B-6: Fetch actual wallet starting balance from DB instead of hardcoded $10,000
  let walletStartingBalance: number | undefined;
  try {
    const walletRows = await db.select({ balance: paperWallets.balance })
      .from(paperWallets)
      .where(and(eq(paperWallets.userId, userId), eq(paperWallets.tradingMode, 'paper')))
      .limit(1);
    if (walletRows.length > 0) {
      // The wallet balance reflects current state; to get starting balance,
      // we reverse-engineer it from current balance minus total realized P&L
      const currentBalance = parseFloat(walletRows[0].balance);
      // Calculate total realized P&L from trades to derive the original starting balance
      let totalPnlFromTrades = 0;
      for (const t of trades) {
        const pnl = parseFloat(t.pnl);
        if (!isNaN(pnl)) totalPnlFromTrades += pnl;
      }
      walletStartingBalance = currentBalance - totalPnlFromTrades;
      // Sanity check: starting balance should be positive and reasonable
      if (walletStartingBalance <= 0 || walletStartingBalance > 10_000_000) {
        walletStartingBalance = undefined; // Fall back to default
      }
    }
  } catch (err) {
    // Non-critical: fall back to default $10,000 if wallet query fails
    console.warn('[strategyDb] Failed to fetch wallet starting balance, using default', err);
  }

  // Fetch historical max open positions from DB
  let historicalMaxOpenPositions = 0;
  try {
    const perfRow = await db
      .select({ maxOpenPositions: strategyPerformance.maxOpenPositions })
      .from(strategyPerformance)
      .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)))
      .limit(1);
    if (perfRow.length > 0 && perfRow[0].maxOpenPositions > 0) {
      historicalMaxOpenPositions = perfRow[0].maxOpenPositions;
    }
  } catch {
    // Non-critical: fall back to 0 if query fails
  }

  if (trades.length === 0 && openPositions.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: "0.00",
      totalPnL: "0.00",
      realizedPnL: "0.00",
      unrealizedPnL: "0.00",
      avgWin: "0.00",
      avgLoss: "0.00",
      maxDrawdown: "0.00",
      sharpeRatio: null,
      sortinoRatio: null,
      calmarRatio: null,
      profitFactor: null,
      openPositions: 0,
      maxOpenPositions: historicalMaxOpenPositions,
      totalCommission: "0.00",
    };
  }

  // Calculate realized P&L from trades
  let totalRealizedPnL = 0;
  let totalCommission = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;

  for (const trade of trades) {
    const pnl = parseFloat(trade.pnl);
    const commission = parseFloat(trade.commission);

    totalRealizedPnL += pnl;
    totalCommission += commission;

    if (pnl > 0) {
      winningTrades++;
      totalWinAmount += pnl;
    } else if (pnl < 0) {
      losingTrades++;
      totalLossAmount += Math.abs(pnl);
    }
  }

  // Calculate unrealized P&L from open positions
  let totalUnrealizedPnL = 0;
  for (const position of openPositions) {
    totalUnrealizedPnL += parseFloat(position.unrealizedPnL);
  }

  // Calculate metrics
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : "0.00";
  const avgWin = winningTrades > 0 ? (totalWinAmount / winningTrades).toFixed(2) : "0.00";
  const avgLoss = losingTrades > 0 ? (totalLossAmount / losingTrades).toFixed(2) : "0.00";
  const profitFactor =
    totalLossAmount > 0 ? (totalWinAmount / totalLossAmount).toFixed(2) : totalWinAmount > 0 ? "999.99" : null;

  // Track historical max open positions: take the greater of DB peak vs current
  const currentMaxOpenPositions = Math.max(historicalMaxOpenPositions, openPositions.length);

  // Persist the updated peak back to DB if it increased
  if (currentMaxOpenPositions > historicalMaxOpenPositions) {
    try {
      const existingPerf = await db
        .select({ id: strategyPerformance.id })
        .from(strategyPerformance)
        .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)))
        .limit(1);
      if (existingPerf.length > 0) {
        await db
          .update(strategyPerformance)
          .set({ maxOpenPositions: currentMaxOpenPositions })
          .where(and(eq(strategyPerformance.strategyId, strategyId), eq(strategyPerformance.userId, userId)));
      }
    } catch {
      // Non-critical: peak will be updated on next calculation cycle
    }
  }

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    totalPnL: (totalRealizedPnL + totalUnrealizedPnL).toFixed(2),
    realizedPnL: totalRealizedPnL.toFixed(2),
    unrealizedPnL: totalUnrealizedPnL.toFixed(2),
    avgWin,
    avgLoss,
    maxDrawdown: calculateMaxDrawdown(trades, walletStartingBalance).toFixed(2),
    sharpeRatio: calculateSharpeRatio(trades, walletStartingBalance)?.toFixed(2) ?? null,
    sortinoRatio: calculateSortinoRatio(trades, walletStartingBalance)?.toFixed(2) ?? null,
    calmarRatio: calculateCalmarRatio(
      trades,
      calculateMaxDrawdown(trades, walletStartingBalance),
      walletStartingBalance
    )?.toFixed(2) ?? null,
    profitFactor,
    openPositions: openPositions.length,
    maxOpenPositions: currentMaxOpenPositions,
    totalCommission: totalCommission.toFixed(2),
  };
}

/**
 * Phase 13C: Persist strategy performance after every trade close.
 *
 * Unlike calculateStrategyPerformance() which requires a strategyId (most positions don't have one),
 * this function calculates metrics from ALL closed positions for a user and upserts to
 * strategyPerformance with strategyId=0 (the "global paper trading" strategy).
 *
 * Called non-blocking after every position close — DB failures don't affect trading.
 */
export async function persistUserStrategyPerformance(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Get ALL closed positions for this user (not filtered by strategyId)
    const closedPositions = await db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'closed')))
      .orderBy(desc(paperPositions.createdAt))
      .limit(2000);

    // Get open positions
    const openPos = await db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')));

    // Get wallet for starting balance
    let walletStartingBalance: number | undefined;
    try {
      const walletRows = await db.select({ balance: paperWallets.balance })
        .from(paperWallets)
        .where(and(eq(paperWallets.userId, userId), eq(paperWallets.tradingMode, 'paper')))
        .limit(1);
      if (walletRows.length > 0) {
        const currentBalance = parseFloat(walletRows[0].balance);
        let totalPnlFromPositions = 0;
        for (const p of closedPositions) {
          const pnl = parseFloat(String(p.realizedPnl || '0'));
          if (!isNaN(pnl)) totalPnlFromPositions += pnl;
        }
        const derivedStart = currentBalance - totalPnlFromPositions;
        if (derivedStart > 0 && derivedStart < 10_000_000) {
          walletStartingBalance = derivedStart;
        }
      }
    } catch { /* non-critical */ }

    // Calculate metrics
    let totalRealizedPnL = 0;
    let totalCommission = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;

    // Build trades array for drawdown/Sharpe/Sortino calculation
    const tradesForMetrics: Array<{ pnl: string; commission: string; timestamp: Date | null }> = [];

    for (const pos of closedPositions) {
      const pnl = parseFloat(String(pos.realizedPnl || '0'));
      if (isNaN(pnl)) continue;

      totalRealizedPnL += pnl;
      // Estimate commission from totalCosts or default to 0
      const commission = parseFloat(String((pos as any).totalCosts || '0'));
      if (!isNaN(commission)) totalCommission += commission;

      if (pnl > 0) { winningTrades++; totalWinAmount += pnl; }
      else if (pnl < 0) { losingTrades++; totalLossAmount += Math.abs(pnl); }

      tradesForMetrics.push({
        pnl: String(pnl),
        commission: String(commission),
        timestamp: pos.exitTime || pos.updatedAt || pos.createdAt,
      });
    }

    const totalTrades = closedPositions.length;
    const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : '0.00';
    const avgWin = winningTrades > 0 ? (totalWinAmount / winningTrades).toFixed(2) : '0.00';
    const avgLoss = losingTrades > 0 ? (totalLossAmount / losingTrades).toFixed(2) : '0.00';
    const profitFactor = totalLossAmount > 0
      ? (totalWinAmount / totalLossAmount).toFixed(2)
      : totalWinAmount > 0 ? '999.99' : null;

    // Calculate advanced metrics using existing helpers
    const maxDrawdown = calculateMaxDrawdown(tradesForMetrics, walletStartingBalance);
    const sharpeRatio = calculateSharpeRatio(tradesForMetrics, walletStartingBalance);
    const sortinoRatio = calculateSortinoRatio(tradesForMetrics, walletStartingBalance);
    const calmarRatio = calculateCalmarRatio(tradesForMetrics, maxDrawdown, walletStartingBalance);

    // Get historical max open positions
    let historicalMax = 0;
    try {
      const existing = await db.select({ maxOpenPositions: strategyPerformance.maxOpenPositions })
        .from(strategyPerformance)
        .where(and(eq(strategyPerformance.strategyId, 0), eq(strategyPerformance.userId, userId)))
        .limit(1);
      if (existing.length > 0) historicalMax = existing[0].maxOpenPositions;
    } catch { /* non-critical */ }

    const currentMaxOpen = Math.max(historicalMax, openPos.length);

    let totalUnrealizedPnL = 0;
    for (const p of openPos) {
      const unrealized = parseFloat(String(p.unrealizedPnL || '0'));
      if (!isNaN(unrealized)) totalUnrealizedPnL += unrealized;
    }

    const perfData = {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalPnL: (totalRealizedPnL + totalUnrealizedPnL).toFixed(2),
      realizedPnL: totalRealizedPnL.toFixed(2),
      unrealizedPnL: totalUnrealizedPnL.toFixed(2),
      avgWin,
      avgLoss,
      maxDrawdown: maxDrawdown.toFixed(2),
      sharpeRatio: sharpeRatio?.toFixed(2) ?? null,
      sortinoRatio: sortinoRatio?.toFixed(2) ?? null,
      calmarRatio: calmarRatio?.toFixed(2) ?? null,
      profitFactor,
      openPositions: openPos.length,
      maxOpenPositions: currentMaxOpen,
      totalCommission: totalCommission.toFixed(2),
    };

    // Upsert: update if exists, create if not
    const existingRow = await db
      .select({ id: strategyPerformance.id })
      .from(strategyPerformance)
      .where(and(eq(strategyPerformance.strategyId, 0), eq(strategyPerformance.userId, userId)))
      .limit(1);

    if (existingRow.length > 0) {
      await db.update(strategyPerformance)
        .set(perfData)
        .where(and(eq(strategyPerformance.strategyId, 0), eq(strategyPerformance.userId, userId)));
    } else {
      await db.insert(strategyPerformance).values({
        strategyId: 0,
        userId,
        ...perfData,
      });
    }
  } catch (err) {
    // Non-blocking — log but don't crash. Paper trading only.
    console.warn('[strategyDb] Failed to persist strategy performance:', (err as Error)?.message);
  }
}
