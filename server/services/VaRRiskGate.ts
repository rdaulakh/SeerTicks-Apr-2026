/**
 * Phase 17: VaR Risk Gate — Pre-Trade Portfolio Risk Validation
 *
 * Integrates the existing VaRCalculator into the trade execution pipeline.
 * Before any trade opens, this gate checks:
 *
 * 1. Current portfolio VaR(95%) < maxPortfolioVaR95 (8% of equity)
 * 2. Incremental VaR from new position < maxIncrementalVaR95 (2% of equity)
 * 3. Portfolio CVaR(95%) < maxPortfolioCVaR95 (12% of equity)
 *
 * Uses historical trade returns from DB + current open position data.
 * Falls back to parametric VaR if insufficient historical data.
 */

import { calculateAllVaR, calculateCVaR, calculateParametricVaR } from '../risk/VaRCalculator';
import { getTradingConfig } from '../config/TradingConfig';

export interface VaRGateResult {
  passed: boolean;
  reason: string;
  portfolioVaR95: number;
  portfolioVaR95Percent: number;
  incrementalVaR95: number;
  incrementalVaR95Percent: number;
  portfolioCVaR95: number;
  portfolioCVaR95Percent: number;
  dataPoints: number;
  method: 'historical' | 'parametric' | 'insufficient_data';
}

// In-memory cache of recent returns for VaR calculation
// Fed by trade completions in real-time
let recentReturns: number[] = [];
const MAX_RETURNS_CACHE = 500;

/**
 * Record a trade return for VaR calculation
 * Called when a position closes — feeds the return stream
 */
export function recordReturnForVaR(pnlPercent: number): void {
  recentReturns.push(pnlPercent / 100); // Convert from % to decimal
  if (recentReturns.length > MAX_RETURNS_CACHE) {
    recentReturns = recentReturns.slice(-MAX_RETURNS_CACHE);
  }
}

/**
 * Load historical returns from database (called at startup)
 */
export async function loadHistoricalReturns(): Promise<number> {
  try {
    const { getDb } = await import('../db');
    const db = await getDb();
    if (!db) return 0;

    const { trades, paperTrades } = await import('../../drizzle/schema');
    const { eq, isNotNull, and, ne } = await import('drizzle-orm');

    // Phase 22 fix: Try trades table first (StrategyOrchestrator path),
    // then fall back to paperTrades (PaperTradingEngine path — the active engine).
    // The main engine writes to paperTrades, not trades.
    const rows = await db
      .select({
        entryPrice: trades.entryPrice,
        exitPrice: trades.exitPrice,
        side: trades.side,
      })
      .from(trades)
      .where(
        and(
          eq(trades.status, 'closed'),
          isNotNull(trades.exitPrice),
          isNotNull(trades.entryPrice)
        )
      )
      .orderBy(trades.exitTime)
      .limit(500);

    for (const row of rows) {
      const entry = parseFloat(row.entryPrice || '0');
      const exit = parseFloat(row.exitPrice || '0');
      if (entry <= 0) continue;

      let returnPct = (exit - entry) / entry;
      if (row.side === 'short') returnPct = -returnPct;
      recentReturns.push(returnPct);
    }

    // If trades table had no data, try paperTrades (PaperTradingEngine writes here)
    if (recentReturns.length === 0) {
      const paperRows = await db
        .select({
          price: paperTrades.price,
          pnl: paperTrades.pnl,
          quantity: paperTrades.quantity,
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
        .orderBy(paperTrades.timestamp)
        .limit(500);

      for (const row of paperRows) {
        const price = parseFloat(row.price || '0');
        const pnl = parseFloat(row.pnl || '0');
        const qty = parseFloat(row.quantity || '0');
        if (price <= 0 || qty <= 0) continue;

        // Return = pnl / (price * quantity) — the position value at exit
        const positionValue = price * qty;
        const returnPct = pnl / positionValue;
        recentReturns.push(returnPct);
      }

      if (recentReturns.length > 0) {
        console.log(`[VaRRiskGate] Loaded ${recentReturns.length} returns from paperTrades (fallback)`);
      }
    }

    if (recentReturns.length > MAX_RETURNS_CACHE) {
      recentReturns = recentReturns.slice(-MAX_RETURNS_CACHE);
    }

    console.log(`[VaRRiskGate] Loaded ${recentReturns.length} historical returns for VaR calculation`);
    return recentReturns.length;
  } catch (err) {
    console.error('[VaRRiskGate] Failed to load historical returns:', (err as Error)?.message);
    return 0;
  }
}

/**
 * Pre-trade VaR validation gate
 *
 * @param proposedPositionSizeUSD The dollar size of the proposed trade
 * @param portfolioEquityUSD Current portfolio equity
 * @param currentOpenPositionSizes Array of open position sizes in USD
 * @returns VaRGateResult with pass/fail and metrics
 */
export function checkVaRGate(
  proposedPositionSizeUSD: number,
  portfolioEquityUSD: number,
  currentOpenPositionSizes: number[] = []
): VaRGateResult {
  const config = getTradingConfig().varLimits;

  if (!config.enabled || portfolioEquityUSD <= 0) {
    return {
      passed: true,
      reason: 'VaR gate disabled or zero equity',
      portfolioVaR95: 0,
      portfolioVaR95Percent: 0,
      incrementalVaR95: 0,
      incrementalVaR95Percent: 0,
      portfolioCVaR95: 0,
      portfolioCVaR95Percent: 0,
      dataPoints: 0,
      method: 'insufficient_data',
    };
  }

  const dataPoints = recentReturns.length;

  // If insufficient data, use parametric fallback with conservative assumptions
  if (dataPoints < config.minHistoricalDataPoints) {
    return checkVaRGateParametric(proposedPositionSizeUSD, portfolioEquityUSD, currentOpenPositionSizes);
  }

  // ── Calculate current portfolio VaR(95%) ──
  const currentTotalExposure = currentOpenPositionSizes.reduce((s, x) => s + Math.abs(x), 0);
  const exposureRatio = portfolioEquityUSD > 0 ? currentTotalExposure / portfolioEquityUSD : 0;

  // Scale returns by exposure ratio to get portfolio-level returns
  const portfolioReturns = recentReturns.map(r => r * exposureRatio);
  const varResult = calculateAllVaR(portfolioReturns, portfolioEquityUSD, config.varConfidenceLevel, config.varTimeHorizonDays);
  const portfolioVaR95 = varResult.averageVaR;
  const portfolioVaR95Percent = portfolioEquityUSD > 0 ? portfolioVaR95 / portfolioEquityUSD : 0;

  // ── Calculate CVaR(95%) ──
  const portfolioCVaR95 = calculateCVaR(portfolioReturns, config.varConfidenceLevel, portfolioEquityUSD);
  const portfolioCVaR95Percent = portfolioEquityUSD > 0 ? portfolioCVaR95 / portfolioEquityUSD : 0;

  // ── Calculate incremental VaR from proposed new position ──
  const newExposureRatio = portfolioEquityUSD > 0
    ? (currentTotalExposure + proposedPositionSizeUSD) / portfolioEquityUSD
    : 0;
  const newPortfolioReturns = recentReturns.map(r => r * newExposureRatio);
  const newVarResult = calculateAllVaR(newPortfolioReturns, portfolioEquityUSD, config.varConfidenceLevel, config.varTimeHorizonDays);
  const incrementalVaR95 = Math.max(0, newVarResult.averageVaR - portfolioVaR95);
  const incrementalVaR95Percent = portfolioEquityUSD > 0 ? incrementalVaR95 / portfolioEquityUSD : 0;

  // ── Check limits ──
  const reasons: string[] = [];

  if (portfolioVaR95Percent > config.maxPortfolioVaR95Percent) {
    reasons.push(`Portfolio VaR95 ${(portfolioVaR95Percent * 100).toFixed(1)}% > limit ${(config.maxPortfolioVaR95Percent * 100).toFixed(0)}%`);
  }

  if (incrementalVaR95Percent > config.maxIncrementalVaR95Percent) {
    reasons.push(`Incremental VaR95 ${(incrementalVaR95Percent * 100).toFixed(1)}% > limit ${(config.maxIncrementalVaR95Percent * 100).toFixed(0)}%`);
  }

  if (portfolioCVaR95Percent > config.maxPortfolioCVaR95Percent) {
    reasons.push(`Portfolio CVaR95 ${(portfolioCVaR95Percent * 100).toFixed(1)}% > limit ${(config.maxPortfolioCVaR95Percent * 100).toFixed(0)}%`);
  }

  const passed = reasons.length === 0;

  return {
    passed,
    reason: passed ? 'VaR within limits' : reasons.join('; '),
    portfolioVaR95,
    portfolioVaR95Percent,
    incrementalVaR95,
    incrementalVaR95Percent,
    portfolioCVaR95,
    portfolioCVaR95Percent,
    dataPoints,
    method: 'historical',
  };
}

/**
 * Parametric fallback when insufficient historical data
 * Uses conservative crypto assumptions: 3% daily vol, 0% mean return
 */
function checkVaRGateParametric(
  proposedPositionSizeUSD: number,
  portfolioEquityUSD: number,
  currentOpenPositionSizes: number[]
): VaRGateResult {
  const config = getTradingConfig().varLimits;

  // Conservative crypto assumptions
  const meanReturn = 0;
  const dailyVol = 0.03; // 3% daily volatility (conservative for BTC)

  const currentTotalExposure = currentOpenPositionSizes.reduce((s, x) => s + Math.abs(x), 0);
  const exposureRatio = portfolioEquityUSD > 0 ? currentTotalExposure / portfolioEquityUSD : 0;

  const portfolioVaR95 = calculateParametricVaR(
    meanReturn * exposureRatio,
    dailyVol * exposureRatio,
    config.varConfidenceLevel,
    portfolioEquityUSD,
    config.varTimeHorizonDays
  );
  const portfolioVaR95Percent = portfolioEquityUSD > 0 ? portfolioVaR95 / portfolioEquityUSD : 0;

  // Incremental VaR
  const newExposureRatio = portfolioEquityUSD > 0
    ? (currentTotalExposure + proposedPositionSizeUSD) / portfolioEquityUSD
    : 0;
  const newVaR95 = calculateParametricVaR(
    meanReturn * newExposureRatio,
    dailyVol * newExposureRatio,
    config.varConfidenceLevel,
    portfolioEquityUSD,
    config.varTimeHorizonDays
  );
  const incrementalVaR95 = Math.max(0, newVaR95 - portfolioVaR95);
  const incrementalVaR95Percent = portfolioEquityUSD > 0 ? incrementalVaR95 / portfolioEquityUSD : 0;

  // CVaR approximation: ~1.3× VaR for normal distribution at 95%
  const portfolioCVaR95 = portfolioVaR95 * 1.3;
  const portfolioCVaR95Percent = portfolioVaR95Percent * 1.3;

  const reasons: string[] = [];
  if (incrementalVaR95Percent > config.maxIncrementalVaR95Percent) {
    reasons.push(`Incremental VaR95 ${(incrementalVaR95Percent * 100).toFixed(1)}% > limit ${(config.maxIncrementalVaR95Percent * 100).toFixed(0)}% (parametric)`);
  }

  const passed = reasons.length === 0;

  return {
    passed,
    reason: passed ? 'VaR within limits (parametric)' : reasons.join('; '),
    portfolioVaR95,
    portfolioVaR95Percent,
    incrementalVaR95,
    incrementalVaR95Percent,
    portfolioCVaR95,
    portfolioCVaR95Percent,
    dataPoints: recentReturns.length,
    method: 'parametric',
  };
}

/**
 * Get current VaR status for monitoring/dashboard
 */
export function getVaRStatus(): {
  dataPoints: number;
  recentVolatility: number;
  recentMeanReturn: number;
} {
  if (recentReturns.length < 2) {
    return { dataPoints: 0, recentVolatility: 0, recentMeanReturn: 0 };
  }

  const mean = recentReturns.reduce((s, r) => s + r, 0) / recentReturns.length;
  const variance = recentReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (recentReturns.length - 1);

  return {
    dataPoints: recentReturns.length,
    recentVolatility: Math.sqrt(variance),
    recentMeanReturn: mean,
  };
}
