/**
 * Exchange Health Monitor Service
 * Monitors health and status of connected exchanges
 */

export interface ExchangeHealth {
  exchange: string;
  status: 'online' | 'degraded' | 'offline';
  latency: number;
  lastCheck: Date;
  errorRate: number;
}

class ExchangeHealthMonitor {
  private healthData: Map<string, ExchangeHealth> = new Map();

  /**
   * Get health status for all exchanges
   */
  getAllHealth(): ExchangeHealth[] {
    return Array.from(this.healthData.values());
  }

  /**
   * Get health status for specific exchange
   */
  getHealth(exchange: string): ExchangeHealth | undefined {
    return this.healthData.get(exchange);
  }

  /**
   * Update health status
   */
  updateHealth(exchange: string, health: Partial<ExchangeHealth>): void {
    const existing = this.healthData.get(exchange) || {
      exchange,
      status: 'online' as const,
      latency: 0,
      lastCheck: new Date(),
      errorRate: 0,
    };

    this.healthData.set(exchange, {
      ...existing,
      ...health,
      lastCheck: new Date(),
    });
  }
}

const exchangeHealthMonitor = new ExchangeHealthMonitor();

export function getExchangeHealthMonitor(): ExchangeHealthMonitor {
  return exchangeHealthMonitor;
}

export { ExchangeHealthMonitor };
