import { EventEmitter } from "events";
import type { ProcessedSignal } from "./AutomatedSignalProcessor";
import type { PaperTradingEngine } from "../execution/PaperTradingEngine";
import type { ITradingEngine } from "../execution/ITradingEngine";
import type { PositionManager } from "../PositionManager";
import type { RiskManager } from "../RiskManager";
import { getPaperWallet } from "../db";
import { calculateATRStopLoss, calculateATRTakeProfit, detectMarketRegime } from "../utils/RiskCalculations";
import type { ExchangeInterface } from "../exchanges";
import type { IntelligentExitManager } from "./IntelligentExitManager";
import { tradeDecisionLogger } from "./tradeDecisionLogger";
import { latencyLogger } from "./LatencyLogger";

/**
 * Automated Trade Executor
 * 
 * Executes trades automatically based on approved signals from AutomatedSignalProcessor.
 * NO manual approval required - this is institutional-grade autonomous trading.
 * 
 * Features:
 * - Automatic position sizing (Kelly Criterion)
 * - Automatic stop-loss and take-profit calculation
 * - Risk validation before execution
 * - Immediate trade execution via PaperTradingEngine
 * - Complete audit trail
 * 
 * @fires trade_executed - When a trade is successfully executed
 * @fires trade_rejected - When a trade is rejected due to risk limits
 * @fires trade_error - When a trade execution fails
 */
export class AutomatedTradeExecutor extends EventEmitter {
  private userId: number;
  private tradingEngine: ITradingEngine | null = null;
  private paperTradingEngine: PaperTradingEngine | null = null;
  private positionManager: PositionManager | null = null;
  private riskManager: RiskManager | null = null;
  private exchange: ExchangeInterface | null = null;
  private intelligentExitManager: IntelligentExitManager | null = null;
  
  // Configuration
  private maxPositionSize: number = 0.20; // 20% of available balance per trade
  private defaultStopLoss: number = 0.05; // 5% stop-loss
  private defaultTakeProfit: number = 0.10; // 10% take-profit
  private maxPositions: number = 10; // Maximum concurrent positions
  private riskPerTrade: number = 0.02; // 2% risk per trade
  
  private isExecuting: boolean = false;
  private executionQueue: ProcessedSignal[] = [];
  private readonly MAX_QUEUE_SIZE = 100;

  constructor(userId: number, config?: {
    maxPositionSize?: number;
    defaultStopLoss?: number;
    defaultTakeProfit?: number;
    maxPositions?: number;
    riskPerTrade?: number;
  }) {
    super();
    this.userId = userId;
    
    if (config) {
      if (config.maxPositionSize !== undefined) this.maxPositionSize = config.maxPositionSize;
      if (config.defaultStopLoss !== undefined) this.defaultStopLoss = config.defaultStopLoss;
      if (config.defaultTakeProfit !== undefined) this.defaultTakeProfit = config.defaultTakeProfit;
      if (config.maxPositions !== undefined) this.maxPositions = config.maxPositions;
      if (config.riskPerTrade !== undefined) this.riskPerTrade = config.riskPerTrade;
    }
    
    console.log(`[AutomatedTradeExecutor] Initialized for user ${userId}`);
    console.log(`[AutomatedTradeExecutor] Max Position Size: ${(this.maxPositionSize * 100).toFixed(0)}%`);
    console.log(`[AutomatedTradeExecutor] Default Stop-Loss: ${(this.defaultStopLoss * 100).toFixed(0)}%`);
    console.log(`[AutomatedTradeExecutor] Default Take-Profit: ${(this.defaultTakeProfit * 100).toFixed(0)}%`);
    console.log(`[AutomatedTradeExecutor] Max Positions: ${this.maxPositions}`);
    console.log(`[AutomatedTradeExecutor] Risk Per Trade: ${(this.riskPerTrade * 100).toFixed(0)}%`);
  }

  /**
   * Set dependencies
   */
  setDependencies(
    paperTradingEngine: PaperTradingEngine | ITradingEngine,
    positionManager: PositionManager,
    riskManager: RiskManager,
    exchange?: ExchangeInterface,
    intelligentExitManager?: IntelligentExitManager
  ): void {
    this.tradingEngine = paperTradingEngine as ITradingEngine;
    this.paperTradingEngine = paperTradingEngine as PaperTradingEngine;
    this.positionManager = positionManager;
    this.riskManager = riskManager;
    if (exchange) {
      this.exchange = exchange;
    }
    if (intelligentExitManager) {
      this.intelligentExitManager = intelligentExitManager;
      console.log(`[AutomatedTradeExecutor] IntelligentExitManager connected for agent-driven exits`);
    }
    console.log(`[AutomatedTradeExecutor] Dependencies set`);
  }

  /**
   * Queue a signal for automated execution
   */
  async queueSignal(signal: ProcessedSignal): Promise<void> {
    if (this.executionQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[AutomatedTradeExecutor] Queue full (${this.MAX_QUEUE_SIZE}), dropping oldest signal`);
      this.executionQueue.shift();
    }

    this.executionQueue.push(signal);
    console.log(`[AutomatedTradeExecutor] Signal queued for ${signal.symbol} (queue size: ${this.executionQueue.length})`);

    // Process queue immediately
    this.processQueue().catch(err => {
      console.error(`[AutomatedTradeExecutor] Queue processing error:`, err);
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
        
        // Small delay between executions to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute a trading signal automatically
   */
  private async executeSignal(signal: ProcessedSignal): Promise<void> {
    if (!signal.approved || !signal.recommendation) {
      console.warn(`[AutomatedTradeExecutor] Signal not approved or missing recommendation`);
      return;
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
    
    // Record consensus calculation (already done by signal processor)
    latencyLogger.recordConsensus(latencyContextId, recommendation.confidence);
    
    // Record decision made
    latencyLogger.recordDecision(latencyContextId, signal.signalId);

    console.log(`\n========== AUTOMATED TRADE EXECUTION ==========`);
    console.log(`[AutomatedTradeExecutor] Symbol: ${symbol}`);
    console.log(`[AutomatedTradeExecutor] Action: ${recommendation.action.toUpperCase()}`);
    console.log(`[AutomatedTradeExecutor] Confidence: ${(recommendation.confidence * 100).toFixed(1)}%`);
    console.log(`[AutomatedTradeExecutor] Execution Score: ${recommendation.executionScore.toFixed(0)}/100`);

    try {
      // Validate dependencies
      const engine = this.tradingEngine || this.paperTradingEngine;
      if (!engine || !this.positionManager || !this.riskManager) {
        throw new Error('Dependencies not set');
      }

      // Phase 11 CRITICAL FIX: Check RiskManager circuit breaker BEFORE executing
      // Previously, the RiskManager circuit breaker could fire (set isHalted=true)
      // but trades would continue executing because this check was missing.
      if (this.riskManager.isTradingHalted?.()) {
        console.warn('[AutomatedTradeExecutor] 🛑 RiskManager circuit breaker ACTIVE — trade BLOCKED');
        return;
      }

      // Get current wallet balance
      const wallet = await getPaperWallet(this.userId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // DEBUG: Log raw wallet data from database
      console.log(`[AutomatedTradeExecutor] DEBUG Wallet from DB: userId=${this.userId}, balance=${wallet.balance}, margin=${wallet.margin}, equity=${wallet.equity}`);
      
      // ✅ CRITICAL FIX: Use equity as available balance when margin is corrupted
      // If margin >= balance (which is wrong when no positions), use equity instead
      const balance = parseFloat(wallet.balance);
      const margin = parseFloat(wallet.margin);
      const equity = parseFloat(wallet.equity || wallet.balance);
      
      // Check if margin is corrupted (equal to or greater than balance with no positions)
      const openPositions = await this.positionManager.getOpenPositions(this.userId);
      const marginIsCorrupted = margin >= balance * 0.9 && openPositions.length === 0;
      
      // Use equity as available balance - this reflects actual funds after P&L
      // When margin is corrupted, fall back to equity which is the true available amount
      const availableBalance = marginIsCorrupted ? equity : Math.max(balance - margin, equity);
      
      console.log(`[AutomatedTradeExecutor] Available Balance: $${availableBalance.toFixed(2)}`);

      // Check if we have available balance
      if (availableBalance <= 0) {
        this.emit('trade_rejected', {
          symbol,
          reason: 'Insufficient available balance',
          signal,
        });
        console.log(`[AutomatedTradeExecutor] ❌ Trade REJECTED: Insufficient balance`);
        
        // Log as MISSED opportunity
        await this.logMissedOpportunity(signal, 'Insufficient available balance');
        await latencyLogger.recordRejected(latencyContextId, 'rejected');
        return;
      }

      // Check maximum positions limit (reuse openPositions from above)
      if (openPositions.length >= this.maxPositions) {
        this.emit('trade_rejected', {
          symbol,
          reason: `Maximum positions limit reached (${this.maxPositions})`,
          signal,
        });
        console.log(`[AutomatedTradeExecutor] ❌ Trade REJECTED: Max positions (${openPositions.length}/${this.maxPositions})`);
        
        // Log as MISSED opportunity
        await this.logMissedOpportunity(signal, `Maximum positions limit reached (${openPositions.length}/${this.maxPositions})`);
        await latencyLogger.recordRejected(latencyContextId, 'rejected');
        return;
      }

      // Calculate position size using Kelly Criterion
      let positionSize = this.calculatePositionSize(
        availableBalance,
        recommendation.confidence,
        metrics?.avgQualityScore || 0.5
      );

      // Phase 11 FIX: Kelly criterion returns 0 when expected value is negative
      if (positionSize <= 0) {
        console.warn(`[AutomatedTradeExecutor] Position size is $0 (negative EV) — trade REJECTED`);
        await latencyLogger.recordRejected(latencyContextId, 'rejected');
        return;
      }

      // Enforce correlation hedging — reduce position size if correlated positions are open
      let adjustedPositionSize = positionSize;
      try {
        const { getCorrelationHedging } = await import('../hedging/CorrelationHedging');
        const { adjustPositionSizeForCorrelation } = await import('../utils/InstitutionalTrading');
        const correlationHedging = getCorrelationHedging();
        const correlationMatrix = correlationHedging.getCorrelationMatrix();

        if (correlationMatrix.size > 0 && openPositions.length > 0) {
          const existingPositionSizes = openPositions.map(p => ({
            symbol: p.symbol,
            positionSize: Number(p.quantity) * Number(p.currentPrice || p.entryPrice),
          }));

          const correlationResult = adjustPositionSizeForCorrelation(
            positionSize,
            symbol,
            existingPositionSizes,
            correlationMatrix
          );

          if (correlationResult.adjustedSize < positionSize) {
            adjustedPositionSize = correlationResult.adjustedSize;
            console.log(`[AutomatedTradeExecutor] Correlation adjustment: ${correlationResult.reasoning}`);
            console.log(`[AutomatedTradeExecutor] Position size reduced: $${positionSize.toFixed(2)} → $${adjustedPositionSize.toFixed(2)}`);
          }
        }
      } catch (corrError) {
        // Non-critical — proceed with unadjusted position size
        console.warn(`[AutomatedTradeExecutor] Correlation check skipped:`, corrError instanceof Error ? corrError.message : corrError);
      }
      positionSize = adjustedPositionSize;

      console.log(`[AutomatedTradeExecutor] Position Size: $${positionSize.toFixed(2)} (${((positionSize / availableBalance) * 100).toFixed(1)}% of available)`);

      // Validate position size
      if (positionSize <= 0) {
        this.emit('trade_rejected', {
          symbol,
          reason: 'Invalid position size calculated',
          signal,
        });
        console.log(`[AutomatedTradeExecutor] ❌ Trade REJECTED: Invalid position size`);
        
        // Log as MISSED opportunity
        await this.logMissedOpportunity(signal, 'Invalid position size calculated');
        await latencyLogger.recordRejected(latencyContextId, 'rejected');
        return;
      }

      // Calculate ATR-based dynamic stop-loss and take-profit levels
      const currentPrice = await this.getCurrentPrice(symbol);
      const { stopLoss, takeProfit, atr, regime } = await this.calculateDynamicLevels(
        symbol,
        currentPrice,
        recommendation.action
      );

      const stopLossPercent = Math.abs((stopLoss - currentPrice) / currentPrice * 100);
      const takeProfitPercent = Math.abs((takeProfit - currentPrice) / currentPrice * 100);
      
      console.log(`[AutomatedTradeExecutor] Current Price: $${currentPrice.toFixed(2)}`);
      console.log(`[AutomatedTradeExecutor] Market Regime: ${regime}`);
      console.log(`[AutomatedTradeExecutor] ATR: $${atr.toFixed(2)} (${(atr / currentPrice * 100).toFixed(2)}%)`);
      console.log(`[AutomatedTradeExecutor] Stop-Loss: $${stopLoss.toFixed(2)} (${stopLossPercent.toFixed(2)}% - ATR-based)`);
      console.log(`[AutomatedTradeExecutor] Take-Profit: $${takeProfit.toFixed(2)} (${takeProfitPercent.toFixed(2)}% - Risk/Reward optimized)`);

      // Execute trade via PaperTradingEngine
      const quantity = positionSize / currentPrice;
      
      console.log(`[AutomatedTradeExecutor] Quantity: ${quantity.toFixed(8)}`);
      console.log(`[AutomatedTradeExecutor] Executing trade...`);
      
      // Record order placement timestamp
      latencyLogger.recordOrderPlaced(latencyContextId);

      const order = await engine.placeOrder({
        symbol,
        type: 'market',
        side: recommendation.action === 'buy' ? 'buy' : 'sell',
        quantity,
        price: currentPrice, // Pass current price for market order execution
        stopLoss,
        takeProfit,
        strategy: 'automated',
      });

      // CRITICAL: Register position with IntelligentExitManager for agent-driven exits
      // MUST use database position ID, not paper order ID, for exit callback to work
      console.log(`[AutomatedTradeExecutor] 📝 Attempting to register position with exit manager...`);
      console.log(`[AutomatedTradeExecutor] - intelligentExitManager exists: ${!!this.intelligentExitManager}`);
      console.log(`[AutomatedTradeExecutor] - order.filledPrice: ${order.filledPrice}`);
      console.log(`[AutomatedTradeExecutor] - order.id: ${order.id}`);
      console.log(`[AutomatedTradeExecutor] - currentPrice fallback: ${currentPrice}`);
      
      // Declare dbPositionId at higher scope so it's available for trade decision logging
      let dbPositionId: string = order.id; // Fallback to order ID
      
      if (this.intelligentExitManager) {
        // Always register - use currentPrice as fallback if filledPrice is missing
        const entryPrice = order.filledPrice || currentPrice;
        
        try {
          // ✅ CRITICAL FIX: Query database to get the actual position ID
          // The executeExit callback uses database IDs, not paper order IDs
          const { getDb } = await import('../db');
          const { paperPositions } = await import('../../drizzle/schema');
          const { eq, and, desc } = await import('drizzle-orm');
          
          const db = await getDb();
          
          if (db) {
            // Get the most recently created position for this user and symbol
            const [latestPosition] = await db.select().from(paperPositions)
              .where(and(
                eq(paperPositions.userId, this.userId),
                eq(paperPositions.symbol, symbol),
                eq(paperPositions.status, 'open')
              ))
              .orderBy(desc(paperPositions.id))
              .limit(1);
            
            if (latestPosition) {
              dbPositionId = String(latestPosition.id);
              console.log(`[AutomatedTradeExecutor] ✅ Found database position ID: ${dbPositionId}`);
              
              // ✅ CRITICAL FIX: Save consensus data to database for confidence decay exit
              const consensusValue = recommendation.confidence.toString();
              await db.update(paperPositions)
                .set({
                  originalConsensus: consensusValue,
                  currentConfidence: consensusValue,
                  peakConfidence: consensusValue,
                  peakConfidenceTime: new Date(),
                })
                .where(eq(paperPositions.id, latestPosition.id));
              console.log(`[AutomatedTradeExecutor] ✅ Consensus data saved: ${(recommendation.confidence * 100).toFixed(1)}%`);
            } else {
              console.warn(`[AutomatedTradeExecutor] ⚠️ Could not find position in database, using order ID: ${order.id}`);
            }
          }
          
          // Calculate ATR for dynamic trailing
          let positionAtr: number | undefined;
          if (this.exchange) {
            const candles = await this.exchange.getMarketData(symbol, '1h', 15);
            if (candles && candles.length >= 14) {
              const { calculateATR } = await import('../utils/RiskCalculations');
              positionAtr = calculateATR(candles);
            }
          }
          
          this.intelligentExitManager.addPosition({
            id: dbPositionId, // ✅ Use database position ID
            symbol,
            side: recommendation.action === 'buy' ? 'long' : 'short',
            entryPrice,
            currentPrice: entryPrice,
            quantity,
            remainingQuantity: quantity,
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            entryTime: Date.now(),
            marketRegime: regime,
            originalConsensus: recommendation.confidence,
            atr: positionAtr || atr, // Use calculated ATR or the one from earlier
            // Phase 32: Pass TP/SL for enforcement
            stopLoss,
            takeProfit,
          });
          console.log(`[AutomatedTradeExecutor] ✅ Position ${dbPositionId} registered with IntelligentExitManager at $${entryPrice.toFixed(2)}`);
        } catch (exitManagerError) {
          console.error(`[AutomatedTradeExecutor] ❌ Failed to register position with IntelligentExitManager:`, exitManagerError);
        }
      } else {
        console.warn(`[AutomatedTradeExecutor] ⚠️ IntelligentExitManager not available - position ${order.id} will NOT be monitored for exits!`);
      }

      const executionTime = Date.now() - startTime;
      
      // Record order filled for latency tracking
      await latencyLogger.recordOrderFilled(latencyContextId, order.filledPrice || currentPrice, 'executed');

      console.log(`[AutomatedTradeExecutor] ✅ Trade EXECUTED in ${executionTime}ms`);
      console.log(`[AutomatedTradeExecutor] Order ID: ${order.id}`);
      console.log(`[AutomatedTradeExecutor] Entry Price: $${order.filledPrice?.toFixed(2) || 'N/A'}`);
      console.log(`==============================================\n`);

      // CRITICAL FIX: Update trade decision log with execution details
      // This links the EXECUTED decision to the actual position created
      if (signal.signalId) {
        try {
          await tradeDecisionLogger.updateExecution({
            signalId: signal.signalId,
            positionId: parseInt(dbPositionId) || undefined,
            orderId: order.id,
            entryPrice: order.filledPrice || currentPrice,
            quantity,
            positionSizePercent: (positionSize / availableBalance) * 100,
          });
          console.log(`[AutomatedTradeExecutor] ✅ Updated trade decision log: ${signal.signalId}`);
        } catch (logError) {
          console.error(`[AutomatedTradeExecutor] Failed to update trade decision log:`, logError);
        }
      }

      this.emit('trade_executed', {
        symbol,
        order,
        signal,
        executionTime,
        positionSize,
        stopLoss,
        takeProfit,
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Record failed execution for latency tracking
      await latencyLogger.recordOrderFilled(latencyContextId, undefined, 'failed');
      
      console.error(`[AutomatedTradeExecutor] ❌ Trade FAILED after ${executionTime}ms:`, error);
      console.log(`==============================================\n`);

      this.emit('trade_error', {
        symbol,
        error,
        signal,
        executionTime,
      });
    }
  }

  /**
   * Calculate optimal position size using Kelly Criterion
   */
  private calculatePositionSize(
    availableBalance: number,
    confidence: number,
    qualityScore: number
  ): number {
    // Kelly Criterion: f = (bp - q) / b
    // where:
    // f = fraction of capital to wager
    // b = odds received on the wager (take-profit / stop-loss ratio)
    // p = probability of winning (confidence * qualityScore)
    // q = probability of losing (1 - p)

    const oddsRatio = this.defaultTakeProfit / this.defaultStopLoss; // e.g., 10% / 5% = 2.0
    const winProbability = confidence * qualityScore; // Adjust confidence by quality
    const lossProbability = 1 - winProbability;

    let kellyFraction = (oddsRatio * winProbability - lossProbability) / oddsRatio;

    // Apply fractional Kelly (use 50% of full Kelly to reduce volatility)
    kellyFraction = kellyFraction * 0.5;

    // Clamp to maximum position size
    kellyFraction = Math.min(kellyFraction, this.maxPositionSize);

    // Phase 11 CRITICAL FIX: When Kelly fraction is negative, it means negative expected value.
    // Previously forced to 0.01 (1%) minimum = guaranteed losing trades.
    // Now: if Kelly says "don't bet" (negative or zero), reject the trade.
    if (kellyFraction <= 0) {
      console.warn(`[AutomatedTradeExecutor] Kelly fraction ≤ 0 (${(kellyFraction * 100).toFixed(2)}%) — negative EV, REJECTING trade`);
      return 0; // Caller must check for 0 and skip the trade
    }
    kellyFraction = Math.max(kellyFraction, 0.005); // Floor at 0.5% for viable trades only

    const positionSize = availableBalance * kellyFraction;

    console.log(`[AutomatedTradeExecutor] Kelly Calculation:`);
    console.log(`  - Win Probability: ${(winProbability * 100).toFixed(1)}%`);
    console.log(`  - Odds Ratio: ${oddsRatio.toFixed(2)}`);
    console.log(`  - Kelly Fraction: ${(kellyFraction * 100).toFixed(1)}%`);

    return positionSize;
  }

  /**
   * Calculate ATR-based dynamic stop-loss and take-profit levels
   * Uses market volatility (ATR) and regime to set optimal levels
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
      // Fetch candle data to calculate ATR
      if (!this.exchange) {
        // Fallback to static if no exchange available
        console.warn(`[AutomatedTradeExecutor] No exchange available, using static stop-loss`);
        return {
          stopLoss: action === 'buy' ? currentPrice * (1 - this.defaultStopLoss) : currentPrice * (1 + this.defaultStopLoss),
          takeProfit: action === 'buy' ? currentPrice * (1 + this.defaultTakeProfit) : currentPrice * (1 - this.defaultTakeProfit),
          atr: currentPrice * this.defaultStopLoss, // Approximate ATR
          regime: 'unknown'
        };
      }

      // Get 1-hour candles for ATR calculation (need 15+ candles)
      const candles = await this.exchange.getMarketData(symbol, '1h', 20);
      
      if (candles.length < 15) {
        console.warn(`[AutomatedTradeExecutor] Insufficient candle data (${candles.length}), using static stop-loss`);
        return {
          stopLoss: action === 'buy' ? currentPrice * (1 - this.defaultStopLoss) : currentPrice * (1 + this.defaultStopLoss),
          takeProfit: action === 'buy' ? currentPrice * (1 + this.defaultTakeProfit) : currentPrice * (1 - this.defaultTakeProfit),
          atr: currentPrice * this.defaultStopLoss,
          regime: 'unknown'
        };
      }

      // Calculate ATR (14-period)
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

      // Detect market regime
      const closes = candles.map(c => c.close);
      const sma50 = closes.slice(-50).reduce((sum, c) => sum + c, 0) / Math.min(closes.length, 50);
      const sma200 = closes.slice(-200).reduce((sum, c) => sum + c, 0) / Math.min(closes.length, 200);
      const avgATR = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
      
      const regime = detectMarketRegime(currentPrice, sma50, sma200, atr, avgATR);

      // Regime-aware volatility multiplier
      let volatilityMultiplier: number;
      let riskRewardRatio: number;
      
      switch (regime) {
        case 'trending_up':
        case 'trending_down':
          volatilityMultiplier = 2.5; // Wider stops in trends
          riskRewardRatio = 2.5; // Higher reward in trends
          break;
        case 'high_volatility':
          volatilityMultiplier = 3.0; // Widest stops in volatile markets
          riskRewardRatio = 2.0; // Conservative reward
          break;
        case 'range_bound':
        default:
          volatilityMultiplier = 2.0; // Standard stops
          riskRewardRatio = 2.0; // Standard reward
      }

      // Calculate ATR-based stop-loss
      const side = action === 'buy' ? 'long' : 'short';
      const stopLoss = calculateATRStopLoss(currentPrice, atr, side, volatilityMultiplier);
      
      // Calculate take-profit based on risk/reward ratio
      const takeProfit = calculateATRTakeProfit(currentPrice, stopLoss, side, riskRewardRatio);

      console.log(`[AutomatedTradeExecutor] ATR Calculation: ${atr.toFixed(2)} (${(atr/currentPrice*100).toFixed(2)}%)`);
      console.log(`[AutomatedTradeExecutor] Regime: ${regime}, Multiplier: ${volatilityMultiplier}x, R:R ${riskRewardRatio}:1`);

      return {
        stopLoss,
        takeProfit,
        atr,
        regime
      };

    } catch (error) {
      console.error(`[AutomatedTradeExecutor] Failed to calculate ATR-based levels:`, error);
      // Fallback to static calculation
      return {
        stopLoss: action === 'buy' ? currentPrice * (1 - this.defaultStopLoss) : currentPrice * (1 + this.defaultStopLoss),
        takeProfit: action === 'buy' ? currentPrice * (1 + this.defaultTakeProfit) : currentPrice * (1 - this.defaultTakeProfit),
        atr: currentPrice * this.defaultStopLoss,
        regime: 'error'
      };
    }
  }

  /**
   * Get current price for a symbol
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    // Use price feed service to get latest price
    const { priceFeedService } = await import('./priceFeedService');
    const prices = priceFeedService.getPrices([symbol]);
    const price = prices.get(symbol);
    
    if (!price) {
      throw new Error(`No price available for ${symbol}`);
    }

    return price.price;
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    maxPositionSize?: number;
    defaultStopLoss?: number;
    defaultTakeProfit?: number;
    maxPositions?: number;
    riskPerTrade?: number;
  }): void {
    if (config.maxPositionSize !== undefined) this.maxPositionSize = config.maxPositionSize;
    if (config.defaultStopLoss !== undefined) this.defaultStopLoss = config.defaultStopLoss;
    if (config.defaultTakeProfit !== undefined) this.defaultTakeProfit = config.defaultTakeProfit;
    if (config.maxPositions !== undefined) this.maxPositions = config.maxPositions;
    if (config.riskPerTrade !== undefined) this.riskPerTrade = config.riskPerTrade;
    
    console.log(`[AutomatedTradeExecutor] Configuration updated`);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      maxPositionSize: this.maxPositionSize,
      defaultStopLoss: this.defaultStopLoss,
      defaultTakeProfit: this.defaultTakeProfit,
      maxPositions: this.maxPositions,
      riskPerTrade: this.riskPerTrade,
    };
  }

  /**
   * Get execution queue status
   */
  getQueueStatus() {
    return {
      queueSize: this.executionQueue.length,
      isExecuting: this.isExecuting,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    };
  }

  /**
   * Log a missed trade opportunity to the trade decision log
   * This is called when a signal was approved but the trade couldn't be executed
   */
  private async logMissedOpportunity(signal: ProcessedSignal, reason: string): Promise<void> {
    try {
      const { recommendation, metrics, consensus, symbol } = signal;
      
      if (!recommendation) {
        console.warn('[AutomatedTradeExecutor] Cannot log missed opportunity: no recommendation');
        return;
      }

      // Build agent scores from the signal
      const agentScores: Record<string, { score: number; weight: number; signal: 'BUY' | 'SELL' | 'HOLD'; confidence: number }> = {};
      for (const s of signal.signals) {
        agentScores[s.agentName] = {
          score: s.confidence * 100,
          weight: 0.1, // Default weight
          signal: s.signal === 'bullish' ? 'BUY' : s.signal === 'bearish' ? 'SELL' : 'HOLD',
          confidence: s.confidence * 100,
        };
      }

      // Get current price
      let currentPrice = 0;
      try {
        currentPrice = await this.getCurrentPrice(symbol);
      } catch {
        // Use price from signal if available
        currentPrice = signal.signals[0]?.evidence?.currentPrice || 0;
      }

      await tradeDecisionLogger.logDecision({
        userId: this.userId,
        symbol,
        exchange: 'coinbase',
        price: currentPrice,
        signalType: recommendation.action === 'buy' ? 'BUY' : 'SELL',
        totalConfidence: (recommendation.confidence || 0) * 100,
        threshold: 65, // Default threshold
        agentScores,
        decision: 'SKIPPED', // This will be marked as OPPORTUNITY_MISSED since confidence >= threshold
        decisionReason: `MISSED: ${reason}`,
      });

      console.log(`[AutomatedTradeExecutor] Logged MISSED opportunity: ${symbol} - ${reason}`);
    } catch (error) {
      console.error('[AutomatedTradeExecutor] Failed to log missed opportunity:', error);
    }
  }
}
