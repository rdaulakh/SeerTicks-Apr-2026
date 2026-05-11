/**
 * Trade Executor
 * 
 * Universal execution engine that routes trade recommendations to either
 * PaperTradingEngine or RealTradingEngine based on user configuration.
 * 
 * Features:
 * - Automatic strategy detection (21 strategies)
 * - Risk validation before execution
 * - Position size calculation
 * - Stop loss / take profit placement
 * - Real-time P&L tracking
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { PaperTradingEngine, PaperTradingConfig } from './PaperTradingEngine';
import { RealTradingEngine, RealTradingConfig } from './RealTradingEngine';
import { StrategyRouter, DetectedStrategy } from './StrategyRouter';
import { PreTradeRiskValidator, type PreTradeRequest } from '../risk/PreTradeRiskValidator';
import { executionLogger } from '../utils/logger';
import { getRegimePerformanceTracker } from '../services/RegimePerformanceTracker';

export interface TradeRecommendation {
  symbol: string;
  exchange: 'binance' | 'coinbase';
  action: 'buy' | 'sell' | 'hold';
  confidence: number; // 0-100
  executionScore: number; // 0-100
  positionSize: number; // Percentage of capital
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  agentSignals: any[];
  timestamp: Date;
}

export interface TradeExecutorConfig {
  userId: number;
  mode: 'paper' | 'real';
  totalCapital: number;
  exchange: 'binance' | 'coinbase';
  
  // Paper trading settings
  paperTrading?: {
    initialBalance: number;
    enableSlippage: boolean;
    enableCommission: boolean;
    enableMarketImpact: boolean;
    enableLatency: boolean;
  };
  
  // Real trading settings
  realTrading?: {
    apiKey: string;
    apiSecret: string;
    dryRun: boolean; // Log orders without executing
  };
  
  // Risk management
  maxPositionSize: number; // Max % per trade (default: 20%)
  maxConcurrentPositions: number; // Max open positions (default: 5)
  dailyLossLimit: number; // Circuit breaker % (default: 5%)
  enableAutoTrading: boolean; // Auto-execute recommendations
}

export class TradeExecutor extends EventEmitter {
  private config: TradeExecutorConfig;
  private paperEngine?: PaperTradingEngine;
  private realEngine?: RealTradingEngine;
  private strategyRouter: StrategyRouter;
  private dailyPnL: number = 0;
  private dailyPnLResetTime: Date;
  private isCircuitBreakerTriggered: boolean = false;

  constructor(config: TradeExecutorConfig) {
    super();
    this.config = config;
    this.strategyRouter = new StrategyRouter();
    this.dailyPnLResetTime = this.getNextDayStart();

    // Initialize appropriate engine
    if (config.mode === 'paper') {
      this.initializePaperEngine();
    } else {
      this.initializeRealEngine();
    }

    executionLogger.info('TradeExecutor initialized', { mode: config.mode, userId: config.userId });
  }

  /**
   * Initialize paper trading engine
   */
  private initializePaperEngine(): void {
    const paperConfig: PaperTradingConfig = {
      userId: this.config.userId,
      initialBalance: this.config.paperTrading?.initialBalance || 10000,
      exchange: this.config.exchange,
      enableSlippage: this.config.paperTrading?.enableSlippage ?? true,
      enableCommission: this.config.paperTrading?.enableCommission ?? true,
      enableMarketImpact: this.config.paperTrading?.enableMarketImpact ?? true,
      enableLatency: this.config.paperTrading?.enableLatency ?? true,
    };

    this.paperEngine = new PaperTradingEngine(paperConfig);

    // Forward events
    this.paperEngine.on('order_filled', (order) => this.emit('order_filled', order));
    this.paperEngine.on('position_opened', (position) => this.emit('position_opened', position));
    this.paperEngine.on('position_closed', (data) => {
      this.emit('position_closed', data);
      this.updateDailyPnL(data.pnl);
      this.recordRegimePerformance(data);
    });
    this.paperEngine.on('wallet_updated', (wallet) => this.emit('wallet_updated', wallet));
  }

  /**
   * Initialize real trading engine
   */
  private initializeRealEngine(): void {
    if (!this.config.realTrading) {
      throw new Error('Real trading configuration is required for real mode');
    }

    const realConfig: RealTradingConfig = {
      userId: this.config.userId,
      exchange: this.config.exchange,
      apiKey: this.config.realTrading.apiKey,
      apiSecret: this.config.realTrading.apiSecret,
      dryRun: this.config.realTrading.dryRun,
    };

    this.realEngine = new RealTradingEngine(realConfig);

    // Forward events
    this.realEngine.on('order_filled', (order) => this.emit('order_filled', order));
    this.realEngine.on('position_opened', (position) => this.emit('position_opened', position));
    this.realEngine.on('position_closed', (data) => {
      this.emit('position_closed', data);
      this.updateDailyPnL(data.pnl);
      this.recordRegimePerformance(data);
    });
  }

  /**
   * Process trade recommendation from StrategyOrchestrator
   */
  async processRecommendation(recommendation: TradeRecommendation): Promise<void> {
    try {
      // Check circuit breaker
      if (this.isCircuitBreakerTriggered) {
        executionLogger.warn('Circuit breaker active, recommendation ignored');
        this.emit('recommendation_rejected', {
          reason: 'circuit_breaker',
          recommendation,
        });
        return;
      }

      // Check if auto-trading is enabled
      if (!this.config.enableAutoTrading) {
        executionLogger.info('Auto-trading disabled, recommendation logged only');
        this.emit('recommendation_logged', recommendation);
        return;
      }

      // Ignore HOLD recommendations
      if (recommendation.action === 'hold') {
        return;
      }

      // Detect strategy
      const detectedStrategy = this.strategyRouter.detectStrategy(recommendation);
      executionLogger.info('Strategy detected', { strategy: detectedStrategy.name, confidence: detectedStrategy.confidence });

      // Validate recommendation
      const validation = await this.validateRecommendation(recommendation);
      if (!validation.valid) {
        executionLogger.warn('Recommendation rejected', { reason: validation.reason });
        this.emit('recommendation_rejected', {
          reason: validation.reason,
          recommendation,
        });
        return;
      }

      // Execute trade
      if (recommendation.action === 'buy') {
        await this.executeBuy(recommendation, detectedStrategy);
      } else if (recommendation.action === 'sell') {
        await this.executeSell(recommendation, detectedStrategy);
      }

    } catch (error) {
      executionLogger.error('Error processing recommendation', { error: (error as Error)?.message });
      this.emit('execution_error', { recommendation, error });
    }
  }

  /**
   * Validate recommendation before execution
   */
  private async validateRecommendation(recommendation: TradeRecommendation): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    // Check confidence threshold
    if (recommendation.confidence < 50) {
      return { valid: false, reason: 'confidence_too_low' };
    }

    // Check position size
    if (recommendation.positionSize > this.config.maxPositionSize) {
      return { valid: false, reason: 'position_size_too_large' };
    }

    // Check concurrent positions
    const openPositions = this.getOpenPositions();
    if (openPositions.length >= this.config.maxConcurrentPositions) {
      return { valid: false, reason: 'max_positions_reached' };
    }

    // Check daily loss limit
    if (this.dailyPnL < -this.config.dailyLossLimit) {
      this.triggerCircuitBreaker();
      return { valid: false, reason: 'daily_loss_limit_exceeded' };
    }

    // ✅ P0-1 FIX: Check sufficient balance (CRITICAL)
    const wallet = this.getWallet();
    if (wallet.balance <= 0) {
      executionLogger.error('Insufficient balance', { balance: wallet.balance.toFixed(2) });
      return { valid: false, reason: 'insufficient_balance' };
    }

    // ✅ CRITICAL FIX: Use available balance (balance - margin) for position sizing
    const availableBalance = wallet.balance - (wallet.margin || 0);
    
    if (availableBalance <= 0) {
      executionLogger.error('No available balance', { totalBalance: wallet.balance.toFixed(2), margin: (wallet.margin || 0).toFixed(2) });
      return { valid: false, reason: 'no_available_balance' };
    }

    // Calculate required capital for this trade based on AVAILABLE balance
    const requiredCapital = availableBalance * (recommendation.positionSize / 100);
    const minTradeSize = 10; // $10 minimum trade size
    
    if (requiredCapital < minTradeSize) {
      executionLogger.warn('Position size too small', { required: requiredCapital.toFixed(2), minimum: minTradeSize, available: availableBalance.toFixed(2) });
      return { valid: false, reason: 'position_size_below_minimum' };
    }

    // Emergency circuit breaker: Balance below 10% of initial capital
    if (wallet.balance < this.config.totalCapital * 0.1) {
      executionLogger.error('Emergency stop: balance below 10% of initial capital', { balance: wallet.balance.toFixed(2), initialCapital: this.config.totalCapital.toFixed(2) });
      this.triggerCircuitBreaker();
      return { valid: false, reason: 'balance_below_emergency_threshold' };
    }

    // 🚀 NEW: Advanced Pre-Trade Risk Validation
    try {
      const quantity = this.calculateQuantity(recommendation);
      const portfolioVaR = this.calculatePortfolioVaR(); // Simplified VaR calculation
      
      const validator = new PreTradeRiskValidator(
        this.config.totalCapital,
        wallet.balance,
        openPositions.length,
        portfolioVaR
      );

      const preTradeRequest: PreTradeRequest = {
        userId: this.config.userId,
        symbol: recommendation.symbol,
        side: recommendation.action === 'buy' ? 'long' : 'short',
        requestedQuantity: quantity,
        currentPrice: recommendation.entryPrice,
        confidence: recommendation.confidence / 100, // Convert to 0-1 range
      };

      const validationResult = await validator.validateTrade(preTradeRequest);

      if (!validationResult.passed) {
        executionLogger.warn('Pre-trade validation failed', { rejectionReasons: validationResult.rejectionReasons, riskScore: validationResult.overallRiskScore, recommendedAction: validationResult.recommendedAction });
        return { 
          valid: false, 
          reason: `pre_trade_validation_failed: ${validationResult.rejectionReasons[0]}` 
        };
      }

      if (validationResult.requiresApproval) {
        executionLogger.warn('Trade requires manual approval', { riskScore: validationResult.overallRiskScore });
        this.emit('trade_requires_approval', {
          recommendation,
          validationResult,
        });
        return { valid: false, reason: 'requires_manual_approval' };
      }

      executionLogger.info('Pre-trade validation passed', { riskScore: validationResult.overallRiskScore });
    } catch (error) {
      executionLogger.error('Pre-trade validation error', { error: (error as Error)?.message });
      // Continue with trade if validation fails (fail-open for now)
    }

    return { valid: true };
  }

  /**
   * Calculate portfolio VaR (simplified)
   */
  private calculatePortfolioVaR(): number {
    const openPositions = this.getOpenPositions();
    let totalVaR = 0;

    for (const position of openPositions) {
      const positionValue = position.quantity * position.currentPrice;
      const volatility = 0.02; // 2% daily volatility assumption
      const positionVaR = positionValue * volatility * 2; // 95% confidence
      totalVaR += positionVaR;
    }

    return totalVaR;
  }

  /**
   * Execute buy order
   */
  private async executeBuy(recommendation: TradeRecommendation, strategy: DetectedStrategy): Promise<void> {
    const quantity = this.calculateQuantity(recommendation);

    if (this.config.mode === 'paper' && this.paperEngine) {
      await this.paperEngine.placeOrder({
        symbol: recommendation.symbol,
        type: 'market',
        side: 'buy',
        quantity,
        price: recommendation.entryPrice,
        strategy: strategy.name,
      });
    } else if (this.config.mode === 'real' && this.realEngine) {
      await this.realEngine.placeOrder({
        symbol: recommendation.symbol,
        type: 'market',
        side: 'buy',
        quantity,
        price: recommendation.entryPrice,
        stopLoss: recommendation.stopLoss,
        takeProfit: recommendation.targetPrice,
        strategy: strategy.name,
      });
    }

    executionLogger.info('BUY order executed', { quantity, symbol: recommendation.symbol, price: recommendation.entryPrice.toFixed(2) });
  }

  /**
   * Execute sell order
   */
  private async executeSell(recommendation: TradeRecommendation, strategy: DetectedStrategy): Promise<void> {
    const openPositions = this.getOpenPositions().filter(p => p.symbol === recommendation.symbol);
    
    if (openPositions.length === 0) {
      executionLogger.warn('No open position for symbol, sell ignored', { symbol: recommendation.symbol });
      return;
    }

    const position = openPositions[0];
    const quantity = position.quantity;

    if (this.config.mode === 'paper' && this.paperEngine) {
      await this.paperEngine.placeOrder({
        symbol: recommendation.symbol,
        type: 'market',
        side: 'sell',
        quantity,
        price: recommendation.entryPrice,
        strategy: strategy.name,
      });
    } else if (this.config.mode === 'real' && this.realEngine) {
      await this.realEngine.placeOrder({
        symbol: recommendation.symbol,
        type: 'market',
        side: 'sell',
        quantity,
        price: recommendation.entryPrice,
        strategy: strategy.name,
      });
    }

    executionLogger.info('SELL order executed', { quantity, symbol: recommendation.symbol, price: recommendation.entryPrice.toFixed(2) });
  }

  /**
   * Calculate position quantity based on position size percentage
   * ✅ CRITICAL FIX: Use available balance (balance - margin) for position sizing
   */
  private calculateQuantity(recommendation: TradeRecommendation): number {
    const wallet = this.getWallet();
    // Use available balance, not total balance
    const availableBalance = wallet.balance - (wallet.margin || 0);
    const positionValue = availableBalance * (recommendation.positionSize / 100);
    const quantity = positionValue / recommendation.entryPrice;
    
    executionLogger.debug('Position sizing', { available: availableBalance.toFixed(2), sizePercent: recommendation.positionSize, value: positionValue.toFixed(2), quantity: quantity.toFixed(8) });
    
    return Math.floor(quantity * 100000000) / 100000000; // Round to 8 decimals
  }

  /**
   * Get current wallet
   */
  getWallet(): any {
    if (this.config.mode === 'paper' && this.paperEngine) {
      return this.paperEngine.getWallet();
    } else if (this.config.mode === 'real' && this.realEngine) {
      return this.realEngine.getWallet();
    }
    
    return {
      balance: 0,
      equity: 0,
      totalPnL: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
    };
  }

  /**
   * Get open positions
   */
  getOpenPositions(): any[] {
    if (this.config.mode === 'paper' && this.paperEngine) {
      return this.paperEngine.getPositions();
    } else if (this.config.mode === 'real' && this.realEngine) {
      return this.realEngine.getPositions();
    }
    
    return [];
  }

  /**
   * Get order history
   */
  getOrderHistory(): any[] {
    if (this.config.mode === 'paper' && this.paperEngine) {
      return this.paperEngine.getOrderHistory();
    } else if (this.config.mode === 'real' && this.realEngine) {
      return this.realEngine.getOrderHistory();
    }
    
    return [];
  }

  /**
   * Update position prices
   */
  async updatePositionPrices(prices: Map<string, number>): Promise<void> {
    if (this.config.mode === 'paper' && this.paperEngine) {
      await this.paperEngine.updatePositionPrices(prices);
    } else if (this.config.mode === 'real' && this.realEngine) {
      await this.realEngine.updatePositionPrices(prices);
    }
  }

  /**
   * Update daily P&L and check circuit breaker
   */
  private updateDailyPnL(pnl: number): void {
    // Reset daily P&L at start of new day
    if (new Date() >= this.dailyPnLResetTime) {
      this.dailyPnL = 0;
      this.dailyPnLResetTime = this.getNextDayStart();
      this.isCircuitBreakerTriggered = false;
      executionLogger.info('Daily P&L reset');
    }

    this.dailyPnL += pnl;

    // Check circuit breaker
    const lossPercent = (this.dailyPnL / this.config.totalCapital) * 100;
    if (lossPercent < -this.config.dailyLossLimit) {
      this.triggerCircuitBreaker();
    }
  }

  /**
   * Trigger circuit breaker
   */
  private triggerCircuitBreaker(): void {
    if (!this.isCircuitBreakerTriggered) {
      this.isCircuitBreakerTriggered = true;
      executionLogger.error('CIRCUIT BREAKER TRIGGERED: daily loss limit exceeded', { dailyPnL: this.dailyPnL.toFixed(2) });
      this.emit('circuit_breaker_triggered', {
        dailyPnL: this.dailyPnL,
        lossPercent: (this.dailyPnL / this.config.totalCapital) * 100,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Get next day start time
   */
  private getNextDayStart(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Emergency stop - close all positions
   */
  async emergencyStop(): Promise<void> {
    executionLogger.warn('EMERGENCY STOP TRIGGERED');
    
    const prices = new Map<string, number>();
    const positions = this.getOpenPositions();
    
    // Get current prices for all positions
    for (const position of positions) {
      prices.set(position.symbol, position.currentPrice);
    }

    if (this.config.mode === 'paper' && this.paperEngine) {
      await this.paperEngine.closeAllPositions(prices, 'emergency_stop');
    } else if (this.config.mode === 'real' && this.realEngine) {
      await this.realEngine.closeAllPositions(prices, 'emergency_stop');
    }

    this.emit('emergency_stop_completed', {
      positionsClosed: positions.length,
      timestamp: new Date(),
    });
  }

  /**
   * Add virtual USD to paper trading wallet
   */
  addPaperFunds(amount: number): void {
    if (this.config.mode !== 'paper' || !this.paperEngine) {
      throw new Error('Can only add funds in paper trading mode');
    }

    this.paperEngine.addFunds(amount);
  }

  /**
   * Remove virtual USD from paper trading wallet
   */
  removePaperFunds(amount: number): void {
    if (this.config.mode !== 'paper' || !this.paperEngine) {
      throw new Error('Can only remove funds in paper trading mode');
    }

    this.paperEngine.removeFunds(amount);
  }

  /**
   * Reset paper trading account
   */
  resetPaperAccount(): void {
    if (this.config.mode !== 'paper' || !this.paperEngine) {
      throw new Error('Can only reset in paper trading mode');
    }

    this.paperEngine.reset();
    this.dailyPnL = 0;
    this.isCircuitBreakerTriggered = false;
  }

  /**
   * Phase 36: Record trade outcome in RegimePerformanceTracker.
   * Gets the current regime from MarketRegimeAI and records the trade.
   */
  private recordRegimePerformance(data: { position: any; pnl: number; pnlPercent: number }): void {
    try {
      const tracker = getRegimePerformanceTracker();
      // Get current regime asynchronously
      import('../services/MarketRegimeAI').then(({ getMarketRegimeAI }) => {
        const regimeAI = getMarketRegimeAI();
        const symbol = data.position?.symbol || 'unknown';
        regimeAI.getMarketContext(symbol).then((ctx) => {
          tracker.recordTrade({
            symbol,
            regime: ctx.regime || 'unknown',
            direction: data.position?.side || 'long',
            entryPrice: data.position?.entryPrice || 0,
            exitPrice: data.position?.currentPrice || 0,
            pnl: data.pnl,
            pnlPercent: data.pnlPercent,
            stopLoss: data.position?.stopLoss,
            entryTime: data.position?.entryTime || getActiveClock().now(),
            strategy: data.position?.strategy || 'unknown',
          });
          executionLogger.info('Regime performance recorded', { symbol, regime: ctx.regime, pnl: data.pnl });
        }).catch(() => {
          // Fallback: record without regime
          tracker.recordTrade({
            symbol,
            regime: 'unknown',
            direction: data.position?.side || 'long',
            entryPrice: data.position?.entryPrice || 0,
            exitPrice: data.position?.currentPrice || 0,
            pnl: data.pnl,
            pnlPercent: data.pnlPercent,
            stopLoss: data.position?.stopLoss,
            entryTime: data.position?.entryTime || getActiveClock().now(),
            strategy: data.position?.strategy || 'unknown',
          });
        });
      }).catch(() => {
        // Silently fail if MarketRegimeAI not available
      });
    } catch (err) {
      // Non-critical: don't break trade flow
    }
  }

  getPerformanceMetrics(): any {
    const wallet = this.getWallet();
    const positions = this.getOpenPositions();
    const orders = this.getOrderHistory();
    return {
      wallet,
      openPositions: positions.length,
      totalTrades: wallet.totalTrades || 0,
      winRate: wallet.winRate || 0,
      totalPnL: wallet.totalPnL || 0,
      realizedPnL: wallet.realizedPnL || 0,
      unrealizedPnL: wallet.unrealizedPnL || 0,
      dailyPnL: this.dailyPnL,
      circuitBreakerActive: this.isCircuitBreakerTriggered,
      mode: this.config.mode,
    };
  }
}
