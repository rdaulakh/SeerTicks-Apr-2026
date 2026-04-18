/**
 * Rate Limit Monitor Service
 * Monitors API rate limits across exchanges
 */

export interface RateLimitStatus {
  exchange: string;
  endpoint: string;
  limit: number;
  remaining: number;
  resetTime: Date;
  status: 'ok' | 'warning' | 'critical';
}

export interface RateLimitMetrics {
  totalRequests: number;
  rejectedRequests: number;
  averageLatency: number;
  status: 'healthy' | 'degraded' | 'critical';
  metrics: RateLimitStatus[];
}

class RateLimitMonitor {
  private limits: Map<string, RateLimitStatus> = new Map();
  private totalRequests: number = 0;
  private rejectedRequests: number = 0;

  /**
   * Get all rate limit statuses
   */
  getAllStatus(): unknown {
    return {
      status: 'healthy' as const,
      metrics: Array.from(this.limits.values()),
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      averageLatency: 0,
    };
  }

  /**
   * Get rate limit status for specific exchange
   */
  getStatus(exchange: string): RateLimitStatus | undefined {
    return this.limits.get(exchange);
  }

  /**
   * Update rate limit status
   */
  updateStatus(exchange: string, endpoint: string, status: Partial<RateLimitStatus>): void {
    const key = `${exchange}:${endpoint}`;
    const existing = this.limits.get(key) || {
      exchange,
      endpoint,
      limit: 0,
      remaining: 0,
      resetTime: new Date(),
      status: 'ok' as const,
    };

    this.limits.set(key, {
      ...existing,
      ...status,
    });
  }

  /**
   * Record API request
   */
  recordRequest(exchange: string, success: boolean): void {
    this.totalRequests++;
    if (!success) {
      this.rejectedRequests++;
    }
  }

  /**
   * Get metrics
   */
  getMetrics(): RateLimitMetrics {
    return {
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      averageLatency: 0,
      status: 'healthy',
      metrics: Array.from(this.limits.values()),
    };
  }
}

const rateLimitMonitor = new RateLimitMonitor();

export function getRateLimitMonitor(): RateLimitMonitor {
  return rateLimitMonitor;
}

export { RateLimitMonitor };
