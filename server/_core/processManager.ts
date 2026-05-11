import { getActiveClock } from "./clock";
/**
 * Enterprise-Grade Process Manager
 * 
 * CRITICAL: This is a trading platform. The process must NEVER die from recoverable errors.
 * Only truly fatal conditions (OOM, disk full) should trigger shutdown.
 * 
 * Handles graceful shutdown, resource cleanup, and signal handling.
 * Prevents file handle leaks and zombie processes.
 * 
 * Inspired by: AWS Lambda, Kubernetes, Google Cloud Run
 */

interface CleanupHandler {
  name: string;
  handler: () => Promise<void> | void;
  priority: number; // Lower number = higher priority
}

interface ErrorLogEntry {
  timestamp: number;
  type: 'uncaughtException' | 'unhandledRejection';
  message: string;
  stack?: string;
  fatal: boolean;
}

class ProcessManager {
  private cleanupHandlers: CleanupHandler[] = [];
  private isShuttingDown = false;
  private shutdownTimeout = 10000; // 10 seconds max for graceful shutdown
  
  // Error tracking for monitoring
  private recentErrors: ErrorLogEntry[] = [];
  private readonly MAX_ERROR_LOG = 100;
  private errorCountSinceStart = 0;
  private processStartTime = getActiveClock().now();

  constructor() {
    this.setupSignalHandlers();
  }

  /**
   * Register a cleanup handler
   * Higher priority handlers run first (e.g., close DB connections before HTTP servers)
   */
  registerCleanup(name: string, handler: () => Promise<void> | void, priority = 100): void {
    this.cleanupHandlers.push({ name, handler, priority });
    this.cleanupHandlers.sort((a, b) => a.priority - b.priority);
    console.log(`[ProcessManager] Registered cleanup handler: ${name} (priority: ${priority})`);
  }

  /**
   * Get error statistics for health monitoring
   */
  getErrorStats() {
    return {
      processStartTime: this.processStartTime,
      processUptimeMs: getActiveClock().now() - this.processStartTime,
      totalErrors: this.errorCountSinceStart,
      recentErrors: this.recentErrors.slice(-20), // Last 20 errors
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Get recent errors for the log page
   */
  getRecentErrors(): ErrorLogEntry[] {
    return [...this.recentErrors];
  }

  /**
   * Track an error without crashing
   */
  private trackError(entry: ErrorLogEntry): void {
    this.recentErrors.push(entry);
    if (this.recentErrors.length > this.MAX_ERROR_LOG) {
      this.recentErrors.shift();
    }
    this.errorCountSinceStart++;
  }

  /**
   * Determine if an error is truly fatal (process must die)
   */
  private isFatalError(error: Error | any): boolean {
    const message = (error?.message || String(error) || '').toLowerCase();
    const code = (error as any)?.code || '';
    
    // Only these conditions are truly fatal:
    return (
      message.includes('out of memory') ||
      message.includes('fatal') && message.includes('allocation') ||
      code === 'ERR_WORKER_OUT_OF_MEMORY' ||
      message.includes('enospc') || // disk full
      message.includes('cannot allocate memory') ||
      // V8 heap exhaustion
      message.includes('javascript heap out of memory')
    );
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    // Handle SIGTERM (Docker, Kubernetes, systemd)
    process.on('SIGTERM', () => {
      console.log('[ProcessManager] Received SIGTERM signal');
      this.gracefulShutdown('SIGTERM');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log('[ProcessManager] Received SIGINT signal (Ctrl+C)');
      this.gracefulShutdown('SIGINT');
    });

    // Handle uncaught exceptions — LOG but DO NOT CRASH unless truly fatal
    process.on('uncaughtException', (error) => {
      const isFatal = this.isFatalError(error);
      const errorMessage = error?.message || String(error);
      
      // Always log the error
      console.error(`[ProcessManager] Uncaught exception (${isFatal ? 'FATAL' : 'non-fatal'}):`, errorMessage);
      if (error?.stack) {
        console.error('[ProcessManager] Stack:', error.stack);
      }
      
      // Track for monitoring
      this.trackError({
        timestamp: getActiveClock().now(),
        type: 'uncaughtException',
        message: errorMessage,
        stack: error?.stack,
        fatal: isFatal,
      });
      
      if (isFatal) {
        console.error('[ProcessManager] FATAL uncaught exception — shutting down');
        this.gracefulShutdown('uncaughtException');
      } else {
        console.warn('[ProcessManager] Non-fatal uncaught exception — server continues running');
        console.warn('[ProcessManager] Error count since start:', this.errorCountSinceStart);
      }
    });

    // Handle unhandled promise rejections — LOG but DO NOT CRASH unless truly fatal
    process.on('unhandledRejection', (reason: any, _promise) => {
      const message = reason?.message || String(reason) || '';
      const isFatal = this.isFatalError(reason);
      
      console.error(`[ProcessManager] Unhandled rejection (${isFatal ? 'FATAL' : 'non-fatal'}):`, message);
      if (reason?.stack) {
        console.error('[ProcessManager] Stack:', reason.stack);
      }

      // Track for monitoring
      this.trackError({
        timestamp: getActiveClock().now(),
        type: 'unhandledRejection',
        message,
        stack: reason?.stack,
        fatal: isFatal,
      });

      if (isFatal) {
        console.error('[ProcessManager] FATAL unhandled rejection — shutting down');
        this.gracefulShutdown('unhandledRejection');
      } else {
        console.warn('[ProcessManager] Non-fatal unhandled rejection — server continues running');
        console.warn('[ProcessManager] Error count since start:', this.errorCountSinceStart);
      }
    });

    // Handle process exit
    process.on('exit', (code) => {
      console.log(`[ProcessManager] Process exiting with code: ${code}`);
    });

    console.log('[ProcessManager] Signal handlers registered (crash-proof mode)');
  }

  /**
   * Graceful shutdown with timeout
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log('[ProcessManager] Shutdown already in progress, forcing exit...');
      process.exit(1);
      return;
    }

    this.isShuttingDown = true;
    console.log(`[ProcessManager] Starting graceful shutdown (signal: ${signal})...`);

    // Set timeout for forced shutdown
    const forceShutdownTimer = setTimeout(() => {
      console.error('[ProcessManager] Graceful shutdown timeout, forcing exit...');
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // Run cleanup handlers in priority order
      for (const { name, handler } of this.cleanupHandlers) {
        try {
          console.log(`[ProcessManager] Running cleanup: ${name}`);
          await Promise.resolve(handler());
          console.log(`[ProcessManager] ✓ Cleanup completed: ${name}`);
        } catch (error) {
          console.error(`[ProcessManager] ✗ Cleanup failed: ${name}`, error);
        }
      }

      console.log('[ProcessManager] Graceful shutdown completed');
      clearTimeout(forceShutdownTimer);
      process.exit(0);
    } catch (error) {
      console.error('[ProcessManager] Shutdown error:', error);
      clearTimeout(forceShutdownTimer);
      process.exit(1);
    }
  }

  /**
   * Get shutdown status
   */
  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }
}

// Singleton instance
export const processManager = new ProcessManager();
