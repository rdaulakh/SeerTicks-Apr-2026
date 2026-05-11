/**
 * Performance Analytics Service
 * 
 * Week 10: Comprehensive performance tracking and analysis
 * - Trade journal with detailed logging
 * - P&L attribution (by symbol, strategy, time period)
 * - Drawdown analysis (max drawdown, drawdown duration)
 * - Risk-adjusted metrics (Sharpe ratio, Sortino ratio, Calmar ratio)
 * - Profit factor and win rate tracking
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  positionSize: number;
  entryTime: number;
  exitTime: number | null;
  holdTimeMs: number | null;
  pnlAbsolute: number | null;
  pnlPercent: number | null;
  strategy: string;
  entryReason: string;
  exitReason: string | null;
  stopLoss: number;
  takeProfit: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  entryValidation: {
    agentConsensus: boolean;
    timeframeAlignment: boolean;
    volumeConfirmation: boolean;
  };
  riskMetrics: {
    kellyFraction: number;
    positionSizePercent: number;
    riskRewardRatio: number;
  };
  tags: string[];
  notes: string;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
}

export interface DrawdownAnalysis {
  currentDrawdown: number;
  currentDrawdownPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownStart: number;
  maxDrawdownEnd: number | null;
  maxDrawdownDurationMs: number;
  avgDrawdownDurationMs: number;
  drawdownPeriods: DrawdownPeriod[];
  recoveryFactor: number;
  ulcerIndex: number;
}

export interface DrawdownPeriod {
  start: number;
  end: number | null;
  peakEquity: number;
  troughEquity: number;
  drawdownPercent: number;
  durationMs: number;
  recovered: boolean;
}

export interface PnLAttribution {
  bySymbol: Map<string, SymbolPnL>;
  byStrategy: Map<string, StrategyPnL>;
  byTimeOfDay: Map<string, TimeOfDayPnL>;
  byDayOfWeek: Map<string, DayOfWeekPnL>;
  byMonth: Map<string, MonthPnL>;
  byMarketRegime: Map<string, RegimePnL>;
}

export interface SymbolPnL {
  symbol: string;
  totalPnL: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgHoldTime: number;
  bestTrade: number;
  worstTrade: number;
}

export interface StrategyPnL {
  strategy: string;
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
}

export interface TimeOfDayPnL {
  hour: number;
  totalPnL: number;
  totalTrades: number;
  winRate: number;
}

export interface DayOfWeekPnL {
  day: string;
  totalPnL: number;
  totalTrades: number;
  winRate: number;
}

export interface MonthPnL {
  month: string;
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
}

export interface RegimePnL {
  regime: string;
  totalPnL: number;
  totalTrades: number;
  winRate: number;
}

export interface RiskAdjustedMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  winRate: number;
  avgWinLossRatio: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  volatility: number;
  downsidevol: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  avgTradeReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldTimeWinners: number;
  avgHoldTimeLosers: number;
  currentStreak: number;
  currentStreakType: 'win' | 'loss' | 'none';
  maxWinStreak: number;
  maxLossStreak: number;
}

export interface PerformanceAnalyticsConfig {
  riskFreeRate: number;
  tradingDaysPerYear: number;
  equitySnapshotIntervalMs: number;
  maxJournalEntries: number;
}

const DEFAULT_CONFIG: PerformanceAnalyticsConfig = {
  riskFreeRate: 0.05,
  tradingDaysPerYear: 365,
  equitySnapshotIntervalMs: 60 * 60 * 1000,
  maxJournalEntries: 10000,
};

// ============================================================================
// PERFORMANCE ANALYTICS SERVICE
// ============================================================================

export class PerformanceAnalytics extends EventEmitter {
  private config: PerformanceAnalyticsConfig;
  private journal: TradeJournalEntry[] = [];
  private openTrades: Map<string, TradeJournalEntry> = new Map();
  private equityCurve: EquityPoint[] = [];
  private initialEquity: number = 0;
  private currentEquity: number = 0;
  private peakEquity: number = 0;
  private currentDrawdownStart: number | null = null;
  private drawdownPeriods: DrawdownPeriod[] = [];
  private currentStreak: number = 0;
  private currentStreakType: 'win' | 'loss' | 'none' = 'none';
  private maxWinStreak: number = 0;
  private maxLossStreak: number = 0;

  constructor(config?: Partial<PerformanceAnalyticsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(`[PerformanceAnalytics] Initialized with config:`, {
      riskFreeRate: this.config.riskFreeRate,
      tradingDaysPerYear: this.config.tradingDaysPerYear,
    });
  }

  initialize(initialEquity: number): void {
    this.initialEquity = initialEquity;
    this.currentEquity = initialEquity;
    this.peakEquity = initialEquity;
    this.equityCurve.push({
      timestamp: getActiveClock().now(),
      equity: initialEquity,
      drawdown: 0,
      drawdownPercent: 0,
    });
    console.log(`[PerformanceAnalytics] Initialized with equity: $${initialEquity.toFixed(2)}`);
  }

  recordTradeEntry(trade: Omit<TradeJournalEntry, 'id' | 'exitPrice' | 'exitTime' | 'holdTimeMs' | 'pnlAbsolute' | 'pnlPercent' | 'exitReason' | 'maxFavorableExcursion' | 'maxAdverseExcursion'>): string {
    const id = `trade_${getActiveClock().now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: TradeJournalEntry = {
      ...trade,
      id,
      exitPrice: null,
      exitTime: null,
      holdTimeMs: null,
      pnlAbsolute: null,
      pnlPercent: null,
      exitReason: null,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
    };
    this.openTrades.set(id, entry);
    console.log(`[PerformanceAnalytics] Trade entry recorded: ${id} ${trade.symbol} ${trade.direction}`);
    this.emit('trade_entry', entry);
    return id;
  }

  updateOpenTrade(tradeId: string, currentPrice: number): void {
    const trade = this.openTrades.get(tradeId);
    if (!trade) return;
    const pnlPercent = trade.direction === 'long'
      ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    if (pnlPercent > trade.maxFavorableExcursion) {
      trade.maxFavorableExcursion = pnlPercent;
    }
    if (pnlPercent < trade.maxAdverseExcursion) {
      trade.maxAdverseExcursion = pnlPercent;
    }
  }

  recordTradeExit(tradeId: string, exitPrice: number, exitReason: string): TradeJournalEntry | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) {
      console.warn(`[PerformanceAnalytics] Trade ${tradeId} not found`);
      return null;
    }
    const exitTime = getActiveClock().now();
    const holdTimeMs = exitTime - trade.entryTime;
    const pnlPercent = trade.direction === 'long'
      ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
    const pnlAbsolute = (pnlPercent / 100) * trade.positionSize;
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.holdTimeMs = holdTimeMs;
    trade.pnlAbsolute = pnlAbsolute;
    trade.pnlPercent = pnlPercent;
    trade.exitReason = exitReason;
    this.openTrades.delete(tradeId);
    this.journal.push(trade);
    if (this.journal.length > this.config.maxJournalEntries) {
      this.journal = this.journal.slice(-this.config.maxJournalEntries);
    }
    this.updateEquity(pnlAbsolute);
    this.updateStreaks(pnlAbsolute > 0);
    console.log(`[PerformanceAnalytics] Trade exit recorded: ${tradeId} P&L: ${pnlPercent.toFixed(2)}%`);
    this.emit('trade_exit', trade);
    return trade;
  }

  private updateEquity(pnlAbsolute: number): void {
    this.currentEquity += pnlAbsolute;
    if (this.currentEquity > this.peakEquity) {
      this.peakEquity = this.currentEquity;
      if (this.currentDrawdownStart !== null) {
        const lastPeriod = this.drawdownPeriods[this.drawdownPeriods.length - 1];
        if (lastPeriod && !lastPeriod.recovered) {
          lastPeriod.end = getActiveClock().now();
          lastPeriod.durationMs = lastPeriod.end - lastPeriod.start;
          lastPeriod.recovered = true;
        }
        this.currentDrawdownStart = null;
      }
    } else {
      if (this.currentDrawdownStart === null) {
        this.currentDrawdownStart = getActiveClock().now();
        this.drawdownPeriods.push({
          start: this.currentDrawdownStart,
          end: null,
          peakEquity: this.peakEquity,
          troughEquity: this.currentEquity,
          drawdownPercent: ((this.peakEquity - this.currentEquity) / this.peakEquity) * 100,
          durationMs: 0,
          recovered: false,
        });
      } else {
        const currentPeriod = this.drawdownPeriods[this.drawdownPeriods.length - 1];
        if (currentPeriod && !currentPeriod.recovered) {
          if (this.currentEquity < currentPeriod.troughEquity) {
            currentPeriod.troughEquity = this.currentEquity;
            currentPeriod.drawdownPercent = ((currentPeriod.peakEquity - this.currentEquity) / currentPeriod.peakEquity) * 100;
          }
        }
      }
    }
    const drawdown = this.peakEquity - this.currentEquity;
    const drawdownPercent = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;
    this.equityCurve.push({
      timestamp: getActiveClock().now(),
      equity: this.currentEquity,
      drawdown,
      drawdownPercent,
    });
    this.emit('equity_update', { equity: this.currentEquity, drawdown, drawdownPercent });
  }

  private updateStreaks(isWin: boolean): void {
    if (isWin) {
      if (this.currentStreakType === 'win') {
        this.currentStreak++;
      } else {
        this.currentStreak = 1;
        this.currentStreakType = 'win';
      }
      this.maxWinStreak = Math.max(this.maxWinStreak, this.currentStreak);
    } else {
      if (this.currentStreakType === 'loss') {
        this.currentStreak++;
      } else {
        this.currentStreak = 1;
        this.currentStreakType = 'loss';
      }
      this.maxLossStreak = Math.max(this.maxLossStreak, this.currentStreak);
    }
  }

  getPnLAttribution(): PnLAttribution {
    const bySymbol = new Map<string, SymbolPnL>();
    const byStrategy = new Map<string, StrategyPnL>();
    const byTimeOfDay = new Map<string, TimeOfDayPnL>();
    const byDayOfWeek = new Map<string, DayOfWeekPnL>();
    const byMonth = new Map<string, MonthPnL>();
    const byMarketRegime = new Map<string, RegimePnL>();
    for (const trade of this.journal) {
      if (trade.pnlAbsolute === null) continue;
      this.updateSymbolPnL(bySymbol, trade);
      this.updateStrategyPnL(byStrategy, trade);
      this.updateTimeOfDayPnL(byTimeOfDay, trade);
      this.updateDayOfWeekPnL(byDayOfWeek, trade);
      this.updateMonthPnL(byMonth, trade);
    }
    return { bySymbol, byStrategy, byTimeOfDay, byDayOfWeek, byMonth, byMarketRegime };
  }

  private updateSymbolPnL(map: Map<string, SymbolPnL>, trade: TradeJournalEntry): void {
    const existing = map.get(trade.symbol) || {
      symbol: trade.symbol, totalPnL: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
      winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, avgHoldTime: 0, bestTrade: -Infinity, worstTrade: Infinity,
    };
    existing.totalPnL += trade.pnlAbsolute!;
    existing.totalTrades++;
    if (trade.pnlAbsolute! > 0) {
      existing.winningTrades++;
      existing.avgWin = (existing.avgWin * (existing.winningTrades - 1) + trade.pnlAbsolute!) / existing.winningTrades;
    } else {
      existing.losingTrades++;
      existing.avgLoss = (existing.avgLoss * (existing.losingTrades - 1) + Math.abs(trade.pnlAbsolute!)) / existing.losingTrades;
    }
    existing.winRate = existing.winningTrades / existing.totalTrades;
    existing.profitFactor = existing.avgLoss > 0 ? (existing.avgWin * existing.winningTrades) / (existing.avgLoss * existing.losingTrades) : Infinity;
    existing.avgHoldTime = (existing.avgHoldTime * (existing.totalTrades - 1) + (trade.holdTimeMs || 0)) / existing.totalTrades;
    existing.bestTrade = Math.max(existing.bestTrade, trade.pnlAbsolute!);
    existing.worstTrade = Math.min(existing.worstTrade, trade.pnlAbsolute!);
    map.set(trade.symbol, existing);
  }

  private updateStrategyPnL(map: Map<string, StrategyPnL>, trade: TradeJournalEntry): void {
    const existing = map.get(trade.strategy) || {
      strategy: trade.strategy, totalPnL: 0, totalTrades: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0,
    };
    existing.totalPnL += trade.pnlAbsolute!;
    existing.totalTrades++;
    const wins = this.journal.filter(t => t.strategy === trade.strategy && t.pnlAbsolute! > 0).length;
    existing.winRate = wins / existing.totalTrades;
    map.set(trade.strategy, existing);
  }

  private updateTimeOfDayPnL(map: Map<string, TimeOfDayPnL>, trade: TradeJournalEntry): void {
    const hour = new Date(trade.entryTime).getHours();
    const key = hour.toString().padStart(2, '0');
    const existing = map.get(key) || { hour, totalPnL: 0, totalTrades: 0, winRate: 0 };
    existing.totalPnL += trade.pnlAbsolute!;
    existing.totalTrades++;
    const wins = this.journal.filter(t => new Date(t.entryTime).getHours() === hour && t.pnlAbsolute! > 0).length;
    existing.winRate = wins / existing.totalTrades;
    map.set(key, existing);
  }

  private updateDayOfWeekPnL(map: Map<string, DayOfWeekPnL>, trade: TradeJournalEntry): void {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = days[new Date(trade.entryTime).getDay()];
    const existing = map.get(day) || { day, totalPnL: 0, totalTrades: 0, winRate: 0 };
    existing.totalPnL += trade.pnlAbsolute!;
    existing.totalTrades++;
    const wins = this.journal.filter(t => days[new Date(t.entryTime).getDay()] === day && t.pnlAbsolute! > 0).length;
    existing.winRate = wins / existing.totalTrades;
    map.set(day, existing);
  }

  private updateMonthPnL(map: Map<string, MonthPnL>, trade: TradeJournalEntry): void {
    const date = new Date(trade.entryTime);
    const month = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    const existing = map.get(month) || { month, totalPnL: 0, totalTrades: 0, winRate: 0, sharpeRatio: 0 };
    existing.totalPnL += trade.pnlAbsolute!;
    existing.totalTrades++;
    const monthTrades = this.journal.filter(t => {
      const d = new Date(t.entryTime);
      return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}` === month;
    });
    const wins = monthTrades.filter(t => t.pnlAbsolute! > 0).length;
    existing.winRate = wins / existing.totalTrades;
    map.set(month, existing);
  }

  getDrawdownAnalysis(): DrawdownAnalysis {
    const currentDrawdown = this.peakEquity - this.currentEquity;
    const currentDrawdownPercent = this.peakEquity > 0 ? (currentDrawdown / this.peakEquity) * 100 : 0;
    let maxDrawdown = 0, maxDrawdownPercent = 0, maxDrawdownStart = 0, maxDrawdownEnd: number | null = null, maxDrawdownDurationMs = 0;
    for (const period of this.drawdownPeriods) {
      if (period.drawdownPercent > maxDrawdownPercent) {
        maxDrawdown = period.peakEquity - period.troughEquity;
        maxDrawdownPercent = period.drawdownPercent;
        maxDrawdownStart = period.start;
        maxDrawdownEnd = period.end;
        maxDrawdownDurationMs = period.durationMs;
      }
    }
    const completedPeriods = this.drawdownPeriods.filter(p => p.recovered);
    const avgDrawdownDurationMs = completedPeriods.length > 0
      ? completedPeriods.reduce((sum, p) => sum + p.durationMs, 0) / completedPeriods.length : 0;
    const totalProfit = this.currentEquity - this.initialEquity;
    const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : Infinity;
    const drawdownSquares = this.equityCurve.map(p => Math.pow(p.drawdownPercent, 2));
    const ulcerIndex = drawdownSquares.length > 0
      ? Math.sqrt(drawdownSquares.reduce((sum, d) => sum + d, 0) / drawdownSquares.length) : 0;
    return {
      currentDrawdown, currentDrawdownPercent, maxDrawdown, maxDrawdownPercent,
      maxDrawdownStart, maxDrawdownEnd, maxDrawdownDurationMs, avgDrawdownDurationMs,
      drawdownPeriods: this.drawdownPeriods, recoveryFactor, ulcerIndex,
    };
  }

  getRiskAdjustedMetrics(): RiskAdjustedMetrics {
    const closedTrades = this.journal.filter(t => t.pnlAbsolute !== null);
    if (closedTrades.length === 0) return this.getEmptyMetrics();
    const returns = closedTrades.map(t => t.pnlPercent!);
    const totalReturn = this.currentEquity - this.initialEquity;
    const totalReturnPercent = this.initialEquity > 0 ? (totalReturn / this.initialEquity) * 100 : 0;
    const winningTrades = closedTrades.filter(t => t.pnlAbsolute! > 0);
    const losingTrades = closedTrades.filter(t => t.pnlAbsolute! <= 0);
    const winRate = winningTrades.length / closedTrades.length;
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnlAbsolute!, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlAbsolute!, 0) / losingTrades.length) : 0;
    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : Infinity;
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlAbsolute!, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlAbsolute!, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
    const expectancy = closedTrades.reduce((sum, t) => sum + t.pnlAbsolute!, 0) / closedTrades.length;
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    const negativeReturns = returns.filter(r => r < 0);
    const downsideVariance = negativeReturns.length > 0
      ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length : 0;
    const downsideVol = Math.sqrt(downsideVariance);
    const firstTradeTime = closedTrades[0].entryTime;
    const lastTradeTime = closedTrades[closedTrades.length - 1].exitTime || getActiveClock().now();
    const tradingDays = (lastTradeTime - firstTradeTime) / (24 * 60 * 60 * 1000);
    const annualizationFactor = tradingDays > 0 ? this.config.tradingDaysPerYear / tradingDays : 1;
    const annualizedReturn = totalReturnPercent * annualizationFactor;
    const dailyRiskFreeRate = this.config.riskFreeRate / this.config.tradingDaysPerYear;
    const avgTradeReturn = avgReturn;
    const excessReturn = avgTradeReturn - dailyRiskFreeRate;
    const sharpeRatio = volatility > 0 ? (excessReturn / volatility) * Math.sqrt(annualizationFactor) : 0;
    const sortinoRatio = downsideVol > 0 ? (excessReturn / downsideVol) * Math.sqrt(annualizationFactor) : 0;
    const drawdownAnalysis = this.getDrawdownAnalysis();
    const calmarRatio = drawdownAnalysis.maxDrawdownPercent > 0
      ? annualizedReturn / drawdownAnalysis.maxDrawdownPercent : Infinity;
    const avgHoldTimeWinners = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.holdTimeMs || 0), 0) / winningTrades.length : 0;
    const avgHoldTimeLosers = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + (t.holdTimeMs || 0), 0) / losingTrades.length : 0;
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnlAbsolute!)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnlAbsolute!)) : 0;
    return {
      sharpeRatio, sortinoRatio, calmarRatio, profitFactor, winRate, avgWinLossRatio, expectancy,
      maxDrawdown: drawdownAnalysis.maxDrawdown, maxDrawdownPercent: drawdownAnalysis.maxDrawdownPercent,
      volatility, downsidevol: downsideVol, totalReturn, totalReturnPercent, annualizedReturn, avgTradeReturn,
      totalTrades: closedTrades.length, winningTrades: winningTrades.length, losingTrades: losingTrades.length,
      avgWin, avgLoss, largestWin, largestLoss, avgHoldTimeWinners, avgHoldTimeLosers,
      currentStreak: this.currentStreak, currentStreakType: this.currentStreakType,
      maxWinStreak: this.maxWinStreak, maxLossStreak: this.maxLossStreak,
    };
  }

  private getEmptyMetrics(): RiskAdjustedMetrics {
    return {
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, profitFactor: 0, winRate: 0, avgWinLossRatio: 0, expectancy: 0,
      maxDrawdown: 0, maxDrawdownPercent: 0, volatility: 0, downsidevol: 0, totalReturn: 0, totalReturnPercent: 0,
      annualizedReturn: 0, avgTradeReturn: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0, avgWin: 0, avgLoss: 0,
      largestWin: 0, largestLoss: 0, avgHoldTimeWinners: 0, avgHoldTimeLosers: 0, currentStreak: 0,
      currentStreakType: 'none', maxWinStreak: 0, maxLossStreak: 0,
    };
  }

  getJournal(options?: { symbol?: string; strategy?: string; startTime?: number; endTime?: number; limit?: number }): TradeJournalEntry[] {
    let entries = [...this.journal];
    if (options?.symbol) entries = entries.filter(e => e.symbol === options.symbol);
    if (options?.strategy) entries = entries.filter(e => e.strategy === options.strategy);
    if (options?.startTime) entries = entries.filter(e => e.entryTime >= options.startTime!);
    if (options?.endTime) entries = entries.filter(e => e.entryTime <= options.endTime!);
    if (options?.limit) entries = entries.slice(-options.limit);
    return entries;
  }

  getOpenTrades(): TradeJournalEntry[] { return Array.from(this.openTrades.values()); }
  getEquityCurve(): EquityPoint[] { return [...this.equityCurve]; }

  getSummary() {
    return {
      metrics: this.getRiskAdjustedMetrics(),
      drawdown: this.getDrawdownAnalysis(),
      attribution: this.getPnLAttribution(),
      equity: { initial: this.initialEquity, current: this.currentEquity, peak: this.peakEquity },
      trades: { total: this.journal.length + this.openTrades.size, open: this.openTrades.size, closed: this.journal.length },
    };
  }

  exportJournalToCSV(): string {
    const headers = ['ID', 'Symbol', 'Direction', 'Entry Price', 'Exit Price', 'Quantity', 'Position Size', 'Entry Time', 'Exit Time', 'Hold Time (ms)', 'P&L ($)', 'P&L (%)', 'Strategy', 'Entry Reason', 'Exit Reason', 'Stop Loss', 'Take Profit', 'Max Favorable', 'Max Adverse', 'Agent Consensus', 'Timeframe Alignment', 'Volume Confirmation', 'Kelly Fraction', 'Position Size %', 'Risk/Reward', 'Tags', 'Notes'];
    const rows = this.journal.map(t => [t.id, t.symbol, t.direction, t.entryPrice, t.exitPrice, t.quantity, t.positionSize, new Date(t.entryTime).toISOString(), t.exitTime ? new Date(t.exitTime).toISOString() : '', t.holdTimeMs, t.pnlAbsolute?.toFixed(2), t.pnlPercent?.toFixed(2), t.strategy, t.entryReason, t.exitReason, t.stopLoss, t.takeProfit, t.maxFavorableExcursion.toFixed(2), t.maxAdverseExcursion.toFixed(2), t.entryValidation.agentConsensus, t.entryValidation.timeframeAlignment, t.entryValidation.volumeConfirmation, t.riskMetrics.kellyFraction.toFixed(4), t.riskMetrics.positionSizePercent.toFixed(2), t.riskMetrics.riskRewardRatio.toFixed(2), t.tags.join(';'), t.notes]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  reset(): void {
    this.journal = [];
    this.openTrades.clear();
    this.equityCurve = [];
    this.initialEquity = 0;
    this.currentEquity = 0;
    this.peakEquity = 0;
    this.currentDrawdownStart = null;
    this.drawdownPeriods = [];
    this.currentStreak = 0;
    this.currentStreakType = 'none';
    this.maxWinStreak = 0;
    this.maxLossStreak = 0;
    console.log('[PerformanceAnalytics] All data reset');
  }
}

let performanceAnalyticsInstance: PerformanceAnalytics | null = null;
export function getPerformanceAnalytics(): PerformanceAnalytics {
  if (!performanceAnalyticsInstance) performanceAnalyticsInstance = new PerformanceAnalytics();
  return performanceAnalyticsInstance;
}
export function resetPerformanceAnalytics(): void {
  if (performanceAnalyticsInstance) performanceAnalyticsInstance.reset();
  performanceAnalyticsInstance = null;
}
export default PerformanceAnalytics;
