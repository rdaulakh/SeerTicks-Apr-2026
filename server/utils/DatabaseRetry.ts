/**
 * Database Retry Utility with Exponential Backoff
 * Handles transient database failures gracefully
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retry attempts and delays
 * - Detailed logging for debugging
 * - Supports both sync and async operations
 */

interface RetryConfig {
  maxAttempts: number; // Maximum number of retry attempts
  initialDelayMs: number; // Initial delay before first retry
  maxDelayMs: number; // Maximum delay between retries
  backoffMultiplier: number; // Exponential backoff multiplier (default: 2)
  jitter: boolean; // Add random jitter to prevent thundering herd
  retryableErrors?: string[]; // Specific error messages to retry
}

interface RetryContext {
  attempt: number;
  lastError: Error | null;
  totalDelayMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
    // Network errors
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EPIPE",
    "ENETUNREACH",
    "EHOSTUNREACH",
    
    // MySQL/TiDB errors
    "ER_LOCK_WAIT_TIMEOUT",
    "ER_LOCK_DEADLOCK",
    "ER_QUERY_INTERRUPTED",
    "ER_SERVER_SHUTDOWN",
    "ER_NORMAL_SHUTDOWN",
    "ER_SHUTDOWN_COMPLETE",
    "ER_FORCING_CLOSE",
    "ER_ABORTING_CONNECTION",
    "ER_CON_COUNT_ERROR",
    
    // Connection pool errors
    "Connection lost",
    "Too many connections",
    "Pool is closed",
    "Connection timeout",
    "Failed query",
    "Lost connection to MySQL server",
    "MySQL server has gone away",
    
    // TiDB specific errors
    "Region is unavailable",
    "TiKV server timeout",
  ],
};

/**
 * Execute database operation with retry logic
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  operationName = "DatabaseOperation"
): Promise<T> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const context: RetryContext = {
    attempt: 0,
    lastError: null,
    totalDelayMs: 0,
  };

  while (context.attempt < finalConfig.maxAttempts) {
    context.attempt++;

    try {
      // Execute the operation
      const result = await operation();
      
      // Success - log if it took multiple attempts
      if (context.attempt > 1) {
        console.log(
          `[DatabaseRetry] ${operationName} succeeded on attempt ${context.attempt}/${finalConfig.maxAttempts} (total delay: ${context.totalDelayMs}ms)`
        );
      }
      
      return result;
    } catch (error: any) {
      context.lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableError(error, finalConfig.retryableErrors);

      // If not retryable or last attempt, throw immediately
      if (!isRetryable || context.attempt >= finalConfig.maxAttempts) {
        console.error(
          `[DatabaseRetry] ${operationName} failed after ${context.attempt} attempts:`,
          error.message
        );
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = calculateDelay(
        context.attempt,
        finalConfig.initialDelayMs,
        finalConfig.maxDelayMs,
        finalConfig.backoffMultiplier,
        finalConfig.jitter
      );

      context.totalDelayMs += delay;

      console.warn(
        `[DatabaseRetry] ${operationName} failed (attempt ${context.attempt}/${finalConfig.maxAttempts}): ${error.message}. Retrying in ${delay}ms...`
      );

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw context.lastError || new Error("Unknown error in database retry");
}

/**
 * Check if error is retryable based on error message/code
 */
function isRetryableError(
  error: any,
  retryableErrors: string[] = []
): boolean {
  const errorMessage = error.message || "";
  const errorCode = error.code || "";

  // Check if error message or code matches retryable patterns
  return retryableErrors.some(
    (pattern) =>
      errorMessage.includes(pattern) || errorCode.includes(pattern)
  );
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number,
  jitter: boolean
): number {
  // Calculate exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
  let delay = initialDelay * Math.pow(multiplier, attempt - 1);

  // Cap at max delay
  delay = Math.min(delay, maxDelay);

  // Add jitter (random 0-25% variation) to prevent thundering herd
  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random();
    delay = delay + jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Preset configurations for common scenarios
 */
export const DatabaseRetryPresets = {
  // Fast retry for lightweight operations
  FAST: {
    maxAttempts: 3,
    initialDelayMs: 50,
    maxDelayMs: 500,
    backoffMultiplier: 2,
    jitter: true,
  },

  // Standard retry for most operations
  STANDARD: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
    jitter: true,
  },

  // Aggressive retry for critical operations
  AGGRESSIVE: {
    maxAttempts: 5,
    initialDelayMs: 200,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitter: true,
  },

  // No retry (for testing or non-critical operations)
  NONE: {
    maxAttempts: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
    jitter: false,
  },
};

/**
 * Wrapper class for easier usage with class methods
 */
export class DatabaseRetryWrapper {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute operation with retry
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationName?: string
  ): Promise<T> {
    return withDatabaseRetry(operation, this.config, operationName);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}

/**
 * Global database retry instance for convenience
 */
export const dbRetry = new DatabaseRetryWrapper(DatabaseRetryPresets.STANDARD);
