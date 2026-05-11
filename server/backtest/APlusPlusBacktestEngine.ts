/**
 * A++ Grade Backtesting Engine
 * 
 * This engine tests the trading system with all A++ grade improvements:
 * 1. MacroVetoEnforcer - Prevents 93% of losses by enforcing trend alignment
 * 2. RegimeDirectionFilter - Only longs in uptrend, shorts in downtrend
 * 3. SignalQualityGate - 70% consensus, 65% confidence, 4 agent agreement
 * 4. Higher execution thresholds - 65-80% based on volatility
 * 
 * The goal is to transform from Grade F (28.6% win rate) to A++ (>60% win rate)
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getDb } from '../db';
import { candleData, agentSignals } from '../../drizzle/schema';
import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';

export interface BacktestConfig {
  symbols: string[];
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  
  // A++ Grade Thresholds
  consensusThreshold: number;      // 70%
  confidenceThreshold: number;     // 65%
  minAgentAgreement: number;       // 4
  
  // Macro Veto Settings
  enableMacroVeto: boolean;
  enableRegimeFilter: boolean;
  
  // Position Sizing
  maxPositionSize: number;         // 20%
  riskPerTrade: number;            // 2%
  
  // Exit Settings
  defaultStopLoss: number;         // 5%
  defaultTakeProfit: number;       // 10%
  breakevenActivation: number;     // 0.5%
  
  // Trading Fee
  tradingFee: number;              // 0.1%
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryTime: Date;
  entryPrice: number;
  exitTime: Date | null;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  
  // Quality metrics at entry
  consensus: number;
  confidence: number;
  agentAgreement: number;
  macroTrend: string;
  regime: string;
  
  // Analysis
  wasAlignedWithMacro: boolean;
  wasAlignedWithRegime: boolean;
  wouldHaveBeenBlocked: boolean;
}

export interface BacktestResult {
  // Summary
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // P&L
  totalPnL: number;
  totalPnLPercent: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  
  // Risk Metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  
  // Quality Gate Analysis
  tradesBlockedByMacroVeto: number;
  tradesBlockedByRegimeFilter: number;
  tradesBlockedByConsensus: number;
  tradesBlockedByConfidence: number;
  tradesBlockedByAgentAgreement: number;
  
  // Comparison
  withoutFilters: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
  };
  
  // Trade Details
  trades: BacktestTrade[];
  
  // Grade
  grade: 'A++' | 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  gradeReason: string;
}

export class APlusPlusBacktestEngine extends EventEmitter {
  private config: BacktestConfig;
  private trades: BacktestTrade[] = [];
  private equity: number = 0;
  private peakEquity: number = 0;
  private maxDrawdown: number = 0;
  
  // Statistics
  private blockedByMacroVeto: number = 0;
  private blockedByRegimeFilter: number = 0;
  private blockedByConsensus: number = 0;
  private blockedByConfidence: number = 0;
  private blockedByAgentAgreement: number = 0;
  private tradesWithoutFilters: BacktestTrade[] = [];

  constructor(config: Partial<BacktestConfig> = {}) {
    super();
    
    // A++ Grade Default Configuration
    this.config = {
      symbols: ['BTC-USD', 'ETH-USD'],
      startDate: new Date(getActiveClock().now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
      endDate: new Date(),
      initialCapital: 50000,
      
      // A++ Grade Thresholds (based on audit findings)
      consensusThreshold: 0.70,
      confidenceThreshold: 0.65,
      minAgentAgreement: 4,
      
      // Macro Veto Settings
      enableMacroVeto: true,
      enableRegimeFilter: true,
      
      // Position Sizing
      maxPositionSize: 0.20,
      riskPerTrade: 0.02,
      
      // Exit Settings
      defaultStopLoss: 0.05,
      defaultTakeProfit: 0.10,
      breakevenActivation: 0.005,
      
      // Trading Fee
      tradingFee: 0.001,
      
      ...config,
    };
    
    this.equity = this.config.initialCapital;
    this.peakEquity = this.config.initialCapital;
  }

  /**
   * Run the backtest
   */
  async run(): Promise<BacktestResult> {
    console.log('\n========================================');
    console.log('A++ GRADE BACKTEST ENGINE');
    console.log('========================================');
    console.log(`Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`Period: ${this.config.startDate.toISOString()} to ${this.config.endDate.toISOString()}`);
    console.log(`Initial Capital: $${this.config.initialCapital.toLocaleString()}`);
    console.log('');
    console.log('A++ Grade Thresholds:');
    console.log(`  Consensus: ${(this.config.consensusThreshold * 100).toFixed(0)}%`);
    console.log(`  Confidence: ${(this.config.confidenceThreshold * 100).toFixed(0)}%`);
    console.log(`  Min Agent Agreement: ${this.config.minAgentAgreement}`);
    console.log(`  Macro Veto: ${this.config.enableMacroVeto ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  Regime Filter: ${this.config.enableRegimeFilter ? 'ENABLED' : 'DISABLED'}`);
    console.log('========================================\n');

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Reset state
    this.trades = [];
    this.tradesWithoutFilters = [];
    this.equity = this.config.initialCapital;
    this.peakEquity = this.config.initialCapital;
    this.maxDrawdown = 0;
    this.blockedByMacroVeto = 0;
    this.blockedByRegimeFilter = 0;
    this.blockedByConsensus = 0;
    this.blockedByConfidence = 0;
    this.blockedByAgentAgreement = 0;

    // Process each symbol
    for (const symbol of this.config.symbols) {
      await this.processSymbol(db, symbol);
    }

    // Calculate final results
    return this.calculateResults();
  }

  /**
   * Process a single symbol
   */
  private async processSymbol(db: any, symbol: string): Promise<void> {
    console.log(`\nProcessing ${symbol}...`);

    // Load historical candles
    const candles = await db
      .select()
      .from(candleData)
      .where(
        and(
          eq(candleData.symbol, symbol),
          gte(candleData.timestamp, this.config.startDate),
          lte(candleData.timestamp, this.config.endDate)
        )
      )
      .orderBy(asc(candleData.timestamp));

    console.log(`  Loaded ${candles.length} candles`);

    if (candles.length === 0) {
      console.log(`  No candles found for ${symbol}`);
      return;
    }

    // Load historical signals
    const signals = await db
      .select()
      .from(agentSignals)
      .where(
        and(
          // Note: agentSignals may not have symbol column, using createdAt for time filtering
          gte(agentSignals.timestamp, this.config.startDate),
          lte(agentSignals.timestamp, this.config.endDate)
        )
      )
      .orderBy(asc(agentSignals.timestamp));

    console.log(`  Loaded ${signals.length} signals`);

    // Group signals by timestamp (hourly buckets)
    const signalBuckets = this.groupSignalsByHour(signals);
    
    // Simulate trading
    let openPosition: BacktestTrade | null = null;
    let candleIndex = 0;

    for (const [timestamp, hourSignals] of signalBuckets) {
      // Find the candle for this timestamp
      while (candleIndex < candles.length && 
             new Date(candles[candleIndex].timestamp).getTime() < timestamp) {
        candleIndex++;
      }

      if (candleIndex >= candles.length) break;

      const candle = candles[candleIndex];
      const currentPrice = parseFloat(candle.close);

      // Check if we have an open position
      if (openPosition) {
        // Check exit conditions
        const exitResult = this.checkExitConditions(openPosition, currentPrice, new Date(timestamp));
        if (exitResult.shouldExit) {
          openPosition.exitTime = new Date(timestamp);
          openPosition.exitPrice = currentPrice;
          openPosition.exitReason = exitResult.reason;
          openPosition.pnl = this.calculatePnL(openPosition);
          openPosition.pnlPercent = (openPosition.pnl / (openPosition.entryPrice * openPosition.quantity)) * 100;
          
          // Update equity
          this.equity += openPosition.pnl;
          if (this.equity > this.peakEquity) {
            this.peakEquity = this.equity;
          }
          const drawdown = (this.peakEquity - this.equity) / this.peakEquity;
          if (drawdown > this.maxDrawdown) {
            this.maxDrawdown = drawdown;
          }
          
          this.trades.push(openPosition);
          openPosition = null;
        }
      }

      // Try to open a new position if we don't have one
      if (!openPosition && hourSignals.length >= this.config.minAgentAgreement) {
        const entryDecision = this.evaluateEntry(hourSignals, currentPrice, symbol);
        
        if (entryDecision.shouldEnter) {
          openPosition = {
            id: `${symbol}-${timestamp}`,
            symbol,
            direction: entryDecision.direction,
            entryTime: new Date(timestamp),
            entryPrice: currentPrice,
            exitTime: null,
            exitPrice: null,
            quantity: this.calculatePositionSize(currentPrice),
            pnl: 0,
            pnlPercent: 0,
            exitReason: '',
            consensus: entryDecision.consensus,
            confidence: entryDecision.confidence,
            agentAgreement: entryDecision.agentAgreement,
            macroTrend: entryDecision.macroTrend,
            regime: entryDecision.regime,
            wasAlignedWithMacro: entryDecision.wasAlignedWithMacro,
            wasAlignedWithRegime: entryDecision.wasAlignedWithRegime,
            wouldHaveBeenBlocked: false,
          };
        }
      }
    }

    // Close any remaining open position at the end
    if (openPosition && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      openPosition.exitTime = new Date(lastCandle.timestamp);
      openPosition.exitPrice = parseFloat(lastCandle.close);
      openPosition.exitReason = 'backtest_end';
      openPosition.pnl = this.calculatePnL(openPosition);
      openPosition.pnlPercent = (openPosition.pnl / (openPosition.entryPrice * openPosition.quantity)) * 100;
      this.equity += openPosition.pnl;
      this.trades.push(openPosition);
    }

    console.log(`  Completed ${symbol}: ${this.trades.filter(t => t.symbol === symbol).length} trades`);
  }

  /**
   * Group signals by hour
   */
  private groupSignalsByHour(signals: any[]): Map<number, any[]> {
    const buckets = new Map<number, any[]>();
    
    for (const signal of signals) {
      const timestamp = new Date(signal.timestamp);
      const hourTimestamp = new Date(
        timestamp.getFullYear(),
        timestamp.getMonth(),
        timestamp.getDate(),
        timestamp.getHours()
      ).getTime();
      
      if (!buckets.has(hourTimestamp)) {
        buckets.set(hourTimestamp, []);
      }
      buckets.get(hourTimestamp)!.push(signal);
    }
    
    return buckets;
  }

  /**
   * Evaluate entry decision with A++ grade filters
   */
  private evaluateEntry(
    signals: any[],
    currentPrice: number,
    symbol: string
  ): {
    shouldEnter: boolean;
    direction: 'long' | 'short';
    consensus: number;
    confidence: number;
    agentAgreement: number;
    macroTrend: string;
    regime: string;
    wasAlignedWithMacro: boolean;
    wasAlignedWithRegime: boolean;
    blockReason?: string;
  } {
    // Calculate consensus
    const bullishSignals = signals.filter(s => s.signal === 'bullish');
    const bearishSignals = signals.filter(s => s.signal === 'bearish');
    
    const bullishWeight = bullishSignals.reduce((sum, s) => sum + (s.confidence || 0.5), 0);
    const bearishWeight = bearishSignals.reduce((sum, s) => sum + (s.confidence || 0.5), 0);
    const totalWeight = bullishWeight + bearishWeight;
    
    const consensus = totalWeight > 0 ? Math.max(bullishWeight, bearishWeight) / totalWeight : 0;
    const direction: 'long' | 'short' = bullishWeight > bearishWeight ? 'long' : 'short';
    
    // Calculate average confidence
    const avgConfidence = signals.reduce((sum, s) => sum + (s.confidence || 0.5), 0) / signals.length;
    
    // Count agents in agreement
    const agentAgreement = direction === 'long' ? bullishSignals.length : bearishSignals.length;
    
    // Get macro trend from MacroAnalyst signal
    const macroSignal = signals.find(s => s.agentName === 'MacroAnalyst');
    const macroTrend = macroSignal?.signal || 'neutral';
    const regime = macroSignal?.evidence?.regime || 'unknown';
    
    // Check macro alignment
    const wasAlignedWithMacro = 
      (direction === 'long' && macroTrend === 'bullish') ||
      (direction === 'short' && macroTrend === 'bearish');
    
    // Check regime alignment
    const wasAlignedWithRegime = 
      (direction === 'long' && (regime === 'trending_up' || regime === 'risk-on')) ||
      (direction === 'short' && (regime === 'trending_down' || regime === 'risk-off'));
    
    // Track what would happen without filters
    const wouldEnterWithoutFilters = consensus >= 0.50 && avgConfidence >= 0.40;
    if (wouldEnterWithoutFilters) {
      this.tradesWithoutFilters.push({
        id: `${symbol}-${getActiveClock().now()}`,
        symbol,
        direction,
        entryTime: new Date(),
        entryPrice: currentPrice,
        exitTime: null,
        exitPrice: null,
        quantity: 0,
        pnl: 0,
        pnlPercent: 0,
        exitReason: '',
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        wouldHaveBeenBlocked: true,
      });
    }
    
    // A++ GRADE FILTERS
    
    // Filter 1: Macro Veto (would have prevented 93% of losses)
    if (this.config.enableMacroVeto && !wasAlignedWithMacro && macroTrend !== 'neutral') {
      this.blockedByMacroVeto++;
      return {
        shouldEnter: false,
        direction,
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        blockReason: `Macro veto: ${direction} against ${macroTrend} trend`,
      };
    }
    
    // Filter 2: Regime Direction Filter
    if (this.config.enableRegimeFilter && !wasAlignedWithRegime && regime !== 'unknown' && regime !== 'ranging') {
      this.blockedByRegimeFilter++;
      return {
        shouldEnter: false,
        direction,
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        blockReason: `Regime filter: ${direction} not allowed in ${regime}`,
      };
    }
    
    // Filter 3: Consensus Threshold (70%)
    if (consensus < this.config.consensusThreshold) {
      this.blockedByConsensus++;
      return {
        shouldEnter: false,
        direction,
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        blockReason: `Weak consensus: ${(consensus * 100).toFixed(1)}% < ${(this.config.consensusThreshold * 100).toFixed(0)}%`,
      };
    }
    
    // Filter 4: Confidence Threshold (65%)
    if (avgConfidence < this.config.confidenceThreshold) {
      this.blockedByConfidence++;
      return {
        shouldEnter: false,
        direction,
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        blockReason: `Low confidence: ${(avgConfidence * 100).toFixed(1)}% < ${(this.config.confidenceThreshold * 100).toFixed(0)}%`,
      };
    }
    
    // Filter 5: Agent Agreement (4 agents)
    if (agentAgreement < this.config.minAgentAgreement) {
      this.blockedByAgentAgreement++;
      return {
        shouldEnter: false,
        direction,
        consensus,
        confidence: avgConfidence,
        agentAgreement,
        macroTrend,
        regime,
        wasAlignedWithMacro,
        wasAlignedWithRegime,
        blockReason: `Insufficient agreement: ${agentAgreement} < ${this.config.minAgentAgreement} agents`,
      };
    }
    
    // All filters passed - enter trade
    return {
      shouldEnter: true,
      direction,
      consensus,
      confidence: avgConfidence,
      agentAgreement,
      macroTrend,
      regime,
      wasAlignedWithMacro,
      wasAlignedWithRegime,
    };
  }

  /**
   * Check exit conditions
   */
  private checkExitConditions(
    position: BacktestTrade,
    currentPrice: number,
    currentTime: Date
  ): { shouldExit: boolean; reason: string } {
    const entryPrice = position.entryPrice;
    const isLong = position.direction === 'long';
    
    // Calculate current P&L percentage
    const pnlPercent = isLong
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    // Stop Loss
    if (pnlPercent <= -this.config.defaultStopLoss) {
      return { shouldExit: true, reason: 'stop_loss' };
    }
    
    // Take Profit
    if (pnlPercent >= this.config.defaultTakeProfit) {
      return { shouldExit: true, reason: 'take_profit' };
    }
    
    // Breakeven Stop (if profit > 0.5%, move stop to breakeven)
    if (pnlPercent >= this.config.breakevenActivation && pnlPercent < 0.001) {
      return { shouldExit: true, reason: 'breakeven_stop' };
    }
    
    // Time-based exit (4 hours max hold)
    const holdTime = currentTime.getTime() - position.entryTime.getTime();
    if (holdTime > 4 * 60 * 60 * 1000) {
      if (pnlPercent > 0) {
        return { shouldExit: true, reason: 'time_exit_profitable' };
      } else {
        return { shouldExit: true, reason: 'time_exit' };
      }
    }
    
    return { shouldExit: false, reason: '' };
  }

  /**
   * Calculate position size
   */
  private calculatePositionSize(currentPrice: number): number {
    const positionValue = this.equity * this.config.maxPositionSize;
    return positionValue / currentPrice;
  }

  /**
   * Calculate P&L for a trade
   */
  private calculatePnL(trade: BacktestTrade): number {
    if (!trade.exitPrice) return 0;
    
    const isLong = trade.direction === 'long';
    const priceDiff = isLong
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    
    const grossPnL = priceDiff * trade.quantity;
    const fees = (trade.entryPrice + trade.exitPrice) * trade.quantity * this.config.tradingFee;
    
    return grossPnL - fees;
  }

  /**
   * Calculate final results
   */
  private calculateResults(): BacktestResult {
    const winningTrades = this.trades.filter(t => t.pnl > 0);
    const losingTrades = this.trades.filter(t => t.pnl <= 0);
    
    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    
    const avgWin = winningTrades.length > 0 
      ? totalWins / winningTrades.length 
      : 0;
    const avgLoss = losingTrades.length > 0 
      ? totalLosses / losingTrades.length 
      : 0;
    
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    const winRate = this.trades.length > 0 ? winningTrades.length / this.trades.length : 0;
    
    // Calculate Sharpe Ratio (simplified)
    const returns = this.trades.map(t => t.pnlPercent / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn * Math.sqrt(252)) / stdDev : 0;
    
    // Calculate Sortino Ratio (downside deviation only)
    const negativeReturns = returns.filter(r => r < 0);
    const downsideDev = negativeReturns.length > 1
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downsideDev > 0 ? (avgReturn * Math.sqrt(252)) / downsideDev : 0;
    
    // Determine grade
    const { grade, gradeReason } = this.calculateGrade(winRate, profitFactor, sharpeRatio, this.maxDrawdown);
    
    const result: BacktestResult = {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      
      totalPnL,
      totalPnLPercent: (totalPnL / this.config.initialCapital) * 100,
      avgWin,
      avgLoss,
      profitFactor,
      
      maxDrawdown: this.maxDrawdown * this.config.initialCapital,
      maxDrawdownPercent: this.maxDrawdown * 100,
      sharpeRatio,
      sortinoRatio,
      
      tradesBlockedByMacroVeto: this.blockedByMacroVeto,
      tradesBlockedByRegimeFilter: this.blockedByRegimeFilter,
      tradesBlockedByConsensus: this.blockedByConsensus,
      tradesBlockedByConfidence: this.blockedByConfidence,
      tradesBlockedByAgentAgreement: this.blockedByAgentAgreement,
      
      withoutFilters: {
        totalTrades: this.tradesWithoutFilters.length,
        winRate: 0, // Would need to simulate
        totalPnL: 0,
      },
      
      trades: this.trades,
      
      grade,
      gradeReason,
    };
    
    // Print summary
    this.printSummary(result);
    
    return result;
  }

  /**
   * Calculate grade based on performance metrics
   */
  private calculateGrade(
    winRate: number,
    profitFactor: number,
    sharpeRatio: number,
    maxDrawdown: number
  ): { grade: BacktestResult['grade']; gradeReason: string } {
    // A++ Grade Requirements:
    // - Win rate > 65%
    // - Profit factor > 2.0
    // - Sharpe ratio > 1.5
    // - Max drawdown < 10%
    
    if (winRate >= 0.65 && profitFactor >= 2.0 && sharpeRatio >= 1.5 && maxDrawdown <= 0.10) {
      return { grade: 'A++', gradeReason: 'Exceptional performance across all metrics' };
    }
    
    if (winRate >= 0.60 && profitFactor >= 1.5 && sharpeRatio >= 1.0 && maxDrawdown <= 0.15) {
      return { grade: 'A+', gradeReason: 'Excellent performance with strong risk-adjusted returns' };
    }
    
    if (winRate >= 0.55 && profitFactor >= 1.2 && sharpeRatio >= 0.5 && maxDrawdown <= 0.20) {
      return { grade: 'A', gradeReason: 'Good performance with acceptable risk' };
    }
    
    if (winRate >= 0.50 && profitFactor >= 1.0 && maxDrawdown <= 0.25) {
      return { grade: 'B', gradeReason: 'Breakeven or slightly profitable' };
    }
    
    if (winRate >= 0.45 && profitFactor >= 0.8) {
      return { grade: 'C', gradeReason: 'Below average performance' };
    }
    
    if (winRate >= 0.35 && profitFactor >= 0.5) {
      return { grade: 'D', gradeReason: 'Poor performance, needs improvement' };
    }
    
    return { grade: 'F', gradeReason: 'Failing - significant losses' };
  }

  /**
   * Print summary report
   */
  private printSummary(result: BacktestResult): void {
    console.log('\n========================================');
    console.log('BACKTEST RESULTS');
    console.log('========================================');
    console.log(`Grade: ${result.grade} - ${result.gradeReason}`);
    console.log('');
    console.log('Performance:');
    console.log(`  Total Trades: ${result.totalTrades}`);
    console.log(`  Winning: ${result.winningTrades} | Losing: ${result.losingTrades}`);
    console.log(`  Win Rate: ${(result.winRate * 100).toFixed(1)}%`);
    console.log(`  Total P&L: $${result.totalPnL.toFixed(2)} (${result.totalPnLPercent.toFixed(2)}%)`);
    console.log(`  Avg Win: $${result.avgWin.toFixed(2)} | Avg Loss: $${result.avgLoss.toFixed(2)}`);
    console.log(`  Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log('');
    console.log('Risk Metrics:');
    console.log(`  Max Drawdown: $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    console.log(`  Sortino Ratio: ${result.sortinoRatio.toFixed(2)}`);
    console.log('');
    console.log('Quality Gate Statistics:');
    console.log(`  Blocked by Macro Veto: ${result.tradesBlockedByMacroVeto}`);
    console.log(`  Blocked by Regime Filter: ${result.tradesBlockedByRegimeFilter}`);
    console.log(`  Blocked by Consensus: ${result.tradesBlockedByConsensus}`);
    console.log(`  Blocked by Confidence: ${result.tradesBlockedByConfidence}`);
    console.log(`  Blocked by Agent Agreement: ${result.tradesBlockedByAgentAgreement}`);
    console.log('========================================\n');
  }
}

// Export singleton runner
export async function runAPlusPlusBacktest(config?: Partial<BacktestConfig>): Promise<BacktestResult> {
  const engine = new APlusPlusBacktestEngine(config);
  return engine.run();
}
