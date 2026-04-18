/**
 * Phase 17: Dynamic Correlation Tracker
 *
 * Replaces the static CORRELATION_GROUPS lookup in Week9RiskManager with
 * real-time rolling correlations computed from recent price returns.
 *
 * Why this matters:
 * - BTC/ETH correlation ranges from 0.5 to 0.95 depending on regime
 * - During crashes, ALL crypto correlations spike to ~1.0 (systemic risk)
 * - Static groups miss this: they treat BTC-ETH as always 0.7 correlated
 *
 * Method:
 * 1. Ingest price ticks for all trading symbols
 * 2. Resample to 5-minute return windows
 * 3. Compute rolling Pearson correlation over last 24h (288 windows)
 * 4. Expose correlation matrix for position sizing adjustments
 *
 * Integration:
 * - EnhancedTradeExecutor queries getCorrelationAdjustment(symbol) before sizing
 * - Returns a multiplier 0.5–1.0 to scale position size down for correlated exposure
 */

import { getTradingConfig } from '../config/TradingConfig';

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number;     // Pearson r (-1 to +1)
  dataPoints: number;      // Number of return windows used
  lastUpdated: number;     // Timestamp
}

export interface CorrelationAdjustment {
  symbol: string;
  correlatedPositions: Array<{ symbol: string; correlation: number; exposure: number }>;
  maxCorrelation: number;
  adjustedSizeMultiplier: number;   // 0.5 to 1.0
  reason: string;
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];        // NxN correlation matrix
  timestamp: number;
  windowMinutes: number;
  dataPoints: number;
}

// Rolling return window for correlation calculation
interface ReturnWindow {
  timestamp: number;
  returns: Map<string, number>;  // symbol → return for this window
}

class DynamicCorrelationTracker {
  // Price history per symbol: most recent prices for return calculation
  private priceHistory: Map<string, Array<{ price: number; timestamp: number }>> = new Map();

  // Computed 5-minute returns per symbol
  private returnSeries: Map<string, number[]> = new Map();

  // Correlation cache: "SYMBOL_A:SYMBOL_B" → correlation
  private correlationCache: Map<string, CorrelationPair> = new Map();

  // Open position sizes for correlation-adjusted sizing
  private openPositionExposure: Map<string, number> = new Map();

  // Configuration
  private readonly WINDOW_MINUTES = 5;           // Return calculation interval
  private readonly MAX_WINDOWS = 288;             // 24 hours of 5-min windows
  private readonly MIN_WINDOWS_FOR_CORR = 30;     // Need 2.5 hours minimum
  private readonly MAX_PRICE_HISTORY = 500;        // Per symbol
  private recalcInterval: ReturnType<typeof setInterval> | null = null;
  private lastResampleTime: number = 0;

  /**
   * Start periodic correlation recalculation
   */
  start(): void {
    // Phase 19: Guard against double-start (prevents leaked interval)
    if (this.recalcInterval) {
      console.log('[DynamicCorrelationTracker] Already running, skipping duplicate start');
      return;
    }
    // Recalculate correlations every 5 minutes
    this.recalcInterval = setInterval(() => {
      this.resampleAndRecalculate();
    }, this.WINDOW_MINUTES * 60 * 1000);

    console.log('[DynamicCorrelationTracker] Started — correlations updated every 5 minutes');
  }

  stop(): void {
    if (this.recalcInterval) {
      clearInterval(this.recalcInterval);
      this.recalcInterval = null;
    }
    console.log('[DynamicCorrelationTracker] Stopped');
  }

  /**
   * Ingest a price tick — called from PriceFabric or priceFeedService
   */
  recordPrice(symbol: string, price: number, timestampMs: number = Date.now()): void {
    try {
      if (!symbol || !isFinite(price) || price <= 0) return;
      if (!this.priceHistory.has(symbol)) {
        this.priceHistory.set(symbol, []);
      }
      const history = this.priceHistory.get(symbol)!;
      history.push({ price, timestamp: timestampMs });

      // Trim to limit
      if (history.length > this.MAX_PRICE_HISTORY) {
        this.priceHistory.set(symbol, history.slice(-this.MAX_PRICE_HISTORY));
      }
    } catch (error) {
      console.error('[DynamicCorrelationTracker] Error recording price:', (error as Error)?.message);
    }
  }

  /**
   * Register an open position's exposure for correlation adjustment
   */
  registerExposure(symbol: string, exposureUSD: number): void {
    this.openPositionExposure.set(symbol, exposureUSD);
  }

  /**
   * Remove a closed position's exposure
   */
  removeExposure(symbol: string): void {
    this.openPositionExposure.delete(symbol);
  }

  /**
   * Get position size adjustment multiplier based on correlation with open positions
   *
   * Returns 0.5–1.0:
   * - 1.0 = no correlated positions open, full size OK
   * - 0.7 = moderate correlation with existing positions
   * - 0.5 = very high correlation, reduce position to 50%
   * - 0.0 = correlation above block threshold, don't trade
   */
  getCorrelationAdjustment(symbol: string, proposedSizeUSD: number, portfolioEquityUSD: number): CorrelationAdjustment {
    try {
    const config = getTradingConfig().correlation;
    const correlatedPositions: Array<{ symbol: string; correlation: number; exposure: number }> = [];
    let maxCorrelation = 0;

    // Check correlation with each open position
    for (const [openSymbol, exposure] of this.openPositionExposure.entries()) {
      if (openSymbol === symbol) continue;

      const corr = this.getCorrelation(symbol, openSymbol);
      if (corr === null) continue;

      const absCorr = Math.abs(corr);
      if (absCorr >= config.correlationThreshold) {
        correlatedPositions.push({ symbol: openSymbol, correlation: corr, exposure });
        if (absCorr > maxCorrelation) maxCorrelation = absCorr;
      }
    }

    // No correlated positions → full size OK
    if (correlatedPositions.length === 0) {
      return {
        symbol,
        correlatedPositions: [],
        maxCorrelation: 0,
        adjustedSizeMultiplier: 1.0,
        reason: 'No correlated open positions',
      };
    }

    // Block if correlation above threshold
    if (maxCorrelation >= config.blockIfCorrelationAbove) {
      return {
        symbol,
        correlatedPositions,
        maxCorrelation,
        adjustedSizeMultiplier: 0,
        reason: `Blocked: max correlation ${maxCorrelation.toFixed(2)} >= ${config.blockIfCorrelationAbove}`,
      };
    }

    // Check total correlated exposure
    const totalCorrelatedExposure = correlatedPositions.reduce((sum, p) => sum + p.exposure, 0) + proposedSizeUSD;
    const correlatedExposurePercent = portfolioEquityUSD > 0
      ? totalCorrelatedExposure / portfolioEquityUSD : 0;

    if (correlatedExposurePercent > config.maxCorrelatedExposurePercent) {
      return {
        symbol,
        correlatedPositions,
        maxCorrelation,
        adjustedSizeMultiplier: 0,
        reason: `Correlated exposure ${(correlatedExposurePercent * 100).toFixed(1)}% > limit ${(config.maxCorrelatedExposurePercent * 100).toFixed(0)}%`,
      };
    }

    // Apply size reduction based on max correlation level
    let multiplier = 1.0;
    if (maxCorrelation >= 0.85) {
      multiplier = config.veryHighCorrelationSizeReduction;  // 0.50
    } else if (maxCorrelation >= config.correlationThreshold) {
      multiplier = config.highCorrelationSizeReduction;      // 0.70
    }

    return {
      symbol,
      correlatedPositions,
      maxCorrelation,
      adjustedSizeMultiplier: multiplier,
      reason: multiplier < 1.0
        ? `Corr ${maxCorrelation.toFixed(2)} with ${correlatedPositions.map(p => p.symbol).join(',')}: size ×${multiplier}`
        : 'Correlation within acceptable range',
    };
    } catch (error) {
      console.error('[DynamicCorrelationTracker] Error in correlation adjustment:', (error as Error)?.message);
      return {
        symbol,
        correlatedPositions: [],
        maxCorrelation: 0,
        adjustedSizeMultiplier: 1.0,
        reason: `Error: ${(error as Error)?.message}`,
      };
    }
  }

  /**
   * Get Pearson correlation between two symbols
   * Returns null if insufficient data
   */
  getCorrelation(symbolA: string, symbolB: string): number | null {
    const key = this.makeCacheKey(symbolA, symbolB);
    const cached = this.correlationCache.get(key);
    if (cached && Date.now() - cached.lastUpdated < 10 * 60 * 1000) {
      return cached.correlation;
    }

    // Compute from return series
    const returnsA = this.returnSeries.get(symbolA);
    const returnsB = this.returnSeries.get(symbolB);

    if (!returnsA || !returnsB) return null;

    // Align return series (take the shorter length from the end)
    const len = Math.min(returnsA.length, returnsB.length);
    if (len < this.MIN_WINDOWS_FOR_CORR) return null;

    const a = returnsA.slice(-len);
    const b = returnsB.slice(-len);

    const corr = this.pearsonCorrelation(a, b);

    // Cache the result
    this.correlationCache.set(key, {
      symbolA,
      symbolB,
      correlation: corr,
      dataPoints: len,
      lastUpdated: Date.now(),
    });

    return corr;
  }

  /**
   * Get the full correlation matrix for all tracked symbols
   */
  getCorrelationMatrix(): CorrelationMatrix {
    const symbols = [...this.returnSeries.keys()].sort();
    const n = symbols.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1.0; // Self-correlation
      for (let j = i + 1; j < n; j++) {
        const corr = this.getCorrelation(symbols[i], symbols[j]) ?? 0;
        matrix[i][j] = corr;
        matrix[j][i] = corr;
      }
    }

    const allLengths = [...this.returnSeries.values()].map(r => r.length);
    const minLen = allLengths.length > 0 ? Math.min(...allLengths) : 0;

    return {
      symbols,
      matrix,
      timestamp: Date.now(),
      windowMinutes: this.WINDOW_MINUTES,
      dataPoints: minLen,
    };
  }

  /**
   * Get status for dashboard
   */
  getStatus(): {
    trackedSymbols: string[];
    dataPointsPerSymbol: Record<string, number>;
    correlationPairs: CorrelationPair[];
    openExposure: Record<string, number>;
  } {
    const dataPointsPerSymbol: Record<string, number> = {};
    for (const [sym, returns] of this.returnSeries.entries()) {
      dataPointsPerSymbol[sym] = returns.length;
    }

    return {
      trackedSymbols: [...this.returnSeries.keys()],
      dataPointsPerSymbol,
      correlationPairs: [...this.correlationCache.values()],
      openExposure: Object.fromEntries(this.openPositionExposure),
    };
  }

  // ─── Internal ───

  /**
   * Resample price history to 5-minute returns and recalculate correlations
   */
  private resampleAndRecalculate(): void {
    try {
    const now = Date.now();

    for (const [symbol, prices] of this.priceHistory.entries()) {
      if (prices.length < 2) continue;

      // Resample to 5-min OHLC-like returns
      const returns: number[] = [];
      const windowMs = this.WINDOW_MINUTES * 60 * 1000;

      // Find price at each 5-minute boundary
      let windowStart = Math.floor(prices[0].timestamp / windowMs) * windowMs;
      let prevPrice = prices[0].price;

      for (const point of prices) {
        const windowBoundary = Math.floor(point.timestamp / windowMs) * windowMs;
        if (windowBoundary > windowStart) {
          // New window — compute return
          const ret = prevPrice > 0 ? (point.price - prevPrice) / prevPrice : 0;
          returns.push(ret);
          windowStart = windowBoundary;
          prevPrice = point.price;
        }
      }

      // Keep only last MAX_WINDOWS
      if (returns.length > this.MAX_WINDOWS) {
        this.returnSeries.set(symbol, returns.slice(-this.MAX_WINDOWS));
      } else {
        this.returnSeries.set(symbol, returns);
      }
    }

    // Clear stale correlation cache
    for (const [key, pair] of this.correlationCache.entries()) {
      if (now - pair.lastUpdated > 15 * 60 * 1000) {
        this.correlationCache.delete(key);
      }
    }

    // Recompute all correlations for open symbols
    const activeSymbols = new Set<string>([
      ...this.openPositionExposure.keys(),
      ...this.returnSeries.keys(),
    ]);

    const symbolArray = [...activeSymbols];
    for (let i = 0; i < symbolArray.length; i++) {
      for (let j = i + 1; j < symbolArray.length; j++) {
        this.getCorrelation(symbolArray[i], symbolArray[j]); // Populates cache
      }
    }

    this.lastResampleTime = now;
    } catch (error) {
      console.error('[DynamicCorrelationTracker] Error in resample/recalculate:', (error as Error)?.message);
    }
  }

  /**
   * Pearson correlation coefficient
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;

    const meanX = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const meanY = y.slice(0, n).reduce((s, v) => s + v, 0) / n;

    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      sumXY += dx * dy;
      sumXX += dx * dx;
      sumYY += dy * dy;
    }

    const denominator = Math.sqrt(sumXX * sumYY);
    if (denominator === 0) return 0;

    return sumXY / denominator;
  }

  private makeCacheKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }
}

// Singleton
let instance: DynamicCorrelationTracker | null = null;

export function getDynamicCorrelationTracker(): DynamicCorrelationTracker {
  if (!instance) {
    instance = new DynamicCorrelationTracker();
  }
  return instance;
}

export { DynamicCorrelationTracker };
