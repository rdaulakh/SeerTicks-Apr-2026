/**
 * Latency Alert Monitor Service
 * Monitors and alerts on high latency conditions
 */

export interface LatencyAlert {
  service: string;
  latency: number;
  threshold: number;
  timestamp: Date;
  severity: 'warning' | 'critical';
}

class LatencyAlertMonitor {
  private alerts: LatencyAlert[] = [];
  private thresholds: Map<string, number> = new Map();

  constructor() {
    // Set default thresholds
    this.thresholds.set('api', 1000); // 1 second
    this.thresholds.set('websocket', 100); // 100ms
    this.thresholds.set('database', 500); // 500ms
  }

  /**
   * Record latency measurement
   */
  recordLatency(service: string, latency: number): void {
    const threshold = this.thresholds.get(service) || 1000;
    
    if (latency > threshold) {
      const severity = latency > threshold * 2 ? 'critical' : 'warning';
      this.alerts.push({
        service,
        latency,
        threshold,
        timestamp: new Date(),
        severity,
      });

      // Keep only last 100 alerts
      if (this.alerts.length > 100) {
        this.alerts.shift();
      }
    }
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(count: number = 10): LatencyAlert[] {
    return this.alerts.slice(-count);
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Set threshold for service
   */
  setThreshold(service: string, threshold: number): void {
    this.thresholds.set(service, threshold);
  }
}

const latencyAlertMonitor = new LatencyAlertMonitor();

export function getLatencyAlertMonitor(): LatencyAlertMonitor {
  return latencyAlertMonitor;
}

export { LatencyAlertMonitor };
