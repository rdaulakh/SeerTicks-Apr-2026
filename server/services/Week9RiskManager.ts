/**
 * Week 9 Risk Manager
 * 
 * Institutional-grade risk management system implementing:
 * 1. Kelly Criterion position sizing with fractional Kelly (0.25-0.5x)
 * 2. Circuit breakers for consecutive losses
 * 3. Correlation-based position limits
 * 
 * Based on Claude AI recommendations for A++ institutional grade trading.
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TradeResult {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  pnlAbsolute: number;
  timestamp: number;
  holdTimeMs: number;
}

export interface PositionSizeResult {
  recommendedSize: number;
  kellyFraction: number;
  adjustedFraction: number;
  maxAllowedSize: number;
  reason: string;
  breakdown: {
    rawKelly: number;
    fractionalKelly: number;
    correlationAdjustment: number;
    circuitBreakerAdjustment: number;
  };
}

export interface CircuitBreakerStatus {
  isTripped: boolean;
  consecutiveLosses: number;
  globalConsecutiveLosses: number;
  cooldownUntil: Date | null;
  reason: string;
}

export interface CorrelationLimit {
  symbol: string;
  correlatedSymbols: string[];
  totalExposure: number;
  maxExposure: number;
  canOpenPosition: boolean;
  reason: string;
}

export interface RiskManagerConfig {
  // Kelly Criterion settings
  kellyFraction: number;           // Fractional Kelly multiplier (0.25-0.5)
  minWinRate: number;              // Minimum win rate to use Kelly (default 0.4)
  defaultWinRate: number;          // Default win rate if insufficient data
  defaultPayoffRatio: number;      // Default payoff ratio (avg win / avg loss)
  
  // Circuit breaker settings
  maxConsecutiveLosses: number;    // Per-symbol consecutive loss limit
  maxGlobalConsecutiveLosses: number; // Global consecutive loss limit
  cooldownMinutes: number;         // Cooldown period after circuit breaker trips
  
  // Correlation settings
  maxCorrelatedExposure: number;   // Max exposure to correlated assets (% of portfolio)
  correlationThreshold: number;    // Correlation coefficient threshold (0.7+)
  
  // Position limits
  maxPositionSize: number;         // Max single position size (% of portfolio)
  maxTotalExposure: number;        // Max total exposure (% of portfolio)
  maxPositionsPerSymbol: number;   // Max positions per symbol
  maxTotalPositions: number;       // Max total positions
  
  // PRIORITY 1: Daily drawdown limit
  maxDailyDrawdownPercent: number; // Max daily drawdown before halting (-10% default)
  
  // PRIORITY 1: Max concurrent positions
  maxConcurrentPositions: number;  // Max concurrent open positions (3 default)
}

const DEFAULT_CONFIG: RiskManagerConfig = {
  // Kelly Criterion: Use 0.25x Kelly for conservative sizing
  kellyFraction: 0.25,
  minWinRate: 0.40,
  defaultWinRate: 0.50,
  defaultPayoffRatio: 1.5,
  
  // Circuit breakers: 3 consecutive losses per symbol, 5 global
  maxConsecutiveLosses: 3,
  maxGlobalConsecutiveLosses: 5,
  cooldownMinutes: 30,
  
  // Correlation: Max 30% exposure to correlated assets
  maxCorrelatedExposure: 0.30,
  correlationThreshold: 0.70,
  
  // Position limits
  maxPositionSize: 0.20,           // 20% max per position
  maxTotalExposure: 0.80,          // 80% max total exposure
  // Phase 47 — was 1; live audit found 126 SIGNAL_APPROVED/hr blocked
  // by the per-symbol gate. 2 lets a winning short and a counter-bullish
  // setup coexist while still respecting symbol-concentration risk.
  maxPositionsPerSymbol: 2,
  maxTotalPositions: 10,

  // PRIORITY 1: Daily drawdown limit (-10%)
  maxDailyDrawdownPercent: 0.10,   // Halt trading at -10% daily loss

  // Phase 47 — was 3, raised to 6 to match TradingConfig.maxConcurrentPositions.
  // The 3-cap was the true bottleneck behind the "no new trades" appearance:
  // 3 slots fill in the first 13 minutes after startup and stay full until
  // an exit fires (which can take hours).
  maxConcurrentPositions: 6,
};

// Predefined correlation groups for crypto
const CORRELATION_GROUPS: Record<string, string[]> = {
  'BTC': ['BTC-USD', 'BTCUSDT', 'BTC/USD', 'XBTUSD'],
  'ETH': ['ETH-USD', 'ETHUSDT', 'ETH/USD', 'ETHUSD'],
  'LARGE_CAP': ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
  'DEFI': ['AAVE-USD', 'UNI-USD', 'LINK-USD', 'MKR-USD'],
  'LAYER2': ['MATIC-USD', 'ARB-USD', 'OP-USD'],
  'MEME': ['DOGE-USD', 'SHIB-USD', 'PEPE-USD'],
};

// ============================================================================
// KELLY CRITERION CALCULATOR
// ============================================================================

export class KellyCriterionCalculator {
  private config: RiskManagerConfig;
  private tradeHistory: TradeResult[] = [];

  constructor(config: RiskManagerConfig) {
    this.config = config;
  }

  /**
   * Add a trade result to history
   */
  addTradeResult(result: TradeResult): void {
    this.tradeHistory.push(result);
    
    // Keep only last 100 trades for calculation
    if (this.tradeHistory.length > 100) {
      this.tradeHistory = this.tradeHistory.slice(-100);
    }
  }

  /**
   * Calculate optimal position size using Kelly Criterion
   * 
   * Kelly Formula: f* = (bp - q) / b
   * where:
   *   f* = fraction of capital to bet
   *   b = odds (average win / average loss)
   *   p = probability of winning
   *   q = probability of losing (1 - p)
   */
  calculatePositionSize(
    availableCapital: number,
    symbol?: string
  ): PositionSizeResult {
    // Get win rate and payoff ratio from history
    const { winRate, payoffRatio } = this.calculateMetrics(symbol);
    
    // Kelly formula
    const p = winRate;
    const q = 1 - p;
    const b = payoffRatio;
    
    let rawKelly = (b * p - q) / b;
    
    // Handle edge cases
    if (rawKelly <= 0 || isNaN(rawKelly) || !isFinite(rawKelly)) {
      return {
        recommendedSize: 0,
        kellyFraction: 0,
        adjustedFraction: 0,
        maxAllowedSize: availableCapital * this.config.maxPositionSize,
        reason: `Negative Kelly (${(rawKelly * 100).toFixed(2)}%): Win rate ${(winRate * 100).toFixed(1)}% or payoff ratio ${payoffRatio.toFixed(2)} too low`,
        breakdown: {
          rawKelly: rawKelly,
          fractionalKelly: 0,
          correlationAdjustment: 1,
          circuitBreakerAdjustment: 1,
        },
      };
    }

    // Apply fractional Kelly
    const fractionalKelly = rawKelly * this.config.kellyFraction;
    
    // Cap at max position size
    const adjustedFraction = Math.min(fractionalKelly, this.config.maxPositionSize);
    
    // Calculate recommended size
    const recommendedSize = availableCapital * adjustedFraction;
    const maxAllowedSize = availableCapital * this.config.maxPositionSize;

    return {
      recommendedSize,
      kellyFraction: rawKelly,
      adjustedFraction,
      maxAllowedSize,
      reason: `Kelly: ${(rawKelly * 100).toFixed(2)}% → Fractional: ${(fractionalKelly * 100).toFixed(2)}% → Adjusted: ${(adjustedFraction * 100).toFixed(2)}%`,
      breakdown: {
        rawKelly,
        fractionalKelly,
        correlationAdjustment: 1,
        circuitBreakerAdjustment: 1,
      },
    };
  }

  /**
   * Calculate win rate and payoff ratio from trade history
   */
  private calculateMetrics(symbol?: string): { winRate: number; payoffRatio: number } {
    let relevantTrades = this.tradeHistory;
    
    if (symbol) {
      // Filter for specific symbol
      relevantTrades = this.tradeHistory.filter(t => t.symbol === symbol);
    }
    
    // Need minimum trades for reliable calculation
    if (relevantTrades.length < 10) {
      return {
        winRate: this.config.defaultWinRate,
        payoffRatio: this.config.defaultPayoffRatio,
      };
    }

    const wins = relevantTrades.filter(t => t.pnlPercent > 0);
    const losses = relevantTrades.filter(t => t.pnlPercent <= 0);
    
    const winRate = wins.length / relevantTrades.length;
    
    // Calculate average win and loss
    const avgWin = wins.length > 0 
      ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length 
      : 0;
    const avgLoss = losses.length > 0 
      ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0) / losses.length)
      : 1; // Avoid division by zero
    
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : this.config.defaultPayoffRatio;

    return { winRate, payoffRatio };
  }

  /**
   * Get trade history statistics
   */
  getStatistics(): {
    totalTrades: number;
    winRate: number;
    payoffRatio: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
  } {
    if (this.tradeHistory.length === 0) {
      return {
        totalTrades: 0,
        winRate: this.config.defaultWinRate,
        payoffRatio: this.config.defaultPayoffRatio,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
      };
    }

    const wins = this.tradeHistory.filter(t => t.pnlPercent > 0);
    const losses = this.tradeHistory.filter(t => t.pnlPercent <= 0);
    
    const avgWin = wins.length > 0 
      ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length 
      : 0;
    const avgLoss = losses.length > 0 
      ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0) / losses.length)
      : 0;
    
    const totalWins = wins.reduce((sum, t) => sum + t.pnlPercent, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    return {
      totalTrades: this.tradeHistory.length,
      winRate: wins.length / this.tradeHistory.length,
      payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
      avgWin,
      avgLoss,
      profitFactor,
    };
  }

  /**
   * Clear trade history
   */
  clearHistory(): void {
    this.tradeHistory = [];
  }
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

export class CircuitBreaker {
  private config: RiskManagerConfig;
  private consecutiveLosses: Map<string, number> = new Map();
  private globalConsecutiveLosses: number = 0;
  private cooldownUntil: Map<string, Date> = new Map();
  private globalCooldownUntil: Date | null = null;

  constructor(config: RiskManagerConfig) {
    this.config = config;
  }

  /**
   * Record a trade result
   */
  recordTrade(result: TradeResult): void {
    const { symbol, pnlPercent } = result;
    
    if (pnlPercent <= 0) {
      // Loss - increment counters
      const current = this.consecutiveLosses.get(symbol) || 0;
      this.consecutiveLosses.set(symbol, current + 1);
      this.globalConsecutiveLosses++;
      
      // Check if circuit breaker should trip
      this.checkAndTrip(symbol);
    } else {
      // Win - reset counters
      this.consecutiveLosses.set(symbol, 0);
      this.globalConsecutiveLosses = 0;
    }
  }

  /**
   * Check if circuit breaker should trip
   */
  private checkAndTrip(symbol: string): void {
    const symbolLosses = this.consecutiveLosses.get(symbol) || 0;
    
    // Symbol-specific circuit breaker
    if (symbolLosses >= this.config.maxConsecutiveLosses) {
      const cooldownUntil = new Date();
      cooldownUntil.setMinutes(cooldownUntil.getMinutes() + this.config.cooldownMinutes);
      this.cooldownUntil.set(symbol, cooldownUntil);
      console.log(`[CircuitBreaker] Symbol ${symbol} tripped: ${symbolLosses} consecutive losses. Cooldown until ${cooldownUntil.toISOString()}`);
    }
    
    // Global circuit breaker
    if (this.globalConsecutiveLosses >= this.config.maxGlobalConsecutiveLosses) {
      this.globalCooldownUntil = new Date();
      this.globalCooldownUntil.setMinutes(this.globalCooldownUntil.getMinutes() + this.config.cooldownMinutes * 2);
      console.log(`[CircuitBreaker] GLOBAL tripped: ${this.globalConsecutiveLosses} consecutive losses. Cooldown until ${this.globalCooldownUntil.toISOString()}`);
    }
  }

  /**
   * Check if trading is allowed for a symbol
   */
  checkStatus(symbol: string): CircuitBreakerStatus {
    const now = new Date();
    
    // Check global cooldown first
    if (this.globalCooldownUntil && now < this.globalCooldownUntil) {
      return {
        isTripped: true,
        consecutiveLosses: this.consecutiveLosses.get(symbol) || 0,
        globalConsecutiveLosses: this.globalConsecutiveLosses,
        cooldownUntil: this.globalCooldownUntil,
        reason: `Global circuit breaker active: ${this.globalConsecutiveLosses} consecutive losses`,
      };
    }
    
    // Check symbol-specific cooldown
    const symbolCooldown = this.cooldownUntil.get(symbol);
    if (symbolCooldown && now < symbolCooldown) {
      return {
        isTripped: true,
        consecutiveLosses: this.consecutiveLosses.get(symbol) || 0,
        globalConsecutiveLosses: this.globalConsecutiveLosses,
        cooldownUntil: symbolCooldown,
        reason: `Symbol circuit breaker active: ${this.consecutiveLosses.get(symbol)} consecutive losses`,
      };
    }
    
    // Clear expired cooldowns
    if (symbolCooldown && now >= symbolCooldown) {
      this.cooldownUntil.delete(symbol);
      this.consecutiveLosses.set(symbol, 0);
    }
    if (this.globalCooldownUntil && now >= this.globalCooldownUntil) {
      this.globalCooldownUntil = null;
      this.globalConsecutiveLosses = 0;
    }
    
    return {
      isTripped: false,
      consecutiveLosses: this.consecutiveLosses.get(symbol) || 0,
      globalConsecutiveLosses: this.globalConsecutiveLosses,
      cooldownUntil: null,
      reason: 'Trading allowed',
    };
  }

  /**
   * Manually reset circuit breaker for a symbol
   */
  reset(symbol?: string): void {
    if (symbol) {
      this.consecutiveLosses.set(symbol, 0);
      this.cooldownUntil.delete(symbol);
    } else {
      this.consecutiveLosses.clear();
      this.cooldownUntil.clear();
      this.globalConsecutiveLosses = 0;
      this.globalCooldownUntil = null;
    }
  }

  /**
   * Get all active cooldowns
   */
  getActiveCooldowns(): { symbol: string; until: Date }[] {
    const now = new Date();
    const active: { symbol: string; until: Date }[] = [];
    
    for (const [symbol, until] of this.cooldownUntil.entries()) {
      if (now < until) {
        active.push({ symbol, until });
      }
    }
    
    return active;
  }
}

// ============================================================================
// CORRELATION MANAGER
// ============================================================================

export class CorrelationManager {
  private config: RiskManagerConfig;
  private openPositions: Map<string, { size: number; direction: 'long' | 'short' }> = new Map();

  constructor(config: RiskManagerConfig) {
    this.config = config;
  }

  /**
   * Register an open position
   */
  registerPosition(symbol: string, size: number, direction: 'long' | 'short'): void {
    this.openPositions.set(symbol, { size, direction });
  }

  /**
   * Remove a closed position
   */
  removePosition(symbol: string): void {
    this.openPositions.delete(symbol);
  }

  /**
   * Check if a new position can be opened based on correlation limits
   */
  checkCorrelationLimit(
    symbol: string,
    proposedSize: number,
    portfolioValue: number
  ): CorrelationLimit {
    // Find correlation group for this symbol
    const correlatedSymbols = this.findCorrelatedSymbols(symbol);
    
    // Calculate current exposure to correlated assets
    let totalExposure = proposedSize;
    for (const correlatedSymbol of correlatedSymbols) {
      const position = this.openPositions.get(correlatedSymbol);
      if (position) {
        totalExposure += position.size;
      }
    }
    
    const exposurePercent = totalExposure / portfolioValue;
    const maxExposure = portfolioValue * this.config.maxCorrelatedExposure;
    const canOpen = exposurePercent <= this.config.maxCorrelatedExposure;

    return {
      symbol,
      correlatedSymbols,
      totalExposure,
      maxExposure,
      canOpenPosition: canOpen,
      reason: canOpen 
        ? `Correlated exposure ${(exposurePercent * 100).toFixed(1)}% within ${(this.config.maxCorrelatedExposure * 100).toFixed(0)}% limit`
        : `Correlated exposure ${(exposurePercent * 100).toFixed(1)}% exceeds ${(this.config.maxCorrelatedExposure * 100).toFixed(0)}% limit`,
    };
  }

  /**
   * Find symbols correlated with the given symbol
   */
  private findCorrelatedSymbols(symbol: string): string[] {
    const correlated: string[] = [];
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    for (const [groupName, symbols] of Object.entries(CORRELATION_GROUPS)) {
      const normalizedGroup = symbols.map(s => this.normalizeSymbol(s));
      
      if (normalizedGroup.includes(normalizedSymbol)) {
        // Add all other symbols in this group
        for (const groupSymbol of symbols) {
          const normalized = this.normalizeSymbol(groupSymbol);
          if (normalized !== normalizedSymbol && !correlated.includes(groupSymbol)) {
            correlated.push(groupSymbol);
          }
        }
      }
    }
    
    return correlated;
  }

  /**
   * Normalize symbol for comparison
   */
  private normalizeSymbol(symbol: string): string {
    return symbol.toUpperCase().replace(/[-_\/]/g, '');
  }

  /**
   * Get current exposure by correlation group
   */
  getExposureByGroup(): Map<string, { exposure: number; symbols: string[] }> {
    const exposure = new Map<string, { exposure: number; symbols: string[] }>();
    
    for (const [groupName, groupSymbols] of Object.entries(CORRELATION_GROUPS)) {
      let groupExposure = 0;
      const activeSymbols: string[] = [];
      
      for (const [symbol, position] of this.openPositions.entries()) {
        const normalized = this.normalizeSymbol(symbol);
        const normalizedGroup = groupSymbols.map(s => this.normalizeSymbol(s));
        
        if (normalizedGroup.includes(normalized)) {
          groupExposure += position.size;
          activeSymbols.push(symbol);
        }
      }
      
      if (groupExposure > 0) {
        exposure.set(groupName, { exposure: groupExposure, symbols: activeSymbols });
      }
    }
    
    return exposure;
  }

  /**
   * Clear all positions
   */
  clearPositions(): void {
    this.openPositions.clear();
  }
}

// ============================================================================
// DAILY DRAWDOWN TRACKER (Priority 1)
// ============================================================================

export interface DailyDrawdownStatus {
  isHalted: boolean;
  dailyPnL: number;
  dailyPnLPercent: number;
  maxDrawdownPercent: number;
  startOfDayEquity: number;
  currentEquity: number;
  tradingDate: string;
  reason: string;
}

export class DailyDrawdownTracker {
  private config: RiskManagerConfig;
  private startOfDayEquity: number = 0;
  private currentEquity: number = 0;
  private dailyPnL: number = 0;
  private tradingDate: string = '';
  private isHalted: boolean = false;

  constructor(config: RiskManagerConfig) {
    this.config = config;
    this.resetForNewDay();
  }

  resetForNewDay(startingEquity?: number): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.tradingDate !== today) {
      this.tradingDate = today;
      this.startOfDayEquity = startingEquity || this.currentEquity || 10000;
      this.currentEquity = this.startOfDayEquity;
      this.dailyPnL = 0;
      this.isHalted = false;
      console.log(`[DailyDrawdownTracker] New trading day: ${today}, Starting equity: $${this.startOfDayEquity.toFixed(2)}`);
    }
  }

  updateEquity(newEquity: number): DailyDrawdownStatus {
    const today = new Date().toISOString().split('T')[0];
    if (this.tradingDate !== today) {
      this.resetForNewDay(newEquity);
    }
    this.currentEquity = newEquity;
    this.dailyPnL = newEquity - this.startOfDayEquity;
    const dailyPnLPercent = this.startOfDayEquity > 0 ? this.dailyPnL / this.startOfDayEquity : 0;
    if (dailyPnLPercent <= -this.config.maxDailyDrawdownPercent && !this.isHalted) {
      this.isHalted = true;
      console.log(`[DailyDrawdownTracker] DAILY DRAWDOWN LIMIT HIT: ${(dailyPnLPercent * 100).toFixed(2)}%`);
    }
    return this.getStatus();
  }

  recordTradePnL(pnl: number): DailyDrawdownStatus {
    this.dailyPnL += pnl;
    this.currentEquity = this.startOfDayEquity + this.dailyPnL;
    const dailyPnLPercent = this.startOfDayEquity > 0 ? this.dailyPnL / this.startOfDayEquity : 0;
    if (dailyPnLPercent <= -this.config.maxDailyDrawdownPercent && !this.isHalted) {
      this.isHalted = true;
      console.log(`[DailyDrawdownTracker] DAILY DRAWDOWN LIMIT HIT: ${(dailyPnLPercent * 100).toFixed(2)}%`);
    }
    return this.getStatus();
  }

  isTradingHalted(): boolean {
    const today = new Date().toISOString().split('T')[0];
    if (this.tradingDate !== today) {
      this.resetForNewDay();
    }
    return this.isHalted;
  }

  getStatus(): DailyDrawdownStatus {
    const dailyPnLPercent = this.startOfDayEquity > 0 ? this.dailyPnL / this.startOfDayEquity : 0;
    return {
      isHalted: this.isHalted,
      dailyPnL: this.dailyPnL,
      dailyPnLPercent,
      maxDrawdownPercent: this.config.maxDailyDrawdownPercent,
      startOfDayEquity: this.startOfDayEquity,
      currentEquity: this.currentEquity,
      tradingDate: this.tradingDate,
      reason: this.isHalted ? `Daily drawdown limit (-${(this.config.maxDailyDrawdownPercent * 100).toFixed(0)}%) exceeded` : `Daily P&L: ${(dailyPnLPercent * 100).toFixed(2)}%`,
    };
  }

  forceReset(startingEquity: number): void {
    this.tradingDate = '';
    this.resetForNewDay(startingEquity);
  }
}

// ============================================================================
// POSITION LIMIT TRACKER (Priority 1)
// ============================================================================

export interface PositionLimitStatus {
  canOpenPosition: boolean;
  currentPositions: number;
  maxPositions: number;
  openSymbols: string[];
  reason: string;
  isFlip?: boolean;           // True when this is a direction flip (close existing + open opposite)
  existingDirection?: 'long' | 'short';  // Direction of the existing position being flipped
}

export class PositionLimitTracker {
  private config: RiskManagerConfig;
  private openPositions: Map<string, { size: number; direction: 'long' | 'short'; openTime: number }> = new Map();

  constructor(config: RiskManagerConfig) {
    this.config = config;
  }

  /**
   * Check if a new position can be opened for the given symbol.
   * Supports direction-aware flips: if an existing position is in the OPPOSITE
   * direction of the incoming signal, allow the trade (the executor will close
   * the old position first, then open the new one).
   *
   * @param symbol - Trading pair (e.g., 'ETH-USD')
   * @param incomingDirection - Direction of the new signal ('long' for buy, 'short' for sell)
   */
  canOpenPosition(symbol: string, incomingDirection?: 'long' | 'short'): PositionLimitStatus {
    const currentCount = this.openPositions.size;
    const maxPositions = this.config.maxConcurrentPositions;
    const openSymbols = Array.from(this.openPositions.keys());

    if (this.openPositions.has(symbol)) {
      const existing = this.openPositions.get(symbol)!;

      // Phase 20 FIX: Allow position FLIP when consensus direction reverses.
      // E.g., existing LONG + incoming SELL → close long, then open short.
      if (incomingDirection && existing.direction !== incomingDirection) {
        console.log(`[PositionLimitTracker] Position FLIP detected: ${symbol} ${existing.direction} → ${incomingDirection}`);
        return {
          canOpenPosition: true,
          currentPositions: currentCount,
          maxPositions,
          openSymbols,
          reason: `Position flip: ${existing.direction} → ${incomingDirection}`,
          isFlip: true,
          existingDirection: existing.direction,
        };
      }

      // Same direction — block duplicate
      return { canOpenPosition: false, currentPositions: currentCount, maxPositions, openSymbols, reason: `Already have open position in ${symbol}` };
    }
    if (currentCount >= maxPositions) {
      return { canOpenPosition: false, currentPositions: currentCount, maxPositions, openSymbols, reason: `Max concurrent positions (${maxPositions}) reached` };
    }
    return { canOpenPosition: true, currentPositions: currentCount, maxPositions, openSymbols, reason: `Can open position (${currentCount}/${maxPositions} positions)` };
  }

  registerPosition(symbol: string, size: number, direction: 'long' | 'short'): void {
    this.openPositions.set(symbol, { size, direction, openTime: Date.now() });
    console.log(`[PositionLimitTracker] Position opened: ${symbol} (${this.openPositions.size}/${this.config.maxConcurrentPositions})`);
  }

  removePosition(symbol: string): void {
    if (this.openPositions.has(symbol)) {
      this.openPositions.delete(symbol);
      console.log(`[PositionLimitTracker] Position closed: ${symbol} (${this.openPositions.size}/${this.config.maxConcurrentPositions})`);
    }
  }

  /** Phase 45: Get position info including openTime for hold time calculation */
  getPositionInfo(symbol: string): { size: number; direction: 'long' | 'short'; openTime: number } | undefined {
    return this.openPositions.get(symbol);
  }

  getStatus(): PositionLimitStatus {
    const currentCount = this.openPositions.size;
    const maxPositions = this.config.maxConcurrentPositions;
    const openSymbols = Array.from(this.openPositions.keys());
    return {
      canOpenPosition: currentCount < maxPositions,
      currentPositions: currentCount,
      maxPositions,
      openSymbols,
      reason: currentCount < maxPositions ? `${currentCount}/${maxPositions} positions open` : `Max positions (${maxPositions}) reached`,
    };
  }

  getOpenPositions(): Map<string, { size: number; direction: 'long' | 'short'; openTime: number }> {
    return new Map(this.openPositions);
  }

  clearPositions(): void {
    this.openPositions.clear();
    console.log('[PositionLimitTracker] All positions cleared');
  }

  /**
   * Phase 72 — Re-sync the in-memory tracker from authoritative DB state.
   *
   * The tracker is a separate state machine from `paperPositions` and
   * `RealTradingEngine.positions`. When any close path bypasses the
   * canonical flow (Phase 54.2 directDbClose, Phase 64 markDbClosedDirectly,
   * the May 7 manual cleanup, an admin script, etc.) the tracker rots —
   * keeps a "ghost" entry for a symbol whose DB row is closed, then blocks
   * every fresh signal for that symbol with "Already have open position".
   *
   * Symptom on 2026-05-11: 113 of 307 FAILED decisions in 1h were ghost
   * blocks for ETH-USD and SOL-USD even though the DB only had BTC-USD
   * open. This method makes the tracker reconcile-able: call it before
   * canOpenPosition (or on a periodic schedule) and stale ghosts are
   * dropped, missing entries from DB are re-registered.
   *
   * Returns the count of corrections applied so callers can log audit.
   */
  async syncFromDb(userId: number): Promise<{ added: string[]; removed: string[] }> {
    try {
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return { added: [], removed: [] };

      const dbRows = await db
        .select()
        .from(paperPositions)
        .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')));
      const dbSymbols = new Set(dbRows.map((r: any) => r.symbol as string));

      const added: string[] = [];
      const removed: string[] = [];

      // Drop tracker entries that DB says are closed.
      for (const sym of Array.from(this.openPositions.keys())) {
        if (!dbSymbols.has(sym)) {
          this.openPositions.delete(sym);
          removed.push(sym);
        }
      }

      // Add tracker entries for DB-open positions the tracker missed.
      for (const r of dbRows) {
        const sym = r.symbol as string;
        if (!this.openPositions.has(sym)) {
          const size = parseFloat(r.entryPrice ?? '0') * parseFloat(r.quantity ?? '0');
          this.openPositions.set(sym, {
            size,
            direction: (r.side === 'short' ? 'short' : 'long'),
            openTime: r.entryTime ? new Date(r.entryTime).getTime() : Date.now(),
          });
          added.push(sym);
        }
      }

      if (added.length > 0 || removed.length > 0) {
        console.log(`[PositionLimitTracker] syncFromDb: +${added.join(',') || 'none'} -${removed.join(',') || 'none'} (now tracking ${this.openPositions.size})`);
      }
      return { added, removed };
    } catch (e) {
      console.warn('[PositionLimitTracker] syncFromDb failed:', (e as Error)?.message);
      return { added: [], removed: [] };
    }
  }
}

// ============================================================================
// MAIN RISK MANAGER
// ============================================================================

export class Week9RiskManager extends EventEmitter {
  private config: RiskManagerConfig;
  private kellyCalculator: KellyCriterionCalculator;
  private circuitBreaker: CircuitBreaker;
  private correlationManager: CorrelationManager;
  private dailyDrawdownTracker: DailyDrawdownTracker;
  // Phase 72 — exposed (was private) so EnhancedTradeExecutor can call
  // syncFromDb on a periodic interval to drop ghost entries left behind
  // by non-canonical close paths.
  public readonly positionLimitTracker: PositionLimitTracker;

  constructor(config?: Partial<RiskManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.kellyCalculator = new KellyCriterionCalculator(this.config);
    this.circuitBreaker = new CircuitBreaker(this.config);
    this.correlationManager = new CorrelationManager(this.config);
    this.dailyDrawdownTracker = new DailyDrawdownTracker(this.config);
    this.positionLimitTracker = new PositionLimitTracker(this.config);
    
    console.log('[Week9RiskManager] Initialized with config:', {
      kellyFraction: this.config.kellyFraction,
      maxConsecutiveLosses: this.config.maxConsecutiveLosses,
      maxCorrelatedExposure: this.config.maxCorrelatedExposure,
      maxDailyDrawdownPercent: this.config.maxDailyDrawdownPercent,
      maxConcurrentPositions: this.config.maxConcurrentPositions,
    });
  }

  /**
   * Calculate position size with all risk checks.
   * @param incomingDirection - Direction of the incoming signal ('long' for buy, 'short' for sell).
   *   Used to detect position flips (e.g., existing LONG + incoming SHORT).
   */
  calculatePositionSize(
    symbol: string,
    availableCapital: number,
    portfolioValue: number,
    confidence?: number,
    incomingDirection?: 'long' | 'short'
  ): {
    canTrade: boolean;
    positionSize: number;
    kellyResult: PositionSizeResult;
    circuitBreakerStatus: CircuitBreakerStatus;
    correlationLimit: CorrelationLimit;
    dailyDrawdownStatus: DailyDrawdownStatus;
    positionLimitStatus: PositionLimitStatus;
    reasons: string[];
  } {
    const reasons: string[] = [];
    const dailyDrawdownStatus = this.dailyDrawdownTracker.getStatus();
    const positionLimitStatus = this.positionLimitTracker.canOpenPosition(symbol, incomingDirection);
    
    // Step 0a: Check daily drawdown limit (PRIORITY 1)
    if (dailyDrawdownStatus.isHalted) {
      reasons.push(`Daily drawdown: ${dailyDrawdownStatus.reason}`);
      this.emit('daily_drawdown_halt', dailyDrawdownStatus);
      return {
        canTrade: false,
        positionSize: 0,
        kellyResult: this.createEmptyKellyResult(availableCapital),
        circuitBreakerStatus: this.circuitBreaker.checkStatus(symbol),
        correlationLimit: this.createEmptyCorrelationLimit(symbol),
        dailyDrawdownStatus,
        positionLimitStatus,
        reasons,
      };
    }
    
    // Step 0b: Check max position limit (PRIORITY 1)
    if (!positionLimitStatus.canOpenPosition) {
      reasons.push(`Position limit: ${positionLimitStatus.reason}`);
      this.emit('position_limit_reached', positionLimitStatus);
      return {
        canTrade: false,
        positionSize: 0,
        kellyResult: this.createEmptyKellyResult(availableCapital),
        circuitBreakerStatus: this.circuitBreaker.checkStatus(symbol),
        correlationLimit: this.createEmptyCorrelationLimit(symbol),
        dailyDrawdownStatus,
        positionLimitStatus,
        reasons,
      };
    }
    
    // Step 1: Check circuit breaker
    const circuitBreakerStatus = this.circuitBreaker.checkStatus(symbol);
    if (circuitBreakerStatus.isTripped) {
      reasons.push(`Circuit breaker: ${circuitBreakerStatus.reason}`);
      return {
        canTrade: false,
        positionSize: 0,
        kellyResult: this.createEmptyKellyResult(availableCapital),
        circuitBreakerStatus,
        correlationLimit: this.createEmptyCorrelationLimit(symbol),
        dailyDrawdownStatus,
        positionLimitStatus,
        reasons,
      };
    }
    
    // Step 2: Calculate Kelly position size
    const kellyResult = this.kellyCalculator.calculatePositionSize(availableCapital, symbol);
    
    if (kellyResult.recommendedSize <= 0) {
      reasons.push(`Kelly: ${kellyResult.reason}`);
      return {
        canTrade: false,
        positionSize: 0,
        kellyResult,
        circuitBreakerStatus,
        correlationLimit: this.createEmptyCorrelationLimit(symbol),
        dailyDrawdownStatus,
        positionLimitStatus,
        reasons,
      };
    }
    
    // Step 3: Check correlation limits
    const correlationLimit = this.correlationManager.checkCorrelationLimit(
      symbol,
      kellyResult.recommendedSize,
      portfolioValue
    );
    
    if (!correlationLimit.canOpenPosition) {
      reasons.push(`Correlation: ${correlationLimit.reason}`);
      return {
        canTrade: false,
        positionSize: 0,
        kellyResult,
        circuitBreakerStatus,
        correlationLimit,
        dailyDrawdownStatus,
        positionLimitStatus,
        reasons,
      };
    }
    
    // Step 4: Apply confidence adjustment if provided
    let finalSize = kellyResult.recommendedSize;
    if (confidence !== undefined) {
      // Scale position by confidence (0.5x at 50% confidence, 1x at 100%)
      const confidenceMultiplier = 0.5 + (confidence * 0.5);
      finalSize = kellyResult.recommendedSize * confidenceMultiplier;
      reasons.push(`Confidence adjustment: ${(confidence * 100).toFixed(1)}% → ${(confidenceMultiplier * 100).toFixed(0)}% multiplier`);
    }
    
    reasons.push(`Position size: $${finalSize.toFixed(2)} (${((finalSize / availableCapital) * 100).toFixed(1)}% of available)`);
    
    return {
      canTrade: true,
      positionSize: finalSize,
      kellyResult,
      circuitBreakerStatus,
      correlationLimit,
      dailyDrawdownStatus,
      positionLimitStatus,
      reasons,
    };
  }

  /**
   * Record a completed trade
   */
  recordTrade(result: TradeResult): void {
    this.kellyCalculator.addTradeResult(result);
    this.circuitBreaker.recordTrade(result);
    
    // Update daily drawdown tracker with P&L
    this.dailyDrawdownTracker.recordTradePnL(result.pnlAbsolute);
    
    // Update position limit tracker
    this.positionLimitTracker.removePosition(result.symbol);
    
    // Update correlation manager
    if (result.pnlPercent !== 0) {
      this.correlationManager.removePosition(result.symbol);
    }
    
    this.emit('trade_recorded', result);
  }

  /**
   * Register an open position for correlation tracking
   */
  registerPosition(symbol: string, size: number, direction: 'long' | 'short'): void {
    this.correlationManager.registerPosition(symbol, size, direction);
    this.positionLimitTracker.registerPosition(symbol, size, direction);
    this.emit('position_registered', { symbol, size, direction });
  }

  /**
   * Remove a closed position from correlation tracking
   */
  removePosition(symbol: string): void {
    this.correlationManager.removePosition(symbol);
    this.positionLimitTracker.removePosition(symbol);
    this.emit('position_removed', { symbol });
  }

  /**
   * Update equity for daily drawdown tracking
   */
  updateEquity(equity: number): DailyDrawdownStatus {
    return this.dailyDrawdownTracker.updateEquity(equity);
  }

  /**
   * Get daily drawdown status
   */
  getDailyDrawdownStatus(): DailyDrawdownStatus {
    return this.dailyDrawdownTracker.getStatus();
  }

  /**
   * Get position limit status
   */
  getPositionLimitStatus(): PositionLimitStatus {
    return this.positionLimitTracker.getStatus();
  }

  /** Phase 45: Get position info including openTime for hold time calculation */
  getPositionInfo(symbol: string): { size: number; direction: 'long' | 'short'; openTime: number } | undefined {
    return this.positionLimitTracker.getPositionInfo(symbol);
  }

  /**
   * Check if trading is halted due to daily drawdown
   */
  isTradingHalted(): boolean {
    return this.dailyDrawdownTracker.isTradingHalted();
  }

  /**
   * Get comprehensive risk status
   */
  getRiskStatus(): {
    kellyStats: ReturnType<KellyCriterionCalculator['getStatistics']>;
    activeCooldowns: { symbol: string; until: Date }[];
    correlationExposure: Map<string, { exposure: number; symbols: string[] }>;
    dailyDrawdown: DailyDrawdownStatus;
    positionLimit: PositionLimitStatus;
    config: RiskManagerConfig;
  } {
    return {
      kellyStats: this.kellyCalculator.getStatistics(),
      activeCooldowns: this.circuitBreaker.getActiveCooldowns(),
      correlationExposure: this.correlationManager.getExposureByGroup(),
      dailyDrawdown: this.dailyDrawdownTracker.getStatus(),
      positionLimit: this.positionLimitTracker.getStatus(),
      config: this.config,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[Week9RiskManager] Config updated:', config);
  }

  /**
   * Get configuration
   */
  getConfig(): RiskManagerConfig {
    return { ...this.config };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.kellyCalculator.clearHistory();
    this.circuitBreaker.reset();
    this.correlationManager.clearPositions();
    this.dailyDrawdownTracker.forceReset(10000);
    this.positionLimitTracker.clearPositions();
    console.log('[Week9RiskManager] All state reset');
  }

  /**
   * Create empty Kelly result for error cases
   */
  private createEmptyKellyResult(availableCapital: number): PositionSizeResult {
    return {
      recommendedSize: 0,
      kellyFraction: 0,
      adjustedFraction: 0,
      maxAllowedSize: availableCapital * this.config.maxPositionSize,
      reason: 'Risk check failed',
      breakdown: {
        rawKelly: 0,
        fractionalKelly: 0,
        correlationAdjustment: 1,
        circuitBreakerAdjustment: 0,
      },
    };
  }

  /**
   * Create empty correlation limit for error cases
   */
  private createEmptyCorrelationLimit(symbol: string): CorrelationLimit {
    return {
      symbol,
      correlatedSymbols: [],
      totalExposure: 0,
      maxExposure: 0,
      canOpenPosition: false,
      reason: 'Risk check failed',
    };
  }
}

export default Week9RiskManager;
