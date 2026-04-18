/**
 * Retry Handler with Exponential Backoff
 * 
 * Provides robust retry logic for API calls and external services.
 * Features:
 * - Exponential backoff with jitter
 * - Configurable max retries
 * - Error categorization (retryable vs non-retryable)
 * - Comprehensive logging
 */

export interface RetryOptions {
  maxRetries: number; // Maximum number of retry attempts
  initialDelay: number; // Initial delay in milliseconds
  maxDelay: number; // Maximum delay in milliseconds
  backoffMultiplier: number; // Multiplier for exponential backoff (default: 2)
  jitter: boolean; // Add random jitter to prevent thundering herd
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Check if error is retryable
 */
function isRetryableError(error: any): boolean {
  // Network errors (ECONNRESET, ETIMEDOUT, etc.)
  if (error.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code)) {
    return true;
  }

  // HTTP status codes that are retryable
  if (error.response?.status) {
    const status = error.response.status;
    // 429 (Rate Limit), 500-599 (Server Errors)
    if (status === 429 || (status >= 500 && status < 600)) {
      return true;
    }
  }

  // Binance-specific errors
  if (error.message) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('rate limit') ||
      msg.includes('temporarily unavailable')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

  if (options.jitter) {
    // Add random jitter (±25%)
    const jitterRange = cappedDelay * 0.25;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }

  return cappedDelay;
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context: string = 'Operation'
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      console.log(`[RetryHandler] ${context} - Attempt ${attempt + 1}/${opts.maxRetries + 1}`);
      
      const result = await fn();
      
      const duration = Date.now() - startTime;
      console.log(`[RetryHandler] ${context} - Success after ${attempt + 1} attempts (${duration}ms)`);
      
      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalDuration: duration,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.error(`[RetryHandler] ${context} - Non-retryable error:`, lastError.message);
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDuration: Date.now() - startTime,
        };
      }

      // If this was the last attempt, fail
      if (attempt === opts.maxRetries) {
        console.error(`[RetryHandler] ${context} - Failed after ${attempt + 1} attempts:`, lastError.message);
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDuration: Date.now() - startTime,
        };
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts);
      console.warn(`[RetryHandler] ${context} - Attempt ${attempt + 1} failed, retrying in ${delay.toFixed(0)}ms:`, lastError.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    error: lastError || new Error('Unknown error'),
    attempts: opts.maxRetries + 1,
    totalDuration: Date.now() - startTime,
  };
}

/**
 * Circuit Breaker
 * 
 * Prevents repeated calls to a failing service.
 * Opens after N consecutive failures, closes after timeout.
 */
export class CircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private failureThreshold: number = 3,
    private resetTimeout: number = 60000 // 60 seconds
  ) {}

  /**
   * Check if circuit is open (service is unavailable)
   */
  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        console.log('[CircuitBreaker] Reset timeout passed, entering half-open state');
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a successful call
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      console.log('[CircuitBreaker] Success in half-open state, closing circuit');
      this.state = 'closed';
    }
    this.failureCount = 0;
  }

  /**
   * Record a failed call
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      if (this.state !== 'open') {
        console.error(`[CircuitBreaker] Failure threshold reached (${this.failureCount}/${this.failureThreshold}), opening circuit`);
        this.state = 'open';
      }
    }
  }

  /**
   * Get current state
   */
  getState(): { state: string; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    console.log('[CircuitBreaker] Manual reset');
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
