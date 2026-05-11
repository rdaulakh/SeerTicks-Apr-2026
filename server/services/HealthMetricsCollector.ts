import { getActiveClock } from '../_core/clock';
/**
 * Health Metrics Collector Service
 * Collects and aggregates system health metrics
 */

export interface HealthMetrics {
  timestamp: Date;
  cpu: number;
  memory: number;
  activeConnections: number;
  requestsPerSecond: number;
  errorRate: number;
  averageLatency: number;
}

class HealthMetricsCollector {
  private metrics: HealthMetrics[] = [];
  private maxMetrics: number = 1000;

  /**
   * Record health metrics
   */
  recordMetrics(metrics: Partial<HealthMetrics>): void {
    const fullMetrics: HealthMetrics = {
      timestamp: new Date(),
      cpu: 0,
      memory: 0,
      activeConnections: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      averageLatency: 0,
      ...metrics,
    };

    this.metrics.push(fullMetrics);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  /**
   * Get latest metrics
   */
  getLatestMetrics(): HealthMetrics | undefined {
    return this.metrics[this.metrics.length - 1];
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(count: number = 100): HealthMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get average metrics over time period
   */
  getAverageMetrics(minutes: number = 5): Partial<HealthMetrics> {
    const cutoff = new Date(getActiveClock().now() - minutes * 60 * 1000);
    const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoff);

    if (recentMetrics.length === 0) {
      return {};
    }

    const sum = recentMetrics.reduce((acc, m) => ({
      cpu: acc.cpu + m.cpu,
      memory: acc.memory + m.memory,
      activeConnections: acc.activeConnections + m.activeConnections,
      requestsPerSecond: acc.requestsPerSecond + m.requestsPerSecond,
      errorRate: acc.errorRate + m.errorRate,
      averageLatency: acc.averageLatency + m.averageLatency,
    }), {
      cpu: 0,
      memory: 0,
      activeConnections: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      averageLatency: 0,
    });

    const count = recentMetrics.length;
    return {
      cpu: sum.cpu / count,
      memory: sum.memory / count,
      activeConnections: sum.activeConnections / count,
      requestsPerSecond: sum.requestsPerSecond / count,
      errorRate: sum.errorRate / count,
      averageLatency: sum.averageLatency / count,
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

const healthMetricsCollector = new HealthMetricsCollector();

export function getHealthMetricsCollector(): HealthMetricsCollector {
  return healthMetricsCollector;
}

export { HealthMetricsCollector };
