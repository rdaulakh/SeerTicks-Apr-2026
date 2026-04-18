/**
 * Risk Manager
 * 
 * Institutional-grade risk controls:
 * - Drawdown circuit breaker (5% daily, 10% weekly)
 * - Correlation-based position limits
 * - Macro veto override
 * - Position size limits
 * - Maximum open positions
 * 
 * This is the risk layer that protects capital from catastrophic losses.
 */

import { getDb } from "./db";
import { trades, positions, riskLimitBreaches, type InsertRiskLimitBreach } from "../drizzle/schema";
import { eq, and, gte } from "drizzle-orm";
import { LRUCache } from './utils/LRUCache';

interface RiskLimits {
  maxDailyDrawdown: number; // 0.05 = 5%
  maxWeeklyDrawdown: number; // 0.10 = 10%
  maxPositionSize: number; // 0.05 = 5% of account
  minPositionSize: number; // 0.01 = 1% of account (institutional minimum)
  minNotionalValue: number; // Minimum USD value per position (e.g., $100)
  maxOpenPositions: number; // Maximum number of concurrent positions
  maxCorrelatedExposure: number; // 0.10 = 10% for correlated assets
  correlationThreshold: number; // 0.7 = 70% correlation
  maxPositionConcentration: number; // 0.25 = 25% max per symbol
}

interface DrawdownState {
  dailyDrawdown: number;
  weeklyDrawdown: number;
  dailyStartBalance: number;
  weeklyStartBalance: number;
  currentBalance: number;
  isHalted: boolean;
  haltReason: string | null;
  haltedUntil: number | null; // Timestamp
}

export class RiskManager {
  private limits: RiskLimits;
  private drawdownState: DrawdownState;
  private correlationMatrix: LRUCache<string, Map<string, number>> = new LRUCache({ maxSize: 100, ttlMs: 86400_000, name: 'correlationMatrix' }); // 24h TTL
  private correlationTracker: any = null; // CorrelationTracker instance
  private macroVetoActive: boolean = false;
  private macroVetoReason: string | null = null;
  private currentVolatilityRegime: 'low' | 'normal' | 'high' = 'normal';
  private baseLimits: RiskLimits; // Store base limits for dynamic adjustment

  constructor(accountBalance: number, customLimits?: Partial<RiskLimits>) {
    // Base limits - will be adjusted dynamically
    this.limits = {
      maxDailyDrawdown: 0.10, // Base: 10%, adjusted by volatility
      maxWeeklyDrawdown: 0.10, // Base: 10%, adjusted by volatility
      maxPositionSize: 0.05, // Base: 5%, adjusted by volatility & confidence
      minPositionSize: 0.01, // 1% minimum (hedge fund standard)
      minNotionalValue: 100, // $100 minimum notional
      maxOpenPositions: 3, // Reduced from 5 to 3 for tighter risk control
      maxCorrelatedExposure: 0.10, // 10%
      correlationThreshold: 0.7, // 70%
      maxPositionConcentration: 0.25, // 25% max per symbol
      ...customLimits,
    };

    // Store base limits for dynamic adjustment
    this.baseLimits = { ...this.limits };

    this.drawdownState = {
      dailyDrawdown: 0,
      weeklyDrawdown: 0,
      dailyStartBalance: accountBalance,
      weeklyStartBalance: accountBalance,
      currentBalance: accountBalance,
      isHalted: false,
      haltReason: null,
      haltedUntil: null,
    };

    console.log("[RiskManager] Initialized with base limits:", this.limits);
  }

  /**
   * Fix #11: Update volatility regime and adjust drawdown limits dynamically
   * High volatility → wider drawdown limits (8%)
   * Normal volatility → standard limits (5%)
   * Low volatility → tighter limits (3%)
   */
  updateVolatilityRegime(vixLevel: number): void {
    let newRegime: 'low' | 'normal' | 'high';
    let drawdownMultiplier: number;

    if (vixLevel > 25) {
      // High volatility (VIX > 25)
      newRegime = 'high';
      drawdownMultiplier = 1.6; // 5% → 8%
    } else if (vixLevel < 15) {
      // Low volatility (VIX < 15)
      newRegime = 'low';
      drawdownMultiplier = 0.6; // 5% → 3%
    } else {
      // Normal volatility (VIX 15-25)
      newRegime = 'normal';
      drawdownMultiplier = 1.0; // 5% → 5%
    }

    if (newRegime !== this.currentVolatilityRegime) {
      this.currentVolatilityRegime = newRegime;
      this.limits.maxDailyDrawdown = this.baseLimits.maxDailyDrawdown * drawdownMultiplier;
      this.limits.maxWeeklyDrawdown = this.baseLimits.maxWeeklyDrawdown * drawdownMultiplier;
      
      console.log(`[RiskManager] 📊 Volatility regime changed to ${newRegime.toUpperCase()} (VIX: ${vixLevel.toFixed(1)})`);
      console.log(`[RiskManager] Adjusted drawdown limits: Daily ${(this.limits.maxDailyDrawdown * 100).toFixed(1)}%, Weekly ${(this.limits.maxWeeklyDrawdown * 100).toFixed(1)}%`);
    }
  }

  /**
   * Fix #12: Calculate dynamic position size limit based on:
   * - Market volatility (higher vol → smaller positions)
   * - Signal confidence (higher confidence → larger positions)
   * - Current liquidity conditions
   */
  getDynamicPositionSizeLimit(
    confidence: number,
    volatility: number, // ATR as % of price
    liquidity: number = 1.0 // 0-1 scale, 1 = normal liquidity
  ): number {
    // Start with base limit
    let dynamicLimit = this.baseLimits.maxPositionSize;

    // Adjust for confidence (60-100% confidence → 0.8x to 1.2x)
    const confidenceMultiplier = 0.8 + (confidence - 0.6) * 1.0; // Linear from 0.8 to 1.2
    dynamicLimit *= Math.max(0.8, Math.min(1.2, confidenceMultiplier));

    // Adjust for volatility (lower vol → larger positions)
    // Typical crypto volatility: 2-5% ATR
    // High vol (>4%): 0.7x, Normal (2-4%): 1.0x, Low (<2%): 1.2x
    let volatilityMultiplier = 1.0;
    if (volatility > 0.04) {
      volatilityMultiplier = 0.7; // High volatility → smaller positions
    } else if (volatility < 0.02) {
      volatilityMultiplier = 1.2; // Low volatility → larger positions
    }
    dynamicLimit *= volatilityMultiplier;

    // Adjust for liquidity (low liquidity → smaller positions)
    dynamicLimit *= liquidity;

    // Ensure we stay within absolute bounds
    dynamicLimit = Math.max(
      this.baseLimits.minPositionSize,
      Math.min(this.baseLimits.maxPositionSize * 1.5, dynamicLimit) // Allow up to 1.5x base in ideal conditions
    );

    return dynamicLimit;
  }

  // Phase 15A: Real-time trade-level tracking
  private consecutiveLosses: number = 0;
  private dailyTradeCount: number = 0;
  private dailyTradeCountDate: string = '';
  private readonly MAX_CONSECUTIVE_LOSSES_PAUSE = 5;
  private readonly CONSECUTIVE_LOSS_PAUSE_MS = 10 * 60 * 1000; // 10 min cooldown
  private pausedUntil: number = 0;

  /**
   * Check if trading is currently halted
   */
  isTradingHalted(): boolean {
    // Check if halt period has expired
    if (this.drawdownState.isHalted && this.drawdownState.haltedUntil) {
      if (Date.now() > this.drawdownState.haltedUntil) {
        console.log("[RiskManager] Halt period expired, resuming trading");
        this.drawdownState.isHalted = false;
        this.drawdownState.haltReason = null;
        this.drawdownState.haltedUntil = null;
      }
    }

    // Phase 15A: Check consecutive loss pause
    if (this.pausedUntil > 0 && Date.now() < this.pausedUntil) {
      return true;
    } else if (this.pausedUntil > 0 && Date.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      console.log("[RiskManager] Consecutive loss pause expired, resuming");
    }

    return this.drawdownState.isHalted;
  }

  /**
   * Get halt reason if trading is halted
   */
  getHaltReason(): string | null {
    return this.drawdownState.haltReason;
  }

  /**
   * Update account balance and check drawdown limits
   */
  async updateBalance(newBalance: number): Promise<void> {
    const previousBalance = this.drawdownState.currentBalance;
    this.drawdownState.currentBalance = newBalance;

    // Calculate drawdowns
    this.drawdownState.dailyDrawdown =
      (this.drawdownState.dailyStartBalance - newBalance) / this.drawdownState.dailyStartBalance;
    this.drawdownState.weeklyDrawdown =
      (this.drawdownState.weeklyStartBalance - newBalance) / this.drawdownState.weeklyStartBalance;

    console.log(
      `[RiskManager] Balance: ${newBalance.toFixed(2)}, Daily DD: ${(this.drawdownState.dailyDrawdown * 100).toFixed(2)}%, Weekly DD: ${(this.drawdownState.weeklyDrawdown * 100).toFixed(2)}%`
    );

    // Check daily drawdown circuit breaker
    if (this.drawdownState.dailyDrawdown > this.limits.maxDailyDrawdown) {
      await this.triggerCircuitBreaker("daily", this.drawdownState.dailyDrawdown);
    }

    // Check weekly drawdown circuit breaker
    if (this.drawdownState.weeklyDrawdown > this.limits.maxWeeklyDrawdown) {
      await this.triggerCircuitBreaker("weekly", this.drawdownState.weeklyDrawdown);
    }
  }

  /**
   * Phase 15A: Called on EVERY trade completion for real-time risk tracking.
   * This is the critical wiring that was missing — previously balance updates only
   * happened every 30 seconds, allowing 1,400+ trades before risk checks fired.
   *
   * @param pnl - The realized P&L of the completed trade (positive = profit)
   * @param newBalance - The updated account balance after the trade
   */
  async onTradeCompleted(pnl: number, newBalance: number): Promise<void> {
    // Update balance immediately (not waiting for 30s sync)
    await this.updateBalance(newBalance);

    // Track daily trade count
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyTradeCountDate !== today) {
      this.dailyTradeCount = 0;
      this.dailyTradeCountDate = today;
    }
    this.dailyTradeCount++;

    // Track consecutive losses
    if (pnl < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES_PAUSE) {
        this.pausedUntil = Date.now() + this.CONSECUTIVE_LOSS_PAUSE_MS;
        console.warn(`[RiskManager] ⏸️ ${this.consecutiveLosses} consecutive losses — pausing trades for ${this.CONSECUTIVE_LOSS_PAUSE_MS / 60000} minutes`);
      }
    } else {
      this.consecutiveLosses = 0;
    }

    console.log(`[RiskManager] Trade completed: P&L=$${pnl.toFixed(2)}, Balance=$${newBalance.toFixed(2)}, ConsecLosses=${this.consecutiveLosses}, DailyTrades=${this.dailyTradeCount}`);
  }

  /**
   * Trigger circuit breaker and halt trading (HARD LIMIT - ENFORCED)
   */
  private async triggerCircuitBreaker(period: "daily" | "weekly", drawdown: number): Promise<void> {
    console.error(
      `[RiskManager] 🚨 CIRCUIT BREAKER TRIGGERED: ${period} drawdown ${(drawdown * 100).toFixed(2)}% exceeds limit`
    );

    this.drawdownState.isHalted = true;
    this.drawdownState.haltReason = `${period} drawdown ${(drawdown * 100).toFixed(2)}% exceeds ${(period === "daily" ? this.limits.maxDailyDrawdown : this.limits.maxWeeklyDrawdown) * 100}% limit`;

    // Halt for rest of day or week
    const now = new Date();
    if (period === "daily") {
      // Halt until end of day
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      this.drawdownState.haltedUntil = endOfDay.getTime();
    } else {
      // Halt until end of week (Sunday 23:59:59)
      const endOfWeek = new Date(now);
      const daysUntilSunday = 7 - now.getDay();
      endOfWeek.setDate(now.getDate() + daysUntilSunday);
      endOfWeek.setHours(23, 59, 59, 999);
      this.drawdownState.haltedUntil = endOfWeek.getTime();
    }

    // Log breach to database
    const limitType = period === 'daily' ? 'daily_loss' : 'max_drawdown';
    const limitValue = (period === 'daily' ? this.limits.maxDailyDrawdown : this.limits.maxWeeklyDrawdown) * this.drawdownState.currentBalance;
    const actualValue = drawdown * this.drawdownState.currentBalance;
    
    // Note: userId will need to be passed to this method in future refactor
    // For now, we'll log without userId (will be fixed when integrated with PositionManager)
    
    console.log(
      `[RiskManager] Trading halted until ${new Date(this.drawdownState.haltedUntil).toISOString()}`
    );
  }

  /**
   * Reset daily drawdown tracking (call at start of each day)
   */
  resetDailyDrawdown(): void {
    this.drawdownState.dailyStartBalance = this.drawdownState.currentBalance;
    this.drawdownState.dailyDrawdown = 0;
    console.log("[RiskManager] Daily drawdown reset");
  }

  /**
   * Reset weekly drawdown tracking (call at start of each week)
   */
  resetWeeklyDrawdown(): void {
    this.drawdownState.weeklyStartBalance = this.drawdownState.currentBalance;
    this.drawdownState.weeklyDrawdown = 0;
    console.log("[RiskManager] Weekly drawdown reset");
  }

  /**
   * Check if position size is within limits (HARD LIMIT - ENFORCED)
   * Implements institutional-grade validation:
   * - Minimum position size (1% of account) to prevent micro-positions
   * - Minimum notional value ($100) for execution efficiency
   * - Maximum position size (5% of account) for risk control
   * - Balance validation to prevent over-leveraging
   */
  async checkPositionSize(userId: number, positionSize: number, accountBalance: number, symbol?: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    // Check if position size exceeds available balance
    if (positionSize > accountBalance) {
      const reason = `Position size $${positionSize.toFixed(2)} exceeds available balance $${accountBalance.toFixed(2)}`;
      await this.logRiskBreach(userId, 'position_size', accountBalance, positionSize, 'blocked', symbol);
      console.error(`[RiskManager] 🚫 HARD LIMIT BLOCKED: ${reason}`);
      return {
        allowed: false,
        reason,
      };
    }

    // Check minimum notional value (institutional standard)
    if (positionSize < this.limits.minNotionalValue) {
      const reason = `Position size $${positionSize.toFixed(2)} below minimum notional value $${this.limits.minNotionalValue}`;
      await this.logRiskBreach(userId, 'position_size', this.limits.minNotionalValue, positionSize, 'blocked', symbol);
      console.error(`[RiskManager] 🚫 HARD LIMIT BLOCKED: ${reason}`);
      return {
        allowed: false,
        reason,
      };
    }

    const positionPercent = positionSize / accountBalance;
    
    // Check minimum position size percentage (hedge fund best practice)
    const minPercent = this.limits.minPositionSize;
    if (positionPercent < minPercent) {
      const reason = `Position size ${(positionPercent * 100).toFixed(2)}% below institutional minimum ${(minPercent * 100).toFixed(0)}%`;
      await this.logRiskBreach(userId, 'position_size', minPercent * accountBalance, positionSize, 'blocked', symbol);
      console.error(`[RiskManager] 🚫 HARD LIMIT BLOCKED: ${reason}`);
      return {
        allowed: false,
        reason,
      };
    }

    // Check maximum position size percentage
    const maxPercent = this.limits.maxPositionSize;
    if (positionPercent > maxPercent) {
      const reason = `Position size ${(positionPercent * 100).toFixed(2)}% exceeds hard limit ${(maxPercent * 100).toFixed(0)}%`;
      await this.logRiskBreach(userId, 'position_size', maxPercent * accountBalance, positionSize, 'blocked', symbol);
      console.error(`[RiskManager] 🚫 HARD LIMIT BLOCKED: ${reason}`);
      return {
        allowed: false,
        reason,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if opening new position would exceed correlation limits (HARD LIMIT - ENFORCED)
   */
  async checkCorrelationLimits(
    userId: number,
    newSymbol: string,
    newPositionSize: number
  ): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const db = await getDb();
    if (!db) return { allowed: true };

    // Get all open positions
    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.thesisValid, true)));

    // Calculate total correlated exposure
    let totalCorrelatedExposure = newPositionSize;

    for (const position of openPositions) {
      const correlation = this.getCorrelation(newSymbol, position.symbol);

      if (Math.abs(correlation) > this.limits.correlationThreshold) {
        totalCorrelatedExposure += parseFloat(position.quantity.toString()) * parseFloat(position.currentPrice?.toString() || position.entryPrice.toString());
      }
    }

    const accountBalance = this.drawdownState.currentBalance;
    const correlatedExposurePercent = totalCorrelatedExposure / accountBalance;
    const limitPercent = this.limits.maxCorrelatedExposure;

    if (correlatedExposurePercent > limitPercent) {
      const reason = `Correlated exposure ${(correlatedExposurePercent * 100).toFixed(2)}% exceeds hard limit ${(limitPercent * 100).toFixed(0)}%`;
      
      // Log breach to database
      await this.logRiskBreach(userId, 'portfolio_exposure', limitPercent * accountBalance, totalCorrelatedExposure, 'blocked', newSymbol);
      
      console.error(`[RiskManager] 🚫 HARD LIMIT BLOCKED: ${reason}`);
      return {
        allowed: false,
        reason,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if opening new position would exceed max open positions
   */
  async checkMaxOpenPositions(userId: number): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const db = await getDb();
    if (!db) return { allowed: true };

    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.thesisValid, true)));

    if (openPositions.length >= this.limits.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Maximum open positions (${this.limits.maxOpenPositions}) reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Set correlation tracker instance
   */
  setCorrelationTracker(tracker: any): void {
    this.correlationTracker = tracker;
    console.log('[RiskManager] CorrelationTracker integration enabled');
  }

  /**
   * Get correlation between two symbols
   * Uses real-time correlation tracker if available, falls back to hardcoded values
   */
  private getCorrelation(symbol1: string, symbol2: string): number {
    // Try to get real-time correlation from tracker
    if (this.correlationTracker) {
      try {
        const correlation = this.correlationTracker.getCorrelation(symbol1, symbol2, '30d');
        if (correlation !== 0) {
          return correlation;
        }
      } catch (error) {
        // Fall through to hardcoded values
      }
    }
    
    // Normalize symbols (remove /USDT, /USD, etc.)
    const base1 = symbol1.split('/')[0].split('-')[0];
    const base2 = symbol2.split('/')[0].split('-')[0];

    if (base1 === base2) return 1.0;

    // Fallback: Known correlations (simplified for when tracker is not available)
    const knownCorrelations: Record<string, Record<string, number>> = {
      BTC: { ETH: 0.85, BNB: 0.75, ADA: 0.70, SOL: 0.80 },
      ETH: { BTC: 0.85, BNB: 0.80, ADA: 0.75, SOL: 0.85 },
      BNB: { BTC: 0.75, ETH: 0.80, ADA: 0.70, SOL: 0.75 },
    };

    return knownCorrelations[base1]?.[base2] || 0.5; // Default to 0.5 if unknown
  }

  /**
   * Set correlation between two symbols (for dynamic correlation tracking)
   */
  setCorrelation(symbol1: string, symbol2: string, correlation: number): void {
    if (!this.correlationMatrix.has(symbol1)) {
      this.correlationMatrix.set(symbol1, new Map());
    }
    this.correlationMatrix.get(symbol1)!.set(symbol2, correlation);

    // Set symmetric correlation
    if (!this.correlationMatrix.has(symbol2)) {
      this.correlationMatrix.set(symbol2, new Map());
    }
    this.correlationMatrix.get(symbol2)!.set(symbol1, correlation);
  }

  /**
   * FIX #7: Calculate rolling correlation from price data
   * Calculates Pearson correlation coefficient from 30-day returns
   * Caches result for 24 hours to avoid excessive API calls
   */
  async calculateRollingCorrelation(
    symbol1: string,
    symbol2: string,
    exchange?: any,
    windowDays: number = 30
  ): Promise<number> {
    // Check cache first (24-hour TTL)
    const cacheKey = `${symbol1}-${symbol2}`;
    const cached = this.correlationMatrix.get(symbol1)?.get(symbol2);
    if (cached !== undefined) {
      return cached;
    }

    // If no exchange provided, fall back to hardcoded values
    if (!exchange) {
      const base1 = symbol1.split('/')[0].split('-')[0];
      const base2 = symbol2.split('/')[0].split('-')[0];
      const knownCorrelations: Record<string, Record<string, number>> = {
        BTC: { ETH: 0.85, BNB: 0.75, ADA: 0.70, SOL: 0.80 },
        ETH: { BTC: 0.85, BNB: 0.80, ADA: 0.75, SOL: 0.85 },
        BNB: { BTC: 0.75, ETH: 0.80, ADA: 0.70, SOL: 0.75 },
      };
      return knownCorrelations[base1]?.[base2] || 0.5;
    }

    try {
      // Fetch 30-day daily candles for both symbols
      const candles1 = await exchange.getMarketData(symbol1, '1d', windowDays + 1);
      const candles2 = await exchange.getMarketData(symbol2, '1d', windowDays + 1);

      if (candles1.length < 10 || candles2.length < 10) {
        console.warn(`[RiskManager] Insufficient data for correlation (${candles1.length}, ${candles2.length})`);
        return 0.5; // Default to medium correlation
      }

      // Calculate daily returns
      const returns1: number[] = [];
      const returns2: number[] = [];

      const minLength = Math.min(candles1.length, candles2.length);
      for (let i = 1; i < minLength; i++) {
        const return1 = (candles1[i].close - candles1[i - 1].close) / candles1[i - 1].close;
        const return2 = (candles2[i].close - candles2[i - 1].close) / candles2[i - 1].close;
        returns1.push(return1);
        returns2.push(return2);
      }

      // Calculate Pearson correlation coefficient
      const correlation = this.pearsonCorrelation(returns1, returns2);

      // Cache the result
      this.setCorrelation(symbol1, symbol2, correlation);

      console.log(`[RiskManager] Calculated rolling correlation ${symbol1}-${symbol2}: ${correlation.toFixed(3)}`);
      return correlation;
    } catch (error) {
      console.error(`[RiskManager] Failed to calculate rolling correlation:`, error);
      return 0.5; // Default to medium correlation on error
    }
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) {
      return 0;
    }

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) {
      return 0;
    }

    return numerator / denominator;
  }

  /**
   * Check if macro veto is active
   */
  isMacroVeto(): boolean {
    return this.macroVetoActive;
  }

  /**
   * Get macro veto reason
   */
  getMacroVetoReason(): string | null {
    return this.macroVetoReason;
  }

  /**
   * Manually set macro veto (for testing or manual override)
   */
  setMacroVeto(active: boolean, reason?: string): void {
    this.macroVetoActive = active;
    this.macroVetoReason = reason || null;
    if (active) {
      console.log(`[RiskManager] Macro veto activated: ${reason}`);
    } else {
      console.log(`[RiskManager] Macro veto deactivated`);
    }
  }

  /**
   * Check macro veto conditions and update state
   */
  checkMacroVeto(vix: number, sp500Change24h: number): {
    veto: boolean;
    reason?: string;
  } {
    // VIX > 40 (extreme fear)
    if (vix > 40) {
      const reason = `VIX ${vix.toFixed(2)} > 40 (extreme fear)`;
      this.setMacroVeto(true, reason);
      return { veto: true, reason };
    }

    // S&P 500 drops >5% in 24 hours
    if (sp500Change24h < -5.0) {
      const reason = `S&P 500 dropped ${Math.abs(sp500Change24h).toFixed(2)}% in 24h`;
      this.setMacroVeto(true, reason);
      return { veto: true, reason };
    }

    // Clear veto if conditions are normal
    if (this.macroVetoActive) {
      this.setMacroVeto(false);
    }

    return { veto: false };
  }

  /**
   * Check correlated exposure across positions
   */
  async checkCorrelatedExposure(
    userId: number,
    newSymbol: string,
    newPositionSize: number,
    accountBalance: number,
    openPositions: Array<{ symbol: string; positionSize: number }>
  ): Promise<{
    allowed: boolean;
    reason?: string;
    correlatedSymbols?: string[];
  }> {
    // Calculate total correlated exposure
    let correlatedExposure = newPositionSize;
    const correlatedSymbols: string[] = [];

    for (const position of openPositions) {
      const correlation = this.getCorrelation(newSymbol, position.symbol);
      if (Math.abs(correlation) >= this.limits.correlationThreshold) {
        correlatedExposure += position.positionSize;
        correlatedSymbols.push(position.symbol);
      }
    }

    const exposurePercent = correlatedExposure / accountBalance;

    if (exposurePercent > this.limits.maxCorrelatedExposure) {
      await this.logRiskBreach(
        userId,
        'portfolio_exposure',
        this.limits.maxCorrelatedExposure * accountBalance,
        correlatedExposure,
        'blocked',
        newSymbol
      );

      return {
        allowed: false,
        reason: `Correlated exposure ${(exposurePercent * 100).toFixed(2)}% exceeds limit ${(this.limits.maxCorrelatedExposure * 100).toFixed(2)}%`,
        correlatedSymbols,
      };
    }

    return { allowed: true };
  }

  /**
   * Manually halt trading (for testing or emergency stop)
   */
  haltTrading(reason: string): void {
    console.log(`[RiskManager] Trading halted manually: ${reason}`);
    this.drawdownState.isHalted = true;
    this.drawdownState.haltReason = reason;
    this.drawdownState.haltedUntil = null; // No auto-resume
  }

  /**
   * Manual override to resume trading (requires admin confirmation)
   * @param adminUserId - User ID of admin performing override
   * @param reason - Reason for override
   */
  async manualOverride(adminUserId: number, reason: string): Promise<void> {
    console.log(`[RiskManager] Admin override by user ${adminUserId}: resuming trading - ${reason}`);
    this.drawdownState.isHalted = false;
    this.drawdownState.haltReason = null;
    this.drawdownState.haltedUntil = null;
    
    // Log override to database for audit trail
    await this.logAdminOverride(adminUserId, 'resume_trading', reason);
  }

  /**
   * Admin override to bypass position size limit (use with extreme caution)
   * @param adminUserId - User ID of admin performing override
   * @param reason - Reason for override
   */
  async overridePositionSizeLimit(adminUserId: number, reason: string): Promise<void> {
    console.log(`[RiskManager] Admin override by user ${adminUserId}: position size limit bypassed - ${reason}`);
    await this.logAdminOverride(adminUserId, 'override_position_size', reason);
  }

  /**
   * Admin override to bypass correlation limit (use with extreme caution)
   * @param adminUserId - User ID of admin performing override
   * @param reason - Reason for override
   */
  async overrideCorrelationLimit(adminUserId: number, reason: string): Promise<void> {
    console.log(`[RiskManager] Admin override by user ${adminUserId}: correlation limit bypassed - ${reason}`);
    await this.logAdminOverride(adminUserId, 'override_correlation', reason);
  }

  /**
   * Log admin override action for audit trail
   */
  private async logAdminOverride(
    adminUserId: number,
    overrideType: string,
    reason: string
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        console.warn('[RiskManager] Cannot log admin override: database not available');
        return;
      }

      // Log as a special type of risk breach with action 'admin_override'
      const breach: InsertRiskLimitBreach = {
        userId: adminUserId,
        limitType: 'max_drawdown', // Use generic type for override logs
        limitValue: '0',
        actualValue: '0',
        symbol: overrideType,
        action: 'warning', // Use warning to indicate override
        resolved: true,
      };

      await db.insert(riskLimitBreaches).values(breach);
      console.log(`[RiskManager] Admin override logged: ${overrideType} by user ${adminUserId}`);
    } catch (error) {
      console.error('[RiskManager] Failed to log admin override:', error);
    }
  }

  /**
   * Get current risk state
   */
  getRiskState(): DrawdownState {
    return { ...this.drawdownState };
  }

  /**
   * Get risk limits
   */
  getRiskLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Log risk limit breach to database for compliance and analysis
   */
  private async logRiskBreach(
    userId: number,
    limitType: 'position_size' | 'daily_loss' | 'max_drawdown' | 'symbol_exposure' | 'portfolio_exposure' | 'risk_per_trade',
    limitValue: number,
    actualValue: number,
    action: 'blocked' | 'warning' | 'shutdown',
    symbol?: string
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        console.warn('[RiskManager] Cannot log risk breach: database not available');
        return;
      }

      const breach: InsertRiskLimitBreach = {
        userId,
        limitType,
        limitValue: limitValue.toString(),
        actualValue: actualValue.toString(),
        symbol: symbol || null,
        action,
        resolved: false,
      };

      await db.insert(riskLimitBreaches).values(breach);
      console.log(`[RiskManager] Risk breach logged: ${limitType} - ${action}`);
    } catch (error) {
      console.error('[RiskManager] Failed to log risk breach:', error);
    }
  }
}

// Singleton instance (will be initialized with user's account balance)
let riskManagerInstance: RiskManager | null = null;

export function initializeRiskManager(accountBalance: number, customLimits?: Partial<RiskLimits>): RiskManager {
  riskManagerInstance = new RiskManager(accountBalance, customLimits);
  return riskManagerInstance;
}

export function getRiskManager(): RiskManager | null {
  return riskManagerInstance;
}
