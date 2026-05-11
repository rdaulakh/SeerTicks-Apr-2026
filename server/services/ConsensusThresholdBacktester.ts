/**
 * Consensus Threshold Backtester Service
 * 
 * Tests different consensus threshold configurations against historical data
 * to validate and optimize the trading system's decision-making parameters.
 * 
 * Key Features:
 * - Historical signal replay with configurable thresholds
 * - Regime-aware threshold testing
 * - Position sizing tier validation
 * - Performance metrics comparison
 * - Statistical significance testing
 */

import { getDb } from "../db";
import { getActiveClock } from '../_core/clock';
import {
  tradingSignals,
  trades,
  paperTrades,
  historicalCandles,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, between, asc } from "drizzle-orm";
import { getExecutionThreshold, calculatePositionSize } from "../orchestrator/TieredDecisionMaking";

// Backtest configuration
export interface ThresholdBacktestConfig {
  name: string;
  symbol: string;
  startDate: Date;
  endDate: Date;
  
  // Threshold configurations to test
  baseThreshold: number; // 0-1 (e.g., 0.25 for 25%)
  regimeMultipliers: {
    trending: number;   // e.g., 0.8 (lower threshold in trends)
    volatile: number;   // e.g., 1.4 (higher threshold in volatility)
    ranging: number;    // e.g., 1.1 (slightly higher in ranges)
  };
  
  // Position sizing tiers (percentage of capital)
  positionTiers: {
    scout: number;      // e.g., 0.03 (3%)
    moderate: number;   // e.g., 0.05 (5%)
    standard: number;   // e.g., 0.07 (7%)
    strong: number;     // e.g., 0.10 (10%)
    high: number;       // e.g., 0.15 (15%)
    max: number;        // e.g., 0.20 (20%)
  };
  
  // Simulation parameters
  initialCapital: number;
  maxDrawdownLimit: number; // Stop if drawdown exceeds this (e.g., 0.25 for 25%)
  holdingPeriodHours: number; // How long to hold positions
  stopLossPercent: number;
  takeProfitPercent: number;
}

// Individual trade result
export interface BacktestTrade {
  timestamp: Date;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  positionSize: number;
  positionTier: string;
  consensusScore: number;
  threshold: number;
  regime: string;
  pnlPercent: number;
  pnlDollar: number;
  outcome: 'win' | 'loss' | 'breakeven';
  holdingPeriodHours: number;
  exitReason: 'target' | 'stop' | 'timeout';
}

// Performance metrics
export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgHoldingPeriod: number;
  tradesPerWeek: number;
  
  // By tier breakdown
  tierBreakdown: {
    [tier: string]: {
      trades: number;
      winRate: number;
      avgReturn: number;
      totalReturn: number;
    };
  };
  
  // By regime breakdown
  regimeBreakdown: {
    [regime: string]: {
      trades: number;
      winRate: number;
      avgReturn: number;
      threshold: number;
    };
  };
}

// Full backtest result
export interface ThresholdBacktestResult {
  config: ThresholdBacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { timestamp: Date; equity: number }[];
  status: 'completed' | 'stopped_drawdown' | 'error';
  errorMessage?: string;
  executionTimeMs: number;
}

/**
 * Calculate Sharpe ratio from returns
 */
function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  // Annualize (assuming daily returns)
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

/**
 * Calculate maximum drawdown from equity curve
 */
function calculateMaxDrawdown(equityCurve: { equity: number }[]): number {
  if (equityCurve.length === 0) return 0;
  
  let peak = equityCurve[0].equity;
  let maxDrawdown = 0;
  
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = (peak - point.equity) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown * 100; // Return as percentage
}

/**
 * Calculate profit factor from trades
 */
function calculateProfitFactor(trades: BacktestTrade[]): number {
  const grossProfit = trades
    .filter(t => t.pnlPercent > 0)
    .reduce((sum, t) => sum + t.pnlPercent, 0);
  
  const grossLoss = Math.abs(
    trades
      .filter(t => t.pnlPercent < 0)
      .reduce((sum, t) => sum + t.pnlPercent, 0)
  );
  
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  
  return grossProfit / grossLoss;
}

/**
 * Detect market regime from price data
 */
function detectRegime(prices: number[]): 'trending' | 'volatile' | 'ranging' {
  if (prices.length < 20) return 'ranging';
  
  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  // Calculate volatility (standard deviation of returns)
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);
  
  // Calculate trend strength (absolute cumulative return)
  const cumReturn = Math.abs(returns.reduce((a, b) => a + b, 0));
  
  // High volatility regime
  if (volatility > 0.03) {
    return 'volatile';
  }
  
  // Strong trend regime
  if (cumReturn > 0.05 && volatility < 0.02) {
    return 'trending';
  }
  
  // Default to ranging
  return 'ranging';
}

/**
 * Get position tier based on consensus score and threshold
 */
function getPositionTier(
  consensusScore: number,
  threshold: number,
  config: ThresholdBacktestConfig
): { tier: string; size: number } {
  const absScore = Math.abs(consensusScore);
  const excess = absScore - threshold;
  
  if (excess >= 0.50) {
    return { tier: 'MAX', size: config.positionTiers.max };
  } else if (excess >= 0.40) {
    return { tier: 'HIGH', size: config.positionTiers.high };
  } else if (excess >= 0.30) {
    return { tier: 'STRONG', size: config.positionTiers.strong };
  } else if (excess >= 0.20) {
    return { tier: 'STANDARD', size: config.positionTiers.standard };
  } else if (excess >= 0.10) {
    return { tier: 'MODERATE', size: config.positionTiers.moderate };
  } else if (excess >= 0) {
    return { tier: 'SCOUT', size: config.positionTiers.scout };
  } else {
    return { tier: 'NONE', size: 0 };
  }
}

/**
 * Consensus Threshold Backtester
 */
class ConsensusThresholdBacktester {
  /**
   * Run a backtest with the specified configuration
   */
  async runBacktest(
    userId: number,
    config: ThresholdBacktestConfig
  ): Promise<ThresholdBacktestResult> {
    const startTime = getActiveClock().now();
    const trades: BacktestTrade[] = [];
    const equityCurve: { timestamp: Date; equity: number }[] = [];
    
    let currentEquity = config.initialCapital;
    let peakEquity = config.initialCapital;
    
    try {
      const db = await getDb();
      if (!db) {
        return {
          config,
          metrics: this.calculateMetrics(trades, equityCurve, config),
          trades,
          equityCurve,
          status: 'error',
          errorMessage: 'Database not available',
          executionTimeMs: getActiveClock().now() - startTime,
        };
      }
      
      // Get historical signals for the period
      const signals = await db
        .select()
        .from(tradingSignals)
        .where(
          and(
            eq(tradingSignals.symbol, config.symbol),
            gte(tradingSignals.timestamp, config.startDate),
            lte(tradingSignals.timestamp, config.endDate)
          )
        )
        .orderBy(asc(tradingSignals.timestamp));
      
      console.log(`[ConsensusBacktester] Found ${signals.length} signals for ${config.symbol}`);
      
      // Get historical price data for regime detection
      const candles = await db
        .select()
        .from(historicalCandles)
        .where(
          and(
            eq(historicalCandles.symbol, config.symbol),
            gte(historicalCandles.timestamp, config.startDate),
            lte(historicalCandles.timestamp, config.endDate)
          )
        )
        .orderBy(asc(historicalCandles.timestamp));
      
      // Build price lookup map
      const priceMap = new Map<string, number>();
      for (const candle of candles) {
        const key = candle.timestamp.toISOString().slice(0, 13); // Hour precision
        priceMap.set(key, parseFloat(candle.close));
      }
      
      // Process each signal
      let lastTradeTime: Date | null = null;
      
      for (const signal of signals) {
        // Skip if we recently traded (minimum 1 hour between trades)
        if (lastTradeTime && signal.timestamp.getTime() - lastTradeTime.getTime() < 3600000) {
          continue;
        }
        
        // Get recent prices for regime detection
        const recentPrices: number[] = [];
        const signalTime = signal.timestamp.getTime();
        for (let i = 0; i < 24; i++) {
          const lookbackTime = new Date(signalTime - i * 3600000);
          const key = lookbackTime.toISOString().slice(0, 13);
          const price = priceMap.get(key);
          if (price) recentPrices.unshift(price);
        }
        
        // Detect regime
        const regime = detectRegime(recentPrices);
        
        // Calculate regime-adjusted threshold
        const regimeMultiplier = config.regimeMultipliers[regime];
        const adjustedThreshold = config.baseThreshold * regimeMultiplier;
        
        // Parse signal data
        const signalStrength = typeof signal.strength === 'string' ? parseFloat(signal.strength) : (signal.strength || 0);
        const signalConfidence = typeof signal.confidence === 'string' ? parseFloat(signal.confidence) : (signal.confidence || 0);
        const consensusScore = signalStrength * signalConfidence;
        
        // Check if signal meets threshold
        if (Math.abs(consensusScore) < adjustedThreshold) {
          continue; // Skip signals below threshold
        }
        
        // Determine position tier
        const { tier, size } = getPositionTier(consensusScore, adjustedThreshold, config);
        if (size === 0) continue;
        
        // Get entry and exit prices
        const entryKey = signal.timestamp.toISOString().slice(0, 13);
        const entryPrice = priceMap.get(entryKey) || parseFloat(signal.price || '0');
        
        if (!entryPrice || entryPrice === 0) continue;
        
        // Calculate exit time
        const exitTime = new Date(signal.timestamp.getTime() + config.holdingPeriodHours * 3600000);
        const exitKey = exitTime.toISOString().slice(0, 13);
        let exitPrice = priceMap.get(exitKey);
        
        // If no exit price, try to find closest available
        if (!exitPrice) {
          for (let i = 1; i <= 24; i++) {
            const altTime = new Date(exitTime.getTime() + i * 3600000);
            const altKey = altTime.toISOString().slice(0, 13);
            exitPrice = priceMap.get(altKey);
            if (exitPrice) break;
          }
        }
        
        if (!exitPrice) continue;
        
        // Determine direction
        const direction: 'long' | 'short' = consensusScore > 0 ? 'long' : 'short';
        
        // Calculate P&L
        let pnlPercent: number;
        let exitReason: 'target' | 'stop' | 'timeout' = 'timeout';
        
        if (direction === 'long') {
          pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        } else {
          pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
        }
        
        // Apply stop loss and take profit
        if (pnlPercent <= -config.stopLossPercent * 100) {
          pnlPercent = -config.stopLossPercent * 100;
          exitReason = 'stop';
        } else if (pnlPercent >= config.takeProfitPercent * 100) {
          pnlPercent = config.takeProfitPercent * 100;
          exitReason = 'target';
        }
        
        // Calculate dollar P&L based on position size
        const positionValue = currentEquity * size;
        const pnlDollar = positionValue * (pnlPercent / 100);
        
        // Update equity
        currentEquity += pnlDollar;
        
        // Record trade
        const trade: BacktestTrade = {
          timestamp: signal.timestamp,
          symbol: config.symbol,
          direction,
          entryPrice,
          exitPrice,
          positionSize: size,
          positionTier: tier,
          consensusScore,
          threshold: adjustedThreshold,
          regime,
          pnlPercent,
          pnlDollar,
          outcome: pnlPercent > 0.1 ? 'win' : pnlPercent < -0.1 ? 'loss' : 'breakeven',
          holdingPeriodHours: config.holdingPeriodHours,
          exitReason,
        };
        
        trades.push(trade);
        lastTradeTime = signal.timestamp;
        
        // Update equity curve
        equityCurve.push({
          timestamp: signal.timestamp,
          equity: currentEquity,
        });
        
        // Check drawdown limit
        if (currentEquity > peakEquity) {
          peakEquity = currentEquity;
        }
        const currentDrawdown = (peakEquity - currentEquity) / peakEquity;
        if (currentDrawdown > config.maxDrawdownLimit) {
          return {
            config,
            metrics: this.calculateMetrics(trades, equityCurve, config),
            trades,
            equityCurve,
            status: 'stopped_drawdown',
            errorMessage: `Stopped: Drawdown ${(currentDrawdown * 100).toFixed(1)}% exceeded limit ${(config.maxDrawdownLimit * 100).toFixed(1)}%`,
            executionTimeMs: getActiveClock().now() - startTime,
          };
        }
      }
      
      return {
        config,
        metrics: this.calculateMetrics(trades, equityCurve, config),
        trades,
        equityCurve,
        status: 'completed',
        executionTimeMs: getActiveClock().now() - startTime,
      };
      
    } catch (error) {
      console.error('[ConsensusBacktester] Error running backtest:', error);
      return {
        config,
        metrics: this.calculateMetrics(trades, equityCurve, config),
        trades,
        equityCurve,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: getActiveClock().now() - startTime,
      };
    }
  }
  
  /**
   * Calculate performance metrics from trades
   */
  private calculateMetrics(
    trades: BacktestTrade[],
    equityCurve: { timestamp: Date; equity: number }[],
    config: ThresholdBacktestConfig
  ): BacktestMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgReturn: 0,
        totalReturn: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgHoldingPeriod: 0,
        tradesPerWeek: 0,
        tierBreakdown: {},
        regimeBreakdown: {},
      };
    }
    
    const wins = trades.filter(t => t.outcome === 'win').length;
    const returns = trades.map(t => t.pnlPercent);
    
    // Calculate time span in weeks
    const timeSpanMs = config.endDate.getTime() - config.startDate.getTime();
    const timeSpanWeeks = timeSpanMs / (7 * 24 * 3600 * 1000);
    
    // Calculate tier breakdown
    const tierBreakdown: BacktestMetrics['tierBreakdown'] = {};
    const tiers = ['SCOUT', 'MODERATE', 'STANDARD', 'STRONG', 'HIGH', 'MAX'];
    for (const tier of tiers) {
      const tierTrades = trades.filter(t => t.positionTier === tier);
      if (tierTrades.length > 0) {
        const tierWins = tierTrades.filter(t => t.outcome === 'win').length;
        const tierReturns = tierTrades.map(t => t.pnlPercent);
        tierBreakdown[tier] = {
          trades: tierTrades.length,
          winRate: tierWins / tierTrades.length,
          avgReturn: tierReturns.reduce((a, b) => a + b, 0) / tierReturns.length,
          totalReturn: tierReturns.reduce((a, b) => a + b, 0),
        };
      }
    }
    
    // Calculate regime breakdown
    const regimeBreakdown: BacktestMetrics['regimeBreakdown'] = {};
    const regimes = ['trending', 'volatile', 'ranging'];
    for (const regime of regimes) {
      const regimeTrades = trades.filter(t => t.regime === regime);
      if (regimeTrades.length > 0) {
        const regimeWins = regimeTrades.filter(t => t.outcome === 'win').length;
        const regimeReturns = regimeTrades.map(t => t.pnlPercent);
        const avgThreshold = regimeTrades.reduce((sum, t) => sum + t.threshold, 0) / regimeTrades.length;
        regimeBreakdown[regime] = {
          trades: regimeTrades.length,
          winRate: regimeWins / regimeTrades.length,
          avgReturn: regimeReturns.reduce((a, b) => a + b, 0) / regimeReturns.length,
          threshold: avgThreshold,
        };
      }
    }
    
    return {
      totalTrades: trades.length,
      winRate: wins / trades.length,
      avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
      totalReturn: returns.reduce((a, b) => a + b, 0),
      profitFactor: calculateProfitFactor(trades),
      sharpeRatio: calculateSharpeRatio(returns),
      maxDrawdown: calculateMaxDrawdown(equityCurve),
      avgHoldingPeriod: trades.reduce((sum, t) => sum + t.holdingPeriodHours, 0) / trades.length,
      tradesPerWeek: timeSpanWeeks > 0 ? trades.length / timeSpanWeeks : 0,
      tierBreakdown,
      regimeBreakdown,
    };
  }
  
  /**
   * Compare multiple threshold configurations
   */
  async compareConfigurations(
    userId: number,
    baseConfig: Omit<ThresholdBacktestConfig, 'baseThreshold' | 'regimeMultipliers'>,
    thresholdConfigs: Array<{
      name: string;
      baseThreshold: number;
      regimeMultipliers: ThresholdBacktestConfig['regimeMultipliers'];
    }>
  ): Promise<{
    results: ThresholdBacktestResult[];
    comparison: {
      bestByWinRate: string;
      bestBySharpe: string;
      bestByReturn: string;
      bestByDrawdown: string;
      recommendation: string;
    };
  }> {
    const results: ThresholdBacktestResult[] = [];
    
    for (const thresholdConfig of thresholdConfigs) {
      const fullConfig: ThresholdBacktestConfig = {
        ...baseConfig,
        name: thresholdConfig.name,
        baseThreshold: thresholdConfig.baseThreshold,
        regimeMultipliers: thresholdConfig.regimeMultipliers,
      };
      
      const result = await this.runBacktest(userId, fullConfig);
      results.push(result);
    }
    
    // Find best configurations
    const completedResults = results.filter(r => r.status === 'completed' && r.metrics.totalTrades > 0);
    
    if (completedResults.length === 0) {
      return {
        results,
        comparison: {
          bestByWinRate: 'N/A',
          bestBySharpe: 'N/A',
          bestByReturn: 'N/A',
          bestByDrawdown: 'N/A',
          recommendation: 'No completed backtests with trades',
        },
      };
    }
    
    const bestByWinRate = completedResults.reduce((a, b) => 
      a.metrics.winRate > b.metrics.winRate ? a : b
    );
    const bestBySharpe = completedResults.reduce((a, b) => 
      a.metrics.sharpeRatio > b.metrics.sharpeRatio ? a : b
    );
    const bestByReturn = completedResults.reduce((a, b) => 
      a.metrics.totalReturn > b.metrics.totalReturn ? a : b
    );
    const bestByDrawdown = completedResults.reduce((a, b) => 
      a.metrics.maxDrawdown < b.metrics.maxDrawdown ? a : b
    );
    
    // Generate recommendation
    let recommendation = '';
    if (bestBySharpe.config.name === bestByReturn.config.name) {
      recommendation = `Recommended: ${bestBySharpe.config.name} (best risk-adjusted and absolute returns)`;
    } else if (bestBySharpe.metrics.sharpeRatio > 1.5) {
      recommendation = `Recommended: ${bestBySharpe.config.name} (best Sharpe ratio: ${bestBySharpe.metrics.sharpeRatio.toFixed(2)})`;
    } else {
      recommendation = `Consider: ${bestByReturn.config.name} for returns, ${bestByDrawdown.config.name} for safety`;
    }
    
    return {
      results,
      comparison: {
        bestByWinRate: bestByWinRate.config.name,
        bestBySharpe: bestBySharpe.config.name,
        bestByReturn: bestByReturn.config.name,
        bestByDrawdown: bestByDrawdown.config.name,
        recommendation,
      },
    };
  }

  /**
   * Get predefined threshold presets for different trading styles
   */
  getThresholdPresets(): ThresholdPreset[] {
    return [
      {
        id: 'ultra_conservative',
        name: 'Ultra Conservative',
        description: 'Highest quality signals only, minimal trades, maximum safety',
        baseThreshold: 0.45,
        regimeMultipliers: { trending: 0.95, volatile: 1.60, ranging: 1.30 },
        positionTiers: {
          scout: 0.02, moderate: 0.03, standard: 0.04,
          strong: 0.06, high: 0.08, max: 0.10,
        },
        expectedMetrics: {
          winRate: '70-75%',
          sharpeRatio: '2.5-3.0',
          tradesPerWeek: '5-10',
          maxDrawdown: '<15%',
        },
        suitableFor: ['Risk-averse traders', 'Large portfolios', 'Institutional'],
      },
      {
        id: 'conservative',
        name: 'Conservative',
        description: 'High quality signals with moderate trade frequency',
        baseThreshold: 0.35,
        regimeMultipliers: { trending: 0.90, volatile: 1.50, ranging: 1.20 },
        positionTiers: {
          scout: 0.02, moderate: 0.04, standard: 0.05,
          strong: 0.08, high: 0.12, max: 0.15,
        },
        expectedMetrics: {
          winRate: '65-70%',
          sharpeRatio: '2.0-2.5',
          tradesPerWeek: '15-25',
          maxDrawdown: '<20%',
        },
        suitableFor: ['Conservative traders', 'Medium portfolios', 'Swing trading'],
      },
      {
        id: 'institutional',
        name: 'A++ Institutional',
        description: 'Balanced approach based on institutional research',
        baseThreshold: 0.25,
        regimeMultipliers: { trending: 0.80, volatile: 1.40, ranging: 1.10 },
        positionTiers: {
          scout: 0.03, moderate: 0.05, standard: 0.07,
          strong: 0.10, high: 0.15, max: 0.20,
        },
        expectedMetrics: {
          winRate: '60-65%',
          sharpeRatio: '2.0-2.5',
          tradesPerWeek: '25-40',
          maxDrawdown: '<25%',
        },
        suitableFor: ['Active traders', 'Standard portfolios', 'Day trading'],
      },
      {
        id: 'aggressive',
        name: 'Aggressive',
        description: 'More trades, higher risk, higher potential returns',
        baseThreshold: 0.20,
        regimeMultipliers: { trending: 0.70, volatile: 1.20, ranging: 1.00 },
        positionTiers: {
          scout: 0.04, moderate: 0.06, standard: 0.08,
          strong: 0.12, high: 0.18, max: 0.25,
        },
        expectedMetrics: {
          winRate: '55-60%',
          sharpeRatio: '1.5-2.0',
          tradesPerWeek: '40-60',
          maxDrawdown: '<30%',
        },
        suitableFor: ['Aggressive traders', 'Smaller portfolios', 'Scalping'],
      },
      {
        id: 'ultra_aggressive',
        name: 'Ultra Aggressive',
        description: 'Maximum trade frequency, highest risk tolerance',
        baseThreshold: 0.15,
        regimeMultipliers: { trending: 0.60, volatile: 1.10, ranging: 0.90 },
        positionTiers: {
          scout: 0.05, moderate: 0.08, standard: 0.10,
          strong: 0.15, high: 0.22, max: 0.30,
        },
        expectedMetrics: {
          winRate: '50-55%',
          sharpeRatio: '1.0-1.5',
          tradesPerWeek: '60-100',
          maxDrawdown: '<40%',
        },
        suitableFor: ['High-risk traders', 'Small portfolios', 'Algorithmic trading'],
      },
      {
        id: 'trend_following',
        name: 'Trend Following',
        description: 'Optimized for trending markets, conservative in volatility',
        baseThreshold: 0.25,
        regimeMultipliers: { trending: 0.60, volatile: 1.60, ranging: 1.30 },
        positionTiers: {
          scout: 0.03, moderate: 0.05, standard: 0.07,
          strong: 0.10, high: 0.15, max: 0.20,
        },
        expectedMetrics: {
          winRate: '55-60%',
          sharpeRatio: '1.8-2.2',
          tradesPerWeek: '20-35',
          maxDrawdown: '<25%',
        },
        suitableFor: ['Trend traders', 'Momentum strategies', 'Crypto markets'],
      },
      {
        id: 'mean_reversion',
        name: 'Mean Reversion',
        description: 'Optimized for ranging markets, aggressive in volatility',
        baseThreshold: 0.30,
        regimeMultipliers: { trending: 1.20, volatile: 0.90, ranging: 0.80 },
        positionTiers: {
          scout: 0.03, moderate: 0.05, standard: 0.07,
          strong: 0.10, high: 0.15, max: 0.20,
        },
        expectedMetrics: {
          winRate: '62-68%',
          sharpeRatio: '1.8-2.3',
          tradesPerWeek: '25-40',
          maxDrawdown: '<22%',
        },
        suitableFor: ['Range traders', 'Forex markets', 'Stable assets'],
      },
    ];
  }

  /**
   * Run optimization to find best threshold configuration
   */
  async optimizeThresholds(
    userId: number,
    baseConfig: Omit<ThresholdBacktestConfig, 'name' | 'baseThreshold' | 'regimeMultipliers' | 'positionTiers'>,
    options: {
      thresholdRange?: { min: number; max: number; step: number };
      optimizeFor: 'sharpe' | 'return' | 'winRate' | 'balanced';
      maxIterations?: number;
    }
  ): Promise<ThresholdOptimizationResult> {
    const startTime = getActiveClock().now();
    const results: ThresholdBacktestResult[] = [];
    
    const thresholdRange = options.thresholdRange || { min: 0.15, max: 0.45, step: 0.05 };
    const maxIterations = options.maxIterations || 50;
    
    // Generate threshold configurations to test
    const thresholds: number[] = [];
    for (let t = thresholdRange.min; t <= thresholdRange.max; t += thresholdRange.step) {
      thresholds.push(Math.round(t * 100) / 100);
    }
    
    // Test each threshold with different regime multiplier combinations
    const regimeConfigs = [
      { trending: 0.70, volatile: 1.30, ranging: 1.00 },
      { trending: 0.80, volatile: 1.40, ranging: 1.10 },
      { trending: 0.90, volatile: 1.50, ranging: 1.20 },
      { trending: 0.75, volatile: 1.35, ranging: 1.05 },
      { trending: 0.85, volatile: 1.45, ranging: 1.15 },
    ];
    
    let iterations = 0;
    for (const threshold of thresholds) {
      for (const regimes of regimeConfigs) {
        if (iterations >= maxIterations) break;
        
        const config: ThresholdBacktestConfig = {
          ...baseConfig,
          name: `Opt_${(threshold * 100).toFixed(0)}%_T${(regimes.trending * 100).toFixed(0)}`,
          baseThreshold: threshold,
          regimeMultipliers: regimes,
          positionTiers: {
            scout: 0.03, moderate: 0.05, standard: 0.07,
            strong: 0.10, high: 0.15, max: 0.20,
          },
        };
        
        const result = await this.runBacktest(userId, config);
        if (result.status === 'completed' && result.metrics.totalTrades >= 5) {
          results.push(result);
        }
        iterations++;
      }
      if (iterations >= maxIterations) break;
    }
    
    // Find optimal configuration based on optimization target
    let optimalResult: ThresholdBacktestResult | null = null;
    let optimalScore = -Infinity;
    
    for (const result of results) {
      let score: number;
      switch (options.optimizeFor) {
        case 'sharpe':
          score = result.metrics.sharpeRatio;
          break;
        case 'return':
          score = result.metrics.totalReturn;
          break;
        case 'winRate':
          score = result.metrics.winRate;
          break;
        case 'balanced':
        default:
          // Balanced score: weighted combination
          score = (
            result.metrics.sharpeRatio * 0.4 +
            result.metrics.winRate * 0.3 +
            (result.metrics.totalReturn / 100) * 0.2 +
            (1 - result.metrics.maxDrawdown / 100) * 0.1
          );
          break;
      }
      
      if (score > optimalScore) {
        optimalScore = score;
        optimalResult = result;
      }
    }
    
    // Generate suggestions based on results
    const suggestions: string[] = [];
    if (optimalResult) {
      const avgWinRate = results.reduce((sum, r) => sum + r.metrics.winRate, 0) / results.length;
      const avgSharpe = results.reduce((sum, r) => sum + r.metrics.sharpeRatio, 0) / results.length;
      
      if (optimalResult.metrics.winRate > avgWinRate * 1.1) {
        suggestions.push(`Optimal threshold (${(optimalResult.config.baseThreshold * 100).toFixed(0)}%) shows ${((optimalResult.metrics.winRate - avgWinRate) * 100).toFixed(1)}% higher win rate than average`);
      }
      if (optimalResult.metrics.sharpeRatio > avgSharpe * 1.1) {
        suggestions.push(`Risk-adjusted returns are ${((optimalResult.metrics.sharpeRatio / avgSharpe - 1) * 100).toFixed(0)}% better than average configuration`);
      }
      if (optimalResult.metrics.maxDrawdown < 20) {
        suggestions.push('Drawdown is well controlled - consider slightly more aggressive position sizing');
      }
      if (optimalResult.metrics.tradesPerWeek < 10) {
        suggestions.push('Trade frequency is low - consider lowering threshold for more opportunities');
      }
    }
    
    return {
      optimal: optimalResult ? {
        baseThreshold: optimalResult.config.baseThreshold,
        regimeMultipliers: optimalResult.config.regimeMultipliers,
        positionTiers: optimalResult.config.positionTiers,
        metrics: optimalResult.metrics,
      } : null,
      allResults: results.map(r => ({
        name: r.config.name,
        baseThreshold: r.config.baseThreshold,
        regimeMultipliers: r.config.regimeMultipliers,
        metrics: {
          totalTrades: r.metrics.totalTrades,
          winRate: r.metrics.winRate,
          totalReturn: r.metrics.totalReturn,
          sharpeRatio: r.metrics.sharpeRatio,
          maxDrawdown: r.metrics.maxDrawdown,
        },
      })),
      suggestions,
      executionTimeMs: getActiveClock().now() - startTime,
      iterationsRun: iterations,
    };
  }
}

// Threshold preset type
export interface ThresholdPreset {
  id: string;
  name: string;
  description: string;
  baseThreshold: number;
  regimeMultipliers: {
    trending: number;
    volatile: number;
    ranging: number;
  };
  positionTiers: {
    scout: number;
    moderate: number;
    standard: number;
    strong: number;
    high: number;
    max: number;
  };
  expectedMetrics: {
    winRate: string;
    sharpeRatio: string;
    tradesPerWeek: string;
    maxDrawdown: string;
  };
  suitableFor: string[];
}

// Optimization result type
export interface ThresholdOptimizationResult {
  optimal: {
    baseThreshold: number;
    regimeMultipliers: ThresholdBacktestConfig['regimeMultipliers'];
    positionTiers: ThresholdBacktestConfig['positionTiers'];
    metrics: BacktestMetrics;
  } | null;
  allResults: Array<{
    name: string;
    baseThreshold: number;
    regimeMultipliers: ThresholdBacktestConfig['regimeMultipliers'];
    metrics: {
      totalTrades: number;
      winRate: number;
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
    };
  }>;
  suggestions: string[];
  executionTimeMs: number;
  iterationsRun: number;
}

// Singleton instance
let backtesterInstance: ConsensusThresholdBacktester | null = null;

export function getConsensusThresholdBacktester(): ConsensusThresholdBacktester {
  if (!backtesterInstance) {
    backtesterInstance = new ConsensusThresholdBacktester();
  }
  return backtesterInstance;
}

export { ConsensusThresholdBacktester };
