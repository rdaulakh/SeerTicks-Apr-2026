/**
 * Circuit Breaker Manager
 * 
 * Centralized circuit breaker management for preventing cascade failures.
 * Monitors and protects:
 * - External API calls (CoinAPI, WhaleAlert, CoinGecko, etc.)
 * - Database operations
 * - Trade execution
 * - Price feed connections
 * 
 * Features:
 * - Per-service circuit breakers
 * - Automatic recovery with half-open state
 * - Health monitoring and alerts
 * - Graceful degradation support
 */

import { EventEmitter } from 'events';

export interface CircuitBreakerConfig {
  failureThreshold: number;  // Number of failures before opening
  resetTimeout: number;      // Time in ms before trying again (half-open)
  halfOpenMaxAttempts: number; // Max attempts in half-open state
  monitorWindow: number;     // Time window for counting failures (ms)
}

export interface CircuitBreakerState {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalFailures: number;
  totalSuccesses: number;
  openedAt: number | null;
  halfOpenAttempts: number;
  lastError: string | null;
}

export interface CircuitBreakerStats {
  totalBreakers: number;
  openBreakers: number;
  halfOpenBreakers: number;
  closedBreakers: number;
  breakers: CircuitBreakerState[];
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private openedAt: number | null = null;
  private halfOpenAttempts: number = 0;
  private lastError: string | null = null;
  private failureTimestamps: number[] = [];
  
  constructor(
    public readonly name: string,
    private config: CircuitBreakerConfig,
    private onStateChange: (name: string, oldState: string, newState: string) => void
  ) {}
  
  /**
   * Check if circuit allows requests
   */
  canExecute(): boolean {
    this.cleanupOldFailures();
    
    if (this.state === 'closed') {
      return true;
    }
    
    if (this.state === 'open') {
      // Check if reset timeout has passed
      if (this.openedAt && Date.now() - this.openedAt > this.config.resetTimeout) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }
    
    // Half-open: allow limited attempts
    if (this.state === 'half-open') {
      if (this.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
        return true;
      }
      return false;
    }
    
    return false;
  }
  
  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this.successCount++;
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    
    if (this.state === 'half-open') {
      // Success in half-open state closes the circuit
      this.transitionTo('closed');
      this.halfOpenAttempts = 0;
    }
    
    // Reset failure count on success in closed state
    if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }
  
  /**
   * Record a failed execution
   */
  recordFailure(error?: Error | string): void {
    const now = Date.now();
    this.failureCount++;
    this.totalFailures++;
    this.lastFailureTime = now;
    this.failureTimestamps.push(now);
    this.lastError = error ? (error instanceof Error ? error.message : error) : null;
    
    if (this.state === 'half-open') {
      this.halfOpenAttempts++;
      // Failure in half-open state reopens the circuit
      this.transitionTo('open');
      return;
    }
    
    // Check if we should open the circuit
    this.cleanupOldFailures();
    if (this.failureTimestamps.length >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }
  
  /**
   * Transition to a new state
   */
  private transitionTo(newState: 'closed' | 'open' | 'half-open'): void {
    if (this.state === newState) return;
    
    const oldState = this.state;
    this.state = newState;
    
    if (newState === 'open') {
      this.openedAt = Date.now();
      console.error(`[CircuitBreaker:${this.name}] 🔴 OPENED - ${this.failureCount} failures in ${this.config.monitorWindow}ms window`);
    } else if (newState === 'half-open') {
      this.halfOpenAttempts = 0;
      console.warn(`[CircuitBreaker:${this.name}] 🟡 HALF-OPEN - Testing service availability`);
    } else if (newState === 'closed') {
      this.failureCount = 0;
      this.failureTimestamps = [];
      this.openedAt = null;
      console.log(`[CircuitBreaker:${this.name}] 🟢 CLOSED - Service recovered`);
    }
    
    this.onStateChange(this.name, oldState, newState);
  }
  
  /**
   * Clean up failures outside the monitoring window
   */
  private cleanupOldFailures(): void {
    const cutoff = Date.now() - this.config.monitorWindow;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts > cutoff);
  }
  
  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureTimestamps.length,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      openedAt: this.openedAt,
      halfOpenAttempts: this.halfOpenAttempts,
      lastError: this.lastError,
    };
  }
  
  /**
   * Force reset the circuit breaker
   */
  forceReset(): void {
    this.transitionTo('closed');
    this.failureCount = 0;
    this.failureTimestamps = [];
    this.halfOpenAttempts = 0;
    this.lastError = null;
    console.log(`[CircuitBreaker:${this.name}] Force reset`);
  }
}

class CircuitBreakerManagerImpl extends EventEmitter {
  private static instance: CircuitBreakerManagerImpl;
  private breakers: Map<string, CircuitBreaker> = new Map();
  
  // Default configurations for different service types
  private readonly defaultConfigs: Record<string, CircuitBreakerConfig> = {
    // External APIs - more tolerant
    api: {
      failureThreshold: 5,
      resetTimeout: 60000,      // 1 minute
      halfOpenMaxAttempts: 2,
      monitorWindow: 60000,     // 1 minute window
    },
    // Database operations - less tolerant
    database: {
      failureThreshold: 3,
      resetTimeout: 30000,      // 30 seconds
      halfOpenMaxAttempts: 1,
      monitorWindow: 30000,     // 30 second window
    },
    // Trade execution - very strict
    trade: {
      failureThreshold: 2,
      resetTimeout: 120000,     // 2 minutes
      halfOpenMaxAttempts: 1,
      monitorWindow: 60000,     // 1 minute window
    },
    // Price feed - moderate
    priceFeed: {
      failureThreshold: 5,
      resetTimeout: 30000,      // 30 seconds
      halfOpenMaxAttempts: 3,
      monitorWindow: 30000,     // 30 second window
    },
  };
  
  private constructor() {
    super();
    this.initializeDefaultBreakers();
  }
  
  static getInstance(): CircuitBreakerManagerImpl {
    if (!CircuitBreakerManagerImpl.instance) {
      CircuitBreakerManagerImpl.instance = new CircuitBreakerManagerImpl();
    }
    return CircuitBreakerManagerImpl.instance;
  }
  
  /**
   * Initialize default circuit breakers for known services
   */
  private initializeDefaultBreakers(): void {
    // External APIs
    this.getOrCreate('coinapi', 'api');
    this.getOrCreate('whalealert', 'api');
    this.getOrCreate('coingecko', 'api');
    this.getOrCreate('coinbase', 'api');
    this.getOrCreate('dune', 'api');
    
    // Database
    this.getOrCreate('database', 'database');
    
    // Trade execution
    this.getOrCreate('trade_execution', 'trade');
    this.getOrCreate('paper_trading', 'trade');
    
    // Price feeds
    this.getOrCreate('coinapi_ws', 'priceFeed');
    this.getOrCreate('coinbase_ws', 'priceFeed');
    
    console.log(`[CircuitBreakerManager] Initialized ${this.breakers.size} circuit breakers`);
  }
  
  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, type: keyof typeof this.defaultConfigs = 'api'): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const config = this.defaultConfigs[type] || this.defaultConfigs.api;
      const breaker = new CircuitBreaker(
        name,
        config,
        (n, oldState, newState) => this.handleStateChange(n, oldState, newState)
      );
      this.breakers.set(name, breaker);
    }
    return this.breakers.get(name)!;
  }
  
  /**
   * Handle state change events
   */
  private handleStateChange(name: string, oldState: string, newState: string): void {
    this.emit('state_change', { name, oldState, newState, timestamp: Date.now() });
    
    if (newState === 'open') {
      this.emit('circuit_opened', { name, timestamp: Date.now() });
    } else if (newState === 'closed' && oldState !== 'closed') {
      this.emit('circuit_closed', { name, timestamp: Date.now() });
    }
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    options?: { type?: 'api' | 'database' | 'trade' | 'priceFeed'; fallback?: () => T }
  ): Promise<T> {
    const breaker = this.getOrCreate(name, options?.type as keyof typeof this.defaultConfigs);
    
    if (!breaker.canExecute()) {
      console.warn(`[CircuitBreakerManager] Circuit ${name} is OPEN - request blocked`);
      
      if (options?.fallback) {
        console.log(`[CircuitBreakerManager] Using fallback for ${name}`);
        return options.fallback();
      }
      
      throw new Error(`Circuit breaker ${name} is open - service unavailable`);
    }
    
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      breaker.recordFailure(error as Error);
      throw error;
    }
  }
  
  /**
   * Record success for a service
   */
  recordSuccess(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.recordSuccess();
    }
  }
  
  /**
   * Record failure for a service
   */
  recordFailure(name: string, error?: Error | string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.recordFailure(error);
    }
  }
  
  /**
   * Check if a service is available
   */
  isAvailable(name: string): boolean {
    const breaker = this.breakers.get(name);
    return breaker ? breaker.canExecute() : true;
  }
  
  /**
   * Get stats for all circuit breakers
   */
  getStats(): CircuitBreakerStats {
    const breakers = Array.from(this.breakers.values()).map(b => b.getState());
    
    return {
      totalBreakers: breakers.length,
      openBreakers: breakers.filter(b => b.state === 'open').length,
      halfOpenBreakers: breakers.filter(b => b.state === 'half-open').length,
      closedBreakers: breakers.filter(b => b.state === 'closed').length,
      breakers,
    };
  }
  
  /**
   * Get state for a specific breaker
   */
  getBreakerState(name: string): CircuitBreakerState | null {
    const breaker = this.breakers.get(name);
    return breaker ? breaker.getState() : null;
  }
  
  /**
   * Force reset a circuit breaker
   */
  forceReset(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.forceReset();
      return true;
    }
    return false;
  }
  
  /**
   * Force reset all circuit breakers
   */
  forceResetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceReset();
    }
    console.log(`[CircuitBreakerManager] Force reset all ${this.breakers.size} circuit breakers`);
  }
  
  /**
   * Get list of open circuits (for alerting)
   */
  getOpenCircuits(): CircuitBreakerState[] {
    return Array.from(this.breakers.values())
      .map(b => b.getState())
      .filter(s => s.state === 'open');
  }
  
  /**
   * Check overall system health based on circuit breakers
   */
  getSystemHealth(): {
    healthy: boolean;
    score: number;
    criticalDown: string[];
    degraded: string[];
  } {
    const stats = this.getStats();
    const criticalServices = ['database', 'trade_execution', 'coinapi_ws'];
    
    const criticalDown = stats.breakers
      .filter(b => b.state === 'open' && criticalServices.includes(b.name))
      .map(b => b.name);
    
    const degraded = stats.breakers
      .filter(b => b.state === 'open' && !criticalServices.includes(b.name))
      .map(b => b.name);
    
    // Calculate health score (0-100)
    const openPenalty = stats.openBreakers * 15;
    const halfOpenPenalty = stats.halfOpenBreakers * 5;
    const criticalPenalty = criticalDown.length * 25;
    
    const score = Math.max(0, 100 - openPenalty - halfOpenPenalty - criticalPenalty);
    
    return {
      healthy: criticalDown.length === 0 && stats.openBreakers <= 2,
      score,
      criticalDown,
      degraded,
    };
  }
}

export const circuitBreakerManager = CircuitBreakerManagerImpl.getInstance();

// Convenience functions for common operations
export function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  options?: { type?: 'api' | 'database' | 'trade' | 'priceFeed'; fallback?: () => T }
): Promise<T> {
  return circuitBreakerManager.execute(name, fn, options);
}

export function recordAPISuccess(name: string): void {
  circuitBreakerManager.recordSuccess(name);
}

export function recordAPIFailure(name: string, error?: Error | string): void {
  circuitBreakerManager.recordFailure(name, error);
}

export function isServiceAvailable(name: string): boolean {
  return circuitBreakerManager.isAvailable(name);
}
