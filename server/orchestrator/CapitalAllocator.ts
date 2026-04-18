import { ExchangeConfig, SymbolConfig } from "./MultiExchangeManager";

/**
 * Performance metrics for a trading pair
 */
export interface PerformanceMetrics {
  symbol: string;
  exchangeId: number;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalPnL: number;
}

/**
 * Market data for market-cap weighted allocation
 */
export interface MarketData {
  symbol: string;
  marketCap: number;
  volume24h: number;
  price: number;
}

/**
 * Capital allocation result
 */
export interface AllocationResult {
  exchangeId: number;
  symbol: string;
  allocatedCapital: number;
  allocationPercentage: number;
}

/**
 * CapitalAllocator
 * Implements various capital allocation strategies
 */
export class CapitalAllocator {
  /**
   * Equal weight allocation
   * Distributes capital equally across all trading pairs
   */
  static allocateEqualWeight(
    totalCapital: number,
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[]
  ): AllocationResult[] {
    const activeExchanges = exchangeConfigs.filter(e => e.isActive);
    const activeSymbols = symbolConfigs.filter(s => s.isActive);

    if (activeExchanges.length === 0 || activeSymbols.length === 0) {
      return [];
    }

    const totalPairs = activeExchanges.length * activeSymbols.length;
    const capitalPerPair = totalCapital / totalPairs;
    const percentagePerPair = 100 / totalPairs;

    const results: AllocationResult[] = [];

    for (const exchange of activeExchanges) {
      for (const symbol of activeSymbols) {
        results.push({
          exchangeId: exchange.exchangeId,
          symbol: symbol.symbol,
          allocatedCapital: capitalPerPair,
          allocationPercentage: percentagePerPair,
        });
      }
    }

    return results;
  }

  /**
   * Market cap weighted allocation
   * Allocates more capital to higher market cap assets
   */
  static allocateMarketCapWeighted(
    totalCapital: number,
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[],
    marketData: MarketData[]
  ): AllocationResult[] {
    const activeExchanges = exchangeConfigs.filter(e => e.isActive);
    const activeSymbols = symbolConfigs.filter(s => s.isActive);

    if (activeExchanges.length === 0 || activeSymbols.length === 0) {
      return [];
    }

    // Calculate total market cap
    const totalMarketCap = marketData.reduce((sum, data) => {
      if (activeSymbols.some(s => s.symbol === data.symbol)) {
        return sum + data.marketCap;
      }
      return sum;
    }, 0);

    if (totalMarketCap === 0) {
      // Fallback to equal weight if no market data
      return this.allocateEqualWeight(totalCapital, exchangeConfigs, symbolConfigs);
    }

    const results: AllocationResult[] = [];

    for (const exchange of activeExchanges) {
      // Each exchange gets equal share
      const exchangeCapital = totalCapital / activeExchanges.length;

      for (const symbol of activeSymbols) {
        const marketInfo = marketData.find(d => d.symbol === symbol.symbol);
        if (!marketInfo) continue;

        // Allocate based on market cap weight
        const weight = marketInfo.marketCap / totalMarketCap;
        const allocatedCapital = exchangeCapital * weight;
        const percentage = (allocatedCapital / totalCapital) * 100;

        results.push({
          exchangeId: exchange.exchangeId,
          symbol: symbol.symbol,
          allocatedCapital,
          allocationPercentage: percentage,
        });
      }
    }

    return results;
  }

  /**
   * Performance weighted allocation
   * Allocates more capital to better performing trading pairs
   */
  static allocatePerformanceWeighted(
    totalCapital: number,
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[],
    performanceMetrics: PerformanceMetrics[]
  ): AllocationResult[] {
    const activeExchanges = exchangeConfigs.filter(e => e.isActive);
    const activeSymbols = symbolConfigs.filter(s => s.isActive);

    if (activeExchanges.length === 0 || activeSymbols.length === 0) {
      return [];
    }

    // Calculate performance scores (combination of win rate, Sharpe ratio, and total P&L)
    const scores = performanceMetrics.map(metric => {
      // Normalize metrics to 0-1 range
      const winRateScore = metric.winRate / 100;
      const sharpeScore = Math.max(0, Math.min(1, (metric.sharpeRatio + 2) / 4)); // Sharpe typically -2 to 2
      const pnlScore = metric.totalPnL > 0 ? 1 : 0;

      // Weighted combination
      const score = (
        winRateScore * 0.4 +
        sharpeScore * 0.4 +
        pnlScore * 0.2
      );

      return {
        exchangeId: metric.exchangeId,
        symbol: metric.symbol,
        score: Math.max(0.1, score), // Minimum 10% weight
      };
    });

    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

    if (totalScore === 0) {
      // Fallback to equal weight if no performance data
      return this.allocateEqualWeight(totalCapital, exchangeConfigs, symbolConfigs);
    }

    const results: AllocationResult[] = [];

    for (const scoreData of scores) {
      const weight = scoreData.score / totalScore;
      const allocatedCapital = totalCapital * weight;
      const percentage = weight * 100;

      results.push({
        exchangeId: scoreData.exchangeId,
        symbol: scoreData.symbol,
        allocatedCapital,
        allocationPercentage: percentage,
      });
    }

    return results;
  }

  /**
   * Risk-adjusted allocation
   * Allocates capital based on risk metrics (volatility, max drawdown)
   */
  static allocateRiskAdjusted(
    totalCapital: number,
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[],
    performanceMetrics: PerformanceMetrics[]
  ): AllocationResult[] {
    const activeExchanges = exchangeConfigs.filter(e => e.isActive);
    const activeSymbols = symbolConfigs.filter(s => s.isActive);

    if (activeExchanges.length === 0 || activeSymbols.length === 0) {
      return [];
    }

    // Calculate risk scores (inverse of risk - lower risk = higher score)
    const scores = performanceMetrics.map(metric => {
      // Normalize max drawdown (0-100% -> 1-0 score)
      const drawdownScore = 1 - (Math.abs(metric.maxDrawdown) / 100);

      // Sharpe ratio as risk-adjusted return
      const sharpeScore = Math.max(0, Math.min(1, (metric.sharpeRatio + 2) / 4));

      // Combined risk score
      const score = (drawdownScore * 0.6 + sharpeScore * 0.4);

      return {
        exchangeId: metric.exchangeId,
        symbol: metric.symbol,
        score: Math.max(0.1, score), // Minimum 10% weight
      };
    });

    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

    if (totalScore === 0) {
      return this.allocateEqualWeight(totalCapital, exchangeConfigs, symbolConfigs);
    }

    const results: AllocationResult[] = [];

    for (const scoreData of scores) {
      const weight = scoreData.score / totalScore;
      const allocatedCapital = totalCapital * weight;
      const percentage = weight * 100;

      results.push({
        exchangeId: scoreData.exchangeId,
        symbol: scoreData.symbol,
        allocatedCapital,
        allocationPercentage: percentage,
      });
    }

    return results;
  }

  /**
   * Custom allocation based on user-defined weights
   */
  static allocateCustom(
    totalCapital: number,
    customAllocations: AllocationResult[]
  ): AllocationResult[] {
    // Normalize percentages to sum to 100%
    const totalPercentage = customAllocations.reduce((sum, a) => sum + a.allocationPercentage, 0);

    if (totalPercentage === 0) {
      return [];
    }

    return customAllocations.map(allocation => ({
      ...allocation,
      allocationPercentage: (allocation.allocationPercentage / totalPercentage) * 100,
      allocatedCapital: totalCapital * (allocation.allocationPercentage / totalPercentage),
    }));
  }

  /**
   * Rebalance trigger check
   * Returns true if rebalancing is needed based on drift from target allocation
   */
  static shouldRebalance(
    currentAllocations: AllocationResult[],
    targetAllocations: AllocationResult[],
    driftThreshold: number = 5 // Percentage points
  ): boolean {
    for (const target of targetAllocations) {
      const current = currentAllocations.find(
        a => a.exchangeId === target.exchangeId && a.symbol === target.symbol
      );

      if (!current) continue;

      const drift = Math.abs(current.allocationPercentage - target.allocationPercentage);
      if (drift > driftThreshold) {
        return true;
      }
    }

    return false;
  }
}
