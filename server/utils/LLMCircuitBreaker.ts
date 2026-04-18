/**
 * LLM Circuit Breaker
 * 
 * Prevents cascading failures when LLM quota is exhausted (412 errors).
 * Implements the circuit breaker pattern with three states:
 * 
 *   CLOSED → normal operation, all calls pass through
 *   OPEN   → quota exhausted, all calls blocked for cooldown period
 *   HALF_OPEN → cooldown expired, one test call allowed to probe recovery
 * 
 * When primary LLM fails, falls back to Anthropic Claude API if available.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Cooldown period in ms before transitioning to HALF_OPEN */
  cooldownMs: number;
  /** Maximum cooldown period in ms (for exponential backoff) */
  maxCooldownMs: number;
  /** Time window in ms to count failures (resets if no failure in this window) */
  failureWindowMs: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalFallbacks: number;
  totalCircuitOpens: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  cooldownRemaining: number;
  primaryProvider: string;
  fallbackProvider: string | null;
  fallbackAvailable: boolean;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000, // 5 minutes
  maxCooldownMs: 30 * 60 * 1000, // 30 minutes max
  failureWindowMs: 60 * 1000, // 1 minute window
};

class LLMCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalFallbacks = 0;
  private totalCircuitOpens = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange = Date.now();
  private currentCooldownMs: number;
  private config: CircuitBreakerConfig;
  private halfOpenInProgress = false;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentCooldownMs = this.config.cooldownMs;
  }

  /**
   * Check if a call should be allowed through the circuit
   */
  canExecute(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        // Check if cooldown has expired
        if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.currentCooldownMs) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;
      case 'HALF_OPEN':
        // Only allow one test call at a time in half-open state
        if (!this.halfOpenInProgress) {
          this.halfOpenInProgress = true;
          return true;
        }
        return false;
    }
  }

  /**
   * Record a successful LLM call
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
    this.halfOpenInProgress = false;

    if (this.state === 'HALF_OPEN') {
      // Reset cooldown on recovery
      this.currentCooldownMs = this.config.cooldownMs;
      this.transitionTo('CLOSED');
      console.log('[LLMCircuitBreaker] ✅ Circuit CLOSED — LLM recovered');
    }
  }

  /**
   * Record a failed LLM call (specifically quota exhaustion / 412)
   */
  recordFailure(error: Error): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.halfOpenInProgress = false;

    // Reset failure count if outside the failure window
    if (this.lastSuccessTime && 
        Date.now() - this.lastSuccessTime < this.config.failureWindowMs) {
      // Recent success — don't escalate too quickly
    }

    if (this.state === 'HALF_OPEN') {
      // Test call failed — back to OPEN with increased cooldown
      this.currentCooldownMs = Math.min(
        this.currentCooldownMs * 2,
        this.config.maxCooldownMs
      );
      this.transitionTo('OPEN');
      console.log(`[LLMCircuitBreaker] ❌ Half-open test failed — circuit OPEN (cooldown: ${Math.round(this.currentCooldownMs / 1000)}s)`);
    } else if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.totalCircuitOpens++;
      this.transitionTo('OPEN');
      console.log(`[LLMCircuitBreaker] 🔴 Circuit OPEN — ${this.consecutiveFailures} consecutive failures (cooldown: ${Math.round(this.currentCooldownMs / 1000)}s)`);
    }
  }

  /**
   * Record that a fallback was used
   */
  recordFallback(): void {
    this.totalFallbacks++;
  }

  /**
   * Check if the error is a quota exhaustion error
   */
  isQuotaExhausted(error: Error): boolean {
    const msg = error.message || '';
    return (
      msg.includes('412') ||
      msg.includes('usage exhausted') ||
      msg.includes('rate limit') ||
      msg.includes('quota exceeded') ||
      msg.includes('429') ||
      msg.includes('too many requests')
    );
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const cooldownRemaining = this.state === 'OPEN' && this.lastFailureTime
      ? Math.max(0, this.currentCooldownMs - (Date.now() - this.lastFailureTime))
      : 0;

    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalFallbacks: this.totalFallbacks,
      totalCircuitOpens: this.totalCircuitOpens,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      cooldownRemaining,
      primaryProvider: 'Forge/Gemini',
      fallbackProvider: anthropicKey ? 'Anthropic Claude' : null,
      fallbackAvailable: !!anthropicKey,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Auto-transition from OPEN to HALF_OPEN if cooldown expired
    if (this.state === 'OPEN' && this.lastFailureTime && 
        Date.now() - this.lastFailureTime >= this.currentCooldownMs) {
      this.transitionTo('HALF_OPEN');
    }
    return this.state;
  }

  /**
   * Force reset the circuit breaker (manual intervention)
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.currentCooldownMs = this.config.cooldownMs;
    this.halfOpenInProgress = false;
    this.transitionTo('CLOSED');
    console.log('[LLMCircuitBreaker] 🔄 Circuit manually reset to CLOSED');
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    if (oldState !== newState) {
      console.log(`[LLMCircuitBreaker] State: ${oldState} → ${newState}`);
    }
  }
}

// Singleton instance
let instance: LLMCircuitBreaker | null = null;

export function getLLMCircuitBreaker(): LLMCircuitBreaker {
  if (!instance) {
    instance = new LLMCircuitBreaker();
  }
  return instance;
}

export function destroyLLMCircuitBreaker(): void {
  instance = null;
}
