// Phase 22: Cached AuditLogger import (ESM-compatible)
let _auditLoggerCache: any = null;
async function _getAuditLoggerModule() {
  if (!_auditLoggerCache) _auditLoggerCache = await import("./AuditLogger");
  return _auditLoggerCache;
}

/**
 * Enhanced Trade Executor
 * 
 * Week 9 Integration: Combines all advanced trading components:
 * - IntegratedExitManager (Week 7-8): Structure-based exits, layered profit targets
 * - EntryValidationService (Week 5-6): Agent consensus, timeframe alignment, volume confirmation
 * - Week9RiskManager: Kelly Criterion, circuit breakers, correlation limits
 * 
 * This is the institutional-grade trade executor that replaces AutomatedTradeExecutor
 * with full integration of all A++ grade components.
 */

import { EventEmitter } from 'events';
import type { ProcessedSignal } from './AutomatedSignalProcessor';
import type { PaperTradingEngine } from '../execution/PaperTradingEngine';
import type { ITradingEngine } from '../execution/ITradingEngine';
import type { PositionManager } from '../PositionManager';
import type { ExchangeInterface } from '../exchanges';
import { IntegratedExitManager, ManagedPosition, ExitDecision } from './IntegratedExitManager';
import { EntryValidationService, EntryValidationResult } from './EntryValidationService';
import { Week9RiskManager, TradeResult } from './Week9RiskManager';
import { getPaperWallet } from '../db';
import { tradeDecisionLogger } from './tradeDecisionLogger';
import { latencyLogger } from './LatencyLogger';
import { getTradingConfig } from '../config/TradingConfig';
import { canEnterProfitably } from './ProfitLockGuard';
import { checkVaRGate, recordReturnForVaR } from './VaRRiskGate';
import { getDynamicCorrelationTracker } from './DynamicCorrelationTracker';
import { logPipelineEvent } from './TradingPipelineLogger';
import { getPositionSizeMultiplier, recordCalibrationOutcome, getSmoothedStopLossAtrMultiplier, getSmoothedTakeProfitRrRatio, getSmoothedPositionSizeMultiplier } from './RegimeCalibration';
import type { ScenarioProjection } from './ScenarioEngine';
import { getPortfolioRiskManager, type OpenPositionInfo } from './PortfolioRiskManager';

export interface EnhancedTradeExecutorConfig {
  // Entry validation
  requireEntryValidation: boolean;
  
  // Exit management
  useIntegratedExitManager: boolean;
  
  // Risk management
  useWeek9RiskManager: boolean;
  
  // Fallback settings (when advanced features disabled)
  maxPositionSize: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  maxPositions: number;
}

// Phase 18: Defaults aligned with TradingConfig (single source of truth)
const DEFAULT_CONFIG: EnhancedTradeExecutorConfig = {
  requireEntryValidation: true,
  useIntegratedExitManager: true,
  useWeek9RiskManager: true,
  maxPositionSize: getTradingConfig().positionSizing.maxPositionSizePercent,
  defaultStopLoss: Math.abs(getTradingConfig().exits.hardStopLossPercent) / 100,
  defaultTakeProfit: getTradingConfig().exits.profitTargets[2] / 100,
  maxPositions: getTradingConfig().positionSizing.maxConcurrentPositions,
};

export class EnhancedTradeExecutor extends EventEmitter {
  private userId: number;
  private config: EnhancedTradeExecutorConfig;
  
  // Dependencies — accepts ITradingEngine (paper or real)
  private tradingEngine: ITradingEngine | null = null;
  /** @deprecated Use tradingEngine. Kept for backward compatibility. */
  private paperTradingEngine: PaperTradingEngine | null = null;
  private positionManager: PositionManager | null = null;
  private exchange: ExchangeInterface | null = null;
  
  // Week 5-6: Entry Validation
  private entryValidationService: EntryValidationService;
  
  // Week 7-8: Exit Management
  private integratedExitManager: IntegratedExitManager;
  
  // Week 9: Risk Management
  private week9RiskManager: Week9RiskManager;
  
  // Execution state
  private isExecuting: boolean = false;
  private executionQueue: ProcessedSignal[] = [];
  private readonly MAX_QUEUE_SIZE = 100;

  // Phase 15A: Circuit breaker state — prevents catastrophic loss events
  private dailyTradeCount: number = 0;
  private dailyTradeCountResetDate: string = '';
  private consecutiveLosses: number = 0;
  private pausedUntil: number = 0; // Timestamp — if > Date.now(), trading paused
  private isHalted: boolean = false; // Hard halt — requires manual reset
  private haltReason: string = '';
  private dailyPnL: number = 0;
  private dailyPnLResetDate: string = '';
  private peakEquity: number = 0;

  // Phase 17: Limits now sourced from unified TradingConfig (no more scattered constants)
  private get MAX_DAILY_TRADES() { return getTradingConfig().circuitBreakers.maxDailyTrades; }
  private get MAX_CONSECUTIVE_LOSSES() { return getTradingConfig().circuitBreakers.maxConsecutiveLosses; }
  private get CONSECUTIVE_LOSS_PAUSE_MS() { return getTradingConfig().circuitBreakers.consecutiveLossPauseMs; }
  private get MAX_DAILY_LOSS_PERCENT() { return getTradingConfig().circuitBreakers.maxDailyLossPercent; }
  private get MAX_DRAWDOWN_PERCENT() { return getTradingConfig().circuitBreakers.maxDrawdownPercent; }
  private get MAX_SYMBOL_CONCENTRATION() { return getTradingConfig().circuitBreakers.maxSymbolConcentration; }

  // Phase 17: Caches for execution latency reduction
  private dynamicLevelsCache: Map<string, {
    stopLoss: number; takeProfit: number; atr: number; regime: string;
    price: number; action: string; timestamp: number;
  }> = new Map();
  private positionIdCache: Map<string, { id: string | null; timestamp: number }> = new Map();
  // Phase 19: Store cleanup interval for proper disposal
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  constructor(userId: number, config?: Partial<EnhancedTradeExecutorConfig>) {
    super();
    this.userId = userId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize Week 5-6 Entry Validation
    // Phase 23: Relaxed validation — agent consensus is primary gate
    // Timeframe/volume checks are optional enhancements, not hard requirements
    this.entryValidationService = new EntryValidationService({
      cooldownMinutes: 5,
      requireAllValidations: false,
      minValidationsRequired: 1,
    });
    
    // Initialize Week 7-8 Exit Management — Phase 18: defaults from TradingConfig
    this.integratedExitManager = new IntegratedExitManager({
      enableStructureExits: true,
      enableLayeredProfits: true,
      enableTimeBasedExits: true,
      enableDrawdownProtection: true,
      maxHoldTimeHours: getTradingConfig().exits.maxWinnerTimeMinutes / 60,
      maxDrawdownPercent: getTradingConfig().exits.positionMaxDrawdownPercent,
    });

    // Initialize Week 9 Risk Management — Phase 18: from TradingConfig
    this.week9RiskManager = new Week9RiskManager({
      kellyFraction: getTradingConfig().positionSizing.kellyFraction,
      maxConsecutiveLosses: getTradingConfig().circuitBreakers.maxConsecutiveLosses,
      maxGlobalConsecutiveLosses: getTradingConfig().circuitBreakers.maxConsecutiveLosses + 1,
      cooldownMinutes: getTradingConfig().circuitBreakers.consecutiveLossPauseMs / 60000,
      maxCorrelatedExposure: getTradingConfig().correlation.maxCorrelatedExposurePercent,
    });
    
    // Set up exit callback
    this.integratedExitManager.setExitCallback(async (positionId, size, reason) => {
      await this.executeExitOrder(positionId, size, reason);
    });
    
    // Phase 19: Periodic cache eviction to prevent unbounded growth
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.dynamicLevelsCache) {
        if (now - entry.timestamp > 120_000) this.dynamicLevelsCache.delete(key); // 2 min
      }
      for (const [key, entry] of this.positionIdCache) {
        if (now - entry.timestamp > 120_000) this.positionIdCache.delete(key);
      }
    }, 60_000); // Every 60 seconds

    console.log(`[EnhancedTradeExecutor] Initialized for user ${userId}`);
    console.log(`[EnhancedTradeExecutor] Entry Validation: ${this.config.requireEntryValidation ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[EnhancedTradeExecutor] Integrated Exit Manager: ${this.config.useIntegratedExitManager ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[EnhancedTradeExecutor] Week 9 Risk Manager: ${this.config.useWeek9RiskManager ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Phase 19: Clean up resources (intervals, caches, listeners)
   */
  destroy(): void {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    this.dynamicLevelsCache.clear();
    this.positionIdCache.clear();
    this.removeAllListeners();
  }

  /**
   * Set dependencies
   */
  setDependencies(
    paperTradingEngine: PaperTradingEngine | ITradingEngine,
    positionManager: PositionManager,
    exchange?: ExchangeInterface
  ): void {
    this.tradingEngine = paperTradingEngine as ITradingEngine;
    this.paperTradingEngine = paperTradingEngine as PaperTradingEngine;
    this.positionManager = positionManager;
    if (exchange) {
      this.exchange = exchange;
      
      // Set market data service for entry validation
      this.entryValidationService.setMarketDataService({
        getCandles: async (symbol: string, interval: string, limit: number) => {
          const candles = await exchange.getMarketData(symbol, interval, limit);
          return candles.map(c => ({
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            timestamp: c.timestamp,
          }));
        },
      });
    }
    console.log(`[EnhancedTradeExecutor] Dependencies set`);
  }

  /**
   * Queue a signal for execution
   */
  async queueSignal(signal: ProcessedSignal): Promise<void> {
    if (this.executionQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[EnhancedTradeExecutor] Queue full, dropping oldest signal`);
      this.executionQueue.shift();
    }

    this.executionQueue.push(signal);
    console.log(`[EnhancedTradeExecutor] Signal queued for ${signal.symbol} (queue: ${this.executionQueue.length})`);

    this.processQueue().catch(err => {
      console.error(`[EnhancedTradeExecutor] Queue processing error:`, err);
    });
  }

  /**
   * Process execution queue
   */
  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.executionQueue.length === 0) {
      return;
    }

    this.isExecuting = true;

    try {
      while (this.executionQueue.length > 0) {
        const signal = this.executionQueue.shift();
        if (!signal) continue;

        await this.executeSignal(signal);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute a trading signal with full validation
   */
  private async executeSignal(signal: ProcessedSignal): Promise<void> {
    if (!signal.approved || !signal.recommendation) {
      console.warn(`[EnhancedTradeExecutor] Signal not approved`);
      return;
    }

    // ============================================================
    // Phase 15A: CIRCUIT BREAKER CHECKS — BEFORE any trade logic
    // These checks prevent catastrophic loss events like Feb 17 (-$293K)
    // ============================================================

    // Check 1: Hard halt (requires manual reset)
    if (this.isHalted) {
      console.warn(`[EnhancedTradeExecutor] 🛑 HALTED: ${this.haltReason}. Trading blocked until manual reset.`);
      this.emit('trade_rejected', { symbol: signal.symbol, reason: `HALTED: ${this.haltReason}` });
      return;
    }

    // Check 2: Consecutive loss pause (auto-resets after cooldown)
    if (this.pausedUntil > Date.now()) {
      const remainingSec = Math.ceil((this.pausedUntil - Date.now()) / 1000);
      console.warn(`[EnhancedTradeExecutor] ⏸️ PAUSED: ${this.consecutiveLosses} consecutive losses. Resume in ${remainingSec}s`);
      this.emit('trade_rejected', { symbol: signal.symbol, reason: `Paused: ${this.consecutiveLosses} consecutive losses` });
      return;
    }

    // Check 3: Daily trade count limit
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyTradeCountResetDate !== today) {
      this.dailyTradeCount = 0;
      this.dailyTradeCountResetDate = today;
      this.dailyPnL = 0;
      this.dailyPnLResetDate = today;
    }
    if (this.dailyTradeCount >= this.MAX_DAILY_TRADES) {
      console.warn(`[EnhancedTradeExecutor] 🛑 Daily trade limit reached: ${this.dailyTradeCount}/${this.MAX_DAILY_TRADES}`);
      this.emit('trade_rejected', { symbol: signal.symbol, reason: `Daily trade limit: ${this.dailyTradeCount}/${this.MAX_DAILY_TRADES}` });
      return;
    }

    // Check 4: Daily P&L loss limit
    try {
      const wallet = await this.getWalletBalance();
      if (wallet && wallet.balance > 0) {
        const dailyLossLimit = wallet.balance * this.MAX_DAILY_LOSS_PERCENT;
        if (this.dailyPnL < -dailyLossLimit) {
          this.isHalted = true;
          this.haltReason = `Daily loss limit breached: $${Math.abs(this.dailyPnL).toFixed(2)} > $${dailyLossLimit.toFixed(2)} (${(this.MAX_DAILY_LOSS_PERCENT * 100).toFixed(0)}%)`;
          console.error(`[EnhancedTradeExecutor] 🚨 ${this.haltReason}`);
          this.emit('circuit_breaker_triggered', { reason: this.haltReason, type: 'daily_loss' });
          return;
        }

        // Check 5: Max drawdown from peak equity
        if (this.peakEquity === 0) this.peakEquity = wallet.equity || wallet.balance;
        const currentEquity = wallet.equity || wallet.balance;
        if (currentEquity > this.peakEquity) this.peakEquity = currentEquity;
        const drawdownFromPeak = (this.peakEquity - currentEquity) / this.peakEquity;
        if (drawdownFromPeak > this.MAX_DRAWDOWN_PERCENT) {
          this.isHalted = true;
          this.haltReason = `Max drawdown breached: ${(drawdownFromPeak * 100).toFixed(1)}% > ${(this.MAX_DRAWDOWN_PERCENT * 100).toFixed(0)}%`;
          console.error(`[EnhancedTradeExecutor] 🚨 ${this.haltReason}`);
          this.emit('circuit_breaker_triggered', { reason: this.haltReason, type: 'max_drawdown' });
          return;
        }
      }
    } catch { /* wallet check is best-effort, continue to other checks */ }

    // Check 6: Per-symbol concentration limit
    try {
      if (this.positionManager) {
        const openPositions = await this.positionManager.getOpenPositions(this.userId);
        const wallet = await this.getWalletBalance();
        if (wallet && wallet.balance > 0) {
          const symbolExposure = openPositions
            .filter((p: any) => p.symbol === signal.symbol)
            .reduce((sum: number, p: any) => sum + Math.abs(parseFloat(p.quantity || '0') * parseFloat(p.entryPrice || '0')), 0);
          const concentrationRatio = symbolExposure / wallet.balance;
          if (concentrationRatio >= this.MAX_SYMBOL_CONCENTRATION) {
            console.warn(`[EnhancedTradeExecutor] 🛑 Symbol concentration limit: ${signal.symbol} at ${(concentrationRatio * 100).toFixed(1)}% > ${(this.MAX_SYMBOL_CONCENTRATION * 100).toFixed(0)}%`);
            this.emit('trade_rejected', { symbol: signal.symbol, reason: `Symbol concentration: ${(concentrationRatio * 100).toFixed(1)}%` });
            return;
          }
        }
      }
    } catch { /* concentration check is best-effort */ }

    // ============================================================
    // END Phase 15A circuit breaker checks
    // ============================================================

    // ============================================================
    // Phase 17: VaR Risk Gate — Pre-trade portfolio risk validation
    // Checks portfolio VaR(95%), incremental VaR, and CVaR limits
    // BEFORE any capital is committed
    // ============================================================
    try {
      const wallet = await this.getWalletBalance();
      if (wallet && wallet.equity > 0 && getTradingConfig().varLimits.enabled) {
        const openPositions = this.positionManager
          ? await this.positionManager.getOpenPositions(this.userId)
          : [];
        const openSizes = openPositions.map((p: any) =>
          Math.abs(parseFloat(p.quantity || '0') * parseFloat(p.entryPrice || '0'))
        );
        // Estimate proposed position size for VaR check (rough: 10% of equity)
        const estimatedSize = wallet.equity * getTradingConfig().positionSizing.maxPositionSizePercent;
        const varResult = checkVaRGate(estimatedSize, wallet.equity, openSizes);

        if (!varResult.passed) {
          console.warn(`[EnhancedTradeExecutor] 🛑 VaR gate FAILED: ${varResult.reason}`);
          this.emit('trade_rejected', { symbol: signal.symbol, reason: `VaR gate: ${varResult.reason}` });
          return;
        }
        console.log(`[EnhancedTradeExecutor] ✅ VaR gate passed (${varResult.method}): portfolioVaR=${(varResult.portfolioVaR95Percent * 100).toFixed(1)}%, incrementalVaR=${(varResult.incrementalVaR95Percent * 100).toFixed(1)}%`);
      }
    } catch (varErr) {
      // Entry-gate audit restoration: the previous silent catch meant a thrown
      // exception was equivalent to a passing VaR check — exactly the scenario
      // where portfolio risk is unknown and a trade should NOT proceed.
      // Default: fail closed. Set TradingConfig.risk.failClosedOnVaRError=false
      // to restore legacy permissive behavior.
      const failClosed = getTradingConfig().risk?.failClosedOnVaRError !== false;
      if (failClosed) {
        const reason = `var_gate_error_failclosed: ${varErr instanceof Error ? varErr.message : 'unknown'}`;
        console.warn(`[EnhancedTradeExecutor] 🛑 VaR gate ERROR (fail-closed): ${reason}`);
        this.emit('trade_rejected', { symbol: signal.symbol, reason });
        return;
      }
      // Legacy permissive behavior — opt-in only.
      console.warn(`[EnhancedTradeExecutor] VaR gate errored but failClosedOnVaRError=false, proceeding:`, varErr);
    }

    const startTime = Date.now();
    const { symbol, recommendation, metrics } = signal;
    
    // Start latency tracking
    const latencyContextId = latencyLogger.startSignal(
      this.userId,
      symbol,
      metrics?.signalCount || signal.signals.length,
      await this.getCurrentPrice(symbol).catch(() => undefined)
    );

    console.log(`\n========== ENHANCED TRADE EXECUTION ==========`);
    console.log(`[EnhancedTradeExecutor] Symbol: ${symbol}`);
    console.log(`[EnhancedTradeExecutor] Action: ${recommendation.action.toUpperCase()}`);
    console.log(`[EnhancedTradeExecutor] Confidence: ${(recommendation.confidence * 100).toFixed(1)}%`);

    try {
      // Validate dependencies
      if ((!this.tradingEngine && !this.paperTradingEngine) || !this.positionManager) {
        throw new Error('Dependencies not set');
      }

      // Step 1: Entry Validation (Week 5-6)
      if (this.config.requireEntryValidation) {
        const entryValidation = await this.validateEntry(signal);
        
        if (!entryValidation.canEnter) {
          await this.logRejection(signal, `Entry validation failed: ${entryValidation.reasons.join(', ')}`, latencyContextId);
          return;
        }
        
        console.log(`[EnhancedTradeExecutor] ✅ Entry validation passed`);
        console.log(`  - Agent consensus: ${entryValidation.validations.agentConsensus ? '✓' : '✗'}`);
        console.log(`  - Timeframe alignment: ${entryValidation.validations.timeframeAlignment ? '✓' : '✗'}`);
        console.log(`  - Volume confirmation: ${entryValidation.validations.volumeConfirmation ? '✓' : '✗'}`);
      }

      // Step 2: Get wallet and check balance
      const wallet = await getPaperWallet(this.userId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const balance = parseFloat(wallet.balance);
      const margin = parseFloat(wallet.margin);
      const equity = parseFloat(wallet.equity || wallet.balance);
      
      const openPositions = await this.positionManager.getOpenPositions(this.userId);
      const marginIsCorrupted = margin >= balance * 0.9 && openPositions.length === 0;
      const availableBalance = marginIsCorrupted ? equity : Math.max(balance - margin, equity);
      
      console.log(`[EnhancedTradeExecutor] Available Balance: $${availableBalance.toFixed(2)}`);

      if (availableBalance <= 0) {
        await this.logRejection(signal, 'Insufficient available balance', latencyContextId);
        return;
      }

      // Phase 40 FIX 16: Skip trade if already have an open position for this symbol in the same direction
      const incomingDirection: 'long' | 'short' = recommendation.action === 'buy' ? 'long' : 'short';
      const existingSameDir = openPositions.find((p: any) => p.symbol === symbol && p.side === incomingDirection && p.status === 'open');
      if (existingSameDir) {
        console.log(`[EnhancedTradeExecutor] ⛔ DUPLICATE BLOCKED: Already have ${incomingDirection} position for ${symbol} (#${existingSameDir.id})`);
        await this.logRejection(signal, `Duplicate position blocked: already ${incomingDirection} on ${symbol}`, latencyContextId);
        return;
      }

      // Step 3: Risk Management (Week 9) + Phase 15C Volatility-Adjusted Sizing
      let positionSize: number;

      if (this.config.useWeek9RiskManager) {
        const riskResult = this.week9RiskManager.calculatePositionSize(
          symbol,
          availableBalance,
          equity,
          recommendation.confidence,
          incomingDirection
        );

        // Phase 20: Handle position FLIP — close existing position before opening opposite
        // Phase 40 FIX: Only allow flip if existing position is losing > 0.3% or new signal confidence > 0.70
        // This prevents aggressive flipping that was causing -$52 loss across 108 trades
        if (riskResult.positionLimitStatus.isFlip) {
          const existingPos = openPositions.find((p: any) => p.symbol === symbol);
          // Compute P&L from entry price and current price (DB rows don't have unrealizedPnlPercent)
          let existingPnlPercent = 0;
          let holdTimeSeconds = 0;
          if (existingPos) {
            const ep = parseFloat(existingPos.entryPrice || '0');
            const cp = parseFloat(existingPos.currentPrice || existingPos.entryPrice || '0');
            if (ep > 0) {
              existingPnlPercent = existingPos.side === 'long'
                ? ((cp - ep) / ep) * 100
                : ((ep - cp) / ep) * 100;
            }
          }
          // Phase 45 FIX: Use in-memory position openTime from Week9RiskManager
          // instead of DB createdAt which may not exist for paper positions
          const posInfo = this.week9RiskManager.getPositionInfo(symbol);
          if (posInfo) {
            holdTimeSeconds = (Date.now() - posInfo.openTime) / 1000;
          } else if (existingPos?.createdAt) {
            // Fallback to DB createdAt if in-memory not available
            holdTimeSeconds = (Date.now() - new Date(existingPos.createdAt).getTime()) / 1000;
          } else {
            // If neither available, assume position is old enough to flip
            holdTimeSeconds = 999;
            console.warn(`[EnhancedTradeExecutor] ⚠️ No position timing data for ${symbol}, allowing flip`);
          }
          const flipConfidence = recommendation.confidence;
          
          // Phase 40 FIX: Minimum hold time of 120s before allowing ANY flip
          // This prevents the rapid direction oscillation that was killing P&L
          if (holdTimeSeconds < 120) {
            console.log(`[EnhancedTradeExecutor] ⛔ Position flip BLOCKED: hold time ${holdTimeSeconds.toFixed(0)}s < 120s minimum`);
            await this.logRejection(signal, `Position flip blocked: hold time ${holdTimeSeconds.toFixed(0)}s < 120s minimum`, latencyContextId);
            return;
          }
          
          // Phase 40 FIX: Require either significant loss OR very high confidence to flip
          if (existingPnlPercent > -0.5 && flipConfidence < 0.75) {
            console.log(`[EnhancedTradeExecutor] ⛔ Position flip BLOCKED: existing P&L ${existingPnlPercent.toFixed(2)}% > -0.5% and confidence ${(flipConfidence * 100).toFixed(1)}% < 75%`);
            await this.logRejection(signal, `Position flip blocked: existing P&L ${existingPnlPercent.toFixed(2)}% not bad enough, confidence ${(flipConfidence * 100).toFixed(1)}% too low`, latencyContextId);
            return;
          }
          
          console.log(`[EnhancedTradeExecutor] 🔄 POSITION FLIP: ${symbol} ${riskResult.positionLimitStatus.existingDirection} → ${incomingDirection} (existing P&L: ${existingPnlPercent.toFixed(2)}%, confidence: ${(flipConfidence * 100).toFixed(1)}%)`);
          try {
            const engine = this.tradingEngine || this.paperTradingEngine;
            if (engine) {
              const currentPrice = await this.getCurrentPrice(symbol);
              // Close the existing position by placing an order in the opposite direction
              const closeSide = riskResult.positionLimitStatus.existingDirection === 'long' ? 'sell' : 'buy';
              // Find the existing position's quantity
              const existingPos = openPositions.find((p: any) => p.symbol === symbol);
              if (existingPos) {
                const closeQty = parseFloat(existingPos.quantity || '0');
                if (closeQty > 0) {
                  logPipelineEvent('POSITION_FLIP', {
                    symbol,
                    direction: riskResult.positionLimitStatus.existingDirection,
                    action: closeSide,
                    price: currentPrice,
                    quantity: closeQty,
                    reason: `Closing ${riskResult.positionLimitStatus.existingDirection} for ${recommendation.action} flip`,
                  });
                  console.log(`[EnhancedTradeExecutor] Closing existing ${riskResult.positionLimitStatus.existingDirection} position: ${closeQty} @ $${currentPrice.toFixed(2)}`);
                  await engine.placeOrder({
                    symbol,
                    type: 'market',
                    side: closeSide,
                    quantity: closeQty,
                    price: currentPrice,
                    strategy: 'position_flip',
                  });
                  // Update risk manager state
                  this.week9RiskManager.removePosition(symbol);
                  console.log(`[EnhancedTradeExecutor] ✅ Existing position closed for flip`);
                }
              }
            }
          } catch (flipErr) {
            console.error(`[EnhancedTradeExecutor] Position flip close failed:`, (flipErr as Error)?.message);
            await this.logRejection(signal, `Position flip failed: ${(flipErr as Error)?.message}`, latencyContextId);
            return;
          }
        }

        if (!riskResult.canTrade) {
          await this.logRejection(signal, `Risk check failed: ${riskResult.reasons.join(', ')}`, latencyContextId);
          return;
        }

        positionSize = riskResult.positionSize;

        console.log(`[EnhancedTradeExecutor] ✅ Risk management passed`);
        console.log(`  - Kelly fraction: ${(riskResult.kellyResult.kellyFraction * 100).toFixed(2)}%`);
        console.log(`  - Position size: $${positionSize.toFixed(2)}`);
        console.log(`  - Circuit breaker: ${riskResult.circuitBreakerStatus.consecutiveLosses} consecutive losses`);
      } else {
        // Fallback to simple position sizing — Phase 18: use TradingConfig cap
        positionSize = availableBalance * getTradingConfig().positionSizing.maxPositionSizePercent * recommendation.confidence;
      }

      // Phase 15C: Volatility-adjusted position sizing
      // Scale position size inversely with current volatility.
      // High ATR → smaller positions, Low ATR → larger positions.
      try {
        const techSignal = signal.signals.find(s => s.agentName === 'TechnicalAnalyst');
        const techEvidence = (techSignal as any)?.evidence;
        const currentATR = techEvidence?.atr as number | undefined;
        const avgATR = techEvidence?.avgATR as number | undefined;

        if (currentATR && avgATR && avgATR > 0) {
          const volatilityRatio = currentATR / avgATR;
          // Inverse scaling: high vol → smaller, low vol → larger (capped 0.5× to 1.5×)
          const volMultiplier = Math.max(0.5, Math.min(1.5, 1 / volatilityRatio));
          const originalSize = positionSize;
          positionSize *= volMultiplier;
          console.log(`[EnhancedTradeExecutor] Phase 15C vol-adjust: ATR=${currentATR.toFixed(2)}, avg=${avgATR.toFixed(2)}, ratio=${volatilityRatio.toFixed(2)}, multiplier=${volMultiplier.toFixed(2)}, size: $${originalSize.toFixed(2)} → $${positionSize.toFixed(2)}`);
        }
      } catch { /* volatility adjustment is best-effort */ }

      // Phase 17: Correlation-adjusted sizing
      // Reduces position size when correlated assets are already open
      try {
        const correlationTracker = getDynamicCorrelationTracker();
        const corrAdj = correlationTracker.getCorrelationAdjustment(symbol, positionSize, equity);
        if (corrAdj.adjustedSizeMultiplier === 0) {
          await this.logRejection(signal, `Correlation block: ${corrAdj.reason}`, latencyContextId);
          return;
        }
        if (corrAdj.adjustedSizeMultiplier < 1.0) {
          const originalSize = positionSize;
          positionSize *= corrAdj.adjustedSizeMultiplier;
          console.log(`[EnhancedTradeExecutor] Phase 17 corr-adjust: ${corrAdj.reason}, size: $${originalSize.toFixed(2)} → $${positionSize.toFixed(2)}`);
        }
      } catch { /* correlation adjustment is best-effort */ }

      // Phase 31: Regime-based position sizing from RegimeCalibration
      // Adjusts position size based on market regime (smaller in high_volatility, larger in trending)
      try {
        const regimeFromContext = (signal as any).marketContext?.regime || (signal as any).consensus?.regime;
        if (regimeFromContext) {
          // Phase 34: Use smoothed multiplier for transition blending
          const regimeSizeMultiplier = getSmoothedPositionSizeMultiplier(regimeFromContext, symbol);
          const originalSize = positionSize;
          positionSize *= regimeSizeMultiplier;
          console.log(`[EnhancedTradeExecutor] Phase 34 regime-size (smoothed): regime=${regimeFromContext}, multiplier=${regimeSizeMultiplier.toFixed(2)}, size: $${originalSize.toFixed(2)} → $${positionSize.toFixed(2)}`);
        }
      } catch { /* regime sizing is best-effort */ }

      // Phase 31: ScenarioEngine risk/reward-based sizing adjustment
      // If ScenarioEngine projected poor risk/reward, reduce position size
      // If projected excellent risk/reward, allow slightly larger position
      try {
        const projection = (signal as any).scenarioProjection as ScenarioProjection | undefined;
        if (projection) {
          let scenarioMultiplier = 1.0;
          
          // Risk/reward ratio adjustment
          if (projection.riskRewardRatio < 1.0) {
            // Poor risk/reward — reduce significantly
            scenarioMultiplier = 0.50;
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario: R:R ${projection.riskRewardRatio.toFixed(2)} < 1.0 → 50% size reduction`);
          } else if (projection.riskRewardRatio < 1.5) {
            // Marginal risk/reward — reduce moderately
            scenarioMultiplier = 0.75;
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario: R:R ${projection.riskRewardRatio.toFixed(2)} < 1.5 → 25% size reduction`);
          } else if (projection.riskRewardRatio >= 3.0) {
            // Excellent risk/reward — allow 10% increase
            scenarioMultiplier = 1.10;
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario: R:R ${projection.riskRewardRatio.toFixed(2)} >= 3.0 → 10% size increase`);
          }

          // Expected value adjustment — negative EV is a strong warning
          if (projection.expectedValue < 0) {
            scenarioMultiplier *= 0.60;
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario: Negative EV ${projection.expectedValue.toFixed(2)}% → additional 40% reduction`);
          } else if (projection.expectedValue > 2.0) {
            scenarioMultiplier *= 1.05;
          }

          // Worst case severity check — if worst case is catastrophic, reduce
          if (projection.worstCase.pnlPercent < -5.0) {
            scenarioMultiplier *= 0.80;
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario: Severe worst case ${projection.worstCase.pnlPercent.toFixed(2)}% → additional 20% reduction`);
          }

          const originalSize = positionSize;
          positionSize *= scenarioMultiplier;
          console.log(`[EnhancedTradeExecutor] Phase 31 scenario-adjust: R:R=${projection.riskRewardRatio.toFixed(2)}, EV=${projection.expectedValue.toFixed(2)}%, multiplier=${scenarioMultiplier.toFixed(2)}, size: $${originalSize.toFixed(2)} → $${positionSize.toFixed(2)}`);
        }
      } catch { /* scenario sizing is best-effort */ }

      // Phase 17: Hard cap from TradingConfig (replaces hardcoded 10%)
      const maxTradeSize = availableBalance * getTradingConfig().positionSizing.maxPositionSizePercent;
      if (positionSize > maxTradeSize) {
        console.log(`[EnhancedTradeExecutor] Position capped at ${(getTradingConfig().positionSizing.maxPositionSizePercent * 100).toFixed(0)}%: $${positionSize.toFixed(2)} → $${maxTradeSize.toFixed(2)}`);
        positionSize = maxTradeSize;
      }

      // Step 4: Check position limits — Phase 18: use TradingConfig
      // Phase 20: Re-fetch open positions after potential flip close (the old position is now closed)
      const currentOpenPositions = this.positionManager
        ? await this.positionManager.getOpenPositions(this.userId)
        : openPositions;
      const maxPositions = getTradingConfig().positionSizing.maxConcurrentPositions;
      if (currentOpenPositions.length >= maxPositions) {
        await this.logRejection(signal, `Max positions reached (${currentOpenPositions.length}/${maxPositions})`, latencyContextId);
        return;
      }

      // Phase 32: Portfolio-Level Risk Management
      // Enforces total exposure, per-symbol, correlated group, and drawdown limits
      try {
        const portfolioRisk = getPortfolioRiskManager(String(this.userId));
        const currentPrice = await this.getCurrentPrice(symbol);
        
        // Build OpenPositionInfo array from current positions
        const portfolioPositions: OpenPositionInfo[] = currentOpenPositions.map((p: any) => ({
          symbol: p.symbol,
          side: (p.side || 'long') as 'long' | 'short',
          notionalValue: parseFloat(p.quantity || '0') * parseFloat(p.entryPrice || p.price || '0'),
          unrealizedPnl: p.unrealizedPnl || 0,
          entryPrice: parseFloat(p.entryPrice || p.price || '0'),
          currentPrice: parseFloat(p.currentPrice || p.price || '0'),
          quantity: parseFloat(p.quantity || '0'),
        }));
        
        const regimeFromContext = (signal as any).marketContext?.regime || (signal as any).consensus?.regime;
        const assessment = await portfolioRisk.assessTradeRisk(
          symbol,
          positionSize,
          equity,
          portfolioPositions,
          regimeFromContext,
        );
        
        if (!assessment.canTrade) {
          await this.logRejection(signal, `Portfolio risk: ${assessment.reasons.join(', ')}`, latencyContextId);
          console.log(`[EnhancedTradeExecutor] ⛔ Phase 32 portfolio risk rejection:`);
          console.log(`  Reasons: ${assessment.reasons.join(', ')}`);
          console.log(`  Metrics: exposure=${(assessment.metrics.totalExposurePercent * 100).toFixed(1)}%, positions=${assessment.metrics.positionCount}, drawdown=${(assessment.metrics.currentDrawdownPercent * 100).toFixed(2)}%`);
          return;
        }
        
        if (assessment.adjustedSize < positionSize) {
          console.log(`[EnhancedTradeExecutor] Phase 32 portfolio risk adjustment: $${positionSize.toFixed(2)} → $${assessment.adjustedSize.toFixed(2)}`);
          console.log(`  Reasons: ${assessment.reasons.join(', ')}`);
          positionSize = assessment.adjustedSize;
        }
      } catch (portfolioErr) {
        console.error(`[EnhancedTradeExecutor] Portfolio risk check failed (proceeding with existing size):`, (portfolioErr as Error)?.message);
      }

      // Step 5: Get current price and calculate levels
      // Note: currentPrice already fetched in portfolio risk check above, re-fetch for freshness
      const currentPrice = await this.getCurrentPrice(symbol);
      let { stopLoss, takeProfit, atr, regime } = await this.calculateDynamicLevels(
        symbol,
        currentPrice,
        recommendation.action
      );

      // Phase 31: ScenarioEngine SL/TP override when projection provides better levels
      try {
        const projection = (signal as any).scenarioProjection as ScenarioProjection | undefined;
        if (projection?.suggestedStopLoss && projection?.suggestedTakeProfit) {
          const scenarioSL = projection.suggestedStopLoss;
          const scenarioTP = projection.suggestedTakeProfit;
          
          // Only use scenario levels if they provide tighter risk control
          // For buys: scenario SL should be higher (tighter) than default SL
          // For sells: scenario SL should be lower (tighter) than default SL
          const isBuy = recommendation.action === 'buy';
          const scenarioSLTighter = isBuy ? scenarioSL > stopLoss : scenarioSL < stopLoss;
          const scenarioTPReasonable = isBuy ? scenarioTP > currentPrice : scenarioTP < currentPrice;
          
          if (scenarioSLTighter && scenarioTPReasonable) {
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario SL/TP override:`);
            console.log(`  SL: $${stopLoss.toFixed(2)} → $${scenarioSL.toFixed(2)} (tighter)`);
            console.log(`  TP: $${takeProfit.toFixed(2)} → $${scenarioTP.toFixed(2)}`);
            stopLoss = scenarioSL;
            takeProfit = scenarioTP;
          } else {
            console.log(`[EnhancedTradeExecutor] Phase 31 scenario SL/TP NOT applied (default levels are tighter)`);
          }
        }
      } catch { /* scenario SL/TP override is best-effort */ }

      console.log(`[EnhancedTradeExecutor] Current Price: $${currentPrice.toFixed(2)}`);
      console.log(`[EnhancedTradeExecutor] Market Regime: ${regime}`);
      console.log(`[EnhancedTradeExecutor] Stop-Loss: $${stopLoss.toFixed(2)}`);
      console.log(`[EnhancedTradeExecutor] Take-Profit: $${takeProfit.toFixed(2)}`);

      // Phase 11 — pre-trade viability gate: refuse to open a position whose
      // planned TP can't clear exchange-aware fee drag + net-profit floor.
      //
      // Why: Phases 6–10 prevent NET-LOSING closes, but if we open a trade
      // whose TP (when hit) would still net below +0.15% after fees, the
      // guard would block that close and the position would loiter. Best
      // case it bleeds to the hard SL and takes a real −1.45% net loss;
      // worst case it churns and racks up time cost. The rational move is
      // to not open the trade in the first place. Fail-closed: if the
      // engine's exchange is unresolvable, we fall through to the default
      // drag (Binance-equiv) — same as the exit path does.
      //
      // Specifically: on Coinbase (1.30% drag + 0.15% floor = 1.45% required
      // gross TP), a default first-TP at 0.5% gross is REJECTED. That's the
      // prime directive refusing to enter a trade we can't exit profitably.
      {
        const engineForExchange = (this.tradingEngine || this.paperTradingEngine) as any;
        const exchange: string | undefined = engineForExchange?.config?.exchange;
        const viability = canEnterProfitably(
          {
            side: recommendation.action === 'buy' ? 'long' : 'short',
            entryPrice: currentPrice,
            exchange,
          },
          currentPrice,
          takeProfit,
        );
        if (!viability.viable) {
          console.log(
            `[EnhancedTradeExecutor] 🛡️ ENTRY REJECTED by ProfitLockGuard viability: ` +
              `${viability.reason} | symbol=${symbol} side=${recommendation.action} ` +
              `exchange=${exchange ?? 'unknown'} requiredGross≥${viability.requiredGrossPercent.toFixed(3)}%`,
          );
          await this.logRejection(
            signal,
            `Entry viability: ${viability.reason}`,
            latencyContextId,
          );
          return;
        }
      }

      // Step 5.5: Phase 5 - Price Confirmation Filter
      // Verify price is moving in the signal direction before entering
      const priceConfirmed = await this.checkPriceConfirmation(symbol, currentPrice, recommendation.action);
      if (!priceConfirmed) {
        await this.logRejection(signal, 'Price not confirming signal direction', latencyContextId);
        return;
      }

      // Step 6: Execute trade
      const quantity = positionSize / currentPrice;
      
      latencyLogger.recordOrderPlaced(latencyContextId);

      const engine = this.tradingEngine || this.paperTradingEngine;
      if (!engine) throw new Error('No trading engine available');

      const order = await engine.placeOrder({
        symbol,
        type: 'market',
        side: recommendation.action === 'buy' ? 'buy' : 'sell',
        quantity,
        price: currentPrice,
        stopLoss,
        takeProfit,
        strategy: 'enhanced_automated',
      });

      // Step 7: Register with Exit Manager (Week 7-8)
      if (this.config.useIntegratedExitManager) {
        const dbPositionId = await this.getDbPositionId(symbol);
        
        const managedPosition: ManagedPosition = {
          id: dbPositionId || order.id,
          symbol,
          direction: recommendation.action === 'buy' ? 'long' : 'short',
          averagePrice: order.filledPrice || currentPrice,
          currentSize: quantity,
          initialSize: quantity,
          notionalValue: positionSize,
          unrealizedPnL: 0,
          openTime: Date.now(),
        };
        
        this.integratedExitManager.registerPosition(managedPosition);
        console.log(`[EnhancedTradeExecutor] ✅ Position registered with IntegratedExitManager`);
      }

      // Step 8: Register with Risk Manager (Week 9)
      if (this.config.useWeek9RiskManager) {
        this.week9RiskManager.registerPosition(
          symbol,
          positionSize,
          recommendation.action === 'buy' ? 'long' : 'short'
        );
      }

      const executionTime = Date.now() - startTime;
      await latencyLogger.recordOrderFilled(latencyContextId, order.filledPrice || currentPrice, 'executed');

      logPipelineEvent('TRADE_EXECUTED', {
        symbol,
        action: recommendation.action,
        price: order.filledPrice || currentPrice,
        quantity,
        confidence: signal.consensus?.strength,
        reason: `Executed in ${executionTime}ms`,
        metadata: { orderId: order.id, positionSize, stopLoss, takeProfit, regime },
      });
      console.log(`[EnhancedTradeExecutor] ✅ Trade EXECUTED in ${executionTime}ms`);
      console.log(`[EnhancedTradeExecutor] Order ID: ${order.id}`);
      console.log(`==============================================\n`);

      // Phase 15E: Fire-and-forget DB writes — don't block event emission
      if (signal.signalId) {
        tradeDecisionLogger.updateExecution({
          signalId: signal.signalId,
          orderId: order.id,
          entryPrice: order.filledPrice || currentPrice,
          quantity,
          positionSizePercent: (positionSize / availableBalance) * 100,
        }).catch(() => { /* non-critical */ });
      }

      // Phase 17: Register exposure for dynamic correlation tracking
      try {
        getDynamicCorrelationTracker().registerExposure(symbol, positionSize);
      } catch { /* best-effort */ }

      this.emit('trade_executed', {
        symbol,
        order,
        signal,
        executionTime,
        positionSize,
        stopLoss,
        takeProfit,
        // Phase 5B: Entry-time ATR and regime for exit manager
        entryATR: atr,
        entryRegime: regime,
      });

      // Phase 22: Log successful trade execution to audit DB
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logTradeDecision({
          symbol,
          decision: 'executed',
          direction: recommendation.action === 'buy' ? 'long' : 'short',
          consensusConfidence: signal.consensus?.strength || 0,
          entryPrice: order.filledPrice || currentPrice,
          positionSize,
          agentSignals: signal.signals?.map((s: any) => ({
            agentName: s.agentName,
            signal: s.signal,
            confidence: s.confidence,
          })),
          pipelineStages: {
            circuitBreaker: 'passed',
            varGate: 'passed',
            entryValidation: 'passed',
            kellySizing: positionSize.toFixed(2),
            executionTimeMs: executionTime,
          },
        });
      } catch { /* audit logger not ready */ }

    } catch (error) {
      const executionTime = Date.now() - startTime;
      await latencyLogger.recordOrderFilled(latencyContextId, undefined, 'failed');

      console.error(`[EnhancedTradeExecutor] ❌ Trade FAILED after ${executionTime}ms:`, error);
      console.log(`==============================================\n`);

      this.emit('trade_error', {
        symbol,
        error,
        signal,
        executionTime,
      });

      // Phase 22: Log trade failure to audit DB
      try {
        const { getAuditLogger } = await import('./AuditLogger');
        getAuditLogger().logTradeDecision({
          symbol,
          decision: 'missed',
          consensusConfidence: signal.consensus?.strength || 0,
          rejectReason: (error as Error)?.message || 'Execution failed',
          rejectStage: 'execution',
        });
      } catch { /* audit logger not ready */ }
    }
  }

  /**
   * Validate entry using EntryValidationService
   */
  private async validateEntry(signal: ProcessedSignal): Promise<EntryValidationResult> {
    const agentSignals = signal.signals.map(s => ({
      agentName: s.agentName,
      direction: s.signal === 'bullish' ? 'LONG' as const : 
                 s.signal === 'bearish' ? 'SHORT' as const : 'NEUTRAL' as const,
      confidence: s.confidence,
      weight: 1, // Default weight
      timestamp: s.timestamp,
    }));

    return this.entryValidationService.validateEntry(signal.symbol, agentSignals);
  }

  /**
   * Execute exit order
   */
  private async executeExitOrder(positionId: string, size: number, reason: string): Promise<void> {
    console.log(`[EnhancedTradeExecutor] Executing exit for position ${positionId}: ${reason}`);
    
    const engine = this.tradingEngine || this.paperTradingEngine;
    if (!engine || !this.positionManager) {
      console.error('[EnhancedTradeExecutor] Cannot execute exit: dependencies not set');
      return;
    }

    try {
      // Get position details
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      const [position] = await db.select().from(paperPositions)
        .where(eq(paperPositions.id, parseInt(positionId)))
        .limit(1);

      if (!position) {
        console.error(`[EnhancedTradeExecutor] Position ${positionId} not found`);
        return;
      }

      // Get current price
      const currentPrice = await this.getCurrentPrice(position.symbol);
      
      // Calculate P&L for trade result
      const entryPrice = parseFloat(position.entryPrice);
      const pnlPercent = position.side === 'long'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;
      const pnlAbsolute = pnlPercent * parseFloat(position.quantity) * entryPrice / 100;

      // Execute close order using public closePositionById method
      await engine.closePositionById(positionId, currentPrice, reason);

      // Record trade result with Week 9 Risk Manager
      if (this.config.useWeek9RiskManager) {
        const tradeResult: TradeResult = {
          symbol: position.symbol,
          direction: position.side as 'long' | 'short',
          entryPrice,
          exitPrice: currentPrice,
          pnlPercent,
          pnlAbsolute,
          timestamp: Date.now(),
          holdTimeMs: Date.now() - new Date(position.createdAt).getTime(),
        };
        
        this.week9RiskManager.recordTrade(tradeResult);
        this.week9RiskManager.removePosition(position.symbol);
      }

      // Remove from exit manager
      this.integratedExitManager.removePosition(positionId);

      // Phase 17: Record return for VaR calculation + remove correlation exposure
      try {
        recordReturnForVaR(pnlPercent);
        getDynamicCorrelationTracker().removeExposure(position.symbol);
      } catch { /* best-effort */ }

      // Phase 17: Clear position ID cache for this symbol
      this.positionIdCache.delete(position.symbol);

      console.log(`[EnhancedTradeExecutor] ✅ Exit executed: ${position.symbol} P&L: ${pnlPercent.toFixed(2)}%`);

      this.emit('exit_executed', {
        positionId,
        symbol: position.symbol,
        pnlPercent,
        pnlAbsolute,
        reason,
      });

      // Phase 31: Record calibration outcome for adaptive regime threshold learning
      try {
        const posRegime = (position as any).regime || 'unknown';
        if (posRegime !== 'unknown') {
          recordCalibrationOutcome({
            regime: posRegime,
            direction: (position as any).side === 'buy' ? 'long' : 'short',
            pnlPercent,
            consensusStrength: (position as any).consensusStrength || 0.5,
            positionSizeMultiplier: getPositionSizeMultiplier(posRegime),
            agentContributions: (position as any).agentContributions || {},
          });
        }
      } catch { /* calibration feedback is best-effort */ }

      // Phase 32: Record trade outcome for portfolio drawdown tracking
      try {
        const portfolioRisk = getPortfolioRiskManager(String(this.userId));
        portfolioRisk.recordTradeOutcome(pnlAbsolute);
      } catch { /* portfolio tracking is best-effort */ }

    } catch (error) {
      console.error(`[EnhancedTradeExecutor] Exit execution failed:`, error);
      this.emit('exit_failed', { positionId, error });
    }
  }

  /**
   * Update position prices for exit management
   */
  async updatePositionPrices(): Promise<void> {
    if (!this.config.useIntegratedExitManager) {
      return;
    }

    const positions = this.integratedExitManager.getPositions();
    
    for (const position of positions) {
      try {
        const currentPrice = await this.getCurrentPrice(position.symbol);
        
        // Get candles for structure-based exits
        let candles: any[] = [];
        if (this.exchange) {
          candles = await this.exchange.getMarketData(position.symbol, '1h', 20);
        }
        
        // Update position and check for exits
        const decision = await this.integratedExitManager.updatePosition(
          position.id,
          currentPrice,
          candles.map(c => ({
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            timestamp: c.timestamp,
          }))
        );
        
        if (decision.shouldExit) {
          console.log(`[EnhancedTradeExecutor] Exit signal for ${position.symbol}: ${decision.reason}`);
        }
      } catch (error) {
        console.error(`[EnhancedTradeExecutor] Failed to update position ${position.id}:`, error);
      }
    }
  }

  /**
   * Get database position ID
   * Phase 17: Cached for execution.positionIdCacheTtlMs to reduce DB queries
   */
  private async getDbPositionId(symbol: string): Promise<string | null> {
    try {
      // Phase 17: Check cache first
      const cached = this.positionIdCache.get(symbol);
      const cacheTTL = getTradingConfig().execution.positionIdCacheTtlMs;
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.id;
      }

      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and, desc } = await import('drizzle-orm');

      const db = await getDb();
      if (!db) return null;

      const [latestPosition] = await db.select().from(paperPositions)
        .where(and(
          eq(paperPositions.userId, this.userId),
          eq(paperPositions.symbol, symbol),
          eq(paperPositions.status, 'open')
        ))
        .orderBy(desc(paperPositions.id))
        .limit(1);

      const id = latestPosition ? String(latestPosition.id) : null;
      this.positionIdCache.set(symbol, { id, timestamp: Date.now() });
      return id;
    } catch {
      return null;
    }
  }

  /**
   * Log rejection
   */
  private async logRejection(signal: ProcessedSignal, reason: string, latencyContextId: string): Promise<void> {
    logPipelineEvent('TRADE_REJECTED', {
      symbol: signal.symbol,
      action: signal.recommendation?.action,
      reason,
      confidence: signal.consensus?.strength,
    });
    console.log(`[EnhancedTradeExecutor] ❌ Trade REJECTED: ${reason}`);
    console.log(`==============================================\n`);
    
    await latencyLogger.recordRejected(latencyContextId, 'rejected');
    
    this.emit('trade_rejected', {
      symbol: signal.symbol,
      reason,
      signal,
    });
  }

  /**
   * Get current price
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    const { priceFeedService } = await import('./priceFeedService');
    const prices = priceFeedService.getPrices([symbol]);
    const price = prices.get(symbol);
    
    if (!price) {
      throw new Error(`No price available for ${symbol}`);
    }

    return price.price;
  }

  /**
   * Phase 5B: Multi-Agent Entry Confirmation
   * Replaces static 5m candle check with agent-driven confirmation.
   *
   * Checks:
   * 1. OrderFlowAnalyst: orderBookScore must agree with trade direction
   *    (>+20 for buy, <-20 for sell)
   * 2. TechnicalAnalyst: SuperTrend direction must agree
   *
   * Requires at least 1 of 2 to confirm (not both — avoids over-filtering).
   * Falls back to price direction check if no agent data available.
   */
  private async checkPriceConfirmation(symbol: string, currentPrice: number, action: 'buy' | 'sell'): Promise<boolean> {
    try {
      // Try to get agent signals for confirmation
      let orderFlowConfirms: boolean | null = null;
      let superTrendConfirms: boolean | null = null;

      // Check cached agent signals from the signal that triggered this trade
      // (The signal processor already has fresh signals)
      if (this.positionManager) {
        try {
          const orchestrators = (this.positionManager as any).symbolOrchestrators || new Map();
          for (const [key, orch] of orchestrators) {
            if (key.endsWith(`_${symbol}`)) {
              const status = (orch as any).getStatus?.();
              if (status?.agentsWithSignals) {
                for (const agent of status.agentsWithSignals) {
                  // OrderFlowAnalyst confirmation
                  if (agent.agentName === 'OrderFlowAnalyst' && agent.latestSignal?.evidence) {
                    const flowScore = agent.latestSignal.evidence.orderBookScore;
                    if (flowScore !== undefined) {
                      if (action === 'buy') {
                        orderFlowConfirms = flowScore > 20;
                      } else {
                        orderFlowConfirms = flowScore < -20;
                      }
                      console.log(`[EnhancedTradeExecutor] OrderFlow ${action}: score=${flowScore}, confirms=${orderFlowConfirms}`);
                    }
                  }
                  // TechnicalAnalyst SuperTrend confirmation
                  if (agent.agentName === 'TechnicalAnalyst' && agent.latestSignal?.evidence) {
                    const superTrend = agent.latestSignal.evidence.superTrend;
                    if (superTrend?.direction) {
                      if (action === 'buy') {
                        superTrendConfirms = superTrend.direction === 'bullish';
                      } else {
                        superTrendConfirms = superTrend.direction === 'bearish';
                      }
                      console.log(`[EnhancedTradeExecutor] SuperTrend ${action}: direction=${superTrend.direction}, confirms=${superTrendConfirms}`);
                    }
                  }
                }
              }
              break;
            }
          }
        } catch {
          // Fail silently — fallback to price check below
        }
      }

      // If we have agent data, require at least 1 of 2 to confirm
      if (orderFlowConfirms !== null || superTrendConfirms !== null) {
        const confirmed = orderFlowConfirms === true || superTrendConfirms === true;
        if (!confirmed) {
          console.log(`[EnhancedTradeExecutor] Agent confirmation FAILED for ${action}: OrderFlow=${orderFlowConfirms}, SuperTrend=${superTrendConfirms}`);
          return false;
        }
        console.log(`[EnhancedTradeExecutor] Agent confirmed ${action.toUpperCase()}: OrderFlow=${orderFlowConfirms}, SuperTrend=${superTrendConfirms}`);
        return true;
      }

      // Phase 15E FIX: Remove exchange REST API fallback for price confirmation.
      // Previously this made a blocking REST call (avg 500ms-3.5s) in the hot path,
      // causing 19.3% of trades to exceed 500ms latency.
      // Without agent data, proceed with trade (already validated by consensus).
      console.log(`[EnhancedTradeExecutor] No agent confirmation data — proceeding with trade (consensus already validated)`);
      return true;
    } catch {
      return true; // Don't block trades on errors
    }
  }

  /**
   * Calculate dynamic stop-loss and take-profit levels
   * Phase 17: Cached for execution.dynamicLevelsCacheTtlMs to reduce latency
   */
  private async calculateDynamicLevels(
    symbol: string,
    currentPrice: number,
    action: 'buy' | 'sell'
  ): Promise<{
    stopLoss: number;
    takeProfit: number;
    atr: number;
    regime: string;
  }> {
    try {
      // Phase 17: Check cache first
      const cacheKey = `${symbol}_${action}`;
      const cached = this.dynamicLevelsCache.get(cacheKey);
      const cacheTTL = getTradingConfig().execution.dynamicLevelsCacheTtlMs;
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        // Phase 34: Recalculate stop/TP from cached ATR with current price using smoothed regime-aware multipliers
        const atr = cached.atr;
        const cachedAtrMultiplier = getSmoothedStopLossAtrMultiplier(cached.regime, symbol);
        const cachedRrRatio = getSmoothedTakeProfitRrRatio(cached.regime, symbol);
        const stopDistance = atr * cachedAtrMultiplier;
        const stopLoss = action === 'buy' ? currentPrice - stopDistance : currentPrice + stopDistance;
        const takeProfit = action === 'buy' ? currentPrice + stopDistance * cachedRrRatio : currentPrice - stopDistance * cachedRrRatio;
        return { stopLoss, takeProfit, atr: cached.atr, regime: cached.regime };
      }

      if (!this.exchange) {
        return this.getStaticLevels(currentPrice, action);
      }

      const candles = await this.exchange.getMarketData(symbol, '1h', 20);
      
      if (candles.length < 15) {
        return this.getStaticLevels(currentPrice, action);
      }

      // Calculate ATR
      const trueRanges: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }
      
      const atr = trueRanges.slice(-14).reduce((sum, tr) => sum + tr, 0) / 14;

      // Detect regime
      const closes = candles.map(c => c.close);
      const sma20 = closes.slice(-20).reduce((sum, c) => sum + c, 0) / 20;
      const avgATR = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
      
      let regime = 'range_bound';
      if (currentPrice > sma20 * 1.02) regime = 'trending_up';
      else if (currentPrice < sma20 * 0.98) regime = 'trending_down';
      if (atr > avgATR * 1.5) regime = 'high_volatility';

      // Phase 34: Regime-aware ATR-based stops with transition smoothing
      // Uses per-regime multipliers from RegimeCalibration, blended during regime transitions
      const atrMultiplier = getSmoothedStopLossAtrMultiplier(regime, symbol);
      const rrRatio = getSmoothedTakeProfitRrRatio(regime, symbol);
      const stopDistance = atr * atrMultiplier;
      
      const stopLoss = action === 'buy' 
        ? currentPrice - stopDistance 
        : currentPrice + stopDistance;
      
      // Phase 34: Regime-aware R:R ratio for take-profit
      const takeProfit = action === 'buy'
        ? currentPrice + (stopDistance * rrRatio)
        : currentPrice - (stopDistance * rrRatio);

      console.log(`[EnhancedTradeExecutor] Phase 34 regime-aware SL: regime=${regime}, atrMultiplier=${atrMultiplier}, rrRatio=${rrRatio}, stopDistance=$${stopDistance.toFixed(2)}`);

      // Phase 17: Populate cache
      this.dynamicLevelsCache.set(cacheKey, {
        stopLoss, takeProfit, atr, regime,
        price: currentPrice, action, timestamp: Date.now(),
      });

      return { stopLoss, takeProfit, atr, regime };

    } catch (error) {
      console.error(`[EnhancedTradeExecutor] Failed to calculate dynamic levels:`, error);
      return this.getStaticLevels(currentPrice, action);
    }
  }

  /**
   * Get static levels as fallback
   */
  private getStaticLevels(currentPrice: number, action: 'buy' | 'sell'): {
    stopLoss: number;
    takeProfit: number;
    atr: number;
    regime: string;
  } {
    return {
      stopLoss: action === 'buy' 
        ? currentPrice * (1 - this.config.defaultStopLoss) 
        : currentPrice * (1 + this.config.defaultStopLoss),
      takeProfit: action === 'buy' 
        ? currentPrice * (1 + this.config.defaultTakeProfit) 
        : currentPrice * (1 - this.config.defaultTakeProfit),
      atr: currentPrice * this.config.defaultStopLoss,
      regime: 'unknown',
    };
  }

  /**
   * Phase 5: Record an external trade result to the Week9RiskManager circuit breaker.
   * Used by EngineAdapter/UserTradingSession when exits happen via IntelligentExitManager (not EnhancedTradeExecutor).
   */
  recordExternalTradeResult(result: TradeResult): void {
    if (this.config.useWeek9RiskManager) {
      this.week9RiskManager.recordTrade(result);
    }
  }

  // ============================================================
  // Phase 15A: Circuit breaker helper methods
  // ============================================================

  /**
   * Get wallet balance for circuit breaker checks.
   * Called on every trade — must be fast (uses cached wallet from engine).
   */
  private async getWalletBalance(): Promise<{ balance: number; equity: number } | null> {
    try {
      const engine = this.tradingEngine || this.paperTradingEngine;
      if (engine && typeof (engine as any).getWallet === 'function') {
        const wallet = (engine as any).getWallet();
        return {
          balance: wallet?.balance || 0,
          equity: wallet?.equity || wallet?.balance || 0,
        };
      }
      // Fallback: read from DB
      const { getPaperWallet } = await import('../db');
      const wallet = await getPaperWallet(this.userId);
      if (!wallet) return null;
      return {
        balance: parseFloat(wallet.balance),
        equity: parseFloat(wallet.equity || wallet.balance),
      };
    } catch {
      return null;
    }
  }

  /**
   * Record a trade completion for circuit breaker tracking + VaR feed.
   * Called after every position close — tracks consecutive losses, daily P&L.
   */
  recordTradeCompletion(pnl: number, pnlPercent?: number): void {
    // Phase 17: Feed VaR calculator with trade return
    if (pnlPercent !== undefined) {
      try { recordReturnForVaR(pnlPercent); } catch { /* best-effort */ }
    }

    // Track daily P&L
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyPnLResetDate !== today) {
      this.dailyPnL = 0;
      this.dailyPnLResetDate = today;
    }
    this.dailyPnL += pnl;
    this.dailyTradeCount++;

    // Track consecutive losses
    if (pnl < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES) {
        this.pausedUntil = Date.now() + this.CONSECUTIVE_LOSS_PAUSE_MS;
        console.warn(`[EnhancedTradeExecutor] ⏸️ ${this.consecutiveLosses} consecutive losses — pausing for ${this.CONSECUTIVE_LOSS_PAUSE_MS / 60000} minutes`);
        this.emit('circuit_breaker_triggered', {
          reason: `${this.consecutiveLosses} consecutive losses`,
          type: 'consecutive_losses',
          pausedUntil: this.pausedUntil,
        });
      }
    } else {
      this.consecutiveLosses = 0; // Reset on any winning trade
    }

    // Check daily loss limit
    this.getWalletBalance().then(wallet => {
      if (wallet && wallet.balance > 0) {
        const dailyLossLimit = wallet.balance * this.MAX_DAILY_LOSS_PERCENT;
        if (this.dailyPnL < -dailyLossLimit) {
          this.isHalted = true;
          this.haltReason = `Daily loss limit: $${Math.abs(this.dailyPnL).toFixed(2)} > $${dailyLossLimit.toFixed(2)}`;
          console.error(`[EnhancedTradeExecutor] 🚨 CIRCUIT BREAKER: ${this.haltReason}`);
          this.emit('circuit_breaker_triggered', { reason: this.haltReason, type: 'daily_loss' });
        }
      }
    }).catch(() => { /* best-effort */ });
  }

  /**
   * Manually reset the halt state (admin/operator action).
   */
  resetHalt(): void {
    this.isHalted = false;
    this.haltReason = '';
    this.consecutiveLosses = 0;
    this.pausedUntil = 0;
    console.log(`[EnhancedTradeExecutor] ✅ Circuit breaker reset by operator`);
  }

  /**
   * Get circuit breaker status for dashboards.
   */
  getCircuitBreakerStatus() {
    return {
      isHalted: this.isHalted,
      haltReason: this.haltReason,
      isPaused: this.pausedUntil > Date.now(),
      pausedUntil: this.pausedUntil,
      consecutiveLosses: this.consecutiveLosses,
      dailyTradeCount: this.dailyTradeCount,
      maxDailyTrades: this.MAX_DAILY_TRADES,
      dailyPnL: this.dailyPnL,
      peakEquity: this.peakEquity,
    };
  }

  /**
   * Phase 20: Register an existing open position into the risk manager.
   * Called during session initialization to sync DB positions into the
   * in-memory PositionLimitTracker so it doesn't allow duplicates.
   */
  registerExistingPosition(symbol: string, size: number, direction: 'long' | 'short'): void {
    this.week9RiskManager.registerPosition(symbol, size, direction);
    console.log(`[EnhancedTradeExecutor] Synced existing position: ${symbol} ${direction} $${size.toFixed(2)}`);
  }

  /**
   * Get risk status
   */
  getRiskStatus() {
    return this.week9RiskManager.getRiskStatus();
  }

  /**
   * Get exit manager statistics
   */
  getExitManagerStats() {
    return this.integratedExitManager.getStatistics();
  }

  /**
   * Get configuration
   */
  getConfig(): EnhancedTradeExecutorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EnhancedTradeExecutorConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[EnhancedTradeExecutor] Configuration updated`);
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queueSize: this.executionQueue.length,
      isExecuting: this.isExecuting,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    };
  }
}

/**
 * Phase 5: Trade Quality Scoring (A-F Grades)
 * Evaluates completed trades on P&L, hold efficiency, entry quality, and exit quality.
 * Populates the `tradeQualityScore` DB field.
 */
export function calculateTradeQuality(params: {
  pnlPercent: number;
  holdTimeMinutes: number;
  entryConsensus: number;
  exitReason: string;
}): { grade: 'A' | 'B' | 'C' | 'D' | 'F'; score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  // P&L component (40% weight)
  if (params.pnlPercent >= 1.5) { score += 20; reasons.push('Excellent profit'); }
  else if (params.pnlPercent >= 0.5) { score += 10; reasons.push('Good profit'); }
  else if (params.pnlPercent >= 0) { score += 0; reasons.push('Breakeven'); }
  else if (params.pnlPercent >= -0.5) { score -= 10; reasons.push('Small loss'); }
  else if (params.pnlPercent >= -1.0) { score -= 20; reasons.push('Moderate loss'); }
  else { score -= 30; reasons.push('Large loss'); }

  // Hold time efficiency (20% weight)
  if (params.pnlPercent > 0 && params.holdTimeMinutes < 30) { score += 10; reasons.push('Quick winner'); }
  if (params.pnlPercent < 0 && params.holdTimeMinutes > 20) { score -= 10; reasons.push('Held loser too long'); }

  // Entry quality (20% weight)
  if (params.entryConsensus >= 0.80) { score += 10; reasons.push('Strong consensus entry'); }
  else if (params.entryConsensus < 0.65) { score -= 10; reasons.push('Weak consensus entry'); }

  // Exit quality (20% weight)
  if (params.exitReason.includes('PROFIT_TARGET')) { score += 10; reasons.push('Hit profit target'); }
  else if (params.exitReason.includes('TRAILING_STOP')) { score += 5; reasons.push('Trailing stop (protected profits)'); }
  else if (params.exitReason.includes('HARD_STOP_LOSS')) { score -= 5; reasons.push('Hit stop loss'); }
  else if (params.exitReason.includes('MOMENTUM_CRASH')) { score -= 5; reasons.push('Momentum crash exit'); }
  else if (params.exitReason.includes('CONFIDENCE_DECAY')) { score -= 15; reasons.push('Confidence decay exit'); }

  score = Math.max(0, Math.min(100, score));
  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';

  return { grade, score, reasons };
}

export default EnhancedTradeExecutor;
