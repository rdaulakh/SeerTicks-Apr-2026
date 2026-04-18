/**
 * PortfolioRiskManager — Phase 32: Portfolio-Level Risk Management
 * 
 * Enforces portfolio-wide risk constraints that individual position sizing cannot:
 * 1. Total portfolio exposure limit (max % of balance in open positions)
 * 2. Per-symbol position limit (prevent stacking on one asset)
 * 3. Correlated asset group limits (prevent overexposure to correlated assets)
 * 4. Portfolio drawdown circuit breaker (halt trading on excessive drawdown)
 * 5. Regime-aware exposure limits (tighter in high volatility)
 * 
 * This is a SINGLETON per user — instantiated once and shared across the pipeline.
 */

import { getPositionSizeMultiplier } from './RegimeCalibration';

// ============================================================================
// TYPES
// ============================================================================

export interface PortfolioRiskConfig {
  // Total exposure limits
  maxTotalExposurePercent: number;     // Max % of equity in open positions (default: 30%)
  maxTotalExposureAbsolute?: number;   // Optional absolute cap in USD
  
  // Per-symbol limits
  maxPositionsPerSymbol: number;       // Max concurrent positions per symbol (default: 1)
  maxExposurePerSymbolPercent: number; // Max % of equity per symbol (default: 15%)
  
  // Correlated asset group limits
  maxCorrelatedGroupExposurePercent: number; // Max % of equity per correlated group (default: 25%)
  
  // Drawdown protection
  maxDailyDrawdownPercent: number;     // Max daily drawdown before halting (default: 5%)
  maxWeeklyDrawdownPercent: number;    // Max weekly drawdown before halting (default: 10%)
  maxTotalDrawdownPercent: number;     // Max total drawdown from peak (default: 15%)
  
  // Recovery
  drawdownCooldownMinutes: number;     // Cooldown after drawdown halt (default: 60)
  reducedSizeAfterDrawdown: number;    // Size multiplier after recovery (default: 0.5)
}

export interface PortfolioRiskAssessment {
  canTrade: boolean;
  maxAllowedSize: number;             // Maximum position size allowed by portfolio constraints
  adjustedSize: number;               // Recommended position size after all adjustments
  reasons: string[];                  // Rejection or adjustment reasons
  metrics: PortfolioMetrics;
}

export interface PortfolioMetrics {
  totalExposure: number;              // Total USD in open positions
  totalExposurePercent: number;       // As % of equity
  positionCount: number;              // Total open positions
  symbolExposure: Record<string, number>;  // USD exposure per symbol
  groupExposure: Record<string, number>;   // USD exposure per correlated group
  dailyPnl: number;                   // Today's P&L
  dailyPnlPercent: number;            // Today's P&L as % of equity
  weeklyPnl: number;                  // This week's P&L
  weeklyPnlPercent: number;           // This week's P&L as % of equity
  peakEquity: number;                 // Peak equity (for drawdown calc)
  currentDrawdownPercent: number;     // Current drawdown from peak
  isHalted: boolean;                  // Whether trading is halted
  haltReason?: string;                // Why trading was halted
  haltedUntil?: number;               // When halt expires (timestamp)
}

// Correlated asset groups — assets that tend to move together
const CORRELATED_GROUPS: Record<string, string[]> = {
  'btc_ecosystem': ['BTCUSDT', 'BTCUSD', 'WBTCUSDT'],
  'eth_ecosystem': ['ETHUSDT', 'ETHUSD', 'STETHUSDT'],
  'large_cap_l1': ['SOLUSDT', 'AVAXUSDT', 'ADAUSDT', 'DOTUSDT', 'NEARUSDT'],
  'defi_blue_chip': ['UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'LINKUSDT'],
  'meme_coins': ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT'],
  'layer2': ['ARBUSDT', 'OPUSDT', 'MATICUSDT', 'STRKUSDT'],
  'ai_tokens': ['FETUSDT', 'RENDERUSDT', 'TAOUSDT', 'AGIXUSDT'],
};

// Build reverse lookup: symbol → group name
const SYMBOL_TO_GROUP: Record<string, string> = {};
for (const [group, symbols] of Object.entries(CORRELATED_GROUPS)) {
  for (const symbol of symbols) {
    SYMBOL_TO_GROUP[symbol] = group;
  }
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: PortfolioRiskConfig = {
  maxTotalExposurePercent: 0.30,       // 30% max total exposure
  maxPositionsPerSymbol: 1,            // 1 position per symbol
  maxExposurePerSymbolPercent: 0.15,   // 15% max per symbol
  maxCorrelatedGroupExposurePercent: 0.25, // 25% max per correlated group
  maxDailyDrawdownPercent: 0.05,       // 5% daily drawdown halt
  maxWeeklyDrawdownPercent: 0.10,      // 10% weekly drawdown halt
  maxTotalDrawdownPercent: 0.15,       // 15% total drawdown halt
  drawdownCooldownMinutes: 60,         // 1 hour cooldown
  reducedSizeAfterDrawdown: 0.50,      // 50% size after recovery
};

// ============================================================================
// PORTFOLIO RISK MANAGER
// ============================================================================

export class PortfolioRiskManager {
  private config: PortfolioRiskConfig;
  private userId: string;
  
  // Tracking state
  private peakEquity: number = 0;
  private dailyStartEquity: number = 0;
  private weeklyStartEquity: number = 0;
  private dailyResetTime: number = 0;
  private weeklyResetTime: number = 0;
  private closedPnlToday: number = 0;
  private closedPnlWeek: number = 0;
  
  // Halt state
  private isHalted: boolean = false;
  private haltReason: string = '';
  private haltedUntil: number = 0;
  private wasRecentlyHalted: boolean = false;
  
  // Trade outcome tracking for drawdown
  private recentOutcomes: { pnl: number; timestamp: number }[] = [];

  constructor(userId: string, config?: Partial<PortfolioRiskConfig>) {
    this.userId = userId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main entry point: Assess whether a new trade is allowed and what size is permitted
   */
  async assessTradeRisk(
    symbol: string,
    requestedSize: number,
    equity: number,
    openPositions: OpenPositionInfo[],
    currentRegime?: string,
  ): Promise<PortfolioRiskAssessment> {
    const reasons: string[] = [];
    let maxAllowedSize = requestedSize;
    
    // Reset daily/weekly counters if needed
    this.checkAndResetCounters(equity);
    
    // Update peak equity
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    
    // ================================================================
    // CHECK 1: Is trading halted?
    // ================================================================
    if (this.isHalted) {
      if (Date.now() < this.haltedUntil) {
        const minutesLeft = Math.ceil((this.haltedUntil - Date.now()) / 60000);
        return {
          canTrade: false,
          maxAllowedSize: 0,
          adjustedSize: 0,
          reasons: [`HALTED: ${this.haltReason} (${minutesLeft}min remaining)`],
          metrics: this.calculateMetrics(equity, openPositions),
        };
      } else {
        // Halt expired — resume with reduced size
        this.isHalted = false;
        this.wasRecentlyHalted = true;
        console.log(`[PortfolioRiskManager] Trading resumed for user ${this.userId} after drawdown halt`);
      }
    }
    
    // ================================================================
    // CHECK 2: Drawdown circuit breakers
    // ================================================================
    const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    
    // Daily drawdown check
    const dailyPnl = this.closedPnlToday + totalUnrealizedPnl;
    const dailyPnlPercent = this.dailyStartEquity > 0 ? dailyPnl / this.dailyStartEquity : 0;
    
    if (dailyPnlPercent < -this.config.maxDailyDrawdownPercent) {
      this.triggerHalt(`Daily drawdown limit hit: ${(dailyPnlPercent * 100).toFixed(2)}% (limit: -${(this.config.maxDailyDrawdownPercent * 100).toFixed(0)}%)`);
      return {
        canTrade: false,
        maxAllowedSize: 0,
        adjustedSize: 0,
        reasons: [`HALTED: Daily drawdown ${(dailyPnlPercent * 100).toFixed(2)}% exceeds -${(this.config.maxDailyDrawdownPercent * 100).toFixed(0)}% limit`],
        metrics: this.calculateMetrics(equity, openPositions),
      };
    }
    
    // Weekly drawdown check
    const weeklyPnl = this.closedPnlWeek + totalUnrealizedPnl;
    const weeklyPnlPercent = this.weeklyStartEquity > 0 ? weeklyPnl / this.weeklyStartEquity : 0;
    
    if (weeklyPnlPercent < -this.config.maxWeeklyDrawdownPercent) {
      this.triggerHalt(`Weekly drawdown limit hit: ${(weeklyPnlPercent * 100).toFixed(2)}% (limit: -${(this.config.maxWeeklyDrawdownPercent * 100).toFixed(0)}%)`);
      return {
        canTrade: false,
        maxAllowedSize: 0,
        adjustedSize: 0,
        reasons: [`HALTED: Weekly drawdown ${(weeklyPnlPercent * 100).toFixed(2)}% exceeds -${(this.config.maxWeeklyDrawdownPercent * 100).toFixed(0)}% limit`],
        metrics: this.calculateMetrics(equity, openPositions),
      };
    }
    
    // Total drawdown from peak
    if (this.peakEquity > 0) {
      const currentDrawdown = (this.peakEquity - equity) / this.peakEquity;
      if (currentDrawdown > this.config.maxTotalDrawdownPercent) {
        this.triggerHalt(`Total drawdown from peak: ${(currentDrawdown * 100).toFixed(2)}% (limit: -${(this.config.maxTotalDrawdownPercent * 100).toFixed(0)}%)`);
        return {
          canTrade: false,
          maxAllowedSize: 0,
          adjustedSize: 0,
          reasons: [`HALTED: Total drawdown ${(currentDrawdown * 100).toFixed(2)}% from peak $${this.peakEquity.toFixed(2)} exceeds -${(this.config.maxTotalDrawdownPercent * 100).toFixed(0)}% limit`],
          metrics: this.calculateMetrics(equity, openPositions),
        };
      }
    }
    
    // ================================================================
    // CHECK 3: Total portfolio exposure limit
    // ================================================================
    const totalExposure = openPositions.reduce((sum, p) => sum + Math.abs(p.notionalValue), 0);
    const maxTotalExposure = equity * this.getRegimeAdjustedExposure(currentRegime);
    const remainingExposure = Math.max(0, maxTotalExposure - totalExposure);
    
    if (remainingExposure <= 0) {
      return {
        canTrade: false,
        maxAllowedSize: 0,
        adjustedSize: 0,
        reasons: [`Total exposure $${totalExposure.toFixed(2)} (${((totalExposure / equity) * 100).toFixed(1)}%) at limit $${maxTotalExposure.toFixed(2)} (${(this.getRegimeAdjustedExposure(currentRegime) * 100).toFixed(0)}%)`],
        metrics: this.calculateMetrics(equity, openPositions),
      };
    }
    
    if (requestedSize > remainingExposure) {
      maxAllowedSize = remainingExposure;
      reasons.push(`Reduced from $${requestedSize.toFixed(2)} to $${remainingExposure.toFixed(2)} (total exposure limit)`);
    }
    
    // ================================================================
    // CHECK 4: Per-symbol position limit
    // ================================================================
    const symbolPositions = openPositions.filter(p => p.symbol === symbol);
    
    if (symbolPositions.length >= this.config.maxPositionsPerSymbol) {
      return {
        canTrade: false,
        maxAllowedSize: 0,
        adjustedSize: 0,
        reasons: [`Max positions per symbol reached: ${symbolPositions.length}/${this.config.maxPositionsPerSymbol} for ${symbol}`],
        metrics: this.calculateMetrics(equity, openPositions),
      };
    }
    
    // Per-symbol exposure limit
    const symbolExposure = symbolPositions.reduce((sum, p) => sum + Math.abs(p.notionalValue), 0);
    const maxSymbolExposure = equity * this.config.maxExposurePerSymbolPercent;
    const remainingSymbolExposure = Math.max(0, maxSymbolExposure - symbolExposure);
    
    if (remainingSymbolExposure <= 0) {
      return {
        canTrade: false,
        maxAllowedSize: 0,
        adjustedSize: 0,
        reasons: [`Symbol exposure limit reached: ${symbol} at $${symbolExposure.toFixed(2)} (${((symbolExposure / equity) * 100).toFixed(1)}%, limit: ${(this.config.maxExposurePerSymbolPercent * 100).toFixed(0)}%)`],
        metrics: this.calculateMetrics(equity, openPositions),
      };
    }
    
    if (maxAllowedSize > remainingSymbolExposure) {
      maxAllowedSize = remainingSymbolExposure;
      reasons.push(`Capped at $${remainingSymbolExposure.toFixed(2)} (per-symbol exposure limit for ${symbol})`);
    }
    
    // ================================================================
    // CHECK 5: Correlated asset group limit
    // ================================================================
    const targetGroup = SYMBOL_TO_GROUP[symbol];
    if (targetGroup) {
      const groupSymbols = CORRELATED_GROUPS[targetGroup] || [];
      const groupPositions = openPositions.filter(p => groupSymbols.includes(p.symbol));
      const groupExposure = groupPositions.reduce((sum, p) => sum + Math.abs(p.notionalValue), 0);
      const maxGroupExposure = equity * this.config.maxCorrelatedGroupExposurePercent;
      const remainingGroupExposure = Math.max(0, maxGroupExposure - groupExposure);
      
      if (remainingGroupExposure <= 0) {
        return {
          canTrade: false,
          maxAllowedSize: 0,
          adjustedSize: 0,
          reasons: [`Correlated group '${targetGroup}' exposure limit reached: $${groupExposure.toFixed(2)} (${((groupExposure / equity) * 100).toFixed(1)}%, limit: ${(this.config.maxCorrelatedGroupExposurePercent * 100).toFixed(0)}%)`],
          metrics: this.calculateMetrics(equity, openPositions),
        };
      }
      
      if (maxAllowedSize > remainingGroupExposure) {
        maxAllowedSize = remainingGroupExposure;
        reasons.push(`Capped at $${remainingGroupExposure.toFixed(2)} (correlated group '${targetGroup}' limit)`);
      }
    }
    
    // ================================================================
    // CHECK 6: Post-halt reduced sizing
    // ================================================================
    if (this.wasRecentlyHalted) {
      const reducedSize = maxAllowedSize * this.config.reducedSizeAfterDrawdown;
      reasons.push(`Post-halt reduced sizing: $${maxAllowedSize.toFixed(2)} → $${reducedSize.toFixed(2)} (${(this.config.reducedSizeAfterDrawdown * 100).toFixed(0)}% of normal)`);
      maxAllowedSize = reducedSize;
      
      // Clear the flag after 3 successful trades
      const recentWins = this.recentOutcomes.filter(o => o.pnl > 0 && o.timestamp > Date.now() - 3600000).length;
      if (recentWins >= 3) {
        this.wasRecentlyHalted = false;
        console.log(`[PortfolioRiskManager] Post-halt reduced sizing cleared after 3 winning trades`);
      }
    }
    
    // Final adjusted size
    const adjustedSize = Math.min(requestedSize, maxAllowedSize);
    
    if (adjustedSize < requestedSize && reasons.length === 0) {
      reasons.push(`Size reduced from $${requestedSize.toFixed(2)} to $${adjustedSize.toFixed(2)} by portfolio constraints`);
    }
    
    return {
      canTrade: adjustedSize > 0,
      maxAllowedSize,
      adjustedSize,
      reasons,
      metrics: this.calculateMetrics(equity, openPositions),
    };
  }

  /**
   * Record a closed trade outcome for drawdown tracking
   */
  recordTradeOutcome(pnl: number): void {
    this.recentOutcomes.push({ pnl, timestamp: Date.now() });
    this.closedPnlToday += pnl;
    this.closedPnlWeek += pnl;
    
    // Keep only last 100 outcomes
    if (this.recentOutcomes.length > 100) {
      this.recentOutcomes = this.recentOutcomes.slice(-100);
    }
    
    if (pnl < 0) {
      console.log(`[PortfolioRiskManager] Loss recorded: $${pnl.toFixed(2)} | Daily P&L: $${this.closedPnlToday.toFixed(2)} | Weekly P&L: $${this.closedPnlWeek.toFixed(2)}`);
    }
  }

  /**
   * Get current portfolio metrics for dashboard display
   */
  getMetrics(equity: number, openPositions: OpenPositionInfo[]): PortfolioMetrics {
    return this.calculateMetrics(equity, openPositions);
  }

  /**
   * Get current config (for dashboard display)
   */
  getConfig(): PortfolioRiskConfig {
    return { ...this.config };
  }

  /**
   * Update config dynamically
   */
  updateConfig(updates: Partial<PortfolioRiskConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log(`[PortfolioRiskManager] Config updated for user ${this.userId}:`, updates);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private getRegimeAdjustedExposure(regime?: string): number {
    const baseExposure = this.config.maxTotalExposurePercent;
    
    if (!regime) return baseExposure;
    
    // Use RegimeCalibration's position size multiplier as a proxy for exposure adjustment
    const regimeMultiplier = getPositionSizeMultiplier(regime);
    
    // In high volatility, reduce max exposure further
    // In trending, allow slightly more exposure
    const adjustedExposure = baseExposure * regimeMultiplier;
    
    // Hard floor: never go below 10% exposure limit
    // Hard ceiling: never exceed 40% exposure limit
    return Math.max(0.10, Math.min(0.40, adjustedExposure));
  }

  private triggerHalt(reason: string): void {
    this.isHalted = true;
    this.haltReason = reason;
    this.haltedUntil = Date.now() + (this.config.drawdownCooldownMinutes * 60 * 1000);
    
    console.log(`[PortfolioRiskManager] ⛔ TRADING HALTED for user ${this.userId}`);
    console.log(`  Reason: ${reason}`);
    console.log(`  Cooldown: ${this.config.drawdownCooldownMinutes} minutes`);
    console.log(`  Resumes at: ${new Date(this.haltedUntil).toISOString()}`);
  }

  private checkAndResetCounters(equity: number): void {
    const now = Date.now();
    
    // Daily reset (every 24 hours from first trade)
    if (now - this.dailyResetTime > 24 * 60 * 60 * 1000) {
      this.dailyResetTime = now;
      this.dailyStartEquity = equity;
      this.closedPnlToday = 0;
    }
    
    // Weekly reset (every 7 days)
    if (now - this.weeklyResetTime > 7 * 24 * 60 * 60 * 1000) {
      this.weeklyResetTime = now;
      this.weeklyStartEquity = equity;
      this.closedPnlWeek = 0;
    }
    
    // Initialize if first time
    if (this.dailyStartEquity === 0) this.dailyStartEquity = equity;
    if (this.weeklyStartEquity === 0) this.weeklyStartEquity = equity;
    if (this.peakEquity === 0) this.peakEquity = equity;
  }

  private calculateMetrics(equity: number, openPositions: OpenPositionInfo[]): PortfolioMetrics {
    const totalExposure = openPositions.reduce((sum, p) => sum + Math.abs(p.notionalValue), 0);
    const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    
    // Per-symbol exposure
    const symbolExposure: Record<string, number> = {};
    for (const pos of openPositions) {
      symbolExposure[pos.symbol] = (symbolExposure[pos.symbol] || 0) + Math.abs(pos.notionalValue);
    }
    
    // Per-group exposure
    const groupExposure: Record<string, number> = {};
    for (const pos of openPositions) {
      const group = SYMBOL_TO_GROUP[pos.symbol];
      if (group) {
        groupExposure[group] = (groupExposure[group] || 0) + Math.abs(pos.notionalValue);
      }
    }
    
    const dailyPnl = this.closedPnlToday + totalUnrealizedPnl;
    const weeklyPnl = this.closedPnlWeek + totalUnrealizedPnl;
    
    return {
      totalExposure,
      totalExposurePercent: equity > 0 ? totalExposure / equity : 0,
      positionCount: openPositions.length,
      symbolExposure,
      groupExposure,
      dailyPnl,
      dailyPnlPercent: this.dailyStartEquity > 0 ? dailyPnl / this.dailyStartEquity : 0,
      weeklyPnl,
      weeklyPnlPercent: this.weeklyStartEquity > 0 ? weeklyPnl / this.weeklyStartEquity : 0,
      peakEquity: this.peakEquity,
      currentDrawdownPercent: this.peakEquity > 0 ? (this.peakEquity - equity) / this.peakEquity : 0,
      isHalted: this.isHalted,
      haltReason: this.isHalted ? this.haltReason : undefined,
      haltedUntil: this.isHalted ? this.haltedUntil : undefined,
    };
  }
}

// ============================================================================
// OPEN POSITION INFO (simplified interface for risk assessment)
// ============================================================================

export interface OpenPositionInfo {
  symbol: string;
  side: 'long' | 'short';
  notionalValue: number;        // Position size in USD
  unrealizedPnl: number;        // Current unrealized P&L in USD
  entryPrice: number;
  currentPrice: number;
  quantity: number;
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

const instances = new Map<string, PortfolioRiskManager>();

export function getPortfolioRiskManager(userId: string, config?: Partial<PortfolioRiskConfig>): PortfolioRiskManager {
  let instance = instances.get(userId);
  if (!instance) {
    instance = new PortfolioRiskManager(userId, config);
    instances.set(userId, instance);
    console.log(`[PortfolioRiskManager] Created instance for user ${userId}`);
  }
  return instance;
}

export function getAllPortfolioRiskManagers(): Map<string, PortfolioRiskManager> {
  return instances;
}
