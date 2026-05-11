import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import {
  getPaperWallet,
  getPaperPositions,
  insertPaperPosition,
} from '../db';
import {
  getAutomatedTradingSettings,
  getTodayAutomatedTradeCount,
  getTodayAutomatedPnL,
  getRecentConsecutiveLosses,
  createAutomatedTradeLog,
  updateAutomatedTradeLog,
} from '../db/automatedTradingDb';
import { AutomatedTradingSettings, InsertAutomatedTradeLog } from '../../drizzle/schema';
import { PositionManager } from '../PositionManager';

export interface TradingSignal {
  id: string;
  symbol: string;
  type: 'long' | 'short';
  confidence: number; // 0-100
  signalType: string; // 'combined', 'technical', 'sentiment', etc.
  data: any; // Complete signal data
  timestamp: Date;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface AutomationCheckResult {
  allowed: boolean;
  reason?: string;
  details?: any;
}

/**
 * Automated Trading Engine
 * Processes signals and automatically executes trades based on user settings
 */
export class AutomatedTradingEngine extends EventEmitter {
  private userId: number;
  private settings: AutomatedTradingSettings | null = null;
  private lastTradeTime: Date | null = null;
  private isProcessing: boolean = false;

  constructor(userId: number) {
    super();
    this.userId = userId;
  }

  /**
   * Initialize the engine by loading user settings
   */
  async initialize(): Promise<void> {
    this.settings = await getAutomatedTradingSettings(this.userId);
    if (!this.settings) {
      console.log(`[AutomatedTradingEngine] No settings found for user ${this.userId}, automation disabled`);
    }
  }

  /**
   * Reload settings from database
   */
  async reloadSettings(): Promise<void> {
    await this.initialize();
  }

  /**
   * Process a trading signal and potentially execute a trade
   */
  async processSignal(signal: TradingSignal): Promise<void> {
    if (this.isProcessing) {
      console.log(`[AutomatedTradingEngine] Already processing a signal, skipping`);
      return;
    }

    this.isProcessing = true;
    const startTime = getActiveClock().now();

    try {
      // Reload settings to ensure we have latest configuration
      await this.reloadSettings();

      // Check if automation is enabled
      if (!this.settings || !this.settings.enabled) {
        console.log(`[AutomatedTradingEngine] Automation disabled for user ${this.userId}`);
        return;
      }

      console.log(`[AutomatedTradingEngine] Processing signal: ${signal.id} for ${signal.symbol} (${signal.type}) with confidence ${signal.confidence}%`);

      // Create initial log entry
      const logId = await createAutomatedTradeLog({
        userId: this.userId,
        signalId: signal.id,
        signalType: signal.signalType,
        signalConfidence: signal.confidence.toString(),
        signalData: signal.data,
        symbol: signal.symbol,
        side: signal.type,
        status: 'pending',
        signalReceivedAt: signal.timestamp,
        evaluatedAt: new Date(),
        settingsSnapshot: this.settings,
      } as InsertAutomatedTradeLog);

      // Perform pre-trade checks
      const checkResult = await this.performPreTradeChecks(signal);

      if (!checkResult.allowed) {
        console.log(`[AutomatedTradingEngine] Trade rejected: ${checkResult.reason}`);
        
        await updateAutomatedTradeLog(logId, {
          status: 'rejected',
          rejectionReason: checkResult.reason,
          rejectionDetails: checkResult.details,
        });

        // Emit rejection event
        this.emit('trade_rejected', {
          signal,
          reason: checkResult.reason,
          details: checkResult.details,
        });

        // Send notification if enabled
        if (this.settings.notifyOnRejection) {
          this.emit('notification', {
            type: 'trade',
            severity: 'info',
            title: 'Automated Trade Rejected',
            message: `Signal for ${signal.symbol} (${signal.type}) rejected: ${checkResult.reason}`,
            data: { signal, checkResult },
          });
        }

        return;
      }

      // Calculate position size
      const positionSize = await this.calculatePositionSize(signal);
      if (!positionSize || positionSize <= 0) {
        await updateAutomatedTradeLog(logId, {
          status: 'rejected',
          rejectionReason: 'Invalid position size calculated',
        });
        return;
      }

      // Get current price
      const currentPrice = signal.price || 0;
      if (!currentPrice) {
        await updateAutomatedTradeLog(logId, {
          status: 'rejected',
          rejectionReason: 'No current price available',
        });
        return;
      }

      // Update log with trade details
      await updateAutomatedTradeLog(logId, {
        requestedQuantity: positionSize.toString(),
        requestedValue: (positionSize * currentPrice).toString(),
      });

      // Execute the trade using paper trading
      // For automated trading, we'll use the paper trading system
      
      try {
        const positionData = {
          userId: this.userId,
          symbol: signal.symbol,
          exchange: 'binance' as const,
          side: signal.type,
          entryPrice: currentPrice.toString(),
          currentPrice: currentPrice.toString(),
          quantity: positionSize.toString(),
          stopLoss: signal.stopLoss?.toString(),
          takeProfit: signal.takeProfit?.toString(),
          entryTime: new Date(),
          strategy: 'automated',
          partialExits: null,
        };
        
        const insertedPosition = await insertPaperPosition(positionData);
        if (!insertedPosition) {
          throw new Error('Failed to create position');
        }
        
        const position = insertedPosition;
        const executionLatency = getActiveClock().now() - startTime;

        // Update log with success
        await updateAutomatedTradeLog(logId, {
          status: 'executed',
          positionId: position.id,
          executedPrice: positionData.entryPrice,
          executedQuantity: positionData.quantity,
          executionLatencyMs: executionLatency,
          executedAt: new Date(),
        });

        // Update last trade time
        this.lastTradeTime = new Date();

        // Emit success event
        this.emit('trade_executed', {
          signal,
          position,
          logId,
          executionLatency,
        });

        // Send notification if enabled
        if (this.settings.notifyOnExecution) {
          this.emit('notification', {
            type: 'trade',
            severity: 'info',
            title: 'Automated Trade Executed',
            message: `Opened ${signal.type} position on ${signal.symbol} with ${positionSize.toFixed(8)} units at $${currentPrice.toFixed(2)}`,
            data: { signal, position },
          });
        }

        console.log(`[AutomatedTradingEngine] Trade executed successfully: ${signal.symbol} ${signal.type} ${positionSize} @ ${currentPrice}`);

      } catch (error: any) {
        console.error(`[AutomatedTradingEngine] Trade execution failed:`, error);
        
        await updateAutomatedTradeLog(logId, {
          status: 'failed',
          rejectionReason: error.message || 'Unknown execution error',
          rejectionDetails: { error: error.toString() },
        });

        this.emit('trade_failed', {
          signal,
          error: error.message,
        });
      }

    } catch (error: any) {
      console.error(`[AutomatedTradingEngine] Error processing signal:`, error);
      this.emit('error', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Perform all pre-trade validation checks
   */
  private async performPreTradeChecks(signal: TradingSignal): Promise<AutomationCheckResult> {
    if (!this.settings) {
      return { allowed: false, reason: 'No automation settings configured' };
    }

    // Check 1: Minimum confidence threshold
    if (signal.confidence < this.settings.minSignalConfidence) {
      return {
        allowed: false,
        reason: `Signal confidence ${signal.confidence}% below minimum ${this.settings.minSignalConfidence}%`,
        details: { confidence: signal.confidence, threshold: this.settings.minSignalConfidence },
      };
    }

    // Check 2: Symbol filters
    if (this.settings.allowedSymbols && Array.isArray(this.settings.allowedSymbols)) {
      if (!this.settings.allowedSymbols.includes(signal.symbol)) {
        return {
          allowed: false,
          reason: `Symbol ${signal.symbol} not in allowed list`,
          details: { symbol: signal.symbol, allowedSymbols: this.settings.allowedSymbols },
        };
      }
    }

    if (this.settings.blockedSymbols && Array.isArray(this.settings.blockedSymbols)) {
      if (this.settings.blockedSymbols.includes(signal.symbol)) {
        return {
          allowed: false,
          reason: `Symbol ${signal.symbol} is blocked`,
          details: { symbol: signal.symbol, blockedSymbols: this.settings.blockedSymbols },
        };
      }
    }

    // Check 3: Signal type filters
    if (signal.signalType === 'technical' && !this.settings.enableTechnicalSignals) {
      return { allowed: false, reason: 'Technical signals disabled' };
    }
    if (signal.signalType === 'sentiment' && !this.settings.enableSentimentSignals) {
      return { allowed: false, reason: 'Sentiment signals disabled' };
    }
    if (signal.signalType === 'onchain' && !this.settings.enableOnChainSignals) {
      return { allowed: false, reason: 'On-chain signals disabled' };
    }

    // Check 4: Trading hours
    if (this.settings.tradingHours) {
      const isWithinHours = this.checkTradingHours(this.settings.tradingHours);
      if (!isWithinHours) {
        return { allowed: false, reason: 'Outside configured trading hours' };
      }
    }

    // Check 5: Cooldown period
    if (this.lastTradeTime && this.settings.cooldownMinutes > 0) {
      const minutesSinceLastTrade = (getActiveClock().now() - this.lastTradeTime.getTime()) / 1000 / 60;
      if (minutesSinceLastTrade < this.settings.cooldownMinutes) {
        return {
          allowed: false,
          reason: `Cooldown period active (${this.settings.cooldownMinutes - Math.floor(minutesSinceLastTrade)} minutes remaining)`,
          details: { cooldownMinutes: this.settings.cooldownMinutes, minutesSinceLastTrade },
        };
      }
    }

    // Check 6: Daily trade limit
    const todayTradeCount = await getTodayAutomatedTradeCount(this.userId);
    if (todayTradeCount >= this.settings.maxTradesPerDay) {
      return {
        allowed: false,
        reason: `Daily trade limit reached (${todayTradeCount}/${this.settings.maxTradesPerDay})`,
        details: { todayTradeCount, maxTradesPerDay: this.settings.maxTradesPerDay },
      };
    }

    // Check 7: Maximum open positions
    const openPositions = await getPaperPositions(this.userId);
    if (openPositions.length >= this.settings.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Maximum open positions reached (${openPositions.length}/${this.settings.maxOpenPositions})`,
        details: { openPositions: openPositions.length, maxOpenPositions: this.settings.maxOpenPositions },
      };
    }

    // Check 8: Daily loss limit
    const todayPnL = await getTodayAutomatedPnL(this.userId);
    if (todayPnL < -Number(this.settings.maxDailyLossUSD)) {
      return {
        allowed: false,
        reason: `Daily loss limit exceeded ($${Math.abs(todayPnL).toFixed(2)} / $${this.settings.maxDailyLossUSD})`,
        details: { todayPnL, maxDailyLossUSD: this.settings.maxDailyLossUSD },
      };
    }

    // Check 9: Circuit breaker - consecutive losses
    const consecutiveLosses = await getRecentConsecutiveLosses(this.userId, this.settings.stopOnConsecutiveLosses);
    if (consecutiveLosses >= this.settings.stopOnConsecutiveLosses) {
      return {
        allowed: false,
        reason: `Circuit breaker triggered: ${consecutiveLosses} consecutive losses`,
        details: { consecutiveLosses, threshold: this.settings.stopOnConsecutiveLosses },
      };
    }

    // Check 10: Sufficient balance
    const wallet = await getPaperWallet(this.userId);
    if (!wallet || Number(wallet.balance) <= 0) {
      return {
        allowed: false,
        reason: 'Insufficient balance',
        details: { balance: wallet?.balance || 0 },
      };
    }

    // All checks passed
    return { allowed: true };
  }

  /**
   * Calculate position size based on settings and risk management
   */
  private async calculatePositionSize(signal: TradingSignal): Promise<number | null> {
    if (!this.settings) return null;

    const wallet = await getPaperWallet(this.userId);
    if (!wallet) return null;

    const availableBalance = Number(wallet.balance);
    const currentPrice = signal.price || 0;

    if (!currentPrice || currentPrice <= 0) return null;

    // Calculate max position value based on percentage
    const maxPositionValue = availableBalance * (this.settings.maxPositionSizePercent / 100);

    // Calculate quantity
    let quantity = maxPositionValue / currentPrice;

    // If Kelly Criterion is enabled, adjust position size
    if (this.settings.useKellyCriterion && this.settings.kellyFraction) {
      // Simplified Kelly: fraction * (confidence - 0.5) * 2
      // This gives us a multiplier between 0 and kellyFraction
      const kellyMultiplier = Number(this.settings.kellyFraction) * ((signal.confidence / 100 - 0.5) * 2);
      quantity = quantity * Math.max(0, Math.min(1, kellyMultiplier));
    }

    return quantity;
  }

  /**
   * Check if current time is within configured trading hours
   */
  private checkTradingHours(tradingHours: any): boolean {
    if (!tradingHours) return true;

    try {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

      // Check if today is an allowed trading day
      if (tradingHours.days && Array.isArray(tradingHours.days)) {
        if (!tradingHours.days.includes(currentDay)) {
          return false;
        }
      }

      // Check if current time is within trading hours
      if (tradingHours.start && tradingHours.end) {
        if (currentTime < tradingHours.start || currentTime > tradingHours.end) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('[AutomatedTradingEngine] Error checking trading hours:', error);
      return true; // Default to allowing trades if check fails
    }
  }

  /**
   * Get current automation status
   */
  getStatus(): { enabled: boolean; settings: AutomatedTradingSettings | null } {
    return {
      enabled: this.settings?.enabled || false,
      settings: this.settings,
    };
  }
}
