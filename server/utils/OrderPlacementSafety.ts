/**
 * Order Placement Safety Controls
 * 
 * Implements safety mechanisms to prevent runaway trading:
 * - Maximum order size limits
 * - Daily order count limits
 * - Circuit breaker for repeated failures
 * - Retry logic with exponential backoff
 * - Balance verification before order placement
 */

import { getDb } from '../db';
import { positions } from '../../drizzle/schema';
import { eq, and, gte } from 'drizzle-orm';

interface SafetyConfig {
  maxOrderSizeUSD: number;      // Maximum order size in USD
  maxDailyOrders: number;        // Maximum orders per day
  maxConsecutiveFailures: number; // Circuit breaker threshold
  minBalanceUSD: number;         // Minimum balance to maintain
  retryAttempts: number;         // Number of retry attempts
  retryDelayMs: number;          // Initial retry delay
}

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class OrderPlacementSafety {
  private static consecutiveFailures: number = 0;
  private static lastFailureTime: number = 0;
  private static dailyOrderCount: Map<string, number> = new Map(); // date -> count
  private static circuitBreakerActive: boolean = false;

  private static readonly config: SafetyConfig = {
    maxOrderSizeUSD: 10000,        // $10k max per order
    maxDailyOrders: 100,            // 100 orders per day
    maxConsecutiveFailures: 5,      // Circuit breaker after 5 failures
    minBalanceUSD: 100,             // Keep at least $100 in account
    retryAttempts: 3,               // Retry up to 3 times
    retryDelayMs: 1000,             // Start with 1 second delay
  };

  /**
   * Check if order placement is allowed based on safety rules
   */
  static async canPlaceOrder(
    symbol: string,
    quantity: number,
    price: number,
    userId: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check circuit breaker
    if (this.circuitBreakerActive) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      const cooldownPeriod = 5 * 60 * 1000; // 5 minutes

      if (timeSinceLastFailure < cooldownPeriod) {
        return {
          allowed: false,
          reason: `Circuit breaker active. Too many consecutive failures. Cooldown: ${Math.ceil((cooldownPeriod - timeSinceLastFailure) / 1000)}s`,
        };
      } else {
        // Reset circuit breaker after cooldown
        this.resetCircuitBreaker();
      }
    }

    // Check order size limit
    const orderValueUSD = quantity * price;
    if (orderValueUSD > this.config.maxOrderSizeUSD) {
      return {
        allowed: false,
        reason: `Order size ($${orderValueUSD.toFixed(2)}) exceeds maximum ($${this.config.maxOrderSizeUSD})`,
      };
    }

    // Check daily order limit
    const today = new Date().toISOString().split('T')[0];
    const todayCount = this.dailyOrderCount.get(today) || 0;
    if (todayCount >= this.config.maxDailyOrders) {
      return {
        allowed: false,
        reason: `Daily order limit reached (${this.config.maxDailyOrders} orders)`,
      };
    }

    // Check if user has too many open positions
    const db = await getDb();
    if (db) {
      const openPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.thesisValid, true)
          )
        );

      const maxOpenPositions = 10; // Maximum 10 concurrent positions
      if (openPositions.length >= maxOpenPositions) {
        return {
          allowed: false,
          reason: `Maximum open positions reached (${maxOpenPositions})`,
        };
      }

      // ✅ REAL TRADING BALANCE VALIDATION
      // Check available balance before allowing order
      try {
        const { getPaperWallet } = await import('../db');
        const wallet = await getPaperWallet(userId);
        
        if (wallet) {
          const availableBalance = parseFloat(wallet.balance);
          const orderValue = quantity * price;
          
          // Calculate margin used by open positions
          let marginUsed = 0;
          for (const pos of openPositions) {
            const posValue = parseFloat(pos.entryPrice) * parseFloat(pos.quantity);
            marginUsed += posValue;
          }
          
          const actualAvailable = availableBalance - marginUsed;
          
          // Check if user has enough balance for this order
          if (orderValue > actualAvailable) {
            return {
              allowed: false,
              reason: `Insufficient balance: Order requires $${orderValue.toFixed(2)}, but only $${actualAvailable.toFixed(2)} available (Balance: $${availableBalance.toFixed(2)}, Margin Used: $${marginUsed.toFixed(2)})`,
            };
          }
          
          // Check minimum balance requirement
          const balanceAfterOrder = actualAvailable - orderValue;
          if (balanceAfterOrder < this.config.minBalanceUSD) {
            return {
              allowed: false,
              reason: `Order would leave balance below minimum ($${this.config.minBalanceUSD}). Available: $${actualAvailable.toFixed(2)}, Order: $${orderValue.toFixed(2)}`,
            };
          }
        }
      } catch (error) {
        console.error('[OrderPlacementSafety] Balance check failed:', error);
        // Don't block order if balance check fails, but log it
      }
    }

    return { allowed: true };
  }

  /**
   * Record successful order placement
   */
  static recordSuccess() {
    // Reset consecutive failures
    this.consecutiveFailures = 0;

    // Increment daily order count
    const today = new Date().toISOString().split('T')[0];
    const currentCount = this.dailyOrderCount.get(today) || 0;
    this.dailyOrderCount.set(today, currentCount + 1);

    // Clean up old dates
    this.cleanupDailyOrderCount();
  }

  /**
   * Record failed order placement
   */
  static recordFailure() {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    console.warn(`[OrderPlacementSafety] Consecutive failures: ${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}`);

    // Activate circuit breaker if threshold reached
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.activateCircuitBreaker();
    }
  }

  /**
   * Activate circuit breaker to stop all order placement
   */
  private static activateCircuitBreaker() {
    this.circuitBreakerActive = true;
    console.error('[OrderPlacementSafety] 🚨 CIRCUIT BREAKER ACTIVATED - Order placement halted');
    console.error(`[OrderPlacementSafety] Reason: ${this.consecutiveFailures} consecutive failures`);
    console.error('[OrderPlacementSafety] Cooldown period: 5 minutes');
  }

  /**
   * Reset circuit breaker after cooldown
   */
  private static resetCircuitBreaker() {
    this.circuitBreakerActive = false;
    this.consecutiveFailures = 0;
    console.log('[OrderPlacementSafety] ✅ Circuit breaker reset');
  }

  /**
   * Clean up old daily order counts (keep last 7 days)
   */
  private static cleanupDailyOrderCount() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    for (const [date] of Array.from(this.dailyOrderCount)) {
      if (date < cutoffDate) {
        this.dailyOrderCount.delete(date);
      }
    }
  }

  /**
   * Execute function with retry logic and exponential backoff
   */
  static async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const opts: RetryOptions = {
      maxAttempts: options.maxAttempts || this.config.retryAttempts,
      initialDelayMs: options.initialDelayMs || this.config.retryDelayMs,
      maxDelayMs: options.maxDelayMs || 10000, // Max 10 seconds
      backoffMultiplier: options.backoffMultiplier || 2,
    };

    let lastError: Error | undefined;
    let delay = opts.initialDelayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        const result = await fn();
        
        // Success - record it
        if (attempt > 1) {
          console.log(`[OrderPlacementSafety] Retry succeeded on attempt ${attempt}`);
        }
        this.recordSuccess();
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        console.warn(`[OrderPlacementSafety] Attempt ${attempt}/${opts.maxAttempts} failed:`, lastError.message);

        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          console.error('[OrderPlacementSafety] Non-retryable error, aborting retries');
          this.recordFailure();
          throw lastError;
        }

        // Wait before retrying (except on last attempt)
        if (attempt < opts.maxAttempts) {
          console.log(`[OrderPlacementSafety] Retrying in ${delay}ms...`);
          await this.sleep(delay);
          delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
        }
      }
    }

    // All retries failed
    this.recordFailure();
    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Check if error should not be retried
   */
  private static isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Don't retry on validation errors
    if (message.includes('invalid') || 
        message.includes('insufficient') ||
        message.includes('unauthorized') ||
        message.includes('forbidden')) {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current safety status
   */
  static getStatus() {
    const today = new Date().toISOString().split('T')[0];
    return {
      circuitBreakerActive: this.circuitBreakerActive,
      consecutiveFailures: this.consecutiveFailures,
      dailyOrderCount: this.dailyOrderCount.get(today) || 0,
      maxDailyOrders: this.config.maxDailyOrders,
      config: this.config,
    };
  }

  /**
   * Reset all safety counters (for testing or manual reset)
   */
  static reset() {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.circuitBreakerActive = false;
    this.dailyOrderCount.clear();
    console.log('[OrderPlacementSafety] All safety counters reset');
  }
}
