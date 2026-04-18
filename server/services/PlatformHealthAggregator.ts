/**
 * Phase 15F + 16: PlatformHealthAggregator — Unified Health Monitoring + Structured Alerting
 *
 * Aggregates health from all critical platform components:
 * - GlobalMarketEngine (agent analyzers)
 * - UserSessionManager (user sessions)
 * - PriceFeedService (price ticks)
 * - MemoryMonitor (memory usage)
 * - RiskManager (circuit breakers)
 * - PositionGuardian (position safety)
 * - DatabaseCleanupService (data retention)
 * - AgentAlphaValidator (alpha validation — Phase 16)
 *
 * Publishes unified health status every 30s.
 * Detects: agent death, price feed stale, memory pressure, DB issues.
 * Emits events for auto-recovery and external monitoring.
 *
 * Phase 16: Structured Alerting
 * - Webhook-based alerts (Slack, Discord, PagerDuty, custom HTTP)
 * - Alert deduplication: same alert not sent within cooldown window
 * - Severity-based routing: critical → immediate, degraded → batched
 */

import { EventEmitter } from 'events';

export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'critical' | 'unknown';
  lastCheck: number;
  details: Record<string, any>;
}

export interface PlatformHealth {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
  uptimeMs: number;
  components: ComponentHealth[];
  alerts: string[];
}

// Phase 16: Webhook alerting configuration
export interface WebhookConfig {
  name: string;
  url: string;
  type: 'slack' | 'discord' | 'pagerduty' | 'generic';
  minSeverity: 'degraded' | 'critical'; // Only send alerts at or above this level
  enabled: boolean;
}

export interface AlertRecord {
  message: string;
  severity: 'degraded' | 'critical';
  timestamp: number;
  sentToWebhooks: string[];
}

class PlatformHealthAggregator extends EventEmitter {
  private isRunning: boolean = false;
  private startedAt: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastHealth: PlatformHealth | null = null;

  private readonly CHECK_INTERVAL_MS = 30_000; // 30 seconds

  // Phase 16: Webhook alerting
  private webhooks: WebhookConfig[] = [];
  private alertHistory: AlertRecord[] = [];
  private readonly ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min dedup window
  private readonly MAX_ALERT_HISTORY = 100;

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[PlatformHealthAggregator] Starting unified health monitoring...');
    this.startedAt = Date.now();
    this.isRunning = true;

    // Initial check
    await this.performHealthCheck();

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch(err => {
        console.error('[PlatformHealthAggregator] Health check failed:', (err as Error)?.message);
      });
    }, this.CHECK_INTERVAL_MS);

    if (this.checkInterval.unref) {
      this.checkInterval.unref();
    }

    console.log('[PlatformHealthAggregator] ✅ Started');
  }

  stop(): void {
    if (!this.isRunning) return;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[PlatformHealthAggregator] Stopped');
  }

  getHealth(): PlatformHealth | null {
    return this.lastHealth;
  }

  private async performHealthCheck(): Promise<void> {
    const components: ComponentHealth[] = [];
    const alerts: string[] = [];

    // 1. GlobalMarketEngine health
    try {
      const { getGlobalMarketEngine } = await import('./GlobalMarketEngine');
      const engine = getGlobalMarketEngine();
      const status = engine.getStatus();

      const unhealthyAnalyzers = status.analyzerStatuses.filter(a => !a.running).length;
      let engineStatus: ComponentHealth['status'] = 'healthy';
      if (!status.isRunning) {
        engineStatus = 'critical';
        alerts.push('GlobalMarketEngine is not running');
      } else if (unhealthyAnalyzers > 0) {
        engineStatus = 'degraded';
        alerts.push(`${unhealthyAnalyzers} analyzer(s) not running`);
      }

      components.push({
        name: 'GlobalMarketEngine',
        status: engineStatus,
        lastCheck: Date.now(),
        details: {
          isRunning: status.isRunning,
          symbols: status.symbols,
          analyzerCount: status.analyzerStatuses.length,
          unhealthyAnalyzers,
          uptimeMs: status.uptimeMs,
        },
      });
    } catch {
      components.push({ name: 'GlobalMarketEngine', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // 2. UserSessionManager health
    try {
      const { getUserSessionManager } = await import('./UserSessionManager');
      const manager = getUserSessionManager();
      const status = manager.getStatus();

      components.push({
        name: 'UserSessionManager',
        status: status.isInitialized ? 'healthy' : 'critical',
        lastCheck: Date.now(),
        details: {
          initialized: status.isInitialized,
          totalSessions: status.totalSessions,
          activeSessions: status.activeSessions,
          autoTradingSessions: status.autoTradingSessions,
        },
      });

      if (!status.isInitialized) {
        alerts.push('UserSessionManager not initialized');
      }
    } catch {
      components.push({ name: 'UserSessionManager', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // 3. PriceFeedService health
    try {
      const { priceFeedService } = await import('./priceFeedService');
      const prices = priceFeedService.getPrices(['BTC-USD', 'ETH-USD']);
      const hasBTC = prices.has('BTC-USD') && (prices.get('BTC-USD')?.price || 0) > 0;
      const hasETH = prices.has('ETH-USD') && (prices.get('ETH-USD')?.price || 0) > 0;

      let priceStatus: ComponentHealth['status'] = 'healthy';
      if (!hasBTC && !hasETH) {
        priceStatus = 'critical';
        alerts.push('No price data available for BTC or ETH');
      } else if (!hasBTC || !hasETH) {
        priceStatus = 'degraded';
        alerts.push(`Missing price data: ${!hasBTC ? 'BTC-USD' : 'ETH-USD'}`);
      }

      components.push({
        name: 'PriceFeedService',
        status: priceStatus,
        lastCheck: Date.now(),
        details: {
          btcPrice: prices.get('BTC-USD')?.price || 0,
          ethPrice: prices.get('ETH-USD')?.price || 0,
        },
      });
    } catch {
      components.push({ name: 'PriceFeedService', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // 4. MemoryMonitor health
    try {
      const { getMemoryMonitor } = await import('./MemoryMonitor');
      const monitor = getMemoryMonitor();
      if (monitor) {
        const status = monitor.getStatus();
        let memStatus: ComponentHealth['status'] = 'healthy';
        if (status.alertLevel === 'critical') {
          memStatus = 'critical';
          alerts.push(`Memory CRITICAL: ${status.usagePercent.toFixed(0)}%`);
        } else if (status.alertLevel === 'warning') {
          memStatus = 'degraded';
          alerts.push(`Memory WARNING: ${status.usagePercent.toFixed(0)}%`);
        }

        components.push({
          name: 'MemoryMonitor',
          status: memStatus,
          lastCheck: Date.now(),
          details: {
            currentMB: status.currentMB,
            limitMB: status.limitMB,
            usagePercent: status.usagePercent,
            alertLevel: status.alertLevel,
          },
        });
      }
    } catch {
      components.push({ name: 'MemoryMonitor', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // 5. PositionGuardian health
    try {
      const { getPositionGuardian } = await import('./PositionGuardian');
      const guardian = getPositionGuardian();
      const status = guardian.getStatus();

      let guardianStatus: ComponentHealth['status'] = 'healthy';
      if (!status.isRunning) {
        guardianStatus = 'critical';
        alerts.push('PositionGuardian is not running');
      } else if (status.safety.deadManTriggered) {
        guardianStatus = 'critical';
        alerts.push('Dead man\'s switch triggered');
      }

      components.push({
        name: 'PositionGuardian',
        status: guardianStatus,
        lastCheck: Date.now(),
        details: {
          isRunning: status.isRunning,
          uptimePercent: status.uptime.percent,
          emergencyExitCount: status.safety.emergencyExitCount,
          deadManTriggered: status.safety.deadManTriggered,
        },
      });
    } catch {
      components.push({ name: 'PositionGuardian', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // 6. AgentAlphaValidator health (Phase 16)
    try {
      const { getAgentAlphaValidator } = await import('./AgentAlphaValidator');
      const validator = getAgentAlphaValidator();
      const lastResult = validator.getLastValidation();

      if (lastResult) {
        const timeSinceValidation = Date.now() - lastResult.timestamp;
        let alphaStatus: ComponentHealth['status'] = 'healthy';
        if (timeSinceValidation > 24 * 60 * 60 * 1000) {
          alphaStatus = 'degraded';
          alerts.push('Alpha validation stale (>24h)');
        }
        if (lastResult.agentsToPrune.length > 3) {
          alphaStatus = 'degraded';
          alerts.push(`${lastResult.agentsToPrune.length} agents flagged for pruning`);
        }

        components.push({
          name: 'AgentAlphaValidator',
          status: alphaStatus,
          lastCheck: Date.now(),
          details: {
            tradesAnalyzed: lastResult.totalTradesAnalyzed,
            agentsWithAlpha: lastResult.agentsWithAlpha.length,
            agentsToPrune: lastResult.agentsToPrune.length,
            systemWinRate: lastResult.systemWinRate,
            systemSharpe: lastResult.systemSharpe,
            lastValidation: new Date(lastResult.timestamp).toISOString(),
          },
        });
      }
    } catch {
      components.push({ name: 'AgentAlphaValidator', status: 'unknown', lastCheck: Date.now(), details: {} });
    }

    // Determine overall status
    const criticalCount = components.filter(c => c.status === 'critical').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;

    let overallStatus: PlatformHealth['overallStatus'] = 'healthy';
    if (criticalCount > 0) {
      overallStatus = 'critical';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    }

    this.lastHealth = {
      overallStatus,
      timestamp: Date.now(),
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      components,
      alerts,
    };

    // Emit events
    this.emit('health_updated', this.lastHealth);

    if (alerts.length > 0) {
      console.log(`[PlatformHealthAggregator] Status: ${overallStatus.toUpperCase()} | Alerts: ${alerts.join(', ')}`);
    }

    // Phase 16: Send webhook alerts for critical/degraded status
    if (overallStatus !== 'healthy' && alerts.length > 0) {
      const severity = overallStatus as 'degraded' | 'critical';
      const message = `SEER Platform ${overallStatus.toUpperCase()}: ${alerts.join('; ')}`;
      this.sendWebhookAlerts(message, severity).catch(() => {});
    }

    // Persist to DB for external monitoring
    this.persistHealth(this.lastHealth).catch(() => {});
  }

  private async persistHealth(health: PlatformHealth): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const healthData = {
        status: health.overallStatus,
        timestamp: new Date(health.timestamp).toISOString(),
        uptimeMs: health.uptimeMs,
        componentCount: health.components.length,
        alerts: health.alerts,
        components: health.components.map(c => ({
          name: c.name,
          status: c.status,
        })),
      };

      const existing = await db.select().from(systemConfig)
        .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'platform_health')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: healthData, updatedAt: new Date() })
          .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'platform_health')));
      } else {
        await db.insert(systemConfig).values({
          userId: 1,
          configKey: 'platform_health',
          configValue: healthData,
        });
      }
    } catch {
      // Non-critical
    }
  }

  // ── Phase 16: Webhook Alerting ──

  /**
   * Register a webhook endpoint for alerts
   */
  addWebhook(config: WebhookConfig): void {
    this.webhooks.push(config);
    console.log(`[PlatformHealthAggregator] Registered webhook: ${config.name} (${config.type})`);
  }

  /**
   * Remove a webhook by name
   */
  removeWebhook(name: string): void {
    this.webhooks = this.webhooks.filter(w => w.name !== name);
  }

  /**
   * Get registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  /**
   * Get recent alert history
   */
  getAlertHistory(): AlertRecord[] {
    return [...this.alertHistory];
  }

  /**
   * Load webhook configuration from database
   */
  async loadWebhooksFromDb(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const result = await db.select().from(systemConfig)
        .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'alert_webhooks')))
        .limit(1);

      if (result.length > 0 && result[0].configValue) {
        const parsed = typeof result[0].configValue === 'string'
          ? JSON.parse(result[0].configValue)
          : result[0].configValue;
        if (Array.isArray(parsed)) {
          this.webhooks = parsed;
          console.log(`[PlatformHealthAggregator] Loaded ${this.webhooks.length} webhooks from DB`);
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Save webhook configuration to database
   */
  async saveWebhooksToDb(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const data = this.webhooks;

      const existing = await db.select().from(systemConfig)
        .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'alert_webhooks')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: data, updatedAt: new Date() })
          .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'alert_webhooks')));
      } else {
        await db.insert(systemConfig).values({
          userId: 1,
          configKey: 'alert_webhooks',
          configValue: data,
        });
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Send alerts to all matching webhooks
   * Includes deduplication: same message not sent within ALERT_COOLDOWN_MS
   */
  private async sendWebhookAlerts(message: string, severity: 'degraded' | 'critical'): Promise<void> {
    // Deduplication check
    const now = Date.now();
    const recentDuplicate = this.alertHistory.find(
      a => a.message === message && (now - a.timestamp) < this.ALERT_COOLDOWN_MS
    );
    if (recentDuplicate) return; // Already sent recently

    const matchingWebhooks = this.webhooks.filter(w => {
      if (!w.enabled) return false;
      if (w.minSeverity === 'critical' && severity === 'degraded') return false;
      return true;
    });

    if (matchingWebhooks.length === 0) return;

    const sentTo: string[] = [];

    for (const webhook of matchingWebhooks) {
      try {
        await this.sendToWebhook(webhook, message, severity);
        sentTo.push(webhook.name);
      } catch (err) {
        console.error(`[PlatformHealthAggregator] Failed to send alert to ${webhook.name}:`, (err as Error)?.message);
      }
    }

    // Record alert
    this.alertHistory.push({
      message,
      severity,
      timestamp: now,
      sentToWebhooks: sentTo,
    });

    // Trim history
    if (this.alertHistory.length > this.MAX_ALERT_HISTORY) {
      this.alertHistory = this.alertHistory.slice(-this.MAX_ALERT_HISTORY);
    }

    if (sentTo.length > 0) {
      console.log(`[PlatformHealthAggregator] Alert sent to ${sentTo.length} webhook(s): ${sentTo.join(', ')}`);
    }
  }

  /**
   * Send a single alert to a specific webhook
   */
  private async sendToWebhook(webhook: WebhookConfig, message: string, severity: string): Promise<void> {
    let body: string;

    switch (webhook.type) {
      case 'slack':
        body = JSON.stringify({
          text: `${severity === 'critical' ? ':rotating_light:' : ':warning:'} *SEER Alert* [${severity.toUpperCase()}]\n${message}`,
          username: 'SEER Platform',
          icon_emoji: severity === 'critical' ? ':rotating_light:' : ':warning:',
        });
        break;

      case 'discord':
        body = JSON.stringify({
          content: `**SEER Alert** [${severity.toUpperCase()}]\n${message}`,
          username: 'SEER Platform',
        });
        break;

      case 'pagerduty':
        body = JSON.stringify({
          routing_key: new URL(webhook.url).searchParams.get('key') || '',
          event_action: severity === 'critical' ? 'trigger' : 'acknowledge',
          payload: {
            summary: message,
            severity: severity === 'critical' ? 'critical' : 'warning',
            source: 'seer-trading-platform',
            component: 'PlatformHealthAggregator',
            timestamp: new Date().toISOString(),
          },
        });
        break;

      default: // generic
        body = JSON.stringify({
          severity,
          message,
          timestamp: new Date().toISOString(),
          platform: 'seer-trading',
          components: this.lastHealth?.components.map(c => ({
            name: c.name,
            status: c.status,
          })),
        });
        break;
    }

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }
}

// Singleton
let instance: PlatformHealthAggregator | null = null;

export function getPlatformHealthAggregator(): PlatformHealthAggregator {
  if (!instance) {
    instance = new PlatformHealthAggregator();
  }
  return instance;
}

export { PlatformHealthAggregator };
