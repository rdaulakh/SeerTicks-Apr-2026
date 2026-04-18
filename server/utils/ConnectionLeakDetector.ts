/**
 * Connection Leak Detection Utility
 * Monitors database connections and detects potential leaks
 * 
 * Features:
 * - Track connection acquisition and release
 * - Detect long-running connections
 * - Alert on connection pool exhaustion
 * - Provide connection usage statistics
 */

interface ConnectionTracker {
  id: string;
  acquiredAt: number;
  stackTrace: string;
  operation?: string;
}

interface LeakDetectionConfig {
  maxConnectionAge: number; // Max age in ms before warning
  checkInterval: number; // How often to check for leaks (ms)
  enabled: boolean;
}

const DEFAULT_CONFIG: LeakDetectionConfig = {
  maxConnectionAge: 30000, // 30 seconds
  checkInterval: 10000, // Check every 10 seconds
  enabled: process.env.NODE_ENV !== 'production', // Only in dev by default
};

class ConnectionLeakDetector {
  private config: LeakDetectionConfig;
  private activeConnections: Map<string, ConnectionTracker> = new Map();
  private checkIntervalId: NodeJS.Timeout | null = null;
  private totalAcquired = 0;
  private totalReleased = 0;
  private totalLeaksDetected = 0;

  constructor(config: Partial<LeakDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (this.config.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Track connection acquisition
   */
  trackAcquisition(connectionId: string, operation?: string): void {
    if (!this.config.enabled) return;

    const stackTrace = new Error().stack || 'No stack trace available';
    
    this.activeConnections.set(connectionId, {
      id: connectionId,
      acquiredAt: Date.now(),
      stackTrace,
      operation,
    });
    
    this.totalAcquired++;
  }

  /**
   * Track connection release
   */
  trackRelease(connectionId: string): void {
    if (!this.config.enabled) return;

    if (this.activeConnections.has(connectionId)) {
      this.activeConnections.delete(connectionId);
      this.totalReleased++;
    } else {
      console.warn(`[ConnectionLeakDetector] Attempted to release unknown connection: ${connectionId}`);
    }
  }

  /**
   * Start periodic leak detection
   */
  private startMonitoring(): void {
    if (this.checkIntervalId) return;

    console.log('[ConnectionLeakDetector] Starting connection leak monitoring');
    
    this.checkIntervalId = setInterval(() => {
      this.checkForLeaks();
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log('[ConnectionLeakDetector] Stopped connection leak monitoring');
    }
  }

  /**
   * Check for connection leaks
   */
  private checkForLeaks(): void {
    const now = Date.now();
    const leaks: ConnectionTracker[] = [];

    for (const [id, tracker] of this.activeConnections.entries()) {
      const age = now - tracker.acquiredAt;
      
      if (age > this.config.maxConnectionAge) {
        leaks.push(tracker);
      }
    }

    if (leaks.length > 0) {
      this.totalLeaksDetected += leaks.length;
      
      console.error(
        `[ConnectionLeakDetector] Detected ${leaks.length} potential connection leak(s):`
      );
      
      leaks.forEach((leak) => {
        const age = Math.floor((now - leak.acquiredAt) / 1000);
        console.error(
          `  - Connection ${leak.id} held for ${age}s (operation: ${leak.operation || 'unknown'})`
        );
        console.error(`    Stack trace:\n${leak.stackTrace}`);
      });
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      activeConnections: this.activeConnections.size,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      totalLeaksDetected: this.totalLeaksDetected,
      potentialLeaks: this.totalAcquired - this.totalReleased,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalAcquired = 0;
    this.totalReleased = 0;
    this.totalLeaksDetected = 0;
    this.activeConnections.clear();
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    
    if (enabled) {
      this.startMonitoring();
    } else {
      this.stopMonitoring();
    }
  }
}

/**
 * Global leak detector instance
 */
export const connectionLeakDetector = new ConnectionLeakDetector({
  enabled: process.env.DETECT_CONNECTION_LEAKS === 'true',
  maxConnectionAge: parseInt(process.env.MAX_CONNECTION_AGE || '30000'),
  checkInterval: parseInt(process.env.LEAK_CHECK_INTERVAL || '10000'),
});

/**
 * Wrapper function to track connection usage
 */
export async function withConnectionTracking<T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> {
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    connectionLeakDetector.trackAcquisition(connectionId, operationName);
    const result = await operation();
    return result;
  } finally {
    connectionLeakDetector.trackRelease(connectionId);
  }
}
